import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
    Routes,
    Route,
    Navigate,
    useNavigate,
    useParams,
} from "react-router-dom";

import "./styles.css";

import StatsPage from "./StatsPage";
import MapPage from "./MapPage";
import HandicapPage from "./HandicapPage";
import WellnessPage from "./WellnessPage";
import TeesheetPage from "./TeesheetPage";
import LoginPage from "./LoginPage";
import SettingsPage from "./SettingsPage";
import { AuthProvider, useAuth } from "./AuthContext";
import { supabase } from "./supabaseClient";

import {
    MapContainer,
    TileLayer,
    Polyline,
    Marker,
    useMap,
} from "react-leaflet";

import polyline from "@mapbox/polyline";
import L from "leaflet";

import "leaflet/dist/leaflet.css";

import { API, authFetch, uploadCoursePhoto, courseMarkerIcon } from "./api";
import TopbarActions from "./TopbarActions";

type Course = {
    id: number;
    name: string;
    city: string | null;
    province: string | null;
    country: string | null;
    latitude: number | null;
    longitude: number | null;
    rounds_played: number;
    first_played: string | null;
    last_played: string | null;
    formatted_address: string | null;
    photo_url: string | null;
    website_url: string | null;
    phone_number: string | null;
    description: string | null;
    google_photo_url: string | null;
};

type Activity = {
    id: number;
    strava_activity_id: number;
    name: string;
    start_date: string;
    distance_m: number;
    moving_time_s: number;
    elapsed_time_s: number;
    elevation_gain_m: number;
    course_id: number | null;
    map_polyline: string | null;
    start_latlng?: [number, number] | null;
};

type Stats = {
    rounds?: number;
    total_distance_km?: number;
    total_elevation_m?: number;
    total_moving_hours?: number;
};

type Score = {
    id: number;
    score_id: number;
    play_date: string;
    handicap_index: number | null;
    adjusted_gross: number | null;
    stableford_points: number | null;
    course_id: number | null;
};

function formatDate(value: string | null) {
    if (!value) return "—";

    return new Intl.DateTimeFormat("en-ZA", {
        day: "numeric",
        month: "short",
        year: "numeric",
    }).format(new Date(value));
}

function FitRouteBounds({
                            routes,
                        }: {
    routes: [number, number][][];
}) {
    const map = useMap();

    useEffect(() => {
        const points = routes.flat();

        if (!points.length) return;

        const bounds = L.latLngBounds(points);

        map.fitBounds(bounds, {
            padding: [30, 30],
            maxZoom: 16,
        });
    }, [routes, map]);

    return null;
}

