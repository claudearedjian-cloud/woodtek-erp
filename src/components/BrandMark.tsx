/**
 * BrandMark — the WoodTek "WT" monogram, used across the sidebar, sign-in
 * screen and header. A single source of truth for the brand tile.
 */
export default function BrandMark({
  size = 40,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={`relative inline-flex shrink-0 select-none items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 via-amber-500 to-amber-700 font-black text-slate-950 shadow-lg shadow-amber-950/50 ring-1 ring-inset ring-white/25 ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
      aria-hidden="true"
    >
      <span className="translate-y-[1px] tracking-tighter">WT</span>
      <span className="pointer-events-none absolute inset-x-[18%] top-[18%] h-[26%] rounded-full bg-white/25 blur-[1px]" />
    </span>
  );
}
