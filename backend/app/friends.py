from datetime import datetime, timezone

from .db import supabase, fetch_all


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _display_name(profile: dict | None) -> str:
    if not profile:
        return "A friend"
    return profile.get("display_name") or (profile.get("email") or "").split("@")[0] or "A friend"


def get_profile(user_id: str) -> dict:
    response = (
        supabase.table("profiles").select("user_id,email,display_name").eq("user_id", user_id).limit(1).execute()
    )

    if not response.data:
        return {"user_id": user_id, "email": None, "display_name": None}

    return response.data[0]


def update_display_name(user_id: str, display_name: str) -> dict:
    display_name = display_name.strip()

    if not display_name:
        raise ValueError("Display name can't be empty")

    supabase.table("profiles").update({"display_name": display_name}).eq("user_id", user_id).execute()

    return {"display_name": display_name}


def _find_relationship(user_id: str, other_user_id: str) -> dict | None:
    response = (
        supabase
        .table("friend_requests")
        .select("*")
        .or_(
            f"and(from_user_id.eq.{user_id},to_user_id.eq.{other_user_id}),"
            f"and(from_user_id.eq.{other_user_id},to_user_id.eq.{user_id})"
        )
        .execute()
    )

    rows = response.data or []
    return rows[0] if rows else None


def send_friend_request(user_id: str, email: str) -> dict:
    email = email.strip().lower()

    profile_response = (
        supabase.table("profiles").select("user_id,display_name,email").ilike("email", email).limit(1).execute()
    )

    if not profile_response.data:
        raise ValueError("No Golf Journey account found for that email")

    target_id = profile_response.data[0]["user_id"]

    if target_id == user_id:
        raise ValueError("You can't add yourself as a friend")

    existing = _find_relationship(user_id, target_id)

    if existing:
        if existing["status"] == "accepted":
            raise ValueError("You're already friends")

        if existing["from_user_id"] == target_id and existing["status"] == "pending":
            # They'd already asked us -- accept instead of creating a duplicate.
            supabase.table("friend_requests").update(
                {"status": "accepted", "updated_at": _now()}
            ).eq("id", existing["id"]).execute()
            return {"status": "accepted"}

        if existing["from_user_id"] == user_id and existing["status"] == "pending":
            raise ValueError("Friend request already sent")

        # Previously declined -- allow re-sending.
        supabase.table("friend_requests").update({
            "from_user_id": user_id,
            "to_user_id": target_id,
            "status": "pending",
            "updated_at": _now(),
        }).eq("id", existing["id"]).execute()
        return {"status": "pending"}

    supabase.table("friend_requests").insert({
        "from_user_id": user_id,
        "to_user_id": target_id,
        "status": "pending",
    }).execute()

    return {"status": "pending"}


def list_incoming_requests(user_id: str) -> list[dict]:
    response = (
        supabase
        .table("friend_requests")
        .select("id,from_user_id,created_at")
        .eq("to_user_id", user_id)
        .eq("status", "pending")
        .order("created_at", desc=True)
        .execute()
    )

    requests = response.data or []

    if not requests:
        return []

    profiles_response = (
        supabase
        .table("profiles")
        .select("user_id,display_name,email")
        .in_("user_id", [row["from_user_id"] for row in requests])
        .execute()
    )
    profile_by_user = {row["user_id"]: row for row in profiles_response.data or []}

    return [
        {
            "id": row["id"],
            "from_user_id": row["from_user_id"],
            "display_name": _display_name(profile_by_user.get(row["from_user_id"])),
            "created_at": row["created_at"],
        }
        for row in requests
    ]


def respond_to_request(user_id: str, request_id: int, accept: bool) -> dict:
    response = supabase.table("friend_requests").select("*").eq("id", request_id).limit(1).execute()

    if not response.data:
        raise ValueError("Friend request not found")

    row = response.data[0]

    if row["to_user_id"] != user_id:
        raise ValueError("Friend request not found")

    if row["status"] != "pending":
        raise ValueError("Friend request already handled")

    status = "accepted" if accept else "declined"
    supabase.table("friend_requests").update({"status": status, "updated_at": _now()}).eq("id", request_id).execute()

    return {"status": status}


def _accepted_relationship_rows(user_id: str) -> list[dict]:
    response = (
        supabase
        .table("friend_requests")
        .select("id,from_user_id,to_user_id,updated_at")
        .eq("status", "accepted")
        .or_(f"from_user_id.eq.{user_id},to_user_id.eq.{user_id}")
        .execute()
    )

    return response.data or []


def list_friend_ids(user_id: str) -> list[str]:
    rows = _accepted_relationship_rows(user_id)

    return [
        row["to_user_id"] if row["from_user_id"] == user_id else row["from_user_id"]
        for row in rows
    ]


