// ============================================================================
// SMTP settings API — one factory-wide email account.
//
// GET    any signed-in user — returns the MASKED config (pass is "***" or
//        empty, plus a hasPass flag). The clear password never leaves the
//        server.
// PUT    Manager only — saves host/port/secure/user/pass/fromName/fromEmail.
//        A pass of "***" (the mask placeholder) keeps the stored password.
// POST   Manager only — { action: "test", to } sends a test email through
//        the configured account via nodemailer.
// ============================================================================

import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { authorize } from "@/lib/auth";
import { logAudit } from "@/lib/audit.server";
import {
  buildFromHeader,
  isEmailConfigured,
  maskEmailConfig,
  sanitizeEmailConfig,
  validateEmailConfig,
  EMAIL_CONFIG_PLACEHOLDER,
} from "@/lib/emailConfig";
import {
  buildEmailHtmlBody,
  buildEmailTextBody,
  describeSendError,
  parseRecipients,
} from "@/lib/emailDispatch";
import { readEmailConfig, writeEmailConfig } from "@/lib/emailConfig.server";

function makeTransporter(cfg: ReturnType<typeof readEmailConfig>) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
  });
}

export async function GET(request: Request) {
  const { error: authError } = await authorize();
  if (authError) return authError;
  return NextResponse.json(maskEmailConfig(readEmailConfig()));
}

export async function PUT(request: Request) {
  const { user, error: authError } = await authorize("users:manage");
  if (authError || !user) return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const incoming = sanitizeEmailConfig(body);
  const stored = readEmailConfig();
  const next = {
    ...incoming,
    // The UI sends the mask placeholder back when the password was not
    // changed — keep what is on disk in that case.
    pass: incoming.pass === EMAIL_CONFIG_PLACEHOLDER ? stored.pass : incoming.pass,
  };

  const problem = validateEmailConfig(next);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  writeEmailConfig(next);
  logAudit(user, "email.config", "settings", `SMTP settings updated (host ${next.host || "—"}, from ${next.fromEmail || "—"})`);
  return NextResponse.json(maskEmailConfig(next));
}

export async function POST(request: Request) {
  const { user, error: authError } = await authorize("users:manage");
  if (authError || !user) return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (String(body?.action ?? "") !== "test") {
    return NextResponse.json({ error: "Only action=test is supported." }, { status: 400 });
  }

  const cfg = readEmailConfig();
  if (!isEmailConfigured(cfg)) {
    return NextResponse.json(
      { error: "SMTP is not configured yet — fill in the host and From email first." },
      { status: 400 },
    );
  }

  const { recipients, rejected } = parseRecipients(body?.to);
  if (!recipients.length) {
    return NextResponse.json(
      { error: rejected[0] ? `Not a valid email address: ${rejected[0]}` : "Enter a valid test recipient." },
      { status: 400 },
    );
  }

  const parts = {
    title: "SMTP test from WoodTek ERP",
    message:
      "This is a test message from the WoodTek ERP SMTP settings panel. " +
      "If you can read this, the mail account in Settings works.",
    senderName: user.name,
    attachments: [] as string[],
  };

  try {
    const transporter = makeTransporter(cfg);
    await transporter.sendMail({
      from: buildFromHeader(cfg),
      to: recipients.join(", "),
      subject: "WoodTek ERP — SMTP test",
      html: buildEmailHtmlBody(parts),
      text: buildEmailTextBody(parts),
    });
    logAudit(user, "email.config.test", "settings", `SMTP test email sent to ${recipients.join(", ")}`);
    return NextResponse.json({ ok: true, message: `Test email sent to ${recipients[0]}.` });
  } catch (err) {
    logAudit(user, "email.config.test", "settings", `SMTP test FAILED: ${describeSendError(err)}`, undefined);
    return NextResponse.json(
      { error: `Could not send the test email: ${describeSendError(err)}` },
      { status: 502 },
    );
  }
}
