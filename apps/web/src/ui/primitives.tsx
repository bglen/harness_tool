import * as Tooltip from "@radix-ui/react-tooltip";
import * as RDialog from "@radix-ui/react-dialog";
import { formatWireColor, type Severity, type WireColor } from "@hs/model";
import { needsCasing, semantic, wireColor } from "@hs/ui-tokens";
import { X } from "lucide-react";
import { forwardRef, useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { useUi } from "../store/ui";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="mono rounded-chip border border-border-subtle bg-bg-hover px-1 text-2xs text-text-secondary">{children}</kbd>;
}

export function Tip({ label, shortcut, children, side = "top" }: { label: ReactNode; shortcut?: string; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <Tooltip.Root delayDuration={350}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content side={side} sideOffset={6} className="pop-in z-[100] flex items-center gap-2 rounded-control border border-border-subtle bg-bg-surface-2 px-2 py-1 text-xs text-text-primary shadow-lg">
          {label}
          {shortcut && <Kbd>{shortcut}</Kbd>}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" };

export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button({ variant = "secondary", size = "md", className, ...p }, ref) {
  return (
    <button
      ref={ref}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-control font-medium transition-colors duration-fast disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-7 px-2 text-xs" : "h-8 px-3 text-sm",
        variant === "primary" && "bg-accent text-accent-on hover:brightness-110",
        variant === "secondary" && "border border-border-control bg-bg-surface-2 text-text-primary hover:bg-bg-hover",
        variant === "ghost" && "text-text-secondary hover:bg-bg-hover hover:text-text-primary",
        variant === "danger" && "border border-status-error text-status-error hover:bg-bg-hover",
        className,
      )}
      {...p}
    />
  );
});

export const IconButton = forwardRef<HTMLButtonElement, BtnProps & { label: string; shortcut?: string; active?: boolean; tipSide?: "top" | "bottom" | "left" | "right" }>(function IconButton({ label, shortcut, active, tipSide, className, children, ...p }, ref) {
  return (
    <Tip label={label} shortcut={shortcut} side={tipSide}>
      <button ref={ref} aria-label={label} aria-pressed={active} className={cx("inline-flex h-8 w-8 items-center justify-center rounded-control text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:opacity-40", active && "bg-bg-hover text-accent", className)} {...p}>
        {children}
      </button>
    </Tip>
  );
});

export function Chip({ children, className, onClick, title }: { children: ReactNode; className?: string; onClick?: () => void; title?: string }) {
  const C = onClick ? "button" : "span";
  return (
    <C title={title} onClick={onClick} className={cx("inline-flex items-center gap-1 rounded-chip border border-border-subtle bg-bg-hover px-1.5 py-0.5 text-2xs text-text-secondary", onClick && "hover:border-border-control hover:text-text-primary", className)}>
      {children}
    </C>
  );
}

