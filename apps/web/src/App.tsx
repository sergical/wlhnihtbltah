import { useState, useEffect, useRef } from "react";
import {
  JazzReactProvider,
  useDemoAuth,
  useAccount,
  useIsAuthenticated,
} from "jazz-tools/react";
import { XPAccount } from "./schema";
import { useWindowStore } from "./store/windowStore";
import { BootSplash } from "./shell/BootSplash";
import { LoginScreen } from "./shell/LoginScreen";
import { Desktop } from "./shell/Desktop";

type Phase = "boot" | "loaded";

/**
 * Root chrome. Controls the boot → login → desktop phase machine.
 * Jazz provides the persistent account / realtime state for the logged-in user.
 */
export function App() {
  const [phase, setPhase] = useState<Phase>("boot");

  // Jazz sync: use canonical cloud.jazz.tools which reliably supports
  // cross-tab and cross-device sync via WebSocket + BroadcastChannel.
  const appId = (import.meta.env.VITE_JAZZ_APP_ID as string | undefined) ?? "";
  const peer = (appId
    ? `wss://cloud.jazz.tools/?key=${appId}`
    : "wss://cloud.jazz.tools/?key=wlhnihtbltah@sandbox") as `wss://${string}`;
  if (typeof window !== "undefined") {
    (window as any).__JAZZ_PEER = peer;
  }

  return (
    <JazzReactProvider
      AccountSchema={XPAccount}
      sync={{ peer }}
      fallback={<BootSplash onDone={() => {}} />}
    >
      <PhaseMachine phase={phase} setPhase={setPhase} />
    </JazzReactProvider>
  );
}

function PhaseMachine({
  phase,
  setPhase,
}: {
  phase: Phase;
  setPhase: (p: Phase) => void;
}) {
  const auth = useDemoAuth();
  const isAuthed = useIsAuthenticated();
  const me = useAccount(XPAccount);
  const closeAllWindows = useWindowStore((s) => s.closeAll);

  // Whenever the signed-in identity changes (including log out), close every
  // open window so we don't show stale windows bound to the previous account's
  // CoValues.
  const prevAuthedRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (prevAuthedRef.current !== null && prevAuthedRef.current !== isAuthed) {
      closeAllWindows();
    }
    prevAuthedRef.current = isAuthed;
  }, [isAuthed, closeAllWindows]);

  if (phase === "boot") {
    return <BootSplash onDone={() => setPhase("loaded")} />;
  }

  if (!isAuthed) {
    return (
      <LoginScreen
        existingUsers={auth.existingUsers}
        onLogin={async (username) => {
          try {
            if (auth.existingUsers.includes(username)) {
              await auth.logIn(username);
            } else {
              await auth.signUp(username);
            }
            if (me?.$isLoaded) {
              if (me.root?.$isLoaded) me.root.$jazz.set("username", username);
              if (me.profile?.$isLoaded) me.profile.$jazz.set("name", username);
            }
            closeAllWindows();
          } catch (err) {
            console.error("login failed", err);
            alert(`Login failed: ${err}`);
          }
        }}
      />
    );
  }

  return <Desktop />;
}
