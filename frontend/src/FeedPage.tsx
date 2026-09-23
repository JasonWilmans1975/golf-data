import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { API, authFetch, uploadPostPhoto } from "./api";
import TopbarActions from "./TopbarActions";

type ReactionSummary = {
    counts: Record<string, number>;
    total: number;
    my_reaction: string | null;
};

type SharedItem = {
    item_type: "round" | "post";
    item_id: number;
    player_name: string;
    posted_at: string;
    body: string | null;
    photo_url: string | null;
    course_name: string | null;
    course_photo_url: string | null;
    course_phone: string | null;
    adjusted_gross: number | null;
    stableford_points: number | null;
};

type FeedItem = {
    item_type: "round" | "post";
    item_id: number;
    user_id: string;
    player_name: string;
    posted_at: string;
    body: string | null;
    photo_url: string | null;
    shared_item: SharedItem | null;
    adjusted_gross: number | null;
    stableford_points: number | null;
    course_name: string | null;
    course_photo_url: string | null;
    course_phone: string | null;
    country_name: string | null;
    country_flag_url: string | null;
    comment_count: number;
    reactions: ReactionSummary;
};

type Comment = {
    id: number;
    user_id: string;
    author_name: string;
    body: string;
    created_at: string;
    reactions: ReactionSummary;
};

type Friend = {
    user_id: string;
    display_name: string;
};

const EMOJIS = [
    "😀", "😂", "😍", "👍", "👏", "🎉",
    "⛳", "🏌️", "🏆", "🔥", "💪", "😅",
    "😢", "😮", "❤️", "🙌", "🤝", "😎",
];

const REACTION_EMOJI: Record<string, string> = {
    like: "👍",
    love: "❤️",
    haha: "😆",
    wow: "😮",
    sad: "😢",
    angry: "😠",
};

const APP_URL = "https://slogs.co.za/handicap";
const NEW_POST_KEY = "new-post";

function itemKey(itemType: string, itemId: number) {
    return `${itemType}:${itemId}`;
}

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

function renderBody(body: string) {
    return body.split(/(@[a-zA-Z0-9._-]+)/g).map((part, index) =>
        part.startsWith("@") ? (
            <span className="mention" key={index}>
                {part}
            </span>
        ) : (
            <span key={index}>{part}</span>
        )
    );
}

function shareText(item: FeedItem | SharedItem) {
    if (item.item_type === "round") {
        return `${item.player_name} played ${item.course_name || "a round of golf"}${
            item.adjusted_gross ? ` and shot ${item.adjusted_gross}` : ""
        } — via Golf Journey`;
    }

    return `${item.player_name} on Golf Journey: ${item.body || ""}`;
}

function shareToWhatsApp(item: FeedItem) {
    const text = `${shareText(item)} ${APP_URL}`;
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, "_blank");
}

function shareToFacebook(item: FeedItem) {
    const url =
        `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(APP_URL)}` +
        `&quote=${encodeURIComponent(shareText(item))}`;
    window.open(url, "_blank");
}

function reactionSummary(reactions: ReactionSummary) {
    if (reactions.total === 0) return null;

    return (
        <span className="reaction-summary-inline">
            {Object.entries(reactions.counts)
                .sort((a, b) => b[1] - a[1])
                .map(([reaction]) => REACTION_EMOJI[reaction])
                .join("")}{" "}
            {reactions.total}
        </span>
    );
}

function applyReaction(
    current: ReactionSummary,
    previousMine: string | null,
    newMine: string | null
): ReactionSummary {
    const counts = { ...current.counts };

    if (previousMine) {
        counts[previousMine] = Math.max(0, (counts[previousMine] || 0) - 1);
        if (counts[previousMine] === 0) delete counts[previousMine];
    }

    if (newMine) {
        counts[newMine] = (counts[newMine] || 0) + 1;
    }

    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);

    return { counts, total, my_reaction: newMine };
}

