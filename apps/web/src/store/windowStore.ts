import { create } from "zustand";

export type AppId = "tunes" | "messenger";

export type WindowInstance = {
  id: string;
  appId: AppId;
  title: string;
  icon: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minimized: boolean;
  maximized: boolean;
  zIndex: number;
  // App-specific payload (e.g. which buddy a Messenger window is open for)
  params?: Record<string, unknown>;
};

type State = {
  windows: WindowInstance[];
  topZ: number;
  open: (appId: AppId, opts?: Partial<WindowInstance> & { params?: Record<string, unknown> }) => string;
  close: (id: string) => void;
  focus: (id: string) => void;
  minimize: (id: string) => void;
  restore: (id: string) => void;
  toggleMaximize: (id: string) => void;
  setGeometry: (id: string, g: Partial<Pick<WindowInstance, "x" | "y" | "w" | "h">>) => void;
  closeAll: () => void;
};

let idCounter = 0;

export const useWindowStore = create<State>((set, get) => ({
  windows: [],
  topZ: 10,

  open: (appId, opts = {}) => {
    const id = opts.id ?? `${appId}-${++idCounter}`;
    // If this window is already open, just focus it.
    const existing = get().windows.find((w) => w.id === id);
    if (existing) {
      get().focus(id);
      get().restore(id);
      return id;
    }
    const topZ = get().topZ + 1;
    const defaultGeo: Record<AppId, Pick<WindowInstance, "w" | "h" | "title" | "icon">> = {
      tunes: { w: 880, h: 520, title: "XP Tunes", icon: "/assets/icons/wmp.svg" },
      messenger: { w: 520, h: 600, title: "MSN Messenger", icon: "/assets/icons/msn.svg" },
    };
    const def = defaultGeo[appId];
    const win: WindowInstance = {
      id,
      appId,
      title: opts.title ?? def.title,
      icon: opts.icon ?? def.icon,
      x: opts.x ?? 80 + Math.random() * 120,
      y: opts.y ?? 60 + Math.random() * 80,
      w: opts.w ?? def.w,
      h: opts.h ?? def.h,
      minimized: false,
      maximized: false,
      zIndex: topZ,
      params: opts.params,
    };
    set({ windows: [...get().windows, win], topZ });
    return id;
  },

  close: (id) =>
    set({ windows: get().windows.filter((w) => w.id !== id) }),

  focus: (id) => {
    const topZ = get().topZ + 1;
    set({
      topZ,
      windows: get().windows.map((w) => (w.id === id ? { ...w, zIndex: topZ, minimized: false } : w)),
    });
  },

  minimize: (id) =>
    set({
      windows: get().windows.map((w) => (w.id === id ? { ...w, minimized: true } : w)),
    }),

  restore: (id) =>
    set({
      windows: get().windows.map((w) => (w.id === id ? { ...w, minimized: false } : w)),
    }),

  toggleMaximize: (id) =>
    set({
      windows: get().windows.map((w) =>
        w.id === id ? { ...w, maximized: !w.maximized } : w,
      ),
    }),

  setGeometry: (id, g) =>
    set({
      windows: get().windows.map((w) => (w.id === id ? { ...w, ...g } : w)),
    }),

  closeAll: () => set({ windows: [] }),
}));
