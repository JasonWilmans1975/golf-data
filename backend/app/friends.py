from concurrent.futures import ThreadPoolExecutor
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
        .select("user_id,display_name,email")
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
    return {"counts": {}, "total": 0, "my_reaction": None}


def _reaction_summary(viewer_id: str, items: list[tuple[str, int]]) -> dict[tuple[str, int], dict]:
    if not items:
        return {}

    response = (
        supabase
        .table("feed_likes")
        .select("item_type,item_id,user_id,reaction")
        .in_("item_type", list({item_type for item_type, _ in items}))
        .in_("item_id", list({item_id for _, item_id in items}))
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

        if row["user_id"] == viewer_id:
            entry["my_reaction"] = row["reaction"]

    return summary


def toggle_reaction(user_id: str, item_type: str, item_id: int, reaction: str) -> dict:
    if reaction not in REACTIONS:
        raise ValueError("Invalid reaction")

    if item_type == "comment":
        comment_response = (
            supabase.table("feed_comments").select("item_type,item_id").eq("id", item_id).limit(1).execute()
        )

        if not comment_response.data:
            raise ValueError("Not found")

        parent = comment_response.data[0]
        owner_id = _item_owner(parent["item_type"], parent["item_id"])
    elif item_type in ("round", "post"):
        owner_id = _item_owner(item_type, item_id)
    else:
        raise ValueError("Invalid item type")

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
    return summary.get((item_type, item_id), _empty_reactions())


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
            supabase.table("profiles").select("display_name,email").eq("user_id", score["user_id"]).limit(1).execute()
        )
        profile = profile_response.data[0] if profile_response.data else None

        return {
            "item_type": "round",
            "item_id": score["score_id"],
            "player_name": _display_name(profile),
            "posted_at": score["play_date"],
            "body": None,
            "photo_url": None,
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
            .select("id,user_id,body,photo_url,created_at")
            .eq("id", item_id)
            .limit(1)
            .execute()
        )

        if not response.data:
            return None

        post = response.data[0]
        profile_response = (
            supabase.table("profiles").select("display_name,email").eq("user_id", post["user_id"]).limit(1).execute()
        )
        profile = profile_response.data[0] if profile_response.data else None

        return {
            "item_type": "post",
            "item_id": post["id"],
            "player_name": _display_name(profile),
            "posted_at": post["created_at"],
            "body": post["body"],
            "photo_url": post.get("photo_url"),
            "course_name": None,
            "course_photo_url": None,
            "course_phone": None,
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
            supabase.table("profiles").select("user_id,display_name,email").in_("user_id", user_ids_seen).execute()
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


def create_post(
    user_id: str,
    body: str,
    shared_item_type: str | None = None,
    shared_item_id: int | None = None,
    photo_url: str | None = None,
) -> dict:
    body = body.strip()

    if not body and not photo_url and not (shared_item_type and shared_item_id):
        raise ValueError("Post can't be empty")

    if len(body) > 2000:
        raise ValueError("Post is too long")

    row = {"user_id": user_id, "body": body, "photo_url": photo_url}

    if shared_item_type and shared_item_id:
        if shared_item_type not in ("round", "post"):
            raise ValueError("That can't be shared")

        owner_id = _item_owner(shared_item_type, shared_item_id)

        if owner_id is None or not _can_view_item(user_id, owner_id):
            raise ValueError("Not found")

        row["shared_item_type"] = shared_item_type
        row["shared_item_id"] = shared_item_id

    response = supabase.table("posts").insert(row).execute()

    return response.data[0]


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


def list_comments(user_id: str, item_type: str, item_id: int) -> list[dict]:
    owner_id = _item_owner(item_type, item_id)

    if owner_id is None or not _can_view_item(user_id, owner_id):
        raise ValueError("Not found")

    response = (
        supabase
        .table("feed_comments")
        .select("id,user_id,body,created_at")
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
        .select("user_id,display_name,email")
        .in_("user_id", list({comment["user_id"] for comment in comments}))
        .execute()
    )
    profile_by_user = {row["user_id"]: row for row in profiles_response.data or []}
    reactions_by_comment = _reaction_summary(user_id, [("comment", comment["id"]) for comment in comments])

    return [
        {
            "id": comment["id"],
            "user_id": comment["user_id"],
            "author_name": _display_name(profile_by_user.get(comment["user_id"])),
            "body": comment["body"],
            "created_at": comment["created_at"],
            "reactions": reactions_by_comment.get(("comment", comment["id"]), _empty_reactions()),
        }
        for comment in comments
    ]


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
        .select("id,item_type,item_id,user_id,body,created_at")
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
            supabase.table("profiles").select("user_id,display_name,email").in_("user_id", comment_user_ids).execute()
        )
        return {row["user_id"]: row for row in response.data or []}

    with ThreadPoolExecutor(max_workers=2) as pool:
        profiles_future = pool.submit(_fetch_comment_profiles)
        reactions_future = pool.submit(_reaction_summary, user_id, comment_pairs)

        profile_by_user = profiles_future.result()
        reactions_by_comment = reactions_future.result()

    for row in rows:
        key = f"{row['item_type']}:{row['item_id']}"
        grouped.setdefault(key, []).append({
            "id": row["id"],
            "user_id": row["user_id"],
            "author_name": _display_name(profile_by_user.get(row["user_id"])),
            "body": row["body"],
            "created_at": row["created_at"],
            "reactions": reactions_by_comment.get(("comment", row["id"]), _empty_reactions()),
        })

    return grouped


