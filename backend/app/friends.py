import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from .db import supabase, fetch_all, execute_with_retry


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _display_name(profile: dict | None) -> str:
    if not profile:
        return "A friend"

    if profile.get("display_preference") == "nickname" and profile.get("nickname"):
        return profile["nickname"]

    full_name = " ".join(filter(None, [profile.get("display_name"), profile.get("surname")])).strip()

    return full_name or profile.get("nickname") or (profile.get("email") or "").split("@")[0] or "A friend"


def _avatar_url(profile: dict | None) -> str | None:
    return profile.get("avatar_url") if profile else None


def _post_became_friends(user_id: str, other_user_id: str) -> None:
    """Posted under the person taking the accepting action right now (same
    convention as tournament-joined posts) -- not is_system_generated, since
    becoming friends is a real decision by a real person, not an automated
    summary."""
    other_profile_response = (
        supabase
        .table("profiles")
        .select("display_name,email,surname,nickname,display_preference")
        .eq("user_id", other_user_id)
        .limit(1)
        .execute()
    )
    other_profile = other_profile_response.data[0] if other_profile_response.data else None

    create_post(user_id, f"🤝 became friends with {_display_name(other_profile)}!")


SYSTEM_POSTER_NAME = "GolfCircle"


def _post_identity(post: dict, profile: dict | None) -> tuple[str, str | None]:
    """post.user_id still owns the post for visibility/permissions -- this
    only decides what the Feed *displays* as the author. is_system_generated
    posts (the daily leaderboard, tournament results) name the real players
    in their own body text already, so whoever's sync happened to trigger
    the post is incidental and shown as "GolfCircle" instead."""
    if post.get("is_system_generated"):
        return SYSTEM_POSTER_NAME, None

    return _display_name(profile), _avatar_url(profile)


PROFILE_FIELDS = (
    "user_id,email,display_name,surname,nickname,phone,country,province,"
    "date_of_birth,sex,avatar_url,display_preference,newsletter_opt_in,sponsor_opt_in"
)


def get_profile(user_id: str) -> dict:
    response = execute_with_retry(
        lambda: supabase.table("profiles").select(PROFILE_FIELDS).eq("user_id", user_id).limit(1)
    )

    if not response.data:
        return {"user_id": user_id, "email": None, "display_name": None}

    return response.data[0]


PROFILE_EDITABLE_FIELDS = {
    "display_name", "surname", "nickname", "phone", "country", "province",
    "date_of_birth", "sex", "avatar_url", "display_preference",
    "newsletter_opt_in", "sponsor_opt_in",
}


def update_profile(user_id: str, fields: dict) -> dict:
    updates = {key: value for key, value in fields.items() if key in PROFILE_EDITABLE_FIELDS}

    if "display_name" in updates:
        updates["display_name"] = (updates["display_name"] or "").strip()
        if not updates["display_name"]:
            raise ValueError("Name can't be empty")

    if "display_preference" in updates and updates["display_preference"] not in ("name", "nickname"):
        raise ValueError("Invalid display preference")

    if not updates:
        return get_profile(user_id)

    supabase.table("profiles").update(updates).eq("user_id", user_id).execute()

    return get_profile(user_id)


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


def _relationship_status_map(user_id: str) -> dict[str, str]:
    relationships_response = (
        supabase
        .table("friend_requests")
        .select("from_user_id,to_user_id,status")
        .or_(f"from_user_id.eq.{user_id},to_user_id.eq.{user_id}")
        .execute()
    )

    status_by_other: dict[str, str] = {}
    for rel in relationships_response.data or []:
        other = rel["to_user_id"] if rel["from_user_id"] == user_id else rel["from_user_id"]

        if rel["status"] == "accepted":
            status_by_other[other] = "friends"
        elif rel["status"] == "pending":
            status_by_other[other] = "pending_sent" if rel["from_user_id"] == user_id else "pending_received"

    return status_by_other


def search_users(user_id: str, query: str, limit: int = 20) -> list[dict]:
    """Powers add-a-friend search -- anyone signed up should be findable by
    name/nickname/email, not just by typing their exact email address."""
    # Commas/parens would corrupt the .or_() filter string below (postgrest
    # reads them as filter separators), and neither is meaningful in a
    # person's name/email anyway.
    query = re.sub(r"[,()]", "", query).strip()

    if len(query) < 2:
        return []

    pattern = f"%{query}%"

    response = (
        supabase
        .table("profiles")
        .select("user_id,display_name,email,surname,nickname,display_preference,avatar_url")
        .neq("user_id", user_id)
        .or_(f"display_name.ilike.{pattern},nickname.ilike.{pattern},surname.ilike.{pattern},email.ilike.{pattern}")
        .limit(limit)
        .execute()
    )
    rows = response.data or []

    if not rows:
        return []

    status_by_other = _relationship_status_map(user_id)

    return [
        {
            "user_id": row["user_id"],
            "display_name": _display_name(row),
            "avatar_url": _avatar_url(row),
            "relationship": status_by_other.get(row["user_id"], "none"),
        }
        for row in rows
    ]


def get_teesheet_buddies_not_friends(user_id: str) -> list[dict]:
    """Your real teesheet.co.za buddy list, minus anyone already a GolfCircle
    friend -- so you can see who from your real-world circle hasn't
    connected yet, whether or not they're even on GolfCircle at all."""
    my_credentials = (
        supabase
        .table("teesheet_credentials")
        .select("club_id")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )

    if not my_credentials.data:
        return []

    club_id = my_credentials.data[0]["club_id"]

    buddy_rows = (
        supabase
        .table("teesheet_buddies")
        .select("buddy_member_no,buddy_first_name,buddy_last_name")
        .eq("user_id", user_id)
        .order("buddy_last_name")
        .execute()
    )
    buddies = buddy_rows.data or []

    if not buddies:
        return []

    member_nos = [b["buddy_member_no"] for b in buddies]

    matches_response = (
        supabase
        .table("teesheet_credentials")
        .select("user_id,club_number")
        .eq("club_id", club_id)
        .in_("club_number", member_nos)
        .execute()
    )
    user_id_by_club_number = {
        row["club_number"]: row["user_id"] for row in matches_response.data or [] if row["user_id"] != user_id
    }

    profile_by_user = {}
    if user_id_by_club_number:
        profiles_response = (
            supabase
            .table("profiles")
            .select("user_id,display_name,email,surname,nickname,display_preference,avatar_url")
            .in_("user_id", list(user_id_by_club_number.values()))
            .execute()
        )
        profile_by_user = {row["user_id"]: row for row in profiles_response.data or []}

    status_by_other = _relationship_status_map(user_id)

    results = []
    for buddy in buddies:
        other_id = user_id_by_club_number.get(buddy["buddy_member_no"])
        relationship = status_by_other.get(other_id, "none") if other_id else None

        if relationship == "friends":
            continue

        name = f'{buddy.get("buddy_first_name") or ""} {buddy.get("buddy_last_name") or ""}'.strip()

        results.append({
            "buddy_name": name or "Unknown",
            "on_golfcircle": other_id is not None,
            "user_id": other_id,
            "display_name": _display_name(profile_by_user.get(other_id)) if other_id else None,
            "avatar_url": _avatar_url(profile_by_user.get(other_id)) if other_id else None,
            "relationship": relationship,
        })

    return results


