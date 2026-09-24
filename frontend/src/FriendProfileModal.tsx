import { useEffect, useState } from "react";
import { API, authFetch } from "./api";

type FriendProfile = {
    user_id: string;
    display_name: string;
    avatar_url: string | null;
    current_handicap_index: number | null;
    home_course_name: string | null;
};

function initials(name: string) {
    return name.trim().charAt(0).toUpperCase() || "?";
}

export function Avatar({
    name,
    avatarUrl,
    small,
    onClick,
}: {
    name: string;
    avatarUrl?: string | null;
    small?: boolean;
    onClick?: () => void;
}) {
    const className = [
        "feed-avatar",
        small ? "feed-avatar-small" : "",
        onClick ? "feed-avatar-clickable" : "",
    ]
        .filter(Boolean)
        .join(" ");

    return (
        <div
            className={className}
            style={
                avatarUrl
                    ? { backgroundImage: `url(${avatarUrl})`, backgroundSize: "cover", backgroundPosition: "center" }
                    : undefined
            }
            onClick={onClick}
            role={onClick ? "button" : undefined}
        >
            {!avatarUrl && initials(name)}
        </div>
    );
}

export function FriendProfileModal({ userId, onClose }: { userId: string; onClose: () => void }) {
    const [profile, setProfile] = useState<FriendProfile | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);

        authFetch(`${API}/friends/${userId}/profile`)
            .then((response) => (response.ok ? response.json() : null))
            .then((body) => {
                if (!cancelled) setProfile(body);
            })
            .catch(() => {})
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [userId]);

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-card friend-profile-card" onClick={(event) => event.stopPropagation()}>
                <button className="modal-close" onClick={onClose} aria-label="Close">
                    ✕
                </button>

                {loading ? (
                    <p className="course-count">Loading...</p>
                ) : !profile ? (
                    <p className="course-count">Couldn't load this profile.</p>
                ) : (
                    <>
                        <Avatar name={profile.display_name} avatarUrl={profile.avatar_url} />
                        <h3>{profile.display_name}</h3>
                        <p className="course-count">
                            {profile.current_handicap_index != null
                                ? `Handicap ${profile.current_handicap_index}`
                                : "No handicap on record"}
                        </p>
                        {profile.home_course_name && <p className="course-count">{profile.home_course_name}</p>}
                    </>
                )}
            </div>
        </div>
    );
}
