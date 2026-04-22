import { useWindowStore, type AppId } from "../store/windowStore";
import { Window } from "./Window";
import { Taskbar } from "./Taskbar";
import { TunesApp } from "../apps/tunes";
import { MessengerApp } from "../apps/messenger";

const DESKTOP_ICONS: { appId: AppId; label: string; icon: string }[] = [
  { appId: "tunes", label: "XP Tunes", icon: "/assets/icons/wmp.svg" },
  { appId: "messenger", label: "MSN Messenger", icon: "/assets/icons/msn.svg" },
];

function DesktopIcon({
  icon,
  label,
  onOpen,
}: {
  icon: string;
  label: string;
  onOpen: () => void;
}) {
  return (
    <button type="button" className="xp-desktop-icon" onDoubleClick={onOpen}>
      <img src={icon} alt="" />
      <span>{label}</span>
    </button>
  );
}

export function Desktop() {
  const { windows, open } = useWindowStore();

  return (
    <div className="xp-desktop">
      <div className="xp-desktop-icons">
        {DESKTOP_ICONS.map((d) => (
          <DesktopIcon
            key={d.appId}
            icon={d.icon}
            label={d.label}
            onOpen={() => open(d.appId)}
          />
        ))}
      </div>

      {windows.map((w) => (
        <Window key={w.id} win={w}>
          {w.appId === "tunes" && <TunesApp />}
          {w.appId === "messenger" && <MessengerApp params={w.params} windowId={w.id} />}
        </Window>
      ))}

      <Taskbar />
    </div>
  );
}
