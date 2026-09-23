import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from "recharts";
import { API, authFetch } from "./api";
import TopbarActions from "./TopbarActions";
import BrandLogo from "./BrandLogo";
import NavButton from "./NavButton";
import FeedNavButton from "./FeedNavButton";
import { useTheme } from "./useTheme";

const CHART_PALETTES = {
    dark: {
        accent: "#e8b84b",
        grid: "rgba(255,255,255,0.08)",
        tick: { fill: "#8b93a1", fontSize: 11 },
        tooltipStyle: {
            background: "#191c22",
            border: "1px solid rgba(255,255,255,0.16)",
            borderRadius: 4,
            color: "#f4f5f7",
        },
        tooltipLabelStyle: { color: "#8b93a1" },
    },
    light: {
        accent: "#007ffd",
        grid: "rgba(20,20,30,0.1)",
        tick: { fill: "#6b7280", fontSize: 11 },
        tooltipStyle: {
            background: "#ffffff",
            border: "1px solid rgba(20,20,30,0.15)",
            borderRadius: 4,
            color: "#14141c",
        },
        tooltipLabelStyle: { color: "#6b7280" },
    },
} as const;

type HandicapSnapshot = {
    recorded_at: string;
    handicap_index: number;
};

type Score = {
    id: number;
    score_id: number;
    play_date: string;
    handicap_index: number | null;
    hc_diff: number | null;
    adjusted_gross: number | null;
    course_name: string | null;
    country_name: string | null;
    country_flag_url: string | null;
    stableford_points: number | null;
    counted_in_handicap: boolean;
    is_casual_score: boolean;
};


function formatDate(value: string) {
    return new Intl.DateTimeFormat("en-ZA", {
        day: "numeric",
        month: "short",
        year: "numeric",
    }).format(new Date(value));
}