/** Status icon: shape + color + (optional) text; never color alone (§16.5). */
export function SeverityIcon({ severity, size = 14 }: { severity: Severity | "pass"; size?: number }) {
  const color = severity === "error" ? "var(--status-error)" : severity === "warning" ? "var(--status-warning)" : severity === "pass" ? "var(--status-pass)" : "var(--status-info)";
  const label = severity === "error" ? "Error" : severity === "warning" ? "Warning" : severity === "pass" ? "Pass" : "Info";
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" role="img" aria-label={label} className="shrink-0">
      {severity === "error" && (
        <>
          <path d="M5.2 1h5.6L15 5.2v5.6L10.8 15H5.2L1 10.8V5.2z" fill={color} />
          <path d="M5.5 5.5l5 5m0-5l-5 5" stroke="var(--bg-surface-1)" strokeWidth="1.8" strokeLinecap="round" />
        </>
      )}
      {severity === "warning" && (
        <>
          <path d="M8 1.2L15.2 14.2H.8z" fill={color} strokeLinejoin="round" />
          <path d="M8 6v4" stroke="var(--bg-surface-1)" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="8" cy="12" r="1" fill="var(--bg-surface-1)" />
        </>
      )}
      {severity === "pass" && (
        <>
          <circle cx="8" cy="8" r="7" fill={color} />
          <path d="M4.8 8.2l2.2 2.2 4.2-4.6" stroke="var(--bg-surface-1)" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {(severity === "info" || severity === "off") && (
        <>
          <circle cx="8" cy="8" r="7" fill="none" stroke={color} strokeWidth="1.5" />
          <path d="M8 7.2v4" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="8" cy="4.8" r="1" fill={color} />
        </>
      )}
    </svg>
  );
}

/** Wire color swatch split into base + stripes, with casing when low-contrast (§16.4). */
export function WireSwatch({ color, showCode = true, className }: { color: WireColor; showCode?: boolean; className?: string }) {
  const theme = useUi((s) => s.resolvedTheme);
  const canvas = semantic("bg.surface-2", theme);
  const all = [color.base, ...color.stripes];
  const w = 18;
  return (
    <span className={cx("inline-flex items-center gap-1", className)}>
      <svg width={w} height={10} className="shrink-0" aria-hidden>
        {all.map((c, i) => (
          <rect key={i} x={i === 0 ? 0 : (w * (i + 1)) / (all.length + 1)} y={0} width={i === 0 ? w : w / (all.length + 1) / 1.6} height={10} fill={wireColor(c, theme)} />
        ))}
        {needsCasing(wireColor(color.base, theme), canvas) && <rect x={0.5} y={0.5} width={w - 1} height={9} fill="none" stroke="var(--wire-casing)" strokeWidth={1} />}
      </svg>
      {showCode && <span className="mono text-2xs text-text-secondary">{formatWireColor(color)}</span>}
    </span>
  );
}

export function DemoTag({ className }: { className?: string }) {
  return (
    <Tip label="Phase 1 prices, stock and ship dates are demo data, not a quotation">
      <span className={cx("inline-flex items-center rounded-chip border border-border-subtle px-1 text-[10px] font-medium uppercase tracking-wide text-text-tertiary", className)}>Demo data</span>
    </Tip>
  );
}

export function Dialog({ open, onClose, title, children, width = 640, footer, description }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: number; footer?: ReactNode; description?: ReactNode }) {
  return (
    <RDialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <RDialog.Content className="pop-in fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] -translate-x-1/2 -translate-y-1/2 flex-col rounded-card border border-border-subtle bg-bg-surface-1 shadow-2xl" style={{ width: `min(${width}px, 96vw)` }}>
          <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
            <div>
              <RDialog.Title className="text-md font-semibold">{title}</RDialog.Title>
              {description ? <RDialog.Description className="text-xs text-text-secondary">{description}</RDialog.Description> : <RDialog.Description className="sr-only">{typeof title === "string" ? title : "Dialog"}</RDialog.Description>}
            </div>
            <RDialog.Close asChild>
              <IconButton label="Close" shortcut="Esc">
                <X size={16} />
              </IconButton>
            </RDialog.Close>
          </div>
          <div className="scroll-thin min-h-0 flex-1 overflow-auto p-4">{children}</div>
          {footer && <div className="flex items-center justify-end gap-2 border-t border-border-subtle px-4 py-3">{footer}</div>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

/** Floating panel at screen coordinates; closes on outside click / Esc. Keeps itself inside the viewport. */
export function Floating({ x, y, onClose, children, className, align = "start", width }: { x: number; y: number; onClose: () => void; children: ReactNode; className?: string; align?: "start" | "center"; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let left = align === "center" ? x - r.width / 2 : x;
    let top = y;
    if (left + r.width > window.innerWidth - 8) left = window.innerWidth - r.width - 8;
    if (top + r.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - r.height - 8);
    setPos({ left: Math.max(8, left), top: Math.max(8, top) });
  }, [x, y, align]);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest?.("[data-floating-keep]")) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const t = setTimeout(() => window.addEventListener("pointerdown", down), 0);
    window.addEventListener("keydown", key);
    return () => {
      clearTimeout(t);
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("keydown", key);
    };
  }, [onClose]);
  return (
    <div ref={ref} role="dialog" className={cx("pop-in fixed z-40 rounded-card border border-border-subtle bg-bg-surface-2 shadow-xl", className)} style={{ left: pos.left, top: pos.top, width }} onPointerDown={(e) => e.stopPropagation()}>
      {children}
    </div>
  );
}

export function Field({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-text-secondary">{label}</span>
      {children}
      {hint && <span className="text-2xs text-text-tertiary">{hint}</span>}
    </label>
  );
}

export const inputCls = "h-8 rounded-control border border-border-control bg-bg-surface-1 px-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-none";

export function Select<T extends string | number>({ value, onChange, options, className, ariaLabel, disabled }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; className?: string; ariaLabel?: string; disabled?: boolean }) {
  return (
    <select disabled={disabled} aria-label={ariaLabel} className={cx(inputCls, "pr-6", className)} value={String(value)} onChange={(e) => onChange((typeof value === "number" ? Number(e.target.value) : e.target.value) as T)}>
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={cx("relative h-4 w-7 rounded-full border transition-colors", checked ? "border-accent bg-accent" : "border-border-control bg-bg-hover")}>
        <span className={cx("absolute top-[1px] h-3 w-3 rounded-full transition-all", checked ? "left-[13px] bg-accent-on" : "left-[1px] bg-text-secondary")} />
      </button>
      {label}
    </label>
  );
}

export function Section({ title, children, right }: { title: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="label-caps">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

export function MenuItem({ icon, label, shortcut, onClick, danger, disabled, hint }: { icon?: ReactNode; label: ReactNode; shortcut?: string; onClick: () => void; danger?: boolean; disabled?: boolean; hint?: string }) {
  return (
    <button disabled={disabled} title={hint} onClick={onClick} className={cx("flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-sm hover:bg-bg-hover disabled:opacity-40", danger ? "text-status-error" : "text-text-primary")}>
      <span className="flex w-4 justify-center text-text-secondary">{icon}</span>
      <span className="flex-1">{label}</span>
      {shortcut && <Kbd>{shortcut}</Kbd>}
    </button>
  );
}
