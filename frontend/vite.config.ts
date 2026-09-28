import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
    base: "/",
    plugins: [
        VitePWA({
            registerType: "autoUpdate",
            includeAssets: ["favicon.svg", "logo-full.png"],
            manifest: {
                name: "GolfCircle",
                short_name: "GolfCircle",
                description: "Track your rounds, handicap, and your friends' golf.",
                start_url: "/",
                scope: "/",
                display: "standalone",
                background_color: "#0877ff",
                theme_color: "#0877ff",
                icons: [
                    { src: "icon-192.png", sizes: "192x192", type: "image/png" },
                    { src: "icon-512.png", sizes: "512x512", type: "image/png" },
                    { src: "icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
                ],
            },
            workbox: {
                // Only ever precache/serve this app's own built static assets.
                // API calls go to a different origin (api.slogs.co.za), so the
                // service worker never intercepts or caches them -- rounds,
                // friends, feed etc. always come straight from the network,
                // never a stale cached copy.
                globPatterns: ["**/*.{js,css,html,svg,png,ico}"],
            },
        }),
    ],
});
