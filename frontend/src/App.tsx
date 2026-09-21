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
import ThemeToggle from "./ThemeToggle";

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

function formatDate(value: string | null) {
    if (!value) return "—";

    return new Intl.DateTimeFormat("en-ZA", {
        day: "numeric",
        month: "short",
        year: "numeric",
    }).format(new Date(value));
}

function formatDuration(seconds: number) {
    if (!seconds) return "—";

    const hours = Math.floor(seconds / 3600);
    const mins = Math.round((seconds % 3600) / 60);

    return `${hours}h ${mins}m`;
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
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [garminSyncing, setGarminSyncing] = useState(false);
    const [garminSyncError, setGarminSyncError] = useState<string | null>(null);
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

    async function handleGarminSync() {
        setGarminSyncing(true);
        setGarminSyncError(null);

        try {
            const response = await authFetch(`${API}/garmin/sync`, {
                method: "POST",
            });

            if (response.status === 502) {
                const body = await response.json().catch(() => null);
                setGarminSyncError(
                    body?.detail ||
                        "Garmin sync failed — check your credentials in Settings"
                );
                return;
            }

            if (!response.ok) {
                throw new Error("Failed to sync Garmin activities");
            }

            await detectCourses();
            await loadDashboard();
        } catch (error) {
            console.error(error);
        } finally {
            setGarminSyncing(false);
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
        }
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

                <div className="topbar-actions">
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
                        onClick={() => navigate("/settings")}
                    >
                        Settings
                    </button>

                    <ThemeToggle />

                    <button
                        className="sync-button"
                        disabled={syncing}
                        onClick={handleSync}
                    >
                        {syncing ? "Syncing..." : "Sync Strava"}
                    </button>

                    <button
                        className="sync-button"
                        disabled={garminSyncing}
                        onClick={handleGarminSync}
                    >
                        {garminSyncing ? "Syncing..." : "Sync Garmin"}
                    </button>
                </div>
            </header>

            {garminSyncError && (
                <p className="auth-error" style={{ margin: "12px 48px 0" }}>
                    {garminSyncError}
                </p>
            )}

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
                        <span>Distance walked</span>

                        <strong>
                            {stats.total_distance_km
                                ? `${stats.total_distance_km.toFixed(
                                    1
                                )} km`
                                : "—"}
                        </strong>
                    </div>

                    <div className="stat-card">
                        <span>Elevation</span>

                        <strong>
                            {stats.total_elevation_m
                                ? `${Math.round(
                                    stats.total_elevation_m
                                )} m`
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
                                        View course
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

    const [course, setCourse] =
        useState<Course | null>(null);

    const [activities, setActivities] =
        useState<Activity[]>([]);

    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function load() {
            try {
                const [coursesRes, activitiesRes] =
                    await Promise.all([
                        authFetch(`${API}/courses`),
                        authFetch(`${API}/activities`),
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

    const totalElevation = activities.reduce(
        (sum, activity) =>
            sum +
            (activity.elevation_gain_m || 0),
        0
    );

    const avgMovingTime =
        activities.length > 0
            ? activities.reduce(
            (sum, activity) =>
                sum +
                (activity.moving_time_s || 0),
            0
        ) / activities.length
            : 0;

    const avgDistance =
        activities.length > 0
            ? totalDistance /
            activities.length /
            1000
            : 0;

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

                <div className="topbar-actions">
                    <button
                        className="header-secondary-button"
                        onClick={() => navigate("/map")}
                    >
                        World Map
                    </button>

                    <ThemeToggle />

                    <button
                        className="sync-button"
                        onClick={() => navigate("/")}
                    >
                        Back to courses
                    </button>
                </div>
            </header>

            <main className="content">
                <section className="course-hero">
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
                </section>

                <section className="stats-grid">
                    <div className="stat-card">
                        <span>Rounds</span>
                        <strong>
                            {activities.length}
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
                        <span>Average distance</span>

                        <strong>
                            {avgDistance.toFixed(1)} km
                        </strong>
                    </div>

                    <div className="stat-card">
            <span>
              Average moving time
            </span>

                        <strong>
                            {formatDuration(
                                avgMovingTime
                            )}
                        </strong>
                    </div>
                </section>

                <section className="section-heading">
                    <div>
                        <p className="eyebrow">
                            GPS HISTORY
                        </p>

                        <h3>Rounds on the course</h3>
                    </div>

                    <span className="course-count">
            {routeLines.length} GPS routes
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
                            routes={routeLines.map(
                                (route) => route.positions
                            )}
                        />

                        {routeLines.map(
                            (route, index) => (
                                <Polyline
                                    key={route.id}
                                    positions={
                                        route.positions
                                    }
                                    weight={
                                        index === 0
                                            ? 4
                                            : 3
                                    }
                                    opacity={0.65}
                                />
                            )
                        )}
                    </MapContainer>
                </section>

                <section className="stats-summary">
                    <div>
            <span>
              Total elevation climbed
            </span>

                        <strong>
                            {Math.round(
                                totalElevation
                            ).toLocaleString()}{" "}
                            m
                        </strong>
                    </div>

                    <div>
                        <span>First played</span>

                        <strong>
                            {formatDate(
                                course.first_played
                            )}
                        </strong>
                    </div>
                </section>

                <section className="section-heading">
                    <div>
                        <p className="eyebrow">
                            ROUND HISTORY
                        </p>

                        <h3>Rounds Played</h3>
                    </div>
                </section>

                <div className="round-list">
                    {[...activities]
                        .sort(
                            (a, b) =>
                                new Date(
                                    b.start_date
                                ).getTime() -
                                new Date(
                                    a.start_date
                                ).getTime()
                        )
                        .map((round) => (
                            <div
                                className="round-row"
                                key={round.id}
                            >
                                <div>
                                    <strong>
                                        {formatDate(
                                            round.start_date
                                        )}
                                    </strong>

                                    <span>{round.name}</span>
                                </div>

                                <div>
                                    <strong>
                                        {(
                                            round.distance_m /
                                            1000
                                        ).toFixed(1)}{" "}
                                        km
                                    </strong>

                                    <span>Distance</span>
                                </div>

                                <div>
                                    <strong>
                                        {formatDuration(
                                            round.moving_time_s
                                        )}
                                    </strong>

                                    <span>
                    Moving time
                  </span>
                                </div>

                                <div>
                                    <strong>
                                        {Math.round(
                                            round.elevation_gain_m
                                        )}{" "}
                                        m
                                    </strong>

                                    <span>Elevation</span>
                                </div>
                            </div>
                        ))}
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