def _current_handicaps(friend_ids: list[str]) -> dict[str, float | None]:
    response = (
        supabase
        .table("handicap_sync_state")
        .select("user_id,current_handicap_index")
        .in_("user_id", friend_ids)
        .execute()
    )

    return {row["user_id"]: row["current_handicap_index"] for row in response.data or []}


def _home_courses(friend_ids: list[str]) -> dict[str, str | None]:
    scores = fetch_all(
        lambda: supabase
        .table("handicap_scores")
        .select("user_id,course_id")
        .in_("user_id", friend_ids)
        .not_.is_("course_id", "null")
        .order("id")
    )

    counts_by_user: dict[str, dict[int, int]] = {}

    for row in scores:
        course_counts = counts_by_user.setdefault(row["user_id"], {})
        course_counts[row["course_id"]] = course_counts.get(row["course_id"], 0) + 1

    top_course_id_by_user = {
        user_id: max(course_counts, key=course_counts.get)
        for user_id, course_counts in counts_by_user.items()
    }

    course_ids = list(set(top_course_id_by_user.values()))
    course_name_by_id = {}

    if course_ids:
        courses_response = supabase.table("courses").select("id,name").in_("id", course_ids).execute()
        course_name_by_id = {row["id"]: row["name"] for row in courses_response.data or []}

    return {
        user_id: course_name_by_id.get(course_id)
        for user_id, course_id in top_course_id_by_user.items()
    }


def list_friends(user_id: str) -> list[dict]:
    rows = _accepted_relationship_rows(user_id)

    if not rows:
        return []

    friend_ids = [
        row["to_user_id"] if row["from_user_id"] == user_id else row["from_user_id"]
        for row in rows
    ]

    profiles_response = (
        supabase.table("profiles").select("user_id,display_name,email").in_("user_id", friend_ids).execute()
    )
    profile_by_user = {row["user_id"]: row for row in profiles_response.data or []}
    handicap_by_user = _current_handicaps(friend_ids)
    home_course_by_user = _home_courses(friend_ids)

    friends = []
    for row in rows:
        friend_id = row["to_user_id"] if row["from_user_id"] == user_id else row["from_user_id"]
        friends.append({
            "user_id": friend_id,
            "display_name": _display_name(profile_by_user.get(friend_id)),
            "friends_since": row["updated_at"],
            "current_handicap_index": handicap_by_user.get(friend_id),
            "home_course_name": home_course_by_user.get(friend_id),
        })

    return friends


def remove_friend(user_id: str, friend_user_id: str) -> None:
    (
        supabase
        .table("friend_requests")
        .delete()
        .eq("status", "accepted")
        .or_(
            f"and(from_user_id.eq.{user_id},to_user_id.eq.{friend_user_id}),"
            f"and(from_user_id.eq.{friend_user_id},to_user_id.eq.{user_id})"
        )
        .execute()
    )


def get_friends_feed(user_id: str, limit: int = 30) -> list[dict]:
    friend_ids = list_friend_ids(user_id)

    if not friend_ids:
        return []

    scores_response = (
        supabase
        .table("handicap_scores")
        .select(
            "score_id,user_id,play_date,adjusted_gross,stableford_points,"
            "course_id,course_name,country_name,country_flag_url"
        )
        .in_("user_id", friend_ids)
        .order("play_date", desc=True)
        .limit(limit)
        .execute()
    )
    scores = scores_response.data or []

    if not scores:
        return []

    profiles_response = (
        supabase
        .table("profiles")
        .select("user_id,display_name,email")
        .in_("user_id", list({score["user_id"] for score in scores}))
        .execute()
    )
    profile_by_user = {row["user_id"]: row for row in profiles_response.data or []}

    course_ids = [score["course_id"] for score in scores if score.get("course_id")]
    course_by_id = {}

    if course_ids:
        courses_response = (
            supabase
            .table("courses")
            .select("id,name,photo_url,google_photo_url,city,country_name")
            .in_("id", list(set(course_ids)))
            .execute()
        )
        course_by_id = {row["id"]: row for row in courses_response.data or []}

    feed = []
    for score in scores:
        course = course_by_id.get(score.get("course_id"), {})
        feed.append({
            "score_id": score["score_id"],
            "user_id": score["user_id"],
            "player_name": _display_name(profile_by_user.get(score["user_id"])),
            "play_date": score["play_date"],
            "adjusted_gross": score.get("adjusted_gross"),
            "stableford_points": score.get("stableford_points"),
            "course_name": course.get("name") or score.get("course_name"),
            "course_photo_url": course.get("photo_url") or course.get("google_photo_url"),
            "country_name": score.get("country_name") or course.get("country_name"),
            "country_flag_url": score.get("country_flag_url"),
        })

    return feed
