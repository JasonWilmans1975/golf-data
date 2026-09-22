from datetime import datetime, timezone

from playwright.async_api import async_playwright

from .db import supabase
from .crypto import encrypt, decrypt

TEESHEET_BASE_URL = "https://www.teesheet.co.za"


def save_credentials(user_id: str, club_id: int, club_name: str, member_id: str, password: str):
    supabase.table("teesheet_credentials").upsert({
        "user_id": user_id,
        "club_id": club_id,
        "club_name": club_name,
        "member_id": member_id,
        "encrypted_password": encrypt(password),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).execute()


def has_credentials(user_id: str) -> bool:
    response = (
        supabase
        .table("teesheet_credentials")
        .select("user_id")
        .eq("user_id", user_id)
        .execute()
    )

    return bool(response.data)


def _get_credentials(user_id: str):
    response = (
        supabase
        .table("teesheet_credentials")
        .select("club_id,club_name,member_id,encrypted_password")
        .eq("user_id", user_id)
        .execute()
    )

    if not response.data:
        raise RuntimeError(
            "No teesheet.co.za credentials saved yet — add them in Settings"
        )

    row = response.data[0]

    return row["club_id"], row["member_id"], decrypt(row["encrypted_password"])


async def _login(page, club_id: int, member_id: str, password: str):
    await page.goto(f"{TEESHEET_BASE_URL}/MemberLogin.php", wait_until="networkidle")

    await page.select_option("#Club", value=str(club_id))
    await page.fill("#MemberID", member_id)
    await page.fill("#pwd", password)

    try:
        async with page.expect_navigation(wait_until="networkidle", timeout=15000):
            await page.click("#loginbutton")
    except Exception:
        pass

    if "MemberLogin" in page.url:
        raise RuntimeError(
            "teesheet.co.za rejected the club, member ID, or password"
        )


async def fetch_landing_page_html(club_id: int, member_id: str, password: str) -> dict:
    """Diagnostic helper: logs in and returns the landing page's URL, title,
    and nav links so we can discover the tee-times/account pages before
    building real scraping logic against them.
    """
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch()
        page = await browser.new_page()

        try:
            await _login(page, club_id, member_id, password)

            links = await page.eval_on_selector_all(
                "a[href]",
                "els => els.map(e => ({ text: e.textContent.trim(), href: e.getAttribute('href') })).filter(l => l.text)"
            )

            html = await page.content()

            return {
                "url": page.url,
                "title": await page.title(),
                "links": links,
                "html_length": len(html),
                "html_snippet": html[:2000],
            }
        finally:
            await browser.close()
