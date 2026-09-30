import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "./supabaseClient";
import { useAuth } from "./AuthContext";
import ThemeToggle from "./ThemeToggle";
import { TERMS_VERSION } from "./TermsPage";

function LoginPage() {
    const navigate = useNavigate();
    const { session } = useAuth();

    useEffect(() => {
        if (session) {
            navigate("/", { replace: true });
        }
    }, [session, navigate]);

    const [mode, setMode] = useState<"intro" | "signin" | "signup">("intro");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");

    const [handicapMemberNo, setHandicapMemberNo] = useState("");
    const [handicapPassword, setHandicapPassword] = useState("");
    const [termsAccepted, setTermsAccepted] = useState(false);

    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [signupDone, setSignupDone] = useState(false);

    async function handleSubmit(event: FormEvent) {
        event.preventDefault();
        setError(null);

        if (mode === "signup" && !termsAccepted) {
            setError("You need to accept the Terms & Privacy Policy to sign up");
            return;
        }

        setLoading(true);

        try {
            if (mode === "signin") {
                const { error } = await supabase.auth.signInWithPassword({
                    email,
                    password,
                });

                if (error) throw error;
            } else {
                // Just the basics for now (display_name falls back to the
                // email prefix via handle_new_user's trigger) -- surname,
                // phone, DOB, etc. are collected later in a proper
                // profile-completion flow instead of up front at signup.
                const { error } = await supabase.auth.signUp({
                    email,
                    password,
                    options: {
                        data: {
                            terms_accepted: true,
                            terms_version: TERMS_VERSION,
                        },
                    },
                });

                if (error) throw error;

                // Email confirmation is required before there's an active
                // session, so credentials can't be saved via the backend
                // right now -- stash them for RequireAuth to pick up and
                // save/sync automatically the moment this account first
                // signs in (see App.tsx). Cleared there whether or not it
                // succeeds, so nothing lingers past that first sign-in.
                if (handicapMemberNo.trim() && handicapPassword) {
                    sessionStorage.setItem(
                        "pending_handicap_credentials",
                        JSON.stringify({ member_no: handicapMemberNo.trim(), password: handicapPassword })
                    );
                }

                setSignupDone(true);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Something went wrong");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="auth-page">
            <div className="auth-card">
                <img
                    src={`${import.meta.env.BASE_URL}logo-full.png`}
                    alt="GolfCircle"
                    className="auth-logo"
                />
                {mode === "intro" ? (
                    <>
                        <h1>Welcome to GolfCircle</h1>

                        <p className="auth-intro-copy">
                            Track every round and your official handicap, and see what your
                            golf buddies are up to — all pulled automatically once you connect
                            an account like handicaps.co.za, Strava, Garmin, or your club.
                        </p>

                        <button
                            className="sync-button"
                            style={{ width: "100%" }}
                            onClick={() => setMode("signup")}
                        >
                            Create an account
                        </button>

                        <button
                            className="auth-toggle"
                            onClick={() => setMode("signin")}
                        >
                            I already have an account — Sign in
                        </button>
                    </>
                ) : (
                <>
                <h1>{mode === "signin" ? "Sign in" : "Create account"}</h1>

                {signupDone ? (
                    <p className="course-count">
                        Check your email to confirm your account, then sign in.
                    </p>
                ) : (
                    <form onSubmit={handleSubmit}>
                        <label className="settings-label">
                            Email
                            <input
                                className="settings-input"
                                type="email"
                                value={email}
                                onChange={(event) => setEmail(event.target.value)}
                                required
                            />
                        </label>

                        <label className="settings-label">
                            Password
                            <input
                                className="settings-input"
                                type="password"
                                value={password}
                                onChange={(event) => setPassword(event.target.value)}
                                required
                                minLength={6}
                            />
                        </label>

                        {mode === "signup" && (
                            <>
                                <div className="auth-section-heading">
                                    <strong>Handicaps.co.za</strong>
                                    <span>Optional — connects your official handicap and round history. You can add this later in Settings instead.</span>
                                </div>

                                <label className="settings-label">
                                    Member number
                                    <input
                                        className="settings-input"
                                        value={handicapMemberNo}
                                        onChange={(event) => setHandicapMemberNo(event.target.value)}
                                    />
                                </label>

                                <label className="settings-label">
                                    Handicaps.co.za password
                                    <input
                                        className="settings-input"
                                        type="password"
                                        value={handicapPassword}
                                        onChange={(event) => setHandicapPassword(event.target.value)}
                                    />
                                </label>

                                <label className="auth-checkbox-label">
                                    <input
                                        type="checkbox"
                                        checked={termsAccepted}
                                        onChange={(event) => setTermsAccepted(event.target.checked)}
                                        required
                                    />
                                    I accept the{" "}
                                    <Link to="/terms" target="_blank" rel="noreferrer">
                                        Terms &amp; Privacy Policy
                                    </Link>
                                </label>
                            </>
                        )}

                        {error && <p className="auth-error">{error}</p>}

                        <button
                            className="sync-button"
                            type="submit"
                            disabled={loading}
                            style={{ marginTop: 12, width: "100%" }}
                        >
                            {loading
                                ? "Please wait..."
                                : mode === "signin"
                                ? "Sign in"
                                : "Sign up"}
                        </button>
                    </form>
                )}

                <button
                    className="auth-toggle"
                    onClick={() => {
                        setMode(mode === "signin" ? "signup" : "signin");
                        setError(null);
                        setSignupDone(false);
                    }}
                >
                    {mode === "signin"
                        ? "Need an account? Sign up"
                        : "Already have an account? Sign in"}
                </button>
                </>
                )}

                <div style={{ marginTop: 16, textAlign: "center" }}>
                    <ThemeToggle />
                </div>
            </div>
        </div>
    );
}

export default LoginPage;
