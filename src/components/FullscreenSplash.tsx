"use client";

import React, { useEffect, useState } from "react";

/**
 * FullscreenSplash
 * ----------------------------------------------------------------------------
 * A beautiful, full-screen animated splash shown to every user when they log
 * in. Appears on top of the app, shows a welcome message with the user's
 * name and role, and auto-closes once the dashboard is ready (or after a
 * short timeout).
 *
 * Used in src/app/page.tsx - it shows whenever currentUser is set AND
 * dashboardData is still loading.
 */
export default function FullscreenSplash({
  user,
  isLoading,
  onClose,
}: {
  user: { name: string; role: string; avatarColor?: string } | null;
  isLoading: boolean;
  onClose: () => void;
}) {
  const [closing, setClosing] = useState(false);
  const [minTimePassed, setMinTimePassed] = useState(false);

  // Always show the splash for at least 5 seconds so the animation is
  // fully enjoyed. The minimum is the longer of:
  //   - 5 seconds (so the animation is fully visible)
  //   - until the dashboard is loaded
  useEffect(() => {
    const t1 = setTimeout(() => setMinTimePassed(true), 5000);
    return () => clearTimeout(t1);
  }, []);

  // Auto-close when both conditions are met: min time passed AND loading done
  useEffect(() => {
    if (minTimePassed && !isLoading) {
      setClosing(true);
      const t = setTimeout(onClose, 600); // wait for fade-out
      return () => clearTimeout(t);
    }
    // Hard cap: never show for more than 8 seconds
    const hardCap = setTimeout(() => {
      setClosing(true);
      setTimeout(onClose, 600);
    }, 8000);
    return () => clearTimeout(hardCap);
  }, [minTimePassed, isLoading, onClose]);

  if (!user) return null;

  const firstName = user.name.split(" ")[0];
  const initials = user.name
    .split(" ")
    .map((n) => n.charAt(0).toUpperCase())
    .slice(0, 2)
    .join("");

  return (
    <div
      className={`fullscreen-splash ${closing ? "closing" : ""}`}
      role="dialog"
      aria-label="Welcome to WoodTek ERP"
    >
      <style>{`
        .fullscreen-splash {
          position: fixed;
          inset: 0;
          z-index: 9999;
          background:
            radial-gradient(ellipse 80% 60% at 50% 0%, rgba(245, 158, 11, 0.12) 0%, transparent 55%),
            radial-gradient(ellipse 60% 50% at 100% 100%, rgba(59, 130, 246, 0.10) 0%, transparent 55%),
            radial-gradient(ellipse 70% 50% at 0% 100%, rgba(245, 158, 11, 0.06) 0%, transparent 55%),
            linear-gradient(180deg, #020617 0%, #0b1220 50%, #020617 100%);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 32px;
          font-family: "Segoe UI Variable Display", "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif;
          color: #e2e8f0;
          animation: splashIn 0.5s ease-out forwards;
        }
        .fullscreen-splash.closing { animation: splashOut 0.6s ease-in forwards; }
        @keyframes splashIn  { from { opacity: 0; transform: scale(1.05); } to { opacity: 1; transform: scale(1); } }
        @keyframes splashOut { to   { opacity: 0; transform: scale(1.02); } }

        /* Grid background */
        .fs-bg {
          position: absolute; inset: 0;
          background-image:
            linear-gradient(rgba(148, 163, 184, 0.05) 1px, transparent 1px),
            linear-gradient(90deg, rgba(148, 163, 184, 0.05) 1px, transparent 1px);
          background-size: 56px 56px;
          mask-image: radial-gradient(ellipse at center, black 0%, transparent 75%);
          -webkit-mask-image: radial-gradient(ellipse at center, black 0%, transparent 75%);
          animation: gridDrift 30s linear infinite;
          pointer-events: none;
        }
        @keyframes gridDrift { from { background-position: 0 0; } to { background-position: 560px 560px; } }

        /* Floating particles */
        .fs-particles { position: absolute; inset: 0; pointer-events: none; z-index: 0; }
        .fs-particle {
          position: absolute;
          width: 4px; height: 4px; border-radius: 50%;
          background: rgba(245, 158, 11, 0.5);
          box-shadow: 0 0 12px rgba(245, 158, 11, 0.6);
          animation: floatUp 12s linear infinite;
          opacity: 0;
        }
        @keyframes floatUp {
          0%   { transform: translateY(110vh) translateX(0);    opacity: 0; }
          8%   { opacity: 0.8; }
          92%  { opacity: 0.8; }
          100% { transform: translateY(-10vh) translateX(40px); opacity: 0; }
        }

        .fs-stage {
          position: relative; z-index: 1;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          max-width: 720px;
        }

        /* Logo */
        .fs-logo {
          position: relative;
          width: 160px; height: 160px;
          margin-bottom: 32px;
        }
        .fs-logo-ring {
          position: absolute; inset: 0;
          border-radius: 50%;
          border: 3px solid transparent;
          border-top-color: #f59e0b;
          border-right-color: rgba(245, 158, 11, 0.3);
          animation: spin 2.4s linear infinite;
        }
        .fs-logo-ring.r2 { inset: 12px; border-top-color: #3b82f6; border-right-color: rgba(59, 130, 246, 0.3); animation: spinReverse 3.2s linear infinite; }
        .fs-logo-ring.r3 { inset: 24px; border-top-color: rgba(245, 158, 11, 0.5); animation: spin 4.8s linear infinite; }
        @keyframes spin        { to { transform: rotate(360deg); } }
        @keyframes spinReverse { to { transform: rotate(-360deg); } }

        .fs-logo-disc {
          position: absolute; inset: 36px;
          border-radius: 28px;
          background: linear-gradient(135deg, #f59e0b 0%, #b45309 100%);
          display: flex; align-items: center; justify-content: center;
          box-shadow:
            0 0 60px rgba(245, 158, 11, 0.45),
            inset 0 2px 0 rgba(255, 255, 255, 0.25),
            inset 0 -4px 8px rgba(0, 0, 0, 0.2);
          font-weight: 900; font-size: 64px; color: #0b1220;
          letter-spacing: -2px;
          animation: discBreathe 3s ease-in-out infinite;
        }
        @keyframes discBreathe {
          0%, 100% { transform: scale(1); }
          50%      { transform: scale(1.05); }
        }

        /* Brand */
        .fs-brand {
          display: flex; align-items: baseline; gap: 10px;
          margin-bottom: 6px;
        }
        .fs-brand-name {
          font-size: 42px; font-weight: 800; color: #f1f5f9;
          letter-spacing: -1px;
        }
        .fs-brand-badge {
          font-size: 14px; font-weight: 800; color: #f59e0b;
          background: rgba(245, 158, 11, 0.12);
          border: 1px solid rgba(245, 158, 11, 0.3);
          padding: 3px 10px; border-radius: 6px; letter-spacing: 1.5px;
        }
        .fs-tagline {
          font-size: 16px; color: #94a3b8; font-weight: 500;
          margin-bottom: 36px;
        }

        /* Welcome card */
        .fs-welcome {
          background: rgba(15, 23, 42, 0.65);
          border: 1px solid rgba(148, 163, 184, 0.15);
          border-radius: 24px;
          padding: 28px 36px;
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          box-shadow: 0 30px 80px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.05);
          display: flex; align-items: center; gap: 22px;
          min-width: 460px;
        }
        .fs-avatar {
          width: 64px; height: 64px; border-radius: 16px;
          display: flex; align-items: center; justify-content: center;
          font-weight: 800; font-size: 24px; color: white;
          flex-shrink: 0;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        }
        .fs-welcome-text { text-align: left; flex: 1; }
        .fs-welcome-eyebrow {
          font-size: 11px; color: #94a3b8; font-weight: 600;
          text-transform: uppercase; letter-spacing: 2px;
          margin-bottom: 4px;
        }
        .fs-welcome-name {
          font-size: 22px; font-weight: 700; color: #f1f5f9;
          margin-bottom: 2px;
        }
        .fs-welcome-role {
          font-size: 13px; color: #f59e0b; font-weight: 600;
        }

        /* Status + progress */
        .fs-status {
          margin-top: 32px;
          display: flex; flex-direction: column; align-items: center; gap: 12px;
        }
        .fs-status-text {
          font-size: 13px; color: #cbd5e1; font-weight: 500;
          display: flex; align-items: center; gap: 8px;
        }
        .fs-spinner {
          width: 14px; height: 14px;
          border: 2px solid rgba(245, 158, 11, 0.2);
          border-top-color: #f59e0b;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }
        .fs-progress {
          width: 280px; height: 4px;
          background: rgba(148, 163, 184, 0.15);
          border-radius: 999px;
          overflow: hidden;
        }
        .fs-progress-bar {
          height: 100%; width: 0%;
          background: linear-gradient(90deg, #f59e0b, #fbbf24);
          border-radius: 999px;
          animation: progressFill 5s ease-out forwards;
        }
        @keyframes progressFill { to { width: 100%; } }

        /* Skip button */
        .fs-skip {
          position: absolute; top: 20px; right: 24px;
          background: rgba(15, 23, 42, 0.5);
          border: 1px solid rgba(148, 163, 184, 0.15);
          color: #94a3b8;
          font-size: 12px; font-weight: 600;
          padding: 7px 14px;
          border-radius: 999px;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .fs-skip:hover {
          color: #f1f5f9;
          border-color: rgba(245, 158, 11, 0.4);
          background: rgba(245, 158, 11, 0.08);
        }
      `}</style>

      {/* Animated background */}
      <div className="fs-bg" />
      <div className="fs-particles" id="fs-particles" />

      {/* Skip button (top-right) - lets impatient users dismiss early */}
      <button className="fs-skip" onClick={() => { setClosing(true); setTimeout(onClose, 400); }}>
        Skip ›
      </button>

      <div className="fs-stage">
        {/* Animated logo with 3 rings + breathing disc */}
        <div className="fs-logo">
          <div className="fs-logo-ring" />
          <div className="fs-logo-ring r2" />
          <div className="fs-logo-ring r3" />
          <div className="fs-logo-disc">WT</div>
        </div>

        {/* Brand */}
        <div className="fs-brand">
          <span className="fs-brand-name">WoodTek ERP</span>
          <span className="fs-brand-badge">PRO</span>
        </div>
        <div className="fs-tagline">Furniture Service Center</div>

        {/* Welcome card */}
        <div className="fs-welcome">
          <div
            className="fs-avatar"
            style={{ background: user.avatarColor || "bg-amber-600" }}
          >
            {initials}
          </div>
          <div className="fs-welcome-text">
            <div className="fs-welcome-eyebrow">Welcome back</div>
            <div className="fs-welcome-name">{user.name}</div>
            <div className="fs-welcome-role">{user.role}</div>
          </div>
        </div>

        {/* Status + progress */}
        <div className="fs-status">
          <div className="fs-status-text">
            <div className="fs-spinner" />
            <span>Initializing your workspace</span>
          </div>
          <div className="fs-progress">
            <div className="fs-progress-bar" />
          </div>
        </div>
      </div>

      {/* Spawn particles on mount */}
      <Particles />
    </div>
  );
}

function Particles() {
  useEffect(() => {
    const c = document.getElementById("fs-particles");
    if (!c) return;
    const colors = [
      "rgba(245, 158, 11, 0.6)",
      "rgba(59, 130, 246, 0.5)",
      "rgba(16, 185, 129, 0.4)",
    ];
    for (let i = 0; i < 30; i++) {
      const p = document.createElement("div");
      p.className = "fs-particle";
      p.style.left = Math.random() * 100 + "%";
      p.style.background = colors[i % colors.length];
      p.style.boxShadow = "0 0 10px " + colors[i % colors.length];
      p.style.animationDelay = Math.random() * 12 + "s";
      p.style.animationDuration = 10 + Math.random() * 8 + "s";
      const s = 2 + Math.random() * 4;
      p.style.width = s + "px";
      p.style.height = s + "px";
      c.appendChild(p);
    }
  }, []);
  return null;
}
