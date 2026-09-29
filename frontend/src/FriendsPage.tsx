import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { API, authFetch } from "./api";
import { supabase } from "./supabaseClient";
import AppNav from "./AppNav";
import BrandLogo from "./BrandLogo";
import { Avatar } from "./FriendProfileModal";

type SearchResult = {
    user_id: string;
    display_name: string;
    avatar_url: string | null;
    relationship: "none" | "pending_sent" | "pending_received" | "friends";
};

type TeesheetBuddy = {
    buddy_name: string;
    on_golfcircle: boolean;
    user_id: string | null;
    display_name: string | null;
    avatar_url: string | null;
    relationship: "none" | "pending_sent" | "pending_received" | null;
};

// Derived from wherever the app is actually running, same as FeedPage's
// share links -- this file doesn't otherwise need to know its own domain.
const APP_URL = `${window.location.origin}${import.meta.env.BASE_URL}`;

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

    const [query, setQuery] = useState("");
    const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
    const [searching, setSearching] = useState(false);
    const [teesheetBuddies, setTeesheetBuddies] = useState<TeesheetBuddy[]>([]);
    const [tab, setTab] = useState<"friends" | "buddies">("friends");
    const [sendingTo, setSendingTo] = useState<string | null>(null);
    const [sendError, setSendError] = useState<string | null>(null);
    const [sendMessage, setSendMessage] = useState<string | null>(null);

    async function loadData() {
        try {
            const [friendsRes, requestsRes, sentRes, feedRes, buddiesRes] = await Promise.all([
                authFetch(`${API}/friends`),
                authFetch(`${API}/friends/requests`),
                authFetch(`${API}/friends/requests/sent`),
                authFetch(`${API}/friends/feed?limit=5`),
                authFetch(`${API}/friends/teesheet-buddies`),
            ]);

            if (friendsRes.ok) setFriends(await friendsRes.json());
            if (requestsRes.ok) setRequests(await requestsRes.json());
            if (sentRes.ok) setSentRequests(await sentRes.json());
            if (feedRes.ok) setFeed(await feedRes.json());
            if (buddiesRes.ok) setTeesheetBuddies(await buddiesRes.json());
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

    useEffect(() => {
        const trimmed = query.trim();

        if (trimmed.length < 2) {
            setSearchResults([]);
            setSearching(false);
            return;
        }

        setSearching(true);
        const timeout = setTimeout(async () => {
            try {
                const response = await authFetch(`${API}/friends/search?q=${encodeURIComponent(trimmed)}`);
                if (response.ok) setSearchResults(await response.json());
            } catch (error) {
                console.error(error);
            } finally {
                setSearching(false);
            }
        }, 300);

        return () => clearTimeout(timeout);
    }, [query]);

    async function handleSendRequest(targetUserId: string) {
        setSendingTo(targetUserId);
        setSendError(null);
        setSendMessage(null);

        try {
            const response = await authFetch(`${API}/friends/requests/by-id`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ user_id: targetUserId }),
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
                const newRelationship = body?.status === "accepted" ? "friends" : "pending_sent";

                setSearchResults((prev) =>
                    prev.map((result) =>
                        result.user_id === targetUserId
                            ? { ...result, relationship: newRelationship }
                            : result
                    )
                );
                setTeesheetBuddies((prev) =>
                    newRelationship === "friends"
                        ? prev.filter((buddy) => buddy.user_id !== targetUserId)
                        : prev.map((buddy) =>
                              buddy.user_id === targetUserId
                                  ? { ...buddy, relationship: newRelationship }
                                  : buddy
                          )
                );
                await loadData();
            }
        } catch (error) {
            console.error(error);
            setSendError("Could not reach the backend");
        } finally {
            setSendingTo(null);
        }
    }

    function inviteBuddyViaWhatsApp(buddyName: string) {
        const firstName = buddyName.split(" ")[0];
        const text =
            `Hey ${firstName}! I'm using GolfCircle to track my rounds, handicap, ` +
            `and connect with the buddies I play with -- thought you'd want in too. ` +
            `Join me here: ${APP_URL}`;

        window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, "_blank");
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

                <AppNav />
            </header>

            <main className="content">
                <section className="course-hero">
                    <p className="eyebrow">GOLFBOOK</p>
                    <h2>Friends &amp; their rounds.</h2>
                    <p>Add friends to see the rounds and courses they've been playing.</p>
                </section>

                <div className="settings-tabs">
                    <button
                        className={tab === "friends" ? "settings-tab active" : "settings-tab"}
                        onClick={() => setTab("friends")}
                    >
                        Friends
                    </button>
                    <button
                        className={tab === "buddies" ? "settings-tab active" : "settings-tab"}
                        onClick={() => setTab("buddies")}
                    >
                        People you play with{teesheetBuddies.length > 0 ? ` (${teesheetBuddies.length})` : ""}
                    </button>
                </div>

                {tab === "friends" && (
                <>
                <section className="chart-card">
                    <div className="chart-heading">
                        <div>
                            <p className="eyebrow">ADD A FRIEND</p>
                            <h3>Find someone on GolfCircle</h3>
                        </div>
                    </div>

                    <label className="settings-label">
                        Search by name or email
                        <input
                            className="settings-input"
                            type="text"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Start typing a name or email..."
                        />
                    </label>

                    {sendError && <p className="auth-error">{sendError}</p>}
                    {sendMessage && <p className="course-count">{sendMessage}</p>}

                    {searching && <p className="course-count" style={{ marginTop: 8 }}>Searching...</p>}

                    {!searching && query.trim().length >= 2 && searchResults.length === 0 && (
                        <p className="course-count" style={{ marginTop: 8 }}>No one found.</p>
                    )}

                    {searchResults.length > 0 && (
                        <div className="round-list" style={{ marginTop: 12 }}>
                            {searchResults.map((result) => (
                                <div className="round-row" key={result.user_id}>
                                    <div className="friend-search-result">
                                        <Avatar name={result.display_name} avatarUrl={result.avatar_url} small />
                                        <strong>{result.display_name}</strong>
                                    </div>

                                    {result.relationship === "friends" && (
                                        <span className="course-count">Already friends</span>
                                    )}
                                    {result.relationship === "pending_sent" && (
                                        <span className="course-count">Request sent</span>
                                    )}
                                    {result.relationship === "pending_received" && (
                                        <span className="course-count">Sent you a request — see below</span>
                                    )}
                                    {result.relationship === "none" && (
                                        <button
                                            className="sync-button"
                                            onClick={() => handleSendRequest(result.user_id)}
                                            disabled={sendingTo === result.user_id}
                                        >
                                            {sendingTo === result.user_id ? "Sending..." : "Add"}
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </section>

                </>
                )}

                {tab === "buddies" && (
                    <>
                        <section className="section-heading">
                            <div>
                                <p className="eyebrow">TEESHEET BUDDIES</p>
                                <h3>People you play with</h3>
                            </div>

                            <span className="course-count">{teesheetBuddies.length}</span>
                        </section>

                        {teesheetBuddies.length === 0 && (
                            <p className="course-count" style={{ padding: 16 }}>
                                No teesheet buddies to show — either you're all set, or none of
                                your buddies have connected yet.
                            </p>
                        )}

                        <div className="round-list">
                            {teesheetBuddies.map((buddy) => (
                                <div className="round-row" key={buddy.user_id || buddy.buddy_name}>
                                    <div className="friend-search-result">
                                        <Avatar
                                            name={buddy.display_name || buddy.buddy_name}
                                            avatarUrl={buddy.avatar_url}
                                            small
                                        />
                                        <strong>{buddy.display_name || buddy.buddy_name}</strong>
                                    </div>

                                    {!buddy.on_golfcircle && (
                                        <button
                                            className="round-row-button"
                                            onClick={() => inviteBuddyViaWhatsApp(buddy.buddy_name)}
                                        >
                                            Invite via WhatsApp
                                        </button>
                                    )}

                                    {buddy.on_golfcircle && buddy.relationship === "pending_sent" && (
                                        <span className="course-count">Request sent</span>
                                    )}

                                    {buddy.on_golfcircle && buddy.relationship === "pending_received" && (
                                        <span className="course-count">Sent you a request — see below</span>
                                    )}

                                    {buddy.on_golfcircle && buddy.relationship === "none" && buddy.user_id && (
                                        <button
                                            className="sync-button"
                                            onClick={() => handleSendRequest(buddy.user_id!)}
                                            disabled={sendingTo === buddy.user_id}
                                        >
                                            {sendingTo === buddy.user_id ? "Sending..." : "Add"}
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    </>
                )}

                {tab === "friends" && (
                <>
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
                </>
                )}
            </main>
        </>
    );
}

export default FriendsPage;
