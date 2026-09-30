import { useEffect, useRef, useState } from "react";
import { API, authFetch } from "./api";
import { Avatar } from "./FriendProfileModal";
import type { StoryGroup } from "./StoryBar";
import { backgroundCss } from "./StoryComposer";
import { REACTION_EMOJI } from "./reactions";

const STORY_DURATION_MS = 5000;

type Viewer = { user_id: string; display_name: string; avatar_url: string | null; viewed_at: string };

export function StoryViewer({
    groups,
    groupIndex,
    storyIndex,
    myUserId,
    onClose,
    onNavigate,
    onStoryViewed,
    onReact,
}: {
    groups: StoryGroup[];
    groupIndex: number;
    storyIndex: number;
    myUserId: string | null;
    onClose: () => void;
    onNavigate: (groupIndex: number, storyIndex: number) => void;
    onStoryViewed: (storyId: number) => void;
    onReact: (storyId: number, reaction: string) => void;
}) {
    const group = groups[groupIndex];
    const story = group?.stories[storyIndex];
    const isOwn = Boolean(story && myUserId === group.user_id);

    const [progress, setProgress] = useState(0);
    const [viewers, setViewers] = useState<Viewer[] | null>(null);
    const [viewersLoading, setViewersLoading] = useState(false);
    const progressRef = useRef(0);
    const rafRef = useRef(0);

    function goNext() {
        if (!group) return;

        if (storyIndex < group.stories.length - 1) {
            onNavigate(groupIndex, storyIndex + 1);
        } else if (groupIndex < groups.length - 1) {
            onNavigate(groupIndex + 1, 0);
        } else {
            onClose();
        }
    }

    function goPrev() {
        if (!group) return;

        if (storyIndex > 0) {
            onNavigate(groupIndex, storyIndex - 1);
        } else if (groupIndex > 0) {
            onNavigate(groupIndex - 1, groups[groupIndex - 1].stories.length - 1);
        }
    }

    // Reset per-story state and record the view once, whenever the viewer
    // moves to a different story.
    useEffect(() => {
        setViewers(null);
        setProgress(0);
        progressRef.current = 0;

        if (!story) return;

        if (!isOwn && !story.viewed_by_me) {
            onStoryViewed(story.id);
            authFetch(`${API}/stories/${story.id}/view`, { method: "POST" }).catch(() => {});
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [groupIndex, storyIndex]);

    // Drives the progress bar and auto-advance. Paused (not reset) while the
    // "Seen by" panel is open, resuming from where it left off on close.
    useEffect(() => {
        if (!story || viewers !== null) {
            cancelAnimationFrame(rafRef.current);
            return;
        }

        const start = performance.now() - (progressRef.current / 100) * STORY_DURATION_MS;

        function tick(now: number) {
            const elapsed = now - start;
            const pct = Math.min(100, (elapsed / STORY_DURATION_MS) * 100);
            progressRef.current = pct;
            setProgress(pct);

            if (pct >= 100) {
                goNext();
            } else {
                rafRef.current = requestAnimationFrame(tick);
            }
        }

        rafRef.current = requestAnimationFrame(tick);

        return () => cancelAnimationFrame(rafRef.current);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [groupIndex, storyIndex, viewers]);

    async function openViewers() {
        if (!story) return;

        setViewersLoading(true);

        try {
            const response = await authFetch(`${API}/stories/${story.id}/viewers`);
            if (response.ok) setViewers(await response.json());
        } catch (error) {
            console.error(error);
        } finally {
            setViewersLoading(false);
        }
    }

    if (!group || !story) return null;

    return (
        <div className="story-viewer-overlay">
            <div className="story-viewer-progress-row">
                {group.stories.map((s, index) => (
                    <div className="story-viewer-progress-track" key={s.id}>
                        <div
                            className="story-viewer-progress-fill"
                            style={{
                                width:
                                    index < storyIndex ? "100%" : index === storyIndex ? `${progress}%` : "0%",
                            }}
                        />
                    </div>
                ))}
            </div>

            <div className="story-viewer-header">
                <Avatar name={group.display_name} avatarUrl={group.avatar_url} small />
                <span>{group.display_name}</span>
                {story.visibility === "everyone" && (
                    <span className="story-viewer-visibility-badge" title="Visible to all of GolfCircle">
                        🌍
                    </span>
                )}
                <button type="button" className="story-viewer-close" onClick={onClose} aria-label="Close">
                    ✕
                </button>
            </div>

            {story.photo_url ? (
                <img src={story.photo_url} alt="" className="story-viewer-image" />
            ) : (
                <div className="story-viewer-text-slide" style={{ background: backgroundCss(story.background_color) }}>
                    <p>{story.caption}</p>
                </div>
            )}

            <div className="story-viewer-tap-zone story-viewer-tap-prev" onClick={goPrev} />
            <div className="story-viewer-tap-zone story-viewer-tap-next" onClick={goNext} />

            {story.photo_url && story.caption && (
                <div className="story-viewer-caption">{story.caption}</div>
            )}

            {isOwn ? (
                <button type="button" className="story-viewer-seenby" onClick={openViewers}>
                    Seen by
                </button>
            ) : (
                <div className="story-viewer-reactions" onClick={(event) => event.stopPropagation()}>
                    {Object.entries(REACTION_EMOJI).map(([reaction, emoji]) => (
                        <button
                            type="button"
                            key={reaction}
                            className={story.reactions.my_reaction === reaction ? "active" : ""}
                            onClick={() => onReact(story.id, reaction)}
                        >
                            {emoji}
                        </button>
                    ))}
                </div>
            )}

            {viewers !== null && (
                <div className="story-viewer-seenby-panel" onClick={(event) => event.stopPropagation()}>
                    <div className="story-viewer-seenby-header">
                        <strong>Seen by</strong>
                        <button type="button" onClick={() => setViewers(null)} aria-label="Close">
                            ✕
                        </button>
                    </div>

                    {viewersLoading ? (
                        <p className="course-count">Loading...</p>
                    ) : viewers.length === 0 ? (
                        <p className="course-count">No views yet.</p>
                    ) : (
                        viewers.map((viewer) => (
                            <div className="story-viewer-seenby-row" key={viewer.user_id}>
                                <Avatar name={viewer.display_name} avatarUrl={viewer.avatar_url} small />
                                <span>{viewer.display_name}</span>
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}
