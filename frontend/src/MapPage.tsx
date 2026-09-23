import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
    MapContainer,
    TileLayer,
    Marker,
    Popup,
    useMap,
} from "react-leaflet";
import L from "leaflet";

import "leaflet/dist/leaflet.css";

import { API, authFetch, uploadCoursePhoto, courseMarkerIcon } from "./api";
import TopbarActions from "./TopbarActions";
import BrandLogo from "./BrandLogo";
import FeedNavButton from "./FeedNavButton";

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
    country_code: string | null;
};

type CountryPlayed = {
    country_code: string;
    country_name: string;
    course_count: number;
};

function formatDate(value: string | null) {
    if (!value) return "—";

    return new Intl.DateTimeFormat("en-ZA", {
        day: "numeric",
        month: "short",
        year: "numeric",
    }).format(new Date(value));
}

function FitCourses({ courses, maxZoom = 10 }: { courses: Course[]; maxZoom?: number }) {
    const map = useMap();

    useEffect(() => {
        const validCourses = courses.filter(
            (course) =>
                course.latitude !== null &&
                course.longitude !== null
        );

        if (!validCourses.length) return;

        const bounds = L.latLngBounds(
            validCourses.map((course) => [
                course.latitude as number,
                course.longitude as number,
            ])
        );

        map.fitBounds(bounds, {
            padding: [50, 50],
            maxZoom,
        });
    }, [courses, map, maxZoom]);

    return null;
}

