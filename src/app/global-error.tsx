"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("WoodTek root error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#020617",
          color: "#e2e8f0",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <main
          style={{
            width: "min(520px, calc(100vw - 32px))",
            padding: 28,
            border: "1px solid #334155",
            borderRadius: 18,
            background: "#0f172a",
          }}
        >
          <div
            style={{
              color: "#f59e0b",
              fontWeight: 800,
              fontSize: 12,
              letterSpacing: 1.2,
            }}
          >
            WOODTEK ERP
          </div>

          <h1 style={{ margin: "8px 0", color: "white", fontSize: 24 }}>
            The application could not start
          </h1>

          <p
            style={{
              margin: "0 0 20px",
              color: "#94a3b8",
              lineHeight: 1.6,
              fontSize: 14,
            }}
          >
            Check the PowerShell window running WoodTek ERP. Common causes are
            an invalid DATABASE_URL, missing PostgreSQL tables, or a missing
            AUTH_SECRET.
          </p>

          {error?.message ? (
            <pre
              style={{
                overflow: "auto",
                padding: 12,
                borderRadius: 10,
                background: "#020617",
                border: "1px solid #1e293b",
                color: "#fda4af",
                fontSize: 11,
                whiteSpace: "pre-wrap",
              }}
            >
              {error.message}
            </pre>
          ) : null}

          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 20,
              border: 0,
              borderRadius: 10,
              background: "#f59e0b",
              color: "#020617",
              padding: "10px 16px",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}