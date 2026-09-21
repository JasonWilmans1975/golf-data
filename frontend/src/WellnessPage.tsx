import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
    LineChart,
    Line,
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
} from "recharts";
import { API, authFetch } from "./api";
import ThemeToggle from "./ThemeToggle";
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
        accent: "#e2231a",
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

type DailyStat = {
    stat_date: string;
    total_calories: number | null;
    active_calories: number | null;
    resting_calories: number | null;
    average_heart_rate: number | null;
    resting_heart_rate: number | null;
    sleep_score: number | null;
    sleep_score_qualifier: string | null;
    sleep_seconds: number | null;
};

type Granularity = "day" | "week" | "month" | "custom";

function formatDate(value: string) {
    return new Intl.DateTimeFormat("en-ZA", {
        day: "numeric",
        month: "short",
    }).format(new Date(value));
}

function formatMonth(value: string) {
    return new Intl.DateTimeFormat("en-ZA", {
        month: "short",
        year: "2-digit",
    }).format(new Date(`${value}-01`));
}

// Monday of the week containing this date, as the bucket key.
function weekKey(dateStr: string) {
    const date = new Date(dateStr);
    const day = date.getDay();
    const diffToMonday = (day + 6) % 7;
    date.setDate(date.getDate() - diffToMonday);
    return date.toISOString().slice(0, 10);
}

function monthKey(dateStr: string) {
    return dateStr.slice(0, 7);
}

function average(values: number[]): number | null {
    if (values.length === 0) return null;
    return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
}

function aggregateByKey(rows: DailyStat[], keyFn: (date: string) => string) {
    const buckets = new Map<
        string,
        {
            activeCalories: number[];
            restingCalories: number[];
            heartRate: number[];
            sleepScore: number[];
        }
    >();

    for (const row of rows) {
        const key = keyFn(row.stat_date);
        const bucket = buckets.get(key) || {
            activeCalories: [],
            restingCalories: [],
            heartRate: [],
            sleepScore: [],
        };

        if (row.active_calories != null) bucket.activeCalories.push(row.active_calories);
        if (row.resting_calories != null) bucket.restingCalories.push(row.resting_calories);
        if (row.average_heart_rate != null) bucket.heartRate.push(row.average_heart_rate);
        if (row.sleep_score != null) bucket.sleepScore.push(row.sleep_score);

        buckets.set(key, bucket);
    }

    return [...buckets.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, bucket]) => ({
            date,
            activeCalories: average(bucket.activeCalories),
            restingCalories: average(bucket.restingCalories),
            heartRate: average(bucket.heartRate),
            sleepScore: average(bucket.sleepScore),
        }));
}

