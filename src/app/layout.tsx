import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "WoodTek ERP | Furniture Service Center Manufacturing Platform",
  description: "Advanced order tracking, shop floor machine scheduling, real-time workflow operation routing, and touchscreen operator controls for furniture service centers.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-slate-950 text-slate-100 antialiased overflow-hidden selection:bg-amber-500 selection:text-slate-950">
        {children}
      </body>
    </html>
  );
}
