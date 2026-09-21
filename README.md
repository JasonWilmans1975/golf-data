# Golf Journey — Strava-powered golf dashboard

Starter MVP: FastAPI + React/Vite + Supabase.

## What works
- Connect your Strava account with OAuth.
- Refresh short-lived Strava access tokens automatically.
- Import historical activities and keep only `Golf` activities.
- Store raw Strava JSON plus useful fields in Supabase.
- Dashboard for rounds, distance walked, elevation and moving time.
- Recent rounds table and rounds-over-time graph.

## 1. Create the Supabase tables
Create a Supabase project, open SQL Editor, and run `supabase.sql`.

## 2. Create your Strava application
Open Strava API settings and create an application.
For local development set the Authorization Callback Domain to `localhost`.
Copy Client ID + Client Secret.

## 3. Backend
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Fill in Strava + Supabase values
uvicorn app.main:app --reload --port 8000
```

## 4. Frontend
```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```
Open http://localhost:5173 and click **Sync Strava**. If no Strava token exists yet, you will be redirected through Strava OAuth.

## Next build phase
1. Course recognition from GPS track / start coordinates.
2. Course table with canonical course names and locations.
3. Map of every course played.
4. Course detail pages with round history.
5. Year/country/course filters and richer charts.
6. Strava webhook so new rounds sync automatically.

## API notes
This starter uses Strava web OAuth at `https://www.strava.com/oauth/authorize`, token exchange at `https://www.strava.com/oauth/token`, and the 2026 API base `https://api-v3.strava.com`.
