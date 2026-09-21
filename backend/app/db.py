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
