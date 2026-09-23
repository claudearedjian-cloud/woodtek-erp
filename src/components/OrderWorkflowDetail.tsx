"use client";

import React, { useState, useEffect } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Play,
  Pause,
  AlertTriangle,
  Cpu,
  User,
  Plus,
  Trash2,
  Save,
  Layers,
  Package,
  Sparkles,
  RefreshCw,
  Check,
  RotateCcw,
  ChevronRight,
  Boxes,
  DollarSign,
  FileText,
  QrCode,
  Copy,
  Printer,
  Truck,
  Mail,
  X,
} from "lucide-react";
import jsPDF from "jspdf";
import QRCode from "qrcode";
import { QUOTE_STRINGS, type Lang } from "@/lib/i18n";
import autoTable from "jspdf-autotable";
import { can, canAssignMachines } from "@/lib/permissions";
import { machineCategoryMatches } from "@/lib/operationMachineCandidates";
import { allowedStages } from "@/lib/materialProgress";
import { buildJobTicketHtml } from "@/lib/jobTicket";
import { buildDeliveryNoteHtml } from "@/lib/deliveryNote";
import { buildDispatchPackHtml } from "@/lib/dispatchPack";
import { buildDeliveryEmailSubject } from "@/lib/emailDispatch";

interface OrderWorkflowDetailProps {
  orderId: number;
  onBack: () => void;
  onRefresh: () => void;
  currentUser: any;
  machines: any[];
  inventoryItems: any[];
  onCloneOrder?: (seed: any) => void;
}

