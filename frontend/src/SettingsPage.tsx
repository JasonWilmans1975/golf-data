import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { API, authFetch, uploadAvatarPhoto } from "./api";
import { supabase } from "./supabaseClient";
import ThemeToggle from "./ThemeToggle";
import TopbarActions from "./TopbarActions";
import BrandLogo from "./BrandLogo";
import NavButton from "./NavButton";
import FeedNavButton from "./FeedNavButton";
import { TEESHEET_CLUBS } from "./teesheetClubs";

function SettingsPage() {
    const navigate = useNavigate();

    const [tab, setTab] = useState<"accounts" | "profile">("accounts");

    const [stravaConnected, setStravaConnected] = useState(false);

    const [memberNo, setMemberNo] = useState("");
    const [password, setPassword] = useState("");
    const [connected, setConnected] = useState(false);
    const [needsReconnect, setNeedsReconnect] = useState(false);
    const [handicapEditing, setHandicapEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [handicapSyncing, setHandicapSyncing] = useState(false);
    const [handicapSyncMessage, setHandicapSyncMessage] = useState<string | null>(null);

    const [garminEmail, setGarminEmail] = useState("");
    const [garminPassword, setGarminPassword] = useState("");
    const [garminConnected, setGarminConnected] = useState(false);
    const [garminEditing, setGarminEditing] = useState(false);
    const [garminSaving, setGarminSaving] = useState(false);
    const [garminError, setGarminError] = useState<string | null>(null);

    const [stravaSyncing, setStravaSyncing] = useState(false);
    const [stravaSyncMessage, setStravaSyncMessage] = useState<string | null>(null);

    const [garminSyncing, setGarminSyncing] = useState(false);
    const [garminSyncMessage, setGarminSyncMessage] = useState<string | null>(null);

    const [teesheetClubId, setTeesheetClubId] = useState("");
    const [teesheetMemberId, setTeesheetMemberId] = useState("");
    const [teesheetPassword, setTeesheetPassword] = useState("");
    const [teesheetConnected, setTeesheetConnected] = useState(false);
    const [teesheetEditing, setTeesheetEditing] = useState(false);
    const [teesheetSaving, setTeesheetSaving] = useState(false);
    const [teesheetError, setTeesheetError] = useState<string | null>(null);
    const [teesheetSyncing, setTeesheetSyncing] = useState(false);
    const [teesheetSyncMessage, setTeesheetSyncMessage] = useState<string | null>(null);

    const [displayName, setDisplayName] = useState("");
    const [surname, setSurname] = useState("");
    const [nickname, setNickname] = useState("");
    const [phone, setPhone] = useState("");
    const [country, setCountry] = useState("");
    const [province, setProvince] = useState("");
    const [dateOfBirth, setDateOfBirth] = useState("");
    const [sex, setSex] = useState("");
    const [displayPreference, setDisplayPreference] = useState<"name" | "nickname">("name");
    const [newsletterOptIn, setNewsletterOptIn] = useState(false);
    const [sponsorOptIn, setSponsorOptIn] = useState(false);
    const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
    const [avatarUploading, setAvatarUploading] = useState(false);
    const [profileSaving, setProfileSaving] = useState(false);
    const [profileMessage, setProfileMessage] = useState<string | null>(null);
    const [statusLoading, setStatusLoading] = useState(true);

    useEffect(() => {
        async function loadStrava() {
            try {
                const response = await authFetch(`${API}/strava/status`);

                if (response.ok) {
                    const body = await response.json();
                    setStravaConnected(body.connected);
                }
            } catch (err) {
                console.error(err);
            }
        }

        async function loadHandicap() {
            try {
                const response = await authFetch(`${API}/handicap/credentials/status`);

                if (response.ok) {
                    const body = await response.json();
                    setConnected(body.connected);
                    setMemberNo(body.member_no || "");
                    setNeedsReconnect(!!body.needs_reconnect);
                }
            } catch (err) {
                console.error(err);
            }
        }

        async function loadGarmin() {
            try {
                const response = await authFetch(`${API}/garmin/credentials/status`);

                if (response.ok) {
                    const body = await response.json();
                    setGarminConnected(body.connected);
                    setGarminEmail(body.email || "");
                }
            } catch (err) {
                console.error(err);
            }
        }

        async function loadTeesheet() {
            try {
                const response = await authFetch(`${API}/teesheet/credentials/status`);

                if (response.ok) {
                    const body = await response.json();
                    setTeesheetConnected(body.connected);
                    setTeesheetMemberId(body.member_id || "");

                    const club = TEESHEET_CLUBS.find((c) => c.name === body.club_name);
                    setTeesheetClubId(club ? String(club.id) : "");
                }
            } catch (err) {
                console.error(err);
            }
        }

        async function loadProfile() {
            try {
                const response = await authFetch(`${API}/profile`);

                if (response.ok) {
                    const body = await response.json();
                    setDisplayName(body.display_name || "");
                    setSurname(body.surname || "");
                    setNickname(body.nickname || "");
                    setPhone(body.phone || "");
                    setCountry(body.country || "");
                    setProvince(body.province || "");
                    setDateOfBirth(body.date_of_birth || "");
                    setSex(body.sex || "");
                    setDisplayPreference(body.display_preference === "nickname" ? "nickname" : "name");
                    setNewsletterOptIn(!!body.newsletter_opt_in);
                    setSponsorOptIn(!!body.sponsor_opt_in);
                    setAvatarUrl(body.avatar_url || null);
                }
            } catch (err) {
                console.error(err);
            }
        }

        // These 5 requests are all independent -- firing them together
        // instead of one after another is both faster and avoids rendering
        // the "not connected" defaults (form open, initials shown) for the
        // time it'd otherwise take to work through them in sequence, which
        // is what looked like the page rendering an old layout before
        // flipping to the real one.
        Promise.all([loadStrava(), loadHandicap(), loadGarmin(), loadTeesheet(), loadProfile()]).finally(() =>
            setStatusLoading(false)
        );
    }, []);

    async function handleSaveProfile(event: FormEvent) {
        event.preventDefault();
        setProfileSaving(true);
        setProfileMessage(null);

        try {
            const response = await authFetch(`${API}/profile`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    display_name: displayName,
                    surname,
                    nickname,
                    phone,
                    country,
                    province,
                    date_of_birth: dateOfBirth || null,
                    sex: sex || null,
                    display_preference: displayPreference,
                    newsletter_opt_in: newsletterOptIn,
                    sponsor_opt_in: sponsorOptIn,
                }),
            });

            setProfileMessage(response.ok ? "Saved." : "Could not save your profile");
        } catch (err) {
            console.error(err);
            setProfileMessage("Could not reach the backend");
        } finally {
            setProfileSaving(false);
        }
    }

    async function handleAvatarChange(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0];
        if (!file) return;

        setAvatarUploading(true);

        try {
            const { avatar_url } = await uploadAvatarPhoto(file);
            setAvatarUrl(avatar_url);
        } catch (err) {
            console.error(err);
        } finally {
            setAvatarUploading(false);
            event.target.value = "";
        }
    }

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
            setNeedsReconnect(false);
            setPassword("");
        } catch (err) {
            setError(err instanceof Error ? err.message : "Something went wrong");
            setSaving(false);
            return;
        }

        setSaving(false);
        setHandicapSyncing(true);

        try {
            // full_resync=true here specifically -- (re)connecting credentials
            // is exactly the moment a full history pull is worth the cost,
            // as a safety net in case anything's changed since last time.
            const syncResponse = await authFetch(
                `${API}/handicap/sync?force=true&full_resync=true`,
                { method: "POST" }
            );

            const body = await syncResponse.json().catch(() => null);

            if (!syncResponse.ok) {
                setHandicapSyncMessage(
                    body?.detail || "Could not sync with handicaps.co.za"
                );
            } else {
                setHandicapSyncMessage(`Synced ${body.synced} rounds.`);
                setHandicapEditing(false);
            }
        } catch (err) {
            setHandicapSyncMessage("Could not reach the backend to sync");
        } finally {
            setHandicapSyncing(false);
        }
    }

    async function handleSyncHandicapNow() {
        setHandicapSyncing(true);
        setHandicapSyncMessage(null);

        try {
            const syncResponse = await authFetch(`${API}/handicap/sync?force=true`, {
                method: "POST",
            });

            const body = await syncResponse.json().catch(() => null);

            if (!syncResponse.ok) {
                setHandicapSyncMessage(body?.detail || "Could not sync with handicaps.co.za");
            } else {
                setNeedsReconnect(false);
                setHandicapSyncMessage(
                    body.synced > 0 ? `Synced ${body.synced} new round${body.synced === 1 ? "" : "s"}.` : "Up to date."
                );
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
            setGarminPassword("");
            setGarminEditing(false);
        } catch (err) {
            setGarminError(
                err instanceof Error ? err.message : "Something went wrong"
            );
        } finally {
            setGarminSaving(false);
        }
    }

    async function handleSyncTeesheet(force: boolean) {
        setTeesheetSyncing(true);
        setTeesheetSyncMessage(null);

        try {
            const response = await authFetch(
                `${API}/teesheet/sync${force ? "?force=true" : ""}`,
                { method: "POST" }
            );

            const body = await response.json().catch(() => null);

            if (!response.ok) {
                setTeesheetSyncMessage(body?.detail || "Sync failed");
            } else if (body?.skipped) {
                setTeesheetSyncMessage("Already up to date.");
            } else {
                setTeesheetSyncMessage(
                    `Synced ${body.bookings_synced} booking(s), ${body.transactions_synced} transaction(s).`
                );
            }
        } catch (err) {
            setTeesheetSyncMessage("Could not reach the backend to sync");
        } finally {
            setTeesheetSyncing(false);
        }
    }

    async function handleSaveTeesheetCredentials(event: FormEvent) {
        event.preventDefault();
        setTeesheetError(null);
        setTeesheetSaving(true);
        setTeesheetSyncMessage(null);

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
            setTeesheetPassword("");
            setTeesheetEditing(false);
        } catch (err) {
            setTeesheetError(
                err instanceof Error ? err.message : "Something went wrong"
            );
            setTeesheetSaving(false);
            return;
        }

        setTeesheetSaving(false);
        await handleSyncTeesheet(true);
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
                    <BrandLogo />
                </div>

                <TopbarActions>
                    <NavButton to="/rounds">My Rounds</NavButton>
                    <NavButton to="/map">World Map</NavButton>
                    <NavButton to="/stats">Stats</NavButton>
                    <NavButton to="/handicap">Handicap</NavButton>
                    <NavButton to="/leaderboard">Leaderboard</NavButton>
                    <NavButton to="/tournaments">Tournaments</NavButton>
                    <NavButton to="/friends">Friends</NavButton>
                    <NavButton to="/wellness">Wellness</NavButton>
                    <NavButton to="/teesheet">Teesheet</NavButton>
                    <FeedNavButton />
                    <NavButton to="/settings">Settings</NavButton>

                    <button className="header-secondary-button" onClick={handleLogout}>
                        Log out
                    </button>
                </TopbarActions>
            </header>

            <main className="content">
                <section className="settings-header">
                    <div className="settings-header-top">
                        <h2>Settings</h2>

                        <div className="settings-appearance-inline">
                            <span>Appearance</span>
                            <ThemeToggle />
                        </div>
                    </div>

                    <div className="settings-tabs">
                        <button
                            className={tab === "accounts" ? "settings-tab active" : "settings-tab"}
                            onClick={() => setTab("accounts")}
                        >
                            Linked accounts
                        </button>
                        <button
                            className={tab === "profile" ? "settings-tab active" : "settings-tab"}
                            onClick={() => setTab("profile")}
                        >
                            Profile
                        </button>
                    </div>
                </section>

                {tab === "accounts" && (
                    <section className="chart-grid">
                        <div className="chart-card chart-card-wide">
                            <div className="chart-heading">
                                <div>
                                    <p className="eyebrow">LINKED ACCOUNTS</p>
                                    <h3>Where your data comes from</h3>
                                </div>
                            </div>

                            <div className="integration-list">
                            {statusLoading ? (
                                <p className="course-count">Checking connected accounts...</p>
                            ) : (
                                <>
                                <div className="integration-row">
                                    <div className="integration-row-main">
                                        <div>
                                            <strong>Strava</strong>
                                            <span className="course-count">
                                                {stravaConnected ? "Connected" : "Not connected"}
                                            </span>
                                        </div>

                                        <div className="integration-row-actions">
                                            {stravaConnected && (
                                                <button
                                                    className="sync-button"
                                                    onClick={handleSyncStrava}
                                                    disabled={stravaSyncing}
                                                >
                                                    {stravaSyncing ? "Syncing..." : "Sync now"}
                                                </button>
                                            )}
                                            <button className="integration-action-button" onClick={handleConnectStrava}>
                                                {stravaConnected ? "Reconnect" : "Connect"}
                                            </button>
                                        </div>
                                    </div>

                                    {stravaSyncMessage && <p className="course-count">{stravaSyncMessage}</p>}
                                </div>

                                <div className="integration-row">
                                    <div className="integration-row-main">
                                        <div>
                                            <strong>Handicaps.co.za</strong>
                                            <span
                                                className="course-count"
                                                style={needsReconnect ? { color: "var(--error)" } : undefined}
                                            >
                                                {!connected
                                                    ? "Not connected"
                                                    : needsReconnect
                                                    ? `⚠️ Member #${memberNo} — reconnect needed`
                                                    : `Member #${memberNo}`}
                                            </span>
                                        </div>

                                        <div className="integration-row-actions">
                                            {connected && !handicapEditing && (
                                                <button
                                                    className="sync-button"
                                                    onClick={handleSyncHandicapNow}
                                                    disabled={handicapSyncing}
                                                >
                                                    {handicapSyncing && <span className="spinner" />}
                                                    {handicapSyncing ? "Syncing..." : "Sync now"}
                                                </button>
                                            )}
                                            <button
                                                className="integration-action-button"
                                                onClick={() => setHandicapEditing((v) => !v)}
                                            >
                                                {!connected ? "Connect" : handicapEditing ? "Cancel" : "Change credentials"}
                                            </button>
                                        </div>
                                    </div>

                                    {(handicapEditing || !connected) && (
                                        <form className="integration-form" onSubmit={handleSaveCredentials}>
                                            <label className="settings-label">
                                                Membership number
                                                <input
                                                    className="settings-input"
                                                    value={memberNo}
                                                    onChange={(event) => setMemberNo(event.target.value)}
                                                    required
                                                />
                                            </label>

                                            <label className="settings-label">
                                                Password
                                                <input
                                                    className="settings-input"
                                                    type="password"
                                                    value={password}
                                                    onChange={(event) => setPassword(event.target.value)}
                                                    required
                                                />
                                            </label>

                                            {error && <p className="auth-error">{error}</p>}

                                            <button
                                                className="sync-button"
                                                type="submit"
                                                disabled={saving || handicapSyncing}
                                                style={{ marginTop: 8 }}
                                            >
                                                {(saving || handicapSyncing) && <span className="spinner" />}
                                                {saving
                                                    ? "Saving..."
                                                    : handicapSyncing
                                                    ? "Connecting to handicaps.co.za..."
                                                    : connected
                                                    ? "Update credentials"
                                                    : "Save credentials"}
                                            </button>

                                            {handicapSyncing && (
                                                <p className="course-count" style={{ marginTop: 8 }}>
                                                    This can take up to 15 seconds the first time.
                                                </p>
                                            )}
                                        </form>
                                    )}

                                    {!handicapEditing && handicapSyncMessage && (
                                        <p className="course-count">{handicapSyncMessage}</p>
                                    )}
                                </div>

                                <div className="integration-row">
                                    <div className="integration-row-main">
                                        <div>
                                            <strong>Garmin Connect</strong>
                                            <span className="course-count">
                                                {garminConnected ? garminEmail : "Not connected"}
                                            </span>
                                        </div>

                                        <div className="integration-row-actions">
                                            {garminConnected && !garminEditing && (
                                                <button
                                                    className="sync-button"
                                                    onClick={handleSyncGarmin}
                                                    disabled={garminSyncing}
                                                >
                                                    {garminSyncing ? "Syncing..." : "Sync now"}
                                                </button>
                                            )}
                                            <button
                                                className="integration-action-button"
                                                onClick={() => setGarminEditing((v) => !v)}
                                            >
                                                {!garminConnected ? "Connect" : garminEditing ? "Cancel" : "Change credentials"}
                                            </button>
                                        </div>
                                    </div>

                                    {(garminEditing || !garminConnected) && (
                                        <form className="integration-form" onSubmit={handleSaveGarminCredentials}>
                                            <label className="settings-label">
                                                Garmin email
                                                <input
                                                    className="settings-input"
                                                    type="email"
                                                    value={garminEmail}
                                                    onChange={(event) => setGarminEmail(event.target.value)}
                                                    required
                                                />
                                            </label>

                                            <label className="settings-label">
                                                Password
                                                <input
                                                    className="settings-input"
                                                    type="password"
                                                    value={garminPassword}
                                                    onChange={(event) => setGarminPassword(event.target.value)}
                                                    required
                                                />
                                            </label>

                                            {garminError && <p className="auth-error">{garminError}</p>}

                                            <button
                                                className="sync-button"
                                                type="submit"
                                                disabled={garminSaving}
                                                style={{ marginTop: 8 }}
                                            >
                                                {garminSaving
                                                    ? "Saving..."
                                                    : garminConnected
                                                    ? "Update credentials"
                                                    : "Save credentials"}
                                            </button>
                                        </form>
                                    )}

                                    {!garminEditing && garminSyncMessage && (
                                        <p className="course-count">{garminSyncMessage}</p>
                                    )}
                                </div>

                                <div className="integration-row">
                                    <div className="integration-row-main">
                                        <div>
                                            <strong>Teesheet.co.za</strong>
                                            <span className="course-count">
                                                {teesheetConnected
                                                    ? TEESHEET_CLUBS.find((c) => c.id === Number(teesheetClubId))?.name ||
                                                      "Connected"
                                                    : "Not connected"}
                                            </span>
                                        </div>

                                        <div className="integration-row-actions">
                                            {teesheetConnected && !teesheetEditing && (
                                                <button
                                                    className="sync-button"
                                                    onClick={() => handleSyncTeesheet(true)}
                                                    disabled={teesheetSyncing}
                                                >
                                                    {teesheetSyncing ? "Syncing..." : "Sync now"}
                                                </button>
                                            )}
                                            <button
                                                className="integration-action-button"
                                                onClick={() => setTeesheetEditing((v) => !v)}
                                            >
                                                {!teesheetConnected
                                                    ? "Connect"
                                                    : teesheetEditing
                                                    ? "Cancel"
                                                    : "Change credentials"}
                                            </button>
                                        </div>
                                    </div>

                                    {(teesheetEditing || !teesheetConnected) && (
                                        <form className="integration-form" onSubmit={handleSaveTeesheetCredentials}>
                                            <label className="settings-label">
                                                Golf club
                                                <select
                                                    className="settings-input"
                                                    value={teesheetClubId}
                                                    onChange={(event) => setTeesheetClubId(event.target.value)}
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
                                                    onChange={(event) => setTeesheetMemberId(event.target.value)}
                                                    required
                                                />
                                            </label>

                                            <label className="settings-label">
                                                Password
                                                <input
                                                    className="settings-input"
                                                    type="password"
                                                    value={teesheetPassword}
                                                    onChange={(event) => setTeesheetPassword(event.target.value)}
                                                    required
                                                />
                                            </label>

                                            {teesheetError && <p className="auth-error">{teesheetError}</p>}

                                            <button
                                                className="sync-button"
                                                type="submit"
                                                disabled={teesheetSaving || teesheetSyncing}
                                                style={{ marginTop: 8 }}
                                            >
                                                {teesheetSaving
                                                    ? "Saving..."
                                                    : teesheetSyncing
                                                    ? "Syncing..."
                                                    : teesheetConnected
                                                    ? "Update credentials"
                                                    : "Save credentials"}
                                            </button>
                                        </form>
                                    )}

                                    {!teesheetEditing && teesheetSyncMessage && (
                                        <p className="course-count">{teesheetSyncMessage}</p>
                                    )}
                                </div>
                                </>
                            )}
                            </div>
                        </div>
                    </section>
                )}

                {tab === "profile" && (
                    <section className="chart-grid">
                        <div className="chart-card chart-card-wide">
                            <div className="chart-heading">
                                <div>
                                    <p className="eyebrow">PROFILE</p>
                                    <h3>Your details</h3>
                                </div>
                            </div>

                            <p className="course-count">
                                Shown to friends on the Feed and Friends page instead of
                                your email.
                            </p>

                            {statusLoading ? (
                                <p className="course-count">Loading your profile...</p>
                            ) : (
                            <>
                            <div className="profile-avatar-row">
                                <div
                                    className="feed-avatar feed-avatar-small"
                                    style={
                                        avatarUrl
                                            ? { backgroundImage: `url(${avatarUrl})`, backgroundSize: "cover" }
                                            : undefined
                                    }
                                >
                                    {!avatarUrl && (displayName || "?").charAt(0).toUpperCase()}
                                </div>

                                <label className="sync-button" style={{ cursor: "pointer" }}>
                                    {avatarUploading ? "Uploading..." : "Change photo"}
                                    <input
                                        type="file"
                                        accept="image/*"
                                        onChange={handleAvatarChange}
                                        disabled={avatarUploading}
                                        style={{ display: "none" }}
                                    />
                                </label>
                            </div>

                            <form onSubmit={handleSaveProfile}>
                                <label className="settings-label">
                                    Name
                                    <input
                                        className="settings-input"
                                        value={displayName}
                                        onChange={(event) => setDisplayName(event.target.value)}
                                        required
                                    />
                                </label>

                                <label className="settings-label">
                                    Surname
                                    <input
                                        className="settings-input"
                                        value={surname}
                                        onChange={(event) => setSurname(event.target.value)}
                                    />
                                </label>

                                <label className="settings-label">
                                    Nickname
                                    <input
                                        className="settings-input"
                                        value={nickname}
                                        onChange={(event) => setNickname(event.target.value)}
                                    />
                                </label>

                                {nickname.trim() && (
                                    <label className="settings-label">
                                        Show friends my
                                        <select
                                            className="settings-input"
                                            value={displayPreference}
                                            onChange={(event) =>
                                                setDisplayPreference(event.target.value as "name" | "nickname")
                                            }
                                        >
                                            <option value="name">Full name</option>
                                            <option value="nickname">Nickname</option>
                                        </select>
                                    </label>
                                )}

                                <label className="settings-label">
                                    Mobile number
                                    <input
                                        className="settings-input"
                                        type="tel"
                                        value={phone}
                                        onChange={(event) => setPhone(event.target.value)}
                                    />
                                </label>

                                <label className="settings-label">
                                    Country
                                    <input
                                        className="settings-input"
                                        value={country}
                                        onChange={(event) => setCountry(event.target.value)}
                                    />
                                </label>

                                <label className="settings-label">
                                    Province
                                    <input
                                        className="settings-input"
                                        value={province}
                                        onChange={(event) => setProvince(event.target.value)}
                                    />
                                </label>

                                <label className="settings-label">
                                    Date of birth
                                    <input
                                        className="settings-input"
                                        type="date"
                                        value={dateOfBirth}
                                        onChange={(event) => setDateOfBirth(event.target.value)}
                                    />
                                </label>

                                <label className="settings-label">
                                    Sex
                                    <select
                                        className="settings-input"
                                        value={sex}
                                        onChange={(event) => setSex(event.target.value)}
                                    >
                                        <option value="">Prefer not to say</option>
                                        <option value="male">Male</option>
                                        <option value="female">Female</option>
                                        <option value="other">Other</option>
                                        <option value="prefer_not_to_say">Prefer not to say</option>
                                    </select>
                                </label>

                                <label className="auth-checkbox-label">
                                    <input
                                        type="checkbox"
                                        checked={newsletterOptIn}
                                        onChange={(event) => setNewsletterOptIn(event.target.checked)}
                                    />
                                    Send me the GolfCircle newsletter
                                </label>

                                <label className="auth-checkbox-label">
                                    <input
                                        type="checkbox"
                                        checked={sponsorOptIn}
                                        onChange={(event) => setSponsorOptIn(event.target.checked)}
                                    />
                                    Send me sponsor promotions
                                </label>

                                <button
                                    className="sync-button"
                                    type="submit"
                                    disabled={profileSaving}
                                    style={{ marginTop: 12 }}
                                >
                                    {profileSaving ? "Saving..." : "Save profile"}
                                </button>

                                {profileMessage && (
                                    <p className="course-count" style={{ marginTop: 8 }}>
                                        {profileMessage}
                                    </p>
                                )}
                            </form>
                            </>
                            )}
                        </div>
                    </section>
                )}
            </main>
        </>
    );
}

export default SettingsPage;
