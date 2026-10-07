"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  BadgeCheck,
  BriefcaseBusiness,
  CalendarDays,
  Camera,
  Check,
  CircleDollarSign,
  Download,
  FileText,
  IdCard,
  ListChecks,
  Paperclip,
  Plus,
  Printer,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  UserRound,
  Users,
  X,
  XCircle,
} from "lucide-react";
import {
  COMMON_NATIONALITIES,
  HR_DEPARTMENTS,
  HR_DOCUMENT_TYPES,
  HR_EMPLOYMENT_STATUSES,
  HR_GENDERS,
  HR_MARITAL_STATUSES,
  NO_LOGIN_EMAIL_DOMAIN,
  inclusiveDays,
  type HrDocumentType,
  type LeaveType,
  type PayAdjustment,
} from "@/lib/hrPayroll";

interface HrEmployee {
  id: number;
  name: string;
  email: string;
  role: string;
  active: boolean;
  canLogin: boolean;
  avatarColor: string;
  profileId: number | null;
  jobTitle: string | null;
  hireDate: string | null;
  baseSalaryCents: number | null;
  profileComplete: boolean;
  employeeCode: string | null;
  department: string | null;
  employmentStatus: string | null;
  nationality: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  maritalStatus: string | null;
  phone: string | null;
  address: string | null;
  idNumber: string | null;
  passportNumber: string | null;
  visaNumber: string | null;
  residencyNumber: string | null;
  residencyExpiry: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  notes: string | null;
  photoFile: string | null;
}

interface HrDocument {
  id: number;
  userId: number;
  docType: string;
  title: string;
  fileName: string;
  originalName: string;
  mime: string;
  size: number;
  expiryDate: string | null;
  createdAt: string;
}

interface HrLeaveRecord {
  id: number;
  userId: number | null;
  employeeName: string;
  employeeRole: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: "Pending" | "Approved" | "Declined";
  reviewNote: string;
  reviewedByName: string | null;
  createdAt: string;
}

interface PayrollItem {
  id: number;
  runId: number;
  userId: number | null;
  employeeName: string;
  roleSnapshot: string;
  baseSalaryCents: number;
  additionsJson: unknown;
  deductionsJson: unknown;
  netPayCents: number;
}

interface PayrollRun {
  id: number;
  periodYear: number;
  periodMonth: number;
  status: "Draft" | "Posted";
  createdAt: string;
  postedAt: string | null;
  employeeCount: number;
  netTotalCents: number;
  items?: PayrollItem[];
}

interface PayrollBoard {
  selectedRun: (PayrollRun & { items: PayrollItem[] }) | null;
  runs: PayrollRun[];
}

interface HrPayrollViewProps {
  currentUser: { name?: string; role?: string } | null;
}

const INPUT = "w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none";
const SMALL_LABEL = "mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500";

function localYmd(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateLabel(value: string | null | undefined): string {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Date(year, month - 1, day).toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" });
}

function monthLabel(year: number, month: number): string {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString([], { month: "long", year: "numeric", timeZone: "UTC" });
}

function money(cents: number | null | undefined): string {
  const safe = Number(cents);
  return `$${(Number.isFinite(safe) ? safe / 100 : 0).toFixed(2)}`;
}

function fileSize(bytes: number | null | undefined): string {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function textOr(value: string | null | undefined, fallback = "—"): string {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function photoUrl(userId: number, stamp: number): string {
  return `/api/hr/photo?userId=${userId}&v=${stamp}`;
}

/** HR-only staff created without an e-mail carry a placeholder — never show it. */
function displayEmail(employee: { email: string }): string {
  const email = String(employee.email ?? "");
  return email.toLowerCase().endsWith(`@${NO_LOGIN_EMAIL_DOMAIN}`) ? "" : email;
}

function jsonLines(value: unknown): PayAdjustment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const line = entry as Record<string, unknown>;
    const label = String(line.label ?? "").trim();
    const amountCents = Number(line.amountCents);
    return label && Number.isSafeInteger(amountCents) && amountCents > 0 ? [{ label, amountCents }] : [];
  });
}

async function payloadOf<T>(response: Response, fallback: string): Promise<T> {
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(body.error || fallback);
  return body as T;
}

function dayCount(from: string, to: string): number {
  return inclusiveDays(from, to);
}

