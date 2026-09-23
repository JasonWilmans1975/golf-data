import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "./supabaseClient";
import { useAuth } from "./AuthContext";
import ThemeToggle from "./ThemeToggle";

function LoginPage() {
    const navigate = useNavigate();
    const { session } = useAuth();

    useEffect(() => {
        if (session) {
            navigate("/", { replace: true });
        }
    }, [session, navigate]);

    const [mode, setMode] = useState<"signin" | "signup">("signin");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [signupDone, setSignupDone] = useState(false);

    async function handleSubmit(event: FormEvent) {
        event.preventDefault();
        setError(null);
        setLoading(true);

        try {
            if (mode === "signin") {
                const { error } = await supabase.auth.signInWithPassword({
                    email,
                    password,
                });

                if (error) throw error;
            } else {
                const { error } = await supabase.auth.signUp({ email, password });

                if (error) throw error;

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

                <div style={{ marginTop: 16, textAlign: "center" }}>
                    <ThemeToggle />
                </div>
            </div>
        </div>
    );
}

export default LoginPage;
