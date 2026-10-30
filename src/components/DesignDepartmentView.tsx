"use client";

import React, { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Archive,
  Ban,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  Download,
  DraftingCompass,
  ExternalLink,
  Eye,
  Factory,
  FileText,
  FileUp,
  Filter,
  History,
  Link2,
  LockKeyhole,
  PauseCircle,
  Pencil,
  PlayCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  DESIGN_APPROVAL_CODE_DEFS,
  DESIGN_DISCIPLINES,
  DESIGN_DRAWING_STATUSES,
  DESIGN_FILE_KINDS,
  DESIGN_PRIORITIES,
  canIssueToProduction,
  designApprovalCodeDef,
  designDrawingStage,
  isWebDesignLink,
  suggestNextDesignRevision,
} from "@/lib/designDepartment";
import {
  DESIGN_FILE_ACCEPT,
  MAX_DESIGN_FILE_BYTES,
  validateDesignFile,
} from "@/lib/designAttachments";

interface DesignDepartmentViewProps {
  currentUser: any;
  onSelectOrder?: (orderId: number) => void;
}

type ModalKind = "drawing" | "submit" | "approval" | "issue" | "resubmit" | "status" | null;

const inputCls =
  "w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-teal-400 focus:outline-none";
const labelCls = "text-[11px] font-black uppercase tracking-wider text-slate-400";
const cardCls = "rounded-2xl border border-slate-800 bg-slate-900/90";

const CODE_CLASSES: Record<string, string> = {
  A: "border-emerald-500/50 bg-emerald-500/15 text-emerald-200",
  B: "border-sky-500/50 bg-sky-500/15 text-sky-200",
  C: "border-amber-500/50 bg-amber-500/15 text-amber-200",
  D: "border-rose-500/50 bg-rose-500/15 text-rose-200",
  none: "border-slate-700 bg-slate-800/80 text-slate-300",
};

const STATUS_CLASSES: Record<string, string> = {
  Draft: "border-slate-600 bg-slate-800 text-slate-200",
  Submitted: "border-sky-500/50 bg-sky-500/15 text-sky-200",
  Returned: "border-violet-500/50 bg-violet-500/15 text-violet-200",
  "Issued to Production": "border-emerald-500/50 bg-emerald-500/15 text-emerald-200",
  "On Hold": "border-amber-500/50 bg-amber-500/15 text-amber-200",
  Superseded: "border-slate-700 bg-slate-900 text-slate-400",
  Cancelled: "border-rose-500/50 bg-rose-500/10 text-rose-300",
};

