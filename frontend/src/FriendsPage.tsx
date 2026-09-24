import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { API, authFetch } from "./api";
import { supabase } from "./supabaseClient";
import TopbarActions from "./TopbarActions";
import BrandLogo from "./BrandLogo";
import NavButton from "./NavButton";
import FeedNavButton from "./FeedNavButton";

type Friend = {
    user_id: string;
    display_name: string;
    friends_since: string;
    current_handicap_index: number | null;
    home_course_name: string | null;
};

type IncomingRequest = {
    id: number;
    from_user_id: string;
    display_name: string;
    created_at: string;
};

type SentRequest = {
    id: number;
    to_user_id: string;
    display_name: string;
    created_at: string;
};

type FeedItem = {
    item_id: number;
    user_id: string;
    player_name: string;
    posted_at: string;
    adjusted_gross: number | null;
    stableford_points: number | null;
    course_name: string | null;
    country_name: string | null;
    country_flag_url: string | null;
};

function formatDate(value: string | null | undefined) {
    if (!value) return "—";

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";

    return new Intl.DateTimeFormat("en-ZA", {
        day: "numeric",
        month: "short",
        year: "numeric",
    }).format(date);
}

function FriendsPage() {
    const navigate = useNavigate();

    const [friends, setFriends] = useState<Friend[]>([]);
    const [requests, setRequests] = useState<IncomingRequest[]>([]);
    const [sentRequests, setSentRequests] = useState<SentRequest[]>([]);
    const [feed, setFeed] = useState<FeedItem[]>([]);
    const [loading, setLoading] = useState(true);

    const [email, setEmail] = useState("");
    const [sending, setSending] = useState(false);
    const [sendError, setSendError] = useState<string | null>(null);
    const [sendMessage, setSendMessage] = useState<string | null>(null);

    async function loadData() {
        try {
            const [friendsRes, requestsRes, sentRes, feedRes] = await Promise.all([
                authFetch(`${API}/friends`),
                authFetch(`${API}/friends/requests`),
                authFetch(`${API}/friends/requests/sent`),
                authFetch(`${API}/friends/feed?limit=5`),
            ]);

            if (friendsRes.ok) setFriends(await friendsRes.json());
            if (requestsRes.ok) setRequests(await requestsRes.json());
            if (sentRes.ok) setSentRequests(await sentRes.json());
            if (feedRes.ok) setFeed(await feedRes.json());
        } catch (error) {
            console.error(error);
        }
    }

    useEffect(() => {
        loadData().finally(() => setLoading(false));

        // Pick up newly-accepted requests (or new incoming ones) instantly
        // via Supabase Realtime instead of polling. friend_requests has an
        // RLS policy scoped to auth.uid(), so this only ever delivers rows
        // that involve the logged-in user.
        const channel = supabase
            .channel("friend-requests-changes")
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "friend_requests" },
                () => {
                    loadData();
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    async function handleSendRequest(event: FormEvent) {
        event.preventDefault();
        setSending(true);
        setSendError(null);
        setSendMessage(null);

        try {
            const response = await authFetch(`${API}/friends/requests`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email }),
            });

            const body = await response.json().catch(() => null);

            if (!response.ok) {
                setSendError(body?.detail || "Could not send friend request");
            } else {
                setSendMessage(
                    body?.status === "accepted"
                        ? "You're now friends!"
                        : "Friend request sent."
                );
                setEmail("");
                await loadData();
            }
        } catch (error) {
            console.error(error);
            setSendError("Could not reach the backend");
        } finally {
            setSending(false);
        }
    }

    async function handleRespond(requestId: number, accept: boolean) {
        try {
            await authFetch(
                `${API}/friends/requests/${requestId}/${accept ? "accept" : "decline"}`,
                { method: "POST" }
            );
            await loadData();
        } catch (error) {
            console.error(error);
        }
    }

    async function handleCancelRequest(requestId: number) {
        try {
            await authFetch(`${API}/friends/requests/${requestId}`, { method: "DELETE" });
            await loadData();
        } catch (error) {
            console.error(error);
        }
    }

    async function handleRemoveFriend(friendId: string, name: string) {
        if (!window.confirm(`Remove ${name} as a friend?`)) return;

        try {
            await authFetch(`${API}/friends/${friendId}`, { method: "DELETE" });
            await loadData();
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
                    <NavButton to="/handicap">Handicap</NavButton>
                    <NavButton to="/leaderboard">Leaderboard</NavButton>
                    <NavButton to="/wellness">Wellness</NavButton>
                    <NavButton to="/teesheet">Teesheet</NavButton>
                    <FeedNavButton />
                    <NavButton to="/settings">Settings</NavButton>
                </TopbarActions>
            </header>

            <main className="content">
                <section className="course-hero">
                    <p className="eyebrow">GOLFBOOK</p>
                    <h2>Friends &amp; their rounds.</h2>
                    <p>Add friends to see the rounds and courses they've been playing.</p>
                </section>

                <section className="chart-card">
                    <div className="chart-heading">
                        <div>
                            <p className="eyebrow">ADD A FRIEND</p>
                            <h3>Send a friend request</h3>
                        </div>
                    </div>

                    <form onSubmit={handleSendRequest}>
                        <label className="settings-label">
                            Their email address
                            <input
                                className="settings-input"
                                type="email"
                                value={email}
                                onChange={(event) => setEmail(event.target.value)}
                                placeholder="friend@example.com"
                                required
                            />
                        </label>

                        {sendError && <p className="auth-error">{sendError}</p>}
                        {sendMessage && <p className="course-count">{sendMessage}</p>}

                        <button
                            className="sync-button"
                            type="submit"
                            disabled={sending}
                            style={{ marginTop: 12 }}
                        >
                            {sending ? "Sending..." : "Send request"}
                        </button>
                    </form>
                </section>

                {requests.length > 0 && (
                    <>
                        <section className="section-heading">
                            <div>
                                <p className="eyebrow">PENDING</p>
                                <h3>Friend requests</h3>
                            </div>
                        </section>

                        <div className="round-list">
                            {requests.map((request) => (
                                <div className="round-row" key={request.id}>
                                    <div>
                                        <strong>{request.display_name}</strong>
                                        <span>Sent {formatDate(request.created_at)}</span>
                                    </div>

                                    <div className="friend-request-actions">
                                        <button
                                            className="sync-button"
                                            onClick={() => handleRespond(request.id, true)}
                                        >
                                            Accept
                                        </button>

                                        <button
                                            className="round-row-button"
                                            onClick={() => handleRespond(request.id, false)}
                                        >
                                            Decline
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </>
                )}

                {sentRequests.length > 0 && (
                    <>
                        <section className="section-heading">
                            <div>
                                <p className="eyebrow">AWAITING REPLY</p>
                                <h3>Sent requests</h3>
                            </div>
                        </section>

                        <div className="round-list">
                            {sentRequests.map((request) => (
                                <div className="round-row" key={request.id}>
                                    <div>
                                        <strong>{request.display_name}</strong>
                                        <span>Sent {formatDate(request.created_at)}</span>
                                    </div>

                                    <div className="friend-request-actions">
                                        <button
                                            className="round-row-button"
                                            onClick={() => handleCancelRequest(request.id)}
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </>
                )}

                <section className="section-heading">
                    <div>
                        <p className="eyebrow">YOUR CIRCLE</p>
                        <h3>Friends</h3>
                    </div>

                    <span className="course-count">
                        {friends.length} {friends.length === 1 ? "friend" : "friends"}
                    </span>
                </section>

                <div className="round-list">
                    {friends.length === 0 ? (
                        <p className="course-count" style={{ padding: 16 }}>
                            {loading ? "Loading..." : "No friends yet — add one above."}
                        </p>
                    ) : (
                        friends.map((friend) => (
                            <div className="round-row" key={friend.user_id}>
                                <div>
                                    <strong>{friend.display_name}</strong>
                                    <span>Friends since {formatDate(friend.friends_since)}</span>
                                </div>

                                <div>
                                    <strong>{friend.current_handicap_index ?? "—"}</strong>
                                    <span>Handicap</span>
                                </div>

                                <div>
                                    <strong>{friend.home_course_name || "—"}</strong>
                                    <span>Home course</span>
                                </div>

                                <button
                                    className="round-row-button"
                                    onClick={() =>
                                        handleRemoveFriend(friend.user_id, friend.display_name)
                                    }
                                >
                                    Remove
                                </button>
                            </div>
                        ))
                    )}
                </div>

                <section className="section-heading">
                    <div>
                        <p className="eyebrow">ACTIVITY</p>
                        <h3>Recent rounds from friends</h3>
                    </div>
                </section>

                <div className="round-list">
                    {feed.length === 0 ? (
                        <p className="course-count" style={{ padding: 16 }}>
                            {loading
                                ? "Loading..."
                                : "Nothing yet — once your friends log rounds, they'll show up here."}
                        </p>
                    ) : (
                        feed.map((item) => (
                            <div className="round-row" key={item.item_id}>
                                <div>
                                    <strong>{item.player_name}</strong>
                                    <span>{formatDate(item.posted_at)}</span>
                                </div>

                                <div>
                                    <strong>
                                        {item.country_flag_url && (
                                            <img
                                                src={item.country_flag_url}
                                                alt={item.country_name || ""}
                                                className="country-flag"
                                                onError={(event) => {
                                                    event.currentTarget.style.display = "none";
                                                }}
                                            />
                                        )}
                                        {item.course_name || "—"}
                                    </strong>
                                    <span>Course</span>
                                </div>

                                <div>
                                    <strong>{item.adjusted_gross ?? "—"}</strong>
                                    <span>Gross</span>
                                </div>

                                <div>
                                    <strong>{item.stableford_points ?? "—"}</strong>
                                    <span>Stableford</span>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </main>
        </>
    );
}

export default FriendsPage;
