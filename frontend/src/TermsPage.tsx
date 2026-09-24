export const TERMS_VERSION = "2026-09-24-draft";

function TermsPage() {
    return (
        <div className="auth-page">
            <div className="auth-card" style={{ maxWidth: 640, textAlign: "left" }}>
                <h1>Terms & Privacy Policy</h1>

                <p className="auth-error" style={{ marginBottom: 16 }}>
                    Draft placeholder — this has not been reviewed by a lawyer yet.
                    Replace this page's content before relying on it for real POPIA
                    compliance.
                </p>

                <h3>What we collect</h3>
                <p className="course-count">
                    Name, surname, nickname, email, phone number, country, province,
                    date of birth, sex, and a profile photo if you add one, plus your
                    golf scores and activity from any accounts you connect
                    (handicaps.co.za, Strava, Garmin, teesheet.co.za).
                </p>

                <h3>Why</h3>
                <p className="course-count">
                    To run your account, show your rounds and stats, and share them
                    with friends you add on GolfCircle. We don't sell your data.
                </p>

                <h3>Marketing</h3>
                <p className="course-count">
                    Newsletter and sponsor-promotion emails are opt-in only — you'll
                    only get them if you tick those boxes at signup, and you can
                    change your mind any time in Settings.
                </p>

                <h3>Your rights</h3>
                <p className="course-count">
                    Under POPIA you can ask to see, correct, or delete your personal
                    information at any time.
                </p>
            </div>
        </div>
    );
}

export default TermsPage;
