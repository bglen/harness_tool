import { X } from "lucide-react";
import { useUi } from "../store/ui";
import { cx, SeverityIcon } from "../ui/primitives";

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed bottom-12 left-1/2 z-[90] flex -translate-x-1/2 flex-col items-center gap-2" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={cx("pop-in pointer-events-auto flex items-center gap-2 rounded-card border bg-bg-surface-2 px-3 py-2 text-sm shadow-xl", t.kind === "error" ? "border-status-error" : "border-border-subtle")}>
          <SeverityIcon severity={t.kind === "error" ? "error" : t.kind === "success" ? "pass" : "info"} />
          <span className="max-w-[560px]">
            {t.text}
            {t.detail && (
              <ul className="mt-1 list-disc pl-4 text-xs text-text-secondary">
                {t.detail.slice(1, 6).map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            )}
          </span>
          {t.action && (
            <button className="ml-2 text-accent hover:underline" onClick={() => (t.action!.run(), dismiss(t.id))}>
              {t.action.label}
            </button>
          )}
          <button aria-label="Dismiss" className="ml-1 text-text-tertiary hover:text-text-primary" onClick={() => dismiss(t.id)}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