function WellnessPage() {
    const navigate = useNavigate();
    const { theme } = useTheme();
    const chart = CHART_PALETTES[theme];

    const [days, setDays] = useState<DailyStat[]>([]);
    const [loading, setLoading] = useState(true);
    const [syncError, setSyncError] = useState<string | null>(null);
    const [justSynced, setJustSynced] = useState(false);

    const [granularity, setGranularity] = useState<Granularity>("day");
    const [customStart, setCustomStart] = useState("");
    const [customEnd, setCustomEnd] = useState("");

    useEffect(() => {
        async function load() {
            setLoading(true);
            setSyncError(null);

            try {
                const syncResponse = await authFetch(`${API}/garmin/sync`, {
                    method: "POST",
                });

                const body = await syncResponse.json().catch(() => null);

                if (!syncResponse.ok) {
                    setSyncError(
                        body?.detail || "Could not sync with Garmin Connect"
                    );
                } else {
                    setJustSynced(body?.skipped === false);
                }
            } catch (error) {
                console.error(error);
                setSyncError("Could not reach the backend to sync");
            }

            try {
                const response = await authFetch(`${API}/garmin/wellness?days=120`);

                if (response.ok) {
                    setDays(await response.json());
                }
            } catch (error) {
                console.error(error);
            } finally {
                setLoading(false);
            }
        }

        load();
    }, []);

    useEffect(() => {
        if (days.length === 0 || customStart || customEnd) return;

        setCustomStart(days[0].stat_date);
        setCustomEnd(days[days.length - 1].stat_date);
    }, [days]);

    const latest = days.length > 0 ? days[days.length - 1] : null;

    const trend = useMemo(() => {
        if (granularity === "week") {
            return aggregateByKey(days, weekKey);
        }

        if (granularity === "month") {
            return aggregateByKey(days, monthKey);
        }

        const rows =
            granularity === "custom" && customStart && customEnd
                ? days.filter(
                      (day) => day.stat_date >= customStart && day.stat_date <= customEnd
                  )
                : days;

        return rows.map((day) => ({
            date: day.stat_date,
            activeCalories: day.active_calories,
            restingCalories: day.resting_calories,
            heartRate: day.average_heart_rate,
            sleepScore: day.sleep_score,
        }));
    }, [days, granularity, customStart, customEnd]);

    const formatAxisLabel = granularity === "month" ? formatMonth : formatDate;

    return (
        <>
            <header className="topbar">
                <div>
                    <div className="brand-kicker">MY GOLF JOURNEY</div>
                    <h1>Wellness</h1>
                </div>

                <div className="topbar-actions">
                    <button
                        className="header-secondary-button"
                        onClick={() => navigate("/")}
                    >
                        Home
                    </button>

                    <button
                        className="header-secondary-button"
                        onClick={() => navigate("/stats")}
                    >
                        Stats
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
                        onClick={() => navigate("/settings")}
                    >
                        Settings
                    </button>

                    <ThemeToggle />
                </div>
            </header>

            <main className="content">
                <section className="course-hero">
                    <p className="eyebrow">GARMIN CONNECT</p>

                    <h2>Your daily wellness.</h2>

                    <p>
                        {loading
                            ? "Loading your wellness data..."
                            : syncError
                            ? `Last sync failed: ${syncError}`
                            : justSynced
                            ? "Just synced the latest data from Garmin Connect."
                            : "Up to date — this syncs with Garmin Connect once a day."}
                    </p>
                </section>

                <section className="stats-grid">
                    <div className="stat-card">
                        <span>Calories burned {latest ? `(${formatDate(latest.stat_date)})` : ""}</span>
                        <strong>{latest?.total_calories ?? "—"}</strong>
                    </div>

                    <div className="stat-card">
                        <span>Average heart rate</span>
                        <strong>
                            {latest?.average_heart_rate
                                ? `${latest.average_heart_rate} bpm`
                                : "—"}
                        </strong>
                    </div>

                    <div className="stat-card">
                        <span>Sleep score</span>
                        <strong>
                            {latest?.sleep_score ?? "—"}
                            {latest?.sleep_score_qualifier && (
                                <span style={{ fontSize: 13, marginLeft: 8, opacity: 0.7 }}>
                                    {latest.sleep_score_qualifier}
                                </span>
                            )}
                        </strong>
                    </div>
                </section>

                <div className="granularity-bar">
                    <div className="granularity-toggle">
                        {(["day", "week", "month", "custom"] as Granularity[]).map((option) => (
                            <button
                                key={option}
                                className={granularity === option ? "active" : ""}
                                onClick={() => setGranularity(option)}
                            >
                                {option}
                            </button>
                        ))}
                    </div>

                    {granularity === "custom" && (
                        <div className="granularity-range">
                            <input
                                type="date"
                                value={customStart}
                                min={days[0]?.stat_date}
                                max={customEnd || days[days.length - 1]?.stat_date}
                                onChange={(event) => setCustomStart(event.target.value)}
                            />
                            <span>to</span>
                            <input
                                type="date"
                                value={customEnd}
                                min={customStart || days[0]?.stat_date}
                                max={days[days.length - 1]?.stat_date}
                                onChange={(event) => setCustomEnd(event.target.value)}
                            />
                        </div>
                    )}
                </div>

                <section className="chart-grid">
                    <div className="chart-card">
                        <div className="chart-heading">
                            <div>
                                <p className="eyebrow">TREND</p>
                                <h3>Calories burned</h3>
                            </div>
                        </div>

                        <div className="chart-container">
                            {trend.length > 0 ? (
                                <ResponsiveContainer width="100%" height={240}>
                                    <BarChart data={trend}>
                                        <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
                                        <XAxis dataKey="date" tickFormatter={formatAxisLabel} tick={chart.tick} />
                                        <YAxis tick={chart.tick} />
                                        <Tooltip
                                            contentStyle={chart.tooltipStyle}
                                            labelStyle={chart.tooltipLabelStyle}
                                            labelFormatter={(value) => formatAxisLabel(String(value))}
                                        />
                                        <Legend
                                            wrapperStyle={{ fontSize: 12, color: chart.tick.fill }}
                                        />
                                        <Bar
                                            dataKey="restingCalories"
                                            name="Resting"
                                            stackId="calories"
                                            fill="#3b82f6"
                                        />
                                        <Bar
                                            dataKey="activeCalories"
                                            name="Active"
                                            stackId="calories"
                                            fill="#22c55e"
                                        />
                                    </BarChart>
                                </ResponsiveContainer>
                            ) : (
                                <p className="course-count">
                                    {loading ? "Loading..." : "No wellness data yet."}
                                </p>
                            )}
                        </div>
                    </div>

                    <div className="chart-card">
                        <div className="chart-heading">
                            <div>
                                <p className="eyebrow">TREND</p>
                                <h3>Average heart rate</h3>
                            </div>
                        </div>

                        <div className="chart-container">
                            {trend.length > 0 ? (
                                <ResponsiveContainer width="100%" height={240}>
                                    <LineChart data={trend}>
                                        <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
                                        <XAxis dataKey="date" tickFormatter={formatAxisLabel} tick={chart.tick} />
                                        <YAxis tick={chart.tick} domain={["dataMin - 5", "dataMax + 5"]} />
                                        <Tooltip
                                            contentStyle={chart.tooltipStyle}
                                            labelStyle={chart.tooltipLabelStyle}
                                            labelFormatter={(value) => formatAxisLabel(String(value))}
                                            formatter={(value) => [`${value} bpm`, "Avg heart rate"]}
                                        />
                                        <Line
                                            type="monotone"
                                            dataKey="heartRate"
                                            stroke="#3b82f6"
                                            strokeWidth={3}
                                            dot={false}
                                            connectNulls
                                        />
                                    </LineChart>
                                </ResponsiveContainer>
                            ) : (
                                <p className="course-count">
                                    {loading ? "Loading..." : "No wellness data yet."}
                                </p>
                            )}
                        </div>
                    </div>

                    <div className="chart-card">
                        <div className="chart-heading">
                            <div>
                                <p className="eyebrow">TREND</p>
                                <h3>Sleep score</h3>
                            </div>
                        </div>

                        <div className="chart-container">
                            {trend.length > 0 ? (
                                <ResponsiveContainer width="100%" height={240}>
                                    <LineChart data={trend}>
                                        <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
                                        <XAxis dataKey="date" tickFormatter={formatAxisLabel} tick={chart.tick} />
                                        <YAxis tick={chart.tick} domain={[0, 100]} />
                                        <Tooltip
                                            contentStyle={chart.tooltipStyle}
                                            labelStyle={chart.tooltipLabelStyle}
                                            labelFormatter={(value) => formatAxisLabel(String(value))}
                                            formatter={(value) => [value, "Sleep score"]}
                                        />
                                        <Line
                                            type="monotone"
                                            dataKey="sleepScore"
                                            stroke="#22c55e"
                                            strokeWidth={3}
                                            dot={false}
                                            connectNulls
                                        />
                                    </LineChart>
                                </ResponsiveContainer>
                            ) : (
                                <p className="course-count">
                                    {loading ? "Loading..." : "No wellness data yet."}
                                </p>
                            )}
                        </div>
                    </div>
                </section>
            </main>
        </>
    );
}

export default WellnessPage;