function HandicapPage() {
    const navigate = useNavigate();
    const { theme } = useTheme();
    const chart = CHART_PALETTES[theme];

    const [history, setHistory] = useState<HandicapSnapshot[]>([]);
    const [scores, setScores] = useState<Score[]>([]);
    const [currentHandicap, setCurrentHandicap] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [syncError, setSyncError] = useState<string | null>(null);
    const [justSynced, setJustSynced] = useState(false);
    const [sortKey, setSortKey] = useState<"date" | "gross" | "stableford">("date");
    const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

    useEffect(() => {
        async function loadData() {
            try {
                const [historyRes, scoresRes, currentRes] = await Promise.all([
                    authFetch(`${API}/handicap`),
                    authFetch(`${API}/handicap/scores`),
                    authFetch(`${API}/handicap/current`),
                ]);

                setHistory(await historyRes.json());
                setScores(await scoresRes.json());

                const current = await currentRes.json();
                setCurrentHandicap(current?.current_handicap_index ?? null);
            } catch (error) {
                console.error(error);
            }
        }

        async function init() {
            // Show whatever's already in the database immediately -- a
            // Playwright scrape of handicaps.co.za only needs to run once a
            // day, so most page loads shouldn't wait on it at all.
            await loadData();
            setLoading(false);

            setSyncing(true);
            setSyncError(null);

            try {
                const syncResponse = await authFetch(`${API}/handicap/sync`, {
                    method: "POST",
                });

                const body = await syncResponse.json().catch(() => null);

                if (!syncResponse.ok) {
                    setSyncError(
                        body?.detail || "Could not sync with handicaps.co.za"
                    );
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

        init();
    }, []);

    const trend = useMemo(() => {
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

        return history
            .filter((snapshot) => new Date(snapshot.recorded_at) >= sixMonthsAgo)
            .map((snapshot) => ({
                date: snapshot.recorded_at,
                handicap: snapshot.handicap_index,
            }));
    }, [history]);

    const lowestHandicap = useMemo(
        () =>
            history.length > 0
                ? Math.min(...history.map((snapshot) => snapshot.handicap_index))
                : null,
        [history]
    );

    function toggleSort(key: "date" | "gross" | "stableford") {
        if (sortKey === key) {
            setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
        } else {
            setSortKey(key);
            setSortDir("desc");
        }
    }

    const sortedScores = useMemo(() => {
        const withValue = (score: Score) => {
            if (sortKey === "gross") return score.adjusted_gross ?? -Infinity;
            if (sortKey === "stableford") return score.stableford_points ?? -Infinity;
            return new Date(score.play_date).getTime();
        };

        return [...scores].sort((a, b) => {
            const diff = withValue(a) - withValue(b);
            return sortDir === "asc" ? diff : -diff;
        });
    }, [scores, sortKey, sortDir]);

    function sortArrow(key: "date" | "gross" | "stableford") {
        if (sortKey !== key) return "";
        return sortDir === "asc" ? " ↑" : " ↓";
    }

    const averageStableford = useMemo(() => {
        const withPoints = scores.filter((score) => score.stableford_points);

        if (withPoints.length === 0) return 0;

        return (
            withPoints.reduce((sum, score) => sum + (score.stableford_points || 0), 0) /
            withPoints.length
        );
    }, [scores]);

    return (
        <>
            <header className="topbar">
                <div>
                    <BrandLogo />
                </div>

                <TopbarActions>
                    <NavButton to="/rounds">My Rounds</NavButton>
                    <NavButton to="/stats">Stats</NavButton>
                    <NavButton to="/map">World Map</NavButton>
                    <NavButton to="/handicap">Handicap</NavButton>
                    <NavButton to="/wellness">Wellness</NavButton>
                    <NavButton to="/teesheet">Teesheet</NavButton>
                    <FeedNavButton />
                    <NavButton to="/settings">Settings</NavButton>
                </TopbarActions>
            </header>

            <main className="content">
                <section className="course-hero">
                    <p className="eyebrow">HANDICAPS.CO.ZA</p>

                    <h2>Your handicap journey.</h2>

                    <p>
                        {loading
                            ? "Loading your handicap history..."
                            : syncError
                            ? `Last sync failed: ${syncError}`
                            : syncing
                            ? "Syncing the latest scores from handicaps.co.za in the background..."
                            : justSynced
                            ? "Just synced the latest scores from handicaps.co.za."
                            : "Up to date — this syncs with handicaps.co.za once a day."}
                    </p>
                </section>

                <section className="stats-grid">
                    <div className="stat-card">
                        <span>Current handicap</span>
                        <strong>{currentHandicap ?? "—"}</strong>
                    </div>

                    <div className="stat-card">
                        <span>Lowest handicap</span>
                        <strong>{lowestHandicap ?? "—"}</strong>
                    </div>

                    <div className="stat-card">
                        <span>Rounds on record</span>
                        <strong>{scores.length > 0 ? history.length : "—"}</strong>
                    </div>

                    <div className="stat-card">
                        <span>Average Stableford</span>
                        <strong>
                            {averageStableford > 0 ? averageStableford.toFixed(1) : "—"}
                        </strong>
                    </div>
                </section>

                <section className="chart-grid">
                    <div className="chart-card chart-card-wide">
                        <div className="chart-heading">
                            <div>
                                <p className="eyebrow">TREND</p>
                                <h3>Handicap index — last 6 months</h3>
                            </div>
                        </div>

                        <div className="chart-container">
                            {trend.length > 0 ? (
                                <ResponsiveContainer width="100%" height={340}>
                                    <LineChart data={trend}>
                                        <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
                                        <XAxis dataKey="date" tick={chart.tick} />
                                        <YAxis domain={["dataMin - 1", "dataMax + 1"]} tick={chart.tick} />
                                        <Tooltip
                                            contentStyle={chart.tooltipStyle}
                                            labelStyle={chart.tooltipLabelStyle}
                                            formatter={(value) => [value, "Handicap"]}
                                        />
                                        <Line
                                            type="monotone"
                                            dataKey="handicap"
                                            stroke="#3b82f6"
                                            strokeWidth={3}
                                            dot={false}
                                        />
                                    </LineChart>
                                </ResponsiveContainer>
                            ) : (
                                <p className="course-count">
                                    {loading
                                        ? "Loading your handicap history..."
                                        : "No handicap data yet."}
                                </p>
                            )}
                        </div>
                    </div>
                </section>

                <section className="section-heading">
                    <div>
                        <p className="eyebrow">SCORE HISTORY</p>
                        <h3>Recent rounds</h3>
                    </div>

                    <span className="course-count">{scores.length} shown</span>
                </section>

                <div className="round-list-header">
                    <button
                        className={sortKey === "date" ? "active" : ""}
                        onClick={() => toggleSort("date")}
                    >
                        Date{sortArrow("date")}
                    </button>

                    <button
                        className={sortKey === "gross" ? "active" : ""}
                        onClick={() => toggleSort("gross")}
                    >
                        Gross{sortArrow("gross")}
                    </button>

                    <button
                        className={sortKey === "stableford" ? "active" : ""}
                        onClick={() => toggleSort("stableford")}
                    >
                        Stableford{sortArrow("stableford")}
                    </button>

                    <span>Handicap</span>
                </div>

                <div className="round-list">
                    {sortedScores.map((score) => (
                        <div className="round-row" key={score.id}>
                            <div>
                                <strong>{formatDate(score.play_date)}</strong>
                                <span>
                                    {score.country_flag_url && (
                                        <img
                                            src={score.country_flag_url}
                                            alt={score.country_name || ""}
                                            title={score.country_name || undefined}
                                            className="country-flag"
                                            onError={(event) => {
                                                event.currentTarget.style.display = "none";
                                            }}
                                        />
                                    )}
                                    {score.course_name || "—"}
                                </span>
                            </div>

                            <div>
                                <strong>{score.adjusted_gross ?? "—"}</strong>
                                <span>Gross</span>
                            </div>

                            <div>
                                <strong>{score.stableford_points ?? "—"}</strong>
                                <span>Stableford</span>
                            </div>

                            <div>
                                <strong>{score.handicap_index ?? "—"}</strong>
                                <span>Handicap</span>
                            </div>
                        </div>
                    ))}
                </div>
            </main>
        </>
    );
}

export default HandicapPage;
