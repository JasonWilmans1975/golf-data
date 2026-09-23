function BrandLogo() {
    return (
        <div className="brand-kicker brand-logo">
            <img
                src={`${import.meta.env.BASE_URL}logo-icon-white.png`}
                alt=""
                className="brand-logo-icon"
            />
            <span>GOLFCIRCLE</span>
        </div>
    );
}

export default BrandLogo;
