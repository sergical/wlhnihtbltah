import { useEffect, useRef } from "react";
import { useLogOut, useAuthSecretStorage } from "jazz-tools/react";
import { useWindowStore } from "../store/windowStore";

export function StartMenu({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const open = useWindowStore((s) => s.open);
  const logOut = useLogOut();
  const authStorage = useAuthSecretStorage();

  async function nukeEverything() {
    if (!confirm("Wipe ALL local data (accounts, chats, Spotify tokens)?")) return;
    try {
      logOut();
      await authStorage.clear();
      localStorage.clear();
      sessionStorage.clear();

      // Wait for each IndexedDB deletion to actually complete — they return
      // IDBRequest, not a Promise, so we have to wrap them.
      if ("databases" in indexedDB) {
        const dbs = (await (indexedDB as any).databases()) as {
          name?: string;
        }[];
        await Promise.all(
          dbs
            .filter((d) => !!d.name)
            .map(
              (d) =>
                new Promise<void>((resolve) => {
                  const req = indexedDB.deleteDatabase(d.name!);
                  req.onsuccess = () => resolve();
                  req.onerror = () => resolve();
                  req.onblocked = () => resolve();
                  setTimeout(() => resolve(), 3000);
                }),
            ),
        );
      }
    } catch (err) {
      console.error("reset failed", err);
    } finally {
      location.replace(location.pathname);
    }
  }

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    setTimeout(() => window.addEventListener("click", onClick), 0);
    return () => window.removeEventListener("click", onClick);
  }, [onClose]);

  const items: { label: string; icon: string; onClick: () => void }[] = [
    {
      label: "XP Tunes",
      icon: "/assets/icons/wmp.svg",
      onClick: () => { open("tunes"); onClose(); },
    },
    {
      label: "MSN Messenger",
      icon: "/assets/icons/msn.svg",
      onClick: () => { open("messenger"); onClose(); },
    },
  ];

  return (
    <div ref={ref} className="xp-start-menu">
      <div className="xp-start-header">
        <img src="/assets/avatars/user.svg" alt="" />
        <span>user</span>
      </div>
      <div className="xp-start-body">
        {items.map((it) => (
          <button type="button" key={it.label} className="xp-start-item" onClick={it.onClick}>
            <img src={it.icon} alt="" />
            <span>{it.label}</span>
          </button>
        ))}
      </div>
      <div className="xp-start-footer">
        <button
          type="button"
          onClick={() => {
            logOut();
            setTimeout(() => location.reload(), 100);
          }}
        >
          <img src="/assets/icons/logoff.svg" alt="" /> Log Off
        </button>
        <button type="button" onClick={nukeEverything} title="Wipe ALL local data">
          <img src="/assets/icons/shutdown.svg" alt="" /> Reset XP
        </button>
      </div>
    </div>
  );
}
