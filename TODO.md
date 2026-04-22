# WLHNIHTBLTAH Hackathon — Y2K XP Desktop

> 6 hours. Hack 10:00 → submit 2:00 PM. Wynwood, Miami. Solo.
> **LIVE:** https://wlhnihtbltah.s-a62.workers.dev

## 🎯 Concept

A **Windows XP desktop** in the browser hosting two apps:

1. **XP Tunes** — Spotify-powered music player wearing the iconic **Headspace** WMP skin (green alien head). Mux Player streams a visualizer clip in the forehead LCD, synced to the current track's mood. **Mux Robots ingested a single YouTube compilation of real WMP visualizers and auto-built our entire segmented, mood-tagged visualizer library** — no manual editing.
2. **XP Messenger** — MSN Messenger clone. Buddy list = 6 Anthropic-powered AI agents with distinct personalities (SmarterChild, xX_DarkAngel_Xx, DJ Retro, Tech Support Tom, Crush, Mom). **Agents have a `watchVideo` tool powered by Mux Robots** — paste any video URL and the agent actually analyzes it (summarize, ask-questions, find-key-moments) and replies like it watched it.

Shell: boot splash, login, Bliss wallpaper, Start menu, taskbar, system tray, draggable/minimizable/resizable windows. All in XP.css + a DIY window manager.

---

## 🏆 Prize Targeting

| Prize | Strategy |
|---|---|
| 🥇 Podium (Cloudflare $2k + 25k credits) | Whole thing on Workers + Durable Objects + KV + Assets. |
| 🧥 Mux + AI Varsity Jacket | MSN agents call Mux Robots as tools (summarize/ask-questions/key-moments) to "watch" videos you paste. Novel, narrative-rich, real integration. |
| 🎁 Jazz.tools swag | Jazz is the ONLY database. CoMaps/CoLists back all state (auth, buddies, conversations, messages, player state). |
| 🏎️ Realtime Sync Lego | Jazz is local-first CRDT → open two tabs, everything syncs instantly. Demo: typing indicators + streaming Claude tokens appearing in both windows token-by-token via shared CoList. |

**Not targeting:** Neon (no Postgres needed), Convex (Jazz covers realtime), winxp fork (DIY with XP.css).

---

## 🧱 Stack (all latest versions, verify at scaffold time)

