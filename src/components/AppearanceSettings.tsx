"use client";

// ============================================================================
// Settings → Appearance & Branding.
// One place that controls how the app looks (dark / light) and who the
// documents say they are from (factory name, logo, contact details).
// Stored in data/appearance.json — survives updates and full backups.
// ============================================================================

import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ImagePlus,
  Loader2,
  Moon,
  Palette,
  RotateCcw,
  Sun,
  Trash2,
  Upload,
} from "lucide-react";
import { useAppearance } from "@/lib/appearanceContext";
import {
  APPEARANCE_DEFAULTS,
  contactLines,
  documentBrandLine,
  FACTORY_NAME_MAX,
  LOGO_MAX_CHARS,
  sanitizeAppearance,
  type AppearanceConfig,
} from "@/lib/appearance";

/** Logos are drawn small on documents — 256px is plenty and keeps the JSON tiny. */
const LOGO_MAX_PX = 256;
const LOGO_INPUT_MAX_BYTES = 5 * 1024 * 1024;

const fieldClass =
  "w-full bg-slate-950/60 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500";
const labelClass = "block text-[10px] font-black uppercase tracking-[0.14em] text-slate-400 mb-1.5";

/** Downscale to a data URL the documents and the app can both render. */
function fileToLogo(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("That file is not an image."));
      return;
    }
    if (file.size > LOGO_INPUT_MAX_BYTES) {
      reject(new Error("That image is larger than 5 MB — pick a smaller file."));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That file is not a readable image."));
      img.onload = () => {
        const scale = Math.min(1, LOGO_MAX_PX / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("This browser cannot process images."));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        // PNG keeps transparency so the logo sits cleanly on the dark
        // document header band; anything else is flattened to JPEG.
        const url =
          file.type === "image/png"
            ? canvas.toDataURL("image/png")
            : canvas.toDataURL("image/jpeg", 0.9);
        if (url.length > LOGO_MAX_CHARS) {
          reject(new Error("That logo is still too large after resizing — try a simpler image."));
          return;
        }
        resolve(url);
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

/** Miniature of the invoice/statement document header, so the effect is visible. */
function DocumentPreview({ draft }: { draft: AppearanceConfig }) {
  const contacts = contactLines(draft).slice(0, 4);
  return (
    <div
      className="rounded-xl overflow-hidden border border-slate-800/80"
      style={{ background: "#0f172a" }}
    >
      <div className="flex items-start justify-between gap-3 p-3.5">
        <div className="flex items-center gap-2.5 min-w-0">
          {draft.logoDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={draft.logoDataUrl}
              alt=""
              className="h-9 w-9 rounded-lg object-contain"
              style={{ background: "#ffffff22" }}
            />
          ) : (
            <span
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[11px] font-black"
              style={{ background: "#f59e0b", color: "#0f172a" }}
            >
              WT
            </span>
          )}
          <div className="min-w-0">
            <div className="truncate text-[13px] font-black tracking-wide" style={{ color: "#f59e0b" }}>
              {(draft.factoryName || "Your factory name").toUpperCase()}
            </div>
            <div className="truncate text-[9px] font-bold uppercase tracking-[0.14em]" style={{ color: "#cbd5e1" }}>
              {draft.tagline || "Tagline · appears under the name"}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] font-black" style={{ color: "#ffffff" }}>
            VAT INVOICE
          </div>
          <div className="text-[9px] font-bold" style={{ color: "#94a3b8" }}>
            INV-2026-0148
          </div>
        </div>
      </div>
      <div className="px-3.5 pb-2.5 text-[9px] leading-relaxed" style={{ color: "#94a3b8" }}>
        {contacts.length > 0 ? (
          contacts.join("  ·  ")
        ) : (
          <span className="italic">Address · phone · email · reg. number appear here on every document</span>
        )}
      </div>
      <div className="h-1" style={{ background: "#f59e0b" }} />
      <div className="px-3.5 py-2 text-[9px] text-center" style={{ background: "#1e293b", color: "#64748b" }}>
        {documentBrandLine(draft) || "WoodTek ERP"} · Footer line on every printed page
      </div>
    </div>
  );
}

