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
import AppNav from "./AppNav";
import BrandLogo from "./BrandLogo";
import { useTheme } from "./useTheme";
import { useIntegrations } from "./IntegrationsContext";

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

type Activity = {
    id: number;
    name: string;
    start_date: string;
    distance_m: number;
    moving_time_s: number;
    elapsed_time_s: number;
    elevation_gain_m: number;
    course_id: number | null;
};

type Course = {
    id: number;
    name: string;
    rounds_played: number;
};

type Stats = {
    rounds?: number;
    distance_km?: number;
    elevation_m?: number;
    moving_hours?: number;
};

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

function StatsPage() {
    const navigate = useNavigate();
    const { theme } = useTheme();
    const chart = CHART_PALETTES[theme];
    // Distance/elevation/GPS come from golf_activities, which is only ever
    // populated by Strava or Garmin syncs -- showing those cards for
    // someone connected to neither (e.g. handicaps.co.za only) just shows
    // rows of zero, which reads as broken rather than empty. Same idea for
    // handicap-specific sections and whether handicaps.co.za is connected.
    const { strava, garmin, handicap: handicapConnected } = useIntegrations();
    const hasActivityData = strava || garmin;

    const [activities, setActivities] = useState<Activity[]>([]);
    const [courses, setCourses] = useState<Course[]>([]);
    const [stats, setStats] = useState<Stats>({});
    const [allScores, setAllScores] = useState<Score[]>([]);
    const [history, setHistory] = useState<HandicapSnapshot[]>([]);
    const [currentHandicap, setCurrentHandicap] = useState<number | null>(null);

    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [syncError, setSyncError] = useState<string | null>(null);
    const [justSynced, setJustSynced] = useState(false);

    const [sortKey, setSortKey] = useState<"date" | "gross" | "stableford">("date");
    const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

    useEffect(() => {
        async function loadData() {
            const [activitiesRes, coursesRes, statsRes, scoresRes, historyRes, currentRes] = await Promise.all([
                authFetch(`${API}/activities`),
                authFetch(`${API}/courses`),
                authFetch(`${API}/stats`),
                authFetch(`${API}/handicap/scores?limit=5000`),
                authFetch(`${API}/handicap`),
                authFetch(`${API}/handicap/current`),
            ]);

            setActivities(await activitiesRes.json());
            setCourses(await coursesRes.json());
            setStats(await statsRes.json());
            setAllScores(await scoresRes.json());
            setHistory(await historyRes.json());

            const current = await currentRes.json();
            setCurrentHandicap(current?.current_handicap_index ?? null);
        }

        async function init() {
            try {
                // Show whatever's already in the database immediately -- a
                // Playwright scrape of handicaps.co.za only needs to run once
                // a day, so most page loads shouldn't wait on it at all.
                await loadData();
            } catch (error) {
                console.error(error);
            } finally {
                setLoading(false);
            }

            setSyncing(true);
            setSyncError(null);

            try {
                const syncResponse = await authFetch(`${API}/handicap/sync`, {
                    method: "POST",
                });

                const body = await syncResponse.json().catch(() => null);

                if (!syncResponse.ok) {
                    setSyncError(body?.detail || "Could not sync with handicaps.co.za");
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

    const roundsByYear = useMemo(() => {
        const grouped: Record<string, number> = {};

        allScores.forEach((score) => {
            const year = new Date(score.play_date).getFullYear().toString();
            grouped[year] = (grouped[year] || 0) + 1;
        });

        return Object.entries(grouped)
            .map(([year, rounds]) => ({
                year,
                rounds,
            }))
            .sort((a, b) => Number(b.year) - Number(a.year))
            .slice(0, 16);
    }, [allScores]);

    const totalDistance = activities.reduce(
        (sum, activity) => sum + (activity.distance_m || 0),
        0
    );

    const averageDistance =
        activities.length > 0
            ? totalDistance / activities.length / 1000
            : 0;

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

    const averageStableford = useMemo(() => {
        const withPoints = allScores.filter((score) => score.stableford_points);

        if (withPoints.length === 0) return 0;

        return (
            withPoints.reduce((sum, score) => sum + (score.stableford_points || 0), 0) /
            withPoints.length
        );
    }, [allScores]);

    // "Recent rounds" only ever shows the most recent 50 -- allScores is
    // fetched up to 5000 rows deep for the rounds-per-year chart above, so
    // this reuses that same fetch instead of a second network round trip.
    const recentScores = useMemo(
        () =>
            [...allScores]
                .sort((a, b) => new Date(b.play_date).getTime() - new Date(a.play_date).getTime())
                .slice(0, 50),
        [allScores]
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

        return [...recentScores].sort((a, b) => {
            const diff = withValue(a) - withValue(b);
            return sortDir === "asc" ? diff : -diff;
        });
    }, [recentScores, sortKey, sortDir]);

    function sortArrow(key: "date" | "gross" | "stableford") {
        if (sortKey !== key) return "";
        return sortDir === "asc" ? " ↑" : " ↓";
    }

    return (
        <>
            <header className="topbar">
                <div>
                    <BrandLogo />
                </div>

                <AppNav />
            </header>

            <main className="content">
                <section className="course-hero">
                    <p className="eyebrow">CAREER STATISTICS</p>

                    <h2>Your golf in numbers.</h2>

                    {handicapConnected ? (
                        <p>
                            {(loading || syncing) && <span className="spinner" />}
                            {loading
                                ? "Loading your handicap history..."
                                : syncError
                                ? `Last sync failed: ${syncError}`
                                : syncing
                                ? "Connecting to handicaps.co.za in the background..."
                                : justSynced
                                ? "Just synced the latest scores from handicaps.co.za."
                                : "Up to date — this syncs with handicaps.co.za once a day."}
                        </p>
                    ) : (
                        <p>
                            Rounds from your handicaps.co.za record, with GPS and
                            distance from Strava or Garmin where available.
                        </p>
                    )}
                </section>

                <section className="stats-grid">
                    <div className="stat-card">
                        <span>Total rounds</span>
                        <strong>{stats.rounds ?? activities.length}</strong>
                    </div>

                    <div className="stat-card">
                        <span>Courses played</span>
                        <strong>{courses.length}</strong>
                    </div>

                    {handicapConnected && (
                        <div className="stat-card">
                            <span>Current handicap</span>
                            <strong>{currentHandicap ?? "—"}</strong>
                        </div>
                    )}

                    {handicapConnected && (
                        <div className="stat-card">
                            <span>Lowest handicap</span>
                            <strong>{lowestHandicap ?? "—"}</strong>
                        </div>
                    )}

                    {handicapConnected && (
                        <div className="stat-card">
                            <span>Average Stableford</span>
                            <strong>
                                {averageStableford > 0 ? averageStableford.toFixed(1) : "—"}
                            </strong>
                        </div>
                    )}

                    {hasActivityData && (
                        <div className="stat-card">
                            <span>Golf distance (GPS-tracked)</span>
                            <strong>{(totalDistance / 1000).toFixed(1)} km</strong>
                        </div>
                    )}

                    {hasActivityData && (
                        <div className="stat-card">
                            <span>Avg distance / tracked round</span>
                            <strong>{averageDistance.toFixed(1)} km</strong>
                        </div>
                    )}
                </section>

                <section className="chart-grid">
                    {handicapConnected && (
                        <div className="chart-card chart-card-wide">
                            <div className="chart-heading">
                                <div>
                                    <p className="eyebrow">TREND</p>
                                    <h3>Handicap index — last 6 months</h3>
                                </div>
                            </div>

                            <div className="chart-container">
                                {trend.length > 0 ? (
                                    <ResponsiveContainer width="100%" height={300}>
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
                                        {loading ? "Loading your handicap history..." : "No handicap data yet."}
                                    </p>
                                )}
                            </div>
                        </div>
                    )}

                    <div className="chart-card chart-card-wide">
                        <div className="chart-heading">
                            <div>
                                <p className="eyebrow">ACTIVITY</p>
                                <h3>Rounds per year</h3>
                            </div>
                        </div>

                        <div className="round-list">
                            {roundsByYear.map((row) => (
                                <div className="year-row" key={row.year}>
                                    <strong>{row.year}</strong>
                                    <span>{row.rounds} {row.rounds === 1 ? "round" : "rounds"}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                {handicapConnected && (
                    <>
                        <section className="section-heading">
                            <div>
                                <p className="eyebrow">SCORE HISTORY</p>
                                <h3>Recent rounds</h3>
                            </div>

                            <span className="course-count">{sortedScores.length} shown</span>
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
                    </>
                )}
            </main>
        </>
    );
}

export default StatsPage;
