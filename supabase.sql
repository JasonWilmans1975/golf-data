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

-- Course profile info (website, phone, description, a representative photo)
-- pulled from Google Places Details for each played course.

alter table if exists public.courses add column if not exists website_url text;
alter table if exists public.courses add column if not exists phone_number text;
alter table if exists public.courses add column if not exists description text;
alter table if exists public.courses add column if not exists google_photo_url text;
alter table if exists public.courses add column if not exists details_fetched_at timestamptz;

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

create table if not exists public.garmin_daily_stats (
  user_id uuid not null,
  stat_date date not null,
  total_calories integer,
  active_calories integer,
  resting_calories integer,
  average_heart_rate integer,
  resting_heart_rate integer,
  sleep_score integer,
  sleep_score_qualifier text,
  sleep_seconds integer,
  total_steps integer,
  step_goal integer,
  step_distance_m integer,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  primary key (user_id, stat_date)
);

-- teesheet.co.za support (tee times, account spending/balance)

create table if not exists public.teesheet_credentials (
  user_id uuid primary key,
  club_id integer not null,
  club_name text not null,
  member_id text not null,
  encrypted_password text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.teesheet_sync_state (
  user_id uuid primary key,
  last_synced_at timestamptz,
  current_balance numeric
);

create table if not exists public.teesheet_bookings (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  booking_id bigint,
  play_date date not null,
  play_time text,
  tee text,
  course_name text,
  players jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, play_date, play_time, course_name)
);

create table if not exists public.teesheet_transactions (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  doc_number text not null,
  transaction_at timestamptz,
  description text,
  credit numeric default 0,
  debit numeric default 0,
  created_at timestamptz default now(),
  unique (user_id, doc_number)
);

-- Friends / social feed (first slice): a lightweight profile per auth user
-- (so friends can be found by email and shown by a display name instead of
-- a raw email), plus a friend_requests table that doubles as the
-- friendship record once accepted (avoids a separate friendships table).

create table if not exists public.profiles (
  user_id uuid primary key,
  email text not null,
  display_name text,
  created_at timestamptz default now()
);

create unique index if not exists profiles_email_idx on public.profiles(lower(email));

-- Keep profiles in sync with auth.users automatically for future signups.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (user_id, email, display_name)
  values (new.id, new.email, split_part(new.email, '@', 1))
  on conflict (user_id) do nothing;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Backfill existing users (Jason, Brent, etc.) who signed up before this
-- table existed.
insert into public.profiles (user_id, email, display_name)
select id, email, split_part(email, '@', 1) from auth.users
on conflict (user_id) do nothing;

create table if not exists public.friend_requests (
  id bigint generated always as identity primary key,
  from_user_id uuid not null,
  to_user_id uuid not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (from_user_id, to_user_id)
);

create index if not exists friend_requests_to_user_idx on public.friend_requests(to_user_id);
create index if not exists friend_requests_from_user_idx on public.friend_requests(from_user_id);

-- Let the frontend subscribe directly to friend_requests over Supabase
-- Realtime (instead of polling) so an accepted/declined/new request shows
-- up immediately. This is the one table the frontend talks to directly
-- (everything else stays behind the FastAPI backend + service role key),
-- so it needs its own RLS policy -- Realtime only delivers a row to a
-- subscriber if that row passes RLS for their JWT, otherwise every
-- connected user would see every other user's friend requests.
alter table public.friend_requests enable row level security;

drop policy if exists "Users can view their own friend requests" on public.friend_requests;
create policy "Users can view their own friend requests"
on public.friend_requests
for select
using (auth.uid() = from_user_id or auth.uid() = to_user_id);

do $$
begin
  alter publication supabase_realtime add table public.friend_requests;
exception
  when duplicate_object then null;
end $$;
