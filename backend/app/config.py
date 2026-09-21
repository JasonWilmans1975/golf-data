from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    strava_client_id: str
    strava_client_secret: str
    strava_redirect_uri: str = "http://localhost:8000/auth/strava/callback"
    frontend_url: str = "http://localhost:5173"
    app_url: str = "http://localhost:5173"
    supabase_url: str
    supabase_service_role_key: str
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()