function FeedPage() {
    const navigate = useNavigate();

    const [feed, setFeed] = useState<FeedItem[]>([]);
    const [friends, setFriends] = useState<Friend[]>([]);
    const [myName, setMyName] = useState("");
    const [loading, setLoading] = useState(true);

    const [comments, setComments] = useState<Record<string, Comment[]>>({});
    const [commentsLoading, setCommentsLoading] = useState<Set<string>>(new Set());
    const [drafts, setDrafts] = useState<Record<string, string>>({});
    const [posting, setPosting] = useState<Set<string>>(new Set());

    const [mentionQuery, setMentionQuery] = useState<Record<string, string>>({});
    const [emojiPickerOpen, setEmojiPickerOpen] = useState<string | null>(null);
    const [reactionPickerOpen, setReactionPickerOpen] = useState<string | null>(null);
    const [shareMenuOpen, setShareMenuOpen] = useState<string | null>(null);
    const [shareTarget, setShareTarget] = useState<FeedItem | null>(null);

    const [postPhotoUrl, setPostPhotoUrl] = useState<string | null>(null);
    const [postPhotoUploading, setPostPhotoUploading] = useState(false);

    const commentInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

    function focusCommentInput(key: string) {
        commentInputRefs.current[key]?.focus();
    }

    async function loadComments(key: string, itemType: string, itemId: number) {
        setCommentsLoading((prev) => new Set(prev).add(key));

        try {
            const response = await authFetch(`${API}/feed/${itemType}/${itemId}/comments`);
            if (response.ok) {
                const body: Comment[] = await response.json();
                setComments((prev) => ({ ...prev, [key]: body }));
            }
        } catch (error) {
            console.error(error);
        } finally {
            setCommentsLoading((prev) => {
                const next = new Set(prev);
                next.delete(key);
                return next;
            });
        }
    }

    async function loadFeed() {
        try {
            const response = await authFetch(`${API}/feed?limit=20`);
            if (response.ok) {
                const items: FeedItem[] = await response.json();
                setFeed(items);
                items.forEach((item) =>
                    loadComments(itemKey(item.item_type, item.item_id), item.item_type, item.item_id)
                );
            }
        } catch (error) {
            console.error(error);
        }
    }

    async function loadFriends() {
        try {
            const response = await authFetch(`${API}/friends`);
            if (response.ok) setFriends(await response.json());
        } catch (error) {
            console.error(error);
        }
    }

    useEffect(() => {
        Promise.all([loadFeed(), loadFriends()]).finally(() => setLoading(false));
        // Opening the Feed page counts as having seen what's new -- clears
        // the unread badge on the nav link.
        authFetch(`${API}/notifications/ack`, { method: "POST" }).catch(() => {});

        authFetch(`${API}/profile`)
            .then((response) => (response.ok ? response.json() : null))
            .then((body) => {
                if (body?.display_name) setMyName(body.display_name);
            })
            .catch(() => {});
    }, []);

    function handleDraftChange(key: string, value: string) {
        setDrafts((prev) => ({ ...prev, [key]: value }));

        const match = value.match(/@([a-zA-Z0-9._-]*)$/);
        setMentionQuery((prev) => {
            const next = { ...prev };
            if (match) {
                next[key] = match[1];
            } else {
                delete next[key];
            }
            return next;
        });
    }

    function mentionSuggestions(key: string) {
        const query = mentionQuery[key];
        if (query === undefined) return [];

        return friends
            .filter((friend) => friend.display_name.toLowerCase().startsWith(query.toLowerCase()))
            .slice(0, 5);
    }

    function selectMention(key: string, name: string) {
        setDrafts((prev) => ({
            ...prev,
            [key]: (prev[key] || "").replace(/@([a-zA-Z0-9._-]*)$/, `@${name} `),
        }));

        setMentionQuery((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
        });
    }

    function insertEmoji(key: string, emoji: string) {
        setDrafts((prev) => ({ ...prev, [key]: (prev[key] || "") + emoji }));
    }

    function toggleEmojiPicker(key: string) {
        setEmojiPickerOpen((prev) => (prev === key ? null : key));
    }

    async function handlePostComment(event: FormEvent, itemType: string, itemId: number) {
        event.preventDefault();
        const key = itemKey(itemType, itemId);
        const body = (drafts[key] || "").trim();
        if (!body) return;

        setPosting((prev) => new Set(prev).add(key));

        try {
            const response = await authFetch(`${API}/feed/${itemType}/${itemId}/comments`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ body }),
            });

            if (response.ok) {
                setDrafts((prev) => ({ ...prev, [key]: "" }));
                setMentionQuery((prev) => {
                    const next = { ...prev };
                    delete next[key];
                    return next;
                });
                setEmojiPickerOpen(null);
                await loadComments(key, itemType, itemId);
                setFeed((prev) =>
                    prev.map((item) =>
                        item.item_type === itemType && item.item_id === itemId
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
                next.delete(key);
                return next;
            });
        }
    }

    async function react(itemType: string, itemId: number, reaction: string) {
        setReactionPickerOpen(null);

        try {
            const response = await authFetch(`${API}/feed/${itemType}/${itemId}/react`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ reaction }),
            });

            if (!response.ok) return;
            const body: { reaction: string | null } = await response.json();

            if (itemType === "comment") {
                setComments((prev) => {
                    const next: Record<string, Comment[]> = {};
                    for (const key of Object.keys(prev)) {
                        next[key] = prev[key].map((comment) =>
                            comment.id === itemId
                                ? {
                                      ...comment,
                                      reactions: applyReaction(
                                          comment.reactions,
                                          comment.reactions.my_reaction,
                                          body.reaction
                                      ),
                                  }
                                : comment
                        );
                    }
                    return next;
                });
            } else {
                setFeed((prev) =>
                    prev.map((item) =>
                        item.item_type === itemType && item.item_id === itemId
                            ? {
                                  ...item,
                                  reactions: applyReaction(
                                      item.reactions,
                                      item.reactions.my_reaction,
                                      body.reaction
                                  ),
                              }
                            : item
                    )
                );
            }
        } catch (error) {
            console.error(error);
        }
    }

    async function handlePostPhotoSelect(file: File | undefined) {
        if (!file) return;

        setPostPhotoUploading(true);

        try {
            const { photo_url } = await uploadPostPhoto(file);
            setPostPhotoUrl(photo_url);
        } catch (error) {
            console.error(error);
        } finally {
            setPostPhotoUploading(false);
        }
    }

    async function handleSubmitPost(event: FormEvent) {
        event.preventDefault();
        const body = (drafts[NEW_POST_KEY] || "").trim();
        if (!body && !postPhotoUrl && !shareTarget) return;

        setPosting((prev) => new Set(prev).add(NEW_POST_KEY));

        try {
            const response = await authFetch(`${API}/feed/posts`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    body,
                    photo_url: postPhotoUrl,
                    shared_item_type: shareTarget?.item_type ?? null,
                    shared_item_id: shareTarget?.item_id ?? null,
                }),
            });

            if (response.ok) {
                setDrafts((prev) => ({ ...prev, [NEW_POST_KEY]: "" }));
                setPostPhotoUrl(null);
                setShareTarget(null);
                setEmojiPickerOpen(null);
                await loadFeed();
            }
        } catch (error) {
            console.error(error);
        } finally {
            setPosting((prev) => {
                const next = new Set(prev);
                next.delete(NEW_POST_KEY);
                return next;
            });
        }
    }

    function startRepost(item: FeedItem) {
        setShareTarget(item);
        setShareMenuOpen(null);
        window.scrollTo({ top: 0, behavior: "smooth" });
    }

    function ReactionBar({ itemType, itemId, reactions }: {
        itemType: string;
        itemId: number;
        reactions: ReactionSummary;
    }) {
        const key = itemKey(itemType, itemId);
        const activeEmoji = reactions.my_reaction ? REACTION_EMOJI[reactions.my_reaction] : null;

        return (
            <div
                className="reaction-bar"
                onMouseEnter={() => setReactionPickerOpen(key)}
                onMouseLeave={() => setReactionPickerOpen(null)}
            >
                <button
                    type="button"
                    className={`feed-action-button${reactions.my_reaction ? " active" : ""}`}
                    onClick={() => react(itemType, itemId, "like")}
                >
                    {activeEmoji || "👍"} {reactions.my_reaction ? "Liked" : "Like"}
                </button>

                {reactionPickerOpen === key && (
                    <div className="reaction-picker">
                        {Object.entries(REACTION_EMOJI).map(([reaction, emoji]) => (
                            <button
                                type="button"
                                key={reaction}
                                className={reactions.my_reaction === reaction ? "active" : ""}
                                onClick={() => react(itemType, itemId, reaction)}
                            >
                                {emoji}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    function CommentComposer({ itemType, itemId }: { itemType: string; itemId: number }) {
        const key = itemKey(itemType, itemId);
        const suggestions = mentionSuggestions(key);

        return (
            <form
                className="feed-comment-form"
                onSubmit={(event) => handlePostComment(event, itemType, itemId)}
            >
                <div className="feed-comment-input-wrap">
                    <input
                        ref={(el) => {
                            commentInputRefs.current[key] = el;
                        }}
                        className="settings-input"
                        placeholder="Write a comment... @ to mention a friend"
                        value={drafts[key] || ""}
                        onChange={(event) => handleDraftChange(key, event.target.value)}
                    />

                    {suggestions.length > 0 && (
                        <div className="mention-dropdown">
                            {suggestions.map((friend) => (
                                <button
                                    type="button"
                                    key={friend.user_id}
                                    onClick={() => selectMention(key, friend.display_name)}
                                >
                                    @{friend.display_name}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <div className="feed-comment-emoji-wrap">
                    <button
                        type="button"
                        className="emoji-toggle"
                        onClick={() => toggleEmojiPicker(key)}
                    >
                        🙂
                    </button>

                    {emojiPickerOpen === key && (
                        <div className="emoji-picker">
                            {EMOJIS.map((emoji) => (
                                <button type="button" key={emoji} onClick={() => insertEmoji(key, emoji)}>
                                    {emoji}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <button className="sync-button" type="submit" disabled={posting.has(key)}>
                    {posting.has(key) ? "Posting..." : "Post"}
                </button>
            </form>
        );
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

                <div className="feed-container">
                <div className="feed-card">
                    {shareTarget && (
                        <div className="feed-share-preview">
                            <span>Sharing {shareTarget.player_name}'s {shareTarget.item_type}</span>
                            <button type="button" onClick={() => setShareTarget(null)}>
                                ✕
                            </button>
                        </div>
                    )}

                    {postPhotoUrl && (
                        <div className="post-photo-preview">
                            <img src={postPhotoUrl} alt="" />
                            <button type="button" onClick={() => setPostPhotoUrl(null)}>
                                ✕
                            </button>
                        </div>
                    )}

                    <form className="feed-comment-form" onSubmit={handleSubmitPost}>
                        <div className="feed-avatar feed-avatar-small">{initials(myName || "?")}</div>

                        <div className="feed-comment-input-wrap">
                            <input
                                className="settings-input feed-composer-input"
                                placeholder={`What's on your mind${myName ? `, ${myName}` : ""}?`}
                                value={drafts[NEW_POST_KEY] || ""}
                                onChange={(event) => handleDraftChange(NEW_POST_KEY, event.target.value)}
                            />

                            {mentionSuggestions(NEW_POST_KEY).length > 0 && (
                                <div className="mention-dropdown">
                                    {mentionSuggestions(NEW_POST_KEY).map((friend) => (
                                        <button
                                            type="button"
                                            key={friend.user_id}
                                            onClick={() => selectMention(NEW_POST_KEY, friend.display_name)}
                                        >
                                            @{friend.display_name}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        <label className="emoji-toggle photo-upload-button">
                            {postPhotoUploading ? "..." : "📷"}
                            <input
                                type="file"
                                accept="image/*"
                                hidden
                                onChange={(event) =>
                                    handlePostPhotoSelect(event.target.files?.[0])
                                }
                            />
                        </label>

                        <div className="feed-comment-emoji-wrap">
                            <button
                                type="button"
                                className="emoji-toggle"
                                onClick={() => toggleEmojiPicker(NEW_POST_KEY)}
                            >
                                🙂
                            </button>

                            {emojiPickerOpen === NEW_POST_KEY && (
                                <div className="emoji-picker">
                                    {EMOJIS.map((emoji) => (
                                        <button
                                            type="button"
                                            key={emoji}
                                            onClick={() => insertEmoji(NEW_POST_KEY, emoji)}
                                        >
                                            {emoji}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        <button
                            className="sync-button"
                            type="submit"
                            disabled={posting.has(NEW_POST_KEY) || postPhotoUploading}
                        >
                            {posting.has(NEW_POST_KEY) ? "Posting..." : "Post"}
                        </button>
                    </form>
                </div>

                {loading ? (
                    <div className="loading-card">Loading feed...</div>
                ) : feed.length === 0 ? (
                    <p className="course-count" style={{ padding: 16 }}>
                        Nothing yet — add friends or log a round to see activity here.
                    </p>
                ) : (
                    feed.map((item) => {
                        const key = itemKey(item.item_type, item.item_id);
                        const itemComments = comments[key] || [];

                        return (
                            <article className="feed-card" key={key}>
                                <div className="feed-card-header">
                                    <div className="feed-avatar">{initials(item.player_name)}</div>

                                    <div>
                                        <strong>{item.player_name}</strong>
                                        <span>{formatDate(item.posted_at)}</span>
                                    </div>
                                </div>

                                {item.body && <p className="feed-post-body">{renderBody(item.body)}</p>}

                                {item.photo_url && (
                                    <img src={item.photo_url} alt="" className="feed-card-photo" />
                                )}

                                {item.shared_item && (
                                    <div className="feed-shared-item">
                                        <div className="feed-card-header">
                                            <div className="feed-avatar">
                                                {initials(item.shared_item.player_name)}
                                            </div>
                                            <div>
                                                <strong>{item.shared_item.player_name}</strong>
                                                <span>{formatDate(item.shared_item.posted_at)}</span>
                                            </div>
                                        </div>

                                        {item.shared_item.body && (
                                            <p className="feed-post-body">{renderBody(item.shared_item.body)}</p>
                                        )}

                                        {item.shared_item.photo_url && (
                                            <img
                                                src={item.shared_item.photo_url}
                                                alt=""
                                                className="feed-card-photo"
                                            />
                                        )}

                                        {item.shared_item.course_photo_url && (
                                            <img
                                                src={item.shared_item.course_photo_url}
                                                alt={item.shared_item.course_name || "Golf course"}
                                                className="feed-card-photo"
                                            />
                                        )}

                                        {item.shared_item.course_name && (
                                            <div className="feed-card-body">
                                                <div className="feed-card-course">
                                                    {item.shared_item.course_name}
                                                </div>

                                                <div className="feed-card-stats">
                                                    <div>
                                                        <strong>{item.shared_item.adjusted_gross ?? "—"}</strong>
                                                        <span>Gross</span>
                                                    </div>
                                                    <div>
                                                        <strong>
                                                            {item.shared_item.stableford_points ?? "—"}
                                                        </strong>
                                                        <span>Stableford</span>
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {item.shared_item.item_type === "round" &&
                                            item.shared_item.course_phone && (
                                                <a
                                                    className="book-round-button"
                                                    href={`tel:${item.shared_item.course_phone}`}
                                                >
                                                    📞 Book a round
                                                </a>
                                            )}
                                    </div>
                                )}

                                {!item.shared_item && item.course_photo_url && (
                                    <img
                                        src={item.course_photo_url}
                                        alt={item.course_name || "Golf course"}
                                        className="feed-card-photo"
                                    />
                                )}

                                {!item.shared_item && item.item_type === "round" && (
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
                                )}

                                {!item.shared_item && item.item_type === "round" && item.course_phone && (
                                    <a className="book-round-button" href={`tel:${item.course_phone}`}>
                                        📞 Book a round
                                    </a>
                                )}

                                <div className="feed-meta-row">
                                    {reactionSummary(item.reactions) || <span />}

                                    <span className="feed-comment-count">
                                        {item.comment_count === 0
                                            ? "No comments yet"
                                            : `${item.comment_count} ${
                                                  item.comment_count === 1 ? "comment" : "comments"
                                              }`}
                                    </span>
                                </div>

                                <div className="feed-actions-row">
                                    <ReactionBar
                                        itemType={item.item_type}
                                        itemId={item.item_id}
                                        reactions={item.reactions}
                                    />

                                    <button
                                        type="button"
                                        className="feed-action-button"
                                        onClick={() => focusCommentInput(key)}
                                    >
                                        💬 Comment
                                    </button>

                                    <div className="feed-share-wrap">
                                        <button
                                            type="button"
                                            className="feed-action-button"
                                            onClick={() =>
                                                setShareMenuOpen((prev) => (prev === key ? null : key))
                                            }
                                        >
                                            ↗ Share
                                        </button>

                                        {shareMenuOpen === key && (
                                            <div className="share-menu">
                                                <button type="button" onClick={() => startRepost(item)}>
                                                    Repost to Feed
                                                </button>
                                                <button type="button" onClick={() => shareToWhatsApp(item)}>
                                                    Share to WhatsApp
                                                </button>
                                                <button type="button" onClick={() => shareToFacebook(item)}>
                                                    Share to Facebook
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="feed-card-footer">
                                    <div className="feed-comments">
                                        {commentsLoading.has(key) && itemComments.length === 0 ? (
                                            <span className="course-count">Loading comments...</span>
                                        ) : (
                                            itemComments.map((comment) => (
                                                <div className="feed-comment-row" key={comment.id}>
                                                    <div className="feed-avatar feed-avatar-small">
                                                        {initials(comment.author_name)}
                                                    </div>

                                                    <div className="feed-comment-bubble-wrap">
                                                        <div className="feed-comment-bubble">
                                                            <strong>{comment.author_name}</strong>
                                                            <p>{renderBody(comment.body)}</p>
                                                        </div>

                                                        <div className="feed-comment-meta">
                                                            <span>{formatDateTime(comment.created_at)}</span>
                                                            <ReactionBar
                                                                itemType="comment"
                                                                itemId={comment.id}
                                                                reactions={comment.reactions}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>

                                    <CommentComposer itemType={item.item_type} itemId={item.item_id} />
                                </div>
                            </article>
                        );
                    })
                )}
                </div>
            </main>
        </>
    );
}

export default FeedPage;
