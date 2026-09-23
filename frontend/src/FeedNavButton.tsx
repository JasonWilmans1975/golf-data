import { useNavigate } from "react-router-dom";
import NotificationsBell from "./NotificationsBell";

function FeedNavButton() {
    const navigate = useNavigate();

    return (
        <>
            <button className="header-secondary-button" onClick={() => navigate("/feed")}>
                Feed
            </button>

            <NotificationsBell />
        </>
    );
}

export default FeedNavButton;
