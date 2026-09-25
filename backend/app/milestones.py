from .db import supabase, fetch_all
from .courses import get_courses_for_user, get_countries_played
from .friends import create_post

ROUND_THRESHOLDS = [10, 25, 50, 100, 250, 500]
COURSE_THRESHOLDS = [10, 25, 50, 100]
COUNTRY_THRESHOLDS = [3, 5, 10, 15, 25]


def _already_earned(user_id: str, badge_key: str) -> bool:
    response = (
        supabase
        .table("milestones")
        .select("id")
        .eq("user_id", user_id)
        .eq("badge_key", badge_key)
        .limit(1)
        .execute()
    )

    return bool(response.data)


def _award(user_id: str, badge_key: str, message: str) -> None:
    if _already_earned(user_id, badge_key):
        return

    try:
        supabase.table("milestones").insert({"user_id": user_id, "badge_key": badge_key}).execute()
    except Exception:
        # Unique constraint hit (e.g. a concurrent sync already awarded it) --
        # nothing to do.
        return

    create_post(user_id, f"🏆 {message}")


def check_and_award_milestones(user_id: str) -> None:
    """Called after a handicap sync brings in new data. Cheap to re-run --
    _award() no-ops instantly for anything already earned, and thresholds
    only ever fire once each thanks to the unique (user_id, badge_key)
    constraint on public.milestones."""
    scores = fetch_all(
        lambda: supabase
        .table("handicap_scores")
        .select("adjusted_gross,stableford_points,handicap_index,counted_in_handicap,is_nine_hole")
        .eq("user_id", user_id)
        .order("id")
    )

    round_count = len(scores)

    for threshold in ROUND_THRESHOLDS:
        if round_count >= threshold:
            _award(user_id, f"rounds_{threshold}", f"just played their {threshold}th round of golf!")

    # "Personal best" only makes sense against full 18-hole rounds that
    # actually count towards your handicap -- a casual round, a short par-3
    # course (counted_in_handicap=false), or a 9-hole round (naturally a
    # much lower gross/Stableford number than 18 holes) all produce figures
    # that aren't comparable to a real round, which showed up as nonsense
    # "personal best" posts before these filters existed.
    counting_scores = [s for s in scores if s.get("counted_in_handicap") and not s.get("is_nine_hole")]

    grosses = [s["adjusted_gross"] for s in counting_scores if s.get("adjusted_gross") is not None]
    if grosses:
        best_gross = min(grosses)
        _award(user_id, f"best_gross_{best_gross}", f"shot a new personal best round: {best_gross}!")

    stablefords = [s["stableford_points"] for s in counting_scores if s.get("stableford_points") is not None]
    if stablefords:
        best_stableford = max(stablefords)
        _award(
            user_id,
            f"best_stableford_{best_stableford}",
            f"scored a new personal best of {best_stableford} Stableford points!",
        )

    handicaps = [s["handicap_index"] for s in counting_scores if s.get("handicap_index") is not None]
    if handicaps:
        best_handicap = round(min(handicaps), 1)
        _award(user_id, f"best_handicap_{best_handicap}", f"reached a new personal-best handicap of {best_handicap}!")

    course_count = len(get_courses_for_user(user_id))

    for threshold in COURSE_THRESHOLDS:
        if course_count >= threshold:
            _award(
                user_id,
                f"courses_{threshold}",
                f"has now played {threshold} different golf courses!",
            )

    country_count = len(get_countries_played(user_id))

    for threshold in COUNTRY_THRESHOLDS:
        if country_count >= threshold:
            _award(
                user_id,
                f"countries_{threshold}",
                f"has now played golf in {threshold} different countries!",
            )
