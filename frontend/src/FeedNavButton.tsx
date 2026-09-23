import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { API, authFetch } from "./api";

type Notification = {
    id: string;
    type: "like" | "mention";
    actor_name: string;
    reaction: string | null;
    target_item_type: string;
    target_item_id: number;
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
    const noun = n.target_item_type === "round" ? "round" : "post";

    if (n.type === "like") {
        return `${n.actor_name} reacted ${REACTION_EMOJI[n.reaction || "like"]} to your ${noun}`;
    }

    return `${n.actor_name} mentioned you in a ${noun}`;
}

function FeedNavButton() {
    const navigate = useNavigate();
    const [hasUnread, setHasUnread] = useState(false);
    const [open, setOpen] = useState(false);
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [loading, setLoading] = useState(false);
    const wrapRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        let cancelled = false;

        authFetch(`${API}/notifications/summary`)
            .then((response) => (response.ok ? response.json() : null))
            .then((body) => {
                if (!cancelled && body) setHasUnread(Boolean(body.has_unread));
            })
            .catch(() => {});

        return () => {
            cancelled = true;
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

    async function toggleOpen() {
        const next = !open;
        setOpen(next);

        if (!next) return;

        setLoading(true);

        try {
            const response = await authFetch(`${API}/notifications`);
            if (response.ok) setNotifications(await response.json());
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }

        setHasUnread(false);
        authFetch(`${API}/notifications/ack`, { method: "POST" }).catch(() => {});
    }

    function handleSelect(n: Notification) {
        setOpen(false);
        navigate(`/feed?highlight=${n.target_item_type}:${n.target_item_id}`);
    }

    return (
        <div className="notifications-wrap" ref={wrapRef}>
            <button className="header-secondary-button" onClick={() => navigate("/feed")}>
                Feed
            </button>

            <button
                className="notifications-bell nav-button-with-badge"
                aria-label="Notifications"
                onClick={toggleOpen}
            >
                🔔
                {hasUnread && <span className="nav-badge" />}
            </button>

            {open && (
                <div className="notifications-panel">
                    <div className="notifications-panel-header">Notifications</div>

                    {loading ? (
                        <div className="notifications-empty">Loading...</div>
                    ) : notifications.length === 0 ? (
                        <div className="notifications-empty">Nothing yet.</div>
                    ) : (
                        notifications.map((n) => (
                            <button
                                key={n.id}
                                className={`notification-row${n.read ? "" : " unread"}`}
                                onClick={() => handleSelect(n)}
                            >
                                <span className="notification-text">{notificationText(n)}</span>
                                <span className="notification-time">{formatRelative(n.created_at)}</span>
                            </button>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}

export default FeedNavButton;
