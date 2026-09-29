import time

import httpx
from supabase import create_client, ClientOptions
from .config import settings

# Supabase's edge (Cloudflare) can close a pooled HTTP/2 connection at the
# exact moment a client tries to reuse it for a new request, causing
# httpx.RemoteProtocolError (a known race, not specific to this app —
# see https://github.com/supabase/supabase-py/issues/1064). Disabling
# connection reuse entirely means every request opens a fresh connection,
# which avoids the race at the cost of a slightly slower per-request
# handshake — an acceptable tradeoff for this app's traffic volume.
_httpx_client = httpx.Client(
    limits=httpx.Limits(max_keepalive_connections=0),
    timeout=30,
)

supabase = create_client(
    settings.supabase_url,
    settings.supabase_service_role_key,
    options=ClientOptions(httpx_client=_httpx_client),
)

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
