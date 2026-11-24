import { useEffect, useRef, useState } from "react";
export function useWorkspaceNavigation() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [compactLayout, setCompactLayout] = useState(
    () => window.matchMedia("(max-width: 1024px)").matches,
  );
  const [navigationOpen, setNavigationOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const navigationToggleRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 1024px)");
    const update = () => {
      setCompactLayout(query.matches);
      setNavigationOpen(false);
    };
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!compactLayout || !navigationOpen) return;
    const sidebar = sidebarRef.current!;
    const focusable = () =>
      Array.from(
        sidebar.querySelectorAll<HTMLElement>(
          'a[href], button:not(:disabled), [tabindex="0"]',
        ),
      ).filter((element) => element.getClientRects().length > 0);
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNavigationOpen(false);
      if (event.key !== "Tab") return;
      const elements = focusable();
      const target = event.shiftKey ? elements.at(-1) : elements[0];
      if (
        document.activeElement ===
        (event.shiftKey ? elements[0] : elements.at(-1))
      ) {
        event.preventDefault();
        target?.focus();
      }
    };
    sidebar.addEventListener("keydown", onKeyDown);
    return () => {
      sidebar.removeEventListener("keydown", onKeyDown);
      navigationToggleRef.current?.focus();
    };
  }, [compactLayout, navigationOpen]);
  const [sidebarWidth, setSidebarWidth] = useState<number | null>(() => {
    const saved = Number(localStorage.getItem("mockman-sidebar-width"));
    return Number.isFinite(saved) && saved >= 175 && saved <= 560
      ? Math.max(244, saved)
      : null;
  });
  useEffect(() => {
    if (sidebarWidth !== null)
      localStorage.setItem("mockman-sidebar-width", String(sidebarWidth));
  }, [sidebarWidth]);

  return {
    sidebarCollapsed,
    setSidebarCollapsed,
    compactLayout,
    navigationOpen,
    setNavigationOpen,
    sidebarRef,
    navigationToggleRef,
    sidebarWidth,
    setSidebarWidth,
  };
}
export type WorkspaceNavigation = ReturnType<typeof useWorkspaceNavigation>;
