import { useEffect, useRef, useState } from "react";

const minimumWidth = 244;
const maximumWidth = () =>
  Math.max(minimumWidth, Math.min(560, window.innerWidth / 2));

export function SidebarResizeHandle({
  onResize,
}: {
  onResize: (width: number) => void;
}) {
  const handleRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; width: number } | null>(null);
  const [width, setWidth] = useState(244);
  const [resizing, setResizing] = useState(false);

  useEffect(() => {
    const sidebar = handleRef.current?.parentElement;
    if (!sidebar) return;
    const observer = new ResizeObserver(() => {
      setWidth(Math.round(sidebar.getBoundingClientRect().width));
    });
    observer.observe(sidebar);
    return () => observer.disconnect();
  }, []);

  const resize = (next: number) =>
    onResize(
      Math.round(Math.max(minimumWidth, Math.min(maximumWidth(), next))),
    );
  const stopResizing = () => {
    dragRef.current = null;
    setResizing(false);
  };

  return (
    <div
      ref={handleRef}
      className="sidebar-resize-handle"
      role="separator"
      aria-label="Resize sidebar"
      aria-orientation="vertical"
      aria-valuemin={minimumWidth}
      aria-valuemax={maximumWidth()}
      aria-valuenow={width}
      aria-valuetext={`${width} pixels`}
      tabIndex={0}
      title="Drag to resize sidebar, or use the arrow keys"
      data-resizing={resizing}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = {
          x: event.clientX,
          width:
            event.currentTarget.parentElement!.getBoundingClientRect().width,
        };
        setResizing(true);
      }}
      onPointerMove={(event) => {
        const start = dragRef.current;
        if (start) resize(start.width + event.clientX - start.x);
      }}
      onPointerUp={(event) => {
        stopResizing();
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={stopResizing}
      onLostPointerCapture={stopResizing}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 40 : 10;
        const next = {
          ArrowLeft: width - step,
          ArrowRight: width + step,
          Home: minimumWidth,
          End: maximumWidth(),
        }[event.key];
        if (next === undefined) return;
        event.preventDefault();
        resize(next);
      }}
    />
  );
}
