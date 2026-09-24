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

    const [mode, setMode] = useState<"signin" | "signup">("signin");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");

    const [firstName, setFirstName] = useState("");
    const [surname, setSurname] = useState("");
    const [nickname, setNickname] = useState("");
    const [phone, setPhone] = useState("");
    const [country, setCountry] = useState("");
    const [province, setProvince] = useState("");
    const [dateOfBirth, setDateOfBirth] = useState("");
    const [sex, setSex] = useState("");
    const [displayPreference, setDisplayPreference] = useState<"name" | "nickname">("name");
    const [termsAccepted, setTermsAccepted] = useState(false);
    const [newsletterOptIn, setNewsletterOptIn] = useState(false);
    const [sponsorOptIn, setSponsorOptIn] = useState(false);

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
                const { error } = await supabase.auth.signUp({
                    email,
                    password,
                    options: {
                        data: {
                            display_name: firstName,
                            surname,
                            nickname,
                            phone,
                            country,
                            province,
                            date_of_birth: dateOfBirth,
                            sex,
                            display_preference: displayPreference,
                            newsletter_opt_in: newsletterOptIn,
                            sponsor_opt_in: sponsorOptIn,
                            terms_accepted: true,
                            terms_version: TERMS_VERSION,
                        },
                    },
                });

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

                        {mode === "signup" && (
                            <>
                                <label className="settings-label">
                                    Name
                                    <input
                                        className="settings-input"
                                        value={firstName}
                                        onChange={(event) => setFirstName(event.target.value)}
                                        required
                                    />
                                </label>

                                <label className="settings-label">
                                    Surname
                                    <input
                                        className="settings-input"
                                        value={surname}
                                        onChange={(event) => setSurname(event.target.value)}
                                        required
                                    />
                                </label>

                                <label className="settings-label">
                                    Nickname (optional)
                                    <input
                                        className="settings-input"
                                        value={nickname}
                                        onChange={(event) => setNickname(event.target.value)}
                                    />
                                </label>

                                {nickname.trim() && (
                                    <label className="settings-label">
                                        Show friends my
                                        <select
                                            className="settings-input"
                                            value={displayPreference}
                                            onChange={(event) =>
                                                setDisplayPreference(event.target.value as "name" | "nickname")
                                            }
                                        >
                                            <option value="name">Full name</option>
                                            <option value="nickname">Nickname</option>
                                        </select>
                                    </label>
                                )}

                                <label className="settings-label">
                                    Mobile number
                                    <input
                                        className="settings-input"
                                        type="tel"
                                        value={phone}
                                        onChange={(event) => setPhone(event.target.value)}
                                        required
                                    />
                                </label>

                                <label className="settings-label">
                                    Country
                                    <input
                                        className="settings-input"
                                        value={country}
                                        onChange={(event) => setCountry(event.target.value)}
                                        required
                                    />
                                </label>

                                <label className="settings-label">
                                    Province
                                    <input
                                        className="settings-input"
                                        value={province}
                                        onChange={(event) => setProvince(event.target.value)}
                                    />
                                </label>

                                <label className="settings-label">
                                    Date of birth
                                    <input
                                        className="settings-input"
                                        type="date"
                                        value={dateOfBirth}
                                        onChange={(event) => setDateOfBirth(event.target.value)}
                                        required
                                    />
                                </label>

                                <label className="settings-label">
                                    Sex
                                    <select
                                        className="settings-input"
                                        value={sex}
                                        onChange={(event) => setSex(event.target.value)}
                                        required
                                    >
                                        <option value="" disabled>
                                            Select one
                                        </option>
                                        <option value="male">Male</option>
                                        <option value="female">Female</option>
                                        <option value="other">Other</option>
                                        <option value="prefer_not_to_say">Prefer not to say</option>
                                    </select>
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

                                <label className="auth-checkbox-label">
                                    <input
                                        type="checkbox"
                                        checked={newsletterOptIn}
                                        onChange={(event) => setNewsletterOptIn(event.target.checked)}
                                    />
                                    Send me the GolfCircle newsletter
                                </label>

                                <label className="auth-checkbox-label">
                                    <input
                                        type="checkbox"
                                        checked={sponsorOptIn}
                                        onChange={(event) => setSponsorOptIn(event.target.checked)}
                                    />
                                    Send me sponsor promotions
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

                <div style={{ marginTop: 16, textAlign: "center" }}>
                    <ThemeToggle />
                </div>
            </div>
        </div>
    );
}

export default LoginPage;
