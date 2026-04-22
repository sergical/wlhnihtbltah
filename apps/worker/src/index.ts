import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AppContext } from "./env";
import { spotifyRoutes } from "./routes/spotify";
import { muxRoutes } from "./routes/mux";
import { chatRoutes } from "./routes/chat";

const app = new Hono<AppContext>();

app.use("/api/*", cors({ origin: "*", credentials: true }));
app.use("/auth/*", cors({ origin: "*", credentials: true }));

// Spotify Web Playback SDK needs `autoplay` + `encrypted-media` permissions.
app.use("*", async (c, next) => {
  await next();
  c.header(
    "Permissions-Policy",
    "autoplay=*, encrypted-media=*, fullscreen=*, clipboard-write=*",
  );
});

app.get("/api/health", (c) =>
  c.json({ ok: true, service: "wlhnihtbltah", ts: Date.now() }),
);

app.route("/auth/spotify", spotifyRoutes);
app.route("/api/mux", muxRoutes);
app.route("/api/chat", chatRoutes);

// Fall through to static assets (Vite SPA build) for everything else.
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