| Layer | Choice |
|---|---|
| Frontend | Vite + React 18 + TypeScript |
| XP chrome | [XP.css](https://botoxparty.github.io/XP.css/) |
| Drag/resize | `react-rnd` |
| Window manager | Zustand store, ~200 LOC, DIY |
| Data + realtime + auth | **Jazz.tools** (`jazz-tools`, `jazz-react`) with `PasswordAuth` |
| Backend | Hono on Cloudflare Workers |
| Durable Objects | One per AI agent, hosts a Jazz client logged in as that agent; reacts to new user messages, streams Claude → CoList |
| KV | Cache `spotify_track_id → mux_playback_id` lookups |
| AI | `@ai-sdk/anthropic` + `streamText` — Claude Sonnet 4.5 |
| Music audio | Spotify Web API + Web Playback SDK (OAuth 2.0 + PKCE; Premium confirmed) |
| Music video | `@mux/mux-player-react` for playback |
| Mux AI | Mux Robots API (`/robots/v0/jobs/...`) |
| Mux SDK | `@mux/mux-node` server-side |
| Hosting | `wrangler deploy`, Worker Assets binding serves Vite `dist/` |

---

## 📚 Key Research Notes

### Jazz.tools
- **Schema in code** — CoValues are defined as classes in TS. Shared between client and server-worker.
- **Auth** — `PasswordAuth` from `jazz-tools`: simple username + password, no email. Stored in Jazz Account.
- **Sync server** — use hosted `wss://cloud.jazz.tools/?key=<app-key>` (free tier, no infra).
- **Local-first** — writes are instant, sync happens in background. This is why it wins realtime.
- **Server Workers** — Jazz has `jazz-nodejs` for long-lived server accounts. On Cloudflare we run them inside a Durable Object so the WebSocket to Jazz cloud stays alive per agent.
- **Schema sketch:**
  ```ts
  class Message extends CoMap {
    role = co.literal("user", "assistant");
    content = co.string;
    createdAt = co.number;
    videoJobs = co.optional.ref(VideoJobList); // Mux Robots results
  }
  class Conversation extends CoMap {
    agentId = co.string;
    title = co.string;
    messages = co.ref(MessageList);
    typing = co.ref(TypingFeed);
  }
  class BuddyListItem extends CoMap { agentId = co.string; lastSeen = co.number; }
  class UserRoot extends CoMap {
    conversations = co.ref(ConversationList);
    buddies = co.ref(BuddyListOfItems);
    player = co.ref(PlayerState);
    spotifyLink = co.optional.ref(SpotifyLink);
  }
  class PlayerState extends CoMap {
    currentTrackId = co.string;
    isPlaying = co.boolean;
    muxPlaybackId = co.optional.string;
    dominantColor = co.optional.string;
  }
  ```

### Cloudflare Workers
- `wrangler.toml` with `compatibility_flags = ["nodejs_compat"]` for AI SDK + Mux SDK.
- DO bindings: `AGENT` (per-agent presence). Use `idFromName(agentId)`.
- Assets binding points at `../web/dist`.
- Secrets: `ANTHROPIC_API_KEY`, `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `JAZZ_AGENT_ACCOUNT_SECRETS` (JSON blob with per-agent creds).

### Anthropic via AI SDK
- `streamText({ model: anthropic('claude-sonnet-4-5'), system, messages, tools })`.
- **Tool definitions for agents:**
  - `watchVideo({ url })` → uploads to Mux, polls until ready, calls Mux Robots `summarize` + `ask-questions`, returns structured JSON.
  - `findKeyMoments({ muxAssetId })` → optional follow-up tool.
- Stream tokens to the Jazz Message CoMap as `content` appends → clients see live typing via Jazz sync.

### Spotify
- OAuth 2.0 PKCE flow — popup, code → Worker exchanges for tokens → tokens stored in user's Jazz `SpotifyLink` CoMap (encrypted by Jazz per-account).
- Scopes: `user-read-private user-read-email streaming user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private`.
- Web Playback SDK → audio device in browser. Premium required (we have it).
- On track change → emit to Jazz `PlayerState.currentTrackId` → triggers Mux lookup.

### Mux
- `@mux/mux-player-react` for UI — drop-in `<MuxPlayer playbackId streamType="on-demand" autoPlay muted />`.
- Server helpers (`apps/worker/src/mux.ts`):
  - `getOrCreateVisualizerFor(trackId, trackMeta)` → check KV → if missing, create asset from curated visualizer pool (15 pre-uploaded clips tagged by mood; Claude picks best match via a tiny classify call) → cache in KV.
  - `analyzeVideo(url)` → create asset from URL → poll until `ready` + storyboard + captions exist → run Mux Robots jobs → return results.
- **Mux Robots endpoints we'll use:**
  - `POST /robots/v0/jobs/summarize` → title, tags, description
  - `POST /robots/v0/jobs/ask-questions` → custom Q&A (Claude generates the questions)
  - `POST /robots/v0/jobs/find-key-moments` → timestamps + descriptions
  - `POST /robots/v0/jobs/generate-chapters` → chapter markers for WMP scrubber
- Create new API keys with Robots permission scope (existing keys don't have it — blog warned about this).
- Preview is **free through May 15, 2026** so we don't burn cash.

### XP Shell (DIY)
- Zustand `windowStore`:
  ```ts
  type WindowInstance = { id; appId; title; icon; x; y; w; h; minimized; maximized; zIndex; };
  actions: open, close, focus, minimize, restore, toggleMaximize, move, resize
  ```
- `<Desktop>` renders wallpaper + icon grid + mounted windows (sorted by zIndex) + `<Taskbar>`.
- `<Window>` wraps content in XP.css `.window` + title bar + `<Rnd>` for drag/resize. Clicking anywhere in window → `focus(id)` bumps zIndex.
- Taskbar buttons: clicking active window minimizes; clicking minimized window restores+focuses.
- Start menu: static app registry, click opens.
- Boot splash: 2s "Windows XP" logo with progress bar → login screen.
- Login: XP-style user tile, click → password field → `PasswordAuth` signup-or-login.
- System tray: live clock, volume icon, MSN icon (opens Messenger), speaker icon.
- Sounds: boot.wav, logon.wav, ding.wav, nudge.wav, error.wav (archive.org).

---

## 🗂️ Repo Layout

```
frontier-hackathon/
├── apps/
│   ├── web/                  # Vite + React SPA
│   │   ├── src/
│   │   │   ├── shell/        # Desktop, Window, Taskbar, StartMenu, BootSplash, LoginScreen
│   │   │   ├── apps/
│   │   │   │   ├── tunes/    # WMP skin, Spotify SDK, MuxPlayer slot
│   │   │   │   └── messenger/ # BuddyList, Conversation, NudgeButton
│   │   │   ├── schema/       # Jazz CoValue schemas (shared with worker)
│   │   │   ├── lib/          # spotify.ts, api.ts, sounds.ts
│   │   │   ├── store/        # window-store.ts
│   │   │   └── main.tsx
│   │   └── vite.config.ts
│   └── worker/               # Cloudflare Worker (Hono)
│       ├── src/
│       │   ├── index.ts      # Hono app + DO export
│       │   ├── durable/AgentPresence.ts   # Jazz client per agent
│       │   ├── routes/
│       │   │   ├── spotify.ts    # /auth/spotify/callback, /spotify/proxy
│       │   │   ├── mux.ts        # /mux/analyze, /mux/visualizer
│       │   │   └── chat.ts       # /chat/stream (Claude streamText → writes to Jazz)
│       │   ├── ai/tools.ts       # watchVideo, findKeyMoments
│       │   └── jazz-server.ts    # helpers to auth as agent accounts
│       └── wrangler.toml
├── packages/
│   └── schema/               # Shared Jazz CoValue definitions
├── assets/                   # boot.wav, logon.wav, ding.wav, cursors, wallpapers
└── TODO.md
```

---

## ⏱️ 6-Hour Timeline (Solo)

### T+0:00 → T+0:45 · Foundations
- [ ] `pnpm` monorepo, Vite + Hono scaffolds
- [ ] XP.css installed, Bliss wallpaper rendering at `/`
- [ ] `wrangler.toml` with Assets, DO, KV, all secrets wired
- [ ] Jazz account at cloud.jazz.tools, app key in env
- [ ] Mux account (Robots-scoped API keys), Spotify app registered, Anthropic key
- [ ] `wrangler deploy` a hello-world to confirm pipeline

### T+0:45 → T+1:45 · XP Shell
- [ ] Window manager store + `<Window>` + `<Desktop>` + `<Taskbar>` + `<StartMenu>`
- [ ] Boot splash → Login screen (username/password via Jazz PasswordAuth)
- [ ] Desktop icons (double-click opens app)
- [ ] System tray clock
- [ ] Sounds on boot/login/window actions

### T+1:45 → T+3:00 · XP Messenger (do this first — it's the hero)
- [ ] Jazz schema for Conversation/Message/TypingFeed
- [ ] Buddy list window, seeded with 6 agents (see roster below)
- [ ] Conversation window, message bubbles with MSN styling
- [ ] Worker route `/chat/stream`: receives user message → calls Claude with tools → streams tokens back by appending to Jazz Message content
- [ ] `watchVideo` tool wired to Mux asset create + Mux Robots summarize + ask-questions
- [ ] Typing indicator via CoFeed
- [ ] MSN ding on message receive, nudge button that shakes window

### T+3:00 → T+4:15 · XP Tunes
- [ ] WMP green skin shell (title bar, transport controls, equalizer sliders — visual only)
- [ ] Spotify OAuth PKCE
- [ ] Web Playback SDK init, play/pause/next/prev wired
- [ ] Playlist sidebar from `/v1/me/playlists`
- [ ] On `player_state_changed` → write to Jazz PlayerState
- [ ] Worker `/mux/visualizer?trackId=...` returns playback ID (curated pool lookup)
- [ ] `<MuxPlayer>` mounted in visualizer slot, muted, loops
- [ ] Bonus: Mux Robots chapters rendered as scrubber markers

### T+4:15 → T+5:00 · Realtime Moment + Polish
- [ ] Test two browsers: buddy list, chat messages, player state all sync via Jazz
- [ ] Pregenerate ~10 Mux visualizer assets for demo playlist
- [ ] Right-click desktop → Properties easter egg
- [ ] CRT scanline CSS toggle in Start menu
- [ ] Hover/click sounds on everything

### T+5:00 → T+5:30 · Deploy + Demo Rehearsal
- [ ] `wrangler deploy` final
- [ ] Test on another device / browser
- [ ] Record 90s backup demo video (in case wifi flakes during judging)
- [ ] README with one-liner, links, demo script

### T+5:30 → T+6:00 · Buffer
- [ ] Reserved for the inevitable thing that breaks at T+5:45

---

## 🎬 Demo Script (~2 min)

1. **Boot** → XP splash with progress bar, *Windows XP startup sound*, Bliss desktop appears.
2. **Login** → click user tile, enter password → *logon chime* → desktop icons animate in.
3. **Double-click XP Messenger** → buddy list pops up, 4 agents online.
4. Double-click **SmarterChild-2026** → MSN window opens.
5. Type: *"omg watch this video"* and paste a YouTube/MP4 link.
6. Agent replies (streaming Claude tokens in MSN font): *"one sec lemme watch... lol ok that chef at 2:14 is COOKED, also they forgot salt. 7/10"* — because it actually ran Mux Robots on it. Drop the link to Mux Robots results in the UI as a little "file attachment" for credibility.
7. **Open second browser window** side-by-side → login as same user → buddy list + chat history appear instantly. Send a nudge → both windows shake (Jazz realtime).
8. **Double-click XP Tunes** → log into Spotify → hit play on a playlist.
9. Song starts, WMP green skin lights up, **Mux visualizer plays in the screen**, chapter markers visible on scrubber.
10. Skip track → new visualizer swaps in instantly (pregenerated + KV cached).
11. **Back to window 2** → player state mirrored, same track showing → mic drop.
12. Closing line: *"All on Cloudflare Workers. Jazz.tools for every byte of state. Mux Robots analyzing videos inside an MSN window. No mocks."*

---

## 👥 Agent Roster (all 6)

| Handle | Vibe | System prompt seed |
|---|---|---|
| **SmarterChild** | Smug OG AIM bot back from the dead | Answers everything, reminds user it was the original chatbot before ChatGPT. |
| **xX_DarkAngel_Xx** | Emo/scene kid, MySpace top-8 energy | lowercase w/ aLt CaPs, Fall Out Boy lyrics, LiveJournal-brained. |
| **DJ Retro** | Music nerd, cross-integrates with XP Tunes | Reads currently-playing track from Jazz PlayerState, rates/recs songs, gatekeepy. |
| **Tech Support Tom** | Grumpy 2003 IT guy | ALL CAPS, condescending, "HAVE YOU TRIED TURNING IT OFF AND ON". |
| **Crush** | Flirty mysterious stranger | a/s/l vibes, :) ;), never reveals identity, cringe-adjacent. |
| **Mom** | Just discovered MSN | ❤️❤️❤️, asks if you've eaten, forwards chain letters (in-app). |

All share the same `watchVideo` / `findKeyMoments` Mux Robots tools; personality lives entirely in the system prompt.

## 🎨 Headspace Skin + Mux Robots Visualizer Pipeline

### The Skin

**Headspace** — iconic green alien head WMP skin (Samuel Blanchard, WMP 7 era, ~2000). Centerpiece of XP Tunes.

- Try to source the original PNG from old skin archives (`.wmz` files are just zipped bundles with PNGs inside). ~30 min budget.
- If unavailable, recreate in SVG/CSS. ~60–90 min.
- Layout: transparent head PNG over container, `<MuxPlayer>` absolutely positioned in the forehead LCD cutout with `object-fit: cover`, muted, autoplay, loop. Transport buttons on the head wired to Spotify SDK. Right-side playlist panel = floating XP.css window with track list.
- Skin tints dynamically to each segment's `dominantColor` (from Mux Robots) — subtle CSS filter on the PNG.

### The Visualizer Pipeline (THE Mux + AI hero)

**Source:** https://www.youtube.com/watch?v=ntyKbTLrfxE (real WMP visualizer compilation).

**One-shot script** `scripts/build-visualizer-library.ts` (run morning-of, ~10 min):

```
1. yt-dlp -f mp4 -o visualizers.mp4 <url>
2. mux.video.assets.create({ input: [{ url: <temp public URL of visualizers.mp4> }],
                             playback_policies: ['public'],
                             video_quality: 'basic' })
   → wait for status=ready + storyboard ready
3. POST /robots/v0/jobs/find-key-moments  { asset_id }
   → returns array of { timestamp, description } segment boundaries
4. For each segment [startSec, endSec]:
     POST /robots/v0/jobs/ask-questions { asset_id, questions: [
       "Which classic Windows Media Player visualizer does the segment from
        {startSec}s to {endSec}s most resemble? Options: Ambience, Alchemy,
        Bars and Waves, Battery, Plenoptic, Musical Colors, Spikes.",
       "Classify the mood of this segment in one word from: dreamy, hype,
        chill, dark, retro, psychedelic, neon, cosmic.",
       "What is the dominant hex color in this segment?"
     ]}
5. Write results to Jazz public CoMap `VisualizerLibrary`:
   { [id]: { name, startSec, endSec, mood, dominantColor } }
6. Also create Mux clips via POST /video/v1/assets/{ID}/clips for each segment
   so we have standalone playback IDs (cleaner than ?start=&end= query params).
```

**Runtime behavior:**
- On Spotify `player_state_changed` → write `currentTrackId` to Jazz PlayerState
- Worker handler picks up change → tiny Claude call: `classifyTrackMood(artist, title, genre[])` → returns one of the 8 mood tags
- Client reads `VisualizerLibrary`, picks best-matching segment, updates `PlayerState.muxPlaybackId` + `dominantColor`
- Mux Player in Headspace forehead loads new clip; skin re-tints
- Multi-tab sync happens automatically via Jazz — change track in tab A, visualizer + tint update in tab B

**Caveats to verify at scaffold time:**
- `find-key-moments` takes `storyboard` as input — should work on a silent video, storyboards are generated automatically. We'll adapt if caption track is required.
- Mux `clips` API may have eventual consistency — might need to poll until clip asset is `ready`.

**Fallbacks:**
- If Robots doesn't segment cleanly on the silent compilation → manually specify 8 timestamps (`0:00`, `1:15`, `2:30`...) and skip find-key-moments. Still use ask-questions for naming/mood/color.
- If Mux clip creation is flaky → use `<MuxPlayer startTime endTime>` on the parent asset.
- Worst case → use the compilation as one looping visualizer, skip the mood matching. Less impressive but ships.

## 📊 Live Status (updated as we go)

### Infra
- ✅ Cloudflare Worker deployed (`wlhnihtbltah` on `s-a62.workers.dev`)
- ✅ KV namespace `CACHE` provisioned + bound
- ✅ Secrets: Anthropic, Mux (Robots-scoped), Spotify, Jazz
- ✅ Worker Assets serves Vite SPA build
- ✅ Hono routing + SSE streaming
- 🟡 AI Gateway: **code ready, env var empty**. Create a gateway at dash.cloudflare.com > AI > AI Gateway, then set `AI_GATEWAY_ID = "<slug>"` in `wrangler.toml` and redeploy.

### XP Shell
- ✅ Boot splash → login screen → desktop
- ✅ Draggable/resizable/minimizable windows via react-rnd
- ✅ Taskbar with live clock, start menu, system tray
- ✅ Multiple windows open simultaneously (each app can spawn multiple instances)
- ✅ xp.css chrome
- ✅ Real Bliss wallpaper

### XP Messenger
- ✅ Authentic MSN 7.5-style buddy list UI (user panel, status dots, groups, footer with butterfly)
- ✅ Double-click a buddy → **new window** for that conversation (not modal)
- ✅ Conversation window: menubar, toolbar (Invite/Send Files/Voice/Video/Activities/Games), To: bar, chat area w/ display picture sidebar, formatting bar, send + textarea
- ✅ 6 AI agents (SmarterChild, xX_DarkAngel_Xx, DJ Retro, Tech Support Tom, Crush, Mom)
- ✅ Claude Sonnet 4.5 streaming via AI SDK
- ✅ Agents stay in character (short MSN-style lowercase w/ emoticons)
- ✅ Nudge button shakes the window
- ✅ `watchVideo` tool (Mux Robots) — **verified end-to-end in prod**
- ✅ Tool calls rendered as file-attachment cards in chat
- ❌ Jazz realtime sync (messages still in local state — next task)
- ❌ Typing indicator broadcast across tabs (needs Jazz CoFeed)
- ❌ Conversation history persisted (needs Jazz CoList)

### XP Tunes
- ✅ WMP chrome: menu bar, display area, transport, right-panel, status bar
- ✅ Skin Chooser → swap between Classic (blue) and Headspace (green)
- ✅ Spotify OAuth flow (popup → redirect → tokens into localStorage)
- ✅ Web Playback SDK init + play/pause/next/prev wired
- ✅ Playlists list → double-click for tracks → double-click to play
- ✅ Pixel-dust visualizer fallback when no Mux clip
- ✅ Mux video visualizer slot (reads `playbackId` from `/api/mux/visualizer`)
- ✅ Album-art blur fallback when no Mux clip + track has art
- ❌ Headspace **alien head** SVG overlay (current version is just a color wash)
- ❌ Mux visualizer library actually populated (`scripts/build-visualizer-library.ts` not written yet)
- ❌ Mux Robots chapter markers on scrubber
- ❌ Track-mood classification via Claude on play

### Mux + AI
- ✅ Mux asset creation route (`POST /api/mux/assets`)
- ✅ Mux Robots passthrough route (`POST /api/mux/robots/:job`)
- ✅ Mux Player React mounted in Tunes display area
- ✅ Generated subtitles auto-enabled on asset creation (so `find-key-moments` works)
- ✅ `pollJob` helper waits for `summarize` job to complete before returning to Claude
- 🟡 **Visualizer library still empty** — `/api/mux/visualizer` returns 503 until populated

### Jazz.tools
- ✅ `JazzReactProvider` wired with Passkey-less anonymous account
- ✅ Schema defined: `XPAccount / UserRoot / Conversation / Message / PlayerState / SpotifyLink`
- ✅ Login form writes username to Jazz Account root
- ❌ No app yet reads/writes CoValues beyond the login write
- ❌ Messenger not wired (biggest remaining task)
- ❌ PlayerState not shared across tabs

### Visualizer library
- 🟡 Plan: `yt-dlp https://www.youtube.com/watch?v=ntyKbTLrfxE` → upload to Mux → `find-key-moments` + `ask-questions` → store `{ mood, name, startSec, endSec, playbackId }` in KV
- ❌ Script not written yet
- ❌ Library not populated

## ✅ Decisions Locked

- ✅ Solo
- ✅ Premium Spotify
- ✅ `@ai-sdk/anthropic`, Claude Sonnet 4.5
- ✅ Jazz.tools only DB, PasswordAuth
- ✅ No Neon, no Convex, no winxp fork
- ✅ XP.css + DIY window manager (react-rnd)
- ✅ Cloudflare Workers + Durable Objects + KV
- ✅ Mux Robots as the "Mux + AI" hero, integrated via MSN agent tool calls
- ✅ Latest versions across the board

## ⚠️ Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Jazz server worker in Durable Object is finicky | Fallback: run Claude tool-call loop in plain Worker fetch handler, write result to Jazz from client after receiving. Still realtime via Jazz, just no per-agent "presence." |
| Mux asset ingestion for arbitrary URLs is slow (can take 30s+) | Pregenerate for demo playlist; show "robot thinking" loader in MSN for live demos |
| Spotify Premium token expires mid-demo | Refresh token flow via Worker, test 5 min before going on stage |
| WiFi dies during demo | Pre-recorded 90s video backup |
| XP.css quirks on mobile/small screens | Force desktop viewport; judges will see on laptop |

## 📝 Open Questions

- ✅ All 6 agents locked
- ✅ `*.workers.dev`
- ✅ Butterchurn → Mux pipeline for visualizers (with CC0 fallback)