function Dashboard() {
    const navigate = useNavigate();

    const [courses, setCourses] = useState<Course[]>([]);
    const [stats, setStats] = useState<Stats>({});
    const [currentHandicap, setCurrentHandicap] = useState<number | null>(null);
    const [todaySteps, setTodaySteps] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [mergingCourseId, setMergingCourseId] = useState<number | null>(null);

    async function handleMerge(sourceId: number, targetId: number) {
        const source = courses.find((course) => course.id === sourceId);
        const target = courses.find((course) => course.id === targetId);

        if (
            !window.confirm(
                `Merge "${source?.name}" into "${target?.name}"? This moves all its rounds over and deletes "${source?.name}". This cannot be undone.`
            )
        ) {
            return;
        }

        try {
            const response = await fetch(
                `${API}/courses/${sourceId}/merge?into_course_id=${targetId}`,
                { method: "POST" }
            );

            if (!response.ok) {
                throw new Error("Merge failed");
            }

            setMergingCourseId(null);
            await loadDashboard();
        } catch (error) {
            console.error(error);
        }
    }

    async function loadDashboard() {
        try {
            const [coursesRes, statsRes] = await Promise.all([
                authFetch(`${API}/courses`),
                authFetch(`${API}/stats`),
            ]);

            if (!coursesRes.ok) {
                throw new Error("Failed to load courses");
            }

            if (!statsRes.ok) {
                throw new Error("Failed to load stats");
            }

            setCourses(await coursesRes.json());
            setStats(await statsRes.json());
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }

        try {
            const [handicapRes, wellnessRes] = await Promise.all([
                authFetch(`${API}/handicap/current`),
                authFetch(`${API}/garmin/wellness?days=1`),
            ]);

            if (handicapRes.ok) {
                const body = await handicapRes.json();
                setCurrentHandicap(body?.current_handicap_index ?? null);
            }

            if (wellnessRes.ok) {
                const days: { total_steps: number | null }[] = await wellnessRes.json();
                setTodaySteps(days.length > 0 ? days[days.length - 1].total_steps : null);
            }
        } catch (error) {
            console.error(error);
        }
    }

    async function handleSync() {
        setSyncing(true);

        try {
            const response = await authFetch(`${API}/sync`, {
                method: "POST",
            });

            if (response.status === 401) {
                const { data } = await supabase.auth.getSession();
                const token = data.session?.access_token;

                if (token) {
                    window.location.href = `${API}/auth/strava?token=${encodeURIComponent(token)}`;
                }

                return;
            }

            if (!response.ok) {
                throw new Error("Failed to sync Strava activities");
            }

            await detectCourses();
            await loadDashboard();
        } catch (error) {
            console.error(error);
        } finally {
            setSyncing(false);
        }
    }

    async function detectCourses() {
        try {
            const response = await authFetch(`${API}/courses/detect`, {
                method: "POST",
            });

            if (!response.ok) {
                throw new Error("Failed to detect courses");
            }
        } catch (error) {
            console.error(error);
        }
    }

    useEffect(() => {
        loadDashboard();

        if (new URLSearchParams(window.location.search).get("connected") === "1") {
            window.history.replaceState(null, "", "/");
            handleSync();
            return;
        }

        async function redirectFirstTimeUsers() {
            try {
                const [stravaRes, handicapRes, garminRes, teesheetRes] =
                    await Promise.all([
                        authFetch(`${API}/strava/status`),
                        authFetch(`${API}/handicap/credentials/status`),
                        authFetch(`${API}/garmin/credentials/status`),
                        authFetch(`${API}/teesheet/credentials/status`),
                    ]);

                const [strava, handicap, garmin, teesheet] = await Promise.all([
                    stravaRes.json().catch(() => ({})),
                    handicapRes.json().catch(() => ({})),
                    garminRes.json().catch(() => ({})),
                    teesheetRes.json().catch(() => ({})),
                ]);

                const hasAnyConnection =
                    strava.connected ||
                    handicap.connected ||
                    garmin.connected ||
                    teesheet.connected;

                if (!hasAnyConnection) {
                    navigate("/settings", { replace: true });
                }
            } catch (error) {
                console.error(error);
            }
        }

        redirectFirstTimeUsers();
    }, []);

    const totalRounds = useMemo(
        () =>
            courses.reduce(
                (sum, course) => sum + course.rounds_played,
                0
            ),
        [courses]
    );

    return (
        <>
            <header className="topbar">
                <div>
                    <div className="brand-kicker">
                        MY GOLF JOURNEY
                    </div>

                    <h1>Golf Journey</h1>
                </div>

                <TopbarActions>
                    <button
                        className="header-secondary-button"
                        onClick={() => navigate("/map")}
                    >
                        World Map
                    </button>

                    <button
                        className="header-secondary-button"
                        onClick={() => navigate("/stats")}
                    >
                        Stats
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

                    <button
                        className="header-secondary-button"
                        onClick={() => navigate("/teesheet")}
                    >
                        Teesheet
                    </button>

                    <button
                        className="header-secondary-button"
                        onClick={() => navigate("/settings")}
                    >
                        Settings
                    </button>
                </TopbarActions>
            </header>

            <main className="content">
                <section className="hero">
                    <div>
                        <p className="eyebrow">
                            YOUR GOLF HISTORY
                        </p>

                        <h2>Every course. Every round.</h2>

                        <p className="hero-copy">
                            Your complete golf journey, built from
                            your Strava golf activity.
                        </p>
                    </div>
                </section>

                <section className="stats-grid">
                    <div className="stat-card">
                        <span>Rounds</span>
                        <strong>
                            {stats.rounds ?? totalRounds}
                        </strong>
                    </div>

                    <div className="stat-card">
                        <span>Courses</span>
                        <strong>{courses.length}</strong>
                    </div>

                    <div className="stat-card">
                        <span>Handicap index</span>

                        <strong>
                            {currentHandicap ?? "—"}
                        </strong>
                    </div>

                    <div className="stat-card">
                        <span>Daily steps</span>

                        <strong>
                            {todaySteps != null
                                ? todaySteps.toLocaleString()
                                : "—"}
                        </strong>
                    </div>
                </section>

                <section className="section-heading">
                    <div>
                        <p className="eyebrow">
                            COURSE PASSPORT
                        </p>

                        <h3>My Courses</h3>
                    </div>

                    <span className="course-count">
            {courses.length} courses
          </span>
                </section>

                {loading ? (
                    <div className="loading-card">
                        Loading courses...
                    </div>
                ) : (
                    <section className="course-grid">
                        {[...courses]
                            .sort(
                                (a, b) =>
                                    b.rounds_played - a.rounds_played
                            )
                            .map((course) => (
                                <article
                                    className="course-card"
                                    key={course.id}
                                >
                                    <div className="course-card-top">
                                        <div>
                                            <p className="course-location">
                                                {course.city ||
                                                    course.country ||
                                                    course.formatted_address ||
                                                    "Golf course"}
                                            </p>

                                            <h4>{course.name}</h4>
                                        </div>

                                        <div className="round-pill">
                                            {course.rounds_played}{" "}
                                            {course.rounds_played === 1
                                                ? "round"
                                                : "rounds"}
                                        </div>
                                    </div>

                                    <div className="course-meta">
                                        <div>
                                            <span>First played</span>

                                            <strong>
                                                {formatDate(
                                                    course.first_played
                                                )}
                                            </strong>
                                        </div>

                                        <div>
                                            <span>Last played</span>

                                            <strong>
                                                {formatDate(
                                                    course.last_played
                                                )}
                                            </strong>
                                        </div>
                                    </div>

                                    <button
                                        className="view-button"
                                        onClick={() =>
                                            navigate(
                                                `/course/${course.id}`
                                            )
                                        }
                                    >
                                        View round details
                                    </button>

                                    {mergingCourseId === course.id ? (
                                        <select
                                            className="merge-select"
                                            defaultValue=""
                                            onChange={(event) => {
                                                const targetId = Number(
                                                    event.target.value
                                                );

                                                if (targetId) {
                                                    handleMerge(
                                                        course.id,
                                                        targetId
                                                    );
                                                }
                                            }}
                                            onBlur={() =>
                                                setMergingCourseId(null)
                                            }
                                        >
                                            <option value="" disabled>
                                                Merge into...
                                            </option>

                                            {[...courses]
                                                .filter(
                                                    (other) =>
                                                        other.id !== course.id
                                                )
                                                .sort((a, b) =>
                                                    a.name.localeCompare(
                                                        b.name
                                                    )
                                                )
                                                .map((other) => (
                                                    <option
                                                        key={other.id}
                                                        value={other.id}
                                                    >
                                                        {other.name}
                                                    </option>
                                                ))}
                                        </select>
                                    ) : (
                                        <button
                                            className="merge-link"
                                            onClick={() =>
                                                setMergingCourseId(course.id)
                                            }
                                        >
                                            Merge into another course
                                        </button>
                                    )}
                                </article>
                            ))}
                    </section>
                )}
            </main>
        </>
    );
}

