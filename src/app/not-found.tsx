// 404 fallback — shown for any URL that is not the WoodTek workspace or an API
// route (for example an old bookmark, a typed address, or a scanned sticker whose
// link was trimmed). Server component: no state, renders instantly.
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center bg-slate-950 p-4 text-slate-100">
      <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-7 shadow-2xl">
        <div className="text-xs font-black uppercase tracking-widest text-amber-400">
          WoodTek ERP
        </div>

        <h1 className="mt-2 text-2xl font-black text-white">Page not found</h1>

        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          This address does not exist in WoodTek ERP. It may be an old bookmark or a
          link that was cut short — nothing was changed or deleted.
        </p>

        <p className="mt-3 rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs leading-relaxed text-slate-400">
          Tip: the shop-floor QR stickers open the app at
          <span className="font-mono text-amber-300"> /?order=&lt;id&gt;</span>. If a scan
          lands here, reprint the sticker from the order&rsquo;s QR Sticker button.
        </p>

        <Link
          href="/"
          className="mt-5 inline-block rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-black text-slate-950 hover:bg-amber-400"
        >
          Back to WoodTek ERP
        </Link>
      </div>
    </div>
  );
}
