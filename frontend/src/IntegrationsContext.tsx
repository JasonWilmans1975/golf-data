import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useState,
    type ReactNode,
} from "react";
import { API, authFetch } from "./api";
import { useAuth } from "./AuthContext";

type IntegrationsState = {
    strava: boolean;
    handicap: boolean;
    garmin: boolean;
    teesheet: boolean;
    loading: boolean;
    refresh: () => void;
};

const IntegrationsContext = createContext<IntegrationsState>({
    strava: false,
    handicap: false,
    garmin: false,
    teesheet: false,
    loading: true,
    refresh: () => {},
});

async function isConnected(response: Response) {
    if (!response.ok) return false;

    const body = await response.json();
    return Boolean(body.connected);
}

export function IntegrationsProvider({ children }: { children: ReactNode }) {
    const { session } = useAuth();

    const [strava, setStrava] = useState(false);
    const [handicap, setHandicap] = useState(false);
    const [garmin, setGarmin] = useState(false);
    const [teesheet, setTeesheet] = useState(false);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        if (!session) {
            setLoading(false);
            return;
        }

        try {
            const [stravaRes, handicapRes, garminRes, teesheetRes] = await Promise.all([
                authFetch(`${API}/strava/status`),
                authFetch(`${API}/handicap/credentials/status`),
                authFetch(`${API}/garmin/credentials/status`),
                authFetch(`${API}/teesheet/credentials/status`),
            ]);

            setStrava(await isConnected(stravaRes));
            setHandicap(await isConnected(handicapRes));
            setGarmin(await isConnected(garminRes));
            setTeesheet(await isConnected(teesheetRes));
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    }, [session]);

    useEffect(() => {
        load();
    }, [load]);

    return (
        <IntegrationsContext.Provider
            value={{ strava, handicap, garmin, teesheet, loading, refresh: load }}
        >
            {children}
        </IntegrationsContext.Provider>
    );
}

export function useIntegrations() {
    return useContext(IntegrationsContext);
}
