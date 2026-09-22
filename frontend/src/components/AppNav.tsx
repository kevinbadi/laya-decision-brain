import Link from "next/link";

export function AppNav({ here }: { here: "survey" | "snake" }) {
  const tab = (href: string, id: "survey" | "snake", label: string, hint: string) => (
    <Link
      href={href}
      className={`rounded-full px-4 py-2 text-[14px] font-semibold tracking-tight transition ${
        here === id ? "bg-amber text-bg shadow-[0_0_24px_-6px_rgb(255_181_71/0.7)]" : "text-ink/70 hover:text-ink"
      }`}
    >
      {label}
      <span className={`ml-2 text-[11px] font-normal ${here === id ? "text-bg/70" : "text-dim"}`}>{hint}</span>
    </Link>
  );
  return (
    <nav className="inline-flex items-center rounded-full border border-line bg-panel p-1">
      {tab("/", "survey", "Survey", "ask Laya")}
      {tab("/snake", "snake", "Snake", "watch it play")}
    </nav>
  );
}
