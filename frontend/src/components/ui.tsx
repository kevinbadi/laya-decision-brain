import type { ReactNode } from "react";

export function Panel({
  title,
  kicker,
  right,
  children,
  className = "",
}: {
  title?: ReactNode;
  kicker?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-line bg-panel/90 backdrop-blur ${className}`}>
      {(title || right) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            {kicker && <div className="label mb-0.5">{kicker}</div>}
            {title && <h2 className="truncate text-[15px] font-semibold tracking-tight">{title}</h2>}
          </div>
          {right}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stage({
  n,
  title,
  caption,
  right,
  children,
  delay = 0,
}: {
  n: number;
  title: string;
  caption?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  delay?: number;
}) {
  return (
    <div className="rise relative pl-10" style={{ animationDelay: `${delay}ms` }}>
      <div className="absolute left-0 top-0 flex h-7 w-7 items-center justify-center rounded-full border border-amber/50 bg-bg font-mono text-[11px] text-amber">
        {n}
      </div>
      <div className="absolute bottom-[-18px] left-[13.5px] top-8 w-px bg-gradient-to-b from-amber/30 to-transparent" />
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-semibold tracking-tight">{title}</h3>
          {caption && <p className="mt-0.5 max-w-2xl text-[12.5px] leading-snug text-dim">{caption}</p>}
        </div>
        {right}
      </div>
      <div className="rounded-lg border border-line bg-raised/60 p-3">{children}</div>
    </div>
  );
}

export function Bar({
  label,
  value,
  max = 1,
  ghost,
  tone = "amber",
  suffix,
  mark,
  strong,
}: {
  label: ReactNode;
  value: number;
  max?: number;
  ghost?: number;
  tone?: "amber" | "teal" | "rose" | "sky" | "dim";
  suffix?: ReactNode;
  mark?: ReactNode;
  strong?: boolean;
}) {
  const w = (v: number) => `${Math.max(0, Math.min(1, v / max)) * 100}%`;
  const fill = {
    amber: "bg-amber",
    teal: "bg-teal",
    rose: "bg-rose",
    sky: "bg-sky",
    dim: "bg-faint",
  }[tone];
  return (
    <div className="grid grid-cols-[minmax(0,11rem)_1fr_4.5rem] items-center gap-3 py-[3px]">
      <div className={`flex min-w-0 items-center gap-1.5 truncate text-[12.5px] ${strong ? "text-ink font-medium" : "text-ink/80"}`}>
        {mark}
        <span className="truncate">{label}</span>
      </div>
      <div className="relative h-2.5 overflow-hidden rounded-sm bg-bg">
        {ghost !== undefined && (
          <div className="absolute inset-y-0 left-0 border-r border-ink/40 bg-ink/10" style={{ width: w(ghost) }} />
        )}
        <div className={`absolute inset-y-0 left-0 ${fill} transition-[width] duration-300`} style={{ width: w(value) }} />
      </div>
      <div className="text-right font-mono text-[11.5px] tabular-nums text-ink/90">{suffix}</div>
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: string }) {
  return (
    <div className="min-w-0">
      <div className="label">{label}</div>
      <div className={`mt-0.5 font-mono text-[15px] tabular-nums ${tone ?? "text-ink"}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-dim">{hint}</div>}
    </div>
  );
}

export function Pill({ children, tone = "dim" }: { children: ReactNode; tone?: "dim" | "amber" | "teal" | "rose" }) {
  const cls = {
    dim: "border-line text-dim",
    amber: "border-amber/40 text-amber bg-amber/5",
    teal: "border-teal/40 text-teal bg-teal/5",
    rose: "border-rose/40 text-rose bg-rose/5",
  }[tone];
  return <span className={`inline-flex items-center rounded-full border px-2 py-[1px] font-mono text-[10.5px] ${cls}`}>{children}</span>;
}

export function Button({
  children,
  onClick,
  disabled,
  variant = "primary",
  className = "",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost";
  className?: string;
  title?: string;
}) {
  const base = "inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-[13px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40";
  const v =
    variant === "primary"
      ? "bg-amber text-bg hover:bg-[#ffc670] shadow-[0_0_24px_-6px_rgb(255_181_71/0.6)]"
      : "border border-line text-ink/85 hover:border-faint hover:bg-raised";
  return (
    <button type="button" title={title} onClick={onClick} disabled={disabled} className={`${base} ${v} ${className}`}>
      {children}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-line bg-bg p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded px-2.5 py-1 text-[12px] transition ${
            value === o.value ? "bg-raised text-amber" : "text-dim hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
