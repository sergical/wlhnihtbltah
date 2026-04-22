import { useEffect } from "react";

export function BootSplash({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2500);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div className="xp-boot">
      <div className="xp-boot-inner">
        <div className="xp-boot-logo">
          <div className="xp-boot-flag">
            <span style={{ background: "#f14f4f" }} />
            <span style={{ background: "#7eba3b" }} />
            <span style={{ background: "#4b8fe1" }} />
            <span style={{ background: "#f4c23e" }} />
          </div>
          <div className="xp-boot-wordmark">
            <div className="xp-boot-title">Microsoft</div>
            <div className="xp-boot-title-big">Windows<span>XP</span></div>
          </div>
        </div>
        <div className="xp-boot-progress">
          <div className="xp-boot-progress-fill" />
        </div>
        <div className="xp-boot-copy">Copyright © Microsoft Corporation</div>
      </div>
    </div>
  );
}
