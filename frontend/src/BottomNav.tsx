import { useLocation, useNavigate } from "react-router-dom";
import NotificationsBell from "./NotificationsBell";

function BottomNav() {
    const navigate = useNavigate();
    const location = useLocation();

    return (
        <nav className="bottom-nav">
            <button
                className={`bottom-nav-button${location.pathname === "/friends" ? " active" : ""}`}
                onClick={() => navigate("/friends")}
            >
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
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                    </svg>
                </span>
                <span className="bottom-nav-label">Friends</span>
            </button>

            <NotificationsBell />
        </nav>
    );
}

export default BottomNav;
