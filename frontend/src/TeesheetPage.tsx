import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { API, authFetch } from "./api";
import TopbarActions from "./TopbarActions";
import BrandLogo from "./BrandLogo";
import FeedNavButton from "./FeedNavButton";

type Booking = {
    id: number;
    booking_id: number | null;
    play_date: string;
    play_time: string | null;
    tee: string | null;
    course_name: string | null;
    players: string[] | null;
};

type Transaction = {
    id: number;
    doc_number: string;
    transaction_at: string;
    description: string | null;
    credit: number;
    debit: number;
};

type Balance = {
    current_balance: number | null;
    last_synced_at: string | null;
};

function formatDate(value: string) {
    return new Intl.DateTimeFormat("en-ZA", {
        weekday: "short",
        day: "numeric",
        month: "short",
    }).format(new Date(value));
}

function formatDateTime(value: string) {
    return new Intl.DateTimeFormat("en-ZA", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
    }).format(new Date(value));
}

function formatMoney(value: number) {
    return `R${Math.abs(value).toFixed(2)}`;
}

function TeesheetPage() {
    const navigate = useNavigate();

    const [bookings, setBookings] = useState<Booking[]>([]);
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [balance, setBalance] = useState<Balance | null>(null);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [syncError, setSyncError] = useState<string | null>(null);
    const [justSynced, setJustSynced] = useState(false);

    async function loadData() {
        try {
            const [bookingsRes, transactionsRes, balanceRes] = await Promise.all([
                authFetch(`${API}/teesheet/bookings`),
                authFetch(`${API}/teesheet/transactions`),
                authFetch(`${API}/teesheet/balance`),
            ]);

            if (bookingsRes.ok) setBookings(await bookingsRes.json());
            if (transactionsRes.ok) setTransactions(await transactionsRes.json());
            if (balanceRes.ok) setBalance(await balanceRes.json());
        } catch (error) {
            console.error(error);
        }
    }

    async function sync(force: boolean) {
        setSyncing(true);
        setSyncError(null);

        try {
            const syncResponse = await authFetch(
                `${API}/teesheet/sync${force ? "?force=true" : ""}`,
                { method: "POST" }
            );

            const body = await syncResponse.json().catch(() => null);

            if (!syncResponse.ok) {
                setSyncError(body?.detail || "Could not sync with teesheet.co.za");
            } else {
                const didSync = body?.skipped === false;
                setJustSynced(didSync);

                if (didSync) {
                    await loadData();
                }
            }
        } catch (error) {
            console.error(error);
            setSyncError("Could not reach the backend to sync");
        } finally {
            setSyncing(false);
        }
    }

    useEffect(() => {
        // Show whatever's already synced immediately; the teesheet.co.za
        // login + scrape only needs to run once a day, so most loads
        // shouldn't wait on it at all.
        loadData().finally(() => {
            setLoading(false);
            sync(false);
        });
    }, []);

    async function handleRefresh() {
        await sync(true);
    }

    return (
        <>
            <header className="topbar">
                <div>
                    <BrandLogo />
                    <h1>Teesheet</h1>
                </div>

                <TopbarActions>
                    <button
                        className="header-secondary-button"
                        onClick={() => navigate("/")}
                    >
                        Home
                    </button>

                    <button
                        className="header-secondary-button"
                        onClick={() => navigate("/rounds")}
                    >
                        My Rounds
                    </button>

                    <button
                        className="header-secondary-button"
                        onClick={() => navigate("/map")}
                    >
                        World Map
                    </button>

                    <button
                        className="header-secondary-button"
                        onClick={() => navigate("/handicap")}
                    >
                        Handicap
                    </button>

                    <button
                        className="header-secondary-button"
                        onClick={() => navigate("/wellness")}
                    >
                        Wellness
                    </button>

                    <FeedNavButton />

                    <button
                        className="header-secondary-button"
                        onClick={() => navigate("/settings")}
                    >
                        Settings
                    </button>

                    <button
                        className="sync-button"
                        disabled={syncing}
                        onClick={handleRefresh}
                    >
                        {syncing ? "Syncing..." : "Refresh data"}
                    </button>
                </TopbarActions>
            </header>

            <main className="content">
                <section className="course-hero">
                    <p className="eyebrow">TEESHEET.CO.ZA</p>

                    <h2>Tee times &amp; account.</h2>

                    <p>
                        {loading
                            ? "Loading your teesheet data..."
                            : syncError
                            ? `Last sync failed: ${syncError}`
                            : syncing
                            ? "Syncing the latest data from teesheet.co.za in the background..."
                            : justSynced
                            ? "Just synced the latest data from teesheet.co.za."
                            : "Up to date — this syncs with teesheet.co.za once a day."}
                    </p>
                </section>

                <section className="stats-grid">
                    <div className="stat-card">
                        <span>Spending account balance</span>
                        <strong>
                            {balance?.current_balance != null
                                ? `${formatMoney(balance.current_balance)} ${
                                      balance.current_balance >= 0 ? "Credit" : "Debit"
                                  }`
                                : "—"}
                        </strong>
                    </div>

                    <div className="stat-card">
                        <span>Upcoming bookings</span>
                        <strong>{bookings.length}</strong>
                    </div>
                </section>

                <section className="section-heading">
                    <div>
                        <p className="eyebrow">TEE TIMES</p>
                        <h3>Upcoming bookings</h3>
                    </div>
                </section>

                <div className="round-list">
                    {bookings.length === 0 ? (
                        <p className="course-count" style={{ padding: 16 }}>
                            {loading ? "Loading..." : "No upcoming bookings."}
                        </p>
                    ) : (
                        bookings.map((booking) => (
                            <div className="round-row" key={booking.id}>
                                <div>
                                    <strong>{formatDate(booking.play_date)}</strong>
                                    <span>{booking.course_name || "—"}</span>
                                </div>

                                <div>
                                    <strong>{booking.play_time || "—"}</strong>
                                    <span>Tee time</span>
                                </div>

                                <div>
                                    <strong>{booking.tee || "—"}</strong>
                                    <span>Tee section</span>
                                </div>

                                <div>
                                    <strong>
                                        {booking.players && booking.players.length > 0
                                            ? booking.players.join(", ")
                                            : "—"}
                                    </strong>
                                    <span>Players</span>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                <section className="section-heading">
                    <div>
                        <p className="eyebrow">ACCOUNT</p>
                        <h3>Recent transactions</h3>
                    </div>

                    <span className="course-count">
                        {transactions.length} of last 20 shown
                    </span>
                </section>

                <div className="round-list">
                    {transactions.length === 0 ? (
                        <p className="course-count" style={{ padding: 16 }}>
                            {loading ? "Loading..." : "No transactions yet."}
                        </p>
                    ) : (
                        transactions.map((txn) => (
                            <div className="round-row" key={txn.id}>
                                <div>
                                    <strong>{formatDateTime(txn.transaction_at)}</strong>
                                    <span>Doc# {txn.doc_number}</span>
                                </div>

                                <div>
                                    <strong>{txn.description || "—"}</strong>
                                    <span>Description</span>
                                </div>

                                <div>
                                    <strong>
                                        {txn.credit > 0 ? formatMoney(txn.credit) : "—"}
                                    </strong>
                                    <span>Credit</span>
                                </div>

                                <div>
                                    <strong>
                                        {txn.debit > 0 ? formatMoney(txn.debit) : "—"}
                                    </strong>
                                    <span>Debit</span>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </main>
        </>
    );
}

export default TeesheetPage;
