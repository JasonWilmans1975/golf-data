import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { API, authFetch } from "./api";
import { supabase } from "./supabaseClient";
import ThemeToggle from "./ThemeToggle";
import TopbarActions from "./TopbarActions";
import { TEESHEET_CLUBS } from "./teesheetClubs";

function SettingsPage() {
    const navigate = useNavigate();

    const [stravaConnected, setStravaConnected] = useState(false);

    const [memberNo, setMemberNo] = useState("");
    const [password, setPassword] = useState("");
    const [connected, setConnected] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [handicapSyncing, setHandicapSyncing] = useState(false);
    const [handicapSyncMessage, setHandicapSyncMessage] = useState<string | null>(null);

    const [garminEmail, setGarminEmail] = useState("");
    const [garminPassword, setGarminPassword] = useState("");
    const [garminConnected, setGarminConnected] = useState(false);
    const [garminSaving, setGarminSaving] = useState(false);
    const [garminSaved, setGarminSaved] = useState(false);
    const [garminError, setGarminError] = useState<string | null>(null);

    const [stravaSyncing, setStravaSyncing] = useState(false);
    const [stravaSyncMessage, setStravaSyncMessage] = useState<string | null>(null);

    const [garminSyncing, setGarminSyncing] = useState(false);
    const [garminSyncMessage, setGarminSyncMessage] = useState<string | null>(null);

    const [teesheetClubId, setTeesheetClubId] = useState("62");
    const [teesheetMemberId, setTeesheetMemberId] = useState("");
    const [teesheetPassword, setTeesheetPassword] = useState("");
    const [teesheetConnected, setTeesheetConnected] = useState(false);
    const [teesheetSaving, setTeesheetSaving] = useState(false);
    const [teesheetSaved, setTeesheetSaved] = useState(false);
    const [teesheetError, setTeesheetError] = useState<string | null>(null);

    useEffect(() => {
        async function load() {
            try {
                const response = await authFetch(`${API}/strava/status`);

                if (response.ok) {
                    const body = await response.json();
                    setStravaConnected(body.connected);
                }
            } catch (err) {
                console.error(err);
            }

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

            try {
                const response = await authFetch(
                    `${API}/teesheet/credentials/status`
                );

                if (response.ok) {
                    const body = await response.json();
                    setTeesheetConnected(body.connected);
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
        setHandicapSyncMessage(null);

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
            setSaving(false);
            return;
        }

        setSaving(false);
        setHandicapSyncing(true);

        try {
            const syncResponse = await authFetch(
                `${API}/handicap/sync?force=true`,
                { method: "POST" }
            );

            const body = await syncResponse.json().catch(() => null);

            if (!syncResponse.ok) {
                setHandicapSyncMessage(
                    body?.detail || "Could not sync with handicaps.co.za"
                );
            } else if (body?.skipped) {
                setHandicapSyncMessage("Already up to date.");
            } else {
                setHandicapSyncMessage(`Synced ${body.synced} rounds.`);
            }
        } catch (err) {
            setHandicapSyncMessage("Could not reach the backend to sync");
        } finally {
            setHandicapSyncing(false);
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

    async function handleSaveTeesheetCredentials(event: FormEvent) {
        event.preventDefault();
        setTeesheetError(null);
        setTeesheetSaving(true);
        setTeesheetSaved(false);

        const club = TEESHEET_CLUBS.find((c) => c.id === Number(teesheetClubId));

        if (!club) {
            setTeesheetError("Select your golf club");
            setTeesheetSaving(false);
            return;
        }

        try {
            const response = await authFetch(`${API}/teesheet/credentials`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    club_id: club.id,
                    club_name: club.name,
                    member_id: teesheetMemberId,
                    password: teesheetPassword,
                }),
            });

            if (!response.ok) {
                throw new Error("Failed to save credentials");
            }

            setTeesheetConnected(true);
            setTeesheetSaved(true);
            setTeesheetPassword("");
        } catch (err) {
            setTeesheetError(
                err instanceof Error ? err.message : "Something went wrong"
            );
        } finally {
            setTeesheetSaving(false);
        }
    }

    async function handleSyncStrava() {
        setStravaSyncing(true);
        setStravaSyncMessage(null);

        try {
            const response = await authFetch(`${API}/sync`, { method: "POST" });

            if (response.status === 401) {
                setStravaSyncMessage("Connect Strava first.");
                return;
            }

            if (!response.ok) {
                throw new Error("Failed to sync Strava activities");
            }

            await authFetch(`${API}/courses/detect`, { method: "POST" });
            setStravaSyncMessage("Synced.");
        } catch (err) {
            setStravaSyncMessage("Sync failed.");
        } finally {
            setStravaSyncing(false);
        }
    }

    async function handleSyncGarmin() {
        setGarminSyncing(true);
        setGarminSyncMessage(null);

        try {
            const response = await authFetch(`${API}/garmin/sync?force=true`, {
                method: "POST",
            });

            const body = await response.json().catch(() => null);

            if (!response.ok) {
                setGarminSyncMessage(body?.detail || "Garmin sync failed");
                return;
            }

            await authFetch(`${API}/courses/detect`, { method: "POST" });
            setGarminSyncMessage("Synced.");
        } catch (err) {
            setGarminSyncMessage("Could not reach the backend to sync");
        } finally {
            setGarminSyncing(false);
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

                <TopbarActions>
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
                </TopbarActions>
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
                                <h3>{stravaConnected ? "Connected" : "Not Connected"}</h3>
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

                        <button
                            className="sync-button"
                            onClick={handleSyncStrava}
                            disabled={stravaSyncing}
                            style={{ marginTop: 8, marginLeft: 8 }}
                        >
                            {stravaSyncing ? "Syncing..." : "Sync now"}
                        </button>

                        {stravaSyncMessage && (
                            <p className="course-count" style={{ marginTop: 8 }}>
                                {stravaSyncMessage}
                            </p>
                        )}
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
                            {saved && !handicapSyncing && !handicapSyncMessage && (
                                <p className="course-count">Saved.</p>
                            )}

                            <button
                                className="sync-button"
                                type="submit"
                                disabled={saving || handicapSyncing}
                                style={{ marginTop: 12 }}
                            >
                                {saving
                                    ? "Saving..."
                                    : handicapSyncing
                                    ? "Syncing..."
                                    : connected
                                    ? "Update credentials"
                                    : "Save credentials"}
                            </button>

                            {handicapSyncMessage && (
                                <p className="course-count" style={{ marginTop: 8 }}>
                                    {handicapSyncMessage}
                                </p>
                            )}
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

                        <button
                            className="sync-button"
                            onClick={handleSyncGarmin}
                            disabled={garminSyncing}
                            style={{ marginTop: 8 }}
                        >
                            {garminSyncing ? "Syncing..." : "Sync now"}
                        </button>

                        {garminSyncMessage && (
                            <p className="course-count" style={{ marginTop: 8 }}>
                                {garminSyncMessage}
                            </p>
                        )}
                    </div>

                    <div className="chart-card">
                        <div className="chart-heading">
                            <div>
                                <p className="eyebrow">TEESHEET.CO.ZA</p>
                                <h3>{teesheetConnected ? "Connected" : "Not Connected"}</h3>
                            </div>
                        </div>

                        <p className="course-count">
                            Connect teesheet.co.za to pull your tee times and
                            account balance.
                        </p>

                        <form onSubmit={handleSaveTeesheetCredentials}>
                            <label className="settings-label">
                                Golf club
                                <select
                                    className="settings-input"
                                    value={teesheetClubId}
                                    onChange={(event) =>
                                        setTeesheetClubId(event.target.value)
                                    }
                                    required
                                >
                                    <option value="">Select your club</option>
                                    {TEESHEET_CLUBS.map((club) => (
                                        <option key={club.id} value={club.id}>
                                            {club.name}
                                        </option>
                                    ))}
                                </select>
                            </label>

                            <label className="settings-label">
                                Member ID
                                <input
                                    className="settings-input"
                                    value={teesheetMemberId}
                                    onChange={(event) =>
                                        setTeesheetMemberId(event.target.value)
                                    }
                                    required
                                />
                            </label>

                            <label className="settings-label">
                                Password
                                <input
                                    className="settings-input"
                                    type="password"
                                    value={teesheetPassword}
                                    onChange={(event) =>
                                        setTeesheetPassword(event.target.value)
                                    }
                                    required
                                />
                            </label>

                            {teesheetError && (
                                <p className="auth-error">{teesheetError}</p>
                            )}
                            {teesheetSaved && (
                                <p className="course-count">Saved.</p>
                            )}

                            <button
                                className="sync-button"
                                type="submit"
                                disabled={teesheetSaving}
                                style={{ marginTop: 12 }}
                            >
                                {teesheetSaving
                                    ? "Saving..."
                                    : teesheetConnected
                                    ? "Update credentials"
                                    : "Save credentials"}
                            </button>
                        </form>
                    </div>

                    <div className="chart-card">
                        <div className="chart-heading">
                            <div>
                                <p className="eyebrow">APPEARANCE</p>
                                <h3>Theme</h3>
                            </div>
                        </div>

                        <ThemeToggle />
                    </div>
                </section>
            </main>
        </>
    );
}

export default SettingsPage;
