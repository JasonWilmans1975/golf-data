import { useTheme } from "./useTheme";

function ThemeToggle() {
    const { theme, toggleTheme } = useTheme();
    const isDark = theme === "dark";

    return (
        <label className="theme-switch">
            <input
                type="checkbox"
                checked={isDark}
                onChange={toggleTheme}
                aria-label="Toggle dark mode"
            />
            <span className="theme-switch-track">
                <span className="theme-switch-thumb" />
            </span>
            <span className="theme-switch-label">{isDark ? "Dark" : "Light"}</span>
        </label>
    );
}

export default ThemeToggle;