function todayYmd(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function formatDate(value: unknown): string {
  const raw = String(value ?? "");
  if (!raw) return "—";
  const dayOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const date = new Date(dayOnly ? `${raw}T00:00:00` : raw);
  if (!Number.isFinite(date.getTime())) return raw;
  return date.toLocaleString("en-GB", dayOnly
    ? { day: "2-digit", month: "short", year: "numeric" }
    : { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatBytes(value: unknown): string {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function csvCell(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block space-y-1.5 ${className}`}>
      <span className={labelCls}>{label}</span>
      {children}
    </label>
  );
}

function Modal({
  title,
  subtitle,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/80 p-3 backdrop-blur-sm sm:items-center">
      <div className={`max-h-[92vh] w-full overflow-y-auto rounded-3xl border border-slate-700 bg-slate-900 shadow-2xl ${wide ? "max-w-3xl" : "max-w-xl"}`}>
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-800 bg-slate-900 px-5 py-4">
          <div>
            <h3 className="text-base font-black text-white">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

const blankDrawingForm = () => ({
  drawingNo: "",
  revision: "R0",
  title: "",
  projectName: "",
  clientName: "",
  architectName: "",
  orderId: "",
  discipline: "General Joinery",
  area: "",
  sheetCount: "1",
  priority: "Normal",
  requiredDate: "",
  externalLink: "",
  notes: "",
});

export default function DesignDepartmentView({ currentUser, onSelectOrder }: DesignDepartmentViewProps) {
  const [board, setBoard] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("Active");
  const [codeFilter, setCodeFilter] = useState("All");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [modal, setModal] = useState<ModalKind>(null);
  const [editing, setEditing] = useState<any>(null);
  const [drawingForm, setDrawingForm] = useState(blankDrawingForm());
  const [submitForm, setSubmitForm] = useState({ submittedTo: "", submittedDate: todayYmd(), transmittalNo: "", responseDueDate: "", note: "" });
  const [approvalForm, setApprovalForm] = useState({ approvalCode: "A", approvalBy: "", approvalDate: todayYmd(), approvalComments: "", commentsIncorporated: false });
  const [issueForm, setIssueForm] = useState({ issuedTo: "Production", note: "", confirmCommentsIncorporated: false });
  const [resubmitForm, setResubmitForm] = useState({ revision: "", note: "" });
  const [statusForm, setStatusForm] = useState({ status: "On Hold", note: "" });
  const [busy, setBusy] = useState("");
  const [fileKind, setFileKind] = useState<string>("Drawing PDF/CAD");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isManager = currentUser?.role === "Manager";
  const drawings = useMemo<any[]>(() => (Array.isArray(board?.drawings) ? board.drawings : []), [board]);
  const orders = useMemo<any[]>(() => (Array.isArray(board?.orders) ? board.orders : []), [board]);
  const summary = board?.summary ?? {};

  const requestJson = async (url: string, init?: RequestInit) => {
    const res = await fetch(url, { cache: "no-store", ...init });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Design Department request failed.");
    return data;
  };

  const loadBoard = async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    try {
      const data = await requestJson("/api/design");
      setBoard(data);
      setError("");
      return data;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the Design Department register.");
      return null;
    } finally {
      if (showSpinner) setLoading(false);
    }
  };

  const loadDetail = async (id: number) => {
    setSelectedId(id);
    setDetailLoading(true);
    try {
      const data = await requestJson(`/api/design/${id}`);
      setDetail(data);
      return data;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the drawing details.");
      return null;
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    void loadBoard();
    // Loaded once per signed-in user; manual refresh remains available.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id]);

  const refreshAndSelect = async (id?: number | null) => {
    await loadBoard(false);
    const target = id ?? selectedId;
    if (target) await loadDetail(target);
  };

  const openDetail = (row: any) => {
    setSelectedId(row.id);
    setDetail(row);
    setError("");
    void loadDetail(row.id);
  };

  const closeDetail = () => {
    setSelectedId(null);
    setDetail(null);
  };

  const filteredDrawings = drawings.filter((drawing: any) => {
    if (statusFilter === "Active" && ["Superseded", "Cancelled"].includes(drawing.status)) return false;
    if (statusFilter === "Ready to issue" && !canIssueToProduction(drawing).ok) return false;
    if (statusFilter === "Overdue approvals" && designDrawingStage(drawing) !== "Approval overdue") return false;
    if (statusFilter !== "All" && statusFilter !== "Active" && statusFilter !== "Ready to issue" && statusFilter !== "Overdue approvals" && drawing.status !== statusFilter) return false;
    const code = drawing.approvalCode || "none";
    if (codeFilter !== "All" && code !== codeFilter) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [
      drawing.recordNumber,
      drawing.drawingNo,
      drawing.revision,
      drawing.title,
      drawing.projectName,
      drawing.clientName,
      drawing.architectName,
      drawing.orderSnapshot,
      drawing.transmittalNo,
      drawing.discipline,
      drawing.area,
      drawing.status,
      drawing.stage,
    ].some((value) => String(value ?? "").toLowerCase().includes(q));
  });

  const openNewDrawing = () => {
    setEditing(null);
    setDrawingForm(blankDrawingForm());
    setModal("drawing");
  };

  const openEditDrawing = (drawing: any) => {
    setEditing(drawing);
    setDrawingForm({
      drawingNo: drawing.drawingNo ?? "",
      revision: drawing.revision ?? "",
      title: drawing.title ?? "",
      projectName: drawing.projectName ?? "",
      clientName: drawing.clientName ?? "",
      architectName: drawing.architectName ?? "",
      orderId: drawing.orderId ? String(drawing.orderId) : "",
      discipline: drawing.discipline || "General Joinery",
      area: drawing.area ?? "",
      sheetCount: String(drawing.sheetCount || 1),
      priority: drawing.priority || "Normal",
      requiredDate: drawing.requiredDate ?? "",
      externalLink: drawing.externalLink ?? "",
      notes: drawing.notes ?? "",
    });
    setModal("drawing");
  };

  const onDrawingOrderChange = (orderId: string) => {
    const order = orders.find((item) => String(item.id) === orderId);
    setDrawingForm((current) => ({
      ...current,
      orderId,
      projectName: current.projectName || order?.projectName || "",
      clientName: current.clientName || order?.clientName || "",
    }));
  };

  const saveDrawing = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy("drawing");
    setError("");
    setNotice("");
    try {
      const payload = {
        ...drawingForm,
        orderId: drawingForm.orderId ? Number(drawingForm.orderId) : null,
        sheetCount: Number(drawingForm.sheetCount),
      };
      const result = editing
        ? await requestJson(`/api/design/${editing.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "update", ...payload }),
          })
        : await requestJson("/api/design", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      setModal(null);
      setNotice(editing ? "Drawing details updated." : `Drawing ${result.recordNumber} created as a Draft.`);
      await refreshAndSelect(result.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the drawing.");
    } finally {
      setBusy("");
    }
  };

  const patchDrawing = async (action: string, payload: Record<string, unknown>, success: string, selectResult = false) => {
    if (!detail?.id) return null;
    setBusy(action);
    setError("");
    setNotice("");
    try {
      const result = await requestJson(`/api/design/${detail.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      setModal(null);
      setNotice(success);
      await refreshAndSelect(selectResult ? result.id : detail.id);
      return result;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update the drawing.");
      return null;
    } finally {
      setBusy("");
    }
  };

  const openSubmit = () => {
    setSubmitForm({
      submittedTo: detail?.architectName || detail?.clientName || "",
      submittedDate: todayYmd(),
      transmittalNo: "",
      responseDueDate: "",
      note: "",
    });
    setModal("submit");
  };

  const openApproval = () => {
    setApprovalForm({
      approvalCode: "A",
      approvalBy: detail?.submittedTo || detail?.architectName || detail?.clientName || "",
      approvalDate: todayYmd(),
      approvalComments: "",
      commentsIncorporated: false,
    });
    setModal("approval");
  };

  const openIssue = () => {
    setIssueForm({
      issuedTo: "Production",
      note: "",
      confirmCommentsIncorporated: Boolean(detail?.commentsIncorporated),
    });
    setModal("issue");
  };

  const openResubmit = () => {
    setResubmitForm({ revision: suggestNextDesignRevision(detail?.revision), note: "" });
    setModal("resubmit");
  };

  const openStatus = (status: string) => {
    setStatusForm({ status, note: "" });
    setModal("status");
  };

  const deleteDraft = async () => {
    if (!detail?.id) return;
    if (!confirm(`Delete draft drawing ${detail.drawingNo} revision ${detail.revision}? This cannot be undone.`)) return;
    setBusy("delete");
    setError("");
    try {
      await requestJson(`/api/design/${detail.id}`, { method: "DELETE" });
      closeDetail();
      setNotice("Draft drawing deleted.");
      await loadBoard(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete the draft drawing.");
    } finally {
      setBusy("");
    }
  };

  const uploadFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !detail?.id) return;
    const problem = validateDesignFile(file.name, file.type, file.size);
    if (problem) {
      setError(problem);
      return;
    }
    setUploading(true);
    setError("");
    setNotice("");
    try {
      const form = new FormData();
      form.set("kind", fileKind);
      form.set("file", file);
      const res = await fetch(`/api/design/${detail.id}/files`, { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Drawing file upload failed.");
      setNotice(`${file.name} uploaded to this drawing revision.`);
      await refreshAndSelect(detail.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Drawing file upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const deleteFile = async (file: any) => {
    if (!detail?.id) return;
    if (!confirm(`Delete file “${file.originalName || file.fileName}” from this drawing revision?`)) return;
    setBusy(`file-${file.id}`);
    setError("");
    try {
      await requestJson(`/api/design/${detail.id}/files?fileId=${file.id}`, { method: "DELETE" });
      setNotice("Drawing file deleted.");
      await refreshAndSelect(detail.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete the drawing file.");
    } finally {
      setBusy("");
    }
  };

  const copyExternalLink = async () => {
    const value = String(detail?.externalLink ?? "");
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setNotice("External drawing link/path copied.");
    } catch {
      setError("Could not copy automatically. Select and copy the link/path shown in the drawing details.");
    }
  };

  const exportCsv = () => {
    const headers = [
      "Record", "Drawing No", "Revision", "Title", "Project", "Client", "Architect / Consultant",
      "Linked Order", "Discipline", "Area", "Sheets", "Priority", "Status", "Stage", "Approval Code",
      "Submitted To", "Submitted Date", "Transmittal", "Response Due", "Returned By", "Return Date",
      "Comments Incorporated", "Issued To Production To", "Issued At", "Required Date", "Files", "Updated",
    ];
    const lines = [headers.map(csvCell).join(",")];
    for (const d of filteredDrawings) {
      lines.push([
        d.recordNumber, d.drawingNo, d.revision, d.title, d.projectName, d.clientName, d.architectName,
        d.orderSnapshot, d.discipline, d.area, d.sheetCount, d.priority, d.status, d.stage, d.approvalCode,
        d.submittedTo, d.submittedDate, d.transmittalNo, d.responseDueDate, d.approvalBy, d.approvalDate,
        d.commentsIncorporated ? "Yes" : "No", d.issuedTo, d.issuedAt, d.requiredDate, d.fileCount, d.updatedAt,
      ].map(csvCell).join(","));
    }
    const blob = new Blob([`\uFEFF${lines.join("\r\n")}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `design-department-register-${todayYmd()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const codePill = (drawing: any) => {
    const def = designApprovalCodeDef(drawing.approvalCode);
    if (!def) {
      return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black ${CODE_CLASSES.none}`}>No code</span>;
    }
    return (
      <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black ${CODE_CLASSES[def.code]}`} title={def.description}>
        Code {def.code} · {def.shortLabel}
      </span>
    );
  };

  const statusPill = (drawing: any) => {
    const stage = drawing.stage || designDrawingStage(drawing);
    return (
      <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black ${STATUS_CLASSES[drawing.status] ?? STATUS_CLASSES.Draft}`} title={stage}>
        {drawing.status}
      </span>
    );
  };

  const issueEligibility = detail ? canIssueToProduction(detail) : null;
  const canOpenIssue = Boolean(detail && detail.status === "Returned" && ["A", "B"].includes(detail.approvalCode));
  const historical = detail ? ["Issued to Production", "Superseded", "Cancelled"].includes(detail.status) : false;

  if (loading && !board) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <div className={`${cardCls} p-8 text-center text-sm font-bold text-slate-400`}>
          <RefreshCw className="mx-auto mb-3 h-6 w-6 animate-spin text-teal-300" />
          Loading the Design Department drawing register…
        </div>
      </div>
    );
  }

  if (!board && error) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <div className={`${cardCls} border-rose-500/40 p-6`}>
          <div className="flex items-start gap-3">
            <LockKeyhole className="mt-0.5 h-6 w-6 shrink-0 text-rose-300" />
            <div>
              <h2 className="text-lg font-black text-white">Design Department is not available</h2>
              <p className="mt-2 text-sm text-rose-100">{error}</p>
              <p className="mt-3 text-xs leading-relaxed text-slate-400">
                A Manager can switch it on and grant it to a role or one person in
                Settings → System Settings → Optional modules.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 p-4 sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl border border-teal-500/40 bg-teal-500/10 p-3 text-teal-200">
            <DraftingCompass className="h-7 w-7" />
          </div>
          <div>
            <h2 className="text-2xl font-black tracking-tight text-white">Design Department</h2>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-400">
              Drawing register, revision submittals, Code A/B/C/D approval returns, and controlled issue to production.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={exportCsv} disabled={filteredDrawings.length === 0} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-xs font-black text-slate-200 hover:border-teal-500/60 hover:text-teal-200 disabled:cursor-not-allowed disabled:opacity-50">
            <Download className="h-4 w-4" /> Export CSV
          </button>
          <button type="button" onClick={() => void loadBoard(false)} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-xs font-black text-slate-200 hover:border-teal-500/60 hover:text-teal-200">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
          <button type="button" onClick={openNewDrawing} className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2 text-xs font-black text-white shadow-lg shadow-teal-900/40 hover:bg-teal-500">
            <Plus className="h-4 w-4" /> New drawing
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-2xl border border-rose-500/50 bg-rose-500/10 p-3 text-sm font-bold text-rose-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}
      {notice && (
        <div className="flex items-start gap-2 rounded-2xl border border-emerald-500/50 bg-emerald-500/10 p-3 text-sm font-bold text-emerald-100">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> {notice}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {[
          ["Active revisions", summary.active ?? 0, "text-white"],
          ["Awaiting approval", summary.awaitingApproval ?? 0, "text-sky-300"],
          ["Approval overdue", summary.overdueApprovals ?? 0, (summary.overdueApprovals ?? 0) ? "text-rose-300" : "text-slate-300"],
          ["Ready to issue", summary.readyToIssue ?? 0, "text-emerald-300"],
          ["Revise & resubmit", summary.reviseAndResubmit ?? 0, "text-amber-300"],
          ["Issued to production", summary.issuedToProduction ?? 0, "text-teal-300"],
        ].map(([label, value, cls]) => (
          <div key={String(label)} className={`${cardCls} p-4`}>
            <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">{label}</div>
            <div className={`mt-1 text-2xl font-black ${cls}`}>{value}</div>
          </div>
        ))}
      </div>

      <div className={`${cardCls} p-4`}>
        <div className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-400">
          <ShieldCheck className="h-4 w-4 text-teal-300" /> Approval-code production rule
        </div>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {DESIGN_APPROVAL_CODE_DEFS.map((def) => (
            <div key={def.code} className={`rounded-2xl border p-3 ${CODE_CLASSES[def.code]}`}>
              <div className="text-xs font-black">{def.label}</div>
              <div className="mt-1 text-[11px] leading-relaxed opacity-90">{def.description}</div>
              <div className="mt-2 text-[11px] font-black uppercase tracking-wide">{def.productionRule}</div>
            </div>
          ))}
        </div>
      </div>

      <div className={`${cardCls} p-4`}>
        <div className="grid gap-3 lg:grid-cols-[1fr_230px_190px_auto] lg:items-end">
          <Field label="Search drawing register">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Drawing no, title, project, client, order, transmittal…" className={`${inputCls} pl-9`} />
            </div>
          </Field>
          <Field label="Workflow">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={inputCls}>
              <option value="Active">Active only</option>
              <option value="Ready to issue">Ready to issue</option>
              <option value="Overdue approvals">Overdue approvals</option>
              <option value="All">All including history</option>
              {DESIGN_DRAWING_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </Field>
          <Field label="Approval code">
            <select value={codeFilter} onChange={(e) => setCodeFilter(e.target.value)} className={inputCls}>
              <option value="All">All codes</option>
              <option value="none">No code yet</option>
              {DESIGN_APPROVAL_CODE_DEFS.map((def) => <option key={def.code} value={def.code}>Code {def.code} — {def.shortLabel}</option>)}
            </select>
          </Field>
          <div className="flex items-center gap-2 pb-1 text-xs font-bold text-slate-400">
            <Filter className="h-4 w-4 text-teal-300" />
            {filteredDrawings.length} of {drawings.length} revisions
          </div>
        </div>
      </div>

      <div className={`${cardCls} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="min-w-[1080px] w-full text-left text-sm">
            <thead className="border-b border-slate-800 bg-slate-950/60 text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3 font-black">Drawing</th>
                <th className="px-4 py-3 font-black">Project / order</th>
                <th className="px-4 py-3 font-black">Workflow stage</th>
                <th className="px-4 py-3 font-black">Approval</th>
                <th className="px-4 py-3 font-black">Key dates</th>
                <th className="px-4 py-3 font-black">Files</th>
                <th className="px-4 py-3 font-black">Updated</th>
                <th className="px-4 py-3 text-right font-black">Open</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {filteredDrawings.map((drawing) => (
                <tr key={drawing.id} onClick={() => openDetail(drawing)} className="cursor-pointer transition hover:bg-slate-800/50">
                  <td className="px-4 py-3">
                    <div className="font-black text-white">{drawing.drawingNo} <span className="ml-1 rounded-md bg-slate-800 px-1.5 py-0.5 text-[10px] text-teal-200">Rev {drawing.revision}</span></div>
                    <div className="mt-0.5 max-w-xs truncate text-xs font-semibold text-slate-300" title={drawing.title}>{drawing.title}</div>
                    <div className="mt-0.5 text-[10px] font-bold text-slate-500">{drawing.recordNumber} · {drawing.discipline}{drawing.area ? ` · ${drawing.area}` : ""}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="max-w-xs truncate font-bold text-slate-200" title={drawing.projectName}>{drawing.projectName || "—"}</div>
                    <div className="mt-0.5 max-w-xs truncate text-xs text-slate-400" title={drawing.orderSnapshot || drawing.clientName}>{drawing.orderSnapshot || drawing.clientName || "No linked order"}</div>
                  </td>
                  <td className="px-4 py-3">
                    {statusPill(drawing)}
                    <div className="mt-1 text-[11px] font-bold text-slate-400">{drawing.stage || designDrawingStage(drawing)}</div>
                  </td>
                  <td className="px-4 py-3">
                    {codePill(drawing)}
                    {drawing.approvalCode === "B" && (
                      <div className="mt-1 text-[11px] font-bold text-slate-400">
                        Comments: {drawing.commentsIncorporated ? <span className="text-emerald-300">incorporated</span> : <span className="text-amber-300">not yet</span>}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs leading-relaxed text-slate-400">
                    <div>Submitted: <span className="font-bold text-slate-200">{formatDate(drawing.submittedDate)}</span></div>
                    <div>Returned: <span className="font-bold text-slate-200">{formatDate(drawing.approvalDate)}</span></div>
                    <div>Issued: <span className="font-bold text-slate-200">{formatDate(drawing.issuedAt)}</span></div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] font-black text-slate-200">
                      <FileText className="h-3.5 w-3.5 text-teal-300" /> {drawing.fileCount ?? drawing.files?.length ?? 0}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs font-semibold text-slate-400">{formatDate(drawing.updatedAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <button type="button" onClick={(e) => { e.stopPropagation(); openDetail(drawing); }} className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1.5 text-[11px] font-black text-slate-200 hover:border-teal-500/60 hover:text-teal-200">
                      <Eye className="h-3.5 w-3.5" /> Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredDrawings.length === 0 && (
            <div className="p-10 text-center">
              <DraftingCompass className="mx-auto h-10 w-10 text-slate-600" />
              <div className="mt-3 text-sm font-black text-white">{drawings.length === 0 ? "No drawings recorded yet" : "No drawings match these filters"}</div>
              <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-slate-400">
                {drawings.length === 0 ? "Create the first drawing revision, upload its PDF/CAD file, then record the submittal and approval return." : "Clear the search or choose a different workflow/code filter."}
              </p>
              {drawings.length === 0 && (
                <button type="button" onClick={openNewDrawing} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2 text-xs font-black text-white hover:bg-teal-500">
                  <Plus className="h-4 w-4" /> New drawing
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {selectedId && detail && (
        <div className="fixed inset-0 z-[100] flex justify-end bg-slate-950/70 backdrop-blur-sm" role="dialog" aria-modal="true">
          <button type="button" className="absolute inset-0 cursor-default" onClick={closeDetail} aria-label="Close drawing details" />
          <aside className="relative h-full w-full max-w-3xl overflow-y-auto border-l border-slate-700 bg-slate-950 shadow-2xl">
            <div className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/95 px-5 py-4 backdrop-blur">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-lg font-black text-white">{detail.drawingNo} · Rev {detail.revision}</h3>
                    {statusPill(detail)} {codePill(detail)}
                  </div>
                  <div className="mt-1 truncate text-sm font-semibold text-slate-300" title={detail.title}>{detail.title}</div>
                  <div className="mt-0.5 text-[11px] font-bold text-slate-500">{detail.recordNumber} · {detail.stage || designDrawingStage(detail)} · Updated {formatDate(detail.updatedAt)}</div>
                </div>
                <button type="button" onClick={closeDetail} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label="Close details">
                  <X className="h-5 w-5" />
                </button>
              </div>
              {detailLoading && <div className="mt-2 text-[11px] font-bold text-teal-300">Refreshing full history and files…</div>}
            </div>

            <div className="space-y-4 p-5">
              <section className={`${cardCls} p-4`}>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-xs font-black uppercase tracking-wider text-slate-400">Next workflow actions</h4>
                  {detail.orderId && onSelectOrder && (
                    <button type="button" onClick={() => onSelectOrder(Number(detail.orderId))} className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1.5 text-[11px] font-black text-slate-200 hover:border-teal-500/60 hover:text-teal-200">
                      <Factory className="h-3.5 w-3.5" /> Open linked order
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {!historical && (
                    <button type="button" onClick={() => openEditDrawing(detail)} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 px-3 py-2 text-xs font-black text-slate-200 hover:border-teal-500/60 hover:text-teal-200">
                      <Pencil className="h-4 w-4" /> Edit details
                    </button>
                  )}
                  {detail.status === "Draft" && (
                    <button type="button" onClick={openSubmit} className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-3 py-2 text-xs font-black text-white hover:bg-sky-500">
                      <Send className="h-4 w-4" /> Submit drawing
                    </button>
                  )}
                  {detail.status === "Submitted" && (
                    <button type="button" onClick={openApproval} className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-3 py-2 text-xs font-black text-white hover:bg-violet-500">
                      <ClipboardCheck className="h-4 w-4" /> Record Code A/B/C/D
                    </button>
                  )}
                  {detail.status === "Returned" && detail.approvalCode === "B" && (
                    <button type="button" disabled={busy === "comments"} onClick={() => void patchDrawing("comments", { incorporated: !detail.commentsIncorporated, note: "" }, detail.commentsIncorporated ? "Code B incorporation withdrawn." : "Code B comments marked incorporated.")} className="inline-flex items-center gap-1.5 rounded-xl border border-sky-500/50 bg-sky-500/10 px-3 py-2 text-xs font-black text-sky-100 hover:bg-sky-500/20 disabled:opacity-50">
                      <CheckCircle2 className="h-4 w-4" /> {detail.commentsIncorporated ? "Undo comments incorporated" : "Mark comments incorporated"}
                    </button>
                  )}
                  {canOpenIssue && (
                    <button type="button" onClick={openIssue} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-500">
                      <Factory className="h-4 w-4" /> Issue to production
                    </button>
                  )}
                  {detail.status !== "Superseded" && detail.status !== "Cancelled" && (
                    <button type="button" onClick={openResubmit} className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs font-black text-amber-100 hover:bg-amber-500/20">
                      <RotateCcw className="h-4 w-4" /> New revision / resubmit
                    </button>
                  )}
                  {["Draft", "Submitted", "Returned"].includes(detail.status) && (
                    <button type="button" onClick={() => openStatus("On Hold")} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 px-3 py-2 text-xs font-black text-slate-200 hover:border-amber-500/60 hover:text-amber-200">
                      <PauseCircle className="h-4 w-4" /> Put on hold
                    </button>
                  )}
                  {detail.status === "On Hold" && (
                    <button type="button" disabled={busy === "status"} onClick={() => void patchDrawing("status", { status: "Draft", note: "Resumed from On Hold" }, "Drawing resumed.")} className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/50 bg-emerald-500/10 px-3 py-2 text-xs font-black text-emerald-100 hover:bg-emerald-500/20 disabled:opacity-50">
                      <PlayCircle className="h-4 w-4" /> Resume
                    </button>
                  )}
                  {["Draft", "Submitted", "Returned", "On Hold"].includes(detail.status) && (
                    <button type="button" onClick={() => openStatus("Cancelled")} className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs font-black text-rose-100 hover:bg-rose-500/20">
                      <Ban className="h-4 w-4" /> Cancel revision
                    </button>
                  )}
                  {isManager && detail.status === "Draft" && !detail.submittedDate && !detail.approvalCode && (
                    <button type="button" disabled={busy === "delete"} onClick={() => void deleteDraft()} className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/50 px-3 py-2 text-xs font-black text-rose-200 hover:bg-rose-500/15 disabled:opacity-50">
                      <Trash2 className="h-4 w-4" /> Delete draft
                    </button>
                  )}
                </div>
                <div className={`mt-3 rounded-2xl border p-3 text-xs leading-relaxed ${issueEligibility?.ok ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-100" : "border-slate-700 bg-slate-950/70 text-slate-300"}`}>
                  <span className="font-black uppercase tracking-wide">Production release: </span>
                  {issueEligibility?.reason}
                  {detail.status === "Issued to Production" && detail.issuedAt && (
                    <span> Issued to {detail.issuedTo || "Production"} by {detail.issuedByName || "—"} on {formatDate(detail.issuedAt)}.</span>
                  )}
                </div>
              </section>

              <section className={`${cardCls} p-4`}>
                <h4 className="mb-3 text-xs font-black uppercase tracking-wider text-slate-400">Drawing and project</h4>
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  {[
                    ["Project", detail.projectName], ["Client", detail.clientName],
                    ["Architect / consultant", detail.architectName], ["Linked production order", detail.orderSnapshot || "None"],
                    ["Discipline", detail.discipline], ["Area / location", detail.area],
                    ["Sheets", detail.sheetCount], ["Priority", detail.priority],
                    ["Required date", formatDate(detail.requiredDate)], ["Created by", detail.createdByName],
                  ].map(([term, value]) => (
                    <div key={String(term)}>
                      <dt className="text-[10px] font-black uppercase tracking-wider text-slate-500">{term}</dt>
                      <dd className="mt-0.5 font-semibold text-slate-100">{String(value ?? "—") || "—"}</dd>
                    </div>
                  ))}
                </dl>
                {detail.notes && (
                  <div className="mt-4 rounded-xl bg-slate-950/70 p-3 text-sm leading-relaxed text-slate-300">
                    <div className="mb-1 text-[10px] font-black uppercase tracking-wider text-slate-500">Notes</div>
                    <div className="whitespace-pre-wrap">{detail.notes}</div>
                  </div>
                )}
              </section>

              <section className={`${cardCls} p-4`}>
                <h4 className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-400"><CalendarClock className="h-4 w-4 text-teal-300" /> Submittal and approval</h4>
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  {[
                    ["Submitted to", detail.submittedTo], ["Submitted date", formatDate(detail.submittedDate)],
                    ["Transmittal no", detail.transmittalNo], ["Response due", formatDate(detail.responseDueDate)],
                    ["Approval return", detail.approvalLabel || (detail.approvalCode ? `Code ${detail.approvalCode}` : "Not returned")],
                    ["Returned by", detail.approvalBy], ["Return date", formatDate(detail.approvalDate)],
                    ["Code B comments", detail.approvalCode === "B" ? (detail.commentsIncorporated ? `Incorporated by ${detail.commentsIncorporatedByName || "—"}` : "Not incorporated yet") : "—"],
                  ].map(([term, value]) => (
                    <div key={String(term)}>
                      <dt className="text-[10px] font-black uppercase tracking-wider text-slate-500">{term}</dt>
                      <dd className="mt-0.5 font-semibold text-slate-100">{String(value ?? "—") || "—"}</dd>
                    </div>
                  ))}
                </dl>
                {detail.approvalComments && (
                  <div className="mt-4 rounded-xl border border-violet-500/30 bg-violet-500/10 p-3 text-sm leading-relaxed text-violet-50">
                    <div className="mb-1 text-[10px] font-black uppercase tracking-wider text-violet-200">Approval comments</div>
                    <div className="whitespace-pre-wrap">{detail.approvalComments}</div>
                  </div>
                )}
                {detail.issueNote && (
                  <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm leading-relaxed text-emerald-50">
                    <div className="mb-1 text-[10px] font-black uppercase tracking-wider text-emerald-200">Production issue note</div>
                    <div className="whitespace-pre-wrap">{detail.issueNote}</div>
                  </div>
                )}
              </section>

              <section className={`${cardCls} p-4`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h4 className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-400"><FileUp className="h-4 w-4 text-teal-300" /> Drawing files and external location</h4>
                    <p className="mt-1 text-[11px] text-slate-500">PDF, DWG, DXF, images, ZIP, DOCX or XLSX · maximum {(MAX_DESIGN_FILE_BYTES / (1024 * 1024)).toFixed(0)} MB each.</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select value={fileKind} onChange={(e) => setFileKind(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-bold text-white focus:border-teal-400 focus:outline-none">
                      {DESIGN_FILE_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
                    </select>
                    <input ref={fileInputRef} type="file" accept={DESIGN_FILE_ACCEPT} onChange={(e) => void uploadFile(e)} className="hidden" />
                    <button type="button" disabled={uploading} onClick={() => fileInputRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-xl bg-teal-600 px-3 py-2 text-xs font-black text-white hover:bg-teal-500 disabled:opacity-50">
                      <Upload className="h-4 w-4" /> {uploading ? "Uploading…" : "Upload file"}
                    </button>
                  </div>
                </div>

                {detail.externalLink && (
                  <div className="mt-3 flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-950/70 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-slate-500"><Link2 className="h-3.5 w-3.5" /> External link / server path</div>
                      <div className="mt-1 break-all text-xs font-semibold text-slate-200">{detail.externalLink}</div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {isWebDesignLink(detail.externalLink) && (
                        <a href={detail.externalLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1.5 text-[11px] font-black text-slate-100 hover:border-teal-500/60 hover:text-teal-200">
                          <ExternalLink className="h-3.5 w-3.5" /> Open
                        </a>
                      )}
                      <button type="button" onClick={() => void copyExternalLink()} className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1.5 text-[11px] font-black text-slate-100 hover:border-teal-500/60 hover:text-teal-200">
                        <Copy className="h-3.5 w-3.5" /> Copy
                      </button>
                    </div>
                  </div>
                )}

                <div className="mt-3 space-y-2">
                  {(detail.files ?? []).map((file: any) => (
                    <div key={file.id} className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 font-bold text-slate-100"><FileText className="h-4 w-4 shrink-0 text-teal-300" /><span className="truncate" title={file.originalName || file.fileName}>{file.originalName || file.fileName}</span></div>
                        <div className="mt-0.5 text-[11px] text-slate-500">{file.kind} · {formatBytes(file.size)} · {formatDate(file.createdAt)}{file.uploadedByName ? ` · ${file.uploadedByName}` : ""}</div>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <a href={`/api/design/${detail.id}/files?fileId=${file.id}&download=1`} className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1.5 text-[11px] font-black text-slate-100 hover:border-teal-500/60 hover:text-teal-200">
                          <Download className="h-3.5 w-3.5" /> Download
                        </a>
                        <button type="button" disabled={busy === `file-${file.id}`} onClick={() => void deleteFile(file)} className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 px-2.5 py-1.5 text-[11px] font-black text-rose-200 hover:bg-rose-500/10 disabled:opacity-50">
                          <Trash2 className="h-3.5 w-3.5" /> Delete
                        </button>
                      </div>
                    </div>
                  ))}
                  {(!detail.files || detail.files.length === 0) && (
                    <div className="rounded-xl border border-dashed border-slate-700 p-4 text-center text-xs font-semibold text-slate-500">
                      No files uploaded to this revision yet. Upload the issued/submitted PDF or CAD package so the approval record and drawing stay together.
                    </div>
                  )}
                </div>
              </section>

              {Array.isArray(detail.revisions) && detail.revisions.length > 0 && (
                <section className={`${cardCls} p-4`}>
                  <h4 className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-400"><Archive className="h-4 w-4 text-teal-300" /> Revision chain for this project drawing</h4>
                  <div className="space-y-2">
                    {detail.revisions.map((revision: any) => (
                      <button key={revision.id} type="button" onClick={() => void loadDetail(revision.id)} className={`flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-xs ${revision.id === detail.id ? "border-teal-500/60 bg-teal-500/10" : "border-slate-800 bg-slate-950/60 hover:border-slate-600"}`}>
                        <span className="font-black text-slate-100">Rev {revision.revision} <span className="ml-1 font-bold text-slate-500">{revision.recordNumber}</span></span>
                        <span className="font-bold text-slate-400">{revision.stage}</span>
                        <span>{codePill(revision)}</span>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              <section className={`${cardCls} p-4`}>
                <h4 className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-400"><History className="h-4 w-4 text-teal-300" /> Revision history</h4>
                {Array.isArray(detail.events) && detail.events.length > 0 ? (
                  <ol className="space-y-3">
                    {detail.events.map((event: any) => (
                      <li key={event.id} className="relative border-l border-slate-800 pl-4">
                        <span className="absolute -left-[5px] top-1 h-2.5 w-2.5 rounded-full bg-teal-400" />
                        <div className="text-sm font-black text-slate-100">{event.summary}</div>
                        <div className="mt-0.5 text-[11px] font-semibold text-slate-500">
                          {formatDate(event.createdAt)}{event.actorName ? ` · ${event.actorName}` : ""} · Rev {event.revisionSnapshot || detail.revision} · {event.statusSnapshot || detail.status}{event.approvalCode ? ` · Code ${event.approvalCode}` : ""}
                        </div>
                        {event.details && <div className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-slate-400">{event.details}</div>}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <div className="text-xs font-semibold text-slate-500">History will appear after the first workflow action.</div>
                )}
              </section>
            </div>
          </aside>
        </div>
      )}

      {modal === "drawing" && (
        <Modal title={editing ? "Edit drawing revision" : "New drawing revision"} subtitle="Start with client/project details; linking a production order is optional." onClose={() => setModal(null)} wide>
          <form onSubmit={(e) => void saveDrawing(e)} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Drawing number *"><input required value={drawingForm.drawingNo} onChange={(e) => setDrawingForm({ ...drawingForm, drawingNo: e.target.value })} placeholder="WD-101" className={inputCls} /></Field>
              <Field label="Revision *"><input required value={drawingForm.revision} onChange={(e) => setDrawingForm({ ...drawingForm, revision: e.target.value })} placeholder="R0 / P01" className={inputCls} /></Field>
              <Field label="Sheets"><input type="number" min="1" max="1000" value={drawingForm.sheetCount} onChange={(e) => setDrawingForm({ ...drawingForm, sheetCount: e.target.value })} className={inputCls} /></Field>
            </div>
            <Field label="Drawing title *"><input required value={drawingForm.title} onChange={(e) => setDrawingForm({ ...drawingForm, title: e.target.value })} placeholder="Kitchen elevations and sections" className={inputCls} /></Field>
            <Field label="Linked production order (optional)">
              <select value={drawingForm.orderId} onChange={(e) => onDrawingOrderChange(e.target.value)} className={inputCls}>
                <option value="">No production order yet</option>
                {orders.map((order) => <option key={order.id} value={order.id}>{order.label}</option>)}
              </select>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Project"><input value={drawingForm.projectName} onChange={(e) => setDrawingForm({ ...drawingForm, projectName: e.target.value })} placeholder="Villa / office / site name" className={inputCls} /></Field>
              <Field label="Client"><input value={drawingForm.clientName} onChange={(e) => setDrawingForm({ ...drawingForm, clientName: e.target.value })} className={inputCls} /></Field>
              <Field label="Architect / consultant"><input value={drawingForm.architectName} onChange={(e) => setDrawingForm({ ...drawingForm, architectName: e.target.value })} className={inputCls} /></Field>
              <Field label="Area / location"><input value={drawingForm.area} onChange={(e) => setDrawingForm({ ...drawingForm, area: e.target.value })} placeholder="Ground floor kitchen" className={inputCls} /></Field>
              <Field label="Discipline">
                <select value={drawingForm.discipline} onChange={(e) => setDrawingForm({ ...drawingForm, discipline: e.target.value })} className={inputCls}>
                  {DESIGN_DISCIPLINES.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </Field>
              <Field label="Priority">
                <select value={drawingForm.priority} onChange={(e) => setDrawingForm({ ...drawingForm, priority: e.target.value })} className={inputCls}>
                  {DESIGN_PRIORITIES.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </Field>
              <Field label="Required date"><input type="date" value={drawingForm.requiredDate} onChange={(e) => setDrawingForm({ ...drawingForm, requiredDate: e.target.value })} className={inputCls} /></Field>
              <Field label="External link or server path"><input value={drawingForm.externalLink} onChange={(e) => setDrawingForm({ ...drawingForm, externalLink: e.target.value })} placeholder="https://… or \\server\share\drawings\…" className={inputCls} /></Field>
            </div>
            <Field label="Notes"><textarea value={drawingForm.notes} onChange={(e) => setDrawingForm({ ...drawingForm, notes: e.target.value })} rows={4} className={inputCls} /></Field>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setModal(null)} className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-black text-slate-200 hover:bg-slate-800">Cancel</button>
              <button type="submit" disabled={busy === "drawing"} className="rounded-xl bg-teal-600 px-4 py-2 text-xs font-black text-white hover:bg-teal-500 disabled:opacity-50">{busy === "drawing" ? "Saving…" : editing ? "Save drawing" : "Create draft drawing"}</button>
            </div>
          </form>
        </Modal>
      )}

      {modal === "submit" && detail && (
        <Modal title="Submit drawing for approval" subtitle={`${detail.drawingNo} · Rev ${detail.revision}`} onClose={() => setModal(null)}>
          <form onSubmit={(e) => { e.preventDefault(); void patchDrawing("submit", submitForm, "Drawing submittal recorded."); }} className="space-y-4">
            <Field label="Submitted to *"><input required value={submitForm.submittedTo} onChange={(e) => setSubmitForm({ ...submitForm, submittedTo: e.target.value })} placeholder="Client / architect / consultant" className={inputCls} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Submitted date *"><input required type="date" value={submitForm.submittedDate} onChange={(e) => setSubmitForm({ ...submitForm, submittedDate: e.target.value })} className={inputCls} /></Field>
              <Field label="Response due date"><input type="date" value={submitForm.responseDueDate} onChange={(e) => setSubmitForm({ ...submitForm, responseDueDate: e.target.value })} className={inputCls} /></Field>
            </div>
            <Field label="Transmittal number"><input value={submitForm.transmittalNo} onChange={(e) => setSubmitForm({ ...submitForm, transmittalNo: e.target.value })} placeholder="TR-001" className={inputCls} /></Field>
            <Field label="Submittal note"><textarea value={submitForm.note} onChange={(e) => setSubmitForm({ ...submitForm, note: e.target.value })} rows={3} className={inputCls} /></Field>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setModal(null)} className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-black text-slate-200 hover:bg-slate-800">Cancel</button>
              <button type="submit" disabled={busy === "submit"} className="rounded-xl bg-sky-600 px-4 py-2 text-xs font-black text-white hover:bg-sky-500 disabled:opacity-50">{busy === "submit" ? "Recording…" : "Record submittal"}</button>
            </div>
          </form>
        </Modal>
      )}

      {modal === "approval" && detail && (
        <Modal title="Record approval return" subtitle="Choose the exact code returned by the client, architect or consultant." onClose={() => setModal(null)} wide>
          <form onSubmit={(e) => { e.preventDefault(); void patchDrawing("approval", approvalForm, `Approval Code ${approvalForm.approvalCode} recorded.`); }} className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              {DESIGN_APPROVAL_CODE_DEFS.map((def) => (
                <button key={def.code} type="button" onClick={() => setApprovalForm({ ...approvalForm, approvalCode: def.code, commentsIncorporated: def.code === "B" ? approvalForm.commentsIncorporated : false })} className={`rounded-2xl border p-3 text-left ${CODE_CLASSES[def.code]} ${approvalForm.approvalCode === def.code ? "ring-2 ring-white/70" : "opacity-75 hover:opacity-100"}`}>
                  <div className="text-sm font-black">{def.label}</div>
                  <div className="mt-1 text-[11px] leading-relaxed">{def.description}</div>
                  <div className="mt-2 text-[10px] font-black uppercase tracking-wide">{def.productionRule}</div>
                </button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Returned / approved by *"><input required value={approvalForm.approvalBy} onChange={(e) => setApprovalForm({ ...approvalForm, approvalBy: e.target.value })} className={inputCls} /></Field>
              <Field label="Return date *"><input required type="date" value={approvalForm.approvalDate} onChange={(e) => setApprovalForm({ ...approvalForm, approvalDate: e.target.value })} className={inputCls} /></Field>
            </div>
            <Field label={approvalForm.approvalCode === "A" ? "Approval comments" : "Approval comments *"}>
              <textarea required={approvalForm.approvalCode !== "A"} value={approvalForm.approvalComments} onChange={(e) => setApprovalForm({ ...approvalForm, approvalComments: e.target.value })} rows={5} placeholder="Paste or summarize the returned comments exactly enough for the design team to act on them." className={inputCls} />
            </Field>
            {approvalForm.approvalCode === "B" && (
              <label className="flex items-start gap-2 rounded-xl border border-sky-500/40 bg-sky-500/10 p-3 text-sm font-semibold text-sky-50">
                <input type="checkbox" checked={approvalForm.commentsIncorporated} onChange={(e) => setApprovalForm({ ...approvalForm, commentsIncorporated: e.target.checked })} className="mt-1" />
                <span>These Code B comments are already incorporated in this same revision. Leave unchecked if the design team still has to update the drawing first.</span>
              </label>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setModal(null)} className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-black text-slate-200 hover:bg-slate-800">Cancel</button>
              <button type="submit" disabled={busy === "approval"} className="rounded-xl bg-violet-600 px-4 py-2 text-xs font-black text-white hover:bg-violet-500 disabled:opacity-50">{busy === "approval" ? "Recording…" : `Record Code ${approvalForm.approvalCode}`}</button>
            </div>
          </form>
        </Modal>
      )}

      {modal === "issue" && detail && (
        <Modal title="Issue drawing to production" subtitle="This becomes the production release record for this revision." onClose={() => setModal(null)}>
          <form onSubmit={(e) => { e.preventDefault(); void patchDrawing("issue", issueForm, "Drawing issued to production."); }} className="space-y-4">
            <div className={`rounded-2xl border p-3 text-sm leading-relaxed ${CODE_CLASSES[detail.approvalCode] ?? CODE_CLASSES.none}`}>
              <div className="font-black">{detail.approvalLabel || `Code ${detail.approvalCode}`}</div>
              <div className="mt-1 text-xs">{designApprovalCodeDef(detail.approvalCode)?.productionRule}</div>
            </div>
            {detail.approvalCode === "B" && (
              <label className="flex items-start gap-2 rounded-xl border border-sky-500/40 bg-sky-500/10 p-3 text-sm font-semibold text-sky-50">
                <input type="checkbox" checked={issueForm.confirmCommentsIncorporated} onChange={(e) => setIssueForm({ ...issueForm, confirmCommentsIncorporated: e.target.checked })} className="mt-1" />
                <span>I confirm every Code B approval comment has been incorporated into the drawing/files being issued.</span>
              </label>
            )}
            <Field label="Issued to *"><input required value={issueForm.issuedTo} onChange={(e) => setIssueForm({ ...issueForm, issuedTo: e.target.value })} placeholder="Production / Floor Supervisor name" className={inputCls} /></Field>
            <Field label="Production issue note"><textarea value={issueForm.note} onChange={(e) => setIssueForm({ ...issueForm, note: e.target.value })} rows={4} placeholder="Printed sets, CNC files, special instructions…" className={inputCls} /></Field>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setModal(null)} className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-black text-slate-200 hover:bg-slate-800">Cancel</button>
              <button type="submit" disabled={busy === "issue" || (detail.approvalCode === "B" && !issueForm.confirmCommentsIncorporated)} className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50">{busy === "issue" ? "Issuing…" : "Issue to production"}</button>
            </div>
          </form>
        </Modal>
      )}

      {modal === "resubmit" && detail && (
        <Modal title="Create new revision / resubmittal" subtitle="The new revision starts as Draft. Upload its revised files after creation; files are not copied automatically." onClose={() => setModal(null)}>
          <form onSubmit={(e) => { e.preventDefault(); void patchDrawing("resubmit", resubmitForm, "New drawing revision created as Draft.", true); }} className="space-y-4">
            <div className="rounded-xl bg-slate-950/70 p-3 text-xs leading-relaxed text-slate-300">
              Current: <strong className="text-white">{detail.drawingNo} Rev {detail.revision}</strong> · {detail.stage}
              {detail.status === "Issued to Production"
                ? " This issued revision remains the production reference until the new revision is itself issued."
                : " This revision will be marked Superseded when the new Draft is created."}
            </div>
            <Field label="New revision *"><input required value={resubmitForm.revision} onChange={(e) => setResubmitForm({ ...resubmitForm, revision: e.target.value })} className={inputCls} /></Field>
            <Field label="Revision / resubmission note"><textarea value={resubmitForm.note} onChange={(e) => setResubmitForm({ ...resubmitForm, note: e.target.value })} rows={4} placeholder="What changed in response to the approval comments?" className={inputCls} /></Field>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setModal(null)} className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-black text-slate-200 hover:bg-slate-800">Cancel</button>
              <button type="submit" disabled={busy === "resubmit"} className="rounded-xl bg-amber-600 px-4 py-2 text-xs font-black text-white hover:bg-amber-500 disabled:opacity-50">{busy === "resubmit" ? "Creating…" : "Create draft revision"}</button>
            </div>
          </form>
        </Modal>
      )}

      {modal === "status" && detail && (
        <Modal title={statusForm.status === "Cancelled" ? "Cancel drawing revision" : "Put drawing revision on hold"} subtitle="The status change and reason remain in the revision history." onClose={() => setModal(null)}>
          <form onSubmit={(e) => { e.preventDefault(); void patchDrawing("status", statusForm, statusForm.status === "Cancelled" ? "Drawing revision cancelled." : "Drawing revision put on hold."); }} className="space-y-4">
            <Field label="Reason / note"><textarea value={statusForm.note} onChange={(e) => setStatusForm({ ...statusForm, note: e.target.value })} rows={4} className={inputCls} /></Field>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setModal(null)} className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-black text-slate-200 hover:bg-slate-800">Back</button>
              <button type="submit" disabled={busy === "status"} className={`rounded-xl px-4 py-2 text-xs font-black text-white disabled:opacity-50 ${statusForm.status === "Cancelled" ? "bg-rose-600 hover:bg-rose-500" : "bg-amber-600 hover:bg-amber-500"}`}>{busy === "status" ? "Saving…" : statusForm.status === "Cancelled" ? "Cancel revision" : "Put on hold"}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
