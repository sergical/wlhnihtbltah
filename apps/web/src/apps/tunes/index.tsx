// XP Tunes — Headspace skin. A three-panel faux-3D media player styled after
// the iconic WMP "Headspace" skin (2000, Samuel Blanchard).
// Left: equalizer w/ 10 bands + balance/volume
// Center: alien head with transport buttons + LCD visualizer + scrubber
// Right: playlist
import { useEffect, useRef, useState } from "react";
import "./tunes.css";

type SpotifyTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

type Track = {
  id: string;
  name: string;
  artist: string;
  durationMs: number;
  album: string;
  albumArt: string;
  uri: string;
};

type Playlist = {
  id: string;
  name: string;
  tracks: number;
};

const TOKEN_KEY = "xp-tunes-spotify-tokens";
const PROFILE_CACHE_KEY = "xp-tunes-profile";
const PLAYLISTS_CACHE_KEY = "xp-tunes-playlists";

function loadTokens(): SpotifyTokens | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw) as SpotifyTokens;
    if (t.expiresAt < Date.now() - 30_000) return null;
    return t;
  } catch {
    return null;
  }
}
function saveTokens(t: SpotifyTokens) {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(t));
}
function clearTokens() {
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(PROFILE_CACHE_KEY);
  sessionStorage.removeItem(PLAYLISTS_CACHE_KEY);
}

/**
 * Fetch wrapper that honours Spotify's 429 retry-after and caches GETs in
 * sessionStorage so remounting windows doesn't re-hit the API.
 */
async function spFetch(
  url: string,
  token: string,
  opts: { cacheKey?: string; cacheMs?: number } = {},
): Promise<any> {
  if (opts.cacheKey) {
    const cached = sessionStorage.getItem(opts.cacheKey);
    if (cached) {
      try {
        const { t, v } = JSON.parse(cached);
        if (Date.now() - t < (opts.cacheMs ?? 60_000)) return v;
      } catch {}
    }
  }
  let attempt = 0;
  while (attempt < 4) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after") ?? 2);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      attempt++;
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const json = await res.json();
    if (opts.cacheKey) {
      sessionStorage.setItem(
        opts.cacheKey,
        JSON.stringify({ t: Date.now(), v: json }),
      );
    }
    return json;
  }
  throw new Error("rate-limited");
}

