import { useNavigate } from "react-router-dom";

function FeedNavButton() {
    const navigate = useNavigate();

    return (
        <button className="header-secondary-button" onClick={() => navigate("/feed")}>
            Feed
        </button>
    );
}

export default FeedNavButton;
