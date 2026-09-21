import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
    BarChart,
    Bar,
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from "recharts";
import { API, authFetch } from "./api";

const CHART_ACCENT = "#e8b84b";
const CHART_GRID = "rgba(255,255,255,0.08)";
const CHART_TICK = { fill: "#8b93a1", fontSize: 11 };
const CHART_TOOLTIP_STYLE = {
    background: "#191c22",
    border: "1px solid rgba(255,255,255,0.16)",
    borderRadius: 4,
    color: "#f4f5f7",
};
const CHART_TOOLTIP_LABEL_STYLE = { color: "#8b93a1" };

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

type ScoreDate = {
    play_date: string;
};

function StatsPage() {
    const navigate = useNavigate();

    const [activities, setActivities] = useState<Activity[]>([]);
    const [courses, setCourses] = useState<Course[]>([]);
    const [stats, setStats] = useState<Stats>({});
    const [allScores, setAllScores] = useState<ScoreDate[]>([]);

    useEffect(() => {
        async function load() {
            const [activitiesRes, coursesRes, statsRes, scoresRes] = await Promise.all([
                authFetch(`${API}/activities`),
                authFetch(`${API}/courses`),
                authFetch(`${API}/stats`),
                authFetch(`${API}/handicap/scores?limit=5000`),
            ]);

            setActivities(await activitiesRes.json());
            setCourses(await coursesRes.json());
            setStats(await statsRes.json());
            setAllScores(await scoresRes.json());
        }

        load();
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
            .sort((a, b) => Number(a.year) - Number(b.year));
    }, [allScores]);

    const distanceByMonth = useMemo(() => {
        const grouped: Record<string, number> = {};

        activities.forEach((activity) => {
            const date = new Date(activity.start_date);

            const key = `${date.getFullYear()}-${String(
                date.getMonth() + 1
            ).padStart(2, "0")}`;

            grouped[key] =
                (grouped[key] || 0) + (activity.distance_m || 0) / 1000;
        });

        return Object.entries(grouped)
            .map(([month, distance]) => ({
                month,
                distance: Number(distance.toFixed(1)),
            }))
            .sort((a, b) => a.month.localeCompare(b.month));
    }, [activities]);

    const topCourses = useMemo(() => {
        return [...courses]
            .sort((a, b) => b.rounds_played - a.rounds_played)
            .slice(0, 10)
            .map((course) => ({
                name: course.name,
                rounds: course.rounds_played,
            }));
    }, [courses]);

    const totalDistance = activities.reduce(
        (sum, activity) => sum + (activity.distance_m || 0),
        0
    );

    const totalElevation = activities.reduce(
        (sum, activity) => sum + (activity.elevation_gain_m || 0),
        0
    );

    const averageDistance =
        activities.length > 0
            ? totalDistance / activities.length / 1000
            : 0;

    return (
        <>
            <header className="topbar">
                <div>
                    <div className="brand-kicker">MY GOLF JOURNEY</div>
                    <h1>Golf Statistics</h1>
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
                </div>
            </header>

            <main className="content">
                <section className="course-hero">
                    <p className="eyebrow">CAREER STATISTICS</p>

                    <h2>Your golf in numbers.</h2>

                    <p>
                        Rounds from your handicaps.co.za record, with GPS and
                        distance from Strava where available.
                    </p>
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

                    <div className="stat-card">
                        <span>Golf distance (GPS-tracked)</span>
                        <strong>{(totalDistance / 1000).toFixed(1)} km</strong>
                    </div>

                    <div className="stat-card">
                        <span>Avg distance / tracked round</span>
                        <strong>{averageDistance.toFixed(1)} km</strong>
                    </div>
                </section>

                <section className="chart-grid">
                    <div className="chart-card">
                        <div className="chart-heading">
                            <div>
                                <p className="eyebrow">ACTIVITY</p>
                                <h3>Rounds per year</h3>
                            </div>
                        </div>

                        <div className="chart-container">
                            <ResponsiveContainer width="100%" height={300}>
                                <BarChart data={roundsByYear}>
                                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                                    <XAxis dataKey="year" tick={CHART_TICK} />
                                    <YAxis allowDecimals={false} tick={CHART_TICK} />
                                    <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} />
                                    <Bar
                                        dataKey="rounds"
                                        fill={CHART_ACCENT}
                                        radius={[2, 2, 0, 0]}
                                    />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    <div className="chart-card">
                        <div className="chart-heading">
                            <div>
                                <p className="eyebrow">COURSES</p>
                                <h3>Most played courses</h3>
                            </div>
                        </div>

                        <div className="chart-container">
                            <ResponsiveContainer width="100%" height={300}>
                                <BarChart
                                    data={topCourses}
                                    layout="vertical"
                                    margin={{
                                        left: 30,
                                        right: 20,
                                    }}
                                >
                                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} horizontal={false} />
                                    <XAxis type="number" allowDecimals={false} tick={CHART_TICK} />
                                    <YAxis
                                        type="category"
                                        dataKey="name"
                                        width={130}
                                        tick={CHART_TICK}
                                    />
                                    <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} />
                                    <Bar
                                        dataKey="rounds"
                                        fill={CHART_ACCENT}
                                        radius={[0, 2, 2, 0]}
                                    />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    <div className="chart-card chart-card-wide">
                        <div className="chart-heading">
                            <div>
                                <p className="eyebrow">DISTANCE</p>
                                <h3>Golf kilometres over time</h3>
                            </div>
                        </div>

                        <div className="chart-container">
                            <ResponsiveContainer width="100%" height={330}>
                                <LineChart data={distanceByMonth}>
                                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                                    <XAxis
                                        dataKey="month"
                                        tick={CHART_TICK}
                                    />
                                    <YAxis tick={CHART_TICK} />
                                    <Tooltip
                                        contentStyle={CHART_TOOLTIP_STYLE}
                                        labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                                        formatter={(value) => [`${value} km`, "Distance"]}
                                    />
                                    <Line
                                        type="monotone"
                                        dataKey="distance"
                                        stroke={CHART_ACCENT}
                                        strokeWidth={3}
                                        dot={{ r: 4, fill: CHART_ACCENT }}
                                    />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </section>

                <section className="stats-summary">
                    <div>
                        <span>Total elevation climbed while golfing</span>
                        <strong>{Math.round(totalElevation).toLocaleString()} m</strong>
                    </div>

                    <div>
                        <span>Most played course</span>
                        <strong>
                            {topCourses.length > 0 ? topCourses[0].name : "—"}
                        </strong>
                    </div>
                </section>
            </main>
        </>
    );
}

export default StatsPage;