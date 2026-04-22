// MSN Messenger — authentic UI + Jazz-backed realtime state.
// Every Conversation lives in a Jazz CoMap; messages in a CoList. Two tabs on
// the same account see the same chat history + tokens stream in both tabs.
import { useEffect, useRef, useState } from "react";
import { useAccount, useCoState } from "jazz-tools/react";
import { Group } from "jazz-tools";
import MuxPlayer from "@mux/mux-player-react";
import { useWindowStore } from "../../store/windowStore";
import { XPAccount, Conversation, Message, MessageList } from "../../schema";
import "./messenger.css";

type Agent = {
  id: string;
  displayName: string;
  screenName: string;
  avatar: string;
  status: "online" | "away" | "busy";
  tagline: string;
};

export function MessengerApp({
  params,
  windowId,
}: {
  params?: Record<string, unknown>;
  windowId: string;
}) {
  // Conversation windows get opened with `{ conversationId, agent }` params.
  const conversationId = params?.conversationId as string | undefined;
  const agent = params?.agent as Agent | undefined;

  if (conversationId && agent) {
    return <ConversationWindow conversationId={conversationId} agent={agent} windowId={windowId} />;
  }
  return <BuddyListWindow />;
}

/* ============================================================
   Buddy list
   ============================================================ */

function BuddyListWindow() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const openWindow = useWindowStore((s) => s.open);
  const me = useAccount(XPAccount, {
    resolve: { root: { conversations: { $each: true } } },
  });

  useEffect(() => {
    fetch("/api/chat/agents").then((r) => r.json()).then(setAgents).catch(() => {});
  }, []);

  function openConversation(agent: Agent) {
    if (!me?.$isLoaded || !me.root?.$isLoaded) return;
    const conversations = me.root.conversations;
    if (!conversations?.$isLoaded) return;

    // Find an existing Conversation CoMap for this agent.
    let existing: any = null;
    for (const c of Array.from(conversations as unknown as any[])) {
      if (c?.$isLoaded && c.agentId === agent.id) {
        existing = c;
        break;
      }
    }

    // Create if missing.
    if (!existing) {
      const group = Group.create({ owner: me });
      const messages = MessageList.create([], group);
      existing = Conversation.create(
        {
          agentId: agent.id,
          title: agent.displayName,
          messages,
        },
        group,
      );
      conversations.$jazz.push(existing);
    }

    openWindow("messenger", {
      id: `msn-conv-${agent.id}`,
      title: `${agent.displayName} - Conversation`,
      icon: agent.avatar,
      w: 560,
      h: 500,
      params: { conversationId: existing.$jazz.id, agent },
    });
  }

  const online = agents.filter((a) => a.status !== "busy");
  const away = agents.filter((a) => a.status === "busy");

  return (
    <div className="msn">
      <div className="msn-menubar">
        <span>File</span>
        <span>Contacts</span>
        <span>Actions</span>
        <span>Tools</span>
        <span>Help</span>
      </div>

      <div className="msn-user-panel">
        <img className="msn-user-avatar" src="/assets/avatars/user.svg" alt="" />
        <div className="msn-user-info">
          <div className="msn-user-name">
            {(me?.$isLoaded && me.profile?.$isLoaded && me.profile.name) || "You"}{" "}
            <span className="msn-online-tag">(Online)</span> <span className="msn-arrow">▾</span>
          </div>
          <div className="msn-user-tagline">&lt;Type a personal message&gt;</div>
        </div>
        <div className="msn-mail-indicator" title="You have no new email">
          <MsnMailIcon />
        </div>
      </div>

      <div className="msn-find-bar">
        <span className="msn-search-icon">🔍</span>
        <span>Find a contact or number</span>
      </div>

      <div className="msn-contacts">
        <div className="msn-group-header">
          <span className="msn-triangle">▾</span> Online ({online.length})
        </div>
        {online.map((a) => (
          <BuddyRow key={a.id} agent={a} onOpen={() => openConversation(a)} />
        ))}

        <div className="msn-group-header">
          <span className="msn-triangle">▾</span> Appear Offline ({away.length})
        </div>
        {away.map((a) => (
          <BuddyRow key={a.id} agent={a} onOpen={() => openConversation(a)} />
        ))}
      </div>

      <div className="msn-footer">
        <MsnButterfly size={16} />
        <span className="msn-footer-brand">MSN<sup>.</sup> <b>Messenger</b></span>
      </div>
    </div>
  );
}

