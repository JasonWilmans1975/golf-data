import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { API, authFetch } from "./api";
import { supabase } from "./supabaseClient";
import ThemeToggle from "./ThemeToggle";

function SettingsPage() {
    const navigate = useNavigate();

    const [memberNo, setMemberNo] = useState("");
    const [password, setPassword] = useState("");
    const [connected, setConnected] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [garminEmail, setGarminEmail] = useState("");
    const [garminPassword, setGarminPassword] = useState("");
    const [garminConnected, setGarminConnected] = useState(false);
    const [garminSaving, setGarminSaving] = useState(false);
    const [garminSaved, setGarminSaved] = useState(false);
    const [garminError, setGarminError] = useState<string | null>(null);

    useEffect(() => {
        async function load() {
            try {
                const response = await authFetch(
                    `${API}/handicap/credentials/status`
                );

                if (response.ok) {
                    const body = await response.json();
                    setConnected(body.connected);
                }
            } catch (err) {
                console.error(err);
            }

            try {
                const response = await authFetch(
                    `${API}/garmin/credentials/status`
                );

                if (response.ok) {
                    const body = await response.json();
                    setGarminConnected(body.connected);
                }
            } catch (err) {
                console.error(err);
            }
        }

        load();
    }, []);

    async function handleConnectStrava() {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;

        if (!token) return;

        window.location.href = `${API}/auth/strava?token=${encodeURIComponent(token)}`;
    }

    async function handleSaveCredentials(event: FormEvent) {
        event.preventDefault();
        setError(null);
        setSaving(true);
        setSaved(false);

        try {
            const response = await authFetch(`${API}/handicap/credentials`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ member_no: memberNo, password }),
            });

            if (!response.ok) {
                throw new Error("Failed to save credentials");
            }

            setConnected(true);
            setSaved(true);
            setPassword("");
        } catch (err) {
            setError(err instanceof Error ? err.message : "Something went wrong");
        } finally {
            setSaving(false);
        }
    }

    async function handleSaveGarminCredentials(event: FormEvent) {
        event.preventDefault();
        setGarminError(null);
        setGarminSaving(true);
        setGarminSaved(false);

        try {
            const response = await authFetch(`${API}/garmin/credentials`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    email: garminEmail,
                    password: garminPassword,
                }),
            });

            if (!response.ok) {
                throw new Error("Failed to save credentials");
            }

            setGarminConnected(true);
            setGarminSaved(true);
            setGarminPassword("");
        } catch (err) {
            setGarminError(
                err instanceof Error ? err.message : "Something went wrong"
            );
        } finally {
            setGarminSaving(false);
        }
    }

    async function handleLogout() {
        await supabase.auth.signOut();
        navigate("/login");
    }

    return (
        <>
            <header className="topbar">
                <div>
                    <div className="brand-kicker">MY GOLF JOURNEY</div>
                    <h1>Settings</h1>
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
                        onClick={() => navigate("/wellness")}
                    >
                        Wellness
                    </button>

                    <button className="header-secondary-button" onClick={handleLogout}>
                        Log out
                    </button>

                    <ThemeToggle />
                </div>
            </header>

            <main className="content">
                <section className="course-hero">
                    <p className="eyebrow">ACCOUNT</p>
                    <h2>Connect your accounts.</h2>
                    <p>
                        Link your own Strava and handicaps.co.za accounts to see your
                        own data.
                    </p>
                </section>

                <section className="chart-grid">
                    <div className="chart-card">
                        <div className="chart-heading">
                            <div>
                                <p className="eyebrow">STRAVA</p>
                                <h3>GPS &amp; Rounds</h3>
                            </div>
                        </div>

                        <p className="course-count">
                            Connect Strava to pull your golf activities and GPS
                            routes.
                        </p>

                        <button
                            className="sync-button"
                            onClick={handleConnectStrava}
                            style={{ marginTop: 16 }}
                        >
                            Connect Strava
                        </button>
                    </div>

                    <div className="chart-card">
                        <div className="chart-heading">
                            <div>
                                <p className="eyebrow">HANDICAPS.CO.ZA</p>
                                <h3>{connected ? "Connected" : "Not Connected"}</h3>
                            </div>
                        </div>

                        <form onSubmit={handleSaveCredentials}>
                            <label className="settings-label">
                                Membership number
                                <input
                                    className="settings-input"
                                    value={memberNo}
                                    onChange={(event) =>
                                        setMemberNo(event.target.value)
                                    }
                                    required
                                />
                            </label>

                            <label className="settings-label">
                                Password
                                <input
                                    className="settings-input"
                                    type="password"
                                    value={password}
                                    onChange={(event) =>
                                        setPassword(event.target.value)
                                    }
                                    required
                                />
                            </label>

                            {error && <p className="auth-error">{error}</p>}
                            {saved && <p className="course-count">Saved.</p>}

                            <button
                                className="sync-button"
                                type="submit"
                                disabled={saving}
                                style={{ marginTop: 12 }}
                            >
                                {saving
                                    ? "Saving..."
                                    : connected
                                    ? "Update credentials"
                                    : "Save credentials"}
                            </button>
                        </form>
                    </div>

                    <div className="chart-card">
                        <div className="chart-heading">
                            <div>
                                <p className="eyebrow">GARMIN CONNECT</p>
                                <h3>{garminConnected ? "Connected" : "Not Connected"}</h3>
                            </div>
                        </div>

                        <p className="course-count">
                            No official personal API exists for Garmin Connect,
                            so this logs in with your real Garmin account
                            (same as the Garmin Connect app) to pull golf
                            activities.
                        </p>

                        <form onSubmit={handleSaveGarminCredentials}>
                            <label className="settings-label">
                                Garmin email
                                <input
                                    className="settings-input"
                                    type="email"
                                    value={garminEmail}
                                    onChange={(event) =>
                                        setGarminEmail(event.target.value)
                                    }
                                    required
                                />
                            </label>

                            <label className="settings-label">
                                Password
                                <input
                                    className="settings-input"
                                    type="password"
                                    value={garminPassword}
                                    onChange={(event) =>
                                        setGarminPassword(event.target.value)
                                    }
                                    required
                                />
                            </label>

                            {garminError && (
                                <p className="auth-error">{garminError}</p>
                            )}
                            {garminSaved && (
                                <p className="course-count">Saved.</p>
                            )}

                            <button
                                className="sync-button"
                                type="submit"
                                disabled={garminSaving}
                                style={{ marginTop: 12 }}
                            >
                                {garminSaving
                                    ? "Saving..."
                                    : garminConnected
                                    ? "Update credentials"
                                    : "Save credentials"}
                            </button>
                        </form>
                    </div>
                </section>
            </main>
        </>
    );
}

export default SettingsPage;