function CourseDetail() {
    const { id } = useParams();
    const navigate = useNavigate();

    const [selectedRoundId, setSelectedRoundId] = useState<number | null>(null);

    const [course, setCourse] =
        useState<Course | null>(null);

    const [activities, setActivities] =
        useState<Activity[]>([]);

    const [scores, setScores] = useState<Score[]>([]);

    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function load() {
            try {
                const [coursesRes, activitiesRes, scoresRes] =
                    await Promise.all([
                        authFetch(`${API}/courses`),
                        authFetch(`${API}/activities`),
                        authFetch(`${API}/handicap/scores?limit=5000`),
                    ]);

                if (!coursesRes.ok) {
                    throw new Error(
                        "Failed to load courses"
                    );
                }

                if (!activitiesRes.ok) {
                    throw new Error(
                        "Failed to load activities"
                    );
                }

                const coursesData: Course[] =
                    await coursesRes.json();

                const activitiesData: Activity[] =
                    await activitiesRes.json();

                const selectedCourse =
                    coursesData.find(
                        (course) =>
                            course.id === Number(id)
                    );

                setCourse(selectedCourse || null);

                setActivities(
                    activitiesData.filter(
                        (activity) =>
                            activity.course_id === Number(id)
                    )
                );

                if (scoresRes.ok) {
                    const scoresData: Score[] = await scoresRes.json();

                    setScores(
                        scoresData.filter(
                            (score) => score.course_id === Number(id)
                        )
                    );
                }
            } catch (error) {
                console.error(error);
            } finally {
                setLoading(false);
            }
        }

        load();
    }, [id]);

    async function handlePhotoUpload(file: File | undefined) {
        if (!file || !course) return;

        try {
            const { photo_url } = await uploadCoursePhoto(course.id, file);

            setCourse((prev) => (prev ? { ...prev, photo_url } : prev));
        } catch (error) {
            console.error(error);
        }
    }

    const totalDistance = activities.reduce(
        (sum, activity) =>
            sum + (activity.distance_m || 0),
        0
    );

    const routeLines = useMemo(() => {
        return activities
            .filter(
                (activity) =>
                    activity.map_polyline &&
                    activity.map_polyline.length > 0
            )
            .map((activity) => {
                try {
                    const positions =
                        polyline.decode(
                            activity.map_polyline as string
                        ) as [number, number][];

                    return {
                        id: activity.id,
                        date: activity.start_date,
                        positions,
                    };
                } catch (error) {
                    console.error(
                        "Failed to decode polyline",
                        activity.id,
                        error
                    );

                    return null;
                }
            })
            .filter(
                (
                    route
                ): route is {
                    id: number;
                    date: string;
                    positions: [number, number][];
                } => route !== null
            );
    }, [activities]);

    const visibleRoutes = useMemo(
        () =>
            selectedRoundId !== null
                ? routeLines.filter((route) => route.id === selectedRoundId)
                : routeLines,
        [routeLines, selectedRoundId]
    );

    // Scores (handicaps.co.za) and activities (Strava/Garmin GPS) are
    // separate data sources joined only by course, not by a shared per-round
    // key — match by same calendar day so a round with GPS data can still
    // highlight its route when clicked.
    const activityByDate = useMemo(() => {
        const map = new Map<string, Activity>();

        for (const activity of activities) {
            const day = new Date(activity.start_date).toDateString();

            if (!map.has(day)) map.set(day, activity);
        }

        return map;
    }, [activities]);

    const mapCenter: [number, number] =
        course?.latitude !== null &&
        course?.latitude !== undefined &&
        course?.longitude !== null &&
        course?.longitude !== undefined
            ? [course.latitude, course.longitude]
            : routeLines.length > 0 &&
            routeLines[0].positions.length > 0
                ? routeLines[0].positions[0]
                : [-34.0, 18.4];

    if (loading) {
        return (
            <div className="loading-card">
                Loading course...
            </div>
        );
    }

    if (!course) {
        return (
            <div className="loading-card">
                Course not found.
            </div>
        );
    }

    return (
        <>
            <header className="topbar">
                <div>
                    <div className="brand-kicker">
                        GOLF JOURNEY
                    </div>

                    <h1>{course.name}</h1>
                </div>

                <TopbarActions>
                    <button
                        className="header-secondary-button"
                        onClick={() => navigate("/map")}
                    >
                        World Map
                    </button>

                    <button
                        className="sync-button"
                        onClick={() => navigate("/")}
                    >
                        Home
                    </button>
                </TopbarActions>
            </header>

            <main className="content">
                <section className="course-hero">
                    <div className="course-hero-row">
                        <div>
                            <p className="eyebrow">
                                COURSE HISTORY
                            </p>

                            <h2>{course.name}</h2>

                            <p>
                                {course.formatted_address ||
                                    course.city ||
                                    course.country ||
                                    "Golf course"}
                            </p>

                            <label className="photo-upload photo-upload--on-dark">
                                {course.photo_url ? "Change course photo" : "Add course photo"}
                                <input
                                    type="file"
                                    accept="image/*"
                                    onChange={(event) =>
                                        handlePhotoUpload(event.target.files?.[0])
                                    }
                                />
                            </label>
                        </div>

                        {course.google_photo_url && !course.photo_url && (
                            <img
                                className="course-hero-photo"
                                src={course.google_photo_url}
                                alt={course.name}
                            />
                        )}
                    </div>
                </section>

                {(course.description ||
                    course.website_url ||
                    course.phone_number) && (
                    <section className="course-info-card">
                        <div className="course-info-details">
                            {course.description && (
                                <p className="course-info-description">
                                    {course.description}
                                </p>
                            )}

                            <div className="course-info-links">
                                {course.website_url && (
                                    <a
                                        href={course.website_url}
                                        target="_blank"
                                        rel="noreferrer"
                                    >
                                        Visit website
                                    </a>
                                )}

                                {course.phone_number && (
                                    <a href={`tel:${course.phone_number}`}>
                                        {course.phone_number}
                                    </a>
                                )}
                            </div>
                        </div>
                    </section>
                )}

                <section className="stats-grid">
                    <div className="stat-card">
                        <span>Rounds</span>
                        <strong>
                            {course.rounds_played}
                        </strong>
                    </div>

                    <div className="stat-card">
                        <span>Total distance</span>

                        <strong>
                            {(totalDistance / 1000).toFixed(
                                1
                            )}{" "}
                            km
                        </strong>
                    </div>

                    <div className="stat-card">
                        <span>First played</span>

                        <strong>
                            {formatDate(
                                course.first_played
                            )}
                        </strong>
                    </div>

                    <div className="stat-card">
                        <span>Last played</span>

                        <strong>
                            {formatDate(
                                course.last_played
                            )}
                        </strong>
                    </div>
                </section>

                {routeLines.length > 0 && (
                    <>
                        <section className="section-heading">
                            <div>
                                <p className="eyebrow">
                                    GPS HISTORY
                                </p>

                                <h3>Rounds on the course</h3>
                            </div>

                            <span className="course-count">
                                {selectedRoundId !== null
                                    ? "1 GPS route selected"
                                    : `${routeLines.length} GPS routes`}
                                {selectedRoundId !== null && (
                                    <button
                                        className="course-count-clear"
                                        onClick={() => setSelectedRoundId(null)}
                                    >
                                        Show all
                                    </button>
                                )}
                            </span>
                        </section>

                        <section className="course-map-card">
                            <MapContainer
                                center={mapCenter}
                                zoom={15}
                                scrollWheelZoom={true}
                                className="course-map"
                            >
                                <TileLayer
                                    attribution="Tiles &copy; Esri &mdash; Esri, HERE, Garmin, FAO, NOAA, USGS"
                                    url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
                                />

                                <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}" />

                                <Marker
                                    position={mapCenter}
                                    icon={courseMarkerIcon(course)}
                                />

                                <FitRouteBounds
                                    routes={visibleRoutes.map(
                                        (route) => route.positions
                                    )}
                                />

                                {visibleRoutes.map(
                                    (route, index) => (
                                        <Polyline
                                            key={route.id}
                                            positions={
                                                route.positions
                                            }
                                            weight={
                                                selectedRoundId !== null || index === 0
                                                    ? 4
                                                    : 3
                                            }
                                            opacity={
                                                selectedRoundId !== null ? 0.9 : 0.65
                                            }
                                        />
                                    )
                                )}
                            </MapContainer>
                        </section>
                    </>
                )}

                <section className="section-heading">
                    <div>
                        <p className="eyebrow">
                            ROUND HISTORY
                        </p>

                        <h3>Rounds Played</h3>
                    </div>

                    <span className="course-count">{scores.length} rounds</span>
                </section>

                <div className="round-list">
                    {[...scores]
                        .sort(
                            (a, b) =>
                                new Date(b.play_date).getTime() -
                                new Date(a.play_date).getTime()
                        )
                        .map((score) => {
                            const matchedActivity = activityByDate.get(
                                new Date(score.play_date).toDateString()
                            );

                            const hasRoute = Boolean(
                                matchedActivity?.map_polyline &&
                                    matchedActivity.map_polyline.length > 0
                            );

                            return (
                                <div
                                    className={`round-row${hasRoute ? " round-row-clickable" : ""}${
                                        hasRoute && selectedRoundId === matchedActivity!.id
                                            ? " active"
                                            : ""
                                    }`}
                                    key={score.id}
                                    onClick={
                                        hasRoute
                                            ? () =>
                                                  setSelectedRoundId((prev) =>
                                                      prev === matchedActivity!.id
                                                          ? null
                                                          : matchedActivity!.id
                                                  )
                                            : undefined
                                    }
                                >
                                    <div>
                                        <strong>
                                            {formatDate(score.play_date)}
                                        </strong>

                                        <span>
                                            {hasRoute ? "GPS route available" : "No GPS"}
                                        </span>
                                    </div>

                                    <div>
                                        <strong>
                                            {score.adjusted_gross ?? "—"}
                                        </strong>

                                        <span>Gross</span>
                                    </div>

                                    <div>
                                        <strong>
                                            {score.stableford_points ?? "—"}
                                        </strong>

                                        <span>Stableford</span>
                                    </div>

                                    <div>
                                        <strong>
                                            {score.handicap_index ?? "—"}
                                        </strong>

                                        <span>Handicap</span>
                                    </div>
                                </div>
                            );
                        })}
                </div>
            </main>
        </>
    );
}

