import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { API, authFetch } from "./api";
import TopbarActions from "./TopbarActions";
import BrandLogo from "./BrandLogo";
import NavButton from "./NavButton";
import FeedNavButton from "./FeedNavButton";
import { Avatar, FriendProfileModal } from "./FriendProfileModal";

type Friend = {
    user_id: string;
    display_name: string;
    avatar_url: string | null;
};

type Tournament = {
    id: number;
    name: string;
    start_date: string;
    end_date: string;
    creator_user_id: string;
    creator_name: string;
    my_status: "invited" | "accepted" | "declined";
};

type LeaderboardEntry = {
    user_id: string;
    player_name: string;
    avatar_url: string | null;
    rounds_played: number;
    total_stableford: number;
    total_gross: number;
};

type PendingEntry = {
    user_id: string;
    player_name: string;
    avatar_url: string | null;
    status: "invited" | "declined";
};

type TournamentDetail = {
    tournament: Tournament;
    my_status: "invited" | "accepted" | "declined";
    leaderboard: LeaderboardEntry[];
    pending: PendingEntry[];
};

function formatDateRange(start: string, end: string) {
    const format = (value: string) =>
        new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "short", year: "numeric" }).format(
            new Date(value)
        );

    return start === end ? format(start) : `${format(start)} – ${format(end)}`;
}

