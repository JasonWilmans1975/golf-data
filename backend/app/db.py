import asyncio
import threading
import time

import httpx
from postgrest.exceptions import APIError
from supabase import create_client, ClientOptions
from .config import settings


def _new_httpx_client():
    # Supabase's edge (Cloudflare) can close a pooled HTTP/2 connection at
    # the exact moment a client tries to reuse it for a new request, causing
    # httpx.RemoteProtocolError (a known race, not specific to this app —
    # see https://github.com/supabase/supabase-py/issues/1064). Disabling
    # connection reuse entirely means every request opens a fresh
    # connection, which avoids the race at the cost of a slightly slower
    # per-request handshake — an acceptable tradeoff for this app's traffic
    # volume.
    return httpx.Client(
        limits=httpx.Limits(max_keepalive_connections=0),
        timeout=30,
    )


def _build_client():
    return create_client(
        settings.supabase_url,
        settings.supabase_service_role_key,
        options=ClientOptions(httpx_client=_new_httpx_client()),
    )


_local = threading.local()


class _ThreadLocalSupabase:
    """Stands in for a single shared Client, but every attribute access
    (.table(...), .storage, ...) is routed to a Client private to the
    calling thread instead -- and .table()/.storage are further routed to
    TWO SEPARATE underlying Client instances per thread (see below).

    Why two clients, not one: supabase-py's postgrest and storage
    sub-clients each get their OWN httpx.Client's .base_url set exactly
    once, the first time that sub-client is lazily constructed (accessing
    .postgrest sets it to .../rest/v1/, accessing .storage sets it to
    .../storage/v1/) -- and if ClientOptions(httpx_client=...) hands both
    sub-clients the SAME underlying httpx.Client (as a single create_client()
    call does), whichever one is constructed *second* permanently overwrites
    that shared base_url for the OTHER sub-client too, since nothing ever
    resets it again afterward. On a long-lived worker thread that's already
    made ordinary table() calls (constructing .postgrest first) and later
    handles its first-ever photo/story upload (constructing .storage
    second), every table() call on that thread breaks permanently from that
    point on -- confirmed directly: .table() succeeds, .storage.from_(...)
    is touched once, and the exact same .table() call then 404s with
    "Route not found", routed to /storage/v1/ instead of /rest/v1/, for the
    rest of that client instance's life (an earlier, first-cut version of
    this file gave each THREAD its own client to fix a *cross-thread*
    version of this same base_url collision, but that alone doesn't stop
    this *same-thread* one -- postgrest and storage still needed fully
    separate httpx.Client instances, not just a separate Client per thread).
    """

    def __getattr__(self, name):
        if name == "storage":
            client = getattr(_local, "storage_client", None)

            if client is None:
                client = _build_client()
                _local.storage_client = client

            return client.storage

        client = getattr(_local, "client", None)

        if client is None:
            client = _build_client()
            _local.client = client

        return getattr(client, name)


supabase = _ThreadLocalSupabase()

def execute_with_retry(build_query, retries: int = 2, delay: float = 0.3):
    """Supabase's own gateway has, more than once, intermittently 404'd a
    query for a table that demonstrably exists (confirmed live: the exact
    same query, retried moments later, succeeds -- seen for handicap_sync_
    state, strava_tokens, and handicap_credentials on different occasions,
    including one case where the request was routed to /storage/v1/ instead
    of /rest/v1/ despite our own client constructing the URL correctly).
    Not something fixable on our end -- a short retry rides out the blip
    instead of surfacing it as a 500. Use for status checks and other reads
    where a brief extra delay is harmless; not for writes.

    `build_query` must return a *fresh*, unexecuted query builder each call
    (e.g. a lambda), same requirement as fetch_all.
    """
    last_error: Exception | None = None

    for attempt in range(retries + 1):
        try:
            return build_query().execute()
        except Exception as exc:
            last_error = exc
            if attempt < retries:
                time.sleep(delay)

    raise last_error


def _is_transient_route_not_found(exc: Exception) -> bool:
    return (
        isinstance(exc, APIError)
        and exc.code == 404
        and "not found" in (exc.details or "").lower()
    )


async def retry_whole_sync(run, retries: int = 1, delay: float = 1.0):
    """A full sync (handicap/garmin/teesheet) makes dozens of sequential
    Supabase calls -- any single one hitting the transient "Route not
    found" gateway blip execute_with_retry exists for fails the entire
    sync. Wrapping every individual call site along that whole chain isn't
    practical; retrying the whole operation once is far simpler and just as
    effective, since a sync is safe to re-run (force=True is already how
    the manual "Sync now" button works).

    Only retries on that specific transient signature -- a real error
    (bad credentials, a genuine bug) is never blindly retried.
    """
    last_error: Exception | None = None

    for attempt in range(retries + 1):
        try:
            return await run()
        except APIError as exc:
            if not _is_transient_route_not_found(exc):
                raise
            last_error = exc
            if attempt < retries:
                await asyncio.sleep(delay)

    raise last_error


PAGE_SIZE = 1000


def fetch_all(build_query, page_size: int = PAGE_SIZE) -> list[dict]:
    """Run a Supabase select past PostgREST's server-side max-rows cap
    (1000 by default, and not something a client-side .limit() can raise).

    `build_query` must return a *fresh*, unexecuted query builder each call
    (e.g. a lambda), since .range() finalizes it for a single page.
    """
    rows: list[dict] = []
    start = 0

    while True:
        page = build_query().range(start, start + page_size - 1).execute()
        batch = page.data or []
        rows.extend(batch)

        if len(batch) < page_size:
            return rows

        start += page_size