function RequireAuth({ children }: { children: ReactNode }) {
    const { session, loading } = useAuth();

    if (loading) {
        return <div className="loading-card">Loading...</div>;
    }

    if (!session) {
        return <Navigate to="/login" replace />;
    }

    return <>{children}</>;
}

function AppRoutes() {
    return (
        <Routes>
            <Route path="/login" element={<LoginPage />} />

            <Route
                path="/"
                element={
                    <RequireAuth>
                        <Dashboard />
                    </RequireAuth>
                }
            />

            <Route
                path="/course/:id"
                element={
                    <RequireAuth>
                        <CourseDetail />
                    </RequireAuth>
                }
            />

            <Route
                path="/stats"
                element={
                    <RequireAuth>
                        <StatsPage />
                    </RequireAuth>
                }
            />

            <Route
                path="/map"
                element={
                    <RequireAuth>
                        <MapPage />
                    </RequireAuth>
                }
            />

            <Route
                path="/handicap"
                element={
                    <RequireAuth>
                        <HandicapPage />
                    </RequireAuth>
                }
            />

            <Route
                path="/wellness"
                element={
                    <RequireAuth>
                        <WellnessPage />
                    </RequireAuth>
                }
            />

            <Route
                path="/teesheet"
                element={
                    <RequireAuth>
                        <TeesheetPage />
                    </RequireAuth>
                }
            />

            <Route
                path="/settings"
                element={
                    <RequireAuth>
                        <SettingsPage />
                    </RequireAuth>
                }
            />
        </Routes>
    );
}

function App() {
    return (
        <AuthProvider>
            <AppRoutes />
        </AuthProvider>
    );
}

export default App;