function BuddyRow({ agent, onOpen }: { agent: Agent; onOpen: () => void }) {
  return (
    <div
      className="msn-buddy"
      onDoubleClick={onOpen}
      title={`Double-click to IM ${agent.displayName}`}
    >
      <StatusDot status={agent.status} />
      <img className="msn-buddy-avatar" src={agent.avatar} alt="" />
      <div className="msn-buddy-text">
        <div className="msn-buddy-name">
          {agent.displayName}{" "}
          <span className="msn-buddy-status">
            ({agent.status === "online" ? "Online" : agent.status === "away" ? "Away" : "Busy"})
          </span>
        </div>
        <div className="msn-buddy-tag">{agent.tagline}</div>
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: Agent["status"] }) {
  const color = status === "online" ? "#7cbc3b" : status === "away" ? "#f2b83c" : "#c33";
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" className="msn-status-dot">
      <circle cx="7" cy="7" r="5" fill={color} stroke="#333" strokeWidth="1" />
      {status === "online" ? null : status === "busy" ? (
        <rect x="3" y="6" width="8" height="2" fill="white" />
      ) : (
        <path d="M7 4 L7 7 L10 8" stroke="white" strokeWidth="1.3" fill="none" />
      )}
    </svg>
  );
}

/* ============================================================
   Conversation window (Jazz-backed, realtime across tabs)
   ============================================================ */

