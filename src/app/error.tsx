"use client";

import { useEffect } from "react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("WoodTek page error:", error);
  }, [error]);

  return (
    <div className="grid min-h-screen place-items-center bg-slate-950 p-4 text-slate-100">
      <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-7 shadow-2xl">
        <div className="text-xs font-black uppercase tracking-widest text-amber-400">
          WoodTek ERP
        </div>

        <h1 className="mt-2 text-2xl font-black text-white">
          This page could not load
        </h1>

        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          Try again. If the problem continues, inspect the PowerShell server
          output and verify the database connection.
        </p>

        {error?.message ? (
          <pre className="mt-4 max-h-44 overflow-auto whitespace-pre-wrap rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs text-rose-300">
            {error.message}
          </pre>
        ) : null}

        <button
          type="button"
          onClick={reset}
          className="mt-5 rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-black text-slate-950 hover:bg-amber-400"
        >
          Try again
        </button>
      </div>
    </div>
  );
}