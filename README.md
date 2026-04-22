# WLHNIHTBLTAH — Windows XP as a Web OS

> **"We Literally Have No Idea How To Build Like This Anymore"** hackathon submission
> Frontier Tech Week · Miami · April 22 2026

**Live:** https://wlhnihtbltah.s-a62.workers.dev

A Windows XP desktop recreated in the browser, hosting two Y2K apps powered by modern AI infrastructure:

- **XP Tunes** — Spotify client wearing the iconic Windows Media Player **Headspace** skin (the green alien head), with visualizer video streamed via Mux.
- **XP Messenger** — MSN Messenger clone where your buddy list is six Anthropic-powered AI agents, each with a distinct personality, who can **actually watch videos you send them** via Mux Robots.

Boots to the real XP sound. Real Bliss wallpaper. Real draggable/resizable windows. Fake dial-up not included.

---

## 🏆 How we hit the prize categories

### 🥇 Cloudflare Podium — "Built on Cloudflare"

The entire stack runs on a **single Cloudflare Worker**:

- Hono router on Workers
- Static SPA served by the Worker's Assets binding (with `run_worker_first = true` so `/api/*` and `/auth/*` aren't shadowed by the SPA catch-all)
- KV namespace for the Spotify→Mux visualizer lookup cache
- **Cloudflare AI Gateway** routes every Claude call — observability, caching, failover — via the [`ai-gateway-provider`](https://www.npmjs.com/package/ai-gateway-provider) package wrapping Vercel's AI SDK
- One-shot deploy: `pnpm build && wrangler deploy`

```
┌──────────────── Cloudflare Worker ────────────────┐
│  Hono · run_worker_first = true                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐    │
│  │  /api/*  │  │ /auth/*  │  │   SPA fall-  │    │
│  │          │  │  spotify │  │   through    │    │
│  └────┬─────┘  └──────────┘  └──────┬───────┘    │
│       │                             │            │
│   AI Gateway         Assets binding │            │
│     ↓ Anthropic           ↓ (Vite-built React)   │
└───────┬───────────────────────────────────────────┘
        │
   ┌────┴────┐    ┌──────────┐    ┌────────────┐
   │  Claude │    │   Mux    │    │  Spotify   │
   │ Sonnet  │    │  Robots  │    │ Web API +  │
   │   4.5   │    │  + Video │    │  Playback  │
   └─────────┘    └──────────┘    └────────────┘
        │              │                  │
        └──────────────┴──────────────────┘
                       │
                   ┌───▼────┐
                   │  Jazz  │   ← realtime data layer, client-first CRDT
                   │ .tools │     (messages, conversations, player state)
                   └────────┘
```

### 🧥 Mux + AI Varsity Jacket — Mux Robots are the beating heart of the app

We use **three of the six Mux Robots workflows** in production:

| Workflow | Where | What it unlocks |
|---|---|---|
| `summarize` | Agent `watchVideo` tool + file-upload analyze | Structured title/description/tags Claude uses to react in-character |
| `find-key-moments` | Same | Timestamped highlights — agents say "at 2:14..." |
| `ask-questions` | Agent tool, when Claude needs specifics | Custom Q&A over video content |

**The killer moment:** paste any video URL or bare Mux playback ID into MSN → the agent calls `watchVideo` → we detect `stream.mux.com` URLs and skip re-ingestion (look up existing asset by playback ID instead) → Robots runs in parallel → Claude reacts.

**Also handled:**
- Direct upload from browser to Mux (bypasses Worker body limits)
- After upload, we explicitly call `generateSubtitles(audioTrackId)` so Robots has a transcript to work with — necessary because Upload settings don't support `generated_subtitles`
- Poll timeout scales with video duration (60s floor, 5 min cap for 23-min talks)

### 🎁 Jazz Tools — real-time, local-first data layer for the Messenger

No Postgres, no Redis, no Neon. **Jazz is the entire database.**

```ts
class Message extends CoMap {
  role: "user" | "assistant"
  content: string
  videoCard?: { muxPlaybackId, title, summary }
}
class Conversation extends CoMap {
  agentId: string
  messages: CoList<Message>
}
class UserRoot extends CoMap {
  username: string
  conversations: CoList<Conversation>
}
```

Every message and every conversation is a CoValue, owned by a Group owned by the user's Jazz account. Cross-tab sync works out of the box because Jazz streams CRDT deltas over WebSocket to `cloud.jazz.tools`. Authentication via `useDemoAuth` — different usernames create different accounts with fully isolated chat histories. We also wired `useSyncConnectionStatus` into the XP system tray (green dot = connected).

### 🏎️ F1 Ferrari — Best Realtime Sync

Open two browser tabs side by side as the same user → open MSN → send a message in tab A → **Claude's streaming response appears character-by-character in both tabs simultaneously**.

This works because we progressively write streaming tokens into the Jazz Message CoMap via `.$jazz.set("content", buf)` on every ~40ms flush. Jazz CRDTs handle the merge; every tab subscribed to that Message re-renders. No WebSockets in our app code, no re-fetch, no polling.

---

## 🎨 Design details that matter

- **XP shell is DIY**, not a package — we built the window manager, taskbar, start menu, and boot splash from scratch on top of [XP.css](https://botoxparty.github.io/XP.css/). ~300 LOC of Zustand + `react-rnd`.
- **Headspace skin is 100% SVG + CSS** — a recreation of Samuel Blanchard's iconic 2000 WMP skin: green alien head with closed eyes, transport buttons arranged across the dome, LCD screen in the forehead, speaker cones on flanking equalizer and playlist panels.
- **Six agents, six personalities**: SmarterChild (smug OG bot), xX_DarkAngel_Xx (emo), DJ Retro (music nerd), Tech Support Tom (ALL CAPS grumpy IT), Crush (a/s/l mystery flirt), Mom (too many emojis ❤️❤️❤️). Same `watchVideo` tool palette, wildly different reactions.
- **Authentic touches**: MSN buddy list with status dots, `To: <buddy@hotmail.com>` bar, Invite / Send Files / Voice / Video / Activities / Games toolbar, Font/Smileys/Wink/Nudge formatting bar, display picture sidebar, yellow "Never give out your password" warning system message, nudge-shakes-the-window animation.

---

## 🧱 Stack

| Layer | Tech |
|---|---|
| Runtime | Cloudflare Workers (`nodejs_compat`) |
| API routing | Hono 4 |
| AI | Claude Sonnet 4.5 via Vercel AI SDK + Cloudflare AI Gateway |
| Realtime DB + Auth | Jazz.tools (CoValues, DemoAuth, cloud.jazz.tools sync) |
| Video | Mux Node SDK + `@mux/mux-player-react` + Mux Robots |
| Music | Spotify Web API + Web Playback SDK (OAuth 2.0) |
| Frontend | Vite + React 19 + TypeScript |
| UI chrome | XP.css + react-rnd + hand-rolled SVG (Headspace skin) |
| Window state | Zustand |
| Caching | Cloudflare KV |
| Hosting | `wrangler deploy`, `*.workers.dev` |

---

## 🗂️ Repo layout

```
.
├── apps/
│   ├── web/                    # Vite + React SPA
│   │   ├── src/
│   │   │   ├── shell/          # Desktop, Window, Taskbar, StartMenu, BootSplash, LoginScreen
│   │   │   ├── apps/
│   │   │   │   ├── tunes/      # Headspace skin + Spotify + Mux visualizer
│   │   │   │   └── messenger/  # MSN clone + Jazz-backed messages + file upload
│   │   │   ├── store/          # windowStore (Zustand)
│   │   │   ├── schema.ts       # Jazz CoValue schemas
│   │   │   ├── App.tsx         # Jazz provider + phase machine
│   │   │   └── styles.css
│   │   └── public/assets/      # Bliss wallpaper, SVG icons, avatars
│   └── worker/                 # Cloudflare Worker (Hono)
│       ├── src/
│       │   ├── routes/
│       │   │   ├── spotify.ts  # OAuth login + callback + refresh
│       │   │   ├── mux.ts      # Direct upload, analyze, Robots passthrough
│       │   │   └── chat.ts     # Claude streaming SSE w/ tools
│       │   ├── ai/
│       │   │   ├── agents.ts   # 6 system-prompt personalities
│       │   │   └── tools.ts    # watchVideo (Mux Robots) + findKeyMoments
│       │   └── index.ts        # Hono app + Permissions-Policy middleware
│       └── wrangler.toml
└── TODO.md                     # Working notes + timeline (left intact)
```

---

## 🚀 Run it yourself

### Prerequisites
- Node 22+, pnpm 9+
- Cloudflare account (`wrangler login`)
- API keys: Anthropic, Mux (with **Robots scope**), Spotify (Premium for playback SDK), Jazz Cloud project

### 1. Install
```bash
pnpm install
```

### 2. Create secrets
```bash
cp .env.example apps/worker/.dev.vars
# Fill in the values
```

### 3. Create the KV namespace (first time)
```bash
cd apps/worker
npx wrangler kv namespace create CACHE
# paste the returned id into wrangler.toml [[kv_namespaces]] id
```

### 4. Register Spotify redirect URIs
In your Spotify app dashboard, add:
- `http://127.0.0.1:8787/auth/spotify/callback` (dev)
- `https://<your-subdomain>.workers.dev/auth/spotify/callback` (prod)

### 5. Local dev
Two terminals:
```bash
# Terminal 1 — worker
cd apps/worker && npx wrangler dev --port 8787

# Terminal 2 — web (rebuilds on save)
cd apps/web && npx vite build --watch
```
Visit `http://127.0.0.1:8787`.

### 6. Deploy
```bash
cd apps/worker
# One-time secret setup:
for s in ANTHROPIC_API_KEY MUX_TOKEN_ID MUX_TOKEN_SECRET SPOTIFY_CLIENT_ID SPOTIFY_CLIENT_SECRET JAZZ_API_KEY CF_AIG_TOKEN; do
  npx wrangler secret put $s
done
# Build + deploy:
cd ../.. && pnpm build && cd apps/worker && npx wrangler deploy
```

---

## 🎬 The 2-minute demo script

1. Boot splash + XP login screen → pick user tile → desktop comes up on Bliss wallpaper
2. Double-click **XP Messenger** → buddy list with 6 agents
3. Double-click **SmarterChild** → new window (each conversation is its own window)
4. Drag-drop `dave-kiss-talk.mp4` (23-min talk from Frontier Tech Week) onto the chat → progress bar shows *uploading to Mux → ingesting → captions → Robots analyzing* → video card appears with `<MuxPlayer>` → SmarterChild reacts in character referencing **actual content from the talk** via Mux Robots summarize
5. Copy the `.m3u8` URL from the video card → paste to **DJ Retro** in another MSN window → she rates it out of 10 in music-gatekeeper voice (Robots result cached, instant)
6. **Open a second tab**, log in as same user → open the SmarterChild chat → same history appears. Send a message in tab 1 → tokens stream in both tabs simultaneously (Jazz realtime sync)
7. **XP Tunes** → log in to Spotify → hit a playlist → song plays, Headspace alien head lights up, LCD shows visualizer
8. Drop line: *"Cloudflare Workers. Cloudflare AI Gateway. Mux Robots. Jazz.tools. Anthropic. Zero mocks."*

---

## 🙏 Credits / acknowledgments

- XP.css by [botoxparty](https://github.com/botoxparty/XP.css)
- Original **Headspace** WMP skin by Samuel Blanchard (Microsoft, ~2000)
- Mux for the insanely developer-friendly video APIs and for shipping [Mux Robots](https://www.mux.com/blog/mux-robots) six days before this hackathon — exactly the primitive this idea needed
- Jazz.tools for making realtime multiplayer feel like local state
- Rhys Sullivan for the hackathon theme tweet that inspired all of this
- Every early-2000s preteen who burned a mix CD of songs they shouldn't have had

Built solo at Frontier Tech Week in Wynwood, Miami, 2026-04-22. 🌴