function StatusPill({ status }: { status: string }) {
  const color = status === "Approved" || status === "Posted"
    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
    : status === "Pending" || status === "Draft"
      ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
      : "border-slate-700 bg-slate-800/70 text-slate-400";
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${color}`}>{status}</span>;
}

export default function HrPayrollView({ currentUser }: HrPayrollViewProps) {
  const [tab, setTab] = useState<"employees" | "leave" | "payroll">("employees");
  const [employees, setEmployees] = useState<HrEmployee[]>([]);
  const [leaveRows, setLeaveRows] = useState<HrLeaveRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [payrollLoading, setPayrollLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const [search, setSearch] = useState("");
  const [leaveStatus, setLeaveStatus] = useState("All");
  const [leaveEmployeeId, setLeaveEmployeeId] = useState("All employees");
  const [periodYear, setPeriodYear] = useState(() => new Date().getFullYear());
  const [periodMonth, setPeriodMonth] = useState(() => new Date().getMonth() + 1);
  const [payrollBoard, setPayrollBoard] = useState<PayrollBoard | null>(null);
  const payrollRequestRef = useRef(0);

  const [editingEmployee, setEditingEmployee] = useState<HrEmployee | null>(null);
  const [profileForm, setProfileForm] = useState({
    jobTitle: "",
    hireDate: "",
    monthlySalary: "",
    employeeCode: "",
    department: "",
    employmentStatus: "Active",
    nationality: "",
    dateOfBirth: "",
    gender: "",
    maritalStatus: "",
    phone: "",
    address: "",
    idNumber: "",
    passportNumber: "",
    visaNumber: "",
    residencyNumber: "",
    residencyExpiry: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
    notes: "",
  });
  // --- Employee card: system roles, editable job titles, photo & documents ---
  const [systemRoles, setSystemRoles] = useState<string[]>([]);
  const [jobTitles, setJobTitles] = useState<string[]>([]);
  const [cardEmployee, setCardEmployee] = useState<HrEmployee | null>(null);
  const [cardDocs, setCardDocs] = useState<HrDocument[]>([]);
  const [cardDocsLoading, setCardDocsLoading] = useState(false);
  const [photoStamp, setPhotoStamp] = useState(() => Date.now());
  const [photoBusy, setPhotoBusy] = useState(false);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const photoTargetRef = useRef<HrEmployee | null>(null);
  const [docForm, setDocForm] = useState({ docType: "Identity Card" as HrDocumentType | string, title: "", expiryDate: "" });
  const [docBusy, setDocBusy] = useState(false);
  const docInputRef = useRef<HTMLInputElement | null>(null);
  const [titlesOpen, setTitlesOpen] = useState(false);
  const [titlesDraft, setTitlesDraft] = useState("");
  const [titlesBusy, setTitlesBusy] = useState(false);
  // --- HR-only (no-login) employees -------------------------------------------
  const [loginFilter, setLoginFilter] = useState<"all" | "login" | "nologin">("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: "",
    email: "",
    jobTitle: "",
    department: "",
    nationality: "",
    phone: "",
    hireDate: "",
    monthlySalary: "",
  });
  const [loginModal, setLoginModal] = useState<HrEmployee | null>(null);
  const [loginForm, setLoginForm] = useState({ role: "Machine Operator", pin: "" });
  const [leaveForm, setLeaveForm] = useState({ userId: "", leaveType: "Annual" as LeaveType, startDate: localYmd(), endDate: localYmd(), reason: "" });
  const [editingItem, setEditingItem] = useState<PayrollItem | null>(null);
  const [additionDrafts, setAdditionDrafts] = useState<Array<{ label: string; amount: string }>>([]);
  const [deductionDrafts, setDeductionDrafts] = useState<Array<{ label: string; amount: string }>>([]);
  const [slipItem, setSlipItem] = useState<PayrollItem | null>(null);

  const isManager = currentUser?.role === "Manager";

  const flashMsg = (message: string) => {
    setFlash(message);
    window.setTimeout(() => setFlash(""), 3500);
  };

  const loadDirectory = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [employeeResponse, leaveResponse] = await Promise.all([
        fetch("/api/hr/employees", { cache: "no-store" }),
        fetch("/api/hr/leave", { cache: "no-store" }),
      ]);
      const [employeeRows, leaves] = await Promise.all([
        payloadOf<HrEmployee[]>(employeeResponse, "Failed to load employee profiles."),
        payloadOf<HrLeaveRecord[]>(leaveResponse, "Failed to load leave records."),
      ]);
      setEmployees(employeeRows);
      setLeaveRows(leaves);
      setLeaveForm((current) => ({ ...current, userId: current.userId || String(employeeRows.find((row) => row.active)?.id ?? "") }));
      setCardEmployee((current) => (current ? employeeRows.find((row) => row.id === current.id) ?? current : current));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load HR records.");
    } finally {
      setLoading(false);
    }
  }, []);

  // System roles (built-in + Manager-defined) feed the job-title picker so the
  // HR job description stays connected to the access role; the editable job
  // titles are the fallback for staff whose role does not describe their job.
  const loadRoleLookups = useCallback(async () => {
    try {
      const rolesResponse = await fetch("/api/roles", { cache: "no-store" });
      if (rolesResponse.ok) {
        const body = (await rolesResponse.json().catch(() => ({}))) as { roles?: Array<{ name?: string }> };
        const customs = Array.isArray(body.roles) ? body.roles.map((r) => String(r?.name ?? "").trim()).filter(Boolean) : [];
        const { ROLES } = await import("@/lib/permissions");
        setSystemRoles([...ROLES, ...customs]);
      }
    } catch {
      /* job-title picker still works with the editable list alone */
    }
    try {
      const titlesResponse = await fetch("/api/hr/job-titles", { cache: "no-store" });
      if (titlesResponse.ok) {
        const body = (await titlesResponse.json().catch(() => ({}))) as { titles?: unknown };
        setJobTitles(Array.isArray(body.titles) ? body.titles.map((t) => String(t ?? "").trim()).filter(Boolean) : []);
      }
    } catch {
      /* same — free text stays allowed */
    }
  }, []);

  const loadCardDocs = useCallback(async (userId: number) => {
    setCardDocsLoading(true);
    try {
      const response = await fetch(`/api/hr/documents?userId=${userId}`, { cache: "no-store" });
      const docs = await payloadOf<HrDocument[]>(response, "Failed to load employee documents.");
      setCardDocs(docs);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load employee documents.");
      setCardDocs([]);
    } finally {
      setCardDocsLoading(false);
    }
  }, []);

  const loadPayroll = useCallback(async (year: number, month: number) => {
    const requestId = ++payrollRequestRef.current;
    setPayrollLoading(true);
    setPayrollBoard(null);
    setError("");
    try {
      const response = await fetch(`/api/hr/payroll?year=${year}&month=${month}`, { cache: "no-store" });
      const board = await payloadOf<PayrollBoard>(response, "Failed to load payroll.");
      if (requestId === payrollRequestRef.current) setPayrollBoard(board);
    } catch (cause) {
      if (requestId === payrollRequestRef.current) setError(cause instanceof Error ? cause.message : "Could not load payroll.");
    } finally {
      if (requestId === payrollRequestRef.current) setPayrollLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadDirectory(); void loadRoleLookups(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadDirectory, loadRoleLookups]);
  useEffect(() => {
    if (tab !== "payroll") return;
    const timer = window.setTimeout(() => { void loadPayroll(periodYear, periodMonth); }, 0);
    return () => window.clearTimeout(timer);
  }, [tab, periodYear, periodMonth, loadPayroll]);

  const filteredEmployees = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees.filter((employee) =>
      (loginFilter === "all" || (loginFilter === "login") === Boolean(employee.canLogin))
      && (!q || [employee.name, employee.email, employee.role, employee.jobTitle, employee.nationality, employee.employeeCode, employee.department, employee.phone]
        .some((value) => String(value ?? "").toLowerCase().includes(q))));
  }, [employees, search, loginFilter]);

  const noLoginCount = useMemo(() => employees.filter((employee) => !employee.canLogin).length, [employees]);

  const jobTitleSuggestions = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ value: string; group: string }> = [];
    for (const role of systemRoles) {
      const key = role.toLowerCase();
      if (!role || seen.has(key)) continue;
      seen.add(key);
      out.push({ value: role, group: "System role" });
    }
    for (const title of jobTitles) {
      const key = title.toLowerCase();
      if (!title || seen.has(key)) continue;
      seen.add(key);
      out.push({ value: title, group: "Job titles list" });
    }
    return out;
  }, [systemRoles, jobTitles]);

  const filteredLeave = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leaveRows.filter((row) =>
      (leaveStatus === "All" || row.status === leaveStatus)
      && (!leaveEmployeeId || leaveEmployeeId === "All employees" || String(row.userId) === leaveEmployeeId)
      && (!q || [row.employeeName, row.leaveType, row.reason, row.status].some((value) => String(value ?? "").toLowerCase().includes(q))),
    );
  }, [leaveRows, leaveStatus, leaveEmployeeId, search]);

  const payrollRun = payrollBoard?.selectedRun ?? null;
  const payrollItems = useMemo(() => payrollRun?.items ?? [], [payrollRun]);
  const activeWithProfile = employees.filter((employee) => employee.active && employee.profileComplete).length;
  const activeWithoutProfile = employees.filter((employee) => employee.active && !employee.profileComplete).length;
  const pendingLeaveCount = leaveRows.filter((row) => row.status === "Pending").length;

  const openEmployeeEditor = (employee: HrEmployee) => {
    setEditingEmployee(employee);
    setProfileForm({
      // Linked to the system role until HR picks something else: a blank job
      // title opens prefilled with the employee's access role.
      jobTitle: employee.jobTitle || employee.role || "",
      hireDate: employee.hireDate ?? "",
      monthlySalary: employee.baseSalaryCents == null ? "" : (employee.baseSalaryCents / 100).toFixed(2),
      employeeCode: employee.employeeCode ?? "",
      department: employee.department ?? "",
      employmentStatus: employee.employmentStatus || "Active",
      nationality: employee.nationality ?? "",
      dateOfBirth: employee.dateOfBirth ?? "",
      gender: employee.gender ?? "",
      maritalStatus: employee.maritalStatus ?? "",
      phone: employee.phone ?? "",
      address: employee.address ?? "",
      idNumber: employee.idNumber ?? "",
      passportNumber: employee.passportNumber ?? "",
      visaNumber: employee.visaNumber ?? "",
      residencyNumber: employee.residencyNumber ?? "",
      residencyExpiry: employee.residencyExpiry ?? "",
      emergencyContactName: employee.emergencyContactName ?? "",
      emergencyContactPhone: employee.emergencyContactPhone ?? "",
      notes: employee.notes ?? "",
    });
    setError("");
    void loadCardDocs(employee.id);
  };

  const saveEmployeeProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingEmployee) return;
    const amount = Number(profileForm.monthlySalary);
    if (!Number.isFinite(amount) || amount < 0 || amount > 999999.99) {
      setError("Enter a monthly salary from $0.00 to $999,999.99.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/hr/employees", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: editingEmployee.id,
          jobTitle: profileForm.jobTitle,
          hireDate: profileForm.hireDate || null,
          baseSalaryCents: Math.round(amount * 100),
          employeeCode: profileForm.employeeCode,
          department: profileForm.department,
          employmentStatus: profileForm.employmentStatus,
          nationality: profileForm.nationality,
          dateOfBirth: profileForm.dateOfBirth || null,
          gender: profileForm.gender,
          maritalStatus: profileForm.maritalStatus,
          phone: profileForm.phone,
          address: profileForm.address,
          idNumber: profileForm.idNumber,
          passportNumber: profileForm.passportNumber,
          visaNumber: profileForm.visaNumber,
          residencyNumber: profileForm.residencyNumber,
          residencyExpiry: profileForm.residencyExpiry || null,
          emergencyContactName: profileForm.emergencyContactName,
          emergencyContactPhone: profileForm.emergencyContactPhone,
          notes: profileForm.notes,
        }),
      });
      await payloadOf(response, "Failed to save employee profile.");
      setEditingEmployee(null);
      flashMsg(`Employee card saved for ${editingEmployee.name}.`);
      await loadDirectory();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the employee profile.");
    } finally {
      setSaving(false);
    }
  };

  const openEmployeeCard = (employee: HrEmployee) => {
    setCardEmployee(employee);
    setCardDocs([]);
    setError("");
    void loadCardDocs(employee.id);
  };

  // --- Personal photo ------------------------------------------------------
  const pickPhoto = (employee: HrEmployee) => {
    photoTargetRef.current = employee;
    photoInputRef.current?.click();
  };

  const uploadPhotoFile = async (file: File | null) => {
    const target = photoTargetRef.current;
    if (!file || !target) return;
    setPhotoBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("userId", String(target.id));
      form.append("photo", file);
      const response = await fetch("/api/hr/photo", { method: "POST", body: form });
      await payloadOf(response, "Failed to upload the photo.");
      setPhotoStamp(Date.now());
      flashMsg(`Personal photo saved for ${target.name}.`);
      await loadDirectory();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not upload the photo.");
    } finally {
      setPhotoBusy(false);
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
  };

  const removePhoto = async (employee: HrEmployee) => {
    if (!window.confirm(`Remove the personal photo of ${employee.name}?`)) return;
    setPhotoBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/hr/photo?userId=${employee.id}`, { method: "DELETE" });
      await payloadOf(response, "Failed to remove the photo.");
      setPhotoStamp(Date.now());
      flashMsg("Personal photo removed.");
      await loadDirectory();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove the photo.");
    } finally {
      setPhotoBusy(false);
    }
  };

  // --- Card documents --------------------------------------------------------
  const uploadDocumentFile = async (file: File | null, employee: HrEmployee | null) => {
    if (!file || !employee) return;
    setDocBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("userId", String(employee.id));
      form.append("docType", docForm.docType);
      form.append("title", docForm.title);
      form.append("expiryDate", docForm.expiryDate);
      form.append("file", file);
      const response = await fetch("/api/hr/documents", { method: "POST", body: form });
      await payloadOf<HrDocument>(response, "Failed to upload the document.");
      flashMsg(`${docForm.docType} attached to ${employee.name}.`);
      setDocForm((current) => ({ ...current, title: "", expiryDate: "" }));
      await loadCardDocs(employee.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not upload the document.");
    } finally {
      setDocBusy(false);
      if (docInputRef.current) docInputRef.current.value = "";
    }
  };

  const deleteDocument = async (doc: HrDocument, employee: HrEmployee | null) => {
    if (!employee || !window.confirm(`Delete “${doc.docType}” (${doc.originalName || doc.fileName})?`)) return;
    setDocBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/hr/documents?id=${doc.id}`, { method: "DELETE" });
      await payloadOf(response, "Failed to delete the document.");
      flashMsg("Document deleted.");
      await loadCardDocs(employee.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete the document.");
    } finally {
      setDocBusy(false);
    }
  };

  // --- Editable job-description list ------------------------------------------
  const saveJobTitles = async (next: string[]) => {
    setTitlesBusy(true);
    setError("");
    try {
      const response = await fetch("/api/hr/job-titles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ titles: next }),
      });
      const body = await payloadOf<{ titles: string[] }>(response, "Failed to save job titles.");
      setJobTitles(Array.isArray(body.titles) ? body.titles : next);
      flashMsg("Job titles updated.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save job titles.");
    } finally {
      setTitlesBusy(false);
    }
  };

  const addJobTitle = () => {
    const title = titlesDraft.trim().replace(/\s+/g, " ");
    if (!title) return;
    if (jobTitles.some((t) => t.toLowerCase() === title.toLowerCase())) {
      setError("This job title is already on the list.");
      return;
    }
    setTitlesDraft("");
    void saveJobTitles([...jobTitles, title]);
  };

  // --- HR-only employee accounts ------------------------------------------------
  const openCreateEmployee = () => {
    setCreateForm({ name: "", email: "", jobTitle: "", department: "", nationality: "", phone: "", hireDate: "", monthlySalary: "" });
    setCreateOpen(true);
    setError("");
  };

  const createEmployee = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!createForm.name.trim()) {
      setError("Enter the employee's name.");
      return;
    }
    const amount = createForm.monthlySalary.trim() === "" ? 0 : Number(createForm.monthlySalary);
    if (!Number.isFinite(amount) || amount < 0 || amount > 999999.99) {
      setError("Enter a monthly salary from $0.00 to $999,999.99.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/hr/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: createForm.name.trim(),
          email: createForm.email.trim(),
          jobTitle: createForm.jobTitle.trim(),
          department: createForm.department.trim(),
          nationality: createForm.nationality.trim(),
          phone: createForm.phone.trim(),
          hireDate: createForm.hireDate || null,
          baseSalaryCents: Math.round(amount * 100),
        }),
      });
      const created = await payloadOf<{ id: number; name: string }>(response, "Failed to create the employee.");
      setCreateOpen(false);
      setLoginFilter("all");
      flashMsg(`${created.name} added (no login). Open the card to complete the details.`);
      await loadDirectory();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the employee.");
    } finally {
      setSaving(false);
    }
  };

  const patchAccount = async (employee: HrEmployee, action: "enableLogin" | "disableLogin" | "setActive", extra?: Record<string, unknown>) => {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/hr/employees", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, userId: employee.id, ...(extra ?? {}) }),
      });
      const updated = await payloadOf<HrEmployee>(response, "Failed to update the employee account.");
      flashMsg(
        action === "enableLogin" ? `Sign-in enabled for ${employee.name}.`
        : action === "disableLogin" ? `Sign-in disabled for ${employee.name}.`
        : `${employee.name} ${updated.active ? "activated" : "deactivated"}.`,
      );
      await loadDirectory();
      setCardEmployee((current) => (current && current.id === employee.id ? { ...current, ...updated } : current));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update the employee account.");
    } finally {
      setSaving(false);
    }
  };

  const submitEnableLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!loginModal) return;
    if (!/^\d{4}$/.test(loginForm.pin.trim())) {
      setError("Enter a four-digit PIN for the new login.");
      return;
    }
    setLoginModal(null);
    await patchAccount(loginModal, "enableLogin", { role: loginForm.role, pin: loginForm.pin.trim() });
    setLoginForm({ role: "Machine Operator", pin: "" });
  };

  const deleteEmployeeRecord = async (employee: HrEmployee) => {
    if (!window.confirm(`Permanently delete the HR record of ${employee.name}? The card and its attachments are removed; leave and payroll history keep their snapshots. This cannot be undone.`)) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/hr/employees?userId=${employee.id}`, { method: "DELETE" });
      await payloadOf(response, "Failed to delete the employee.");
      setCardEmployee(null);
      setEditingEmployee(null);
      flashMsg(`${employee.name} deleted.`);
      await loadDirectory();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete the employee.");
    } finally {
      setSaving(false);
    }
  };

  const submitLeave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/hr/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...leaveForm, userId: Number(leaveForm.userId) }),
      });
      const created = await payloadOf<{ id: number }>(response, "Failed to record leave.");
      flashMsg("Leave record submitted for HR review.");
      setLeaveForm((current) => ({ ...current, reason: "" }));
      await loadDirectory();
      setTab("leave");
      setSearch("");
      setLeaveStatus("All");
      setLeaveEmployeeId("All employees");
      void created;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not record leave.");
    } finally {
      setSaving(false);
    }
  };

  const reviewLeave = async (row: HrLeaveRecord, status: "Approved" | "Declined") => {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/hr/leave", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, status }),
      });
      await payloadOf(response, "Failed to review leave.");
      flashMsg(`Leave ${status.toLowerCase()}.`);
      await loadDirectory();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not review leave.");
    } finally {
      setSaving(false);
    }
  };

  const createPayroll = async () => {
    if (activeWithProfile === 0) {
      setError("Set up at least one active employee's salary profile before generating payroll.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/hr/payroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year: periodYear, month: periodMonth }),
      });
      await payloadOf(response, "Failed to create payroll draft.");
      flashMsg(`Draft payroll created for ${monthLabel(periodYear, periodMonth)}.`);
      await loadPayroll(periodYear, periodMonth);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the payroll draft.");
    } finally {
      setSaving(false);
    }
  };

  const beginAdjustmentEdit = (item: PayrollItem) => {
    setEditingItem(item);
    setAdditionDrafts(jsonLines(item.additionsJson).map((line) => ({ label: line.label, amount: (line.amountCents / 100).toFixed(2) })));
    setDeductionDrafts(jsonLines(item.deductionsJson).map((line) => ({ label: line.label, amount: (line.amountCents / 100).toFixed(2) })));
    setError("");
  };

  const saveAdjustments = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingItem || !payrollRun) return;
    const toLine = (line: { label: string; amount: string }) => ({ label: line.label, amountCents: Math.round(Number(line.amount) * 100) });
    const body = {
      action: "adjust",
      runId: payrollRun.id,
      itemId: editingItem.id,
      additions: additionDrafts.map(toLine),
      deductions: deductionDrafts.map(toLine),
    };
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/hr/payroll", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      await payloadOf(response, "Failed to save payroll adjustments.");
      setEditingItem(null);
      flashMsg(`Adjustments saved for ${editingItem.employeeName}.`);
      await loadPayroll(periodYear, periodMonth);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save payroll adjustments.");
    } finally {
      setSaving(false);
    }
  };

  const postPayroll = async () => {
    if (!payrollRun || !window.confirm(`Post payroll for ${monthLabel(periodYear, periodMonth)}? This locks every payslip in the run.`)) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/hr/payroll", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "post", runId: payrollRun.id }),
      });
      await payloadOf(response, "Failed to post payroll.");
      flashMsg("Payroll posted and payslips locked.");
      await loadPayroll(periodYear, periodMonth);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not post payroll.");
    } finally {
      setSaving(false);
    }
  };

  const deletePayrollDraft = async () => {
    if (!payrollRun || payrollRun.status !== "Draft" || !window.confirm(`Delete the unposted ${monthLabel(periodYear, periodMonth)} draft? This cannot be undone.`)) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/hr/payroll?runId=${payrollRun.id}`, { method: "DELETE" });
      await payloadOf(response, "Failed to delete the draft.");
      flashMsg("Unposted payroll draft deleted.");
      await loadPayroll(periodYear, periodMonth);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete the draft.");
    } finally {
      setSaving(false);
    }
  };

  const visiblePayrollItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return payrollItems.filter((item) => !q || [item.employeeName, item.roleSnapshot].some((value) => String(value ?? "").toLowerCase().includes(q)));
  }, [payrollItems, search]);

  const editorNetCents = useMemo(() => {
    const lineTotal = (lines: Array<{ label: string; amount: string }>) => lines.reduce((sum, line) => {
      const n = Number(line.amount);
      return sum + (Number.isFinite(n) ? Math.round(n * 100) : 0);
    }, 0);
    return (editingItem?.baseSalaryCents ?? 0) + lineTotal(additionDrafts) - lineTotal(deductionDrafts);
  }, [editingItem, additionDrafts, deductionDrafts]);

  const openSlip = (item: PayrollItem) => setSlipItem(item);

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-5 max-w-[1500px] mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-amber-300">
            <ShieldCheck className="h-3.5 w-3.5" /> Private HR workspace
          </div>
          <h1 className="mt-3 flex items-center gap-3 text-2xl font-black tracking-tight text-white sm:text-3xl">
            <Users className="h-7 w-7 text-amber-400" /> HR &amp; Payroll
          </h1>
          <p className="mt-1 max-w-3xl text-xs font-semibold leading-relaxed text-slate-400">
            Employee pay profiles, leave and absence records, monthly payroll drafts and printable payslips.
            Access is limited to Managers and people granted the HR &amp; Payroll module{isManager ? " (you are signed in as Manager)" : ""}.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { void loadDirectory(); if (tab === "payroll") void loadPayroll(periodYear, periodMonth); }}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-4 py-2 text-xs font-bold text-slate-300 transition hover:border-amber-500/50 hover:text-white"
        >
          <RefreshCw className={`h-4 w-4 ${loading || payrollLoading ? "animate-spin text-amber-400" : ""}`} /> Refresh
        </button>
      </div>

      {flash && <div className="flex items-center justify-center gap-2 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-center text-sm font-bold text-emerald-200"><BadgeCheck className="h-5 w-5" />{flash}</div>}
      {error && <div className="flex items-start gap-2 rounded-2xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm font-bold text-rose-200"><XCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950/75 p-2">
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => { setTab("employees"); setSearch(""); }} className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black transition ${tab === "employees" ? "bg-amber-600 text-white shadow" : "text-slate-400 hover:bg-slate-900 hover:text-white"}`}><Users className="h-4 w-4" />Employees</button>
          <button type="button" onClick={() => { setTab("leave"); setSearch(""); }} className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black transition ${tab === "leave" ? "bg-amber-600 text-white shadow" : "text-slate-400 hover:bg-slate-900 hover:text-white"}`}><CalendarDays className="h-4 w-4" />Leave &amp; Absence{pendingLeaveCount > 0 && <span className="rounded-full bg-rose-500/20 px-1.5 py-0.5 text-[9px] text-rose-200">{pendingLeaveCount}</span>}</button>
          <button type="button" onClick={() => { setTab("payroll"); setSearch(""); }} className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black transition ${tab === "payroll" ? "bg-amber-600 text-white shadow" : "text-slate-400 hover:bg-slate-900 hover:text-white"}`}><CircleDollarSign className="h-4 w-4" />Payroll &amp; Payslips</button>
        </div>
        {(tab === "employees" || tab === "leave" || tab === "payroll") && (
          <label className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={tab === "payroll" ? "Search payslips…" : tab === "leave" ? "Search leave records…" : "Search employees…"} className={`${INPUT} pl-9 py-2 text-xs`} />
          </label>
        )}
      </div>

      {tab === "employees" && (
        <section className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4"><div className="text-[10px] font-black uppercase tracking-wider text-slate-500">Employee accounts</div><div className="mt-2 text-2xl font-black text-white">{employees.length}</div></div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4"><div className="text-[10px] font-black uppercase tracking-wider text-slate-500">Active with pay profile</div><div className="mt-2 text-2xl font-black text-emerald-300">{activeWithProfile}</div></div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4"><div className="text-[10px] font-black uppercase tracking-wider text-slate-500">Profiles still needed</div><div className="mt-2 text-2xl font-black text-amber-300">{activeWithoutProfile}</div></div>
          </div>
          <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/80">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-5 py-4">
              <div><h2 className="text-sm font-black text-white">Employee cards</h2><p className="mt-1 text-[11px] font-semibold text-slate-500">Login accounts are managed in Settings; staff without a sign-in (Worker, Cleaner, …) are created and kept here. The card holds the job description, personal details, photo, residency papers and pay profile.</p></div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-bold text-slate-500">{filteredEmployees.length} of {employees.length}{noLoginCount > 0 ? ` · ${noLoginCount} without login` : ""}</span>
                <select aria-label="Filter by sign-in" value={loginFilter} onChange={(event) => setLoginFilter(event.target.value as "all" | "login" | "nologin")} className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-[10px] font-bold text-slate-300"><option value="all">All staff</option><option value="login">With login</option><option value="nologin">No login</option></select>
                <button type="button" onClick={() => { setTitlesOpen(true); setError(""); }} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-[10px] font-black text-slate-300 transition hover:border-amber-500/60 hover:text-amber-200"><ListChecks className="h-3.5 w-3.5" />Job titles</button>
                <button type="button" onClick={openCreateEmployee} className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-2 text-[10px] font-black text-white transition hover:bg-amber-500"><Plus className="h-3.5 w-3.5" />Add employee</button>
              </div>
            </div>
            {loading ? <div className="p-10 text-center text-sm font-bold text-slate-500">Loading HR records…</div> : filteredEmployees.length === 0 ? <div className="p-10 text-center text-sm font-bold text-slate-500">No employees match this search.</div> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[880px] text-left text-xs">
                  <thead><tr className="border-b border-slate-800 text-[10px] font-black uppercase tracking-wider text-slate-500"><th className="px-5 py-3">Employee</th><th className="px-3 py-3">Role / Job title</th><th className="px-3 py-3">Nationality</th><th className="px-3 py-3">Hire date</th><th className="px-3 py-3 text-right">Monthly salary</th><th className="px-5 py-3 text-right">Card</th></tr></thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {filteredEmployees.map((employee) => (
                      <tr key={employee.id} className={`text-slate-300 ${employee.active ? "" : "opacity-55"}`}>
                        <td className="px-5 py-3.5"><div className="flex items-center gap-3">{employee.photoFile ? <img src={photoUrl(employee.id, photoStamp)} alt="" className="h-9 w-9 rounded-xl border border-slate-700 object-cover" /> : <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${employee.avatarColor || "bg-slate-700"} text-xs font-black text-white`}>{employee.name.slice(0, 1).toUpperCase()}</span>}<span><span className="block font-black text-white">{employee.name}{!employee.canLogin && <span className="ml-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[9px] uppercase text-amber-300">No login</span>}{!employee.active && <span className="ml-2 rounded-full bg-slate-800 px-2 py-0.5 text-[9px] uppercase text-slate-500">Inactive</span>}</span><span className="mt-0.5 block text-[10px] font-semibold text-slate-500">{[employee.employeeCode, displayEmail(employee)].filter(Boolean).join(" · ") || "—"}</span></span></div></td>
                        <td className="px-3 py-3.5"><span className="block font-bold text-slate-300">{employee.jobTitle || employee.role}</span><span className="mt-0.5 block text-[10px] font-semibold text-slate-500">Role: {employee.role}{employee.jobTitle && employee.jobTitle !== employee.role ? " · custom job description" : " · linked"}</span></td>
                        <td className="px-3 py-3.5 font-semibold text-slate-400">{textOr(employee.nationality)}{employee.department ? <span className="mt-0.5 block text-[10px] font-semibold text-slate-500">{employee.department}</span> : null}</td>
                        <td className="px-3 py-3.5 font-semibold text-slate-400">{dateLabel(employee.hireDate)}</td>
                        <td className="px-3 py-3.5 text-right font-mono font-black text-white">{employee.profileComplete ? money(employee.baseSalaryCents) : <span className="font-sans text-[10px] font-bold text-amber-300">Not set</span>}</td>
                        <td className="px-5 py-3.5 text-right"><div className="inline-flex gap-1.5"><button type="button" onClick={() => openEmployeeCard(employee)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-[10px] font-black text-slate-300 transition hover:border-sky-500/60 hover:text-sky-200"><IdCard className="h-3.5 w-3.5" />Card</button><button type="button" onClick={() => openEmployeeEditor(employee)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-[10px] font-black text-slate-300 transition hover:border-amber-500/60 hover:text-amber-200"><BriefcaseBusiness className="h-3.5 w-3.5" />{employee.profileComplete ? "Edit" : "Set up"}</button></div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="rounded-2xl border border-sky-500/20 bg-sky-500/5 p-4 text-[11px] font-semibold leading-relaxed text-sky-200/80"><ShieldCheck className="mr-1 inline h-4 w-4 align-[-3px] text-sky-300" />Card data and salary figures are stored separately from ordinary user accounts. Only this granted HR workspace returns them.</div>
        </section>
      )}

      {tab === "leave" && (
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
          <form onSubmit={submitLeave} className="h-fit space-y-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
            <div><div className="flex items-center gap-2 text-sm font-black text-white"><CalendarDays className="h-4 w-4 text-amber-400" />Record leave or absence</div><p className="mt-1 text-[11px] leading-relaxed text-slate-500">A new entry is pending until an HR user approves or declines it. Record calendar days; overlapping pending/approved entries are blocked.</p></div>
            <label><span className={SMALL_LABEL}>Employee</span><select required value={leaveForm.userId} onChange={(event) => setLeaveForm((current) => ({ ...current, userId: event.target.value }))} className={INPUT}><option value="">Select employee…</option>{employees.filter((employee) => employee.active).map((employee) => <option key={employee.id} value={employee.id}>{employee.name} · {employee.jobTitle || employee.role}</option>)}</select></label>
            <label><span className={SMALL_LABEL}>Leave type</span><select value={leaveForm.leaveType} onChange={(event) => setLeaveForm((current) => ({ ...current, leaveType: event.target.value as LeaveType }))} className={INPUT}><option value="Annual">Annual leave</option><option value="Sick">Sick leave</option><option value="Unpaid">Unpaid leave / absence</option><option value="Other">Other</option></select></label>
            <div className="grid grid-cols-2 gap-3"><label><span className={SMALL_LABEL}>Start date</span><input required type="date" value={leaveForm.startDate} onChange={(event) => setLeaveForm((current) => ({ ...current, startDate: event.target.value }))} className={INPUT} /></label><label><span className={SMALL_LABEL}>End date</span><input required type="date" min={leaveForm.startDate} value={leaveForm.endDate} onChange={(event) => setLeaveForm((current) => ({ ...current, endDate: event.target.value }))} className={INPUT} /></label></div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-[11px] font-bold text-slate-400">Days in range: <span className="font-mono text-amber-300">{dayCount(leaveForm.startDate, leaveForm.endDate)}</span> calendar day(s)</div>
            <label><span className={SMALL_LABEL}>Notes <span className="normal-case font-semibold text-slate-600">(optional; avoid sensitive medical details)</span></span><textarea maxLength={500} rows={3} value={leaveForm.reason} onChange={(event) => setLeaveForm((current) => ({ ...current, reason: event.target.value }))} placeholder="Brief administrative note" className={`${INPUT} resize-y`} /></label>
            <button disabled={saving || !leaveForm.userId || employees.filter((employee) => employee.active).length === 0} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 text-xs font-black text-white transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"><Plus className="h-4 w-4" />Save leave record</button>
          </form>

          <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/80">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-5 py-4">
              <div><h2 className="text-sm font-black text-white">Leave &amp; absence register</h2><p className="mt-1 text-[11px] font-semibold text-slate-500">Approve or decline pending requests. Review actions are recorded in the audit trail.</p></div>
              <div className="flex flex-wrap items-center gap-2"><select value={leaveEmployeeId} onChange={(event) => setLeaveEmployeeId(event.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-[10px] font-bold text-slate-300"><option value="All employees">All employees</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select><select value={leaveStatus} onChange={(event) => setLeaveStatus(event.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-[10px] font-bold text-slate-300"><option value="All">All statuses</option><option value="Pending">Pending</option><option value="Approved">Approved</option><option value="Declined">Declined</option></select></div>
            </div>
            {loading ? <div className="p-10 text-center text-sm font-bold text-slate-500">Loading leave records…</div> : filteredLeave.length === 0 ? <div className="p-10 text-center text-sm font-bold text-slate-500">No leave records match these filters.</div> : (
              <div className="divide-y divide-slate-800/70">
                {filteredLeave.map((row) => (
                  <article key={row.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                    <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-black text-white">{row.employeeName}</span><StatusPill status={row.status} /><span className="text-[10px] font-bold uppercase tracking-wide text-amber-300">{row.leaveType}</span></div><div className="mt-1 text-[11px] font-semibold text-slate-400">{dateLabel(row.startDate)} – {dateLabel(row.endDate)} <span className="text-slate-600">·</span> {row.days} day(s) <span className="text-slate-600">·</span> {row.employeeRole}</div>{row.reason && <div className="mt-1 break-words text-[11px] text-slate-500">{row.reason}</div>}{row.reviewNote && <div className="mt-1 text-[10px] font-semibold text-slate-500">Review note: {row.reviewNote}</div>}</div>
                    {row.status === "Pending" && <div className="flex shrink-0 gap-2"><button type="button" disabled={saving} onClick={() => void reviewLeave(row, "Approved")} className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[10px] font-black text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50"><Check className="h-3.5 w-3.5" />Approve</button><button type="button" disabled={saving} onClick={() => void reviewLeave(row, "Declined")} className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[10px] font-black text-rose-200 hover:bg-rose-500/20 disabled:opacity-50"><X className="h-3.5 w-3.5" />Decline</button></div>}
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {tab === "payroll" && (
        <section className="space-y-4">
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-[11px] font-semibold leading-relaxed text-amber-100/80"><CircleDollarSign className="mr-1 inline h-4 w-4 align-[-3px] text-amber-300" /><strong className="text-amber-200">Payroll setup note:</strong> payroll uses the saved monthly base salary plus manually entered earnings and deductions. Leave records are for reference and do not automatically change pay. This tool does not calculate statutory taxes, social contributions, overtime rules or legal leave accrual; confirm local policy before posting.</div>
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-4 sm:p-5">
            <div><h2 className="text-sm font-black text-white">Monthly payroll</h2><p className="mt-1 text-[11px] font-semibold text-slate-500">Select a month, review each employee&apos;s payslip, then post to lock the run.</p></div>
            <div className="flex flex-wrap items-center gap-2"><label className="sr-only" htmlFor="hr-payroll-month">Payroll month</label><select id="hr-payroll-month" value={periodMonth} onChange={(event) => setPeriodMonth(Number(event.target.value))} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-bold text-white">{Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{new Date(Date.UTC(2020, i, 1)).toLocaleDateString([], { month: "long", timeZone: "UTC" })}</option>)}</select><select aria-label="Payroll year" value={periodYear} onChange={(event) => setPeriodYear(Number(event.target.value))} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-bold text-white">{Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - 3 + i).map((year) => <option key={year} value={year}>{year}</option>)}</select><button type="button" disabled={saving || payrollLoading || Boolean(payrollRun) || activeWithProfile === 0} onClick={() => void createPayroll()} className="inline-flex items-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 text-xs font-black text-white hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-45"><Plus className="h-4 w-4" />Create draft</button></div>
          </div>

          {activeWithoutProfile > 0 && <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-500/20 bg-sky-500/5 px-4 py-3 text-[11px] font-semibold text-sky-100/80"><span><UserRound className="mr-1 inline h-4 w-4 align-[-3px] text-sky-300" />{activeWithoutProfile} active account(s) have no pay profile and will not be included in a draft.</span><button type="button" onClick={() => setTab("employees")} className="font-black text-sky-200 underline decoration-sky-400/40 underline-offset-2">Set up profiles</button></div>}

          {payrollBoard?.runs && payrollBoard.runs.length > 0 && <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3"><span className="mr-1 text-[10px] font-black uppercase tracking-wider text-slate-500">Recent runs</span>{payrollBoard.runs.slice(0, 6).map((run) => <button key={run.id} type="button" onClick={() => { setPeriodYear(run.periodYear); setPeriodMonth(run.periodMonth); }} className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[10px] font-bold transition ${run.periodYear === periodYear && run.periodMonth === periodMonth ? "border-amber-500/40 bg-amber-500/10 text-amber-200" : "border-slate-800 bg-slate-900 text-slate-400 hover:text-white"}`}>{monthLabel(run.periodYear, run.periodMonth)}<span className={`h-1.5 w-1.5 rounded-full ${run.status === "Posted" ? "bg-emerald-400" : "bg-amber-400"}`} /></button>)}</div>}

          {payrollLoading || !payrollBoard ? <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-10 text-center text-sm font-bold text-slate-500">Loading payroll…</div> : !payrollRun ? (
            <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/50 px-6 py-14 text-center"><CircleDollarSign className="mx-auto h-9 w-9 text-slate-600" /><div className="mt-3 text-sm font-black text-white">No payroll run for {monthLabel(periodYear, periodMonth)}</div><p className="mx-auto mt-1 max-w-lg text-xs font-semibold text-slate-500">Create a draft to snapshot the active employees who already have pay profiles. You can add manual earnings and deductions before posting.</p><button type="button" disabled={saving || activeWithProfile === 0} onClick={() => void createPayroll()} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 text-xs font-black text-white hover:bg-amber-500 disabled:opacity-50"><Plus className="h-4 w-4" />Create {monthLabel(periodYear, periodMonth)} draft</button></div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/80">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-5 py-4">
                <div><div className="flex flex-wrap items-center gap-2"><h3 className="text-base font-black text-white">{monthLabel(periodYear, periodMonth)} payroll</h3><StatusPill status={payrollRun.status} /></div><p className="mt-1 text-[11px] font-semibold text-slate-500">{payrollItems.length} employee payslip(s) · total net {money(payrollRun.netTotalCents)}{payrollRun.postedAt ? ` · posted ${new Date(payrollRun.postedAt).toLocaleDateString()}` : ""}</p></div>
                <div className="flex flex-wrap gap-2">{payrollRun.status === "Draft" && <><button type="button" disabled={saving} onClick={() => void deletePayrollDraft()} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-[10px] font-black text-rose-200 hover:bg-rose-500/10 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" />Delete draft</button><button type="button" disabled={saving || payrollItems.length === 0} onClick={() => void postPayroll()} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-[10px] font-black text-white hover:bg-emerald-500 disabled:opacity-50"><BadgeCheck className="h-3.5 w-3.5" />Post payroll</button></>}</div>
              </div>
              {payrollItems.length === 0 ? <div className="p-10 text-center text-xs font-bold text-slate-500">This payroll run has no employee payslips.</div> : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[780px] text-left text-xs">
                    <thead><tr className="border-b border-slate-800 text-[10px] font-black uppercase tracking-wider text-slate-500"><th className="px-5 py-3">Employee</th><th className="px-3 py-3 text-right">Base salary</th><th className="px-3 py-3 text-right">Earnings</th><th className="px-3 py-3 text-right">Deductions</th><th className="px-3 py-3 text-right">Net pay</th><th className="px-5 py-3 text-right">Payslip</th></tr></thead>
                    <tbody className="divide-y divide-slate-800/70">{visiblePayrollItems.map((item) => { const additions = jsonLines(item.additionsJson); const deductions = jsonLines(item.deductionsJson); return <tr key={item.id} className="text-slate-300"><td className="px-5 py-3.5"><span className="block font-black text-white">{item.employeeName}</span><span className="mt-0.5 block text-[10px] font-semibold text-slate-500">{item.roleSnapshot || "Former employee"}</span></td><td className="px-3 py-3.5 text-right font-mono font-bold">{money(item.baseSalaryCents)}</td><td className="px-3 py-3.5 text-right font-mono font-bold text-emerald-300">{money(additions.reduce((sum, line) => sum + line.amountCents, 0))}<span className="ml-1 font-sans text-[9px] text-slate-600">({additions.length})</span></td><td className="px-3 py-3.5 text-right font-mono font-bold text-rose-300">{money(deductions.reduce((sum, line) => sum + line.amountCents, 0))}<span className="ml-1 font-sans text-[9px] text-slate-600">({deductions.length})</span></td><td className="px-3 py-3.5 text-right font-mono text-sm font-black text-white">{money(item.netPayCents)}</td><td className="px-5 py-3.5 text-right"><div className="inline-flex gap-1.5">{payrollRun.status === "Draft" && <button type="button" disabled={saving} onClick={() => beginAdjustmentEdit(item)} className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-[10px] font-black text-slate-300 hover:border-amber-500/50 hover:text-amber-200">Adjust</button>}<button type="button" onClick={() => openSlip(item)} className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-[10px] font-black text-slate-300 hover:border-sky-500/50 hover:text-white"><FileText className="h-3.5 w-3.5" />View</button></div></td></tr>; })}</tbody>
                  </table>
                </div>
              )}
              {search.trim() && visiblePayrollItems.length === 0 && <div className="p-6 text-center text-xs font-semibold text-slate-500">No payslips match this search.</div>}
              {payrollRun.status === "Draft" && <div className="border-t border-slate-800 bg-slate-950/40 px-5 py-3 text-[10px] font-semibold text-slate-500">Draft values are editable. Posting locks the run and every payslip; corrections require a separate process, not editing a posted record.</div>}
            </div>
          )}
        </section>
      )}

      <input ref={photoInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" aria-hidden="true" tabIndex={-1} onChange={(event) => { void uploadPhotoFile(event.target.files?.[0] ?? null); }} />
      <input ref={docInputRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" aria-hidden="true" tabIndex={-1} onChange={(event) => { void uploadDocumentFile(event.target.files?.[0] ?? null, editingEmployee ?? cardEmployee); }} />

      {editingEmployee && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="hr-profile-title">
          <form onSubmit={saveEmployeeProfile} className="max-h-[92vh] w-full max-w-3xl space-y-4 overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                {editingEmployee.photoFile
                  ? <img src={photoUrl(editingEmployee.id, photoStamp)} alt="" className="h-14 w-14 rounded-2xl border border-slate-700 object-cover" />
                  : <span className={`flex h-14 w-14 items-center justify-center rounded-2xl ${editingEmployee.avatarColor || "bg-slate-700"} text-lg font-black text-white`}>{editingEmployee.name.slice(0, 1).toUpperCase()}</span>}
                <div>
                  <h2 id="hr-profile-title" className="text-lg font-black text-white">Employee card</h2>
                  <p className="mt-0.5 text-xs font-semibold text-slate-400">{editingEmployee.name} · {[displayEmail(editingEmployee), editingEmployee.canLogin ? "" : "no sign-in"].filter(Boolean).join(" · ") || "—"}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <button type="button" disabled={photoBusy} onClick={() => pickPhoto(editingEmployee)} className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-[10px] font-black text-slate-300 hover:border-amber-500/60 hover:text-amber-200 disabled:opacity-50"><Camera className="h-3 w-3" />{photoBusy ? "Uploading…" : editingEmployee.photoFile ? "Change photo" : "Add photo"}</button>
                    {editingEmployee.photoFile && <button type="button" disabled={photoBusy} onClick={() => void removePhoto(editingEmployee)} className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-[10px] font-black text-slate-500 hover:border-rose-500/50 hover:text-rose-300 disabled:opacity-50"><Trash2 className="h-3 w-3" />Remove</button>}
                  </div>
                </div>
              </div>
              <button type="button" aria-label="Close" onClick={() => setEditingEmployee(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-5 w-5" /></button>
            </div>

            <fieldset className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
              <legend className="px-1 text-[10px] font-black uppercase tracking-wider text-amber-300">Job &amp; employment</legend>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2">
                <span className="text-[11px] font-bold text-slate-400">System role: <span className="font-black text-white">{editingEmployee.role}</span></span>
                <span className="flex items-center gap-2">
                  {profileForm.jobTitle === editingEmployee.role
                    ? <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-emerald-300">Linked to role</span>
                    : <span className="rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-sky-300">Custom description</span>}
                  <button type="button" onClick={() => setProfileForm((current) => ({ ...current, jobTitle: editingEmployee.role }))} className="text-[10px] font-black text-amber-300 underline decoration-amber-500/40 underline-offset-2 hover:text-amber-200">Use system role</button>
                </span>
              </div>
              <div>
                <label><span className={SMALL_LABEL}>Job description</span><input maxLength={80} list="hr-job-title-options" value={profileForm.jobTitle} onChange={(event) => setProfileForm((current) => ({ ...current, jobTitle: event.target.value }))} placeholder="Pick a system role, a job title — or type freely" className={INPUT} /></label>
                <datalist id="hr-job-title-options">
                  {jobTitleSuggestions.map((option) => <option key={option.value} value={option.value}>{option.group}</option>)}
                </datalist>
                <p className="mt-1 text-[10px] font-semibold text-slate-500">Suggestions combine the access roles (built-in + custom) and <button type="button" onClick={() => setTitlesOpen(true)} className="font-black text-amber-300 underline decoration-amber-500/40 underline-offset-2">your editable job-titles list</button>. Typing a custom description never changes the employee&apos;s login role.</p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label><span className={SMALL_LABEL}>Employee code</span><input maxLength={30} value={profileForm.employeeCode} onChange={(event) => setProfileForm((current) => ({ ...current, employeeCode: event.target.value }))} placeholder="EMP-001" className={INPUT} /></label>
                <label><span className={SMALL_LABEL}>Department</span><input maxLength={60} list="hr-department-options" value={profileForm.department} onChange={(event) => setProfileForm((current) => ({ ...current, department: event.target.value }))} placeholder="Production" className={INPUT} /></label>
                <label><span className={SMALL_LABEL}>Status</span><select value={profileForm.employmentStatus} onChange={(event) => setProfileForm((current) => ({ ...current, employmentStatus: event.target.value }))} className={INPUT}>{HR_EMPLOYMENT_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
                <label><span className={SMALL_LABEL}>Hire date</span><input type="date" value={profileForm.hireDate} onChange={(event) => setProfileForm((current) => ({ ...current, hireDate: event.target.value }))} className={INPUT} /></label>
              </div>
              <datalist id="hr-department-options">{HR_DEPARTMENTS.map((d) => <option key={d} value={d} />)}</datalist>
              <label><span className={SMALL_LABEL}>Monthly base salary (USD)</span><span className="relative block max-w-xs"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500">$</span><input required type="number" min="0" max="999999.99" step="0.01" value={profileForm.monthlySalary} onChange={(event) => setProfileForm((current) => ({ ...current, monthlySalary: event.target.value }))} placeholder="0.00" className={`${INPUT} pl-7`} /></span></label>
            </fieldset>

            <fieldset className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
              <legend className="px-1 text-[10px] font-black uppercase tracking-wider text-amber-300">Personal details</legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label><span className={SMALL_LABEL}>Nationality</span><input maxLength={60} list="hr-nationality-options" value={profileForm.nationality} onChange={(event) => setProfileForm((current) => ({ ...current, nationality: event.target.value }))} placeholder="Lebanese" className={INPUT} /></label>
                <label><span className={SMALL_LABEL}>Date of birth</span><input type="date" value={profileForm.dateOfBirth} onChange={(event) => setProfileForm((current) => ({ ...current, dateOfBirth: event.target.value }))} className={INPUT} /></label>
                <label><span className={SMALL_LABEL}>Gender</span><select value={profileForm.gender} onChange={(event) => setProfileForm((current) => ({ ...current, gender: event.target.value }))} className={INPUT}><option value="">—</option>{HR_GENDERS.map((g) => <option key={g} value={g}>{g}</option>)}</select></label>
                <label><span className={SMALL_LABEL}>Marital status</span><select value={profileForm.maritalStatus} onChange={(event) => setProfileForm((current) => ({ ...current, maritalStatus: event.target.value }))} className={INPUT}><option value="">—</option>{HR_MARITAL_STATUSES.map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
              </div>
              <datalist id="hr-nationality-options">{COMMON_NATIONALITIES.map((n) => <option key={n} value={n} />)}</datalist>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label><span className={SMALL_LABEL}>Phone</span><input maxLength={30} value={profileForm.phone} onChange={(event) => setProfileForm((current) => ({ ...current, phone: event.target.value }))} placeholder="+961 …" className={INPUT} /></label>
                <label><span className={SMALL_LABEL}>Address</span><input maxLength={200} value={profileForm.address} onChange={(event) => setProfileForm((current) => ({ ...current, address: event.target.value }))} placeholder="Street, city" className={INPUT} /></label>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label><span className={SMALL_LABEL}>Emergency contact</span><input maxLength={80} value={profileForm.emergencyContactName} onChange={(event) => setProfileForm((current) => ({ ...current, emergencyContactName: event.target.value }))} placeholder="Name + relation" className={INPUT} /></label>
                <label><span className={SMALL_LABEL}>Emergency phone</span><input maxLength={30} value={profileForm.emergencyContactPhone} onChange={(event) => setProfileForm((current) => ({ ...current, emergencyContactPhone: event.target.value }))} placeholder="+961 …" className={INPUT} /></label>
              </div>
            </fieldset>

            <fieldset className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
              <legend className="px-1 text-[10px] font-black uppercase tracking-wider text-amber-300">Identity &amp; residency</legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <label><span className={SMALL_LABEL}>ID number</span><input maxLength={60} value={profileForm.idNumber} onChange={(event) => setProfileForm((current) => ({ ...current, idNumber: event.target.value }))} placeholder="National / civil ID" className={INPUT} /></label>
                <label><span className={SMALL_LABEL}>Passport number</span><input maxLength={60} value={profileForm.passportNumber} onChange={(event) => setProfileForm((current) => ({ ...current, passportNumber: event.target.value }))} className={INPUT} /></label>
                <label><span className={SMALL_LABEL}>Visa number</span><input maxLength={60} value={profileForm.visaNumber} onChange={(event) => setProfileForm((current) => ({ ...current, visaNumber: event.target.value }))} className={INPUT} /></label>
                <label><span className={SMALL_LABEL}>Residency number</span><input maxLength={60} value={profileForm.residencyNumber} onChange={(event) => setProfileForm((current) => ({ ...current, residencyNumber: event.target.value }))} placeholder="Iqama / permit" className={INPUT} /></label>
                <label><span className={SMALL_LABEL}>Residency expiry</span><input type="date" value={profileForm.residencyExpiry} onChange={(event) => setProfileForm((current) => ({ ...current, residencyExpiry: event.target.value }))} className={INPUT} /></label>
              </div>
            </fieldset>

            <label className="block"><span className={SMALL_LABEL}>HR notes <span className="font-semibold normal-case text-slate-600">(private — only this HR workspace shows them)</span></span><textarea maxLength={1000} rows={2} value={profileForm.notes} onChange={(event) => setProfileForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Private HR remark…" className={`${INPUT} resize-y`} /></label>

            <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-amber-300"><Paperclip className="h-3.5 w-3.5" />Attached documents</h3>
                <span className="text-[10px] font-bold text-slate-500">{cardDocs.length} file(s) · JPG/PNG/WebP/PDF ≤ 10 MB</span>
              </div>
              {cardDocsLoading ? <p className="text-[11px] font-bold text-slate-500">Loading documents…</p> : cardDocs.length === 0 ? <p className="text-[11px] font-semibold text-slate-600">No documents attached yet — identity copy, passport, visa, residency…</p> : (
                <ul className="divide-y divide-slate-800/70 rounded-xl border border-slate-800 bg-slate-950/60">
                  {cardDocs.map((doc) => (
                    <li key={doc.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                      <span className="rounded-md bg-sky-500/10 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-sky-300">{doc.docType}</span>
                      <span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-bold text-white">{doc.title || doc.originalName || doc.fileName}</span><span className="block text-[10px] font-semibold text-slate-500">{fileSize(doc.size)}{doc.expiryDate ? ` · expires ${dateLabel(doc.expiryDate)}` : ""}</span></span>
                      <a href={`/api/hr/documents?id=${doc.id}&download=1`} className="rounded-lg border border-slate-700 px-2 py-1.5 text-slate-400 hover:border-sky-500/50 hover:text-white" title="Download"><Download className="h-3.5 w-3.5" /></a>
                      <button type="button" disabled={docBusy} onClick={() => void deleteDocument(doc, editingEmployee)} className="rounded-lg border border-slate-700 px-2 py-1.5 text-slate-500 hover:border-rose-500/50 hover:text-rose-300 disabled:opacity-50" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[150px_minmax(0,1fr)_150px_auto]">
                <select aria-label="Document type" value={docForm.docType} onChange={(event) => setDocForm((current) => ({ ...current, docType: event.target.value }))} className="rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs font-bold text-white">{HR_DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
                <input value={docForm.title} onChange={(event) => setDocForm((current) => ({ ...current, title: event.target.value }))} maxLength={80} placeholder="Label (optional)" className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-500" />
                <input aria-label="Expiry date" type="date" value={docForm.expiryDate} onChange={(event) => setDocForm((current) => ({ ...current, expiryDate: event.target.value }))} className="rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-white" />
                <button type="button" disabled={docBusy} onClick={() => docInputRef.current?.click()} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-sky-600 px-3 py-2 text-xs font-black text-white hover:bg-sky-500 disabled:opacity-50"><Upload className="h-3.5 w-3.5" />{docBusy ? "…" : "Attach"}</button>
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-[10px] font-semibold leading-relaxed text-slate-500">Pay profiles are snapshots for new draft runs only. Editing a card does not change an existing payroll draft or posted payslip.</div>
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setEditingEmployee(null)} className="rounded-xl border border-slate-700 px-4 py-2.5 text-xs font-bold text-slate-300 hover:text-white">Cancel</button><button disabled={saving} className="rounded-xl bg-amber-600 px-4 py-2.5 text-xs font-black text-white hover:bg-amber-500 disabled:opacity-50">{saving ? "Saving…" : "Save card"}</button></div>
          </form>
        </div>
      )}

      {cardEmployee && !editingEmployee && (
        <div className="hr-modal fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-slate-950/85 p-3 backdrop-blur-sm sm:p-6" role="dialog" aria-modal="true" aria-labelledby="hr-card-title">
          <div className="hr-modal-panel max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
            <div className="hr-no-print flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-5 py-4">
              <div><h2 id="hr-card-title" className="text-sm font-black text-white">Employee card · {cardEmployee.name}</h2><p className="mt-1 text-[10px] font-semibold text-slate-500">{textOr(cardEmployee.jobTitle, cardEmployee.role)}{cardEmployee.employeeCode ? ` · ${cardEmployee.employeeCode}` : ""}{cardEmployee.canLogin ? "" : " · no sign-in"}</p></div>
              <div className="flex gap-2">
                <button type="button" onClick={() => { setCardEmployee(null); openEmployeeEditor(cardEmployee); }} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-[10px] font-black text-slate-300 hover:border-amber-500/50 hover:text-amber-200"><BriefcaseBusiness className="h-3.5 w-3.5" />Edit card</button>
                <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-2 text-[10px] font-black text-white hover:bg-amber-500"><Printer className="h-3.5 w-3.5" />Print</button>
                <button type="button" aria-label="Close card" onClick={() => setCardEmployee(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-4 w-4" /></button>
              </div>
            </div>
            <div className="hr-no-print flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-950/50 px-5 py-3">
              <span className="flex flex-wrap items-center gap-1.5 text-[10px] font-bold text-slate-500">
                Account:
                {cardEmployee.canLogin
                  ? <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 font-black uppercase text-emerald-300">Sign-in on</span>
                  : <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-black uppercase text-amber-300">No sign-in</span>}
                {cardEmployee.active
                  ? <span className="rounded-full bg-slate-800 px-2 py-0.5 font-black uppercase text-slate-300">Active</span>
                  : <span className="rounded-full bg-rose-500/15 px-2 py-0.5 font-black uppercase text-rose-300">Inactive</span>}
              </span>
              <span className="flex flex-wrap gap-1.5">
                <button type="button" disabled={saving} onClick={() => { if (cardEmployee.active && !window.confirm(`Deactivate ${cardEmployee.name}? They leave the sign-in roster and stop entering new payroll drafts.`)) return; void patchAccount(cardEmployee, "setActive", { active: !cardEmployee.active }); }} className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-[10px] font-black text-slate-300 hover:border-amber-500/50 hover:text-amber-200 disabled:opacity-50">{cardEmployee.active ? <><XCircle className="h-3 w-3" />Deactivate</> : <><Check className="h-3 w-3" />Activate</>}</button>
                {isManager && (cardEmployee.canLogin
                  ? <button type="button" disabled={saving} onClick={() => { if (!window.confirm(`Disable the sign-in of ${cardEmployee.name}? They keep their card, leave and payroll history but can no longer log in.`)) return; void patchAccount(cardEmployee, "disableLogin"); }} className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-[10px] font-black text-slate-300 hover:border-rose-500/50 hover:text-rose-300 disabled:opacity-50"><XCircle className="h-3 w-3" />Disable login</button>
                  : <button type="button" disabled={saving} onClick={() => { setLoginForm({ role: systemRoles.includes(cardEmployee.role) ? cardEmployee.role : "Machine Operator", pin: "" }); setLoginModal(cardEmployee); setError(""); }} className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-[10px] font-black text-slate-300 hover:border-emerald-500/50 hover:text-emerald-200 disabled:opacity-50"><ShieldCheck className="h-3 w-3" />Enable login</button>)}
                {!cardEmployee.canLogin && <button type="button" disabled={saving} onClick={() => void deleteEmployeeRecord(cardEmployee)} className="inline-flex items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/5 px-2.5 py-1.5 text-[10px] font-black text-rose-200 hover:bg-rose-500/10 disabled:opacity-50"><Trash2 className="h-3 w-3" />Delete record</button>}
              </span>
            </div>
            <div className="hr-printable m-5 rounded-xl bg-white p-6 text-slate-900 sm:m-7 sm:p-9">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-300 pb-5">
                <div className="flex items-center gap-4">
                  {cardEmployee.photoFile
                    ? <img src={photoUrl(cardEmployee.id, photoStamp)} alt="" className="h-20 w-20 rounded-2xl border border-slate-300 object-cover" />
                    : <span className="flex h-20 w-20 items-center justify-center rounded-2xl bg-slate-200 text-2xl font-black text-slate-500">{cardEmployee.name.slice(0, 1).toUpperCase()}</span>}
                  <div>
                    <div className="text-xs font-black uppercase tracking-[0.2em] text-amber-700">WoodTek ERP · Employee card</div>
                    <h3 className="mt-1 text-2xl font-black tracking-tight">{cardEmployee.name}</h3>
                    <p className="mt-0.5 text-sm font-semibold text-slate-600">{textOr(cardEmployee.jobTitle, cardEmployee.role)}{cardEmployee.department ? ` · ${cardEmployee.department}` : ""}</p>
                  </div>
                </div>
                <div className="text-right"><div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Status</div><div className="mt-1 text-sm font-black">{textOr(cardEmployee.employmentStatus, cardEmployee.active ? "Active" : "Inactive")}</div>{cardEmployee.employeeCode && <div className="mt-1 font-mono text-[11px] text-slate-500">{cardEmployee.employeeCode}</div>}</div>
              </div>
              <div className="grid grid-cols-1 gap-x-8 gap-y-3 border-b border-slate-200 py-5 sm:grid-cols-2 lg:grid-cols-3">
                {[["System role", cardEmployee.role], ["Job description", textOr(cardEmployee.jobTitle, cardEmployee.role)], ["Department", textOr(cardEmployee.department)], ["Nationality", textOr(cardEmployee.nationality)], ["Date of birth", dateLabel(cardEmployee.dateOfBirth)], ["Gender", textOr(cardEmployee.gender)], ["Marital status", textOr(cardEmployee.maritalStatus)], ["Phone", textOr(cardEmployee.phone)], ["Email", displayEmail(cardEmployee) || "—"], ["Address", textOr(cardEmployee.address)], ["Hire date", dateLabel(cardEmployee.hireDate)], ["Monthly salary", cardEmployee.baseSalaryCents == null ? "—" : money(cardEmployee.baseSalaryCents)]].map(([label, value]) => (
                  <div key={label}><div className="text-[9px] font-black uppercase tracking-wider text-slate-500">{label}</div><div className="mt-0.5 text-sm font-bold">{value}</div></div>
                ))}
              </div>
              <div className="grid grid-cols-1 gap-x-8 gap-y-3 border-b border-slate-200 py-5 sm:grid-cols-2 lg:grid-cols-3">
                <div className="sm:col-span-2 lg:col-span-3 text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">Identity &amp; residency</div>
                {[["ID number", textOr(cardEmployee.idNumber)], ["Passport number", textOr(cardEmployee.passportNumber)], ["Visa number", textOr(cardEmployee.visaNumber)], ["Residency number", textOr(cardEmployee.residencyNumber)], ["Residency expiry", dateLabel(cardEmployee.residencyExpiry)], ["Emergency contact", cardEmployee.emergencyContactName ? `${cardEmployee.emergencyContactName}${cardEmployee.emergencyContactPhone ? ` · ${cardEmployee.emergencyContactPhone}` : ""}` : "—"]].map(([label, value]) => (
                  <div key={label}><div className="text-[9px] font-black uppercase tracking-wider text-slate-500">{label}</div><div className="mt-0.5 text-sm font-bold">{value}</div></div>
                ))}
              </div>
              <div className="py-5">
                <div className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">Attached documents ({cardDocs.length})</div>
                {cardDocsLoading ? <p className="mt-2 text-xs font-semibold text-slate-500">Loading…</p> : cardDocs.length === 0 ? <p className="mt-2 text-xs font-semibold text-slate-500">No documents attached.</p> : (
                  <ul className="mt-2 space-y-1.5">
                    {cardDocs.map((doc) => (
                      <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs">
                        <span><span className="font-black">{doc.docType}</span><span className="text-slate-500"> · {doc.title || doc.originalName || doc.fileName} · {fileSize(doc.size)}{doc.expiryDate ? ` · expires ${dateLabel(doc.expiryDate)}` : ""}</span></span>
                        <a href={`/api/hr/documents?id=${doc.id}&download=1`} className="hr-no-print font-black text-sky-700 underline underline-offset-2">Download</a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {cardEmployee.notes && <div className="rounded-lg bg-slate-100 p-3 text-[11px] leading-relaxed text-slate-600"><span className="font-black uppercase tracking-wider text-slate-500">HR notes · </span>{cardEmployee.notes}</div>}
              <div className="mt-8 grid grid-cols-2 gap-8 text-[10px] text-slate-500"><div className="border-t border-slate-400 pt-2">Employee signature</div><div className="border-t border-slate-400 pt-2">HR signature</div></div>
            </div>
          </div>
        </div>
      )}

      {createOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="hr-create-title">
          <form onSubmit={createEmployee} className="max-h-[92vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div><h2 id="hr-create-title" className="text-lg font-black text-white">Add employee</h2><p className="mt-1 text-xs font-semibold text-slate-400">HR-only record — no sign-in. The full card (photo, papers, documents) can be completed afterwards.</p></div>
              <button type="button" aria-label="Close" onClick={() => setCreateOpen(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-5 w-5" /></button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label><span className={SMALL_LABEL}>Full name *</span><input required maxLength={120} value={createForm.name} onChange={(event) => setCreateForm((current) => ({ ...current, name: event.target.value }))} placeholder="e.g. Ahmad Khalil" className={INPUT} /></label>
              <label><span className={SMALL_LABEL}>E-mail (optional)</span><input type="email" maxLength={120} value={createForm.email} onChange={(event) => setCreateForm((current) => ({ ...current, email: event.target.value }))} placeholder="Leave empty if none" className={INPUT} /></label>
            </div>
            <label><span className={SMALL_LABEL}>Job description</span><input maxLength={80} list="hr-create-job-options" value={createForm.jobTitle} onChange={(event) => setCreateForm((current) => ({ ...current, jobTitle: event.target.value }))} placeholder="Worker, Cleaner, …" className={INPUT} /></label>
            <datalist id="hr-create-job-options">
              {jobTitleSuggestions.map((option) => <option key={option.value} value={option.value}>{option.group}</option>)}
            </datalist>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label><span className={SMALL_LABEL}>Department</span><input maxLength={60} list="hr-department-options" value={createForm.department} onChange={(event) => setCreateForm((current) => ({ ...current, department: event.target.value }))} placeholder="Production" className={INPUT} /></label>
              <label><span className={SMALL_LABEL}>Nationality</span><input maxLength={60} list="hr-nationality-options" value={createForm.nationality} onChange={(event) => setCreateForm((current) => ({ ...current, nationality: event.target.value }))} placeholder="Lebanese" className={INPUT} /></label>
              <label><span className={SMALL_LABEL}>Phone</span><input maxLength={30} value={createForm.phone} onChange={(event) => setCreateForm((current) => ({ ...current, phone: event.target.value }))} placeholder="+961 …" className={INPUT} /></label>
              <label><span className={SMALL_LABEL}>Hire date</span><input type="date" value={createForm.hireDate} onChange={(event) => setCreateForm((current) => ({ ...current, hireDate: event.target.value }))} className={INPUT} /></label>
            </div>
            <label><span className={SMALL_LABEL}>Monthly base salary (USD)</span><span className="relative block max-w-xs"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500">$</span><input type="number" min="0" max="999999.99" step="0.01" value={createForm.monthlySalary} onChange={(event) => setCreateForm((current) => ({ ...current, monthlySalary: event.target.value }))} placeholder="0.00" className={`${INPUT} pl-7`} /></span></label>
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setCreateOpen(false)} className="rounded-xl border border-slate-700 px-4 py-2.5 text-xs font-bold text-slate-300 hover:text-white">Cancel</button><button disabled={saving} className="rounded-xl bg-amber-600 px-4 py-2.5 text-xs font-black text-white hover:bg-amber-500 disabled:opacity-50">{saving ? "Saving…" : "Add employee"}</button></div>
          </form>
        </div>
      )}

      {loginModal && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="hr-login-title">
          <form onSubmit={submitEnableLogin} className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div><h2 id="hr-login-title" className="text-base font-black text-white">Enable sign-in</h2><p className="mt-1 text-xs font-semibold text-slate-400">{loginModal.name} · currently no login</p></div>
              <button type="button" aria-label="Close" onClick={() => setLoginModal(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-5 w-5" /></button>
            </div>
            <label><span className={SMALL_LABEL}>System role *</span><select required value={loginForm.role} onChange={(event) => setLoginForm((current) => ({ ...current, role: event.target.value }))} className={INPUT}>{systemRoles.map((role) => <option key={role} value={role}>{role}</option>)}</select></label>
            <label><span className={SMALL_LABEL}>4-digit PIN *</span><input required inputMode="numeric" maxLength={4} value={loginForm.pin} onChange={(event) => setLoginForm((current) => ({ ...current, pin: event.target.value.replace(/\D/g, "").slice(0, 4) }))} placeholder="0000" className={`${INPUT} font-mono tracking-widest`} /></label>
            <p className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-[10px] font-semibold leading-relaxed text-slate-500">The employee appears on the sign-in screen immediately. The job description on the card stays as-is — only the access role changes.</p>
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setLoginModal(null)} className="rounded-xl border border-slate-700 px-4 py-2.5 text-xs font-bold text-slate-300 hover:text-white">Cancel</button><button disabled={saving} className="rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white hover:bg-emerald-500 disabled:opacity-50">{saving ? "Saving…" : "Enable login"}</button></div>
          </form>
        </div>
      )}

      {titlesOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="hr-titles-heading">
          <div className="w-full max-w-md space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div><h2 id="hr-titles-heading" className="flex items-center gap-2 text-base font-black text-white"><ListChecks className="h-4 w-4 text-amber-400" />Job titles</h2><p className="mt-1 text-[11px] font-semibold leading-relaxed text-slate-500">Editable descriptions for staff whose system role does not describe their job (Worker, Cleaner, …). The picker always offers system roles first, then this list — free text stays allowed.</p></div>
              <button type="button" aria-label="Close" onClick={() => setTitlesOpen(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-5 w-5" /></button>
            </div>
            <div className="flex gap-2">
              <input value={titlesDraft} onChange={(event) => setTitlesDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addJobTitle(); } }} maxLength={60} placeholder="e.g. Cleaner" className={`${INPUT} py-2 text-xs`} />
              <button type="button" disabled={titlesBusy || !titlesDraft.trim()} onClick={addJobTitle} className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-amber-600 px-3.5 py-2 text-xs font-black text-white hover:bg-amber-500 disabled:opacity-50"><Plus className="h-4 w-4" />Add</button>
            </div>
            {jobTitles.length === 0 ? <p className="text-xs font-semibold text-slate-500">The list is empty — add the first job title above.</p> : (
              <ul className="max-h-64 space-y-1.5 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/50 p-2">
                {jobTitles.map((title) => (
                  <li key={title} className="flex items-center justify-between gap-2 rounded-lg bg-slate-900/70 px-3 py-2">
                    <span className="text-xs font-bold text-white">{title}</span>
                    <button type="button" disabled={titlesBusy} onClick={() => void saveJobTitles(jobTitles.filter((t) => t !== title))} className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-500/10 hover:text-rose-300 disabled:opacity-50" title={`Remove ${title}`}><Trash2 className="h-3.5 w-3.5" /></button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end"><button type="button" onClick={() => setTitlesOpen(false)} className="rounded-xl border border-slate-700 px-4 py-2.5 text-xs font-bold text-slate-300 hover:text-white">Done</button></div>
          </div>
        </div>
      )}

      {editingItem && payrollRun && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="hr-adjust-title">
          <form onSubmit={saveAdjustments} className="max-h-[92vh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl sm:p-6">
            <div className="flex items-start justify-between gap-3"><div><h2 id="hr-adjust-title" className="text-lg font-black text-white">Adjust payslip</h2><p className="mt-1 text-xs font-semibold text-slate-400">{editingItem.employeeName} · {monthLabel(periodYear, periodMonth)} · base snapshot {money(editingItem.baseSalaryCents)}</p></div><button type="button" aria-label="Close" onClick={() => setEditingItem(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-5 w-5" /></button></div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {(["earnings", "deductions"] as const).map((kind) => { const lines = kind === "earnings" ? additionDrafts : deductionDrafts; const setLines = kind === "earnings" ? setAdditionDrafts : setDeductionDrafts; return <div key={kind} className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/50 p-4"><div className="flex items-center justify-between gap-2"><h3 className={`text-xs font-black uppercase tracking-wider ${kind === "earnings" ? "text-emerald-300" : "text-rose-300"}`}>{kind === "earnings" ? "Additional earnings" : "Deductions"}</h3><button type="button" onClick={() => setLines((current) => [...current, { label: "", amount: "" }])} className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1.5 text-[9px] font-black text-slate-300 hover:border-amber-500/50"><Plus className="h-3 w-3" />Add line</button></div>{lines.length === 0 && <p className="text-[10px] font-semibold text-slate-600">No {kind} added.</p>}{lines.map((line, index) => <div key={`${kind}-${index}`} className="flex items-end gap-2"><label className="min-w-0 flex-1"><span className={SMALL_LABEL}>Description</span><input required maxLength={80} value={line.label} onChange={(event) => setLines((current) => current.map((row, i) => i === index ? { ...row, label: event.target.value } : row))} placeholder={kind === "earnings" ? "Allowance / bonus" : "Advance / deduction"} className={`${INPUT} py-2 text-xs`} /></label><label className="w-28 shrink-0"><span className={SMALL_LABEL}>Amount ($)</span><input required type="number" min="0.01" max="999999.99" step="0.01" value={line.amount} onChange={(event) => setLines((current) => current.map((row, i) => i === index ? { ...row, amount: event.target.value } : row))} placeholder="0.00" className={`${INPUT} py-2 text-xs`} /></label><button type="button" aria-label={`Remove ${kind} line ${index + 1}`} onClick={() => setLines((current) => current.filter((_, i) => i !== index))} className="mb-0.5 rounded-lg p-2 text-slate-500 hover:bg-rose-500/10 hover:text-rose-300"><Trash2 className="h-4 w-4" /></button></div>)}</div>; })}
            </div>
            <div className={`flex items-center justify-between rounded-xl border px-4 py-3 ${editorNetCents < 0 ? "border-rose-500/30 bg-rose-500/5" : "border-slate-800 bg-slate-950/70"}`}><span className="text-xs font-bold text-slate-400">Preview net pay</span><span className={`font-mono text-lg font-black ${editorNetCents < 0 ? "text-rose-300" : "text-white"}`}>{money(editorNetCents)}</span></div>
            <p className="text-[10px] font-semibold leading-relaxed text-slate-500">Use manual lines for verified additions and deductions. The server recalculates the net amount in integer cents and rejects a negative net pay.</p>
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setEditingItem(null)} className="rounded-xl border border-slate-700 px-4 py-2.5 text-xs font-bold text-slate-300 hover:text-white">Cancel</button><button disabled={saving || editorNetCents < 0} className="rounded-xl bg-amber-600 px-4 py-2.5 text-xs font-black text-white hover:bg-amber-500 disabled:opacity-50">{saving ? "Saving…" : "Save adjustments"}</button></div>
          </form>
        </div>
      )}

      {slipItem && payrollRun && (
        <div className="hr-modal fixed inset-0 z-[110] flex items-center justify-center overflow-y-auto bg-slate-950/85 p-3 backdrop-blur-sm sm:p-6" role="dialog" aria-modal="true" aria-labelledby="hr-slip-title">
          <div className="hr-modal-panel max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
            <div className="hr-no-print flex items-center justify-between gap-3 border-b border-slate-800 px-5 py-4"><div><h2 id="hr-slip-title" className="text-sm font-black text-white">Payslip · {monthLabel(periodYear, periodMonth)}</h2><p className="mt-1 text-[10px] font-semibold text-slate-500">{slipItem.employeeName}</p></div><div className="flex gap-2"><button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-2 text-[10px] font-black text-white hover:bg-amber-500"><Printer className="h-3.5 w-3.5" />Print</button><button type="button" aria-label="Close payslip" onClick={() => setSlipItem(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-4 w-4" /></button></div></div>
            <div className="hr-printable m-5 rounded-xl bg-white p-6 text-slate-900 sm:m-7 sm:p-9">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-300 pb-5"><div><div className="text-xs font-black uppercase tracking-[0.2em] text-amber-700">WoodTek ERP</div><h3 className="mt-2 text-2xl font-black tracking-tight">Employee Payslip</h3><p className="mt-1 text-sm font-semibold text-slate-600">Pay period: {monthLabel(periodYear, periodMonth)}</p></div><div className="text-right"><div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Payroll status</div><div className="mt-1 text-sm font-black">{payrollRun.status === "Posted" ? "POSTED" : "DRAFT — PREVIEW"}</div><div className="mt-2 text-[10px] text-slate-500">Printed {new Date().toLocaleDateString()}</div></div></div>
              <div className="grid grid-cols-1 gap-3 border-b border-slate-200 py-5 sm:grid-cols-2"><div><div className="text-[9px] font-black uppercase tracking-wider text-slate-500">Employee</div><div className="mt-1 text-sm font-black">{slipItem.employeeName}</div></div><div><div className="text-[9px] font-black uppercase tracking-wider text-slate-500">Role</div><div className="mt-1 text-sm font-bold">{slipItem.roleSnapshot || "Former employee"}</div></div><div><div className="text-[9px] font-black uppercase tracking-wider text-slate-500">Period</div><div className="mt-1 text-sm font-bold">{monthLabel(periodYear, periodMonth)}</div></div><div><div className="text-[9px] font-black uppercase tracking-wider text-slate-500">Currency</div><div className="mt-1 text-sm font-bold">USD</div></div></div>
              <div className="space-y-2 py-5"><div className="flex items-center justify-between border-b border-slate-200 pb-2 text-xs font-black uppercase tracking-wider"><span>Pay details</span><span>Amount</span></div><div className="flex justify-between py-1 text-sm"><span>Monthly base salary</span><span className="font-mono font-bold">{money(slipItem.baseSalaryCents)}</span></div>{jsonLines(slipItem.additionsJson).map((line, index) => <div key={`earning-${index}`} className="flex justify-between py-1 text-sm"><span>+ {line.label}</span><span className="font-mono font-bold">{money(line.amountCents)}</span></div>)}{jsonLines(slipItem.deductionsJson).map((line, index) => <div key={`deduction-${index}`} className="flex justify-between py-1 text-sm"><span>− {line.label}</span><span className="font-mono font-bold">−{money(line.amountCents)}</span></div>)}</div>
              <div className="flex items-center justify-between border-t-2 border-slate-900 pt-4"><span className="text-sm font-black uppercase tracking-wider">Net pay</span><span className="font-mono text-2xl font-black">{money(slipItem.netPayCents)}</span></div>
              <div className="mt-8 border-t border-slate-200 pt-4 text-[9px] leading-relaxed text-slate-500">This payslip is a record of the amounts entered in WoodTek HR &amp; Payroll. The system does not calculate statutory taxes or contributions. {payrollRun.status === "Draft" ? "Draft preview — not final until payroll is posted." : "Posted payroll record."}</div>
              <div className="mt-8 grid grid-cols-2 gap-8 text-[10px] text-slate-500"><div className="border-t border-slate-400 pt-2">Employee signature</div><div className="border-t border-slate-400 pt-2">Authorized signature</div></div>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        @media print {
          body * { visibility: hidden !important; }
          .hr-modal, .hr-modal * { visibility: visible !important; }
          .hr-modal { position: fixed !important; inset: 0 !important; display: block !important; overflow: visible !important; padding: 0 !important; background: #fff !important; }
          .hr-modal-panel { width: 100% !important; max-width: none !important; max-height: none !important; overflow: visible !important; border: 0 !important; border-radius: 0 !important; background: #fff !important; box-shadow: none !important; }
          .hr-printable { margin: 0 !important; padding: 12mm !important; border-radius: 0 !important; background: #fff !important; color: #0f172a !important; }
          .hr-no-print { display: none !important; }
        }
      `}</style>
    </div>
  );
}
