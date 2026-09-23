import { useLocation, useNavigate } from "react-router-dom";
import type { ReactNode } from "react";

function NavButton({ to, children }: { to: string; children: ReactNode }) {
    const navigate = useNavigate();
    const location = useLocation();
    const isActive = location.pathname === to;

    return (
        <button
            className={`header-secondary-button${isActive ? " active" : ""}`}
            onClick={() => navigate(to)}
        >
            {children}
        </button>
    );
}

export default NavButton;