function ConversationWindow({
  conversationId,
  agent,
  windowId,
}: {
  conversationId: string;
  agent: Agent;
  windowId: string;
}) {
  const closeWindow = useWindowStore((s) => s.close);
  const conv = useCoState(Conversation, conversationId, {
    resolve: { messages: { $each: true } },
  });

  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [uploading, setUploading] = useState<null | { filename: string; pct: number; stage: string }>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Read messages directly from the CoList on every render — Jazz's proxies
  // trigger re-renders when the list mutates (push) or when a message field
  // is set (.$jazz.set), so this stays reactive across tabs without memoisation.
  const convAny = conv as any;
  const rawMessages: any[] = conv?.$isLoaded && convAny.messages?.$isLoaded
    ? Array.from(convAny.messages as any[])
    : [];
  const messages = rawMessages.filter((m: any) => m?.$isLoaded);

  const lastContent = messages[messages.length - 1]?.content ?? "";
  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight });
  }, [messages.length, lastContent]);

  async function send() {
    const text = input.trim();
    if (!text || streaming || !conv?.$isLoaded) return;
    const convMessages = (conv as any).messages;
    if (!convMessages?.$isLoaded) return;
    setInput("");
    setStreaming(true);

    // Owner group for new messages = same as the conversation's.
    const owner = conv.$jazz.owner;

    // 1. Push user message into the CoList (instant, syncs to other tabs).
    const userMsg = Message.create(
      { role: "user", content: text, createdAt: Date.now() },
      owner,
    );
    convMessages.$jazz.push(userMsg);

    // 2. Build history for the API call (use local snapshot now; new user msg is
    //    already there).
    const history = [
      ...messages.map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: text },
    ];

    // 3. Create empty assistant message; we'll progressively update its content.
    const assistantMsg = Message.create(
      { role: "assistant", content: "", createdAt: Date.now() },
      owner,
    );
    convMessages.$jazz.push(assistantMsg);

    try {
      await streamAssistant(agent.id, history, assistantMsg);
    } catch (err) {
      assistantMsg.$jazz.set("content", `[error: ${String(err)}]`);
    } finally {
      setStreaming(false);
    }
  }

  // File upload path: drops/selects mp4 -> direct upload to Mux -> analyze via
  // Robots -> stream an assistant reply using the structured result as context.
  async function handleFile(file: File) {
    if (!conv?.$isLoaded) return;
    const convMessages = (conv as any).messages;
    if (!convMessages?.$isLoaded) return;
    const owner = conv.$jazz.owner;
    if (!file.type.startsWith("video/")) {
      alert("Only video files (mp4, webm, mov) are supported right now.");
      return;
    }

    setUploading({ filename: file.name, pct: 0, stage: "requesting upload url" });

    try {
      // 1. Get direct upload URL from Mux
      const uplRes = await fetch("/api/mux/uploads", { method: "POST" });
      if (!uplRes.ok) throw new Error("failed to get upload url");
      const { uploadId, uploadUrl } = (await uplRes.json()) as {
        uploadId: string;
        uploadUrl: string;
      };

      // 2. PUT file bytes to Mux
      setUploading({ filename: file.name, pct: 5, stage: "uploading to mux" });
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", uploadUrl);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setUploading({
              filename: file.name,
              pct: 5 + Math.round((e.loaded / e.total) * 70),
              stage: "uploading to mux",
            });
          }
        };
        xhr.onload = () => (xhr.status < 400 ? resolve() : reject(xhr.status));
        xhr.onerror = () => reject("network error");
        xhr.send(file);
      });

      // 3. Poll upload until assetId known
      setUploading({ filename: file.name, pct: 78, stage: "mux ingesting" });
      let assetId: string | null = null;
      const t0 = Date.now();
      while (Date.now() - t0 < 60_000) {
        const r = await fetch(`/api/mux/uploads/${uploadId}`);
        const d = (await r.json()) as { assetId: string | null; status: string };
        if (d.assetId) {
          assetId = d.assetId;
          break;
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      if (!assetId) throw new Error("mux asset never appeared");

      // 4. Kick off analyze
      setUploading({ filename: file.name, pct: 90, stage: "mux robots analyzing" });
      const aRes = await fetch(`/api/mux/analyze/${assetId}`, { method: "POST" });
      const analysis = (await aRes.json()) as {
        assetId: string;
        playbackId: string;
        durationSec: number;
        summary: {
          status: string;
          title: string | null;
          description: string | null;
          tags: string[];
        };
        keyMoments: any;
      };
      console.log("[mux analyze]", analysis);

      const title = analysis.summary.title ?? file.name;
      const description = analysis.summary.description ?? "";
      const tags = analysis.summary.tags ?? [];
      const summaryReady = analysis.summary.status === "complete";

      // 5. Push a user message with the video card
      const userMsg = Message.create(
        {
          role: "user",
          content: `[📎 sent file: ${file.name}]`,
          createdAt: Date.now(),
          videoCard: {
            muxPlaybackId: analysis.playbackId,
            title,
            summary: description,
          },
        },
        owner,
      );
      convMessages.$jazz.push(userMsg);

      // 6. Ask the agent to react in character, passing the structured result
      setUploading(null);
      setStreaming(true);
      const videoContext = summaryReady
        ? `mux robots summary of that video:\n- title: "${title}"\n- description: "${description}"\n- tags: ${tags.join(", ") || "none"}\n- duration: ${Math.round(analysis.durationSec)}s`
        : `mux robots didn't finish analyzing the video in time (status: ${analysis.summary.status}). DO NOT make up what's in the video. Just acknowledge u got the file and say ur still looking at it.`;
      const history = [
        ...messages.map((m: any) => ({ role: m.role, content: m.content })),
        {
          role: "user" as const,
          content: `[system: user just sent a video file "${file.name}"]\n\n${videoContext}\n\nReact in character. Talk about the video's content. DO NOT invent what's in the video if you weren't told — quote the title/description/tags.`,
        },
      ];
      const assistantMsg = Message.create(
        { role: "assistant", content: "", createdAt: Date.now() },
        owner,
      );
      convMessages.$jazz.push(assistantMsg);
      await streamAssistant(agent.id, history, assistantMsg);
      setStreaming(false);
    } catch (err) {
      console.error(err);
      setUploading(null);
      alert(`Upload failed: ${err}`);
    }
  }

  // Shared SSE -> CoValue updater used by both text send and file upload
  async function streamAssistant(
    agentId: string,
    history: { role: "user" | "assistant"; content: string }[],
    assistantMsg: any,
  ) {
    const res = await fetch(`/api/chat/${agentId}/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history }),
    });
    if (!res.ok || !res.body) {
      assistantMsg.$jazz.set("content", "[couldn't reach agent]");
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let contentBuf = "";
    let flushTimer: number | null = null;
    const scheduleFlush = () => {
      if (flushTimer !== null) return;
      flushTimer = window.setTimeout(() => {
        flushTimer = null;
        assistantMsg.$jazz.set("content", contentBuf);
      }, 40);
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const events = buf.split("\n\n");
      buf = events.pop() ?? "";
      for (const evt of events) {
        const lines = evt.split("\n");
        const type = lines.find((l) => l.startsWith("event:"))?.slice(6).trim();
        const data = lines
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).replace(/^ /, ""))
          .join("\n");
        if (type === "token") {
          contentBuf += data;
          scheduleFlush();
        } else if (type === "tool-call") {
          try {
            const { name } = JSON.parse(data);
            contentBuf += `\n[🤖 ${name}…]\n`;
            scheduleFlush();
          } catch {}
        } else if (type === "tool-result") {
          try {
            const { name, output } = JSON.parse(data);
            const s = output?.summary?.result?.data ?? output?.summary?.data ?? output?.summary;
            const brief = s?.title ?? s?.description ?? (output?.ok ? "done" : "error");
            contentBuf = contentBuf.replace(`\n[🤖 ${name}…]\n`, `\n[✅ ${name}: ${brief}]\n`);
            if (output?.muxPlaybackId) {
              assistantMsg.$jazz.set("videoCard", {
                muxPlaybackId: output.muxPlaybackId,
                title: s?.title ?? "Video",
                summary: s?.description ?? "",
              });
            }
            scheduleFlush();
          } catch {}
        }
      }
    }
    assistantMsg.$jazz.set("content", contentBuf);
  }

  function nudge() {
    const el = document.querySelector<HTMLElement>(".msn-conv");
    if (!el) return;
    el.classList.remove("msn-nudging");
    void el.offsetWidth;
    el.classList.add("msn-nudging");
  }

  return (
    <div className="msn-conv">
      <div className="msn-conv-menubar">
        <span>File</span>
        <span>Edit</span>
        <span>Actions</span>
        <span>Tools</span>
        <span>Help</span>
      </div>

      <div className="msn-conv-toolbar">
        <ToolbarBtn icon="👥" label="Invite" />
        <button
          type="button"
          className="msn-toolbar-btn"
          title="Send Files"
          onClick={() => fileInputRef.current?.click()}
        >
          <span className="msn-toolbar-icon">📎</span>
          <span className="msn-toolbar-label">Send Files</span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/mp4,video/webm,video/quicktime"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
        />
        <ToolbarBtn icon="🎤" label="Voice" />
        <ToolbarBtn icon="📹" label="Video" />
        <ToolbarBtn icon="🎮" label="Activities" />
        <ToolbarBtn icon="🕹️" label="Games" />
        <div className="msn-conv-spacer" />
        <button
          type="button"
          className="msn-btn-link"
          onClick={() => closeWindow(windowId)}
        >
          × Close
        </button>
      </div>

      <div className="msn-conv-to-bar">
        <b>To:</b>{" "}
        <span className="msn-buddy-name-inline">{agent.displayName}</span>{" "}
        <span className="msn-screenname">&lt;{agent.screenName}&gt;</span>
      </div>

      {uploading && (
        <div className="msn-upload-banner">
          <b>📎 {uploading.filename}</b> — {uploading.stage} ({uploading.pct}%)
          <div className="msn-upload-bar">
            <div className="msn-upload-fill" style={{ width: `${uploading.pct}%` }} />
          </div>
        </div>
      )}

      <div
        className="msn-conv-body"
        onDragOver={(e) => {
          e.preventDefault();
          e.currentTarget.classList.add("msn-drag-over");
        }}
        onDragLeave={(e) => e.currentTarget.classList.remove("msn-drag-over")}
        onDrop={(e) => {
          e.preventDefault();
          e.currentTarget.classList.remove("msn-drag-over");
          const f = e.dataTransfer.files?.[0];
          if (f) handleFile(f);
        }}
      >
        <div className="msn-chat" ref={chatRef}>
          {messages.length === 0 && (
            <div className="msn-system">
              💬 Never give out your password or credit card number in an instant message conversation.
            </div>
          )}
          {messages.map((m, i) => (
            <MessageBubble key={m.$jazz.id ?? i} msg={m} agent={agent} />
          ))}
          {streaming && messages.at(-1)?.content === "" && (
            <div className="msn-typing">
              <i>{agent.displayName} is typing a message…</i>
            </div>
          )}
        </div>

        <div className="msn-conv-right">
          <img className="msn-dp" src={agent.avatar} alt="" />
          <div className="msn-dp-label">{agent.displayName}</div>
        </div>
      </div>

      <div className="msn-conv-format">
        <button type="button" title="Change font"><b>A</b></button>
        <button type="button" title="Emoticons">😊 ▾</button>
        <button type="button" title="Voice clip">🎤 Voice Clip</button>
        <button type="button" title="Wink">😉 ▾</button>
        <button type="button" title="Background">🎨 ▾</button>
        <button type="button" title="Send nudge" onClick={nudge}>🎁 ▾</button>
        <button type="button" title="Handwrite">✏️</button>
      </div>

      <div className="msn-input-row">
        <textarea
          className="msn-input"
          placeholder="Type a message…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          disabled={streaming}
          autoComplete="off"
          data-1p-ignore="true"
          data-lpignore="true"
        />
        <button
          type="button"
          className="msn-send"
          onClick={send}
          disabled={!input.trim() || streaming}
        >
          Send
        </button>
      </div>

      <div className="msn-conv-status">
        Last message on {new Date().toLocaleString([], { dateStyle: "short", timeStyle: "short" })}.
      </div>
    </div>
  );
}

function ToolbarBtn({ icon, label }: { icon: string; label: string }) {
  return (
    <button type="button" className="msn-toolbar-btn" title={label}>
      <span className="msn-toolbar-icon">{icon}</span>
      <span className="msn-toolbar-label">{label}</span>
    </button>
  );
}

function MessageBubble({ msg, agent }: { msg: any; agent: Agent }) {
  const isUser = msg.role === "user";
  const name = isUser ? "You" : agent.displayName;
  const color = isUser ? "#c00" : "#00359c";
  return (
    <div className="msn-msg">
      <div>
        <span className="msn-msg-name" style={{ color }}>
          {name} says:
        </span>
      </div>
      <div className="msn-msg-content">
        {msg.videoCard && (
          <div className="msn-video-card">
            <div className="msn-video-card-title">📎 {msg.videoCard.title}</div>
            <MuxPlayer
              playbackId={msg.videoCard.muxPlaybackId}
              streamType="on-demand"
              style={{ width: 300, aspectRatio: "16/9", marginTop: 4 }}
              metadata={{ video_title: msg.videoCard.title }}
            />
            {msg.videoCard.summary && (
              <div className="msn-video-card-summary">{msg.videoCard.summary}</div>
            )}
            <div className="msn-video-card-url">
              <button
                type="button"
                className="msn-video-copy"
                onClick={() =>
                  navigator.clipboard.writeText(
                    `https://stream.mux.com/${msg.videoCard.muxPlaybackId}.m3u8`,
                  )
                }
                title="Copy Mux playback URL so you can share it with another agent"
              >
                📋 Copy Mux URL
              </button>
            </div>
          </div>
        )}
        <span style={{ whiteSpace: "pre-wrap" }}>{msg.content}</span>
      </div>
    </div>
  );
}

