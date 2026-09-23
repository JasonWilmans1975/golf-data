function BrandLogo() {
    return (
        <div className="brand-kicker brand-logo">
            <svg
                width="16"
                height="16"
                viewBox="0 0 64 64"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="brand-logo-icon"
                aria-hidden="true"
            >
                <path d="M48 15a23 23 0 1 0 5 30V33H35" strokeWidth="7" />
                <circle cx="31.5" cy="24" r="5" fill="currentColor" stroke="none" />
                <path d="M21 43c2-7 7-11 10.5-11S40 36 42 43" strokeWidth="6" />
            </svg>
            <span>
                GOLF<span className="brand-logo-accent">CIRCLE</span>
            </span>
        </div>
    );
}

export default BrandLogo;