export function TunesApp() {
  const [tokens, setTokens] = useState<SpotifyTokens | null>(() => loadTokens());
  const [profile, setProfile] = useState<{ display_name: string } | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);
  const [playlistTracks, setPlaylistTracks] = useState<Track[]>([]);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [position, setPosition] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(70);
  const [visualizerPlaybackId, setVisualizerPlaybackId] = useState<string | null>(null);
  const [rateLimitMsg, setRateLimitMsg] = useState<string | null>(null);
  const loadedOnce = useRef(false);

  // OAuth popup handler
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === "spotify:tokens") {
        saveTokens(e.data.payload);
        setTokens(e.data.payload);
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  function connect() {
    window.open("/auth/spotify/login", "spotify-oauth", "width=520,height=720");
  }
  function disconnect() {
    clearTokens();
    setTokens(null);
    setProfile(null);
    setPlaylists([]);
    setCurrentTrack(null);
  }

  // Fetch profile + playlists once per token
  useEffect(() => {
    if (!tokens || loadedOnce.current) return;
    loadedOnce.current = true;
    (async () => {
      try {
        const me = await spFetch("https://api.spotify.com/v1/me", tokens.accessToken, {
          cacheKey: PROFILE_CACHE_KEY,
          cacheMs: 5 * 60_000,
        });
        setProfile(me);
        const pls = await spFetch(
          "https://api.spotify.com/v1/me/playlists?limit=30",
          tokens.accessToken,
          { cacheKey: PLAYLISTS_CACHE_KEY, cacheMs: 2 * 60_000 },
        );
        setPlaylists(
          (pls?.items ?? []).map((p: any) => ({
            id: p.id,
            name: p.name ?? "(untitled)",
            tracks: p.tracks?.total ?? 0,
          })),
        );
      } catch (err) {
        console.error("spotify load failed", err);
        setRateLimitMsg(String(err));
      }
    })();
  }, [tokens]);

  // Fetch tracks when playlist selected
  useEffect(() => {
    if (!tokens || !selectedPlaylist) return;
    (async () => {
      try {
        const d = await spFetch(
          `https://api.spotify.com/v1/playlists/${selectedPlaylist.id}/tracks?limit=50&fields=items(track(id,name,duration_ms,album(name,images),artists(name),uri))`,
          tokens.accessToken,
          { cacheKey: `playlist-${selectedPlaylist.id}`, cacheMs: 60_000 },
        );
        const tracks: Track[] = (d?.items ?? [])
          .map((i: any) => i.track)
          .filter(Boolean)
          .map((t: any) => ({
            id: t.id,
            name: t.name,
            artist: (t.artists ?? []).map((a: any) => a.name).join(", "),
            durationMs: t.duration_ms,
            album: t.album?.name ?? "",
            albumArt: t.album?.images?.[0]?.url ?? "",
            uri: t.uri,
          }));
        setPlaylistTracks(tracks);
      } catch (err) {
        console.error("playlist load failed", err);
      }
    })();
  }, [tokens, selectedPlaylist]);

  // Web Playback SDK
  const [deviceId, setDeviceId] = useState<string | null>(null);
  useEffect(() => {
    if (!tokens) return;
    if (!document.querySelector("script[data-spotify-sdk]")) {
      const s = document.createElement("script");
      s.src = "https://sdk.scdn.co/spotify-player.js";
      s.async = true;
      s.setAttribute("data-spotify-sdk", "1");
      document.body.appendChild(s);
    }
    (window as any).onSpotifyWebPlaybackSDKReady = () => {
      const player = new (window as any).Spotify.Player({
        name: "XP Tunes",
        getOAuthToken: (cb: (t: string) => void) => cb(tokens.accessToken),
        volume: volume / 100,
      });
      player.addListener("ready", ({ device_id }: any) => setDeviceId(device_id));
      player.addListener("player_state_changed", (state: any) => {
        if (!state) return;
        setIsPlaying(!state.paused);
        setPosition(state.position);
        const t = state.track_window?.current_track;
        if (t) {
          setCurrentTrack({
            id: t.id,
            name: t.name,
            artist: (t.artists ?? []).map((a: any) => a.name).join(", "),
            durationMs: t.duration_ms,
            album: t.album?.name ?? "",
            albumArt: t.album?.images?.[0]?.url ?? "",
            uri: t.uri,
          });
        }
      });
      player.connect();
      (window as any).__xpTunesPlayer = player;
    };
    if ((window as any).Spotify && (window as any).onSpotifyWebPlaybackSDKReady) {
      (window as any).onSpotifyWebPlaybackSDKReady();
    }
  }, [tokens]);

  // Position ticker while playing
  useEffect(() => {
    if (!isPlaying) return;
    const t = setInterval(() => setPosition((p) => p + 1000), 1000);
    return () => clearInterval(t);
  }, [isPlaying]);

  async function control(method: "PUT" | "POST", path: string, body?: any) {
    if (!tokens) return;
    try {
      await fetch(`https://api.spotify.com/v1/me/player${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      console.warn("spotify control failed", err);
    }
  }
  const play = (uri?: string) =>
    control("PUT", `/play${deviceId ? `?device_id=${deviceId}` : ""}`, uri ? { uris: [uri] } : undefined);
  const pause = () => control("PUT", "/pause");
  const next = () => control("POST", "/next");
  const prev = () => control("POST", "/previous");

  // Ask worker for a Mux visualizer (cached)
  useEffect(() => {
    if (!currentTrack) return;
    fetch(`/api/mux/visualizer?trackId=${currentTrack.id}&mood=dreamy`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setVisualizerPlaybackId(d?.playbackId ?? null))
      .catch(() => setVisualizerPlaybackId(null));
  }, [currentTrack]);

  return (
    <div className="hs">
      <HsMenuBar onDisconnect={disconnect} connected={!!tokens} />

      {rateLimitMsg && (
        <div className="hs-banner">⚠ Spotify API hiccup: {rateLimitMsg}</div>
      )}

      <div className="hs-body">
        {/* LEFT PANEL — equalizer */}
        <div className="hs-panel hs-eq-panel">
          <div className="hs-panel-close">×</div>
          <div className="hs-eq-top">
            <div>
              <div className="hs-eq-label">Balance</div>
              <div className="hs-slider-h"><div className="hs-slider-thumb" style={{ left: "50%" }} /></div>
            </div>
            <div>
              <div className="hs-eq-label">Volume</div>
              <div className="hs-slider-h">
                <div
                  className="hs-slider-thumb"
                  style={{ left: `${volume}%` }}
                  onMouseDown={(e) => {
                    const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
                    const onMove = (ev: MouseEvent) => {
                      const v = Math.max(0, Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100));
                      setVolume(v);
                      (window as any).__xpTunesPlayer?.setVolume?.(v / 100);
                    };
                    const onUp = () => {
                      window.removeEventListener("mousemove", onMove);
                      window.removeEventListener("mouseup", onUp);
                    };
                    window.addEventListener("mousemove", onMove);
                    window.addEventListener("mouseup", onUp);
                  }}
                />
              </div>
            </div>
          </div>

          <div className="hs-eq-bands">
            {[32, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000].map((hz, i) => (
              <div key={hz} className="hs-eq-band">
                <div className="hs-eq-track">
                  <div
                    className="hs-eq-thumb"
                    style={{
                      top: `${20 + Math.sin((i + (isPlaying ? Date.now() / 400 : 0)) * 0.8) * 20 + 25}%`,
                    }}
                  />
                </div>
                <div className="hs-eq-hz">{hz >= 1000 ? `${hz / 1000}K` : hz}</div>
              </div>
            ))}
          </div>

          <div className="hs-eq-reset">reset</div>

          <div className="hs-speakers">
            <div className="hs-speaker"><div className="hs-speaker-inner" /></div>
            <div className="hs-speaker"><div className="hs-speaker-inner" /></div>
            <div className="hs-speaker"><div className="hs-speaker-inner" /></div>
          </div>
        </div>

        {/* CENTER — the head */}
        <HeadspaceHead
          visualizerPlaybackId={visualizerPlaybackId}
          albumArt={currentTrack?.albumArt}
          isPlaying={isPlaying}
          onPlay={() => play()}
          onPause={pause}
          onPrev={prev}
          onNext={next}
          position={position}
          duration={currentTrack?.durationMs ?? 0}
          connected={!!tokens}
          onConnect={connect}
        />

        {/* RIGHT PANEL — playlist */}
        <div className="hs-panel hs-pl-panel">
          <div className="hs-panel-close hs-right-close">×</div>
          <div className="hs-pl-header">
            <span className="hs-pl-disc">💿</span>
            <span className="hs-pl-title">
              {selectedPlaylist?.name ?? (profile?.display_name ? `${profile.display_name}'s Music` : "Your Music")}
            </span>
            <span className="hs-pl-dropdown">▾</span>
          </div>

          {!tokens ? (
            <div className="hs-pl-empty">not connected</div>
          ) : !selectedPlaylist ? (
            <ul className="hs-pl-list">
              {playlists.length === 0 && <li className="hs-pl-loading">loading…</li>}
              {playlists.map((p) => (
                <li key={p.id} onDoubleClick={() => setSelectedPlaylist(p)}>
                  <span className="hs-pl-name">{p.name}</span>
                  <span className="hs-pl-count">({p.tracks})</span>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="hs-pl-list">
              <li
                className="hs-pl-back"
                onClick={() => {
                  setSelectedPlaylist(null);
                  setPlaylistTracks([]);
                }}
              >
                ← back to playlists
              </li>
              {playlistTracks.map((t) => (
                <li
                  key={t.id}
                  className={currentTrack?.id === t.id ? "hs-pl-active" : ""}
                  onDoubleClick={() => play(t.uri)}
                >
                  <span className="hs-pl-name">{t.name}</span>
                  <span className="hs-pl-count">{fmtDur(t.durationMs)}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="hs-speakers hs-speakers-right">
            <div className="hs-speaker"><div className="hs-speaker-inner" /></div>
            <div className="hs-speaker"><div className="hs-speaker-inner" /></div>
            <div className="hs-speaker"><div className="hs-speaker-inner" /></div>
          </div>
        </div>
      </div>

      <div className="hs-status">
        <span>{tokens ? `Signed in as ${profile?.display_name ?? "..."}` : "Not connected"}</span>
        <span>·</span>
        <span>Skin: Headspace</span>
        {currentTrack && (
          <>
            <span>·</span>
            <span>♪ {currentTrack.name} — {currentTrack.artist}</span>
          </>
        )}
      </div>
    </div>
  );
}

function HsMenuBar({ connected, onDisconnect }: { connected: boolean; onDisconnect: () => void }) {
  return (
    <div className="hs-menubar">
      <span>File</span>
      <span>View</span>
      <span>Play</span>
      <span>Tools</span>
      <div className="hs-menubar-spacer" />
      {connected && (
        <span className="hs-menubar-link" onClick={onDisconnect}>Sign out</span>
      )}
    </div>
  );
}

function HeadspaceHead({
  visualizerPlaybackId,
  albumArt,
  isPlaying,
  onPlay,
  onPause,
  onPrev,
  onNext,
  position,
  duration,
  connected,
  onConnect,
}: {
  visualizerPlaybackId: string | null;
  albumArt?: string;
  isPlaying: boolean;
  onPlay: () => void;
  onPause: () => void;
  onPrev: () => void;
  onNext: () => void;
  position: number;
  duration: number;
  connected: boolean;
  onConnect: () => void;
}) {
  const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;

  return (
    <div className="hs-head-wrap">
      {/* The head shape (SVG) */}
      <svg className="hs-head-svg" viewBox="0 0 400 580" preserveAspectRatio="none">
        <defs>
          <radialGradient id="hsHeadGrad" cx="50%" cy="45%" r="60%">
            <stop offset="0" stopColor="#c0e860" />
            <stop offset="0.5" stopColor="#7cbe35" />
            <stop offset="1" stopColor="#3d6618" />
          </radialGradient>
          <radialGradient id="hsHeadHighlight" cx="30%" cy="25%" r="40%">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.4" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* Head blob */}
        <path
          d="M 50 170
             Q 40 80 200 60
             Q 360 80 350 170
             L 350 380
             Q 350 500 200 530
             Q 50 500 50 380
             Z"
          fill="url(#hsHeadGrad)"
          stroke="#1f3a0a"
          strokeWidth="2"
        />
        {/* Highlight */}
        <ellipse cx="150" cy="140" rx="80" ry="30" fill="url(#hsHeadHighlight)" />

        {/* Closed eyes */}
        <path d="M 130 430 Q 160 440 190 430" stroke="#1f3a0a" strokeWidth="3" fill="none" strokeLinecap="round" />
        <path d="M 210 430 Q 240 440 270 430" stroke="#1f3a0a" strokeWidth="3" fill="none" strokeLinecap="round" />
        {/* Nose shadow */}
        <path d="M 200 440 Q 205 470 200 490" stroke="#1f3a0a" strokeWidth="1.5" fill="none" opacity="0.5" />
        {/* Mouth */}
        <path d="M 175 500 Q 200 510 225 500" stroke="#1f3a0a" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      </svg>

      {/* Transport buttons on top of head */}
      <div className="hs-transport-bar">
        <button type="button" className="hs-t-btn" onClick={onPrev} title="Previous">⏮</button>
        <button
          type="button"
          className="hs-t-btn"
          onClick={isPlaying ? onPause : onPlay}
          title={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? "⏸" : "▶"}
        </button>
        <button type="button" className="hs-t-btn" onClick={onPause} title="Stop">⏹</button>
        <button type="button" className="hs-t-btn" onClick={onNext} title="Next">⏭</button>
        <button type="button" className="hs-t-btn hs-t-btn-accent" title="Visualizer">✱</button>
      </div>

      {/* LCD screen */}
      <div className="hs-lcd">
        {visualizerPlaybackId ? (
          <video
            key={visualizerPlaybackId}
            autoPlay
            muted
            loop
            playsInline
            src={`https://stream.mux.com/${visualizerPlaybackId}/low.mp4`}
            className="hs-lcd-video"
          />
        ) : albumArt ? (
          <>
            <img src={albumArt} alt="" className="hs-lcd-albumart" />
            <PixelDust active={isPlaying} />
          </>
        ) : (
          <PixelDust active={isPlaying} />
        )}
        {!connected && (
          <div className="hs-lcd-connect">
            <div className="hs-lcd-connect-title">No Spotify</div>
            <button type="button" className="hs-lcd-connect-btn" onClick={onConnect}>
              Connect Spotify
            </button>
          </div>
        )}
      </div>

      {/* Scrubber */}
      <div className="hs-scrubber">
        <span className="hs-eq-mini">📊</span>
        <div className="hs-scrubber-track">
          <div className="hs-scrubber-fill" style={{ width: `${pct}%` }} />
          <div className="hs-scrubber-thumb" style={{ left: `${pct}%` }} />
        </div>
        <span className="hs-pl-mini">📄</span>
      </div>
    </div>
  );
}

function fmtDur(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// Pixel-dust visualizer fallback (canvas)
function PixelDust({ active }: { active: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    let raf = 0;
    const particles = Array.from({ length: 200 }, () => ({
      x: Math.random(),
      y: Math.random(),
      vx: (Math.random() - 0.5) * 0.003,
      vy: (Math.random() - 0.5) * 0.003,
      r: Math.floor(Math.random() * 255),
      g: Math.floor(Math.random() * 255),
      b: Math.floor(Math.random() * 255),
    }));
    const draw = () => {
      const c = ref.current;
      if (!c) {
        raf = requestAnimationFrame(draw);
        return;
      }
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "rgba(0,0,0,0.2)";
      ctx.fillRect(0, 0, c.width, c.height);
      for (const p of particles) {
        if (active) {
          p.x += p.vx;
          p.y += p.vy;
        }
        if (p.x < 0 || p.x > 1) p.vx = -p.vx;
        if (p.y < 0 || p.y > 1) p.vy = -p.vy;
        ctx.fillStyle = `rgb(${p.r},${p.g},${p.b})`;
        ctx.fillRect(p.x * c.width, p.y * c.height, 2, 2);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [active]);
  return <canvas ref={ref} width={320} height={220} className="hs-pixel-dust" />;
}
