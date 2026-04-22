import { Hono } from "hono";
import { setCookie, getCookie, deleteCookie } from "hono/cookie";
import type { AppContext } from "../env";

const SCOPES = [
  "user-read-private",
  "user-read-email",
  "streaming",
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
  "playlist-read-private",
].join(" ");

export const spotifyRoutes = new Hono<AppContext>();

// Start OAuth — redirects user to Spotify authorize screen.
// Open this in a popup from the client.
spotifyRoutes.get("/login", (c) => {
  const state = crypto.randomUUID();
  setCookie(c, "spotify_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    maxAge: 600,
    path: "/",
  });

  const params = new URLSearchParams({
    client_id: c.env.SPOTIFY_CLIENT_ID,
    response_type: "code",
    redirect_uri: `${c.env.PUBLIC_APP_URL}/auth/spotify/callback`,
    scope: SCOPES,
    state,
    show_dialog: "false",
  });

  return c.redirect(`https://accounts.spotify.com/authorize?${params}`);
});

// OAuth callback — exchanges code for tokens, postMessages back to opener.
spotifyRoutes.get("/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const storedState = getCookie(c, "spotify_oauth_state");

  if (!code || !state || state !== storedState) {
    return c.html(
      "<h1>Spotify auth failed</h1><p>State mismatch. Close this window and try again.</p>",
      400,
    );
  }
  deleteCookie(c, "spotify_oauth_state", { path: "/" });

  const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${c.env.SPOTIFY_CLIENT_ID}:${c.env.SPOTIFY_CLIENT_SECRET}`)}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${c.env.PUBLIC_APP_URL}/auth/spotify/callback`,
    }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    return c.html(`<h1>Token exchange failed</h1><pre>${text}</pre>`, 500);
  }

  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
    scope: string;
  };

  const payload = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    scope: tokens.scope,
  };

  return c.html(
    `<!doctype html><html><body style="font-family:Tahoma,sans-serif;padding:24px">
      <h1>✅ Signed in to Spotify</h1>
      <p>You can close this window.</p>
      <script>
        const payload = ${JSON.stringify(payload)};
        if (window.opener) {
          window.opener.postMessage({ type: "spotify:tokens", payload }, "*");
          setTimeout(() => window.close(), 500);
        }
      </script>
    </body></html>`,
  );
});

// Refresh an expired access token. Client calls this from the browser.
spotifyRoutes.post("/refresh", async (c) => {
  const body = await c.req.json<{ refreshToken: string }>().catch(() => null);
  if (!body?.refreshToken) return c.json({ error: "missing_refresh_token" }, 400);

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${c.env.SPOTIFY_CLIENT_ID}:${c.env.SPOTIFY_CLIENT_SECRET}`)}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: body.refreshToken,
    }),
  });

  if (!res.ok) return c.json({ error: "refresh_failed" }, 500);
  const tokens = (await res.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  };
  return c.json({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? body.refreshToken,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  });
});
