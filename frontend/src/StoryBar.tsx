import { Avatar } from "./FriendProfileModal";
import type { ReactionSummary } from "./reactions";

export type Story = {
    id: number;
    photo_url: string | null;
    caption: string | null;
    background_color: string | null;
    created_at: string;
    viewed_by_me: boolean;
    reactions: ReactionSummary;
};

export type StoryGroup = {
    user_id: string;
    display_name: string;
    avatar_url: string | null;
    stories: Story[];
    has_unviewed: boolean;
};

function PlusIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
    );
}

export function StoryBar({
    groups,
    myUserId,
    myName,
    myAvatarUrl,
    onOpenGroup,
    onOpenComposer,
    uploading,
}: {
    groups: StoryGroup[];
    myUserId: string | null;
    myName: string;
    myAvatarUrl: string | null;
    onOpenGroup: (index: number) => void;
    onOpenComposer: () => void;
    uploading: boolean;
}) {
    const myGroupIndex = groups.findIndex((group) => group.user_id === myUserId);
    const myGroup = myGroupIndex >= 0 ? groups[myGroupIndex] : null;

    return (
        <div className="story-bar">
            <button
                type="button"
                className="story-circle"
                onClick={() => (myGroup ? onOpenGroup(myGroupIndex) : onOpenComposer())}
            >
                <div className={`story-ring${myGroup?.has_unviewed ? " story-ring-unviewed" : " story-ring-none"}`}>
                    <Avatar name={myName || "?"} avatarUrl={myAvatarUrl} />
                    {!myGroup && (
                        <button
                            type="button"
                            className="story-add-badge"
                            aria-label="Add to your story"
                            onClick={(event) => {
                                event.stopPropagation();
                                onOpenComposer();
                            }}
                            disabled={uploading}
                        >
                            <PlusIcon />
                        </button>
                    )}
                </div>
                <span>{uploading ? "Posting..." : "Your story"}</span>
            </button>

            {groups
                .filter((group) => group.user_id !== myUserId)
                .map((group) => {
                    const index = groups.indexOf(group);
                    return (
                        <button
                            type="button"
                            className="story-circle"
                            key={group.user_id}
                            onClick={() => onOpenGroup(index)}
                        >
                            <div className={`story-ring${group.has_unviewed ? " story-ring-unviewed" : " story-ring-viewed"}`}>
                                <Avatar name={group.display_name} avatarUrl={group.avatar_url} />
                            </div>
                            <span>{group.display_name.split(" ")[0]}</span>
                        </button>
                    );
                })}
        </div>
    );
}
