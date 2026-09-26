from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    strava_client_id: str
    strava_client_secret: str
    strava_redirect_uri: str = "https://api.slogs.co.za/auth/strava/callback"
    # Comma-separated so both slogs.co.za/handicap and golfcircle.me can be
    # live at once, sharing this one backend -- update the FRONTEND_URL env
    # var's value (not its name) to add a domain, no code change needed.
    frontend_url: str = "https://slogs.co.za"
    app_url: str = "https://slogs.co.za/handicap"

    @property
    def frontend_urls(self) -> list[str]:
        return [url.strip() for url in self.frontend_url.split(",") if url.strip()]
    supabase_url: str
    supabase_service_role_key: str
    # Optional (default empty) so a deploy never crashes for lacking it --
    # /internal/sync-all treats an empty secret as "not configured yet" and
    # refuses every request rather than silently accepting an empty header.
    cron_secret: str = ""
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()