export default function AppearanceSettings() {
  const { appearance, save, saving } = useAppearance();
  const [draft, setDraft] = useState<AppearanceConfig>(appearance);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [logoBusy, setLogoBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Re-sync when the stored config arrives (or changes elsewhere).
  useEffect(() => {
    setDraft(appearance);
  }, [appearance]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(appearance);
  const set = <K extends keyof AppearanceConfig>(key: K, value: AppearanceConfig[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setSaved(false);
  };

  const pickTheme = (theme: AppearanceConfig["theme"]) => {
    set("theme", theme);
    // Instant feedback — the full save happens with the button below.
    document.documentElement.dataset.theme = theme;
  };

  const onLogoPicked = async (file: File | undefined) => {
    if (!file) return;
    setLogoBusy(true);
    setError("");
    try {
      set("logoDataUrl", await fileToLogo(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not use that image.");
    } finally {
      setLogoBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const onSave = async () => {
    setError("");
    try {
      await save(sanitizeAppearance(draft));
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    }
  };

  const onReset = () => {
    setDraft({ ...APPEARANCE_DEFAULTS, theme: draft.theme });
    setSaved(false);
  };

  return (
    <div className="space-y-6">
      {/* ---------------- Theme ---------------- */}
      <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-6 shadow-sm">
        <h2 className="text-sm font-black text-white flex items-center gap-2">
          <Palette className="w-4 h-4 text-amber-400" />
          App look
        </h2>
        <p className="text-xs text-slate-400 mt-1">
          Applies to every screen on every PC in the factory. Printed documents keep their own
          house style either way.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 mt-4">
          {(
            [
              {
                mode: "dark" as const,
                icon: Moon,
                title: "Dark",
                blurb: "The look the app has always had.",
                swatch: "bg-slate-950 border-slate-700",
                ink: "bg-slate-700",
              },
              {
                mode: "light" as const,
                icon: Sun,
                title: "Light",
                blurb: "Bright surfaces — better in a sunlit office.",
                swatch: "bg-slate-100 border-slate-300",
                ink: "bg-slate-400",
              },
            ] as const
          ).map((opt) => {
            const active = draft.theme === opt.mode;
            const Icon = opt.icon;
            return (
              <button
                key={opt.mode}
                type="button"
                onClick={() => pickTheme(opt.mode)}
                className={`flex items-center gap-3 rounded-2xl border p-4 text-left transition ${
                  active
                    ? "border-amber-500 bg-amber-500/10 shadow-lg shadow-amber-500/20"
                    : "border-slate-800 bg-slate-950/60 hover:border-slate-700"
                }`}
              >
                <span className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${opt.swatch}`}>
                  <Icon className={`h-5 w-5 ${active ? "text-amber-400" : "text-slate-400"}`} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-black text-white">{opt.title}</span>
                  <span className="block text-[11px] text-slate-400">{opt.blurb}</span>
                </span>
                {active && <CheckCircle2 className="ml-auto h-5 w-5 shrink-0 text-amber-400" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* ---------------- Factory identity ---------------- */}
      <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-6 shadow-sm">
        <h2 className="text-sm font-black text-white flex items-center gap-2">
          <ImagePlus className="w-4 h-4 text-amber-400" />
          Factory identity
        </h2>
        <p className="text-xs text-slate-400 mt-1">
          The app is WoodTek ERP — this is the name your clients see on invoices, quotes, delivery
          notes, job tickets and reports.
        </p>

        <div className="grid gap-5 lg:grid-cols-[1fr_320px] mt-4">
          <div className="space-y-4">
            <div>
              <label className={labelClass}>Factory name</label>
              <input
                className={fieldClass}
                value={draft.factoryName}
                maxLength={FACTORY_NAME_MAX}
                placeholder="e.g. Cedars Woodworks SAL"
                onChange={(e) => set("factoryName", e.target.value)}
              />
            </div>
            <div>
              <label className={labelClass}>Tagline</label>
              <input
                className={fieldClass}
                value={draft.tagline}
                placeholder="e.g. Furniture Service Center"
                onChange={(e) => set("tagline", e.target.value)}
              />
            </div>
            <div>
              <label className={labelClass}>Logo</label>
              <div className="flex items-center gap-3">
                <div
                  className="inline-flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-800"
                  style={{ background: "#0f172a" }}
                >
                  {draft.logoDataUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={draft.logoDataUrl} alt="" className="h-full w-full object-contain p-1" />
                  ) : (
                    <span className="text-lg font-black text-amber-500">WT</span>
                  )}
                </div>
                <div className="space-y-1.5">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      disabled={logoBusy}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-1.5 text-[11px] font-bold text-slate-200 hover:border-amber-500 disabled:opacity-50"
                    >
                      {logoBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                      {draft.logoDataUrl ? "Replace" : "Upload logo"}
                    </button>
                    {draft.logoDataUrl && (
                      <button
                        type="button"
                        onClick={() => set("logoDataUrl", "")}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-800 px-3 py-1.5 text-[11px] font-bold text-slate-400 hover:border-rose-500/60 hover:text-rose-300"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Remove
                      </button>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-500">
                    PNG with transparency looks best on the dark document header. Resized to{" "}
                    {LOGO_MAX_PX}px automatically.
                  </p>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg"
                  className="hidden"
                  onChange={(e) => void onLogoPicked(e.target.files?.[0])}
                />
              </div>
            </div>
          </div>

          <div>
            <div className={labelClass}>How your documents will look</div>
            <DocumentPreview draft={draft} />
          </div>
        </div>
      </div>

      {/* ---------------- Document details ---------------- */}
      <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-6 shadow-sm">
        <h2 className="text-sm font-black text-white flex items-center gap-2">
          <Upload className="w-4 h-4 text-amber-400" />
          Details printed on documents
        </h2>
        <p className="text-xs text-slate-400 mt-1">
          Everything here is optional — leave a field empty and it simply does not print.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 mt-4">
          <div>
            <label className={labelClass}>Address line 1</label>
            <input
              className={fieldClass}
              value={draft.addressLine1}
              placeholder="e.g. Mkalles Road, Industrial Zone"
              onChange={(e) => set("addressLine1", e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>Address line 2</label>
            <input
              className={fieldClass}
              value={draft.addressLine2}
              placeholder="e.g. Beirut, Lebanon"
              onChange={(e) => set("addressLine2", e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>Phone</label>
            <input
              className={fieldClass}
              value={draft.phone}
              placeholder="e.g. +961 1 234 567"
              onChange={(e) => set("phone", e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>Email</label>
            <input
              className={fieldClass}
              type="email"
              value={draft.email}
              placeholder="e.g. sales@factory.com"
              onChange={(e) => set("email", e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>Website</label>
            <input
              className={fieldClass}
              value={draft.website}
              placeholder="e.g. www.factory.com"
              onChange={(e) => set("website", e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>Commercial register / tax no.</label>
            <input
              className={fieldClass}
              value={draft.taxId}
              placeholder="e.g. 1234567"
              onChange={(e) => set("taxId", e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>Footer line (optional override)</label>
            <input
              className={fieldClass}
              value={draft.documentFooter}
              placeholder="Leave empty to use the factory name + tagline"
              onChange={(e) => set("documentFooter", e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* ---------------- Save bar ---------------- */}
      <div className="sticky bottom-0 z-10 -mx-6 px-6 py-3 bg-slate-950/90 backdrop-blur border-t border-slate-800/80 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void onSave()}
          disabled={saving || !dirty}
          className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-5 py-2.5 text-xs font-black text-slate-950 shadow-lg shadow-amber-500/30 transition hover:bg-amber-400 disabled:opacity-40 disabled:shadow-none"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {saving ? "Saving…" : "Save appearance"}
        </button>
        <button
          type="button"
          onClick={onReset}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-800 px-4 py-2.5 text-xs font-bold text-slate-300 hover:border-slate-600 disabled:opacity-40"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset fields
        </button>
        {dirty && <span className="text-[11px] font-bold text-amber-300">Unsaved changes</span>}
        {saved && !dirty && (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Saved — documents and every screen now use these details.
          </span>
        )}
        {error && <span className="text-[11px] font-bold text-rose-300">{error}</span>}
      </div>
    </div>
  );
}
