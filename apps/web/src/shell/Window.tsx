import { Rnd } from "react-rnd";
import type { ReactNode } from "react";
import { useWindowStore, type WindowInstance } from "../store/windowStore";

type Props = { win: WindowInstance; children: ReactNode };

export function Window({ win, children }: Props) {
  const { focus, close, minimize, toggleMaximize, setGeometry } = useWindowStore();

  if (win.minimized) return null;

  const geo = win.maximized
    ? { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight - 40 }
    : { x: win.x, y: win.y, width: win.w, height: win.h };

  return (
    <Rnd
      position={{ x: geo.x, y: geo.y }}
      size={{ width: geo.width, height: geo.height }}
      minWidth={320}
      minHeight={220}
      bounds="parent"
      dragHandleClassName="title-bar"
      disableDragging={win.maximized}
      enableResizing={!win.maximized}
      style={{ zIndex: win.zIndex }}
      onMouseDown={() => focus(win.id)}
      onDragStop={(_, d) => setGeometry(win.id, { x: d.x, y: d.y })}
      onResizeStop={(_, __, ref, ___, pos) =>
        setGeometry(win.id, {
          x: pos.x,
          y: pos.y,
          w: parseInt(ref.style.width),
          h: parseInt(ref.style.height),
        })
      }
    >
      <div
        className="window"
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div className="title-bar">
          <div className="title-bar-text">
            <img
              src={win.icon}
              alt=""
              style={{ width: 14, height: 14, marginRight: 4, verticalAlign: "middle" }}
            />
            {win.title}
          </div>
          <div className="title-bar-controls">
            <button type="button" aria-label="Minimize" onClick={() => minimize(win.id)} />
            <button
              type="button"
              aria-label={win.maximized ? "Restore" : "Maximize"}
              onClick={() => toggleMaximize(win.id)}
            />
            <button type="button" aria-label="Close" onClick={() => close(win.id)} />
          </div>
        </div>
        <div
          className="window-body"
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            margin: 0,
            padding: 0,
            overflow: "hidden",
          }}
        >
          {children}
        </div>
      </div>
    </Rnd>
  );
}
