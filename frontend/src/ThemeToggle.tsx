import { useTheme } from "./useTheme";

function ThemeToggle() {
    const { theme, toggleTheme } = useTheme();

    return (
        <button className="header-secondary-button" onClick={toggleTheme}>
            {theme === "dark" ? "Light Mode" : "Dark Mode"}
        </button>
    );
}

export default ThemeToggle;
