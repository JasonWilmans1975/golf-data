import httpx
from supabase import create_client, ClientOptions
from .config import settings


class RetryTransport(httpx.HTTPTransport):
    """Retries requests that fail with a transient network/protocol error.

    Render's outbound connections to Supabase intermittently hit HTTP/2
    stream resets (httpx.RemoteProtocolError) that aren't covered by
    httpx's built-in connection-level retries.
    """

    def __init__(self, retries: int = 3, **kwargs):
        super().__init__(**kwargs)
        self._retries = retries

    def handle_request(self, request):
        last_exc = None

        for attempt in range(self._retries):
            try:
                return super().handle_request(request)
            except (httpx.RemoteProtocolError, httpx.ConnectError, httpx.ReadError) as exc:
                last_exc = exc

        raise last_exc


_httpx_client = httpx.Client(transport=RetryTransport(retries=3), timeout=30)

supabase = create_client(
    settings.supabase_url,
    settings.supabase_service_role_key,
    options=ClientOptions(httpx_client=_httpx_client),
)