function TournamentsPage() {
    const [searchParams] = useSearchParams();
    const [tournaments, setTournaments] = useState<Tournament[]>([]);
    const [friends, setFriends] = useState<Friend[]>([]);
    const [loading, setLoading] = useState(true);

    const [selectedId, setSelectedId] = useState<number | null>(
        searchParams.get("id") ? Number(searchParams.get("id")) : null
    );
    const [detail, setDetail] = useState<TournamentDetail | null>(null);
    const [openProfileUserId, setOpenProfileUserId] = useState<string | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);

    const [showCreate, setShowCreate] = useState(false);
    const [name, setName] = useState("");
    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");
    const [inviteeIds, setInviteeIds] = useState<Set<string>>(new Set());
    const [creating, setCreating] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);

    async function loadTournaments() {
        try {
            const response = await authFetch(`${API}/tournaments`);
            if (response.ok) setTournaments(await response.json());
        } catch (error) {
            console.error(error);
        }
    }

    async function loadDetail(id: number) {
        setDetailLoading(true);
        try {
            const response = await authFetch(`${API}/tournaments/${id}`);
            if (response.ok) setDetail(await response.json());
        } catch (error) {
            console.error(error);
        } finally {
            setDetailLoading(false);
        }
    }

    useEffect(() => {
        async function init() {
            await Promise.all([
                loadTournaments(),
                (async () => {
                    try {
                        const response = await authFetch(`${API}/friends`);
                        if (response.ok) setFriends(await response.json());
                    } catch (error) {
                        console.error(error);
                    }
                })(),
            ]);
            setLoading(false);
        }

        init();
    }, []);

    useEffect(() => {
        if (selectedId != null) loadDetail(selectedId);
    }, [selectedId]);

    function toggleInvitee(userId: string) {
        setInviteeIds((prev) => {
            const next = new Set(prev);
            if (next.has(userId)) next.delete(userId);
            else next.add(userId);
            return next;
        });
    }

    async function handleCreate(event: FormEvent) {
        event.preventDefault();
        setCreateError(null);
        setCreating(true);

        try {
            const response = await authFetch(`${API}/tournaments`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name,
                    start_date: startDate,
                    end_date: endDate || startDate,
                    invitee_ids: Array.from(inviteeIds),
                }),
            });

            if (!response.ok) {
                const body = await response.json().catch(() => null);
                throw new Error(body?.detail || "Could not create tournament");
            }

            const created = await response.json();
            setShowCreate(false);
            setName("");
            setStartDate("");
            setEndDate("");
            setInviteeIds(new Set());
            await loadTournaments();
            setSelectedId(created.id);
        } catch (error) {
            setCreateError(error instanceof Error ? error.message : "Something went wrong");
        } finally {
            setCreating(false);
        }
    }

    async function handleRespond(accept: boolean) {
        if (selectedId == null) return;

        try {
            const response = await authFetch(`${API}/tournaments/${selectedId}/respond`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ accept }),
            });

            if (response.ok) {
                await Promise.all([loadTournaments(), loadDetail(selectedId)]);
            }
        } catch (error) {
            console.error(error);
        }
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
                </TopbarActions>
            </header>

            <main className="content">
                <section className="course-hero">
                    <p className="eyebrow">TOURNAMENTS</p>
                    <h2>Bring the season to life.</h2>
                    <p>Create a tournament, invite friends, and let the day's scores decide the leaderboard.</p>

                    <button className="sync-button" style={{ marginTop: 12 }} onClick={() => setShowCreate((v) => !v)}>
                        {showCreate ? "Cancel" : "Create tournament"}
                    </button>
                </section>

                {showCreate && (
                    <section className="chart-grid">
                        <div className="chart-card chart-card-wide">
                            <div className="chart-heading">
                                <div>
                                    <p className="eyebrow">NEW TOURNAMENT</p>
                                    <h3>Set it up</h3>
                                </div>
                            </div>

                            <form onSubmit={handleCreate}>
                                <label className="settings-label">
                                    Name
                                    <input
                                        className="settings-input"
                                        value={name}
                                        onChange={(event) => setName(event.target.value)}
                                        required
                                    />
                                </label>

                                <label className="settings-label">
                                    Start date
                                    <input
                                        className="settings-input"
                                        type="date"
                                        value={startDate}
                                        onChange={(event) => setStartDate(event.target.value)}
                                        required
                                    />
                                </label>

                                <label className="settings-label">
                                    End date (leave blank for a single day)
                                    <input
                                        className="settings-input"
                                        type="date"
                                        value={endDate}
                                        onChange={(event) => setEndDate(event.target.value)}
                                    />
                                </label>

                                <label className="settings-label">Invite friends</label>

                                {friends.length === 0 ? (
                                    <p className="course-count">Add some friends first before creating a tournament.</p>
                                ) : (
                                    <div className="round-list">
                                        {friends.map((friend) => (
                                            <label
                                                key={friend.user_id}
                                                className="auth-checkbox-label"
                                                style={{ padding: "8px 0" }}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={inviteeIds.has(friend.user_id)}
                                                    onChange={() => toggleInvitee(friend.user_id)}
                                                />
                                                {friend.display_name}
                                            </label>
                                        ))}
                                    </div>
                                )}

                                {createError && <p className="auth-error">{createError}</p>}

                                <button
                                    className="sync-button"
                                    type="submit"
                                    disabled={creating}
                                    style={{ marginTop: 12 }}
                                >
                                    {creating ? "Creating..." : "Create tournament"}
                                </button>
                            </form>
                        </div>
                    </section>
                )}

                <section className="chart-grid">
                    <div className="chart-card">
                        <div className="chart-heading">
                            <div>
                                <p className="eyebrow">YOUR TOURNAMENTS</p>
                                <h3>{tournaments.length} total</h3>
                            </div>
                        </div>

                        {loading ? (
                            <p className="course-count">Loading...</p>
                        ) : tournaments.length === 0 ? (
                            <p className="course-count">No tournaments yet — create one above.</p>
                        ) : (
                            <div className="round-list">
                                {tournaments.map((tournament) => (
                                    <div
                                        className="round-row"
                                        key={tournament.id}
                                        style={{
                                            cursor: "pointer",
                                            outline: selectedId === tournament.id ? "2px solid var(--accent)" : undefined,
                                        }}
                                        onClick={() => setSelectedId(tournament.id)}
                                    >
                                        <div>
                                            <strong>{tournament.name}</strong>
                                            <span>{formatDateRange(tournament.start_date, tournament.end_date)}</span>
                                        </div>

                                        <div>
                                            <strong>{tournament.creator_name}</strong>
                                            <span>Created by</span>
                                        </div>

                                        <div>
                                            <strong style={{ textTransform: "capitalize" }}>{tournament.my_status}</strong>
                                            <span>Your status</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {selectedId != null && (
                        <div className="chart-card chart-card-wide">
                            <div className="chart-heading">
                                <div>
                                    <p className="eyebrow">LEADERBOARD</p>
                                    <h3>{detail?.tournament.name || "Loading..."}</h3>
                                </div>
                            </div>

                            {detailLoading || !detail ? (
                                <p className="course-count">Loading...</p>
                            ) : (
                                <>
                                    {detail.my_status === "invited" && (
                                        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                                            <button className="sync-button" onClick={() => handleRespond(true)}>
                                                Accept
                                            </button>
                                            <button className="sync-button" onClick={() => handleRespond(false)}>
                                                Decline
                                            </button>
                                        </div>
                                    )}

                                    {detail.leaderboard.length === 0 ? (
                                        <p className="course-count">No scores yet for this tournament's dates.</p>
                                    ) : (
                                        <div className="round-list">
                                            {detail.leaderboard.map((entry, index) => (
                                                <div className="round-row" key={entry.user_id}>
                                                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                                        <Avatar
                                                            name={entry.player_name}
                                                            avatarUrl={entry.avatar_url}
                                                            small
                                                            onClick={() => setOpenProfileUserId(entry.user_id)}
                                                        />
                                                        <div>
                                                            <strong>
                                                                {index + 1}. {entry.player_name}
                                                            </strong>
                                                            <span>{entry.rounds_played} round{entry.rounds_played === 1 ? "" : "s"}</span>
                                                        </div>
                                                    </div>

                                                    <div>
                                                        <strong>{entry.total_stableford}</strong>
                                                        <span>Total Stableford</span>
                                                    </div>

                                                    <div>
                                                        <strong>{entry.total_gross}</strong>
                                                        <span>Total gross</span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {detail.pending.length > 0 && (
                                        <div style={{ marginTop: 12 }}>
                                            <p className="course-count" style={{ marginBottom: 8 }}>
                                                Waiting on:
                                            </p>
                                            <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                                                {detail.pending.map((p) => (
                                                    <div
                                                        key={p.user_id}
                                                        style={{
                                                            display: "flex",
                                                            alignItems: "center",
                                                            gap: 6,
                                                            cursor: "pointer",
                                                        }}
                                                        onClick={() => setOpenProfileUserId(p.user_id)}
                                                    >
                                                        <Avatar name={p.player_name} avatarUrl={p.avatar_url} small />
                                                        <span className="course-count">{p.player_name}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    )}
                </section>
            </main>

            {openProfileUserId && (
                <FriendProfileModal userId={openProfileUserId} onClose={() => setOpenProfileUserId(null)} />
            )}
        </>
    );
}

export default TournamentsPage;
