import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { toCss } from "@hs/ui-tokens";
import { App } from "./App";
import { loadServices } from "./lib/services";
import { useProject } from "./store/project";
import { useUi } from "./store/ui";
import { createNewProject } from "./lib/projects";

// Design tokens → CSS variables (single source, §16.9)
const style = document.createElement("style");
style.textContent = toCss();
document.head.appendChild(style);
document.documentElement.dataset.theme = useUi.getState().resolvedTheme;
if (useUi.getState().theme === "system") matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => useUi.getState().setTheme("system"));

const root = createRoot(document.getElementById("root")!);
root.render(
  <div className="flex h-full items-center justify-center text-sm text-text-tertiary" role="status">
    Loading catalog…
  </div>,
);

(async () => {
  try {
    const s = await loadServices();
    const last = await s.store.lastOpened().catch(() => undefined);
    const p = last ? await s.store.load(last).catch(() => undefined) : undefined;
    if (p) useProject.getState().init(p);
    else createNewProject();
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__hs = { useProject, useUi, services: s, openExample: (await import("./lib/projects")).openExample };
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  } catch (e) {
    console.error(e);
    root.render(<div className="p-8 text-sm text-status-error">Failed to load the component catalog: {(e as Error).message}. Run `pnpm data:build`.</div>);
  }
})();
