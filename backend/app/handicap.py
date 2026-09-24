import html
import re
from datetime import datetime, timezone

from playwright.async_api import async_playwright

from .db import supabase
from .courses import match_handicap_scores_to_courses
from .crypto import encrypt, decrypt
from .milestones import check_and_award_milestones
from .leaderboard import maybe_post_daily_leaderboard

HANDICAP_SITE_BASE_URL = "https://www.handicaps.co.za"

GET_MY_SCORES_SCRIPT = """
async () => {
    const pageSize = 500;
    let pageNumber = 1;
    let all = [];
    let total = null;

    while (true) {
        const response = await fetch('/api/Score/GetMyScores', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                pageNumber,
                pageSize,
                dateString: null,
                otherPassportId: null,
                includeCasualScores: true,
                getDefaultFacility: true,
                facilityTypeUID: null,
                noOfHoles: null,
                casualScoresOnly: false,
            }),
        });
        const body = await response.json();
        total = body.TotalCount;
        const scores = body.Scores || [];
        all = all.concat(scores);

        if (scores.length < pageSize || all.length >= total) break;
        pageNumber += 1;
    }

    return { total, scores: all };
}
"""


def save_credentials(user_id: str, member_no: str, password: str):
    supabase.table("handicap_credentials").upsert({
        "user_id": user_id,
        "member_no": member_no,
        "encrypted_password": encrypt(password),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).execute()


def has_credentials(user_id: str) -> bool:
    response = (
        supabase
        .table("handicap_credentials")
        .select("user_id")
        .eq("user_id", user_id)
        .execute()
    )

    return bool(response.data)


def _get_credentials(user_id: str):
    response = (
        supabase
        .table("handicap_credentials")
        .select("member_no,encrypted_password")
        .eq("user_id", user_id)
        .execute()
    )

    if not response.data:
        raise RuntimeError(
            "No handicaps.co.za credentials saved yet — add them in Settings"
        )

    row = response.data[0]

    return row["member_no"], decrypt(row["encrypted_password"])


async def _login(page, member_no: str, password: str):
    await page.goto(
        f"{HANDICAP_SITE_BASE_URL}/login?view=login", wait_until="networkidle"
    )

    await page.fill('input[name="memNo"]', member_no)
    await page.fill('input[name="password"]', password)

    try:
        async with page.expect_navigation(wait_until="networkidle", timeout=15000):
            await page.get_by_role("button", name="Sign in").first.click()
    except Exception:
        pass

    if "/login" in page.url:
        raise RuntimeError(
            "handicaps.co.za rejected the membership number or password"
        )


async def fetch_handicap_data(member_no: str, password: str) -> dict:
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch()
        page = await browser.new_page()

        try:
            await _login(page, member_no, password)
            scores_result = await page.evaluate(GET_MY_SCORES_SCRIPT)

            current_index_result = await page.evaluate(
                """
                async () => {
                    const response = await fetch('/api/Score/GetMemberHandicapIndex', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: '{}',
                    });
                    const body = await response.json().catch(() => null);
                    return { status: response.status, body };
                }
                """
            )
        finally:
            await browser.close()

    current_index = None
    if current_index_result["status"] == 200 and current_index_result["body"]:
        current_index = _to_float(current_index_result["body"].get("HandicapIndex"))

    return {"scores": scores_result["scores"], "current_index": current_index}


def _parse_play_date(value: str) -> str:
    return datetime.strptime(value, "%d/%m/%Y").date().isoformat()


def _parse_course_name(raw):
    if not raw:
        return None, None, None

    country_name = None
    flag_url = None

    img_match = re.search(r"<img[^>]*>", raw, re.IGNORECASE)

    if img_match:
        img_tag = img_match.group(0)
        title_match = re.search(r'title="([^"]*)"', img_tag)
        src_match = re.search(r'src="([^"]*)"', img_tag)
        country_name = title_match.group(1) if title_match else None

        if src_match:
            # handicaps.co.za's own flag images are unreliable (some
            # country/subdivision codes 500), so reuse their filename's
            # ISO code against flagcdn.com, which reliably serves both
            # ISO 3166-1 codes and UK subdivision codes like "gb-sct".
            filename = src_match.group(1).rsplit("/", 1)[-1]
            country_code = filename.rsplit(".", 1)[0].lower()
            flag_url = f"https://flagcdn.com/24x18/{country_code}.png"

    course_name = html.unescape(re.sub(r"<[^>]+>", "", raw)).strip()

    return course_name, country_name, flag_url


def _to_float(value):
    if value in (None, ""):
        return None

    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _already_synced_today(user_id: str) -> bool:
    state = (
        supabase
        .table("handicap_sync_state")
        .select("last_synced_at")
        .eq("user_id", user_id)
        .execute()
    )

    if not state.data or not state.data[0]["last_synced_at"]:
        return False

    last_synced_at = datetime.fromisoformat(state.data[0]["last_synced_at"])

    return last_synced_at.astimezone(timezone.utc).date() == datetime.now(timezone.utc).date()


def _mark_synced_now(user_id: str, current_index):
    supabase.table("handicap_sync_state").upsert({
        "user_id": user_id,
        "last_synced_at": datetime.now(timezone.utc).isoformat(),
        "current_handicap_index": current_index,
    }).execute()


async def sync_handicap_data(user_id: str, force: bool = False):
    if not force and _already_synced_today(user_id):
        return {"skipped": True, "reason": "Already synced today"}

    member_no, password = _get_credentials(user_id)
    data = await fetch_handicap_data(member_no, password)
    scores = data["scores"]

    rows = []
    for score in scores:
        if not score.get("ScoreId") or not score.get("PlayDate"):
            continue

        course_name, country_name, flag_url = _parse_course_name(score.get("CourseName"))

        rows.append({
            "score_id": score["ScoreId"],
            "user_id": user_id,
            "play_date": _parse_play_date(score["PlayDate"]),
            "handicap_index": _to_float(score.get("HandicapIndex")),
            "hc_diff": _to_float(score.get("HCDiff")),
            "adjusted_gross": score.get("AdjustedGross"),
            "course_name": course_name,
            "country_name": country_name,
            "country_flag_url": flag_url,
            "stableford_points": score.get("StablefordPoints"),
            "counted_in_handicap": bool(score.get("CountedInHandicap")),
            "is_casual_score": bool(score.get("IsCasualScore")),
        })

    if rows:
        supabase.table("handicap_scores").upsert(rows, on_conflict="score_id").execute()

    course_match = match_handicap_scores_to_courses(user_id)

    _mark_synced_now(user_id, data["current_index"])

    if rows:
        check_and_award_milestones(user_id)

    maybe_post_daily_leaderboard(user_id)

    return {
        "skipped": False,
        "synced": len(rows),
        "total_seen": len(scores),
        "current_handicap_index": data["current_index"],
        "courses_matched": course_match["matched"],
        "courses_created": course_match["created_courses"],
    }
