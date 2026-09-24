import { useEffect, useMemo, useState } from "react";
import { API, authFetch } from "./api";
import TopbarActions from "./TopbarActions";
import BrandLogo from "./BrandLogo";
import NavButton from "./NavButton";
import FeedNavButton from "./FeedNavButton";

type LeaderboardEntry = {
    user_id: string;
    player_name: string;
    handicap_index: number | null;
    rounds_played: number;
    best_gross: number | null;
    best_stableford: number | null;
};

type LeaderboardResponse = {
    month: string;
    divisions: Record<"A" | "B" | "C", LeaderboardEntry[]>;
};

const DIVISION_LABELS: Record<"A" | "B" | "C", string> = {
    A: "Division A",
    B: "Division B",
    C: "Division C",
};

function monthLabel(month: string) {
    const [year, mon] = month.split("-").map(Number);
    return new Intl.DateTimeFormat("en-ZA", { month: "long", year: "numeric" }).format(
        new Date(year, mon - 1, 1)
    );
}

function shiftMonth(month: string, delta: number) {
    const [year, mon] = month.split("-").map(Number);
    const date = new Date(year, mon - 1 + delta, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function currentMonth() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function LeaderboardPage() {
    const [month, setMonth] = useState(currentMonth());
    const [data, setData] = useState<LeaderboardResponse | null>(null);
    const [loading, setLoading] = useState(true);

    const isCurrentMonth = useMemo(() => month === currentMonth(), [month]);

    useEffect(() => {
        let cancelled = false;

        async function load() {
            setLoading(true);
            try {
                const response = await authFetch(`${API}/leaderboard?month=${month}`);
                if (response.ok && !cancelled) {
                    setData(await response.json());
                }
            } catch (error) {
                console.error(error);
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        load();
        return () => {
            cancelled = true;
        };
    }, [month]);

    return (
        <>
            <header className="topbar">
                <div>
                    <BrandLogo />
                </div>

                <TopbarActions>
                    <NavButton to="/rounds">My Rounds</NavButton>
                    <NavButton to="/map">World Map</NavButton>
                    <NavButton to="/stats">Stats</NavButton>
                    <NavButton to="/handicap">Handicap</NavButton>
                    <NavButton to="/leaderboard">Leaderboard</NavButton>
                    <NavButton to="/tournaments">Tournaments</NavButton>
                    <NavButton to="/wellness">Wellness</NavButton>
                    <NavButton to="/teesheet">Teesheet</NavButton>
                    <FeedNavButton />
                    <NavButton to="/settings">Settings</NavButton>
                </TopbarActions>
            </header>

            <main className="content">
                <section className="course-hero">
                    <p className="eyebrow">FRIENDS LEADERBOARD</p>
                    <h2>{monthLabel(month)}</h2>
                    <p>
                        Ranked by best Stableford round this month within your friend
                        circle, split into divisions by current handicap.
                    </p>

                    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                        <button className="sync-button" onClick={() => setMonth((m) => shiftMonth(m, -1))}>
                            ← Previous month
                        </button>
                        <button
                            className="sync-button"
                            onClick={() => setMonth((m) => shiftMonth(m, 1))}
                            disabled={isCurrentMonth}
                        >
                            Next month →
                        </button>
                    </div>
                </section>

                <section className="chart-grid">
                    {(["A", "B", "C"] as const).map((division) => {
                        const entries = data?.divisions?.[division] || [];

                        return (
                            <div className="chart-card" key={division}>
                                <div className="chart-heading">
                                    <div>
                                        <p className="eyebrow">{DIVISION_LABELS[division]}</p>
                                        <h3>{entries.length} player{entries.length === 1 ? "" : "s"}</h3>
                                    </div>
                                </div>

                                {loading ? (
                                    <p className="course-count">Loading...</p>
                                ) : entries.length === 0 ? (
                                    <p className="course-count">No rounds played this month yet.</p>
                                ) : (
                                    <div className="round-list">
                                        {entries.map((entry, index) => (
                                            <div className="round-row" key={entry.user_id}>
                                                <div>
                                                    <strong>
                                                        {index + 1}. {entry.player_name}
                                                    </strong>
                                                    <span>
                                                        {entry.handicap_index != null
                                                            ? `HCP ${entry.handicap_index}`
                                                            : "HCP —"}
                                                    </span>
                                                </div>

                                                <div>
                                                    <strong>{entry.best_stableford ?? "—"}</strong>
                                                    <span>Best Stableford</span>
                                                </div>

                                                <div>
                                                    <strong>{entry.best_gross ?? "—"}</strong>
                                                    <span>Best gross</span>
                                                </div>

                                                <div>
                                                    <strong>{entry.rounds_played}</strong>
                                                    <span>Rounds</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </section>
            </main>
        </>
    );
}

export default LeaderboardPage;
