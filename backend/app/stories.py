from datetime import datetime, timedelta, timezone

from .db import supabase
from .friends import list_friend_ids, _display_name, _avatar_url, _reaction_summary, _empty_reactions

TEXT_STORY_MAX_LENGTH = 300
PHOTO_CAPTION_MAX_LENGTH = 200

STORY_LIFETIME = timedelta(hours=24)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _active_since() -> str:
    return (datetime.now(timezone.utc) - STORY_LIFETIME).isoformat()


STORY_VISIBILITIES = {"friends", "everyone"}


def create_story(
    user_id: str,
    photo_url: str | None,
    caption: str | None,
    background_color: str | None,
    visibility: str = "friends",
) -> dict:
    """A story is either a photo (with an optional short caption) or, when
    photo_url is None, a text-only story -- inferred from photo_url being
    absent rather than a separate story_type column. A text-only story
    needs actual text; background_color only means anything for that case."""
    caption = (caption or "").strip()
    is_text_only = photo_url is None

    if visibility not in STORY_VISIBILITIES:
        raise ValueError("Invalid visibility")

    if is_text_only:
        if not caption:
            raise ValueError("A text story needs some text")
        caption = caption[:TEXT_STORY_MAX_LENGTH]
    else:
        caption = caption[:PHOTO_CAPTION_MAX_LENGTH] or None
        background_color = None

    if is_text_only and not background_color:
        background_color = "g1"

    response = (
        supabase
        .table("stories")
        .insert({
            "user_id": user_id,
            "photo_url": photo_url,
            "caption": caption,
            "background_color": background_color,
            "visibility": visibility,
        })
        .execute()
    )

    return response.data[0]


def list_stories(user_id: str) -> list[dict]:
    """The Feed's story bar: every active (< 24h old) story either from the
    viewer's own circle (any visibility -- your friends' "friends"-only
    stories are still yours to see) or from anyone at all who chose
    "everyone" for that story, grouped per author with a viewed/unviewed
    flag per story so the frontend can ring each avatar accordingly."""
    circle_ids = list(set(list_friend_ids(user_id) + [user_id]))
    circle_filter = ",".join(circle_ids)

    response = (
        supabase
        .table("stories")
        .select("id,user_id,photo_url,caption,background_color,visibility,created_at")
        .or_(f"user_id.in.({circle_filter}),visibility.eq.everyone")
        .gte("created_at", _active_since())
        .order("created_at")
        .execute()
    )
    rows = response.data or []

    if not rows:
        return []

    story_ids = [row["id"] for row in rows]
    author_ids = list({row["user_id"] for row in rows})

    views_response = (
        supabase
        .table("story_views")
        .select("story_id")
        .eq("viewer_id", user_id)
        .in_("story_id", story_ids)
        .execute()
    )
    viewed_story_ids = {row["story_id"] for row in views_response.data or []}

    profiles_response = (
        supabase
        .table("profiles")
        .select("user_id,display_name,email,surname,nickname,display_preference,avatar_url")
        .in_("user_id", author_ids)
        .execute()
    )
    profile_by_user = {row["user_id"]: row for row in profiles_response.data or []}

    reactions_by_story = _reaction_summary(user_id, [("story", row["id"]) for row in rows])

    groups_by_user: dict[str, dict] = {}
    for row in rows:
        group = groups_by_user.setdefault(row["user_id"], {
            "user_id": row["user_id"],
            "display_name": _display_name(profile_by_user.get(row["user_id"])),
            "avatar_url": _avatar_url(profile_by_user.get(row["user_id"])),
            "stories": [],
            "has_unviewed": False,
        })

        viewed = row["id"] in viewed_story_ids
        group["stories"].append({
            "id": row["id"],
            "photo_url": row["photo_url"],
            "caption": row["caption"],
            "background_color": row["background_color"],
            "visibility": row["visibility"],
            "created_at": row["created_at"],
            "viewed_by_me": viewed,
            "reactions": reactions_by_story.get(("story", row["id"]), _empty_reactions()),
        })

        if not viewed and row["user_id"] != user_id:
            group["has_unviewed"] = True

    groups = list(groups_by_user.values())

    def newest_first_rank(group: dict) -> tuple:
        # Own stories first, then unviewed-before-viewed, then most recent
        # story wins within each bucket -- mirrors Instagram/Facebook's own
        # story-bar ordering. Sorted as (asc, asc, desc), so the recency
        # component is negated rather than reverse-sorted.
        is_mine = group["user_id"] == user_id
        newest = max(story["created_at"] for story in group["stories"])
        return (0 if is_mine else 1, 0 if group["has_unviewed"] else 1, newest)

    groups.sort(key=lambda group: newest_first_rank(group)[2], reverse=True)
    groups.sort(key=lambda group: newest_first_rank(group)[:2])

    return groups


def record_story_view(viewer_id: str, story_id: int) -> None:
    response = supabase.table("stories").select("id,user_id,visibility").eq("id", story_id).limit(1).execute()

    if not response.data:
        raise ValueError("Story not found")

    story = response.data[0]
    owner_id = story["user_id"]

    if owner_id == viewer_id:
        return

    if story["visibility"] != "everyone" and owner_id not in list_friend_ids(viewer_id):
        raise ValueError("Story not found")

    existing = (
        supabase
        .table("story_views")
        .select("id")
        .eq("story_id", story_id)
        .eq("viewer_id", viewer_id)
        .limit(1)
        .execute()
    )

    if existing.data:
        return

    supabase.table("story_views").insert({
        "story_id": story_id, "viewer_id": viewer_id, "viewed_at": _now()
    }).execute()


def get_story_viewers(user_id: str, story_id: int) -> list[dict]:
    story_response = supabase.table("stories").select("id,user_id").eq("id", story_id).limit(1).execute()

    if not story_response.data:
        raise ValueError("Story not found")

    if story_response.data[0]["user_id"] != user_id:
        raise ValueError("Story not found")

    views_response = (
        supabase
        .table("story_views")
        .select("viewer_id,viewed_at")
        .eq("story_id", story_id)
        .order("viewed_at", desc=True)
        .execute()
    )
    rows = views_response.data or []

    if not rows:
        return []

    viewer_ids = list({row["viewer_id"] for row in rows})
    profiles_response = (
        supabase
        .table("profiles")
        .select("user_id,display_name,email,surname,nickname,display_preference,avatar_url")
        .in_("user_id", viewer_ids)
        .execute()
    )
    profile_by_user = {row["user_id"]: row for row in profiles_response.data or []}

    return [
        {
            "user_id": row["viewer_id"],
            "display_name": _display_name(profile_by_user.get(row["viewer_id"])),
            "avatar_url": _avatar_url(profile_by_user.get(row["viewer_id"])),
            "viewed_at": row["viewed_at"],
        }
        for row in rows
    ]


def delete_story(user_id: str, story_id: int) -> None:
    existing = supabase.table("stories").select("id,user_id").eq("id", story_id).limit(1).execute()

    if not existing.data:
        raise ValueError("Story not found")

    if existing.data[0]["user_id"] != user_id:
        raise ValueError("Story not found")

    supabase.table("stories").delete().eq("id", story_id).execute()
