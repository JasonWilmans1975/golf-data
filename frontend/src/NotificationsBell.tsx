import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { API, authFetch } from "./api";
import { supabase } from "./supabaseClient";

type Notification = {
    id: string;
    type: "like" | "mention" | "friend_request";
    actor_name: string;
    reaction: string | null;
    target_item_type: string | null;
    target_item_id: number | null;
    request_id: number | null;
    created_at: string;
    read: boolean;
};

const REACTION_EMOJI: Record<string, string> = {
    like: "👍",
    love: "❤️",
    haha: "😆",
    wow: "😮",
    sad: "😢",
    angry: "😠",
};

function formatRelative(value: string) {
    const diffMs = Date.now() - new Date(value).getTime();
    const minutes = Math.floor(diffMs / 60000);

    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;

    const days = Math.floor(hours / 24);
    return `${days}d`;
}

function notificationText(n: Notification) {
    if (n.type === "friend_request") {
        return `${n.actor_name} sent you a friend request`;
    }

    const noun = n.target_item_type === "round" ? "round" : "post";

    if (n.type === "like") {
        return `${n.actor_name} reacted ${REACTION_EMOJI[n.reaction || "like"]} to your ${noun}`;
    }

    return `${n.actor_name} mentioned you in a ${noun}`;
}

function NotificationsBell() {
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [loaded, setLoaded] = useState(false);
    const wrapRef = useRef<HTMLDivElement>(null);

    const unreadCount = notifications.filter((n) => !n.read).length;

    function refetch() {
        return authFetch(`${API}/notifications`)
            .then((response) => (response.ok ? response.json() : null))
            .then((body) => {
                if (body) setNotifications(body);
            })
            .catch(() => {})
            .finally(() => setLoaded(true));
    }

    useEffect(() => {
        // Fetch the full list up front instead of waiting until the bell is
        // clicked -- opening it should be instant, not trigger a fresh
        // network round trip.
        let debounceTimer: ReturnType<typeof setTimeout> | null = null;

        function refetchDebounced() {
            // A burst of likes/comments arriving together should collapse
            // into one re-fetch, not one per event.
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(refetch, 500);
        }

        refetch();

        // Realtime here is just a "something changed, go re-fetch" signal --
        // the actual notification list (whose content, who's a friend) is
        // always recomputed by the trusted GET /notifications endpoint, not
        // read directly off the realtime payload.
        const channel = supabase
            .channel("notifications-changes")
            .on("postgres_changes", { event: "*", schema: "public", table: "feed_likes" }, refetchDebounced)
            .on("postgres_changes", { event: "INSERT", schema: "public", table: "posts" }, refetchDebounced)
            .on(
                "postgres_changes",
                { event: "INSERT", schema: "public", table: "feed_comments" },
                refetchDebounced
            )
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "friend_requests" },
                refetchDebounced
            )
            .subscribe();

        return () => {
            if (debounceTimer) clearTimeout(debounceTimer);
            supabase.removeChannel(channel);
        };
    }, []);

    useEffect(() => {
        if (!open) return;

        function handleClickOutside(event: MouseEvent) {
            if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
                setOpen(false);
            }
        }

        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [open]);

    function toggleOpen() {
        const next = !open;
        setOpen(next);

        // Rows already loaded keep showing as unread for this viewing (like
        // Facebook), but opening the panel clears the badge count for next
        // time.
        if (next && unreadCount > 0) {
            authFetch(`${API}/notifications/ack`, { method: "POST" }).catch(() => {});
        }
    }

    function handleSelect(n: Notification) {
        if (n.type === "friend_request") return;
        setOpen(false);
        navigate(`/feed?highlight=${n.target_item_type}:${n.target_item_id}`);
    }

    async function handleRespond(requestId: number, accept: boolean, event: ReactMouseEvent) {
        event.stopPropagation();

        try {
            const response = await authFetch(`${API}/friends/requests/${requestId}/${accept ? "accept" : "decline"}`, {
                method: "POST",
            });

            if (response.ok) {
                setNotifications((prev) => prev.filter((n) => n.request_id !== requestId));
            }
        } catch (error) {
            console.error(error);
        }
    }

    return (
        <div className="notifications-wrap" ref={wrapRef}>
            <button className="bottom-nav-button" aria-label="Notifications" onClick={toggleOpen}>
                <span className="bottom-nav-icon-wrap">
                    <span className="bottom-nav-icon">
                        <svg
                            width="22"
                            height="22"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                        </svg>
                    </span>
                    {unreadCount > 0 && (
                        <span className="nav-badge-count">{unreadCount > 9 ? "9+" : unreadCount}</span>
                    )}
                </span>
                <span className="bottom-nav-label">Notifications</span>
            </button>

            {open && (
                <div className="notifications-panel notifications-panel-up">
                    <div className="notifications-panel-header">Notifications</div>

                    {!loaded ? (
                        <div className="notifications-empty">Loading...</div>
                    ) : notifications.length === 0 ? (
                        <div className="notifications-empty">Nothing yet.</div>
                    ) : (
                        notifications.map((n) => (
                            <div
                                key={n.id}
                                className={`notification-row${n.read ? "" : " unread"}${
                                    n.type === "friend_request" ? " notification-row-static" : ""
                                }`}
                                onClick={() => handleSelect(n)}
                                role={n.type === "friend_request" ? undefined : "button"}
                            >
                                <span className="notification-text">{notificationText(n)}</span>
                                <span className="notification-time">{formatRelative(n.created_at)}</span>

                                {n.type === "friend_request" && n.request_id != null && (
                                    <div className="notification-actions">
                                        <button
                                            className="sync-button"
                                            onClick={(event) => handleRespond(n.request_id!, true, event)}
                                        >
                                            Accept
                                        </button>
                                        <button
                                            className="integration-action-button"
                                            onClick={(event) => handleRespond(n.request_id!, false, event)}
                                        >
                                            Decline
                                        </button>
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}

export default NotificationsBell;
