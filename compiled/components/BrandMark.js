"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = BrandMark;
const jsx_runtime_1 = require("react/jsx-runtime");
/**
 * BrandMark — the WoodTek "WT" monogram, used across the sidebar, sign-in
 * screen and header. A single source of truth for the brand tile.
 */
function BrandMark({ size = 40, className = "", }) {
    return ((0, jsx_runtime_1.jsxs)("span", { className: `relative inline-flex shrink-0 select-none items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 via-amber-500 to-amber-700 font-black text-slate-950 shadow-lg shadow-amber-950/50 ring-1 ring-inset ring-white/25 ${className}`, style: { width: size, height: size, fontSize: Math.round(size * 0.4) }, "aria-hidden": "true", children: [(0, jsx_runtime_1.jsx)("span", { className: "translate-y-[1px] tracking-tighter", children: "WT" }), (0, jsx_runtime_1.jsx)("span", { className: "pointer-events-none absolute inset-x-[18%] top-[18%] h-[26%] rounded-full bg-white/25 blur-[1px]" })] }));
}
