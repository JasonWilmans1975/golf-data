from datetime import datetime, timezone

from .db import supabase, fetch_all
from .friends import list_friend_ids, _display_name, _avatar_url, create_post


def _profiles_for(user_ids: list[str]) -> dict[str, dict]:
    if not user_ids:
        return {}

    response = (
        supabase
        .table("profiles")
        .select("user_id,display_name,email,surname,nickname,display_preference,avatar_url")
        .in_("user_id", user_ids)
        .execute()
    )
    return {row["user_id"]: row for row in response.data or []}


def _tournament_link(feed_post_id: int, name: str) -> str:
    """A tournament name embedded this way in a post body renders as a
    clickable link back to the tournament's original "created" Feed post
    (not a separate leaderboard page) -- see renderBody in FeedPage.tsx for
    the matching parser. feed_post_id is that original post's id, so every
    later auto-post about this tournament points at the same place."""
    return f"[[tournament:{feed_post_id}:{name}]]"


def _format_date_range(start_date: str, end_date: str) -> str:
    start = datetime.strptime(start_date, "%Y-%m-%d").strftime("%-d %b %Y")

    if start_date == end_date:
        return start

    end = datetime.strptime(end_date, "%Y-%m-%d").strftime("%-d %b %Y")
    return f"{start} – {end}"


def create_tournament(
    user_id: str, name: str, start_date: str, end_date: str, invitee_ids: list[str]
) -> dict:
    name = name.strip()

    if not name:
        raise ValueError("Tournament needs a name")

    if end_date < start_date:
        raise ValueError("End date can't be before the start date")

    friend_ids = set(list_friend_ids(user_id))
    invitee_ids = set(invitee_ids) - {user_id}

    if invitee_ids - friend_ids:
        raise ValueError("Can only invite friends")

    tournament = (
        supabase
        .table("tournaments")
        .insert({
            "creator_user_id": user_id,
            "name": name,
            "start_date": start_date,
            "end_date": end_date,
        })
        .execute()
        .data[0]
    )

    now = datetime.now(timezone.utc).isoformat()
    participants = [
        {"tournament_id": tournament["id"], "user_id": user_id, "status": "accepted", "responded_at": now}
    ] + [
        {"tournament_id": tournament["id"], "user_id": invitee_id, "status": "invited"}
        for invitee_id in invitee_ids
    ]

    supabase.table("tournament_participants").insert(participants).execute()

    invite_note = f" {len(invitee_ids)} friend(s) invited." if invitee_ids else ""
    date_range = _format_date_range(start_date, end_date)

    # The link needs this post's own id, which only exists after inserting
    # it -- so post the plain-text version first, then patch in the link
    # once we know it, and remember it on the tournament for later posts
    # (e.g. a join) to link back to.
    post = create_post(user_id, f"🏆 Created a new tournament: {name} ({date_range}).{invite_note}")

    linked_body = (
        f"🏆 Created a new tournament: {_tournament_link(post['id'], name)} ({date_range}).{invite_note}"
    )
    supabase.table("posts").update({"body": linked_body}).eq("id", post["id"]).execute()
    supabase.table("tournaments").update({"feed_post_id": post["id"]}).eq("id", tournament["id"]).execute()

    tournament["feed_post_id"] = post["id"]
    return tournament


def list_tournaments(user_id: str) -> list[dict]:
    participant_rows = fetch_all(
        lambda: supabase
        .table("tournament_participants")
        .select("tournament_id,status")
        .eq("user_id", user_id)
        .order("tournament_id")
    )

    if not participant_rows:
        return []

    tournament_ids = [row["tournament_id"] for row in participant_rows]
    status_by_id = {row["tournament_id"]: row["status"] for row in participant_rows}

    tournaments_response = (
        supabase
        .table("tournaments")
        .select("id,creator_user_id,name,start_date,end_date,created_at")
        .in_("id", tournament_ids)
        .order("start_date", desc=True)
        .execute()
    )
    tournaments = tournaments_response.data or []

    profile_by_user = _profiles_for(list({t["creator_user_id"] for t in tournaments}))

    return [
        {
            **tournament,
            "creator_name": _display_name(profile_by_user.get(tournament["creator_user_id"])),
            "my_status": status_by_id.get(tournament["id"]),
        }
        for tournament in tournaments
    ]


