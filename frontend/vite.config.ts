import { defineConfig } from "vite";

// Two production domains share this one build: slogs.co.za/handicap (the
// original, base "/handicap/") and golfcircle.me at its root (base "/").
// Both env vars default to the existing slogs.co.za behavior so the plain
// `npm run build` command is unchanged -- only the new `build:golfcircle`
// script (see package.json) overrides them.
const basePath = process.env.VITE_BASE_PATH || "/handicap/";
const outDir = process.env.VITE_OUT_DIR || "dist";

export default defineConfig(({ command }) => ({
    base: command === "build" ? basePath : "/",
    build: { outDir },
}));
