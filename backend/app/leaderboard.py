from datetime import date, datetime, timedelta, timezone

from .db import supabase, fetch_all
from .friends import list_friend_ids, _current_handicaps, _display_name, create_post

# Handicap bands used to bucket friends into divisions for the monthly
# leaderboard -- adjust here if your club uses different cutoffs.
DIVISION_BANDS = [(9.9, "A"), (18.9, "B")]


def _division_for_handicap(handicap_index: float | None) -> str | None:
    if handicap_index is None:
        return None

    for cutoff, label in DIVISION_BANDS:
        if handicap_index <= cutoff:
            return label

    return "C"


def _month_bounds(month: str | None) -> tuple[date, date, str]:
    if month:
        year, mon = (int(part) for part in month.split("-"))
    else:
        today = datetime.now(timezone.utc).date()
        year, mon = today.year, today.month

    start = date(year, mon, 1)
    end = date(year + 1, 1, 1) if mon == 12 else date(year, mon + 1, 1)

    return start, end, f"{year:04d}-{mon:02d}"


def _circle_profiles(circle_ids: list[str]) -> dict[str, dict]:
    response = (
        supabase
        .table("profiles")
        .select("user_id,display_name,email,surname,nickname,display_preference,avatar_url")
        .in_("user_id", circle_ids)
        .execute()
    )
    return {row["user_id"]: row for row in response.data or []}


def get_monthly_leaderboard(user_id: str, month: str | None = None) -> dict:
    """Ranks each friend (including the caller) within their own division --
    bucketed by current handicap -- by best Stableford round played in the
    given month (defaults to the current month), tie-broken by best gross."""
    start, end, label = _month_bounds(month)
    circle_ids = list(set(list_friend_ids(user_id) + [user_id]))

    scores = fetch_all(
        lambda: supabase
        .table("handicap_scores")
        .select("user_id,adjusted_gross,stableford_points")
        .in_("user_id", circle_ids)
        .gte("play_date", start.isoformat())
        .lt("play_date", end.isoformat())
        .order("id")
    )

    profile_by_user = _circle_profiles(circle_ids)
    handicap_by_user = _current_handicaps(circle_ids)

    stats_by_user: dict[str, dict] = {}

    for score in scores:
        entry = stats_by_user.setdefault(
            score["user_id"], {"rounds_played": 0, "best_gross": None, "best_stableford": None}
        )
        entry["rounds_played"] += 1

        gross = score.get("adjusted_gross")
        if gross is not None:
            entry["best_gross"] = gross if entry["best_gross"] is None else min(entry["best_gross"], gross)

        stableford = score.get("stableford_points")
        if stableford is not None:
            entry["best_stableford"] = (
                stableford if entry["best_stableford"] is None else max(entry["best_stableford"], stableford)
            )

    divisions: dict[str, list[dict]] = {"A": [], "B": [], "C": []}

    for uid, stats in stats_by_user.items():
        division = _division_for_handicap(handicap_by_user.get(uid))
        if division is None:
            continue

        divisions[division].append({
            "user_id": uid,
            "player_name": _display_name(profile_by_user.get(uid)),
            "handicap_index": handicap_by_user.get(uid),
            **stats,
        })

    for entries in divisions.values():
        entries.sort(
            key=lambda entry: (
                -(entry["best_stableford"] if entry["best_stableford"] is not None else -1),
                entry["best_gross"] if entry["best_gross"] is not None else 999,
            )
        )

    return {"month": label, "divisions": divisions}


def _already_posted_for(post_date: date) -> bool:
    response = (
        supabase
        .table("daily_leaderboard_posts")
        .select("post_date")
        .eq("post_date", post_date.isoformat())
        .limit(1)
        .execute()
    )
    return bool(response.data)


def maybe_post_daily_leaderboard(user_id: str) -> None:
    """Called after a handicap sync. Posts a top-3 summary of yesterday's
    rounds (within the syncing user's friend circle) to the Feed, once per
    day total -- the unique constraint on daily_leaderboard_posts.post_date
    is the actual lock, so whichever sync runs first for a given day wins
    and every later sync that day is a fast no-op."""
    yesterday = datetime.now(timezone.utc).date() - timedelta(days=1)

    if _already_posted_for(yesterday):
        return

    circle_ids = list(set(list_friend_ids(user_id) + [user_id]))

    scores = fetch_all(
        lambda: supabase
        .table("handicap_scores")
        .select("user_id,adjusted_gross,stableford_points")
        .in_("user_id", circle_ids)
        .eq("play_date", yesterday.isoformat())
        .order("id")
    )

    try:
        supabase.table("daily_leaderboard_posts").insert({"post_date": yesterday.isoformat()}).execute()
    except Exception:
        # Another sync already claimed today's post -- nothing more to do.
        return

    if not scores:
        return

    profile_by_user = _circle_profiles(circle_ids)

    ranked = sorted(
        scores,
        key=lambda score: (
            -(score["stableford_points"] if score.get("stableford_points") is not None else -1),
            score["adjusted_gross"] if score.get("adjusted_gross") is not None else 999,
        ),
    )[:3]

    medals = ["🥇", "🥈", "🥉"]
    lines = [
        f"{medals[i]} {_display_name(profile_by_user.get(score['user_id']))} — "
        f"{score['stableford_points']} pts ({score['adjusted_gross']} gross)"
        for i, score in enumerate(ranked)
    ]

    create_post(user_id, "⛳ Yesterday's top scores:\n" + "\n".join(lines))