export default function OrderWorkflowDetail({
  orderId,
  onBack,
  onRefresh,
  currentUser,
  machines = [],
  inventoryItems = [],
  onCloneOrder,
}: OrderWorkflowDetailProps) {
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState("");
  const [actionWarning, setActionWarning] = useState("");
  // Per-material production stage: where each BOM line is right now
  // ("" = not started, a step name from this order, or DONE).
  const [matProgress, setMatProgress] = useState<Record<string, { stage: string; at: string; by: string }>>({});
  // Per-material machine routing (New Order wizard; empty = order default).
  const [matRoutes, setMatRoutes] = useState<Record<string, string[]>>({});
  useEffect(() => {
    if (!order?.id) return;
    let alive = true;
    fetch(`/api/material-progress?orderId=${order.id}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d && d.progress) setMatProgress(d.progress); })
      .catch(() => {});
    fetch(`/api/material-routes?orderId=${order.id}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d && d.routes) setMatRoutes(d.routes); })
      .catch(() => {});
    return () => { alive = false; };
  }, [order?.id]);

  const setMatStage = async (materialId: number, stage: string) => {
    try {
      const res = await fetch("/api/material-progress", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderMaterialsId: materialId, stage }),
      });
      const d = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        setActionError(d.error || "Could not update the material stage.");
        return;
      }
      setMatProgress((prev) => ({ ...prev, [String(materialId)]: d.entry }));
    } catch {
      setActionError("Could not update the material stage.");
    }
  };
  const canSetStage =
    can(currentUser?.role, "operations:update-status") ||
    can(currentUser?.role, "quality:write") ||
    can(currentUser?.role, "orders:write") ||
    can(currentUser?.role, "inventory:write");
  const stageSteps: string[] = (order?.operations ?? [])
    .slice()
    .sort((a: any, b: any) => a.stepOrder - b.stepOrder)
    .map((o: any) => o.operationName);
  const [busyOperationId, setBusyOperationId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<"workflow" | "materials" | "details">("workflow");
  const [quoteLangOpen, setQuoteLangOpen] = useState(false);

  // BOM Allocator state
  const [allocItemId, setAllocItemId] = useState<string>("");
  const [allocQty, setAllocQty] = useState<string>("1");
  const [allocError, setAllocError] = useState<string>("");
  const [allocNotice, setAllocNotice] = useState<string>("");
  const [allocBusy, setAllocBusy] = useState<boolean>(false);
  const [releasingId, setReleasingId] = useState<number | null>(null);
  const canManageBom = can(currentUser?.role, "orders:write");

  // Add Step Modal State
  const [showAddStep, setShowAddStep] = useState(false);
  const [newOpName, setNewOpName] = useState("");
  const [newOpMachineId, setNewOpMachineId] = useState(machines[0]?.id || "");
  const [newOpMins, setNewOpMins] = useState(60);

  // Edit notes state
  const [editingOpId, setEditingOpId] = useState<number | null>(null);
  const [tempNotes, setTempNotes] = useState("");
  const [tempActualMins, setTempActualMins] = useState(0);

  const fetchOrderDetail = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/orders/${orderId}`);
      if (res.ok) {
        const data = await res.json();
        setOrder(data);
      }
    } catch (err) {
      console.error("Failed to fetch order detail", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (orderId) {
      fetchOrderDetail();
    }
  }, [orderId]);

  const handleUpdateOpStatus = async (opId: number, newStatus: string, allowRework = false) => {
    if (busyOperationId !== null) return;
    let rejectReason: string | undefined;
    if (newStatus === "Rejected/Rework") {
      const entered = window.prompt("Describe the defect or required rework:");
      if (!entered?.trim()) return;
      rejectReason = entered.trim();
    }

    const previousOrder = order;
    setBusyOperationId(opId);
    setActionError("");
    if (order?.operations) {
      setOrder({ ...order, operations: order.operations.map((operation: any) =>
        operation.id === opId ? { ...operation, status: newStatus, operatorName: currentUser?.name || operation.operatorName } : operation
      ) });
    }

    try {
      const payload: Record<string, unknown> = {
        status: newStatus,
        allowRework,
        rejectReason,
        operatorId: currentUser?.id ? Number(currentUser.id) : undefined,
      };
      const targetOp = previousOrder.operations.find((operation: any) => operation.id === opId);
      if (newStatus === "Completed" && targetOp && !targetOp.actualMinutes) payload.actualMinutes = targetOp.estimatedMinutes || 60;

      const response = await fetch(`/api/operations/${opId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to update this operation.");

      await fetchOrderDetail();
      onRefresh();
    } catch (error) {
      setOrder(previousOrder);
      setActionError(error instanceof Error ? error.message : "Unable to update this operation.");
    } finally {
      setBusyOperationId(null);
    }
  };

  const handleSaveOpDetails = async (opId: number) => {
    try {
      await fetch(`/api/operations/${opId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          qualityNotes: tempNotes,
          actualMinutes: tempActualMins,
        }),
      });
      setEditingOpId(null);
      fetchOrderDetail();
      onRefresh();
    } catch (err) {
      console.error("Failed to save op details", err);
    }
  };

  const handleSaveCandidateStations = async (opId: number, machineIds: number[]) => {
    if (busyOperationId !== null) return;
    if (machineIds.length === 0) {
      setActionError("Choose at least one candidate station.");
      return;
    }
    setBusyOperationId(opId);
    setActionError("");
    try {
      const res = await fetch(`/api/operations/${opId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateMachineIds: machineIds }),
      });
      const payload = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(payload.error || "Candidate station assignment failed.");
      await fetchOrderDetail();
      onRefresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Candidate station assignment failed.");
    } finally {
      setBusyOperationId(null);
    }
  };

  const handleAddStep = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOpName) return;
    try {
      await fetch(`/api/operations/${orderId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: order.id,
          operationName: newOpName,
          machineId: newOpMachineId ? Number(newOpMachineId) : null,
          estimatedMinutes: Number(newOpMins),
        }),
      });
      setShowAddStep(false);
      setNewOpName("");
      fetchOrderDetail();
      onRefresh();
    } catch (err) {
      console.error("Failed to add new step", err);
    }
  };

  const handleDeleteOperation = async (operation: any) => {
    if (!confirm(`Remove step ${operation.stepOrder}: ${operation.operationName}? Remaining steps will be renumbered.`)) return;
    setActionError("");
    try {
      const response = await fetch(`/api/operations/${operation.id}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to delete operation.");
      await fetchOrderDetail();
      onRefresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to delete operation.");
    }
  };

  // Printable QR sticker: scanning it opens this order on any device on the network.
  const [qrOpen, setQrOpen] = useState(false);
  const [qrUrl, setQrUrl] = useState("");

  const openQr = async () => {
    if (!order) return;
    const link = `${window.location.origin}/?order=${order.id}`;
    try {
      const dataUrl = await QRCode.toDataURL(link, { width: 480, margin: 2, color: { dark: "#0f172a", light: "#ffffff" } });
      setQrUrl(dataUrl);
      setQrOpen(true);
    } catch {
      /* QR generation failed — ignore */
    }
  };

  const printQr = () => {
    if (!order || !qrUrl) return;
    const w = window.open("", "_blank", "width=420,height=560");
    if (!w) return;
    w.document.write(`<!doctype html><html><head><title>Sticker ${order.orderNumber}</title></head>
      <body style="font-family:Arial,sans-serif;text-align:center;padding:24px">
        <img src="${qrUrl}" style="width:280px;height:280px" />
        <div style="font-size:22px;font-weight:900;letter-spacing:1px;margin-top:8px">${order.orderNumber}</div>
        <div style="font-size:13px;color:#334155;margin-top:4px;max-width:300px;margin-left:auto;margin-right:auto">${String(order.title || "").replace(/</g, "&lt;")}</div>
        <div style="font-size:11px;color:#64748b;margin-top:4px">${String(order.customerCompany || "").replace(/</g, "&lt;")}</div>
      </body></html>`);
    w.document.close();
    w.focus();
    w.print();
  };

  const printJobTicket = async () => {
    if (!order) return;
    const link = `${window.location.origin}/?order=${order.id}`;
    let qrData: string | null = null;
    try {
      qrData = await QRCode.toDataURL(link, { width: 300, margin: 1, color: { dark: "#0f172a", light: "#ffffff" } });
    } catch {
      qrData = null;
    }
    const html = buildJobTicketHtml(order, { inventoryItems, machines, qrDataUrl: qrData });
    const w = window.open("", "_blank", "width=900,height=1100");
    if (!w) {
      setActionError("Allow pop-ups to print the job ticket.");
      return;
    }
    w.document.write(html);
    w.document.close();
    setTimeout(() => { try { w.focus(); w.print(); } catch {} }, 700);
  };

  const printDeliveryNote = async () => {
    if (!order) return;
    const link = `${window.location.origin}/?order=${order.id}`;
    let qrData: string | null = null;
    try {
      qrData = await QRCode.toDataURL(link, { width: 300, margin: 1, color: { dark: "#0f172a", light: "#ffffff" } });
    } catch {
      qrData = null;
    }
    const html = buildDeliveryNoteHtml(order, { inventoryItems, machines, qrDataUrl: qrData });
    const w = window.open("", "_blank", "width=900,height=1100");
    if (!w) {
      setActionError("Allow pop-ups to print the delivery note.");
      return;
    }
    w.document.write(html);
    w.document.close();
    setTimeout(() => { try { w.focus(); w.print(); } catch {} }, 700);
  };

  const printDispatchPack = async () => {
    if (!order) return;
    const link = `${window.location.origin}/?order=${order.id}`;
    let qrData: string | null = null;
    try {
      qrData = await QRCode.toDataURL(link, { width: 300, margin: 1, color: { dark: "#0f172a", light: "#ffffff" } });
    } catch {
      qrData = null;
    }
    // Best-effort fetch of QC and photos and dispatch stage
    let packingTemplate: string[] | null = null;
    let packingChecks: boolean[] | null = null;
    let batchPackingChecks: Record<string, boolean[]> | null = null;
    let deliveryPhotos: any[] | null = null;
    let batchDeliveryPhotos: Record<string, any[]> | null = null;
    let dispatchStage: string | null = null;
    let dispatchProof: any = null;
    let batchDispatchStages: Record<string, any> | null = null;
    try {
      const qcRes = await fetch(`/api/packing-qc`, { cache: "no-store" });
      if (qcRes.ok) {
        const qcData = await qcRes.json();
        packingTemplate = qcData.template || [];
        const orderChecks = qcData.checks?.[String(order.id)] || qcData.checks?.[order.id];
        if (Array.isArray(orderChecks)) packingChecks = orderChecks;
        batchPackingChecks = qcData.batchChecks || {};
      }
    } catch {}
    try {
      const phRes = await fetch(`/api/delivery-photos?orderId=${order.id}`, { cache: "no-store" });
      if (phRes.ok) {
        const phData = await phRes.json();
        deliveryPhotos = phData.photos || [];
      }
      // Try batch photos for each material
      if (order.materials?.length) {
        batchDeliveryPhotos = {};
        for (const m of order.materials) {
          try {
            const bRes = await fetch(`/api/delivery-photos?orderId=${order.id}&batchId=${m.id}`, { cache: "no-store" });
            if (bRes.ok) {
              const bData = await bRes.json();
              if (Array.isArray(bData.photos) && bData.photos.length > 0) {
                batchDeliveryPhotos[String(m.id)] = bData.photos;
              }
            }
          } catch {}
        }
      }
    } catch {}
    try {
      const dRes = await fetch(`/api/dispatch`, { cache: "no-store" });
      if (dRes.ok) {
        const dData = await dRes.json();
        const row = (dData.orders || []).find((o: any) => Number(o.orderId) === Number(order.id));
        if (row) {
          dispatchStage = row.stage || null;
          dispatchProof = row.proof || null;
        }
        // Batch stages
        const batches = dData.batches || {};
        batchDispatchStages = {};
        for (const [bid, info] of Object.entries(batches)) {
          const inf: any = info as any;
          if (Number(inf.orderId) === Number(order.id)) {
            batchDispatchStages[bid] = { stage: inf.stage, proof: inf.proof };
          }
        }
      }
    } catch {}
    const html = buildDispatchPackHtml(order, {
      inventoryItems,
      machines,
      qrDataUrl: qrData,
      packingTemplate,
      packingChecks,
      batchPackingChecks,
      deliveryPhotos,
      batchDeliveryPhotos,
      dispatchStage,
      dispatchProof,
      batchDispatchStages,
    });
    const w = window.open("", "_blank", "width=900,height=1100");
    if (!w) {
      setActionError("Allow pop-ups to print the dispatch pack.");
      return;
    }
    w.document.write(html);
    w.document.close();
    setTimeout(() => { try { w.focus(); w.print(); } catch {} }, 700);
  };

  // ---- Email Docs — send this order's printable documents by email --------
  // Permission mirrors the API (canSendEmail): orders:write, quality:write,
  // inventory:write or users:manage. The server rebuilds every document from
  // live data, so nothing sensitive is sent from the browser.
  const canSendEmail =
    can(currentUser?.role, "orders:write") ||
    can(currentUser?.role, "quality:write") ||
    can(currentUser?.role, "inventory:write") ||
    can(currentUser?.role, "users:manage");
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [emailCc, setEmailCc] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailMessage, setEmailMessage] = useState("");
  const [emailIncludes, setEmailIncludes] = useState({ deliveryNote: true, dispatchPack: true, jobTicket: false });
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailResult, setEmailResult] = useState<{ ok: boolean; text: string } | null>(null);

  const openEmailModal = () => {
    if (!order) return;
    setEmailTo(order.customerEmail || "");
    setEmailCc("");
    setEmailSubject(buildDeliveryEmailSubject(order));
    setEmailMessage(
      `Please find attached the documents for order ${order.orderNumber}${order.title ? ` — ${order.title}` : ""}. ` +
        `Any question on the packing or the schedule, just reply to this email.`,
    );
    setEmailIncludes({ deliveryNote: true, dispatchPack: true, jobTicket: false });
    setEmailResult(null);
    setEmailOpen(true);
  };

  const sendEmailDispatch = async () => {
    if (!order) return;
    setEmailBusy(true);
    setEmailResult(null);
    try {
      const res = await fetch("/api/email-dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: order.id,
          to: emailTo,
          cc: emailCc,
          subject: emailSubject,
          message: emailMessage,
          includeDeliveryNote: emailIncludes.deliveryNote,
          includeDispatchPack: emailIncludes.dispatchPack,
          includeJobTicket: emailIncludes.jobTicket,
        }),
      });
      const d = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        setEmailResult({ ok: false, text: d.error || "Could not send the email." });
        return;
      }
      setEmailResult({ ok: true, text: d.message || "Email sent." });
      // Result banner stays visible briefly, then the modal closes on its own.
      setTimeout(() => {
        setEmailOpen(false);
        setEmailResult(null);
      }, 2600);
    } catch {
      setEmailResult({ ok: false, text: "Could not send the email — check the connection and try again." });
    } finally {
      setEmailBusy(false);
    }
  };

  // Branded client-facing quotation built from the order, its BOM and its
  // routing. English/French download straight as a PDF; Arabic opens a print
  // window instead - the browser shapes and right-aligns Arabic properly
  // (jsPDF's built-in fonts cannot).
  const openArabicQuotation = () => {
    if (!order) return;
    const materials: any[] = order.materials ?? [];
    const costed = materials.filter((m: any) => m.costPerUnit != null);
    const materialsTotal = costed.reduce((s: number, m: any) => s + (m.quantityUsed || 0) * parseFloat(m.costPerUnit || "0"), 0);
    const quoted = Number(order.totalValue || 0);
    const productionValue = Math.max(0, quoted - materialsTotal);
    const ops: any[] = order.operations ?? [];
    const esc = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
    const rows = costed.map((m: any) =>
      `<tr><td>${esc(m.itemName ?? "")}</td><td class="n">${esc(m.quantityUsed ?? 0)}</td><td>${esc(m.itemUnit ?? "")}</td><td class="n">${parseFloat(m.costPerUnit || "0").toFixed(2)} $</td><td class="n">${((m.quantityUsed || 0) * parseFloat(m.costPerUnit || "0")).toFixed(2)} $</td></tr>`,
    ).join("");
    const opRows = ops.map((o: any, i: number) =>
      `<tr><td class="n">${esc(o.stepOrder ?? i + 1)}</td><td>${esc(o.operationName ?? "")}</td><td>${esc(o.machineName || o.machineCode || "—")}</td><td class="n">${((o.estimatedMinutes || 0) / 60).toFixed(1)}</td></tr>`,
    ).join("");
    const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>عرض سعر ${esc(order.orderNumber)}</title>
<style>
  body { font-family: "Segoe UI", Tahoma, Arial, sans-serif; color:#0f172a; margin:24px; }
  .band { background:#0f172a; color:#f59e0b; padding:18px 20px; border-bottom:4px solid #f59e0b; display:flex; justify-content:space-between; align-items:center; }
  .band h1 { margin:0; font-size:24px; letter-spacing:1px; } .band .q { color:#fff; font-size:18px; font-weight:700; }
  .band small { display:block; color:#cbd5e1; font-weight:400; }
  h2 { font-size:15px; margin:26px 0 6px; } table { width:100%; border-collapse:collapse; font-size:12px; }
  th { background:#1e293b; color:#f59e0b; padding:6px 8px; text-align:right; } td { border:1px solid #e2e8f0; padding:5px 8px; }
  .n { text-align:center; font-family:monospace; }
  .meta { margin-top:14px; font-size:12px; color:#475569; } .meta b { color:#0f172a; }
  .totals { margin:20px 0 0 auto; width:300px; background:#f8fafc; border:1px solid #e2e8f0; padding:10px 12px; font-size:13px; }
  .totals .row { display:flex; justify-content:space-between; padding:2px 0; }
  .totals .grand { font-weight:800; color:#b45309; font-size:15px; border-top:1px solid #cbd5e1; margin-top:6px; padding-top:6px; }
  .terms { margin-top:18px; font-size:11px; color:#64748b; } .foot { margin-top:24px; font-size:10px; color:#94a3b8; }
</style></head><body>
<div class="band"><div><h1>WOODTEK</h1><small>${esc(QUOTE_STRINGS.ar.tagline)}</small></div><div class="q">${esc(QUOTE_STRINGS.ar.quotation)}<br><small style="color:#cbd5e1">QT-${esc(order.orderNumber)}</small></div></div>
<div class="meta"><b>${esc(QUOTE_STRINGS.ar.billTo)}:</b> ${esc(order.customerCompany || order.customerName || "—")}${order.customerName && order.customerCompany ? ` — ${esc(QUOTE_STRINGS.ar.attn)} ${esc(order.customerName)}` : ""}<br>
<b>${esc(QUOTE_STRINGS.ar.date)}:</b> ${new Date().toLocaleDateString()} &nbsp;·&nbsp; <b>${esc(QUOTE_STRINGS.ar.due)}:</b> ${order.dueDate ? new Date(order.dueDate).toLocaleDateString() : "—"} &nbsp;·&nbsp; <b>${esc(QUOTE_STRINGS.ar.category)}:</b> ${esc(order.projectType || "—")} &nbsp;·&nbsp; <b>${esc(QUOTE_STRINGS.ar.reference)}:</b> ${esc(order.orderNumber)}</div>
<h2>${esc(order.title || "")}</h2>
${costed.length > 0 ? `<table><thead><tr><th>${esc(QUOTE_STRINGS.ar.material)}</th><th>${esc(QUOTE_STRINGS.ar.qty)}</th><th>${esc(QUOTE_STRINGS.ar.unit)}</th><th>${esc(QUOTE_STRINGS.ar.unitCost)}</th><th>${esc(QUOTE_STRINGS.ar.amount)}</th></tr></thead><tbody>${rows}</tbody></table>` : ""}
${ops.length > 0 ? `<h2>${esc(QUOTE_STRINGS.ar.productionSteps)}</h2><table><thead><tr><th>#</th><th>${esc(QUOTE_STRINGS.ar.operation)}</th><th>${esc(QUOTE_STRINGS.ar.station)}</th><th>${esc(QUOTE_STRINGS.ar.estHours)}</th></tr></thead><tbody>${opRows}</tbody></table>` : ""}
<div class="totals">
  ${costed.length > 0 ? `<div class="row"><span>${esc(QUOTE_STRINGS.ar.materials)}</span><span>${materialsTotal.toFixed(2)} $</span></div><div class="row"><span>${esc(QUOTE_STRINGS.ar.productionFull)}</span><span>${productionValue.toFixed(2)} $</span></div>` : ""}
  <div class="row grand"><span>${esc(QUOTE_STRINGS.ar.totalQuoted)}</span><span>${quoted.toFixed(2)} $</span></div>
</div>
<p class="terms">${esc(QUOTE_STRINGS.ar.terms)}</p>
<p class="foot">${esc(QUOTE_STRINGS.ar.generated)} ${new Date().toLocaleString()} · WoodTek</p>
</body></html>`;
    const w = window.open("", "_blank", "width=900,height=1000");
    if (!w) {
      setActionError("Allow pop-ups to open the Arabic quotation, then print it as PDF.");
      return;
    }
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 700);
  };

  const generateQuotation = (lang: Lang) => {
    if (!order) return;
    if (lang === "ar") {
      openArabicQuotation();
      return;
    }
    const qs = QUOTE_STRINGS[lang];
    const doc = new jsPDF();
    const amber: [number, number, number] = [245, 158, 11];
    const dark: [number, number, number] = [15, 23, 42];
    const grey: [number, number, number] = [100, 116, 139];

    doc.setFillColor(...dark);
    doc.rect(0, 0, 210, 30, "F");
    doc.setTextColor(...amber);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.text("WOODTEK", 14, 14);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(203, 213, 225);
    doc.text(qs.tagline, 14, 20);
    doc.setTextColor(...amber);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(qs.quotation, 196, 14, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(203, 213, 225);
    doc.text(`QT-${order.orderNumber}`, 196, 21, { align: "right" });

    const y = 42;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...grey);
    doc.text(qs.billTo, 14, y);
    doc.text(qs.details, 118, y);
    doc.setFontSize(11);
    doc.setTextColor(...dark);
    doc.text(String(order.customerCompany || order.customerName || "—"), 14, y + 6);
    if (order.customerName && order.customerCompany) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(71, 85, 105);
      doc.text(`${qs.attn} ${order.customerName}`, 14, y + 11);
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const meta: Array<[string, string]> = [
      [qs.date, new Date().toLocaleDateString()],
      [qs.due, order.dueDate ? new Date(order.dueDate).toLocaleDateString() : "—"],
      [qs.category, String(order.projectType || "—")],
      [qs.reference, String(order.orderNumber)],
    ];
    meta.forEach((m, i) => {
      doc.setTextColor(...grey);
      doc.text(`${m[0]}:`, 118, y + 6 + i * 5);
      doc.setTextColor(...dark);
      doc.text(m[1], 152, y + 6 + i * 5);
    });

    let cursor = y + 26;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...dark);
    doc.text(String(order.title || ""), 14, cursor, { maxWidth: 182 });
    cursor += 8;

    const materials: any[] = order.materials ?? [];
    const costed = materials.filter((m) => m.costPerUnit != null);
    let materialsTotal = 0;
    if (costed.length > 0) {
      autoTable(doc, {
        startY: cursor,
        head: [[qs.material, qs.qty, qs.unit, qs.unitCost, qs.amount]],
        body: costed.map((m) => {
          const amount = (m.quantityUsed || 0) * parseFloat(m.costPerUnit || "0");
          materialsTotal += amount;
          return [
            String(m.itemName ?? "Item"),
            String(m.quantityUsed ?? 0),
            String(m.itemUnit ?? ""),
            `$${parseFloat(m.costPerUnit || "0").toFixed(2)}`,
            `$${amount.toFixed(2)}`,
          ];
        }),
        theme: "grid",
        headStyles: { fillColor: amber, textColor: dark, fontStyle: "bold" },
        styles: { fontSize: 9 },
      });
      cursor = (doc as any).lastAutoTable.finalY + 8;
    }

    const ops: any[] = order.operations ?? [];
    if (ops.length > 0) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(...dark);
      doc.text(qs.productionSteps, 14, cursor);
      cursor += 3;
      autoTable(doc, {
        startY: cursor,
        head: [["#", qs.operation, qs.station, qs.estHours]],
        body: ops.map((o: any, i: number) => [
          String(o.stepOrder ?? i + 1),
          String(o.operationName ?? ""),
          String(o.machineName || o.machineCode || "—"),
          ((o.estimatedMinutes || 0) / 60).toFixed(1),
        ]),
        theme: "grid",
        headStyles: { fillColor: dark, textColor: [255, 255, 255], fontStyle: "bold" },
        styles: { fontSize: 9 },
      });
      cursor = (doc as any).lastAutoTable.finalY + 10;
    }

    const quoted = Number(order.totalValue || 0);
    const productionValue = Math.max(0, quoted - materialsTotal);
    const boxHeight = costed.length > 0 ? 30 : 18;
    doc.setFillColor(248, 250, 252);
    doc.rect(110, cursor, 86, boxHeight, "F");
    let ty = cursor + 6;
    if (costed.length > 0) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...grey);
      doc.text(qs.materials, 114, ty);
      doc.setTextColor(...dark);
      doc.text(`$${materialsTotal.toFixed(2)}`, 192, ty, { align: "right" });
      ty += 6;
      doc.setTextColor(...grey);
      doc.text(qs.productionFull, 114, ty);
      doc.setTextColor(...dark);
      doc.text(`$${productionValue.toFixed(2)}`, 192, ty, { align: "right" });
      ty += 6;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...dark);
    doc.text(qs.totalQuoted, 114, ty);
    doc.setTextColor(...amber);
    doc.text(`$${quoted.toFixed(2)}`, 192, ty, { align: "right" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...grey);
    doc.text(qs.terms, 14, cursor + boxHeight + 8, { maxWidth: 182 });
    doc.text(`${qs.generated} ${new Date().toLocaleString()} · WoodTek`, 14, 287);

    doc.save(`Quotation-${order.orderNumber}.pdf`);
  };

  const handleOrderStatusChange = async (newStatus: string) => {
    if (!newStatus || newStatus === order.status) return;
    setActionError("");
    setActionWarning("");
    try {
      const response = await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `Unable to set status to "${newStatus}".`);
      if (result.warning) setActionWarning(result.warning);
      await fetchOrderDetail();
      onRefresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to update order status.");
    }
  };

  // Re-run material consumption for an order that is Completed/Delivered but
  // whose stock was never consumed (e.g. the consumption transaction failed
  // and rolled back when the database schema was out of sync).
  const retryConsumeMaterials = async () => {
    setActionError("");
    try {
      const response = await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "Completed" }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Consumption failed.");
      await fetchOrderDetail();
      onRefresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to run material consumption.");
    }
  };

  const handleDeleteOrder = async () => {
    if (!confirm("Are you sure you want to permanently delete this production order?")) return;
    setActionError("");
    try {
      const response = await fetch(`/api/orders/${orderId}`, { method: "DELETE" });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(result?.error || `Server returned status ${response.status}.`);
      }
      onRefresh();
      onBack();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to delete order.");
    }
  };

  const flashAlloc = (msg: string) => {
    setAllocNotice(msg);
    setTimeout(() => setAllocNotice(""), 4000);
  };

  const handleAllocateMaterial = async (event: React.FormEvent) => {
    event.preventDefault();
    setAllocError("");

    const qty = Number(allocQty);
    if (!allocItemId) return setAllocError("Choose a stock item to allocate.");
    if (!Number.isFinite(qty) || qty <= 0) return setAllocError("Enter a quantity greater than zero.");

    setAllocBusy(true);
    try {
      const response = await fetch(`/api/orders/${orderId}/materials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: Number(allocItemId), quantityUsed: qty }),
      });
      if (!response.ok) {
        let message = `Server returned status ${response.status}.`;
        try {
          const payload = await response.json();
          if (payload?.error) message = payload.error;
        } catch { /* non-JSON body — keep the status message */ }
        throw new Error(message);
      }
      setAllocQty("1");
      await fetchOrderDetail();
      onRefresh();
      flashAlloc("Stock allocated to this order.");
    } catch (err) {
      setAllocError(err instanceof Error ? err.message : "Failed to allocate stock.");
    } finally {
      setAllocBusy(false);
    }
  };

  const handleReleaseMaterial = async (allocationId: number, label: string) => {
    if (!confirm(`Release ${label} back to warehouse stock?`)) return;
    setAllocError("");
    setReleasingId(allocationId);
    try {
      const response = await fetch(`/api/orders/${orderId}/materials?allocationId=${allocationId}`, { method: "DELETE" });
      if (!response.ok) {
        let message = `Server returned status ${response.status}.`;
        try {
          const payload = await response.json();
          if (payload?.error) message = payload.error;
        } catch { /* non-JSON body */ }
        throw new Error(message);
      }
      await fetchOrderDetail();
      onRefresh();
      flashAlloc("Reserved stock returned to warehouse.");
    } catch (err) {
      setAllocError(err instanceof Error ? err.message : "Failed to release stock.");
    } finally {
      setReleasingId(null);
    }
  };

  if (loading || !order) {
    return <div className="p-6 text-slate-400 animate-pulse font-medium">Loading operation workflow...</div>;
  }

  const getStatusBadge = (s: string) => {
    if (s === "Completed") return "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30";
    if (s === "Delivered") return "bg-teal-500/20 text-teal-300 border border-teal-500/30";
    if (s === "In Progress") return "bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse";
    if (s === "Ready") return "bg-blue-500/20 text-blue-300 border border-blue-500/30";
    if (s === "Rejected/Rework") return "bg-rose-500/20 text-rose-300 border border-rose-500/30";
    return "bg-slate-800 text-slate-400 border border-slate-700";
  };

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Back Button & Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/90 border border-slate-800/80 p-5 rounded-2xl shadow-sm">
        <div>
          <button
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-white mb-2 transition"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Orders Dashboard
          </button>
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="font-mono text-2xl font-black text-amber-400">{order.orderNumber}</span>
            <span className={`text-xs font-extrabold px-2.5 py-0.5 rounded uppercase ${
              order.status === "Completed" ? "bg-emerald-500 text-slate-950 font-black" : order.status === "Delivered" ? "bg-teal-500 text-slate-950 font-black" : "bg-amber-500 text-slate-950 font-black"
            }`}>
              {order.status}
            </span>
            <span className="text-xs text-slate-400 font-semibold bg-slate-800 px-2.5 py-0.5 rounded border border-slate-700">
              Priority: <strong className="text-white">{order.priority}</strong>
            </span>
          </div>
          <h1 className="text-xl font-extrabold text-white mt-1 tracking-tight">{order.title}</h1>
          <p className="text-sm text-slate-400 mt-0.5 flex flex-wrap items-center gap-3">
            <span>Client: <strong className="text-white font-extrabold text-sm">{order.customerCompany || order.customerName}</strong></span>
            <span>•</span>
            <span>Due Date: <strong className="text-amber-400">{new Date(order.dueDate).toLocaleDateString()}</strong></span>
            {order.totalValue != null && (
              <>
                <span>•</span>
                <span>Quote: <strong className="text-white font-mono font-bold">${Number(order.totalValue).toLocaleString()}</strong></span>
              </>
            )}
          </p>
        </div>

        {/* Action Tabs, Status & Delete */}
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={order.status || "Pending"}
            onChange={(e) => handleOrderStatusChange(e.target.value)}
            title="Change order status (Completed consumes reserved materials; On Hold / Cancelled releases them)"
            className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs font-bold text-white cursor-pointer focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          >
            {["Pending", "In Production", "Quality Review", "Completed", "On Hold", "Cancelled"].map((s) => (
              <option key={s} value={s} className="bg-slate-900 text-white">
                {s}
              </option>
            ))}
          </select>
          <div className="relative">
            {quoteLangOpen && (
              <div className="absolute left-0 top-11 z-40 w-44 rounded-xl border border-slate-700 bg-slate-900 p-1 shadow-2xl">
                {(["en", "fr", "ar"] as Lang[]).map((l) => (
                  <button
                    key={l}
                    onClick={() => { setQuoteLangOpen(false); generateQuotation(l); }}
                    className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-bold text-slate-300 transition hover:bg-slate-800 hover:text-white"
                  >
                    <span>{l === "en" ? "English" : l === "fr" ? "Français" : "العربية — طباعة"}</span>
                    <FileText className="h-3.5 w-3.5 text-amber-400" />
                  </button>
                ))}
              </div>
            )}
            <button
              onClick={() => setQuoteLangOpen((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs font-bold text-amber-300 hover:border-amber-500/50 hover:text-amber-200 transition"
              title="Quotation PDF — English, Français or العربية"
            >
              <FileText className="w-4 h-4" /> Quotation PDF ▾
            </button>
          </div>
          {(currentUser?.role === "Manager" || currentUser?.role === "Sales Coordinator") && onCloneOrder && (
            <button
              onClick={() =>
                onCloneOrder({
                  customerId: order.customerId,
                  title: `${order.title || "Order"} (copy)`,
                  projectType: order.projectType,
                  priority: order.priority,
                  totalValue: order.totalValue != null ? String(order.totalValue) : "",
                  dueDate: order.dueDate ? new Date(order.dueDate).toISOString().split("T")[0] : "",
                  notes: order.notes || "",
                  defaultSteps: order.productionPlan?.defaultSteps ?? [],
                  productionItems: order.productionPlan?.items ?? [],
                  steps: (order.operations ?? []).map((op: any) => ({
                    operationName: op.operationName,
                    machineId: op.machineId != null ? String(op.machineId) : "",
                    machineCategory: op.machineCategory || "",
                    estimatedMinutes: String(op.estimatedMinutes || 60),
                    auto: false,
                  })),
                  bom: (order.materials ?? [])
                    .filter((m: any) => m.itemId != null)
                    .map((m: any) => ({ itemId: String(m.itemId), qty: String(m.quantityUsed) })),
                })
              }
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs font-bold text-emerald-300 hover:border-emerald-500/50 hover:text-emerald-200 transition"
              title="Clone this order — opens the New Order form pre-filled with the same client, routing steps and materials"
            >
              <Copy className="w-4 h-4" /> Clone
            </button>
          )}
          <button
            onClick={openQr}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs font-bold text-sky-300 hover:border-sky-500/50 hover:text-sky-200 transition"
            title="Print a QR sticker for this order"
          >
            <QrCode className="w-4 h-4" /> QR Sticker
          </button>
          <button
            onClick={printJobTicket}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-500 border border-amber-500 text-xs font-black text-slate-950 hover:bg-amber-400 transition shadow-md shadow-amber-500/20"
            title="Print a job ticket — one sheet per order with every cut list, material, dimensions & station routing for the floor"
          >
            <Printer className="w-4 h-4" /> Job Ticket
          </button>
          <button
            onClick={printDeliveryNote}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-teal-500 border border-teal-500 text-xs font-black text-slate-950 hover:bg-teal-400 transition shadow-md shadow-teal-500/20"
            title="Print a delivery note — client-facing, address & signatures, qty-only"
          >
            <Truck className="w-4 h-4" /> Delivery Note
          </button>
          <button
            onClick={printDispatchPack}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-500 border border-indigo-500 text-xs font-black text-white hover:bg-indigo-400 transition shadow-md shadow-indigo-500/20"
            title="Print dispatch pack — job ticket + delivery note + QC + photos + proof in one stapled pack"
          >
            <Package className="w-4 h-4" /> Dispatch Pack
          </button>
          {canSendEmail && (
            <button
              onClick={openEmailModal}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-sky-500 border border-sky-500 text-xs font-black text-slate-950 hover:bg-sky-400 transition shadow-md shadow-sky-500/20"
              title="Email this order's documents (delivery note, dispatch pack, job ticket) to any recipient"
            >
              <Mail className="w-4 h-4" /> Email Docs
            </button>
          )}
          <div className="flex items-center bg-slate-950 p-1.5 rounded-xl border border-slate-800 text-xs">
            <button
              onClick={() => setActiveTab("workflow")}
              className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 transition ${
                activeTab === "workflow" ? "bg-amber-600 text-white shadow-sm" : "text-slate-400 hover:text-white"
              }`}
            >
              <Layers className="w-4 h-4" />
              <span>Machine Routing</span>
            </button>
            <button
              onClick={() => setActiveTab("materials")}
              className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 transition ${
                activeTab === "materials" ? "bg-amber-600 text-white shadow-sm" : "text-slate-400 hover:text-white"
              }`}
            >
              <Package className="w-4 h-4" />
              <span>BOM Materials ({order.materials?.length || 0})</span>
            </button>
          </div>

          <button
            onClick={handleDeleteOrder}
            className="p-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-xl border border-rose-500/30 transition"
            title="Delete Production Order"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Progress & Conveyor Banner */}
      <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-extrabold text-slate-300 uppercase tracking-wider flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span>Operational Workflow Conveyor</span>
          </div>
          <span className="text-xs font-mono font-black text-amber-400">
            {order.operations?.filter((o: any) => o.status === "Completed").length} / {order.operations?.length} operations finished ({order.progressPercent}%)
          </span>
        </div>
        <div className="w-full bg-slate-950 h-3 rounded-full overflow-hidden border border-slate-800">
          <div 
            className={`h-full rounded-full transition-all duration-500 ${
              order.progressPercent === 100 ? "bg-emerald-500 shadow-md shadow-emerald-500/50" : "bg-gradient-to-r from-amber-600 via-amber-500 to-amber-300"
            }`} 
            style={{ width: `${order.progressPercent || 0}%` }} 
          />
        </div>
        {order.notes && (
          <div className="mt-3 p-3 bg-slate-950/60 rounded-xl border border-slate-800 text-xs text-slate-300">
            <strong className="text-amber-400 font-bold">Client / Engineering Notes:</strong> {order.notes}
          </div>
        )}
      </div>

      {actionWarning && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-amber-500/50 bg-amber-500/10 p-4 text-sm font-bold text-amber-200" role="alert">
          <span className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 shrink-0 text-amber-400" />{actionWarning}</span>
          <button onClick={() => setActionWarning("")} className="rounded-lg px-2 py-1 text-xs text-amber-300 hover:bg-amber-500/20">Dismiss</button>
        </div>
      )}

      {actionError && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-rose-500/50 bg-rose-500/10 p-4 text-sm font-bold text-rose-200" role="alert">
          <span className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 shrink-0 text-rose-400" />{actionError}</span>
          <button onClick={() => setActionError("")} className="rounded-lg px-2 py-1 text-xs text-rose-300 hover:bg-rose-500/20">Dismiss</button>
        </div>
      )}

      {/* TAB CONTENT */}
      {activeTab === "workflow" ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">{order.productionPlan ? "Independent Material Job Chains" : "Sequential Manufacturing Operations"}</h3>
            {!order.productionPlan && (
              <button
                onClick={() => setShowAddStep(true)}
                className="bg-slate-800 hover:bg-slate-700 text-amber-400 font-bold text-xs px-3.5 py-1.5 rounded-xl border border-slate-700 transition flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" /> Insert Operation Step
              </button>
            )}
          </div>

          {canAssignMachines(currentUser?.role) && (
            <div className="rounded-2xl border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-xs leading-relaxed text-blue-100">
              <Cpu className="mr-1.5 inline h-4 w-4 text-blue-300" />
              <strong>Candidate stations:</strong> select one or more active machines of the required category on any waiting pass. The first operator to press Start claims that pass atomically; it then disappears from every unchosen station.
            </div>
          )}

          {order.productionPlan && (
            <div className="grid gap-3 md:grid-cols-2">
              {order.productionPlan.items.map((item: any) => {
                const liveSteps = item.steps.map((step: any) => order.operations?.find((operation: any) => operation.id === step.operationId));
                const completed = liveSteps.filter((step: any) => step?.status === "Completed").length;
                return (
                  <div key={item.materialId} className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-black text-white">{item.name}</div>
                      <span className="rounded-lg bg-slate-950 px-2 py-1 text-[10px] font-black uppercase text-amber-300">{completed}/{item.steps.length} passes done</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {item.steps.map((step: any, index: number) => (
                        <React.Fragment key={step.operationId}>
                          <span className={`rounded-lg border px-2 py-1 text-[10px] font-bold ${liveSteps[index]?.status === "Completed" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : liveSteps[index]?.status === "In Progress" ? "border-amber-400 bg-amber-500/20 text-amber-200" : "border-slate-700 bg-slate-950 text-slate-400"}`}>
                            {index + 1}. {step.operationName}
                          </span>
                          {index < item.steps.length - 1 && <span className="text-slate-600">→</span>}
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className={`space-y-4 relative ${order.productionPlan ? "" : "before:absolute before:left-6 before:top-4 before:bottom-4 before:w-0.5 before:bg-slate-800"}`}>
            {order.operations?.map((op: any, index: number) => {
              const isCompleted = op.status === "Completed";
              const isRunning = op.status === "In Progress";
              const isReady = op.status === "Ready";
              const isEditing = editingOpId === op.id;
              const candidateMachineIds: number[] = Array.isArray(op.candidateMachineIds)
                ? op.candidateMachineIds.map(Number).filter((id: number) => Number.isInteger(id) && id > 0)
                : op.machineId ? [Number(op.machineId)] : [];
              const equivalentMachines = machines.filter((machine: any) =>
                (machineCategoryMatches(op.machineCategory, machine.category) || machine.id === op.machineId)
                && (!["Maintenance", "Offline"].includes(machine.status) || candidateMachineIds.includes(machine.id))
              );
              const candidateSelectionLocked = !["Pending", "Ready"].includes(op.status);

              return (
                <div 
                  key={op.id}
                  className={`relative pl-14 transition-all duration-200 ${
                    isRunning ? "translate-x-1" : ""
                  }`}
                >
                  {/* Timeline Icon */}
                  <div className={`absolute left-2.5 top-5 w-7 h-7 rounded-full border-2 flex items-center justify-center font-black text-xs transition z-10 shadow-lg ${
                    isCompleted ? "bg-emerald-500 border-emerald-400 text-slate-950" :
                    isRunning ? "bg-amber-500 border-amber-300 text-slate-950 animate-bounce" :
                    isReady ? "bg-blue-500 border-blue-400 text-white" :
                    "bg-slate-900 border-slate-700 text-slate-500"
                  }`}>
                    {isCompleted ? <Check className="w-4 h-4 stroke-[3]" /> : (op.productionRoutePosition || index + 1)}
                  </div>

                  {/* Operation Card */}
                  <div className={`p-5 rounded-2xl border transition shadow-sm ${
                    isRunning 
                      ? "bg-gradient-to-r from-slate-900 via-slate-900 to-amber-950/20 border-amber-500 shadow-amber-950/30 shadow-md" 
                      : isCompleted
                      ? "bg-slate-900/60 border-emerald-500/20 opacity-90"
                      : "bg-slate-900/90 border-slate-800/80 hover:border-slate-700"
                  }`}>
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                      {/* Left: Title & Status */}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2.5 mb-1.5">
                          <span className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded uppercase ${getStatusBadge(op.status)}`}>
                            {op.status}
                          </span>
                          <span className="text-xs text-slate-500 font-medium">{op.productionItemName ? `Pass ${op.productionRoutePosition}/${op.productionRouteLength}` : `Step #${op.stepOrder}`}</span>
                          {op.productionItemName && (
                            <span className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-black uppercase text-amber-300">Material: {op.productionItemName}</span>
                          )}
                        </div>
                        <h4 className={`text-base font-extrabold tracking-tight ${
                          isRunning ? "text-amber-300 font-black" : isCompleted ? "text-emerald-300" : "text-white"
                        }`}>
                          {op.operationName}
                        </h4>

                        {/* Multi-station candidates; the database machine is claimed on first Start. */}
                        <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-slate-400">
                          <div className="flex max-w-full flex-wrap items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950/80 px-2.5 py-1.5">
                            <Cpu className="h-3.5 w-3.5 text-amber-400" />
                            <span className="font-semibold text-slate-500">
                              {candidateSelectionLocked ? "Claimed station:" : "Candidate stations:"}
                            </span>
                            {equivalentMachines.length === 0 && (
                              <span className="font-bold text-rose-300">No active matching station</span>
                            )}
                            {equivalentMachines.map((machine: any) => {
                              const selected = candidateMachineIds.includes(machine.id);
                              const unavailable = ["Maintenance", "Offline"].includes(machine.status);
                              const canEditCandidates = canAssignMachines(currentUser?.role) && !candidateSelectionLocked;
                              return (
                                <label
                                  key={machine.id}
                                  title={unavailable ? `${machine.code} is ${machine.status}` : candidateSelectionLocked ? "The first Start has fixed this station" : "Toggle this equivalent candidate station"}
                                  className={`flex items-center gap-1 rounded-md border px-2 py-1 font-black ${
                                    selected
                                      ? candidateSelectionLocked
                                        ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
                                        : "border-blue-500/50 bg-blue-500/10 text-blue-200"
                                      : "border-slate-700 bg-slate-900 text-slate-500"
                                  } ${canEditCandidates && (!unavailable || selected) ? "cursor-pointer hover:border-blue-400" : "cursor-not-allowed opacity-80"}`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={selected}
                                    disabled={!canEditCandidates || (unavailable && !selected) || busyOperationId !== null}
                                    onChange={() => {
                                      const next = selected
                                        ? candidateMachineIds.filter((id) => id !== machine.id)
                                        : [...candidateMachineIds, machine.id];
                                      void handleSaveCandidateStations(op.id, next);
                                    }}
                                    className="h-3.5 w-3.5 accent-blue-500"
                                  />
                                  {machine.code}
                                </label>
                              );
                            })}
                            {!candidateSelectionLocked && candidateMachineIds.length > 1 && (
                              <span className="font-bold text-blue-300">First Start claims one</span>
                            )}
                          </div>

                          <div className="flex items-center gap-1 text-slate-400">
                            <Clock className="w-3.5 h-3.5 text-slate-500" />
                            <span>Est: <strong className="text-slate-200 font-mono">{op.estimatedMinutes}m</strong></span>
                            {op.actualMinutes > 0 && (
                              <span className="text-emerald-400 font-mono"> | Actual: {op.actualMinutes}m</span>
                            )}
                          </div>

                          {op.operatorName && (
                            <div className="flex items-center gap-1 bg-slate-800/80 px-2 py-0.5 rounded text-[11px] text-slate-300">
                              <User className="w-3 h-3 text-emerald-400" />
                              <span>Operator: <strong>{op.operatorName}</strong></span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Right: Operator Touch Actions */}
                      <div className="flex flex-wrap items-center gap-2.5 flex-shrink-0 pt-3 lg:pt-0 border-t lg:border-0 border-slate-800">
                        {/* Start / Pause / Complete Action Buttons */}
                        {(op.status === "Ready" || op.status === "Rejected/Rework") && (
                          <button
                            onClick={() => handleUpdateOpStatus(op.id, "In Progress")}
                            disabled={busyOperationId !== null}
                            className="flex items-center gap-1.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 font-black px-4 py-2 rounded-xl text-xs shadow-md shadow-amber-600/20 transition active:scale-95 disabled:opacity-40"
                          >
                            <Play className="w-4 h-4 fill-slate-950 stroke-[2]" />
                            <span>{op.status === "Rejected/Rework" ? "START REWORK" : "START STATION"}</span>
                          </button>
                        )}
                        {op.status === "Pending" && (
                          <span className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[11px] font-bold text-slate-500">
                            <Clock className="h-3.5 w-3.5" /> Locked by previous step
                          </span>
                        )}

                        {isRunning && (
                          <>
                            <button
                              onClick={() => handleUpdateOpStatus(op.id, "Completed")}
                              disabled={busyOperationId !== null}
                              className="flex items-center gap-1.5 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-slate-950 font-black px-4 py-2 rounded-xl text-xs shadow-lg shadow-emerald-600/30 transition animate-pulse active:scale-95 disabled:opacity-40"
                            >
                              <CheckCircle2 className="w-4 h-4 stroke-[2.5]" />
                              <span>COMPLETE & ADVANCE NEXT</span>
                            </button>
                            <button
                              onClick={() => handleUpdateOpStatus(op.id, "Ready")}
                              disabled={busyOperationId !== null}
                              className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl border border-slate-700 transition disabled:opacity-40"
                              title="Pause Operation"
                            >
                              <Pause className="w-4 h-4" />
                            </button>
                          </>
                        )}

                        {isCompleted && (
                          <button
                            onClick={() => handleUpdateOpStatus(op.id, "In Progress", true)}
                            disabled={busyOperationId !== null}
                            className="text-xs bg-slate-800/80 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-xl border border-slate-700 flex items-center gap-1 transition disabled:opacity-40"
                            title="Re-open Step for Rework"
                          >
                            <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
                            <span>Re-open</span>
                          </button>
                        )}

                        <button
                          onClick={() => {
                            if (isEditing) {
                              setEditingOpId(null);
                            } else {
                              setEditingOpId(op.id);
                              setTempNotes(op.qualityNotes || "");
                              setTempActualMins(op.actualMinutes || op.estimatedMinutes || 60);
                            }
                          }}
                          className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs border border-slate-700 transition"
                        >
                          {isEditing ? "Close" : "Log QA & Mins"}
                        </button>

                        <button
                          onClick={() => handleUpdateOpStatus(op.id, "Rejected/Rework")}
                          disabled={busyOperationId !== null}
                          className="p-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-xl border border-rose-500/30 transition disabled:opacity-40"
                          title="Mark Rejected / Quality Rework"
                        >
                          <AlertTriangle className="w-4 h-4" />
                        </button>
                        {currentUser?.role === "Manager" && !order.productionPlan && (op.status === "Pending" || op.status === "Ready" || op.status === "Rejected/Rework") && (
                          <button
                            onClick={() => handleDeleteOperation(op)}
                            className="p-2 bg-slate-950 hover:bg-rose-500/15 text-slate-500 hover:text-rose-400 rounded-xl border border-slate-700 transition"
                            title="Remove unscheduled operation"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Inline Editor for QA & Minutes */}
                    {isEditing && (
                      <div className="mt-4 p-4 bg-slate-950 rounded-xl border border-amber-500/40 space-y-3">
                        <div className="text-xs font-bold text-amber-400 uppercase tracking-wider">
                          Operator Quality Check & Time Logging
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                          <div className="sm:col-span-1">
                            <label className="block text-xs font-semibold text-slate-400 mb-1">Actual Mins Taken</label>
                            <input
                              type="number"
                              value={tempActualMins}
                              onChange={(e) => setTempActualMins(Number(e.target.value))}
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white font-mono font-bold"
                            />
                          </div>
                          <div className="sm:col-span-3">
                            <label className="block text-xs font-semibold text-slate-400 mb-1">QA Inspector / Operator Notes</label>
                            <input
                              type="text"
                              placeholder="e.g. Clean laser cuts, tolerance +-0.1mm verified."
                              value={tempNotes}
                              onChange={(e) => setTempNotes(e.target.value)}
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                            />
                          </div>
                        </div>
                        <div className="flex justify-end">
                          <button
                            onClick={() => handleSaveOpDetails(op.id)}
                            className="bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold px-4 py-1.5 rounded-lg text-xs flex items-center gap-1.5 transition shadow"
                          >
                            <Save className="w-3.5 h-3.5" /> Save Quality Record
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Display QA notes if present and not editing */}
                    {!isEditing && op.qualityNotes && (
                      <div className="mt-3 text-xs bg-slate-950/60 p-2.5 rounded-xl border border-slate-800 text-slate-300 flex items-center gap-2">
                        <Check className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                        <span><strong>QA Log:</strong> {op.qualityNotes}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* MATERIALS / BOM TAB — interactive stock allocator */
        (() => {
          const materials: any[] = order.materials ?? [];
          const totalCost = materials.reduce(
            (sum, m) => sum + (m.quantityUsed || 0) * parseFloat(m.costPerUnit || "0"),
            0,
          );
          const allocatedItemIds = new Set(materials.map((m) => m.itemId));
          const selectedItem = inventoryItems.find((i) => String(i.id) === allocItemId);
          const existingForSelected = selectedItem ? materials.find((m) => m.itemId === selectedItem.id) : null;
          const alreadyReserved = existingForSelected?.quantityUsed ?? 0;
          const requestedQty = Number(allocQty) || 0;
          const delta = requestedQty - alreadyReserved;
          const wouldExceedStock = selectedItem && delta > 0 && selectedItem.stockQuantity < delta;

          return (
            <div className="space-y-4">
              {/* Materials Status Banner */}
              {(() => {
                const status: string = order.materialsStatus || "unknown";
                const bannerMap: Record<string, { bg: string; text: string; border: string; label: string }> = {
                  unknown:        { bg: "bg-slate-800/30", text: "text-slate-300", border: "border-slate-700", label: "No materials allocated" },
                  in_stock:       { bg: "bg-emerald-500/10", text: "text-emerald-300", border: "border-emerald-500/30", label: "All materials in stock" },
                  partial:        { bg: "bg-amber-500/10", text: "text-amber-300", border: "border-amber-500/30", label: "Partial shortage" },
                  out_of_stock:   { bg: "bg-rose-500/15", text: "text-rose-200", border: "border-rose-500/40", label: "Out of stock" },
                  consumed:       { bg: "bg-blue-500/10", text: "text-blue-300", border: "border-blue-500/30", label: "Materials fully consumed (order complete)" },
                };
                const b = bannerMap[status] || bannerMap.unknown;
                return (
                  <div className={`flex items-center justify-between gap-3 ${b.bg} ${b.text} border ${b.border} rounded-2xl px-4 py-2.5`}>
                    <div className="flex items-center gap-2 text-sm font-bold">
                      <Boxes className="w-4 h-4" />
                      Stock status: {b.label}
                    </div>
                    <div className="flex items-center gap-3">
                      {status !== "consumed" &&
                        materials.length > 0 &&
                        order.status !== "On Hold" &&
                        order.status !== "Cancelled" && (
                          <button
                            type="button"
                            onClick={() => void retryConsumeMaterials()}
                            title="Marks the order Completed and consumes its reserved stock. Use this when the automatic consumption failed while marking the order Completed (the order then keeps its previous status)."
                            className="rounded-xl bg-rose-600/90 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-white transition hover:bg-rose-500"
                          >
                            Run consumption now
                          </button>
                        )}
                      <span className="text-[10px] font-extrabold uppercase tracking-wider opacity-70">{status}</span>
                    </div>
                  </div>
                );
              })()}

              {/* Allocator */}
              <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-5 shadow-sm space-y-4">
                <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-800">
                  <div>
                    <h3 className="text-base font-extrabold text-white flex items-center gap-2">
                      <Boxes className="w-5 h-5 text-amber-400" /> Allocate stock to this order
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Reserves inventory against the order. Stock is consumed automatically when the order is marked Completed.
                    </p>
                  </div>
                  {materials.length > 0 && (
                    <div className="text-right rounded-xl border border-slate-800 bg-slate-950 px-3 py-1.5">
                      <div className="text-[10px] font-bold uppercase text-slate-500">BOM total</div>
                      <div className="font-mono text-sm font-black text-emerald-400 flex items-center gap-1 justify-end">
                        <DollarSign className="w-3.5 h-3.5" />
                        {totalCost.toFixed(2)}
                      </div>
                    </div>
                  )}
                </div>

                {(allocError || allocNotice) && (
                  <div
                    className={`flex items-center justify-between gap-3 rounded-xl border p-3 text-xs font-bold ${
                      allocError
                        ? "border-rose-500/40 bg-rose-500/10 text-rose-200"
                        : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                    }`}
                    role="status"
                  >
                    <span className="flex items-center gap-2">
                      {allocError ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                      {allocError || allocNotice}
                    </span>
                    <button
                      type="button"
                      onClick={() => { setAllocError(""); setAllocNotice(""); }}
                      className="rounded-lg px-2 py-0.5 text-xs hover:bg-white/10"
                    >
                      Dismiss
                    </button>
                  </div>
                )}

                {order.productionPlan ? (
                  <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-3 text-[11px] font-bold text-sky-200">
                    These stock rows are linked to independent material jobs and cannot be changed separately. Clone and recreate the order if its production plan must change.
                  </div>
                ) : inventoryItems.length === 0 ? (
                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-6 text-center text-xs text-slate-400">
                    <Package className="w-8 h-8 mx-auto mb-2 text-slate-600 stroke-[1.5]" />
                    No stock items are registered yet — add materials in the Wood &amp; Edge Stock tab first.
                  </div>
                ) : !canManageBom ? (
                  <p className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-[11px] text-slate-400">
                    Read-only view. Manager, Sales Coordinator or QA &amp; Dispatch roles can allocate stock.
                  </p>
                ) : (
                  <form onSubmit={handleAllocateMaterial} className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_140px_auto] gap-3 items-end">
                    <div>
                      <label htmlFor="alloc-item" className="block text-xs font-bold text-slate-300 mb-1.5">Stock item</label>
                      <select
                        id="alloc-item"
                        value={allocItemId}
                        onChange={(e) => { setAllocItemId(e.target.value); setAllocError(""); }}
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                      >
                        <option value="">— Choose warehouse item —</option>
                        {inventoryItems.map((item) => {
                          const already = allocatedItemIds.has(item.id) ? " · already on BOM" : "";
                          const low = item.stockQuantity <= item.reorderLevel ? " · LOW STOCK" : "";
                          return (
                            <option key={item.id} value={item.id}>
                              {item.sku} — {item.name} ({item.stockQuantity} {item.unit} in stock{low}{already})
                            </option>
                          );
                        })}
                      </select>
                      {selectedItem && (
                        <p className="mt-1.5 text-[11px] text-slate-400">
                          {selectedItem.stockQuantity} {selectedItem.unit} on hand · unit cost
                          <span className="ml-1 font-mono font-bold text-slate-200">${Number(selectedItem.unitCost).toFixed(2)}</span>
                          {alreadyReserved > 0 && (
                            <span className="ml-2 text-amber-400">Already reserved to this order: {alreadyReserved}</span>
                          )}
                        </p>
                      )}
                    </div>

                    <div>
                      <label htmlFor="alloc-qty" className="block text-xs font-bold text-slate-300 mb-1.5">Quantity</label>
                      <input
                        id="alloc-qty"
                        type="number"
                        min={1}
                        step={1}
                        value={allocQty}
                        onChange={(e) => setAllocQty(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-amber-500"
                      />
                      {selectedItem && (
                        <p className={`mt-1.5 text-[11px] font-mono ${wouldExceedStock ? "text-rose-400" : "text-slate-500"}`}>
                          Line cost: ${(requestedQty * parseFloat(selectedItem.unitCost || "0")).toFixed(2)}
                        </p>
                      )}
                    </div>

                    <button
                      type="submit"
                      disabled={allocBusy || !selectedItem || Boolean(wouldExceedStock)}
                      className="h-[42px] px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs shadow-md transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 justify-center"
                    >
                      {allocBusy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4 stroke-[2.5]" />}
                      {existingForSelected ? "Update reservation" : "Allocate stock"}
                    </button>
                  </form>
                )}
              </div>

              {/* BOM list */}
              <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-5 shadow-sm space-y-3">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                  <div>
                    <h3 className="text-base font-extrabold text-white">Reserved on this order</h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {materials.length === 0
                        ? "Nothing reserved yet."
                        : `${materials.length} item${materials.length === 1 ? "" : "s"} · ${materials.reduce((s, m) => s + m.quantityUsed, 0)} unit(s) held for production.`}
                    </p>
                  </div>
                </div>

                {materials.length === 0 ? (
                  <div className="py-10 text-center text-slate-500 text-xs">
                    <Package className="w-10 h-10 mx-auto mb-2 text-slate-600 stroke-[1.5]" />
                    No materials allocated to this specific order yet.
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {materials.map((m: any) => {
                      const lineTotal = (m.quantityUsed || 0) * parseFloat(m.costPerUnit || "0");
                      const label = `${m.itemSku ?? "item"} × ${m.quantityUsed} ${m.itemUnit ?? ""}`.trim();
                      const isConsumed = !!m.consumed;
                      const isReleased = !!m.released;
                      const remaining = (m.itemStockRemaining !== null && m.itemStockRemaining !== undefined)
                        ? Number(m.itemStockRemaining)
                        : null;
                      const stage = matProgress[String(m.id)]?.stage ?? "";
                      const plannedSteps: any[] = Array.isArray(m.productionRoute) ? m.productionRoute : [];
                      const lineSteps = plannedSteps.length > 0
                        ? plannedSteps.map((step: any) => step.stageKey)
                        : (matRoutes[String(m.id)] ?? stageSteps);
                      const stageLadderLine = ["", ...lineSteps, "DONE"];
                      const stagePos = stageLadderLine.indexOf(stage);
                      const stagePct = stagePos <= 0 ? 0 : Math.round((stagePos / (stageLadderLine.length - 1)) * 100);
                      return (
                        <li
                          key={m.id}
                          className={`p-3.5 border rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                            isReleased
                              ? "bg-slate-950/40 border-slate-800/60 opacity-60"
                              : isConsumed
                              ? "bg-blue-500/5 border-blue-500/20"
                              : "bg-slate-950/60 border-slate-800"
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-xs font-bold text-amber-400">{m.itemSku ?? "—"}</span>
                              <span className="font-bold text-white text-sm truncate">{m.productionItemName || m.itemName || "Unknown item"}</span>
                              {m.productionItemName && <span className="text-[10px] font-semibold text-slate-500">Stock: {m.itemName}</span>}
                              {(plannedSteps.length > 0 || matRoutes[String(m.id)]) && (
                                <span className="text-[10px] font-bold text-amber-400/90">Route: {plannedSteps.length > 0 ? plannedSteps.map((step: any) => step.operationName).join(" → ") : matRoutes[String(m.id)].join(" → ")}</span>
                              )}
                              {m.itemCategory && (
                                <span className="text-[10px] font-semibold text-slate-500">{m.itemCategory}</span>
                              )}
                              {isConsumed && (
                                <span className="text-[10px] font-extrabold uppercase bg-blue-500/20 text-blue-300 border border-blue-500/30 px-1.5 py-0.5 rounded">Consumed</span>
                              )}
                              {isReleased && (
                                <span className="text-[10px] font-extrabold uppercase bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded">Released</span>
                              )}
                              {stage === "DONE" ? (
                                <span className="text-[10px] font-extrabold uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-1.5 py-0.5 rounded">✓ Done</span>
                              ) : stage !== "" ? (
                                <span className="text-[10px] font-extrabold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/30 px-1.5 py-0.5 rounded">→ {stage}</span>
                              ) : (
                                <span className="text-[10px] font-extrabold uppercase bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded">Not started</span>
                              )}
                            </div>
                            <div className="mt-1.5 flex items-center gap-2">
                              <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-800">
                                <div className={`h-full rounded-full ${stage === "DONE" ? "bg-emerald-500" : stage !== "" ? "bg-amber-500/70" : ""}`} style={{ width: `${stagePct}%` }} />
                              </div>
                              <span className="text-[9px] font-black uppercase tracking-wider text-slate-600">{stage === "DONE" ? "complete" : stagePos <= 0 ? "queued" : `${stagePos}/${lineSteps.length}`}</span>
                            </div>
                            {remaining !== null && !isReleased && (
                              <p className="mt-1 text-[11px] text-slate-500">
                                Warehouse remaining after this reservation:
                                <span className={`ml-1 font-mono font-bold ${remaining <= (m.itemReorderLevel ?? 0) ? "text-rose-400" : "text-slate-300"}`}>
                                  {remaining} {m.itemUnit ?? ""}
                                </span>
                                {remaining <= (m.itemReorderLevel ?? 0) && (
                                  <span className="ml-1 text-rose-400">· at reorder level</span>
                                )}
                              </p>
                            )}
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              <div className="text-sm font-black text-white font-mono">
                                {m.quantityUsed} {m.itemUnit}
                              </div>
                              <div className="text-[10px] text-slate-400 font-mono">
                                @ ${Number(m.costPerUnit).toFixed(2)} · ${lineTotal.toFixed(2)}
                              </div>
                            </div>
                            {plannedSteps.length > 0 && (
                              <span className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-2 py-1.5 text-[10px] font-black uppercase text-sky-300">Controlled by station jobs</span>
                            )}
                            {canSetStage && plannedSteps.length === 0 && (
                              <select
                                value={stage}
                                onChange={(e) => setMatStage(m.id, e.target.value)}
                                className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-[11px] font-bold text-slate-200 focus:border-amber-500 focus:outline-none"
                                title="Where is this material in production right now?"
                              >
                                {allowedStages(lineSteps, stage).map((opt: string, oi: number) => (
                                  <option key={`${opt}-${oi}`} value={opt}>{opt === "DONE" ? "\u2713 Done" : opt === "" ? "Not started" : opt}</option>
                                ))}
                              </select>
                            )}
                            {canManageBom && !order.productionPlan && !isConsumed && !isReleased && (
                              <button
                                type="button"
                                onClick={() => handleReleaseMaterial(m.id, label)}
                                disabled={releasingId === m.id}
                                className="p-2 rounded-lg border border-slate-700 bg-slate-900 text-slate-400 hover:text-rose-300 hover:border-rose-500/40 transition disabled:opacity-40"
                                title="Release back to warehouse stock"
                                aria-label={`Release ${label}`}
                              >
                                {releasingId === m.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                              </button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          );
        })()
      )}

      {/* ADD STEP MODAL */}
      {showAddStep && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Plus className="w-5 h-5 text-amber-500" /> Insert Operation Step
            </h3>
            <form onSubmit={handleAddStep} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Operation Description</label>
                <input
                  type="text"
                  placeholder="e.g. Dowel Insertion & Pneumatic Clamp Press"
                  value={newOpName}
                  onChange={(e) => setNewOpName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Target Machine Station</label>
                <select
                  value={newOpMachineId}
                  onChange={(e) => setNewOpMachineId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                >
                  <option value="">Any Shop Floor Station</option>
                  {machines.map(m => (
                    <option key={m.id} value={m.id}>{m.code} - {m.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Estimated Minutes</label>
                <input
                  type="number"
                  value={newOpMins}
                  onChange={(e) => setNewOpMins(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono"
                  required
                />
              </div>
              <div className="flex justify-end gap-3 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddStep(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-bold hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold shadow-md"
                >
                  Add Step
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {qrOpen && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900 p-6 text-center shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-black text-white">Order QR sticker</h3>
              <button onClick={() => setQrOpen(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="rounded-2xl bg-white p-4 inline-block">
              {qrUrl && <img src={qrUrl} alt="Order QR code" className="h-56 w-56" />}
            </div>
            <div className="mt-3 font-mono text-xl font-black text-amber-400">{order.orderNumber}</div>
            <div className="text-xs text-slate-400 truncate">{order.title}</div>
            <p className="mt-2 text-[10px] text-slate-500">Scan with a phone to open this order, or scan at the Operator Station to jump to its job card.</p>
            <div className="mt-4 flex justify-center gap-2">
              <button onClick={() => setQrOpen(false)} className="rounded-xl bg-slate-800 px-4 py-2 text-xs font-bold text-slate-300 hover:bg-slate-700">Close</button>
              <button onClick={printQr} className="rounded-xl bg-sky-500 px-5 py-2 text-xs font-black text-slate-950 hover:bg-sky-400">Print sticker</button>
            </div>
          </div>
        </div>
      )}

      {emailOpen && order && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-black text-white">
                <Mail className="h-4 w-4 text-sky-400" /> Email documents — {order.orderNumber}
              </h3>
              <button onClick={() => setEmailOpen(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>

            {emailResult && (
              <div
                className={`mb-3 rounded-xl border px-3 py-2 text-xs font-bold ${
                  emailResult.ok
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                    : "border-rose-500/40 bg-rose-500/10 text-rose-300"
                }`}
              >
                {emailResult.text}
              </div>
            )}

            <div className="space-y-2.5">
              <label className="block">
                <span className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">To</span>
                <input
                  value={emailTo}
                  onChange={(e) => setEmailTo(e.target.value)}
                  placeholder="name@company.com — comma or newline for several"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-200 placeholder-slate-600 focus:border-sky-500 focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Cc (optional)</span>
                <input
                  value={emailCc}
                  onChange={(e) => setEmailCc(e.target.value)}
                  placeholder="leave empty for no cc"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-200 placeholder-slate-600 focus:border-sky-500 focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Subject</span>
                <input
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-200 focus:border-sky-500 focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Message</span>
                <textarea
                  value={emailMessage}
                  onChange={(e) => setEmailMessage(e.target.value)}
                  rows={3}
                  placeholder="Short note for the recipient…"
                  className="w-full resize-y rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-200 placeholder-slate-600 focus:border-sky-500 focus:outline-none"
                />
              </label>
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-slate-500">Documents to attach</span>
                <div className="space-y-1.5">
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-300">
                    <input
                      type="checkbox"
                      checked={emailIncludes.deliveryNote}
                      onChange={(e) => setEmailIncludes({ ...emailIncludes, deliveryNote: e.target.checked })}
                      className="h-4 w-4 accent-sky-500"
                    />
                    Delivery note <span className="text-slate-500">— client-facing, qty-only</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-300">
                    <input
                      type="checkbox"
                      checked={emailIncludes.dispatchPack}
                      onChange={(e) => setEmailIncludes({ ...emailIncludes, dispatchPack: e.target.checked })}
                      className="h-4 w-4 accent-sky-500"
                    />
                    Dispatch pack <span className="text-slate-500">— ticket + note + QC + photos + proof</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-300">
                    <input
                      type="checkbox"
                      checked={emailIncludes.jobTicket}
                      onChange={(e) => setEmailIncludes({ ...emailIncludes, jobTicket: e.target.checked })}
                      className="h-4 w-4 accent-sky-500"
                    />
                    Job ticket <span className="text-slate-500">— floor sheet with cut lists & routing</span>
                  </label>
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                onClick={() => setEmailOpen(false)}
                disabled={emailBusy}
                className="rounded-xl bg-slate-800 px-4 py-2 text-xs font-bold text-slate-300 hover:bg-slate-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={sendEmailDispatch}
                disabled={emailBusy || !emailTo.trim()}
                className="flex items-center gap-1.5 rounded-xl bg-sky-500 px-5 py-2 text-xs font-black text-slate-950 hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Mail className="h-3.5 w-3.5" />
                {emailBusy ? "Sending…" : "Send email"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
