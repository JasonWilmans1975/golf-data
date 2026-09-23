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
                <span className="bottom-nav-icon">👥</span>
                <span className="bottom-nav-label">Friends</span>
            </button>

            <NotificationsBell />
        </nav>
    );
}

export default BottomNav;
