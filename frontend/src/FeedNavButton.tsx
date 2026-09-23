import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { API, authFetch } from "./api";

function FeedNavButton() {
    const navigate = useNavigate();
    const [hasUnread, setHasUnread] = useState(false);

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

    return (
        <button
            className="header-secondary-button nav-button-with-badge"
            onClick={() => navigate("/feed")}
        >
            Feed
            {hasUnread && <span className="nav-badge" />}
        </button>
    );
}

export default FeedNavButton;