def auto_friend_teesheet_buddies(user_id: str, club_id: int, buddy_member_nos: list[str]) -> int:
    """Teesheet buddies are real-world frequent playing partners -- if one is
    also a GolfCircle user at the same club, connect them directly rather
    than waiting for either person to notice and add the other. Returns how
    many new connections were made."""
    if not buddy_member_nos:
        return 0

    matches_response = (
        supabase
        .table("teesheet_credentials")
        .select("user_id")
        .eq("club_id", club_id)
        .in_("club_number", buddy_member_nos)
        .neq("user_id", user_id)
        .execute()
    )
    matched_user_ids = [row["user_id"] for row in matches_response.data or []]

    connected = 0

    for other_id in matched_user_ids:
        existing = _find_relationship(user_id, other_id)

        if existing and existing["status"] in ("accepted", "declined"):
            # Already friends, or someone explicitly declined before --
            # never override a real decision either way.
            continue

        if existing and existing["status"] == "pending":
            supabase.table("friend_requests").update(
                {"status": "accepted", "updated_at": _now()}
            ).eq("id", existing["id"]).execute()
        else:
            supabase.table("friend_requests").insert({
                "from_user_id": user_id,
                "to_user_id": other_id,
                "status": "accepted",
            }).execute()

        connected += 1

    return connected


def _send_friend_request_to(user_id: str, target_id: str) -> dict:
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
            _post_became_friends(user_id, target_id)
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


def send_friend_request(user_id: str, email: str) -> dict:
    email = email.strip().lower()

    profile_response = (
        supabase.table("profiles").select("user_id").ilike("email", email).limit(1).execute()
    )

    if not profile_response.data:
        raise ValueError("No Golf Journey account found for that email")

    return _send_friend_request_to(user_id, profile_response.data[0]["user_id"])


def send_friend_request_by_id(user_id: str, target_id: str) -> dict:
    return _send_friend_request_to(user_id, target_id)


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
        .select("user_id,display_name,email,surname,nickname,display_preference,avatar_url")
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


def list_sent_requests(user_id: str) -> list[dict]:
    response = (
        supabase
        .table("friend_requests")
        .select("id,to_user_id,created_at")
        .eq("from_user_id", user_id)
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
        .select("user_id,display_name,email,surname,nickname,display_preference,avatar_url")
        .in_("user_id", [row["to_user_id"] for row in requests])
        .execute()
    )
    profile_by_user = {row["user_id"]: row for row in profiles_response.data or []}

    return [
        {
            "id": row["id"],
            "to_user_id": row["to_user_id"],
            "display_name": _display_name(profile_by_user.get(row["to_user_id"])),
            "created_at": row["created_at"],
        }
        for row in requests
    ]


def cancel_sent_request(user_id: str, request_id: int) -> None:
    response = supabase.table("friend_requests").select("id,from_user_id,status").eq("id", request_id).limit(1).execute()

    if not response.data:
        raise ValueError("Friend request not found")

    row = response.data[0]

    if row["from_user_id"] != user_id or row["status"] != "pending":
        raise ValueError("Friend request not found")

    supabase.table("friend_requests").delete().eq("id", request_id).execute()


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

    if accept:
        _post_became_friends(user_id, row["from_user_id"])

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
    # home_course_id is computed once per handicap sync (see
    # handicap.py::_compute_home_course_id) rather than re-aggregated from
    # full score history on every friends-list read.
    state_response = (
        supabase
        .table("handicap_sync_state")
        .select("user_id,home_course_id")
        .in_("user_id", friend_ids)
        .not_.is_("home_course_id", "null")
        .execute()
    )
    top_course_id_by_user = {row["user_id"]: row["home_course_id"] for row in state_response.data or []}

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
        supabase.table("profiles").select("user_id,display_name,email,surname,nickname,display_preference,avatar_url").in_("user_id", friend_ids).execute()
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
            "avatar_url": _avatar_url(profile_by_user.get(friend_id)),
            "friends_since": row["updated_at"],
            "current_handicap_index": handicap_by_user.get(friend_id),
            "home_course_name": home_course_by_user.get(friend_id),
        })

    return friends


def get_friend_profile(viewer_id: str, friend_id: str) -> dict:
    """Powers the clickable-avatar popover from a mention, a comment, or a
    tournament's participant list -- same "friends only" visibility as
    everything else, since it's still someone's identity being looked up."""
    if friend_id != viewer_id and friend_id not in list_friend_ids(viewer_id):
        raise ValueError("Not found")

    response = (
        supabase
        .table("profiles")
        .select("user_id,display_name,email,surname,nickname,display_preference,avatar_url")
        .eq("user_id", friend_id)
        .limit(1)
        .execute()
    )
    profile_row = response.data[0] if response.data else None

    return {
        "user_id": friend_id,
        "display_name": _display_name(profile_row),
        "avatar_url": _avatar_url(profile_row),
        "current_handicap_index": _current_handicaps([friend_id]).get(friend_id),
        "home_course_name": _home_courses([friend_id]).get(friend_id),
    }


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


def _comment_counts(items: list[tuple[str, int]]) -> dict[tuple[str, int], int]:
    if not items:
        return {}

    response = (
        supabase
        .table("feed_comments")
        .select("item_type,item_id")
        .in_("item_type", list({item_type for item_type, _ in items}))
        .in_("item_id", list({item_id for _, item_id in items}))
        .execute()
    )

    valid = set(items)
    counts: dict[tuple[str, int], int] = {}

    for row in response.data or []:
        key = (row["item_type"], row["item_id"])
        if key in valid:
            counts[key] = counts.get(key, 0) + 1

    return counts


REACTIONS = {"like", "love", "haha", "wow", "sad", "angry"}


def _empty_reactions() -> dict:
    return {"counts": {}, "total": 0, "my_reaction": None, "reactor_ids": [], "recent_reactor_names": []}


def _reaction_summary(viewer_id: str, items: list[tuple[str, int]]) -> dict[tuple[str, int], dict]:
    if not items:
        return {}

    response = (
        supabase
        .table("feed_likes")
        .select("item_type,item_id,user_id,reaction,created_at")
        .in_("item_type", list({item_type for item_type, _ in items}))
        .in_("item_id", list({item_id for _, item_id in items}))
        .order("created_at", desc=True)
        .execute()
    )

    valid = set(items)
    summary: dict[tuple[str, int], dict] = {}

    for row in response.data or []:
        key = (row["item_type"], row["item_id"])

        if key not in valid:
            continue

        entry = summary.setdefault(key, _empty_reactions())
        entry["counts"][row["reaction"]] = entry["counts"].get(row["reaction"], 0) + 1
        entry["total"] += 1

        if len(entry["reactor_ids"]) < 5:
            entry["reactor_ids"].append(row["user_id"])

        if row["user_id"] == viewer_id:
            entry["my_reaction"] = row["reaction"]

    return summary


def _reactor_names(viewer_id: str, reactions: dict, profile_by_user: dict[str, dict]) -> list[str]:
    return [
        "You" if uid == viewer_id else _display_name(profile_by_user.get(uid))
        for uid in reactions.get("reactor_ids", [])
    ]


