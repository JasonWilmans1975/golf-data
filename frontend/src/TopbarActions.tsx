import { useState, type ReactNode } from "react";

function TopbarActions({ children }: { children: ReactNode }) {
    const [open, setOpen] = useState(false);

    return (
        <div className="topbar-actions-wrapper">
            <button
                className="hamburger-button"
                aria-label="Menu"
                aria-expanded={open}
                onClick={() => setOpen((prev) => !prev)}
            >
                <span />
                <span />
                <span />
            </button>

            <div
                className={`topbar-actions${open ? " open" : ""}`}
                onClick={() => setOpen(false)}
            >
                {children}
            </div>
        </div>
    );
}

export default TopbarActions;
