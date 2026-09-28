import * as Tooltip from "@radix-ui/react-tooltip";
import { lazy, Suspense } from "react";
import { useProject } from "./store/project";
import { useUi } from "./store/ui";
import { useAnalysisBridge } from "./store/analysis";
import { useKeyboard } from "./lib/keyboard";
import { TopBar } from "./chrome/TopBar";
import { RightRail } from "./chrome/RightRail";
import { StatusBar } from "./chrome/StatusBar";
import { Toasts } from "./chrome/Toasts";
import { Canvas } from "./canvas/Canvas";
import { WireListDrawer } from "./drawer/WireList";
import { Popovers } from "./popovers/Popovers";
import { Dialogs } from "./dialogs/Dialogs";

const BomView = lazy(() => import("./views/BomView"));
const OutputsView = lazy(() => import("./views/OutputsView"));

export function App() {
  const project = useProject((s) => s.project);
  const view = useUi((s) => s.view);
  useAnalysisBridge();
  useKeyboard();
  if (!project) return null;
  return (
    <Tooltip.Provider>
      <div className="flex h-full min-w-[1024px] flex-col">
        <TopBar />
        <div className="flex min-h-0 flex-1">
          <main className="flex min-w-0 flex-1 flex-col">
            {view === "design" ? (
              <>
                <div className="relative min-h-0 flex-1">
                  <Canvas />
                </div>
                <WireListDrawer />
              </>
            ) : (
              <Suspense fallback={<div className="p-6 text-sm text-text-tertiary">Loading…</div>}>{view === "bom" ? <BomView /> : <OutputsView />}</Suspense>
            )}
          </main>
          <RightRail />
        </div>
        <StatusBar />
        <Popovers />
        <Dialogs />
        <Toasts />
      </div>
    </Tooltip.Provider>
  );
}
