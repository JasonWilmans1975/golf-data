create table if not exists public.strava_tokens (
  athlete_id bigint primary key,
  access_token text not null,
  refresh_token text not null,
  expires_at bigint not null,
  scope text,
  athlete jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.golf_activities (
  id bigint generated always as identity primary key,
  strava_activity_id bigint unique not null,
  athlete_id bigint not null,
  name text,
  sport_type text,
  start_date timestamptz,
  start_date_local timestamp,
  timezone text,
  distance_m numeric default 0,
  moving_time_s integer default 0,
  elapsed_time_s integer default 0,
  elevation_gain_m numeric default 0,
  start_latlng jsonb,
  end_latlng jsonb,
  map_polyline text,
  raw jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists golf_activities_start_date_idx on public.golf_activities(start_date desc);
create index if not exists golf_activities_athlete_idx on public.golf_activities(athlete_id);

alter table if exists public.courses add column if not exists photo_url text;

insert into storage.buckets (id, name, public)
values ('course-photos', 'course-photos', true)
on conflict (id) do nothing;

create table if not exists public.handicap_snapshots (
  id bigint generated always as identity primary key,
  recorded_at date unique not null,
  handicap_index numeric not null,
  created_at timestamptz default now()
);

create table if not exists public.handicap_scores (
  id bigint generated always as identity primary key,
  score_id bigint unique not null,
  play_date date not null,
  handicap_index numeric,
  hc_diff numeric,
  adjusted_gross integer,
  course_name text,
  stableford_points integer,
  counted_in_handicap boolean default false,
  is_casual_score boolean default false,
  created_at timestamptz default now()
);

create index if not exists handicap_scores_play_date_idx on public.handicap_scores(play_date desc);

alter table if exists public.handicap_scores add column if not exists course_id bigint references public.courses(id);
create index if not exists handicap_scores_course_id_idx on public.handicap_scores(course_id);

alter table if exists public.handicap_scores add column if not exists country_name text;
alter table if exists public.handicap_scores add column if not exists country_flag_url text;

create table if not exists public.handicap_sync_state (
  id integer primary key default 1,
  last_synced_at timestamptz,
  constraint handicap_sync_state_single_row check (id = 1)
);

alter table if exists public.handicap_sync_state add column if not exists current_handicap_index numeric;

-- Multi-user support

alter table if exists public.strava_tokens add column if not exists user_id uuid;
create unique index if not exists strava_tokens_user_id_idx on public.strava_tokens(user_id);

alter table if exists public.golf_activities add column if not exists user_id uuid;
create index if not exists golf_activities_user_id_idx on public.golf_activities(user_id);

alter table if exists public.handicap_scores add column if not exists user_id uuid;
create index if not exists handicap_scores_user_id_idx on public.handicap_scores(user_id);

alter table if exists public.handicap_snapshots add column if not exists user_id uuid;
create index if not exists handicap_snapshots_user_id_idx on public.handicap_snapshots(user_id);

alter table if exists public.handicap_sync_state drop constraint if exists handicap_sync_state_single_row;
alter table if exists public.handicap_sync_state add column if not exists user_id uuid;
delete from public.handicap_sync_state where user_id is null;
alter table if exists public.handicap_sync_state drop constraint if exists handicap_sync_state_pkey;
alter table if exists public.handicap_sync_state add constraint handicap_sync_state_pkey primary key (user_id);
alter table if exists public.handicap_sync_state drop column if exists id;

create table if not exists public.handicap_credentials (
  user_id uuid primary key,
  member_no text not null,
  encrypted_password text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table if exists public.courses add column if not exists country_code text;
alter table if exists public.courses add column if not exists country_name text;

-- Garmin Connect support (additional activity source alongside Strava)

alter table if exists public.golf_activities alter column strava_activity_id drop not null;
alter table if exists public.golf_activities alter column athlete_id drop not null;
alter table if exists public.golf_activities add column if not exists source text not null default 'strava';
alter table if exists public.golf_activities add column if not exists garmin_activity_id bigint;
create unique index if not exists golf_activities_garmin_activity_id_idx on public.golf_activities(garmin_activity_id);

create table if not exists public.garmin_credentials (
  user_id uuid primary key,
  email text not null,
  encrypted_password text not null,
  cached_token text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.garmin_sync_state (
  user_id uuid primary key,
  last_synced_at timestamptz
);