def get_activity_feed_with_comments(user_id: str, limit: int = 20, offset: int = 0) -> dict:
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
    """
    circle_ids = list(set(list_friend_ids(user_id) + [user_id]))
    # There's no single "feed" table to page over -- rounds and posts are
    # merged and re-sorted here -- so fetch enough of each source to cover
    # every page up to this one, then slice the combined, sorted list.
    fetch_count = offset + limit

    def _fetch_scores():
        response = (
            supabase
            .table("handicap_scores")
            .select(
                "score_id,user_id,play_date,adjusted_gross,stableford_points,"
                "course_id,course_name,country_name,country_flag_url"
            )
            .in_("user_id", circle_ids)
            .order("play_date", desc=True)
            .limit(fetch_count)
            .execute()
        )
        return response.data or []

    def _fetch_posts():
        response = (
            supabase
            .table("posts")
            .select("id,user_id,body,photo_url,shared_item_type,shared_item_id,created_at")
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

    if not page:
        return {"items": [], "comments": {}}

    pairs = [(entry["item_type"], entry["item_id"]) for entry in page]
    user_ids = list({entry["raw"]["user_id"] for entry in page})
    course_ids = list({
        entry["raw"]["course_id"]
        for entry in page
        if entry["item_type"] == "round" and entry["raw"].get("course_id")
    })

    def _fetch_profiles():
        response = supabase.table("profiles").select("user_id,display_name,email").in_("user_id", user_ids).execute()
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

    with ThreadPoolExecutor(max_workers=4) as pool:
        profiles_future = pool.submit(_fetch_profiles)
        courses_future = pool.submit(_fetch_courses)
        reactions_future = pool.submit(_reaction_summary, user_id, pairs)
        comments_future = pool.submit(_fetch_comments_for_pairs, user_id, pairs)

        profile_by_user = profiles_future.result()
        course_by_id = courses_future.result()
        reactions_by_item = reactions_future.result()
        comments_by_key = comments_future.result()

    items = []
    for entry in page:
        raw = entry["raw"]
        item_type = entry["item_type"]
        item_id = entry["item_id"]
        key = f"{item_type}:{item_id}"
        comment_count = len(comments_by_key.get(key, []))
        reactions = reactions_by_item.get((item_type, item_id), _empty_reactions())

        if item_type == "round":
            course = course_by_id.get(raw.get("course_id"), {})
            items.append({
                "item_type": "round",
                "item_id": item_id,
                "user_id": raw["user_id"],
                "player_name": _display_name(profile_by_user.get(raw["user_id"])),
                "posted_at": raw["play_date"],
                "body": None,
                "photo_url": None,
                "shared_item": None,
                "adjusted_gross": raw.get("adjusted_gross"),
                "stableford_points": raw.get("stableford_points"),
                "course_name": course.get("name") or raw.get("course_name"),
                "course_photo_url": course.get("photo_url") or course.get("google_photo_url"),
                "course_phone": course.get("phone_number"),
                "country_name": raw.get("country_name") or course.get("country_name"),
                "country_flag_url": raw.get("country_flag_url"),
                "comment_count": comment_count,
                "reactions": reactions,
            })
        else:
            shared_item = None
            if raw.get("shared_item_type") and raw.get("shared_item_id"):
                shared_item = _snapshot_item(raw["shared_item_type"], raw["shared_item_id"])

            items.append({
                "item_type": "post",
                "item_id": item_id,
                "user_id": raw["user_id"],
                "player_name": _display_name(profile_by_user.get(raw["user_id"])),
                "posted_at": raw["created_at"],
                "body": raw["body"],
                "photo_url": raw.get("photo_url"),
                "shared_item": shared_item,
                "adjusted_gross": None,
                "stableford_points": None,
                "course_name": None,
                "course_photo_url": None,
                "course_phone": None,
                "country_name": None,
                "country_flag_url": None,
                "comment_count": comment_count,
                "reactions": reactions,
            })

    return {"items": items, "comments": comments_by_key}


def add_comment(user_id: str, item_type: str, item_id: int, body: str) -> dict:
    body = body.strip()

    if not body:
        raise ValueError("Comment can't be empty")

    if len(body) > 1000:
        raise ValueError("Comment is too long")

    owner_id = _item_owner(item_type, item_id)

    if owner_id is None or not _can_view_item(user_id, owner_id):
        raise ValueError("Not found")

    response = (
        supabase
        .table("feed_comments")
        .insert({"item_type": item_type, "item_id": item_id, "user_id": user_id, "body": body})
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
    display_name = _display_name(profile)
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
                "created_at": row["created_at"],
            })

    for table, item_type in (("posts", "post"), ("feed_comments", "comment")):
        response = (
            supabase
            .table(table)
            .select("id,user_id,created_at")
            .ilike("body", f"%@{display_name}%")
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
                "created_at": row["created_at"],
            })

    if not raw:
        return []

    actor_ids = list({row["actor_id"] for row in raw})
    profiles_response = (
        supabase.table("profiles").select("user_id,display_name,email").in_("user_id", actor_ids).execute()
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
            "created_at": row["created_at"],
            "read": row["created_at"] <= checked_at,
        })

    notifications.sort(key=lambda n: n["created_at"], reverse=True)

    return notifications[:limit]