/* ============================================================
   MSN butterfly + mail icons
   ============================================================ */

function MsnButterfly({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className="msn-butterfly">
      <defs>
        <linearGradient id="msnG1" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7bd1f5" />
          <stop offset="1" stopColor="#1e7ec2" />
        </linearGradient>
        <linearGradient id="msnG2" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffd94a" />
          <stop offset="1" stopColor="#f07c1a" />
        </linearGradient>
      </defs>
      <path d="M5 16 Q5 5 16 10 Q14 14 10 20 Q7 22 5 16 Z" fill="url(#msnG1)" />
      <path d="M16 10 Q27 5 27 16 Q25 22 22 20 Q18 14 16 10 Z" fill="url(#msnG1)" />
      <path d="M16 10 Q18 3 23 5 Q21 9 16 10 Z" fill="url(#msnG2)" />
      <path d="M16 10 Q14 3 9 5 Q11 9 16 10 Z" fill="url(#msnG2)" />
    </svg>
  );
}

function MsnMailIcon() {
  return (
    <svg width="18" height="14" viewBox="0 0 24 18">
      <rect x="1" y="1" width="22" height="16" rx="1" fill="#fff" stroke="#4a7aa0" />
      <path d="M1 1 L12 11 L23 1" stroke="#4a7aa0" fill="none" />
    </svg>
  );
}
