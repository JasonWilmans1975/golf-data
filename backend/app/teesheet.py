import re
from datetime import datetime, timezone

from bs4 import BeautifulSoup
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
    # This site never does a real page navigation after login -- the login
    # POST redirects back to a page that immediately fires an onload AJAX
    # call (ajaxPage('memdetails.php')) to swap in the member area. So the
    # only reliable success/failure signal is the resulting page *content*,
    # not page.url (which stays on/near MemberLogin.php either way).
    await page.goto(f"{TEESHEET_BASE_URL}/MemberLogin.php", wait_until="networkidle")

    await page.select_option("#Club", value=str(club_id))
    await page.fill("#MemberID", member_id)
    await page.fill("#pwd", password)
    await page.click("#loginbutton")

    try:
        await page.wait_for_function(
            """() => {
                const text = document.body && document.body.innerText;
                if (!text) return false;
                return text.includes('Registration Information')
                    || text.includes('Invalid Username or Password')
                    || text.includes('No Connection to the club');
            }""",
            timeout=15000,
        )
    except Exception as exc:
        raise RuntimeError(
            "teesheet.co.za did not respond to the login attempt"
        ) from exc

    body_text = await page.evaluate("document.body ? document.body.innerText : ''")

    if "Registration Information" not in body_text:
        raise RuntimeError(
            "teesheet.co.za rejected the club, member ID, or password"
        )


async def _load_menu_page(page, menu_text: str) -> str:
    previous_html = await page.eval_on_selector("#MainPage", "el => el.innerHTML")

    await page.click(f"text={menu_text}")

    await page.wait_for_function(
        """(prev) => {
            const el = document.getElementById('MainPage');
            if (!el) return false;
            const html = el.innerHTML;
            return html !== prev && html.indexOf('loading_img') === -1;
        }""",
        arg=previous_html,
        timeout=15000,
    )

    return await page.eval_on_selector("#MainPage", "el => el.innerHTML")


def _parse_money(text: str) -> float:
    cleaned = re.sub(r"[^0-9.\-]", "", text or "")
    return float(cleaned) if cleaned else 0.0


def _parse_future_bookings(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    bookings = []

    info_tables = [
        table
        for table in soup.find_all("table", id="bodytable")
        if table.find("th") and table.find("th").get_text(strip=True) == "Date"
    ]

    for info_table in info_tables:
        rows = info_table.find_all("tr")

        if len(rows) < 2:
            continue

        cells = [cell.get_text(strip=True) for cell in rows[1].find_all("td")]

        if len(cells) < 4 or not cells[0]:
            continue

        play_date_text, play_time, tee, course_name = cells[0], cells[1], cells[2], cells[3]

        players = []
        booking_id = None

        players_table = info_table.find_next_sibling("table", id="bodytable")

        if players_table and players_table.find("th") and "Player" in players_table.find("th").get_text():
            for row in players_table.find_all("tr")[1:]:
                cols = row.find_all("td")

                if len(cols) < 2:
                    continue

                name = cols[1].get_text(strip=True)

                if name:
                    players.append(name)

                delete_button = row.find(
                    "input", onclick=re.compile(r"deleteBooking\((\d+)\)")
                )

                if delete_button:
                    match = re.search(r"deleteBooking\((\d+)\)", delete_button["onclick"])

                    if match:
                        booking_id = int(match.group(1))

        try:
            play_date = datetime.strptime(
                play_date_text.split(", ", 1)[-1], "%d %B %Y"
            ).date().isoformat()
        except ValueError:
            continue

        bookings.append({
            "booking_id": booking_id,
            "play_date": play_date,
            "play_time": play_time or None,
            "tee": tee or None,
            "course_name": course_name or None,
            "players": players,
        })

    return bookings


def _parse_transactions(html: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")

    balance = None
    balance_strong = soup.find("strong", string=re.compile(r"Account Balance"))

    if balance_strong:
        match = re.search(
            r"Account Balance:\s*R?([\d,.]+)\s*(Credit|Debit)",
            balance_strong.get_text(),
            re.IGNORECASE,
        )

        if match:
            amount = _parse_money(match.group(1))
            balance = amount if match.group(2).lower() == "credit" else -amount

    transactions = []
    table = soup.find("table")

    if table:
        for row in table.find_all("tr")[1:]:
            cells = row.find_all("td")

            if len(cells) < 5:
                continue

            doc_number = cells[1].get_text(strip=True)

            if not doc_number:
                continue

            transactions.append({
                "doc_number": doc_number,
                "transaction_at": cells[0].get_text(strip=True).replace(" ", "T", 1),
                "description": cells[2].get_text(strip=True),
                "credit": _parse_money(cells[3].get_text()),
                "debit": _parse_money(cells[4].get_text()),
            })

    return {"balance": balance, "transactions": transactions}


def _already_synced_today(user_id: str) -> bool:
    state = (
        supabase
        .table("teesheet_sync_state")
        .select("last_synced_at")
        .eq("user_id", user_id)
        .execute()
    )

    if not state.data or not state.data[0]["last_synced_at"]:
        return False

    last_synced_at = datetime.fromisoformat(state.data[0]["last_synced_at"])

    return last_synced_at.astimezone(timezone.utc).date() == datetime.now(timezone.utc).date()


def _mark_synced_now(user_id: str, balance: float | None):
    supabase.table("teesheet_sync_state").upsert({
        "user_id": user_id,
        "last_synced_at": datetime.now(timezone.utc).isoformat(),
        "current_balance": balance,
    }).execute()


async def sync_teesheet_data(user_id: str, force: bool = False) -> dict:
    if not force and _already_synced_today(user_id):
        return {"skipped": True, "reason": "Already synced today"}

    club_id, member_id, password = _get_credentials(user_id)

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch()
        page = await browser.new_page()

        try:
            await _login(page, club_id, member_id, password)

            future_html = await _load_menu_page(page, "List All Future Bookings")
            bookings = _parse_future_bookings(future_html)

            transactions_html = await _load_menu_page(
                page, "View Spending Account Statement"
            )
            txn_data = _parse_transactions(transactions_html)
        finally:
            await browser.close()

    if bookings:
        supabase.table("teesheet_bookings").upsert(
            [{**b, "user_id": user_id} for b in bookings],
            on_conflict="user_id,play_date,play_time,course_name",
        ).execute()

    if txn_data["transactions"]:
        supabase.table("teesheet_transactions").upsert(
            [{**t, "user_id": user_id} for t in txn_data["transactions"]],
            on_conflict="user_id,doc_number",
        ).execute()

    _mark_synced_now(user_id, txn_data["balance"])

    return {
        "skipped": False,
        "bookings_synced": len(bookings),
        "transactions_synced": len(txn_data["transactions"]),
        "balance": txn_data["balance"],
    }