def _attach_recent_reactor_names(
    viewer_id: str, reactions_by_item: dict[tuple[str, int], dict], profile_by_user: dict[str, dict]
) -> None:
    """Fills in `recent_reactor_names` for a batch of reaction summaries,
    fetching any reactor profiles not already present (e.g. a friend who
    reacted but doesn't own any item on this page)."""
    missing_ids = {
        uid
        for reactions in reactions_by_item.values()
        for uid in reactions.get("reactor_ids", [])
        if uid not in profile_by_user
    }

    if missing_ids:
        response = (
            supabase
            .table("profiles")
            .select("user_id,display_name,email,surname,nickname,display_preference,avatar_url")
            .in_("user_id", list(missing_ids))
            .execute()
        )
        profile_by_user.update({row["user_id"]: row for row in response.data or []})

    for reactions in reactions_by_item.values():
        reactions["recent_reactor_names"] = _reactor_names(viewer_id, reactions, profile_by_user)


def _resolve_reactable_owner(item_type: str, item_id: int) -> str | None:
    if item_type == "comment":
        comment_response = (
            supabase.table("feed_comments").select("item_type,item_id").eq("id", item_id).limit(1).execute()
        )

        if not comment_response.data:
            return None

        parent = comment_response.data[0]
        return _item_owner(parent["item_type"], parent["item_id"])

    if item_type in ("round", "post"):
        return _item_owner(item_type, item_id)

    if item_type == "story":
        story_response = supabase.table("stories").select("user_id").eq("id", item_id).limit(1).execute()
        return story_response.data[0]["user_id"] if story_response.data else None

    raise ValueError("Invalid item type")