def _get_tournament(tournament_id: int) -> dict | None:
    response = supabase.table("tournaments").select("*").eq("id", tournament_id).limit(1).execute()
    return response.data[0] if response.data else None


def _my_participant_row(tournament_id: int, user_id: str) -> dict | None:
    response = (
        supabase
        .table("tournament_participants")
        .select("*")
        .eq("tournament_id", tournament_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    return response.data[0] if response.data else None


def respond_to_tournament(user_id: str, tournament_id: int, accept: bool) -> dict:
    participant = _my_participant_row(tournament_id, user_id)

    if participant is None:
        raise ValueError("Not found")

    status = "accepted" if accept else "declined"
    was_already_accepted = participant["status"] == "accepted"

    supabase.table("tournament_participants").update({
        "status": status,
        "responded_at": datetime.now(timezone.utc).isoformat(),
    }).eq("tournament_id", tournament_id).eq("user_id", user_id).execute()

    # Only announce the actual transition into "accepted" -- not a decline,
    # and not a no-op re-accept.
    if accept and not was_already_accepted:
        tournament = _get_tournament(tournament_id)
        if tournament is not None:
            name = (
                _tournament_link(tournament["feed_post_id"], tournament["name"])
                if tournament.get("feed_post_id")
                else tournament["name"]
            )
            create_post(user_id, f"🙌 Joined the tournament: {name}!")

    return {"status": status}


def _claim_tournament_results(tournament_id: int) -> bool:
    """Atomically claims posting this tournament's results -- the WHERE
    results_posted_at is null means only whichever sync call runs this
    first gets rows back, so results post exactly once even if several
    participants' syncs race for it."""
    response = (
        supabase
        .table("tournaments")
        .update({"results_posted_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", tournament_id)
        .is_("results_posted_at", "null")
        .execute()
    )
    return bool(response.data)


def maybe_post_tournament_results(user_id: str) -> None:
    """Called after a handicap sync. There's no cron in this backend, so a
    tournament's final results post the next time any of its accepted
    participants syncs after the tournament's last day -- usually within
    hours for a group that syncs daily, just not at the exact stroke of
    midnight."""
    today = datetime.now(timezone.utc).date().isoformat()

    my_participation = (
        supabase
        .table("tournament_participants")
        .select("tournament_id")
        .eq("user_id", user_id)
        .eq("status", "accepted")
        .execute()
    )
    tournament_ids = [row["tournament_id"] for row in my_participation.data or []]

    if not tournament_ids:
        return

    ended_response = (
        supabase
        .table("tournaments")
        .select("*")
        .in_("id", tournament_ids)
        .lt("end_date", today)
        .is_("results_posted_at", "null")
        .execute()
    )

    for tournament in ended_response.data or []:
        if not _claim_tournament_results(tournament["id"]):
            continue

        participants_response = (
            supabase
            .table("tournament_participants")
            .select("user_id")
            .eq("tournament_id", tournament["id"])
            .eq("status", "accepted")
            .execute()
        )
        accepted_ids = [row["user_id"] for row in participants_response.data or []]

        scores = (
            fetch_all(
                lambda: supabase
                .table("handicap_scores")
                .select("user_id,adjusted_gross,stableford_points")
                .in_("user_id", accepted_ids)
                .gte("play_date", tournament["start_date"])
                .lte("play_date", tournament["end_date"])
                .order("id")
            )
            if accepted_ids
            else []
        )

        stats_by_user: dict[str, dict] = {
            uid: {"total_stableford": 0, "total_gross": 0} for uid in accepted_ids
        }

        for score in scores:
            entry = stats_by_user[score["user_id"]]
            entry["total_stableford"] += score.get("stableford_points") or 0
            entry["total_gross"] += score.get("adjusted_gross") or 0

        ranked = sorted(
            accepted_ids,
            key=lambda uid: (-stats_by_user[uid]["total_stableford"], stats_by_user[uid]["total_gross"]),
        )

        link = (
            _tournament_link(tournament["feed_post_id"], tournament["name"])
            if tournament.get("feed_post_id")
            else tournament["name"]
        )

        if not ranked:
            create_post(user_id, f"🏁 {link} has ended — no scores were recorded.")
            continue

        profile_by_user = _profiles_for(ranked)
        medals = ["🥇", "🥈", "🥉"]
        lines = [
            f"{medals[i] if i < len(medals) else f'{i + 1}.'} "
            f"{_display_name(profile_by_user.get(uid))} — {stats_by_user[uid]['total_stableford']} pts"
            for i, uid in enumerate(ranked)
        ]

        create_post(user_id, f"🏁 Final results: {link}\n" + "\n".join(lines))


def get_tournament_leaderboard(user_id: str, tournament_id: int) -> dict:
    """Only ever readable by someone the creator invited (accepted, declined,
    or still pending) -- same "you're not in it, you can't see it" model as
    the rest of the Feed's permission checks."""
    tournament = _get_tournament(tournament_id)
    my_row = _my_participant_row(tournament_id, user_id)

    if tournament is None or my_row is None:
        raise ValueError("Not found")

    participants_response = (
        supabase
        .table("tournament_participants")
        .select("user_id,status")
        .eq("tournament_id", tournament_id)
        .execute()
    )
    participants = participants_response.data or []
    accepted_ids = [row["user_id"] for row in participants if row["status"] == "accepted"]

    scores = []
    if accepted_ids:
        scores = fetch_all(
            lambda: supabase
            .table("handicap_scores")
            .select("user_id,adjusted_gross,stableford_points")
            .in_("user_id", accepted_ids)
            .gte("play_date", tournament["start_date"])
            .lte("play_date", tournament["end_date"])
            .order("id")
        )

    profile_by_user = _profiles_for([row["user_id"] for row in participants])

    stats_by_user: dict[str, dict] = {}

    for score in scores:
        entry = stats_by_user.setdefault(
            score["user_id"], {"rounds_played": 0, "total_stableford": 0, "total_gross": 0}
        )
        entry["rounds_played"] += 1
        entry["total_stableford"] += score.get("stableford_points") or 0
        entry["total_gross"] += score.get("adjusted_gross") or 0

    leaderboard = [
        {
            "user_id": uid,
            "player_name": _display_name(profile_by_user.get(uid)),
            "avatar_url": _avatar_url(profile_by_user.get(uid)),
            **stats_by_user.get(uid, {"rounds_played": 0, "total_stableford": 0, "total_gross": 0}),
        }
        for uid in accepted_ids
    ]

    leaderboard.sort(
        key=lambda entry: (
            -entry["total_stableford"],
            entry["total_gross"] if entry["rounds_played"] else 999999,
        )
    )

    pending = [
        {
            "user_id": row["user_id"],
            "player_name": _display_name(profile_by_user.get(row["user_id"])),
            "avatar_url": _avatar_url(profile_by_user.get(row["user_id"])),
            "status": row["status"],
        }
        for row in participants
        if row["status"] != "accepted"
    ]

    return {
        "tournament": {
            "id": tournament["id"],
            "name": tournament["name"],
            "start_date": tournament["start_date"],
            "end_date": tournament["end_date"],
            "creator_user_id": tournament["creator_user_id"],
        },
        "my_status": my_row["status"],
        "leaderboard": leaderboard,
        "pending": pending,
    }