function MapPage() {
    const navigate = useNavigate();

    const [courses, setCourses] = useState<Course[]>([]);
    const [countries, setCountries] = useState<CountryPlayed[]>([]);
    const [loading, setLoading] = useState(true);
    const [mapLayer, setMapLayer] = useState<"map" | "satellite">("satellite");
    const [selectedCountryCode, setSelectedCountryCode] = useState<string | null>(null);

    useEffect(() => {
        async function load() {
            try {
                const [coursesRes, countriesRes] = await Promise.all([
                    authFetch(`${API}/courses`),
                    authFetch(`${API}/courses/countries`),
                ]);

                const data: Course[] = await coursesRes.json();

                setCourses(data);
                setCountries(await countriesRes.json());
            } finally {
                setLoading(false);
            }
        }

        load();
    }, []);

    async function handlePhotoUpload(courseId: number, file: File | undefined) {
        if (!file) return;

        try {
            const { photo_url } = await uploadCoursePhoto(courseId, file);

            setCourses((prev) =>
                prev.map((course) =>
                    course.id === courseId ? { ...course, photo_url } : course
                )
            );
        } catch (error) {
            console.error(error);
        }
    }

    const mappedCourses = useMemo(
        () =>
            courses.filter(
                (course) =>
                    course.latitude !== null &&
                    course.longitude !== null
            ),
        [courses]
    );

    const focusedCourses = useMemo(
        () =>
            selectedCountryCode
                ? mappedCourses.filter(
                      (course) => course.country_code === selectedCountryCode
                  )
                : mappedCourses,
        [mappedCourses, selectedCountryCode]
    );

    function handleCountryClick(countryCode: string) {
        setSelectedCountryCode((prev) => (prev === countryCode ? null : countryCode));
    }

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
                    <BrandLogo />

                    <h1>World Map</h1>
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

                    <FeedNavButton />

                    <button
                        className="header-secondary-button"
                        onClick={() => navigate("/settings")}
                    >
                        Settings
                    </button>
                </TopbarActions>
            </header>

            <main className="content">
                <section className="map-heading">
                    <div>
                        <p className="eyebrow">GOLF PASSPORT</p>

                        <h2>Courses around the world</h2>

                        <p>
                            Every golf course detected from your
                            Strava rounds.
                        </p>
                    </div>

                    <div className="map-summary">
                        <div>
                            <span>Courses</span>
                            <strong>{mappedCourses.length}</strong>
                        </div>

                        <div>
                            <span>Rounds</span>
                            <strong>{totalRounds}</strong>
                        </div>
                    </div>
                </section>

                {countries.length > 0 && (
                    <div className="country-legend">
                        {countries.map((country) => (
                            <button
                                className={`country-legend-item${
                                    selectedCountryCode === country.country_code
                                        ? " active"
                                        : ""
                                }`}
                                key={country.country_code}
                                onClick={() => handleCountryClick(country.country_code)}
                                title={`${country.country_name} — ${country.course_count} ${
                                    country.course_count === 1 ? "course" : "courses"
                                }`}
                            >
                                <img
                                    src={`https://flagcdn.com/24x18/${country.country_code}.png`}
                                    alt={country.country_name}
                                    className="country-flag"
                                    onError={(event) => {
                                        event.currentTarget.style.display = "none";
                                    }}
                                />
                                <span>{country.country_name}</span>
                            </button>
                        ))}

                        {selectedCountryCode && (
                            <button
                                className="course-count-clear"
                                onClick={() => setSelectedCountryCode(null)}
                            >
                                Show all
                            </button>
                        )}
                    </div>
                )}

                {loading ? (
                    <div className="loading-card">
                        Loading world map...
                    </div>
                ) : (
                    <>
                        <div className="map-layer-toggle">
                            <button
                                className={mapLayer === "map" ? "active" : ""}
                                onClick={() => setMapLayer("map")}
                            >
                                Map
                            </button>

                            <button
                                className={mapLayer === "satellite" ? "active" : ""}
                                onClick={() => setMapLayer("satellite")}
                            >
                                Satellite
                            </button>
                        </div>

                    <section className="world-map-card">
                        <MapContainer
                            center={[-20, 20]}
                            zoom={2}
                            scrollWheelZoom={true}
                            className="world-map"
                        >
                            {mapLayer === "satellite" ? (
                                <TileLayer
                                    attribution="Tiles &copy; Esri &mdash; Esri, Maxar, Earthstar Geographics"
                                    url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                                />
                            ) : (
                                <>
                                    <TileLayer
                                        attribution="Tiles &copy; Esri &mdash; Esri, HERE, Garmin, FAO, NOAA, USGS"
                                        url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
                                    />

                                    <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}" />
                                </>
                            )}

                            <FitCourses
                                courses={focusedCourses}
                                maxZoom={selectedCountryCode ? 13 : 10}
                            />

                            {mappedCourses.map((course) => (
                                <Marker
                                    key={course.id}
                                    icon={courseMarkerIcon(course)}
                                    position={[
                                        course.latitude as number,
                                        course.longitude as number,
                                    ]}
                                >
                                    <Popup>
                                        <div className="course-popup">
                                            <strong>{course.name}</strong>

                                            <span>
                        {course.city ||
                            course.country ||
                            course.formatted_address ||
                            "Golf course"}
                      </span>

                                            <span>
                        {course.rounds_played}{" "}
                                                {course.rounds_played === 1
                                                    ? "round"
                                                    : "rounds"}
                      </span>

                                            <span>
                        Last played:{" "}
                                                {formatDate(course.last_played)}
                      </span>

                                            <label className="photo-upload">
                                                {course.photo_url
                                                    ? "Change photo"
                                                    : "Add photo"}
                                                <input
                                                    type="file"
                                                    accept="image/*"
                                                    onChange={(event) =>
                                                        handlePhotoUpload(
                                                            course.id,
                                                            event.target.files?.[0]
                                                        )
                                                    }
                                                />
                                            </label>

                                            <button
                                                onClick={() =>
                                                    navigate(`/course/${course.id}`)
                                                }
                                            >
                                                View course
                                            </button>
                                        </div>
                                    </Popup>
                                </Marker>
                            ))}
                        </MapContainer>
                    </section>
                    </>
                )}

                <section className="section-heading">
                    <div>
                        <p className="eyebrow">
                            COURSE DIRECTORY
                        </p>

                        <h3>Courses on the map</h3>
                    </div>
                </section>

                <div className="map-course-list">
                    {[...courses]
                        .sort(
                            (a, b) =>
                                b.rounds_played - a.rounds_played
                        )
                        .map((course) => (
                            <button
                                key={course.id}
                                className="map-course-row"
                                onClick={() =>
                                    navigate(`/course/${course.id}`)
                                }
                            >
                                <div>
                                    <strong>{course.name}</strong>

                                    <span>
                    {course.city ||
                        course.country ||
                        course.formatted_address ||
                        "Golf course"}
                  </span>
                                </div>

                                <span className="round-pill">
                  {course.rounds_played}{" "}
                                    {course.rounds_played === 1
                                        ? "round"
                                        : "rounds"}
                </span>
                            </button>
                        ))}
                </div>
            </main>
        </>
    );
}

export default MapPage;