def toggle_reaction(user_id: str, item_type: str, item_id: int, reaction: str) -> dict:
    if reaction not in REACTIONS:
        raise ValueError("Invalid reaction")

    owner_id = _resolve_reactable_owner(item_type, item_id)

    if owner_id is None or not _can_view_item(user_id, owner_id):
        raise ValueError("Not found")

    existing = (
        supabase
        .table("feed_likes")
        .select("id,reaction")
        .eq("item_type", item_type)
        .eq("item_id", item_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )

    if existing.data:
        current = existing.data[0]

        if current["reaction"] == reaction:
            supabase.table("feed_likes").delete().eq("id", current["id"]).execute()
            return {"reaction": None}

        supabase.table("feed_likes").update({"reaction": reaction}).eq("id", current["id"]).execute()
        return {"reaction": reaction}

    supabase.table("feed_likes").insert({
        "item_type": item_type,
        "item_id": item_id,
        "user_id": user_id,
        "reaction": reaction,
    }).execute()

    return {"reaction": reaction}


def get_item_reactions(user_id: str, item_type: str, item_id: int) -> dict:
    summary = _reaction_summary(user_id, [(item_type, item_id)])
    reactions = summary.get((item_type, item_id), _empty_reactions())
    _attach_recent_reactor_names(user_id, {(item_type, item_id): reactions}, {})
    return reactions


def get_item_reaction_details(user_id: str, item_type: str, item_id: int) -> list[dict]:
    """Powers the 'who reacted, with what' popup -- same visibility rule as
    reacting itself, just the individual rows instead of the aggregate
    counts get_item_reactions returns."""
    owner_id = _resolve_reactable_owner(item_type, item_id)

    if owner_id is None or not _can_view_item(user_id, owner_id):
        raise ValueError("Not found")

    response = (
        supabase
        .table("feed_likes")
        .select("user_id,reaction,created_at")
        .eq("item_type", item_type)
        .eq("item_id", item_id)
        .order("created_at", desc=True)
        .execute()
    )
    rows = response.data or []

    if not rows:
        return []

    profiles_response = (
        supabase
        .table("profiles")
        .select("user_id,display_name,email,surname,nickname,display_preference,avatar_url")
        .in_("user_id", [row["user_id"] for row in rows])
        .execute()
    )
    profile_by_user = {row["user_id"]: row for row in profiles_response.data or []}

    return [
        {
            "user_id": row["user_id"],
            "display_name": _display_name(profile_by_user.get(row["user_id"])),
            "avatar_url": _avatar_url(profile_by_user.get(row["user_id"])),
            "reaction": row["reaction"],
        }
        for row in rows
    ]


def _snapshot_item(item_type: str, item_id: int) -> dict | None:
    if item_type == "round":
        response = (
            supabase
            .table("handicap_scores")
            .select("score_id,user_id,play_date,adjusted_gross,stableford_points,course_id,course_name")
            .eq("score_id", item_id)
            .limit(1)
            .execute()
        )

        if not response.data:
            return None

        score = response.data[0]
        course = {}

        if score.get("course_id"):
            course_response = (
                supabase
                .table("courses")
                .select("name,photo_url,google_photo_url,phone_number")
                .eq("id", score["course_id"])
                .limit(1)
                .execute()
            )
            if course_response.data:
                course = course_response.data[0]

        profile_response = (
            supabase.table("profiles").select("display_name,email,surname,nickname,display_preference,avatar_url").eq("user_id", score["user_id"]).limit(1).execute()
        )
        profile = profile_response.data[0] if profile_response.data else None

        return {
            "item_type": "round",
            "item_id": score["score_id"],
            "user_id": score["user_id"],
            "player_name": _display_name(profile),
            "player_avatar_url": _avatar_url(profile),
            "posted_at": score["play_date"],
            "body": None,
            "photo_url": None,
            "photo_urls": [],
            "course_name": course.get("name") or score.get("course_name"),
            "course_photo_url": course.get("photo_url") or course.get("google_photo_url"),
            "course_phone": course.get("phone_number"),
            "adjusted_gross": score.get("adjusted_gross"),
            "stableford_points": score.get("stableford_points"),
        }

    if item_type == "post":
        response = (
            supabase
            .table("posts")
            .select("id,user_id,body,photo_url,created_at,is_system_generated,course_id")
            .eq("id", item_id)
            .limit(1)
            .execute()
        )

        if not response.data:
            return None

        post = response.data[0]
        profile_response = (
            supabase.table("profiles").select("display_name,email,surname,nickname,display_preference,avatar_url").eq("user_id", post["user_id"]).limit(1).execute()
        )
        profile = profile_response.data[0] if profile_response.data else None
        player_name, player_avatar_url = _post_identity(post, profile)

        course = {}
        if post.get("course_id"):
            course_response = (
                supabase
                .table("courses")
                .select("name,photo_url,google_photo_url,phone_number")
                .eq("id", post["course_id"])
                .limit(1)
                .execute()
            )
            if course_response.data:
                course = course_response.data[0]

        photo_urls = _photos_by_post_id([post["id"]]).get(post["id"]) or (
            [post["photo_url"]] if post.get("photo_url") else []
        )

        return {
            "item_type": "post",
            "item_id": post["id"],
            "user_id": post["user_id"],
            "player_name": player_name,
            "player_avatar_url": player_avatar_url,
            "posted_at": post["created_at"],
            "body": post["body"],
            "photo_url": post.get("photo_url"),
            "photo_urls": photo_urls,
            "course_name": course.get("name"),
            "course_photo_url": course.get("photo_url") or course.get("google_photo_url"),
            "course_phone": course.get("phone_number"),
            "adjusted_gross": None,
            "stableford_points": None,
        }

    return None


def _build_rounds_feed(viewer_id: str, user_ids: list[str], limit: int) -> list[dict]:
    scores_response = (
        supabase
        .table("handicap_scores")
        .select(
            "score_id,user_id,play_date,adjusted_gross,stableford_points,"
            "course_id,course_name,country_name,country_flag_url"
        )
        .in_("user_id", user_ids)
        .eq("hidden_from_feed", False)
        .order("play_date", desc=True)
        .limit(limit)
        .execute()
    )
    scores = scores_response.data or []

    if not scores:
        return []

    course_ids = list({score["course_id"] for score in scores if score.get("course_id")})
    user_ids_seen = list({score["user_id"] for score in scores})
    round_pairs = [("round", score["score_id"]) for score in scores]

    def _fetch_profiles():
        response = (
            supabase.table("profiles").select("user_id,display_name,email,surname,nickname,display_preference,avatar_url").in_("user_id", user_ids_seen).execute()
        )
        return {row["user_id"]: row for row in response.data or []}

    def _fetch_courses():
        if not course_ids:
            return {}
        response = (
            supabase
            .table("courses")
            .select("id,name,photo_url,google_photo_url,city,country_name,phone_number")
            .in_("id", course_ids)
            .execute()
        )
        return {row["id"]: row for row in response.data or []}

    # These four queries are all independent (each only depends on `scores`),
    # so run them concurrently instead of one after another -- this was the
    # single biggest chunk of sequential latency in loading the Feed.
    with ThreadPoolExecutor(max_workers=4) as pool:
        profiles_future = pool.submit(_fetch_profiles)
        courses_future = pool.submit(_fetch_courses)
        comments_future = pool.submit(_comment_counts, round_pairs)
        reactions_future = pool.submit(_reaction_summary, viewer_id, round_pairs)

        profile_by_user = profiles_future.result()
        course_by_id = courses_future.result()
        comment_counts = comments_future.result()
        reactions_by_item = reactions_future.result()

    feed = []
    for score in scores:
        course = course_by_id.get(score.get("course_id"), {})
        feed.append({
            "item_type": "round",
            "item_id": score["score_id"],
            "user_id": score["user_id"],
            "player_name": _display_name(profile_by_user.get(score["user_id"])),
            "posted_at": score["play_date"],
            "body": None,
            "photo_url": None,
            "shared_item": None,
            "adjusted_gross": score.get("adjusted_gross"),
            "stableford_points": score.get("stableford_points"),
            "course_name": course.get("name") or score.get("course_name"),
            "course_photo_url": course.get("photo_url") or course.get("google_photo_url"),
            "course_phone": course.get("phone_number"),
            "country_name": score.get("country_name") or course.get("country_name"),
            "country_flag_url": score.get("country_flag_url"),
            "comment_count": comment_counts.get(("round", score["score_id"]), 0),
            "reactions": reactions_by_item.get(("round", score["score_id"]), _empty_reactions()),
        })

    return feed


def get_friends_feed(user_id: str, limit: int = 30) -> list[dict]:
    friend_ids = list_friend_ids(user_id)

    if not friend_ids:
        return []

    return _build_rounds_feed(user_id, friend_ids, limit)


def _validate_mentions(user_id: str, candidate_ids: list[str] | None) -> list[str]:
    """Structured @mentions can only tag friends (mirrors who the composer's
    tag-picker actually shows) -- dedupes and silently drops anything else
    rather than erroring, since the composer is the only caller and a stray
    id there is a client bug, not something the user needs to explain."""
    if not candidate_ids:
        return []

    friend_ids = set(list_friend_ids(user_id))
    seen: list[str] = []

    for candidate in candidate_ids:
        if candidate in friend_ids and candidate not in seen:
            seen.append(candidate)

    return seen


def _validate_course_id(course_id: int | None) -> int | None:
    if course_id is None:
        return None

    existing = supabase.table("courses").select("id").eq("id", course_id).limit(1).execute()

    if not existing.data:
        raise ValueError("Course not found")

    return course_id


def create_post(
    user_id: str,
    body: str,
    shared_item_type: str | None = None,
    shared_item_id: int | None = None,
    photo_url: str | None = None,
    is_system_generated: bool = False,
    mentioned_user_ids: list[str] | None = None,
    course_id: int | None = None,
    photo_urls: list[str] | None = None,
) -> dict:
    """user_id still owns the post for visibility/permission purposes (whose
    circle sees it, who can comment) -- is_system_generated only changes how
    the Feed *displays* it, showing "GolfCircle" instead of whoever's sync
    happened to trigger an automated post (a milestone, the daily
    leaderboard, a tournament announcement). See get_activity_feed_with_
    comments and _snapshot_item for where that display override happens.

    photo_urls (post_photos, ordered) is the current multi-photo path;
    photo_url stays populated as post_photos[0] for any old client/query
    still reading the singular column."""
    body = body.strip()
    primary_photo_url = photo_urls[0] if photo_urls else photo_url

    if not body and not primary_photo_url and not (shared_item_type and shared_item_id):
        raise ValueError("Post can't be empty")

    if len(body) > 2000:
        raise ValueError("Post is too long")

    row = {
        "user_id": user_id,
        "body": body,
        "photo_url": primary_photo_url,
        "is_system_generated": is_system_generated,
        "mentioned_user_ids": _validate_mentions(user_id, mentioned_user_ids),
        "course_id": _validate_course_id(course_id),
    }

    if shared_item_type and shared_item_id:
        if shared_item_type not in ("round", "post"):
            raise ValueError("That can't be shared")

        owner_id = _item_owner(shared_item_type, shared_item_id)

        if owner_id is None or not _can_view_item(user_id, owner_id):
            raise ValueError("Not found")

        row["shared_item_type"] = shared_item_type
        row["shared_item_id"] = shared_item_id

    post = supabase.table("posts").insert(row).execute().data[0]
    post["photo_urls"] = _replace_post_photos(post["id"], photo_urls)

    return post


def _photos_by_post_id(post_ids: list[int]) -> dict[int, list[str]]:
    if not post_ids:
        return {}

    response = (
        supabase
        .table("post_photos")
        .select("post_id,photo_url,position")
        .in_("post_id", post_ids)
        .order("position")
        .execute()
    )

    grouped: dict[int, list[str]] = {}
    for row in response.data or []:
        grouped.setdefault(row["post_id"], []).append(row["photo_url"])

    return grouped


def _replace_post_photos(post_id: int, photo_urls: list[str] | None) -> list[str]:
    """Full replace rather than a diff -- same precedent as
    auto_friend_teesheet_buddies' buddy-list sync, fine for a handful of
    rows with no per-photo state worth preserving across an edit."""
    supabase.table("post_photos").delete().eq("post_id", post_id).execute()

    if not photo_urls:
        return []

    supabase.table("post_photos").insert([
        {"post_id": post_id, "photo_url": url, "position": index}
        for index, url in enumerate(photo_urls)
    ]).execute()

    return photo_urls


def update_post(
    user_id: str,
    post_id: int,
    body: str,
    photo_url: str | None,
    mentioned_user_ids: list[str] | None = None,
    course_id: int | None = None,
    photo_urls: list[str] | None = None,
) -> dict:
    existing = supabase.table("posts").select("id,user_id").eq("id", post_id).limit(1).execute()

    if not existing.data:
        raise ValueError("Post not found")

    if existing.data[0]["user_id"] != user_id:
        raise ValueError("Post not found")

    body = body.strip()
    primary_photo_url = photo_urls[0] if photo_urls else photo_url

    if not body and not primary_photo_url:
        raise ValueError("Post can't be empty")

    if len(body) > 2000:
        raise ValueError("Post is too long")

    post = (
        supabase
        .table("posts")
        .update({
            "body": body,
            "photo_url": primary_photo_url,
            "edited_at": _now(),
            "mentioned_user_ids": _validate_mentions(user_id, mentioned_user_ids),
            "course_id": _validate_course_id(course_id),
        })
        .eq("id", post_id)
        .execute()
        .data[0]
    )
    post["photo_urls"] = _replace_post_photos(post_id, photo_urls)

    return post


def delete_post(user_id: str, post_id: int) -> None:
    existing = supabase.table("posts").select("id,user_id").eq("id", post_id).limit(1).execute()

    if not existing.data:
        raise ValueError("Post not found")

    if existing.data[0]["user_id"] != user_id:
        raise ValueError("Post not found")

    supabase.table("posts").delete().eq("id", post_id).execute()


def _item_owner(item_type: str, item_id: int) -> str | None:
    if item_type not in ("round", "post"):
        return None

    if item_type == "post":
        response = supabase.table("posts").select("user_id").eq("id", item_id).limit(1).execute()
    else:
        response = (
            supabase.table("handicap_scores").select("user_id").eq("score_id", item_id).limit(1).execute()
        )

    if not response.data:
        return None

    return response.data[0]["user_id"]


def _can_view_item(viewer_id: str, owner_id: str) -> bool:
    if viewer_id == owner_id:
        return True

    return owner_id in list_friend_ids(viewer_id)


def toggle_saved_item(user_id: str, item_type: str, item_id: int) -> dict:
    owner_id = _item_owner(item_type, item_id)

    if owner_id is None or not _can_view_item(user_id, owner_id):
        raise ValueError("Not found")

    existing = (
        supabase
        .table("saved_items")
        .select("id")
        .eq("user_id", user_id)
        .eq("item_type", item_type)
        .eq("item_id", item_id)
        .limit(1)
        .execute()
    )

    if existing.data:
        supabase.table("saved_items").delete().eq("id", existing.data[0]["id"]).execute()
        return {"saved": False}

    supabase.table("saved_items").insert({
        "user_id": user_id, "item_type": item_type, "item_id": item_id
    }).execute()
    return {"saved": True}


def list_saved_items(user_id: str, limit: int = 20, offset: int = 0) -> dict:
    """Reuses _build_feed_items (the same batched profile/course/reaction/
    comment/photo lookups the main /feed uses) so a saved item shows exactly
    like it does on the Feed -- reactions, comment count, photos and all --
    instead of the thinner _snapshot_item shape (built only for a shared-
    post preview, missing most of those fields)."""
    response = (
        supabase
        .table("saved_items")
        .select("id,item_type,item_id,created_at")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .range(offset, offset + limit - 1)
        .execute()
    )
    rows = response.data or []

    if not rows:
        return {"items": []}

    round_ids = [row["item_id"] for row in rows if row["item_type"] == "round"]
    post_ids = [row["item_id"] for row in rows if row["item_type"] == "post"]

    def _fetch_scores():
        if not round_ids:
            return {}
        response = (
            supabase
            .table("handicap_scores")
            .select(
                "score_id,user_id,play_date,adjusted_gross,stableford_points,"
                "course_id,course_name,country_name,country_flag_url"
            )
            .in_("score_id", round_ids)
            .execute()
        )
        return {row["score_id"]: row for row in response.data or []}

    def _fetch_posts():
        if not post_ids:
            return {}
        response = (
            supabase
            .table("posts")
            .select(
                "id,user_id,body,photo_url,shared_item_type,shared_item_id,created_at,"
                "is_system_generated,edited_at,course_id"
            )
            .in_("id", post_ids)
            .execute()
        )
        return {row["id"]: row for row in response.data or []}

    with ThreadPoolExecutor(max_workers=2) as pool:
        scores_future = pool.submit(_fetch_scores)
        posts_future = pool.submit(_fetch_posts)

        score_by_id = scores_future.result()
        post_by_id = posts_future.result()

    page = []
    stale_ids: list[int] = []

    for row in rows:
        if row["item_type"] == "round":
            raw = score_by_id.get(row["item_id"])
            posted_at_field = "play_date"
        else:
            raw = post_by_id.get(row["item_id"])
            posted_at_field = "created_at"

        # A saved post can be deleted, or a saved round's row could vanish
        # entirely -- skip (and clean up) anything that no longer resolves
        # rather than erroring the whole list over one stale bookmark.
        # Deliberately not filtered by hidden_from_feed here: a round you
        # explicitly saved should keep showing up even if it later drops out
        # of the main Feed's fan-out. A permission change (no longer
        # friends) is left alone too, not treated as "gone".
        if raw is None:
            stale_ids.append(row["id"])
            continue

        if not _can_view_item(user_id, raw["user_id"]):
            continue

        page.append({
            "item_type": row["item_type"],
            "item_id": row["item_id"],
            "posted_at": raw[posted_at_field],
            "raw": raw,
        })

    if stale_ids:
        supabase.table("saved_items").delete().in_("id", stale_ids).execute()

    return _build_feed_items(user_id, page)


def _saved_item_keys(user_id: str, pairs: list[tuple[str, int]]) -> set[tuple[str, int]]:
    if not pairs:
        return set()

    response = (
        supabase
        .table("saved_items")
        .select("item_type,item_id")
        .eq("user_id", user_id)
        .in_("item_type", list({item_type for item_type, _ in pairs}))
        .in_("item_id", list({item_id for _, item_id in pairs}))
        .execute()
    )

    valid = set(pairs)
    return {
        (row["item_type"], row["item_id"])
        for row in response.data or []
        if (row["item_type"], row["item_id"]) in valid
    }


def _group_comments_by_thread(rows: list[dict]) -> list[dict]:
    """Flat, created_at-ascending comment dicts (each already carrying a
    "replies": [] slot) -> top-level comments with their single-level
    replies nested inline. Relies on a reply always sorting after its
    parent (parent creation necessarily precedes the reply) and on
    add_comment enforcing replies can't themselves have a parent, so no
    row is ever more than one level deep."""
    by_id: dict[int, dict] = {}
    top_level: list[dict] = []

    for row in rows:
        by_id[row["id"]] = row
        parent_id = row.get("parent_comment_id")

        if parent_id and parent_id in by_id:
            by_id[parent_id]["replies"].append(row)
        else:
            top_level.append(row)

    return top_level


def _total_comment_count(threaded: list[dict]) -> int:
    """Comment badge count should include replies, not just top-level
    comments -- threaded is list_comments'/_fetch_comments_for_pairs'
    output shape (top-level comments each carrying a "replies" list)."""
    return sum(1 + len(comment.get("replies", [])) for comment in threaded)


def list_comments(user_id: str, item_type: str, item_id: int) -> list[dict]:
    owner_id = _item_owner(item_type, item_id)

    if owner_id is None or not _can_view_item(user_id, owner_id):
        raise ValueError("Not found")

    response = (
        supabase
        .table("feed_comments")
        .select("id,user_id,body,created_at,parent_comment_id")
        .eq("item_type", item_type)
        .eq("item_id", item_id)
        .order("created_at")
        .execute()
    )
    comments = response.data or []

    if not comments:
        return []

    profiles_response = (
        supabase
        .table("profiles")
        .select("user_id,display_name,email,surname,nickname,display_preference,avatar_url")
        .in_("user_id", list({comment["user_id"] for comment in comments}))
        .execute()
    )
    profile_by_user = {row["user_id"]: row for row in profiles_response.data or []}
    reactions_by_comment = _reaction_summary(user_id, [("comment", comment["id"]) for comment in comments])

    flat = [
        {
            "id": comment["id"],
            "user_id": comment["user_id"],
            "author_name": _display_name(profile_by_user.get(comment["user_id"])),
            "author_avatar_url": _avatar_url(profile_by_user.get(comment["user_id"])),
            "body": comment["body"],
            "created_at": comment["created_at"],
            "parent_comment_id": comment.get("parent_comment_id"),
            "reactions": reactions_by_comment.get(("comment", comment["id"]), _empty_reactions()),
            "replies": [],
        }
        for comment in comments
    ]

    return _group_comments_by_thread(flat)


def list_comments_batch(user_id: str, items: list[tuple[str, int]]) -> dict[str, list[dict]]:
    """Same data as list_comments, but for every Feed card on a page in one
    round trip instead of one request per card -- loading 20 cards used to
    fire 20 parallel comment requests.

    The permission check is batched too: it used to call _item_owner and
    _can_view_item (which itself re-queries the friend list) once per item,
    so a 20-card page could cost up to 40 sequential DB round trips before
    even fetching a single comment. Now it's 3 queries total regardless of
    how many cards are on the page."""
    keys = [f"{item_type}:{item_id}" for item_type, item_id in items]
    grouped: dict[str, list[dict]] = {key: [] for key in keys}

    if not items:
        return grouped

    round_ids = list({item_id for item_type, item_id in items if item_type == "round"})
    post_ids = list({item_id for item_type, item_id in items if item_type == "post"})

    def _fetch_round_owners():
        if not round_ids:
            return {}
        response = (
            supabase.table("handicap_scores").select("score_id,user_id").in_("score_id", round_ids).execute()
        )
        return {("round", row["score_id"]): row["user_id"] for row in response.data or []}

    def _fetch_post_owners():
        if not post_ids:
            return {}
        response = supabase.table("posts").select("id,user_id").in_("id", post_ids).execute()
        return {("post", row["id"]): row["user_id"] for row in response.data or []}

    with ThreadPoolExecutor(max_workers=3) as pool:
        round_owners_future = pool.submit(_fetch_round_owners)
        post_owners_future = pool.submit(_fetch_post_owners)
        friend_ids_future = pool.submit(list_friend_ids, user_id)

        owner_by_pair = {**round_owners_future.result(), **post_owners_future.result()}
        friend_ids = set(friend_ids_future.result())

    allowed = [
        (item_type, item_id)
        for item_type, item_id in items
        if owner_by_pair.get((item_type, item_id)) is not None
        and (owner_by_pair[(item_type, item_id)] == user_id or owner_by_pair[(item_type, item_id)] in friend_ids)
    ]

    if not allowed:
        return grouped

    return _fetch_comments_for_pairs(user_id, allowed, grouped)


def _fetch_comments_for_pairs(
    user_id: str, pairs: list[tuple[str, int]], grouped: dict[str, list[dict]] | None = None
) -> dict[str, list[dict]]:
    """Shared core of list_comments_batch, split out so /feed can fetch
    comments for the items it just built in the same request instead of the
    frontend needing a second round trip right after the first one lands.
    `pairs` must already be permission-checked by the caller."""
    if grouped is None:
        grouped = {f"{item_type}:{item_id}": [] for item_type, item_id in pairs}

    if not pairs:
        return grouped

    allowed_types = list({item_type for item_type, _ in pairs})
    allowed_ids = list({item_id for _, item_id in pairs})
    valid_pairs = set(pairs)

    response = (
        supabase
        .table("feed_comments")
        .select("id,item_type,item_id,user_id,body,created_at,parent_comment_id")
        .in_("item_type", allowed_types)
        .in_("item_id", allowed_ids)
        .order("created_at")
        .execute()
    )
    rows = [row for row in response.data or [] if (row["item_type"], row["item_id"]) in valid_pairs]

    if not rows:
        return grouped

    comment_user_ids = list({row["user_id"] for row in rows})
    comment_pairs = [("comment", row["id"]) for row in rows]

    def _fetch_comment_profiles():
        response = (
            supabase.table("profiles").select("user_id,display_name,email,surname,nickname,display_preference,avatar_url").in_("user_id", comment_user_ids).execute()
        )
        return {row["user_id"]: row for row in response.data or []}

    with ThreadPoolExecutor(max_workers=2) as pool:
        profiles_future = pool.submit(_fetch_comment_profiles)
        reactions_future = pool.submit(_reaction_summary, user_id, comment_pairs)

        profile_by_user = profiles_future.result()
        reactions_by_comment = reactions_future.result()

    flat_by_key: dict[str, list[dict]] = {}

    for row in rows:
        key = f"{row['item_type']}:{row['item_id']}"
        flat_by_key.setdefault(key, []).append({
            "id": row["id"],
            "user_id": row["user_id"],
            "author_name": _display_name(profile_by_user.get(row["user_id"])),
            "author_avatar_url": _avatar_url(profile_by_user.get(row["user_id"])),
            "body": row["body"],
            "created_at": row["created_at"],
            "parent_comment_id": row.get("parent_comment_id"),
            "reactions": reactions_by_comment.get(("comment", row["id"]), _empty_reactions()),
            "replies": [],
        })

    for key, flat in flat_by_key.items():
        grouped[key] = _group_comments_by_thread(flat)

    return grouped


def get_activity_feed_with_comments(
    user_id: str,
    limit: int = 20,
    offset: int = 0,
    scope: str = "everyone",
    type_filter: str = "all",
) -> dict:
    """/feed's actual response: the feed items plus every item's comments in
    one round trip.

    Every Supabase query costs ~400-500ms of fixed overhead regardless of
    payload size, so the win here isn't parallelizing more queries -- it's
    cutting the number of *sequential stages* the request has to wait
    through. This runs in 3 stages total:
      1. list_friend_ids -- needed before anything else can be scoped.
      2. scores + posts, concurrently (independent sources).
      3. profiles + courses + reactions + comments, all concurrently, since
         none of them depend on each other -- only on the (item_type, item_id)
         pairs known right after stage 2. Comment counts are derived from the
         comment rows already fetched here instead of a separate count query.

    scope="friends" excludes the viewer's own items (friends' activity
    only); type_filter narrows to just one source, skipping the other
    source's fetch entirely rather than fetching-then-discarding, saving
    the wasted over-fetch on the source nothing will render from. There's
    no broader "public" audience in this closed friend-circle app, so
    scope has only these two values.
    """
    friend_ids = list_friend_ids(user_id)
    circle_ids = friend_ids if scope == "friends" else list(set(friend_ids + [user_id]))
    # There's no single "feed" table to page over -- rounds and posts are
    # merged and re-sorted here -- so fetch enough of each source to cover
    # every page up to this one, then slice the combined, sorted list.
    fetch_count = offset + limit

    def _fetch_scores():
        if type_filter == "posts" or not circle_ids:
            return []
        response = (
            supabase
            .table("handicap_scores")
            .select(
                "score_id,user_id,play_date,adjusted_gross,stableford_points,"
                "course_id,course_name,country_name,country_flag_url"
            )
            .in_("user_id", circle_ids)
            .eq("hidden_from_feed", False)
            .order("play_date", desc=True)
            .limit(fetch_count)
            .execute()
        )
        return response.data or []

    def _fetch_posts():
        if type_filter == "rounds" or not circle_ids:
            return []
        response = (
            supabase
            .table("posts")
            .select(
                "id,user_id,body,photo_url,shared_item_type,shared_item_id,created_at,"
                "is_system_generated,edited_at,course_id"
            )
            .in_("user_id", circle_ids)
            .order("created_at", desc=True)
            .limit(fetch_count)
            .execute()
        )
        return response.data or []

    with ThreadPoolExecutor(max_workers=2) as pool:
        scores_future = pool.submit(_fetch_scores)
        posts_future = pool.submit(_fetch_posts)

        scores = scores_future.result()
        posts = posts_future.result()

    entries = [
        {"item_type": "round", "item_id": score["score_id"], "posted_at": score["play_date"], "raw": score}
        for score in scores
    ] + [
        {"item_type": "post", "item_id": post["id"], "posted_at": post["created_at"], "raw": post}
        for post in posts
    ]
    entries.sort(key=lambda entry: str(entry["posted_at"]), reverse=True)
    page = entries[offset:offset + limit]

    return _build_feed_items(user_id, page)


def _build_feed_items(user_id: str, page: list[dict]) -> dict:
    """Shared tail of get_activity_feed_with_comments (page = a slice of the
    friends circle, sorted by recency) and list_saved_items (page = the
    viewer's saved rounds/posts, in saved order) -- same batched profile/
    course/reaction/comment/photo/saved-flag lookups and the same per-item
    dict shape either way, built once here instead of two divergent copies."""
    if not page:
        return {"items": [], "comments": {}}

    pairs = [(entry["item_type"], entry["item_id"]) for entry in page]
    user_ids = list({entry["raw"]["user_id"] for entry in page})
    course_ids = list({
        entry["raw"]["course_id"]
        for entry in page
        if entry["raw"].get("course_id")
    })
    post_ids = [entry["item_id"] for entry in page if entry["item_type"] == "post"]

    def _fetch_profiles():
        response = supabase.table("profiles").select("user_id,display_name,email,surname,nickname,display_preference,avatar_url").in_("user_id", user_ids).execute()
        return {row["user_id"]: row for row in response.data or []}

    def _fetch_courses():
        if not course_ids:
            return {}
        response = (
            supabase
            .table("courses")
            .select("id,name,photo_url,google_photo_url,city,country_name,phone_number")
            .in_("id", course_ids)
            .execute()
        )
        return {row["id"]: row for row in response.data or []}

    def _fetch_post_photos():
        return _photos_by_post_id(post_ids)

    with ThreadPoolExecutor(max_workers=6) as pool:
        profiles_future = pool.submit(_fetch_profiles)
        courses_future = pool.submit(_fetch_courses)
        reactions_future = pool.submit(_reaction_summary, user_id, pairs)
        comments_future = pool.submit(_fetch_comments_for_pairs, user_id, pairs)
        photos_future = pool.submit(_fetch_post_photos)
        saved_future = pool.submit(_saved_item_keys, user_id, pairs)

        profile_by_user = profiles_future.result()
        course_by_id = courses_future.result()
        reactions_by_item = reactions_future.result()
        comments_by_key = comments_future.result()
        photos_by_post_id = photos_future.result()
        saved_keys = saved_future.result()

    _attach_recent_reactor_names(user_id, reactions_by_item, profile_by_user)

    items = []
    for entry in page:
        raw = entry["raw"]
        item_type = entry["item_type"]
        item_id = entry["item_id"]
        key = f"{item_type}:{item_id}"
        comment_count = _total_comment_count(comments_by_key.get(key, []))
        reactions = reactions_by_item.get((item_type, item_id), _empty_reactions())
        is_saved = (item_type, item_id) in saved_keys

        if item_type == "round":
            course = course_by_id.get(raw.get("course_id"), {})
            items.append({
                "item_type": "round",
                "item_id": item_id,
                "user_id": raw["user_id"],
                "player_name": _display_name(profile_by_user.get(raw["user_id"])),
                "player_avatar_url": _avatar_url(profile_by_user.get(raw["user_id"])),
                "posted_at": raw["play_date"],
                "body": None,
                "photo_url": None,
                "photo_urls": [],
                "shared_item": None,
                "adjusted_gross": raw.get("adjusted_gross"),
                "stableford_points": raw.get("stableford_points"),
                "course_name": course.get("name") or raw.get("course_name"),
                "course_photo_url": course.get("photo_url") or course.get("google_photo_url"),
                "course_phone": course.get("phone_number"),
                "course_id": raw.get("course_id"),
                "country_name": raw.get("country_name") or course.get("country_name"),
                "country_flag_url": raw.get("country_flag_url"),
                "comment_count": comment_count,
                "reactions": reactions,
                "is_system_generated": False,
                "edited_at": None,
                "is_saved": is_saved,
            })
        else:
            shared_item = None
            if raw.get("shared_item_type") and raw.get("shared_item_id"):
                shared_item = _snapshot_item(raw["shared_item_type"], raw["shared_item_id"])

            player_name, player_avatar_url = _post_identity(raw, profile_by_user.get(raw["user_id"]))
            post_course = course_by_id.get(raw.get("course_id"), {})

            items.append({
                "item_type": "post",
                "item_id": item_id,
                "user_id": raw["user_id"],
                "player_name": player_name,
                "player_avatar_url": player_avatar_url,
                "posted_at": raw["created_at"],
                "body": raw["body"],
                "photo_url": raw.get("photo_url"),
                "photo_urls": photos_by_post_id.get(item_id) or ([raw["photo_url"]] if raw.get("photo_url") else []),
                "shared_item": shared_item,
                "adjusted_gross": None,
                "stableford_points": None,
                "course_name": post_course.get("name"),
                "course_photo_url": post_course.get("photo_url") or post_course.get("google_photo_url"),
                "course_phone": post_course.get("phone_number"),
                "course_id": raw.get("course_id"),
                "country_name": post_course.get("country_name"),
                "country_flag_url": None,
                "comment_count": comment_count,
                "reactions": reactions,
                "is_system_generated": bool(raw.get("is_system_generated")),
                "edited_at": raw.get("edited_at"),
                "is_saved": is_saved,
            })

    return {"items": items, "comments": comments_by_key}


def add_comment(
    user_id: str,
    item_type: str,
    item_id: int,
    body: str,
    mentioned_user_ids: list[str] | None = None,
    parent_comment_id: int | None = None,
) -> dict:
    body = body.strip()

    if not body:
        raise ValueError("Comment can't be empty")

    if len(body) > 1000:
        raise ValueError("Comment is too long")

    owner_id = _item_owner(item_type, item_id)

    if owner_id is None or not _can_view_item(user_id, owner_id):
        raise ValueError("Not found")

    if parent_comment_id is not None:
        parent_response = (
            supabase
            .table("feed_comments")
            .select("id,item_type,item_id,parent_comment_id")
            .eq("id", parent_comment_id)
            .limit(1)
            .execute()
        )

        if not parent_response.data:
            raise ValueError("Comment not found")

        parent = parent_response.data[0]

        if parent["item_type"] != item_type or parent["item_id"] != item_id:
            raise ValueError("Comment not found")

        # Single-level threading only -- a reply can't itself be replied to.
        if parent.get("parent_comment_id") is not None:
            raise ValueError("Can't reply to a reply")

    response = (
        supabase
        .table("feed_comments")
        .insert({
            "item_type": item_type,
            "item_id": item_id,
            "user_id": user_id,
            "body": body,
            "mentioned_user_ids": _validate_mentions(user_id, mentioned_user_ids),
            "parent_comment_id": parent_comment_id,
        })
        .execute()
    )

    return response.data[0]


def delete_comment(user_id: str, comment_id: int) -> None:
    response = supabase.table("feed_comments").select("id,user_id").eq("id", comment_id).limit(1).execute()

    if not response.data:
        raise ValueError("Comment not found")

    if response.data[0]["user_id"] != user_id:
        raise ValueError("Comment not found")

    supabase.table("feed_comments").delete().eq("id", comment_id).execute()


def _my_item_ids(user_id: str) -> dict[str, list[int]]:
    my_round_ids = [
        row["score_id"]
        for row in fetch_all(
            lambda: supabase.table("handicap_scores").select("score_id").eq("user_id", user_id).order("id")
        )
    ]
    my_post_ids = [
        row["id"] for row in (supabase.table("posts").select("id").eq("user_id", user_id).execute().data or [])
    ]
    my_comment_ids = [
        row["id"]
        for row in (supabase.table("feed_comments").select("id").eq("user_id", user_id).execute().data or [])
    ]

    return {"round": my_round_ids, "post": my_post_ids, "comment": my_comment_ids}


def _get_profile_row(user_id: str) -> dict:
    response = (
        supabase
        .table("profiles")
        .select("notifications_checked_at,display_name,email")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    return response.data[0] if response.data else {}


def acknowledge_notifications(user_id: str) -> None:
    supabase.table("profiles").update({"notifications_checked_at": _now()}).eq("user_id", user_id).execute()


def list_notifications(user_id: str, limit: int = 20) -> list[dict]:
    """A real, clickable notifications list -- a like on something of mine,
    or a mention of me, each resolved to the round/post it belongs to so the
    frontend can jump straight to it."""
    profile = _get_profile_row(user_id)
    checked_at = profile.get("notifications_checked_at") or "1970-01-01T00:00:00Z"
    my_items = _my_item_ids(user_id)

    raw: list[dict] = []

    # One combined query instead of one per item type (round/post/comment) --
    # over-fetch by id across all types, then keep only the (type, id) pairs
    # that are actually mine, same pattern as _comment_counts/_reaction_summary.
    own_pairs = {
        (item_type, item_id) for item_type, ids in my_items.items() for item_id in ids
    }
    all_my_ids = list({item_id for ids in my_items.values() for item_id in ids})
    my_types = [item_type for item_type, ids in my_items.items() if ids]

    if all_my_ids and my_types:
        response = (
            supabase
            .table("feed_likes")
            .select("id,item_type,item_id,user_id,reaction,created_at")
            .in_("item_type", my_types)
            .in_("item_id", all_my_ids)
            .neq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )

        for row in response.data or []:
            if (row["item_type"], row["item_id"]) not in own_pairs:
                continue

            raw.append({
                "id": f"like:{row['id']}",
                "type": "like",
                "actor_id": row["user_id"],
                "item_type": row["item_type"],
                "item_id": row["item_id"],
                "reaction": row["reaction"],
                "request_id": None,
                "created_at": row["created_at"],
            })

    # Pending incoming friend requests, actionable right from the panel --
    # unlike a like/mention these always count as unread until responded to
    # (accepting/declining, not just opening the panel), since they're
    # something to act on, not just see.
    pending_response = (
        supabase
        .table("friend_requests")
        .select("id,from_user_id,created_at")
        .eq("to_user_id", user_id)
        .eq("status", "pending")
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )

    for row in pending_response.data or []:
        raw.append({
            "id": f"friend_request:{row['id']}",
            "type": "friend_request",
            "actor_id": row["from_user_id"],
            "item_type": None,
            "item_id": None,
            "reaction": None,
            "request_id": row["id"],
            "created_at": row["created_at"],
        })

    for table, item_type in (("posts", "post"), ("feed_comments", "comment")):
        response = (
            supabase
            .table(table)
            .select("id,user_id,created_at")
            .contains("mentioned_user_ids", [user_id])
            .neq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )

        for row in response.data or []:
            raw.append({
                "id": f"mention:{item_type}:{row['id']}",
                "type": "mention",
                "actor_id": row["user_id"],
                "item_type": item_type,
                "item_id": row["id"],
                "reaction": None,
                "request_id": None,
                "created_at": row["created_at"],
            })

    if not raw:
        return []

    actor_ids = list({row["actor_id"] for row in raw})
    profiles_response = (
        supabase.table("profiles").select("user_id,display_name,email,surname,nickname,display_preference,avatar_url").in_("user_id", actor_ids).execute()
    )
    profile_by_user = {row["user_id"]: row for row in profiles_response.data or []}

    # A comment doesn't render as its own card -- it's shown inline under
    # the round/post it belongs to -- so resolve comment notifications to
    # that parent for navigation/highlighting purposes.
    comment_ids = [row["item_id"] for row in raw if row["item_type"] == "comment"]
    parent_by_comment_id = {}

    if comment_ids:
        comments_response = (
            supabase
            .table("feed_comments")
            .select("id,item_type,item_id")
            .in_("id", list(set(comment_ids)))
            .execute()
        )
        parent_by_comment_id = {
            row["id"]: (row["item_type"], row["item_id"]) for row in comments_response.data or []
        }

    notifications = []

    for row in raw:
        target_type, target_id = row["item_type"], row["item_id"]

        if row["item_type"] == "comment":
            parent = parent_by_comment_id.get(row["item_id"])
            if parent:
                target_type, target_id = parent

        notifications.append({
            "id": row["id"],
            "type": row["type"],
            "actor_name": _display_name(profile_by_user.get(row["actor_id"])),
            "reaction": row["reaction"],
            "target_item_type": target_type,
            "target_item_id": target_id,
            "request_id": row["request_id"],
            "created_at": row["created_at"],
            # A friend request stays unread until it's actually responded to,
            # not just seen -- everything else uses the normal "opened the
            # panel" definition.
            "read": False if row["type"] == "friend_request" else row["created_at"] <= checked_at,
        })

    notifications.sort(key=lambda n: n["created_at"], reverse=True)

    return notifications[:limit]
