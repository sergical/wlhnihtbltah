import { useEffect, useState } from "react";
import { useSyncConnectionStatus, useAccount } from "jazz-tools/react";
import { useWindowStore } from "../store/windowStore";
import { XPAccount } from "../schema";
import { StartMenu } from "./StartMenu";

export function Taskbar() {
  const { windows, focus, minimize } = useWindowStore();
  const [startOpen, setStartOpen] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const syncStatus = useSyncConnectionStatus();
  const me = useAccount(XPAccount);
  const username =
    (me?.$isLoaded && me.profile?.$isLoaded && (me.profile as any).name) ||
    "user";

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <>
      {startOpen && <StartMenu onClose={() => setStartOpen(false)} />}
      <div className="xp-taskbar">
        <button
          type="button"
          className={`xp-start-btn ${startOpen ? "pressed" : ""}`}
          onClick={() => setStartOpen((v) => !v)}
        >
          <img src="/assets/icons/start.svg" alt="" />
          <span>start</span>
        </button>
        <div className="xp-tasks">
          {windows.map((w) => (
            <button
              type="button"
              key={w.id}
              className={`xp-task-btn ${w.minimized ? "" : "active"}`}
              onClick={() => (w.minimized ? focus(w.id) : minimize(w.id))}
            >
              <img src={w.icon} alt="" />
              <span>{w.title}</span>
            </button>
          ))}
        </div>
        <div className="xp-tray">
          <span
            className="xp-sync"
            title={`Jazz sync: ${syncStatus ? "connected" : "disconnected"} · signed in as ${username}`}
            data-status={syncStatus ? "connected" : "disconnected"}
          >
            {syncStatus ? "●" : "○"}
          </span>
          <img src="/assets/icons/speaker.svg" alt="volume" />
          <span className="xp-clock">
            {clock.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </span>
        </div>
      </div>
    </>
  );
}
