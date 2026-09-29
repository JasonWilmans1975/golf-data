import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { API, authFetch, uploadPostPhoto } from "./api";
import AppNav from "./AppNav";
import BrandLogo from "./BrandLogo";
import BottomNav from "./BottomNav";
import { supabase } from "./supabaseClient";
import { useAuth } from "./AuthContext";
import { Avatar, FriendProfileModal } from "./FriendProfileModal";

type ReactionSummary = {
    counts: Record<string, number>;
    total: number;
    my_reaction: string | null;
    recent_reactor_names: string[];
};

type ReactionDetail = {
    user_id: string;
    display_name: string;
    avatar_url: string | null;
    reaction: string;
};

type SharedItem = {
    item_type: "round" | "post";
    item_id: number;
    user_id: string;
    player_name: string;
    player_avatar_url: string | null;
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
    player_avatar_url: string | null;
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
    is_system_generated: boolean;
    edited_at: string | null;
};

type Comment = {
    id: number;
    user_id: string;
    author_name: string;
    author_avatar_url: string | null;
    body: string;
    created_at: string;
    parent_comment_id: number | null;
    reactions: ReactionSummary;
    replies: Comment[];
};

type Friend = {
    user_id: string;
    display_name: string;
    avatar_url: string | null;
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

// Derived from wherever the app is actually running rather than hardcoded --
// this one source file is shared by both the golfcircle.me and
// slogs.co.za/handicap builds.
const APP_URL = `${window.location.origin}${import.meta.env.BASE_URL}`;
const NEW_POST_KEY = "new-post";

function itemKey(itemType: string, itemId: number) {
    return `${itemType}:${itemId}`;
}

// A reply composer needs its own draft/posting-state key, distinct from the
// top-level comment box for the same item, so typing a reply doesn't clobber
// (or get clobbered by) whatever's in the main comment input.
function replyComposerKey(itemType: string, itemId: number, parentCommentId: number) {
    return `${itemKey(itemType, itemId)}:reply:${parentCommentId}`;
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

function formatRelative(value: string) {
    const diffMs = Date.now() - new Date(value).getTime();
    const minutes = Math.floor(diffMs / 60000);

    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;

    const days = Math.floor(hours / 24);
    // Beyond about a week, "43d" stops being useful (worse for a round
    // played months or years ago) -- fall back to a real date, same as
    // Facebook does once a post ages out of the relative window.
    if (days < 7) return `${days}d`;

    return formatDate(value);
}

function Icon({ children }: { children: ReactNode }) {
    return (
        <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            {children}
        </svg>
    );
}

function ImageIcon() {
    return (
        <Icon>
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
        </Icon>
    );
}

function SmileIcon() {
    return (
        <Icon>
            <circle cx="12" cy="12" r="10" />
            <path d="M8 14s1.5 2 4 2 4-2 4-2" />
            <line x1="9" y1="9" x2="9.01" y2="9" />
            <line x1="15" y1="9" x2="15.01" y2="9" />
        </Icon>
    );
}

function ThumbsUpIcon({ filled }: { filled?: boolean }) {
    return (
        <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill={filled ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3z" />
            <path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
        </svg>
    );
}

function MessageIcon() {
    return (
        <Icon>
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </Icon>
    );
}

function ShareIcon() {
    return (
        <Icon>
            <polyline points="15 17 20 12 15 7" />
            <path d="M4 18v-2a4 4 0 0 1 4-4h12" />
        </Icon>
    );
}

function PeopleIcon() {
    return (
        <Icon>
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </Icon>
    );
}

function MoreIcon() {
    return (
        <Icon>
            <circle cx="12" cy="5" r="1" fill="currentColor" stroke="none" />
            <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
            <circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" />
        </Icon>
    );
}

const TOURNAMENT_LINK_RE = /^\[\[tournament:(\d+):(.+)\]\]$/;

function renderBody(
    body: string,
    friends: Friend[],
    onMentionClick: (userId: string) => void,
    onTournamentClick: (tournamentId: number) => void
) {
    return body.split(/(@[a-zA-Z0-9._-]+|\[\[tournament:\d+:[^\]]+\]\])/g).map((part, index) => {
        const tournamentMatch = part.match(TOURNAMENT_LINK_RE);

        if (tournamentMatch) {
            const [, tournamentId, name] = tournamentMatch;
            return (
                <span
                    className="mention mention-clickable"
                    key={index}
                    onClick={() => onTournamentClick(Number(tournamentId))}
                >
                    {name}
                </span>
            );
        }

        if (!part.startsWith("@")) {
            return <span key={index}>{part}</span>;
        }

        const friend = friends.find((f) => f.display_name === part.slice(1));

        if (!friend) {
            return (
                <span className="mention" key={index}>
                    {part}
                </span>
            );
        }

        return (
            <span
                className="mention mention-clickable"
                key={index}
                onClick={() => onMentionClick(friend.user_id)}
            >
                {part}
            </span>
        );
    });
}

function shareText(item: FeedItem | SharedItem) {
    if (item.item_type === "round") {
        return `${item.player_name} played ${item.course_name || "a round of golf"}${
            item.adjusted_gross ? ` and shot ${item.adjusted_gross}` : ""
        } — via GolfCircle`;
    }

    return `${item.player_name} on GolfCircle: ${item.body || ""}`;
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

    // Best-effort optimistic update -- matches the backend's "You" convention
    // for the viewer's own reaction until the next full feed reload.
    let recentReactorNames = current.recent_reactor_names.filter((name) => name !== "You");
    if (newMine) recentReactorNames = ["You", ...recentReactorNames].slice(0, 5);

    return { counts, total, my_reaction: newMine, recent_reactor_names: recentReactorNames };
}

// "Liked by You and 4 others" / "Liked by Dave, Brent and 2 others" / "Liked by Dave"
function formatLikedBy(names: string[], total: number): string | null {
    if (total === 0 || names.length === 0) return null;

    const shown = names.slice(0, 2);
    const remaining = total - shown.length;

    if (remaining <= 0) {
        return `Liked by ${shown.join(" and ")}`;
    }

    return `Liked by ${shown.join(", ")} and ${remaining} other${remaining === 1 ? "" : "s"}`;
}

// Hoisted to module scope (not defined inside FeedPage) so React sees a
// stable component identity across renders -- defining these inline inside
// FeedPage recreated them on every keystroke, which made React remount the
// <input> each time and drop focus after a single character.
function ReactionBar({
    itemType,
    itemId,
    reactions,
    reactionPickerOpen,
    onToggleReactionPicker,
    onReact,
}: {
    itemType: string;
    itemId: number;
    reactions: ReactionSummary;
    reactionPickerOpen: string | null;
    onToggleReactionPicker: (key: string) => void;
    onReact: (itemType: string, itemId: number, reaction: string) => void;
}) {
    const key = itemKey(itemType, itemId);
    const activeEmoji = reactions.my_reaction ? REACTION_EMOJI[reactions.my_reaction] : null;

    return (
        <div className="reaction-bar">
            <button
                type="button"
                className={`feed-action-button${reactions.my_reaction ? " active" : ""}`}
                aria-label={reactions.my_reaction ? "Liked" : "Like"}
                onClick={() => onToggleReactionPicker(key)}
            >
                {activeEmoji || <ThumbsUpIcon />}
            </button>

            {reactionPickerOpen === key && (
                <div className="reaction-picker">
                    {Object.entries(REACTION_EMOJI).map(([reaction, emoji]) => (
                        <button
                            type="button"
                            key={reaction}
                            className={reactions.my_reaction === reaction ? "active" : ""}
                            onClick={() => onReact(itemType, itemId, reaction)}
                        >
                            {emoji}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

// Facebook-style split: the left side is a summary (icon + total) that opens
// who-reacted-with-what; the right side is always-visible reaction-type
// buttons, not hidden behind an extra click. Only used for top-level posts/
// rounds -- comments keep the older compact click-to-reveal picker (this
// row would be disproportionately heavy inside a small comment bubble).
function PostReactionBar({
    itemType,
    itemId,
    reactions,
    reactionPickerOpen,
    onTogglePicker,
    onReact,
    onShowDetails,
}: {
    itemType: string;
    itemId: number;
    reactions: ReactionSummary;
    reactionPickerOpen: string | null;
    onTogglePicker: (key: string) => void;
    onReact: (itemType: string, itemId: number, reaction: string) => void;
    onShowDetails: (itemType: string, itemId: number) => void;
}) {
    const key = itemKey(itemType, itemId);

    // Most-used reaction first, matching Facebook's little emoji cluster --
    // read-only, just previewing what's there, not another way to react.
    const presentTypes = Object.entries(reactions.counts)
        .sort((a, b) => b[1] - a[1])
        .map(([reaction]) => reaction);

    return (
        <div className="post-reaction-bar">
            <div className="reaction-bar post-reaction-left">
                <button
                    type="button"
                    className={`post-reaction-summary${reactions.my_reaction ? " reacted" : ""}`}
                    onClick={() => onTogglePicker(key)}
                    aria-label={reactions.my_reaction ? "Change reaction" : "React"}
                >
                    <ThumbsUpIcon filled={Boolean(reactions.my_reaction)} />
                    {reactions.total > 0 && <span>{reactions.total}</span>}
                </button>

                {reactionPickerOpen === key && (
                    <div className="reaction-picker">
                        {Object.entries(REACTION_EMOJI).map(([reaction, emoji]) => (
                            <button
                                type="button"
                                key={reaction}
                                className={reactions.my_reaction === reaction ? "active" : ""}
                                onClick={() => onReact(itemType, itemId, reaction)}
                            >
                                {emoji}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {presentTypes.length > 0 && (
                <button
                    type="button"
                    className="post-reaction-preview"
                    onClick={() => onShowDetails(itemType, itemId)}
                    aria-label="See who reacted"
                >
                    {presentTypes.slice(0, 3).map((reaction) => (
                        <span key={reaction}>{REACTION_EMOJI[reaction]}</span>
                    ))}
                </button>
            )}
        </div>
    );
}

function CommentComposer({
    itemType,
    itemId,
    parentCommentId,
    composerKey,
    placeholder,
    draft,
    suggestions,
    emojiPickerOpen,
    posting,
    onDraftChange,
    onSelectMention,
    onToggleEmojiPicker,
    onInsertEmoji,
    onSubmit,
    inputRef,
}: {
    itemType: string;
    itemId: number;
    parentCommentId?: number;
    composerKey: string;
    placeholder?: string;
    draft: string;
    suggestions: Friend[];
    emojiPickerOpen: string | null;
    posting: boolean;
    onDraftChange: (key: string, value: string) => void;
    onSelectMention: (key: string, name: string) => void;
    onToggleEmojiPicker: (key: string) => void;
    onInsertEmoji: (key: string, emoji: string) => void;
    onSubmit: (event: FormEvent, itemType: string, itemId: number, parentCommentId?: number) => void;
    inputRef: (el: HTMLInputElement | null) => void;
}) {
    const key = composerKey;

    return (
        <form
            className="feed-comment-form"
            onSubmit={(event) => onSubmit(event, itemType, itemId, parentCommentId)}
        >
            <div className="feed-comment-input-wrap">
                <input
                    ref={inputRef}
                    className="settings-input"
                    placeholder={placeholder ?? "Write a comment... @ to mention a friend"}
                    value={draft}
                    onChange={(event) => onDraftChange(key, event.target.value)}
                />

                {suggestions.length > 0 && (
                    <div className="mention-dropdown">
                        {suggestions.map((friend) => (
                            <button
                                type="button"
                                key={friend.user_id}
                                onClick={() => onSelectMention(key, friend.display_name)}
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
                    className="composer-icon-button"
                    aria-label="Add an emoji"
                    onClick={() => onToggleEmojiPicker(key)}
                >
                    <SmileIcon />
                </button>

                {emojiPickerOpen === key && (
                    <div className="emoji-picker">
                        {EMOJIS.map((emoji) => (
                            <button type="button" key={emoji} onClick={() => onInsertEmoji(key, emoji)}>
                                {emoji}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            <button className="sync-button" type="submit" disabled={posting}>
                {posting ? "Posting..." : "Post"}
            </button>
        </form>
    );
}

function FeedPage() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { session } = useAuth();
    const myUserId = session?.user?.id;

    const [feed, setFeed] = useState<FeedItem[]>([]);
    const [friends, setFriends] = useState<Friend[]>([]);
    const [myName, setMyName] = useState("");
    const [myAvatarUrl, setMyAvatarUrl] = useState<string | null>(null);
    const [openProfileUserId, setOpenProfileUserId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const sentinelRef = useRef<HTMLDivElement>(null);

    const [comments, setComments] = useState<Record<string, Comment[]>>({});
    const [drafts, setDrafts] = useState<Record<string, string>>({});
    const [posting, setPosting] = useState<Set<string>>(new Set());

    const [mentionQuery, setMentionQuery] = useState<Record<string, string>>({});
    const [emojiPickerOpen, setEmojiPickerOpen] = useState<string | null>(null);
    const [reactionPickerOpen, setReactionPickerOpen] = useState<string | null>(null);
    const [reactionDetailsKey, setReactionDetailsKey] = useState<string | null>(null);
    const [reactionDetails, setReactionDetails] = useState<ReactionDetail[]>([]);
    const [reactionDetailsLoading, setReactionDetailsLoading] = useState(false);
    const [shareMenuOpen, setShareMenuOpen] = useState<string | null>(null);
    const [shareTarget, setShareTarget] = useState<FeedItem | null>(null);
    const [activeReplyCommentId, setActiveReplyCommentId] = useState<number | null>(null);

    const [postPhotoUrl, setPostPhotoUrl] = useState<string | null>(null);
    const [postPhotoUploading, setPostPhotoUploading] = useState(false);
    const [composerOpen, setComposerOpen] = useState(false);
    const [editingPostId, setEditingPostId] = useState<number | null>(null);
    const [postMenuOpen, setPostMenuOpen] = useState<string | null>(null);
    const [composerView, setComposerView] = useState<"compose" | "tagPeople">("compose");
    const [tagSearch, setTagSearch] = useState("");

    const commentInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
    const feedCardRefs = useRef<Record<string, HTMLElement | null>>({});
    const [highlightKey, setHighlightKey] = useState<string | null>(null);
    const [syncingHandicap, setSyncingHandicap] = useState(false);

    function focusCommentInput(key: string) {
        commentInputRefs.current[key]?.focus();
    }

    function handleTournamentClick(feedPostId: number) {
        // The token carries the tournament's *original creation post's* id,
        // not the tournament id -- every mention of it (created, joined)
        // links back to that one Feed post instead of a separate page.
        navigate(`/feed?highlight=post:${feedPostId}`);
    }

    async function loadComments(key: string, itemType: string, itemId: number) {
        try {
            const response = await authFetch(`${API}/feed/${itemType}/${itemId}/comments`);
            if (response.ok) {
                const body: Comment[] = await response.json();
                setComments((prev) => ({ ...prev, [key]: body }));
            }
        } catch (error) {
            console.error(error);
        }
    }

    const PAGE_SIZE = 20;

    async function loadFeed(reset: boolean) {
        if (!reset) setLoadingMore(true);

        try {
            // /feed returns each item's comments inline (comments keyed by
            // "type:id") instead of the frontend needing a second request
            // right after this one lands -- that used to add a full extra
            // network round trip to every Feed page load.
            const offset = reset ? 0 : feed.length;
            const response = await authFetch(`${API}/feed?limit=${PAGE_SIZE}&offset=${offset}`);

            if (response.ok) {
                const body: { items: FeedItem[]; comments: Record<string, Comment[]> } = await response.json();
                setFeed((prev) => (reset ? body.items : [...prev, ...body.items]));
                setComments((prev) => ({ ...prev, ...body.comments }));
                setHasMore(body.items.length === PAGE_SIZE);
            }
        } catch (error) {
            console.error(error);
        } finally {
            if (!reset) setLoadingMore(false);
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
        // The Strava OAuth callback always lands on "/" -- bounce over to
        // My Rounds so its existing sync-on-connect flow still runs there.
        if (new URLSearchParams(window.location.search).get("connected") === "1") {
            navigate("/rounds?connected=1", { replace: true });
            return;
        }

        async function redirectFirstTimeUsers() {
            try {
                const [stravaRes, handicapRes, garminRes, teesheetRes] = await Promise.all([
                    authFetch(`${API}/strava/status`),
                    authFetch(`${API}/handicap/credentials/status`),
                    authFetch(`${API}/garmin/credentials/status`),
                    authFetch(`${API}/teesheet/credentials/status`),
                ]);

                const [strava, handicap, garmin, teesheet] = await Promise.all([
                    stravaRes.json().catch(() => ({})),
                    handicapRes.json().catch(() => ({})),
                    garminRes.json().catch(() => ({})),
                    teesheetRes.json().catch(() => ({})),
                ]);

                const hasAnyConnection =
                    strava.connected || handicap.connected || garmin.connected || teesheet.connected;

                if (!hasAnyConnection) {
                    navigate("/settings", { replace: true });
                }
            } catch (error) {
                console.error(error);
            }
        }

        async function syncHandicapThenRefresh() {
            // Same "show what's already there, sync in the background" pattern
            // as StatsPage -- the Feed shouldn't block on a handicaps.co.za
            // scrape, but a new round showing up there should still show up
            // here without the user needing to manually refresh.
            setSyncingHandicap(true);

            try {
                const response = await authFetch(`${API}/handicap/sync`, { method: "POST" });
                const body = await response.json().catch(() => null);

                if (response.ok && body?.skipped === false) {
                    await loadFeed(true);
                }
            } catch (error) {
                console.error(error);
            } finally {
                setSyncingHandicap(false);
            }
        }

        // /feed and /friends are the only things that actually block what
        // the user sees, so they're the only requests fired immediately.
        // Everything else below -- especially the handicap sync, which can
        // launch a full headless browser server-side -- used to fire in the
        // same instant and was competing with /feed itself for the
        // backend's CPU on every single page open. Deferring it until after
        // the feed has actually rendered keeps that contention off the
        // critical path.
        Promise.all([loadFeed(true), loadFriends()]).finally(() => {
            setLoading(false);

            authFetch(`${API}/notifications/ack`, { method: "POST" }).catch(() => {});

            authFetch(`${API}/profile`)
                .then((response) => (response.ok ? response.json() : null))
                .then((body) => {
                    if (body?.display_name) setMyName(body.display_name);
                    setMyAvatarUrl(body?.avatar_url || null);
                })
                .catch(() => {});

            redirectFirstTimeUsers();
            syncHandicapThenRefresh();
        });
    }, []);

    useEffect(() => {
        const highlight = searchParams.get("highlight");
        if (highlight) setHighlightKey(highlight);
    }, [searchParams]);

    useEffect(() => {
        if (!highlightKey || feed.length === 0) return;

        const el = feedCardRefs.current[highlightKey];
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });

        const timeout = setTimeout(() => setHighlightKey(null), 2500);
        return () => clearTimeout(timeout);
    }, [highlightKey, feed]);

    useEffect(() => {
        const sentinel = sentinelRef.current;
        if (!sentinel) return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting && hasMore && !loading && !loadingMore) {
                    loadFeed(false);
                }
            },
            { rootMargin: "400px" }
        );

        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [hasMore, loading, loadingMore, feed.length]);

    useEffect(() => {
        // Clicking anywhere outside an open reaction picker / share menu /
        // emoji picker / mention dropdown closes it.
        function handleClickOutside(event: MouseEvent) {
            const target = event.target as HTMLElement;

            if (!target.closest(".reaction-bar")) setReactionPickerOpen(null);
            if (!target.closest(".feed-share-wrap")) setShareMenuOpen(null);
            if (!target.closest(".feed-post-menu-wrap")) setPostMenuOpen(null);
            if (!target.closest(".feed-comment-emoji-wrap")) setEmojiPickerOpen(null);
            if (!target.closest(".feed-comment-input-wrap")) setMentionQuery({});
        }

        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    useEffect(() => {
        // Live-update a card's reaction counts the moment a friend reacts,
        // instead of only refreshing on the next page load.
        const channel = supabase
            .channel("feed-page-likes")
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "feed_likes" },
                (payload) => {
                    const row = (payload.new ?? payload.old) as
                        | { item_type?: string; item_id?: number }
                        | null;

                    if (row?.item_type && row?.item_id != null) {
                        refreshItemReactions(row.item_type, row.item_id);
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    useEffect(() => {
        // Auto-refresh the feed when a friend's new post lands (or an
        // auto-post like a milestone/tournament fires), instead of making
        // someone click a "new posts" banner. Debounced so a burst of
        // inserts (e.g. several auto-posts firing off one sync) triggers one
        // reload, not one per row.
        let debounceTimer: ReturnType<typeof setTimeout> | null = null;

        const channel = supabase
            .channel("feed-page-new-posts")
            .on(
                "postgres_changes",
                { event: "INSERT", schema: "public", table: "posts" },
                (payload) => {
                    const row = payload.new as { user_id?: string } | null;
                    if (!row?.user_id || row.user_id === myUserId) return;

                    if (debounceTimer) clearTimeout(debounceTimer);
                    debounceTimer = setTimeout(() => loadFeed(true), 500);
                }
            )
            .subscribe();

        return () => {
            if (debounceTimer) clearTimeout(debounceTimer);
            supabase.removeChannel(channel);
        };
    }, [myUserId]);

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

    // Both the inline "@Name" autocomplete and the "Tag people" pill flow
    // insert the same plain-text "@DisplayName" token into the draft -- so
    // rather than tracking a separate id set that could drift out of sync
    // with manual text edits (e.g. the user backspacing over a tag), the
    // structured mentioned_user_ids sent to the backend are derived straight
    // from whichever friend tokens are actually still present in the body
    // at submit time. Two friends sharing a display name both match, which
    // is the safe direction to err in (over-notify, never silently miss).
    function deriveMentionedUserIds(text: string): string[] {
        const ids: string[] = [];

        for (const friend of friends) {
            const escaped = friend.display_name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const pattern = new RegExp(`(^|\\W)@${escaped}(?=\\W|$)`);
            if (pattern.test(text)) ids.push(friend.user_id);
        }

        return ids;
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

    async function handlePostComment(
        event: FormEvent,
        itemType: string,
        itemId: number,
        parentCommentId?: number
    ) {
        event.preventDefault();
        const itemMapKey = itemKey(itemType, itemId);
        const composerKey = parentCommentId
            ? replyComposerKey(itemType, itemId, parentCommentId)
            : itemMapKey;
        const body = (drafts[composerKey] || "").trim();
        if (!body) return;

        setPosting((prev) => new Set(prev).add(composerKey));

        try {
            const response = await authFetch(`${API}/feed/${itemType}/${itemId}/comments`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    body,
                    mentioned_user_ids: deriveMentionedUserIds(body),
                    parent_comment_id: parentCommentId ?? null,
                }),
            });

            if (response.ok) {
                setDrafts((prev) => ({ ...prev, [composerKey]: "" }));
                setMentionQuery((prev) => {
                    const next = { ...prev };
                    delete next[composerKey];
                    return next;
                });
                setEmojiPickerOpen(null);
                if (parentCommentId) setActiveReplyCommentId(null);
                await loadComments(itemMapKey, itemType, itemId);
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
                next.delete(composerKey);
                return next;
            });
        }
    }

    async function refreshItemReactions(itemType: string, itemId: number) {
        // Only top-level feed cards (rounds/posts) are patched live -- a
        // like on a comment isn't worth the extra lookup to find which
        // comment list it lives under for this first pass.
        if (itemType !== "round" && itemType !== "post") return;

        try {
            const response = await authFetch(`${API}/feed/${itemType}/${itemId}/reactions`);
            if (!response.ok) return;

            const reactions: ReactionSummary = await response.json();

            setFeed((prev) =>
                prev.map((item) =>
                    item.item_type === itemType && item.item_id === itemId
                        ? { ...item, reactions }
                        : item
                )
            );
        } catch (error) {
            console.error(error);
        }
    }

    async function openReactionDetails(itemType: string, itemId: number) {
        const key = itemKey(itemType, itemId);
        setReactionDetailsKey(key);
        setReactionDetailsLoading(true);
        setReactionDetails([]);

        try {
            const response = await authFetch(`${API}/feed/${itemType}/${itemId}/reactions/details`);
            if (response.ok) setReactionDetails(await response.json());
        } catch (error) {
            console.error(error);
        } finally {
            setReactionDetailsLoading(false);
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

    function closeComposer() {
        setComposerOpen(false);
        setEditingPostId(null);
        setDrafts((prev) => ({ ...prev, [NEW_POST_KEY]: "" }));
        setPostPhotoUrl(null);
        setShareTarget(null);
        setEmojiPickerOpen(null);
        setComposerView("compose");
        setTagSearch("");
    }

    function isFriendTagged(friend: Friend) {
        return (drafts[NEW_POST_KEY] || "").includes(`@${friend.display_name}`);
    }

    function toggleTagFriend(friend: Friend) {
        const token = `@${friend.display_name}`;

        setDrafts((prev) => {
            const current = prev[NEW_POST_KEY] || "";

            const next = current.includes(token)
                ? current.replace(`${token} `, "").replace(token, "")
                : `${current}${current && !current.endsWith(" ") ? " " : ""}${token} `;

            return { ...prev, [NEW_POST_KEY]: next };
        });
    }

    async function handleSubmitPost(event: FormEvent) {
        event.preventDefault();
        const body = (drafts[NEW_POST_KEY] || "").trim();
        if (!body && !postPhotoUrl && !shareTarget) return;

        setPosting((prev) => new Set(prev).add(NEW_POST_KEY));

        try {
            const mentionedUserIds = deriveMentionedUserIds(body);

            const response = editingPostId
                ? await authFetch(`${API}/feed/posts/${editingPostId}`, {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ body, photo_url: postPhotoUrl, mentioned_user_ids: mentionedUserIds }),
                  })
                : await authFetch(`${API}/feed/posts`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                          body,
                          photo_url: postPhotoUrl,
                          shared_item_type: shareTarget?.item_type ?? null,
                          shared_item_id: shareTarget?.item_id ?? null,
                          mentioned_user_ids: mentionedUserIds,
                      }),
                  });

            if (response.ok) {
                closeComposer();
                await loadFeed(true);
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

    function startEditPost(item: FeedItem) {
        setEditingPostId(item.item_id);
        setDrafts((prev) => ({ ...prev, [NEW_POST_KEY]: item.body || "" }));
        setPostPhotoUrl(item.photo_url);
        setShareTarget(null);
        setPostMenuOpen(null);
        setComposerOpen(true);
    }

    async function handleDeletePost(item: FeedItem) {
        if (!window.confirm("Delete this post? This can't be undone.")) return;

        setPostMenuOpen(null);

        try {
            const response = await authFetch(`${API}/feed/posts/${item.item_id}`, {
                method: "DELETE",
            });

            if (response.ok) {
                await loadFeed(true);
            }
        } catch (error) {
            console.error(error);
        }
    }

    function startRepost(item: FeedItem) {
        setShareTarget(item);
        setShareMenuOpen(null);
        setComposerOpen(true);
    }


    return (
        <div className="feed-page">
            <header className="topbar">
                <div>
                    <BrandLogo />
                </div>

                <AppNav />
            </header>

            <main className="content">
                <div className="feed-container">
                {syncingHandicap && (
                    <p className="feed-sync-status">
                        <span className="spinner" /> Syncing your latest handicap scores...
                    </p>
                )}
                <div className="feed-card feed-composer-trigger-card">
                    <Avatar name={myName || "?"} avatarUrl={myAvatarUrl} small />

                    <button
                        type="button"
                        className="feed-composer-trigger"
                        onClick={() => setComposerOpen(true)}
                    >
                        {`What's on your mind${myName ? `, ${myName}` : ""}?`}
                    </button>

                    <label className="composer-icon-button" aria-label="Add a photo">
                        <ImageIcon />
                        <input
                            type="file"
                            accept="image/*"
                            hidden
                            onChange={(event) => {
                                setComposerOpen(true);
                                handlePostPhotoSelect(event.target.files?.[0]);
                            }}
                        />
                    </label>
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
                            <article
                                className={`feed-card${highlightKey === key ? " feed-card-highlight" : ""}`}
                                key={key}
                                ref={(el) => {
                                    feedCardRefs.current[key] = el;
                                }}
                            >
                                <div className="feed-card-header">
                                    <Avatar
                                        name={item.player_name}
                                        avatarUrl={
                                            item.is_system_generated
                                                ? `${import.meta.env.BASE_URL}favicon.svg`
                                                : item.player_avatar_url
                                        }
                                        onClick={
                                            item.is_system_generated
                                                ? undefined
                                                : () => setOpenProfileUserId(item.user_id)
                                        }
                                    />

                                    <div>
                                        <strong>{item.player_name}</strong>
                                        <span>
                                            {formatRelative(item.posted_at)}
                                            {item.edited_at && " · Edited"}
                                        </span>
                                    </div>

                                    {item.item_type === "post" &&
                                        !item.is_system_generated &&
                                        item.user_id === myUserId && (
                                            <div className="feed-post-menu-wrap">
                                                <button
                                                    type="button"
                                                    className="composer-icon-button feed-post-menu-toggle"
                                                    aria-label="Post options"
                                                    onClick={() =>
                                                        setPostMenuOpen((prev) => (prev === key ? null : key))
                                                    }
                                                >
                                                    <MoreIcon />
                                                </button>

                                                {postMenuOpen === key && (
                                                    <div className="share-menu">
                                                        <button type="button" onClick={() => startEditPost(item)}>
                                                            Edit post
                                                        </button>
                                                        <button type="button" onClick={() => handleDeletePost(item)}>
                                                            Delete post
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                </div>

                                {item.body && (
                                    <p className="feed-post-body">
                                        {renderBody(item.body, friends, setOpenProfileUserId, handleTournamentClick)}
                                    </p>
                                )}

                                {item.photo_url && (
                                    <img src={item.photo_url} alt="" className="feed-card-photo" />
                                )}

                                {item.shared_item && (
                                    <div className="feed-shared-item">
                                        <div className="feed-card-header">
                                            <Avatar
                                                name={item.shared_item.player_name}
                                                avatarUrl={item.shared_item.player_avatar_url}
                                                onClick={() => setOpenProfileUserId(item.shared_item!.user_id)}
                                            />
                                            <div>
                                                <strong>{item.shared_item.player_name}</strong>
                                                <span>{formatRelative(item.shared_item.posted_at)}</span>
                                            </div>
                                        </div>

                                        {item.shared_item.body && (
                                            <p className="feed-post-body">
                                                {renderBody(item.shared_item.body, friends, setOpenProfileUserId, handleTournamentClick)}
                                            </p>
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

                                {formatLikedBy(item.reactions.recent_reactor_names, item.reactions.total) && (
                                    <button
                                        type="button"
                                        className="post-reaction-liked-by"
                                        onClick={() => openReactionDetails(item.item_type, item.item_id)}
                                    >
                                        {formatLikedBy(item.reactions.recent_reactor_names, item.reactions.total)}
                                    </button>
                                )}

                                <div className="feed-actions-row">
                                    <PostReactionBar
                                        itemType={item.item_type}
                                        itemId={item.item_id}
                                        reactions={item.reactions}
                                        reactionPickerOpen={reactionPickerOpen}
                                        onTogglePicker={(k) =>
                                            setReactionPickerOpen((prev) => (prev === k ? null : k))
                                        }
                                        onReact={react}
                                        onShowDetails={openReactionDetails}
                                    />

                                    {item.comment_count > 0 && (
                                        <button
                                            type="button"
                                            className="feed-action-button"
                                            aria-label="Comment"
                                            onClick={() => focusCommentInput(key)}
                                        >
                                            <MessageIcon />
                                            <span className="feed-action-count">{item.comment_count}</span>
                                        </button>
                                    )}

                                    <div className="feed-share-wrap">
                                        <button
                                            type="button"
                                            className="feed-action-button"
                                            aria-label="Share"
                                            onClick={() =>
                                                setShareMenuOpen((prev) => (prev === key ? null : key))
                                            }
                                        >
                                            <ShareIcon />
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
                                        {itemComments.map((comment) => {
                                            const replyKey = replyComposerKey(item.item_type, item.item_id, comment.id);
                                            return (
                                                <div className="feed-comment-thread" key={comment.id}>
                                                    <div className="feed-comment-row">
                                                        <Avatar
                                                            name={comment.author_name}
                                                            avatarUrl={comment.author_avatar_url}
                                                            small
                                                            onClick={() => setOpenProfileUserId(comment.user_id)}
                                                        />

                                                        <div className="feed-comment-bubble-wrap">
                                                            <div className="feed-comment-bubble">
                                                                <strong>{comment.author_name}</strong>
                                                                <p>{renderBody(comment.body, friends, setOpenProfileUserId, handleTournamentClick)}</p>
                                                            </div>

                                                            <div className="feed-comment-meta">
                                                                <span>{formatDateTime(comment.created_at)}</span>
                                                                <ReactionBar
                                                                    itemType="comment"
                                                                    itemId={comment.id}
                                                                    reactions={comment.reactions}
                                                                    reactionPickerOpen={reactionPickerOpen}
                                                                    onToggleReactionPicker={(k) =>
                                                                        setReactionPickerOpen((prev) =>
                                                                            prev === k ? null : k
                                                                        )
                                                                    }
                                                                    onReact={react}
                                                                />
                                                                <button
                                                                    type="button"
                                                                    className="feed-comment-reply-btn"
                                                                    onClick={() =>
                                                                        setActiveReplyCommentId((prev) =>
                                                                            prev === comment.id ? null : comment.id
                                                                        )
                                                                    }
                                                                >
                                                                    Reply
                                                                </button>
                                                            </div>

                                                            {comment.replies.map((reply) => (
                                                                <div className="feed-comment-row feed-comment-reply" key={reply.id}>
                                                                    <Avatar
                                                                        name={reply.author_name}
                                                                        avatarUrl={reply.author_avatar_url}
                                                                        small
                                                                        onClick={() => setOpenProfileUserId(reply.user_id)}
                                                                    />

                                                                    <div className="feed-comment-bubble-wrap">
                                                                        <div className="feed-comment-bubble">
                                                                            <strong>{reply.author_name}</strong>
                                                                            <p>{renderBody(reply.body, friends, setOpenProfileUserId, handleTournamentClick)}</p>
                                                                        </div>

                                                                        <div className="feed-comment-meta">
                                                                            <span>{formatDateTime(reply.created_at)}</span>
                                                                            <ReactionBar
                                                                                itemType="comment"
                                                                                itemId={reply.id}
                                                                                reactions={reply.reactions}
                                                                                reactionPickerOpen={reactionPickerOpen}
                                                                                onToggleReactionPicker={(k) =>
                                                                                    setReactionPickerOpen((prev) =>
                                                                                        prev === k ? null : k
                                                                                    )
                                                                                }
                                                                                onReact={react}
                                                                            />
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            ))}

                                                            {activeReplyCommentId === comment.id && (
                                                                <CommentComposer
                                                                    itemType={item.item_type}
                                                                    itemId={item.item_id}
                                                                    parentCommentId={comment.id}
                                                                    composerKey={replyKey}
                                                                    placeholder={`Reply to ${comment.author_name}...`}
                                                                    draft={drafts[replyKey] || ""}
                                                                    suggestions={mentionSuggestions(replyKey)}
                                                                    emojiPickerOpen={emojiPickerOpen}
                                                                    posting={posting.has(replyKey)}
                                                                    onDraftChange={handleDraftChange}
                                                                    onSelectMention={selectMention}
                                                                    onToggleEmojiPicker={toggleEmojiPicker}
                                                                    onInsertEmoji={insertEmoji}
                                                                    onSubmit={handlePostComment}
                                                                    inputRef={(el) => {
                                                                        commentInputRefs.current[replyKey] = el;
                                                                    }}
                                                                />
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    <CommentComposer
                                        itemType={item.item_type}
                                        itemId={item.item_id}
                                        composerKey={key}
                                        draft={drafts[key] || ""}
                                        suggestions={mentionSuggestions(key)}
                                        emojiPickerOpen={emojiPickerOpen}
                                        posting={posting.has(key)}
                                        onDraftChange={handleDraftChange}
                                        onSelectMention={selectMention}
                                        onToggleEmojiPicker={toggleEmojiPicker}
                                        onInsertEmoji={insertEmoji}
                                        onSubmit={handlePostComment}
                                        inputRef={(el) => {
                                            commentInputRefs.current[key] = el;
                                        }}
                                    />
                                </div>
                            </article>
                        );
                    })
                )}

                {!loading && feed.length > 0 && (
                    <div ref={sentinelRef} className="feed-load-more-sentinel">
                        {loadingMore && <span className="course-count">Loading more...</span>}
                    </div>
                )}
                </div>
            </main>

            <BottomNav />

            {openProfileUserId && (
                <FriendProfileModal userId={openProfileUserId} onClose={() => setOpenProfileUserId(null)} />
            )}

            {composerOpen && composerView === "compose" && (
                <div className="modal-overlay post-composer-overlay" onClick={closeComposer}>
                    <div className="modal-card post-composer-card" onClick={(event) => event.stopPropagation()}>
                        <div className="post-composer-topbar">
                            <button type="button" className="post-composer-cancel" onClick={closeComposer} aria-label="Close">
                                ✕
                            </button>

                            <strong>{editingPostId ? "Edit post" : "New post"}</strong>

                            <span className="post-composer-topbar-spacer" />
                        </div>

                        <div className="post-composer-identity">
                            <Avatar name={myName || "?"} avatarUrl={myAvatarUrl} small />
                            <strong>{myName || "You"}</strong>
                        </div>

                        <div className="post-composer-pills">
                            <button
                                type="button"
                                className="post-composer-pill"
                                onClick={() => setComposerView("tagPeople")}
                            >
                                <PeopleIcon />
                                {(() => {
                                    const taggedCount = friends.filter(isFriendTagged).length;
                                    return taggedCount > 0 ? `${taggedCount} tagged` : "Tag people";
                                })()}
                            </button>
                        </div>

                        <form id="post-composer-form" className="post-composer-form" onSubmit={handleSubmitPost}>
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

                            <div className="feed-comment-input-wrap post-composer-input-wrap">
                                <textarea
                                    className="settings-input post-composer-textarea"
                                    placeholder={`What's on your mind${myName ? `, ${myName}` : ""}?`}
                                    value={drafts[NEW_POST_KEY] || ""}
                                    onChange={(event) => handleDraftChange(NEW_POST_KEY, event.target.value)}
                                    autoFocus
                                    rows={5}
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
                        </form>

                        <div className="post-composer-bottombar">
                            <label className="composer-icon-button" aria-label="Add a photo">
                                {postPhotoUploading ? "..." : <ImageIcon />}
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
                                    className="composer-icon-button"
                                    aria-label="Add an emoji"
                                    onClick={() => toggleEmojiPicker(NEW_POST_KEY)}
                                >
                                    <SmileIcon />
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
                                className="sync-button post-composer-submit"
                                type="submit"
                                form="post-composer-form"
                                disabled={posting.has(NEW_POST_KEY) || postPhotoUploading}
                            >
                                {posting.has(NEW_POST_KEY)
                                    ? editingPostId ? "Saving..." : "Posting..."
                                    : editingPostId ? "Save" : "Post"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {composerOpen && composerView === "tagPeople" && (
                <div className="modal-overlay post-composer-overlay" onClick={() => setComposerView("compose")}>
                    <div className="modal-card post-composer-card" onClick={(event) => event.stopPropagation()}>
                        <div className="post-composer-topbar">
                            <button
                                type="button"
                                className="post-composer-cancel"
                                onClick={() => setComposerView("compose")}
                                aria-label="Back"
                            >
                                ✕
                            </button>

                            <strong>Tag people</strong>

                            <button
                                type="button"
                                className="post-composer-cancel post-composer-done"
                                onClick={() => setComposerView("compose")}
                            >
                                Done
                            </button>
                        </div>

                        <div className="post-composer-tag-search">
                            <input
                                className="settings-input"
                                placeholder="Who are you with?"
                                value={tagSearch}
                                onChange={(event) => setTagSearch(event.target.value)}
                                autoFocus
                            />
                        </div>

                        <div className="post-composer-tag-list">
                            {friends
                                .filter((friend) =>
                                    friend.display_name.toLowerCase().includes(tagSearch.toLowerCase())
                                )
                                .map((friend) => (
                                    <button
                                        type="button"
                                        key={friend.user_id}
                                        className="post-composer-tag-row"
                                        onClick={() => toggleTagFriend(friend)}
                                    >
                                        <Avatar name={friend.display_name} avatarUrl={friend.avatar_url} small />
                                        <span>{friend.display_name}</span>
                                        <span
                                            className={`post-composer-tag-check${
                                                isFriendTagged(friend) ? " checked" : ""
                                            }`}
                                        />
                                    </button>
                                ))}

                            {friends.length === 0 && (
                                <p className="course-count" style={{ padding: 16 }}>
                                    Add some friends first to tag them in a post.
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {reactionDetailsKey && (
                <div className="modal-overlay" onClick={() => setReactionDetailsKey(null)}>
                    <div className="modal-card reaction-details-card" onClick={(event) => event.stopPropagation()}>
                        <button
                            className="modal-close"
                            onClick={() => setReactionDetailsKey(null)}
                            aria-label="Close"
                        >
                            ✕
                        </button>

                        <h3 className="reaction-details-title">Reactions</h3>

                        {reactionDetailsLoading ? (
                            <p className="course-count">Loading...</p>
                        ) : reactionDetails.length === 0 ? (
                            <p className="course-count">No reactions yet.</p>
                        ) : (
                            <div className="reaction-details-list">
                                {reactionDetails.map((detail) => (
                                    <div className="reaction-details-row" key={detail.user_id}>
                                        <Avatar name={detail.display_name} avatarUrl={detail.avatar_url} small />
                                        <span>{detail.display_name}</span>
                                        <span className="reaction-details-emoji">
                                            {REACTION_EMOJI[detail.reaction]}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

export default FeedPage;
