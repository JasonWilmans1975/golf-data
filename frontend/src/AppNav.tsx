import NavButton from "./NavButton";
import FeedNavButton from "./FeedNavButton";
import TopbarActions from "./TopbarActions";
import { useIntegrations } from "./IntegrationsContext";

function AppNav() {
    const { strava, handicap, garmin, teesheet, loading } = useIntegrations();

    // While the first connection-status fetch is in flight, show every item
    // rather than flashing a stripped-down menu that then gains entries a
    // moment later once we know what's actually connected.
    const show = (flag: boolean) => loading || flag;

    // Courses come from Strava-detected activity AND from handicap sync
    // (match_handicap_scores_to_courses runs on every handicap sync too), so
    // anything built purely from the courses table shouldn't require Strava
    // specifically -- only GPS routes (shown per-course, not here) do.
    const hasCourseData = strava || handicap;

    return (
        <TopbarActions>
            {show(hasCourseData) && <NavButton to="/rounds">My Rounds</NavButton>}
            {show(hasCourseData) && <NavButton to="/map">World Map</NavButton>}
            {show(hasCourseData) && <NavButton to="/stats">Stats</NavButton>}
            {show(handicap) && <NavButton to="/leaderboard">Leaderboard</NavButton>}
            {show(handicap) && <NavButton to="/tournaments">Tournaments</NavButton>}
            <NavButton to="/friends">Friends</NavButton>
            {show(garmin) && <NavButton to="/wellness">Wellness</NavButton>}
            {show(teesheet) && <NavButton to="/teesheet">Teesheet</NavButton>}
            <FeedNavButton />
            <NavButton to="/settings">Settings</NavButton>
        </TopbarActions>
    );
}

export default AppNav;
