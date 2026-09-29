// Shared between FeedPage (posts/rounds/comments) and the Stories
// components (stories reuse the exact same reaction system) -- pulled out
// of FeedPage.tsx so StoryBar/StoryViewer can use the same type/helpers
// without an import cycle back into FeedPage.tsx.

export type ReactionSummary = {
    counts: Record<string, number>;
    total: number;
    my_reaction: string | null;
    recent_reactor_names: string[];
};

export const REACTION_EMOJI: Record<string, string> = {
    like: "👍",
    love: "❤️",
    haha: "😆",
    wow: "😮",
    sad: "😢",
    angry: "😠",
};

export function applyReaction(
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
