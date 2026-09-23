import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { API, authFetch } from "./api";
import TopbarActions from "./TopbarActions";

type FeedItem = {
    score_id: number;
    user_id: string;
    player_name: string;
    play_date: string;
    adjusted_gross: number | null;
    stableford_points: number | null;
    course_name: string | null;
    course_photo_url: string | null;
    country_name: string | null;
    country_flag_url: string | null;
    comment_count: number;
};

type Comment = {
    id: number;
    user_id: string;
    author_name: string;
    body: string;
    created_at: string;
};

function formatDate(value: string) {
    return new Intl.DateTimeFormat("en-ZA", {
        day: "numeric",
        month: "short",
        year: "numeric",
    }).format(new Date(value));
}

function formatDateTime(value: string) {
    return new Intl.DateTimeFormat("en-ZA", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
    }).format(new Date(value));
}

function initials(name: string) {
    return name.trim().charAt(0).toUpperCase() || "?";
}

function FeedPage() {
    const navigate = useNavigate();

    const [feed, setFeed] = useState<FeedItem[]>([]);
    const [loading, setLoading] = useState(true);

    const [expanded, setExpanded] = useState<Set<number>>(new Set());
    const [comments, setComments] = useState<Record<number, Comment[]>>({});
    const [commentsLoading, setCommentsLoading] = useState<Set<number>>(new Set());
    const [drafts, setDrafts] = useState<Record<number, string>>({});
    const [posting, setPosting] = useState<Set<number>>(new Set());

    async function loadFeed() {
        try {
            const response = await authFetch(`${API}/feed?limit=20`);
            if (response.ok) setFeed(await response.json());
        } catch (error) {
            console.error(error);
        }
    }

    useEffect(() => {
        loadFeed().finally(() => setLoading(false));
    }, []);

    async function loadComments(scoreId: number) {
        setCommentsLoading((prev) => new Set(prev).add(scoreId));

        try {
            const response = await authFetch(`${API}/rounds/${scoreId}/comments`);
            if (response.ok) {
                const body: Comment[] = await response.json();
                setComments((prev) => ({ ...prev, [scoreId]: body }));
            }
        } catch (error) {
            console.error(error);
        } finally {
            setCommentsLoading((prev) => {
                const next = new Set(prev);
                next.delete(scoreId);
                return next;
            });
        }
    }

    function toggleComments(scoreId: number) {
        setExpanded((prev) => {
            const next = new Set(prev);

            if (next.has(scoreId)) {
                next.delete(scoreId);
            } else {
                next.add(scoreId);
                if (!comments[scoreId]) loadComments(scoreId);
            }

            return next;
        });
    }

    async function handlePostComment(event: FormEvent, scoreId: number) {
        event.preventDefault();
        const body = (drafts[scoreId] || "").trim();
        if (!body) return;

        setPosting((prev) => new Set(prev).add(scoreId));

        try {
            const response = await authFetch(`${API}/rounds/${scoreId}/comments`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ body }),
            });

            if (response.ok) {
                setDrafts((prev) => ({ ...prev, [scoreId]: "" }));
                await loadComments(scoreId);
                setFeed((prev) =>
                    prev.map((item) =>
                        item.score_id === scoreId
                            ? { ...item, comment_count: item.comment_count + 1 }
                            : item
                    )
                );
            }
        } catch (error) {
            console.error(error);
        } finally {
            setPosting((prev) => {
                const next = new Set(prev);
                next.delete(scoreId);
                return next;
            });
        }
    }

    return (
        <>
            <header className="topbar">
                <div>
                    <div className="brand-kicker">MY GOLF JOURNEY</div>
                    <h1>Feed</h1>
                </div>

                <TopbarActions>
                    <button className="header-secondary-button" onClick={() => navigate("/")}>
                        Home
                    </button>

                    <button className="header-secondary-button" onClick={() => navigate("/map")}>
                        World Map
                    </button>

                    <button className="header-secondary-button" onClick={() => navigate("/handicap")}>
                        Handicap
                    </button>

                    <button className="header-secondary-button" onClick={() => navigate("/friends")}>
                        Friends
                    </button>

                    <button className="header-secondary-button" onClick={() => navigate("/settings")}>
                        Settings
                    </button>
                </TopbarActions>
            </header>

            <main className="content">
                <section className="course-hero">
                    <p className="eyebrow">GOLFBOOK</p>
                    <h2>What everyone's been playing.</h2>
                    <p>Your rounds and your friends', newest first.</p>
                </section>

                {loading ? (
                    <div className="loading-card">Loading feed...</div>
                ) : feed.length === 0 ? (
                    <p className="course-count" style={{ padding: 16 }}>
                        Nothing yet — add friends or log a round to see activity here.
                    </p>
                ) : (
                    feed.map((item) => {
                        const isExpanded = expanded.has(item.score_id);
                        const itemComments = comments[item.score_id] || [];

                        return (
                            <article className="feed-card" key={item.score_id}>
                                <div className="feed-card-header">
                                    <div className="feed-avatar">{initials(item.player_name)}</div>

                                    <div>
                                        <strong>{item.player_name}</strong>
                                        <span>{formatDate(item.play_date)}</span>
                                    </div>
                                </div>

                                {item.course_photo_url && (
                                    <img
                                        src={item.course_photo_url}
                                        alt={item.course_name || "Golf course"}
                                        className="feed-card-photo"
                                    />
                                )}

                                <div className="feed-card-body">
                                    <div className="feed-card-course">
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
                                        {item.course_name || "A round of golf"}
                                    </div>

                                    <div className="feed-card-stats">
                                        <div>
                                            <strong>{item.adjusted_gross ?? "—"}</strong>
                                            <span>Gross</span>
                                        </div>

                                        <div>
                                            <strong>{item.stableford_points ?? "—"}</strong>
                                            <span>Stableford</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="feed-card-footer">
                                    <button
                                        className="feed-comment-toggle"
                                        onClick={() => toggleComments(item.score_id)}
                                    >
                                        {item.comment_count === 0
                                            ? "Comment"
                                            : `${item.comment_count} ${
                                                  item.comment_count === 1 ? "comment" : "comments"
                                              }`}
                                    </button>

                                    {isExpanded && (
                                        <>
                                            <div className="feed-comments">
                                                {commentsLoading.has(item.score_id) ? (
                                                    <span className="course-count">Loading comments...</span>
                                                ) : itemComments.length === 0 ? (
                                                    <span className="course-count">
                                                        No comments yet — be the first.
                                                    </span>
                                                ) : (
                                                    itemComments.map((comment) => (
                                                        <div className="feed-comment" key={comment.id}>
                                                            <strong>{comment.author_name}</strong>
                                                            <span>{formatDateTime(comment.created_at)}</span>
                                                            <p>{comment.body}</p>
                                                        </div>
                                                    ))
                                                )}
                                            </div>

                                            <form
                                                className="feed-comment-form"
                                                onSubmit={(event) => handlePostComment(event, item.score_id)}
                                            >
                                                <input
                                                    className="settings-input"
                                                    placeholder="Write a comment..."
                                                    value={drafts[item.score_id] || ""}
                                                    onChange={(event) =>
                                                        setDrafts((prev) => ({
                                                            ...prev,
                                                            [item.score_id]: event.target.value,
                                                        }))
                                                    }
                                                />

                                                <button
                                                    className="sync-button"
                                                    type="submit"
                                                    disabled={posting.has(item.score_id)}
                                                >
                                                    {posting.has(item.score_id) ? "Posting..." : "Post"}
                                                </button>
                                            </form>
                                        </>
                                    )}
                                </div>
                            </article>
                        );
                    })
                )}
            </main>
        </>
    );
}

export default FeedPage;
