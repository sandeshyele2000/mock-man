import { useEffect, useState } from "react";
export function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    localStorage.getItem("mockman-theme") === "dark" ? "dark" : "light",
  );
  useEffect(() => {
    localStorage.setItem("mockman-theme", theme);
    document.documentElement.dataset.theme = theme;
    document
      .querySelector<HTMLLinkElement>("link[data-theme-icon]")
      ?.setAttribute("href", `./favicon-${theme}.svg`);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#101218" : "#f6f7fb");
  }, [theme]);
  return { theme, setTheme };
}
