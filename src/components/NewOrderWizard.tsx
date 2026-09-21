"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Cpu,
  Package,
  Plus,
  Route,
  Save,
  Sparkles,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { DEFAULT_PROJECT_TYPES, reconcileProjectType } from "@/lib/projectTypes";
import { stockShortfall, type BomKit } from "@/lib/bomKits";
import {
  productionRouteFromTemplate,
  sanitizeProductionRoute,
  type ProductionRouteSource,
  type ProductionRouteStep,
} from "@/lib/productionPlan";

type StepDraft = {
  key: string;
  operationName: string;
  machineCategory: string;
  estimatedMinutes: string;
  auto: boolean;
  machineId: string;
};

type MaterialDraft = {
  key: string;
  name: string;
  nameTouched: boolean;
  itemId: string;
  qty: string;
  routeChoice: string;
  customSteps: StepDraft[];
};

type WizardPage = "details" | "default" | "materials" | "review";

interface NewOrderWizardProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  customers: any[];
  templates: any[];
  machines: any[];
  inventoryItems: any[];
  currentUser?: any;
  cloneSeed?: any;
  onCloneConsumed?: () => void;
}

const PAGE_ORDER: WizardPage[] = ["details", "default", "materials", "review"];
const PAGE_META: Array<{ id: WizardPage; number: number; label: string }> = [
  { id: "details", number: 1, label: "Order" },
  { id: "default", number: 2, label: "Default route" },
  { id: "materials", number: 3, label: "Material jobs" },
  { id: "review", number: 4, label: "Review" },
];

function routePayload(steps: StepDraft[]): ProductionRouteStep[] {
  return sanitizeProductionRoute(
    steps.map((step) => ({
      operationName: step.operationName,
      machineCategory: step.machineCategory,
      estimatedMinutes: Number(step.estimatedMinutes),
      auto: step.auto,
      machineId: step.machineId ? Number(step.machineId) : null,
    })),
  );
}

function templateSteps(template: any): StepDraft[] {
  return productionRouteFromTemplate(template?.defaultStepsJson).map((step, index) => ({
    key: `template-${String(template?.id ?? "route")}-${index + 1}`,
    operationName: step.operationName,
    machineCategory: step.machineCategory,
    estimatedMinutes: String(step.estimatedMinutes),
    auto: true,
    machineId: "",
  }));
}

function routeMinutes(steps: StepDraft[]): number {
  return routePayload(steps).reduce((sum, step) => sum + step.estimatedMinutes, 0);
}

interface RouteEditorProps {
  steps: StepDraft[];
  setSteps: (next: StepDraft[]) => void;
  machines: any[];
  categories: string[];
  makeKey: () => string;
  compact?: boolean;
}

function RouteEditor({ steps, setSteps, machines, categories, makeKey, compact = false }: RouteEditorProps) {
  const blank = (): StepDraft => ({
    key: makeKey(),
    operationName: "",
    machineCategory: categories[0] || "",
    estimatedMinutes: "60",
    auto: true,
    machineId: "",
  });
  const update = (index: number, patch: Partial<StepDraft>) => {
    setSteps(steps.map((step, i) => (i === index ? { ...step, ...patch } : step)));
  };
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[index], next[target]] = [next[target], next[index]];
    setSteps(next);
  };

  return (
    <div className="space-y-2.5">
      {steps.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/50 px-4 py-6 text-center text-xs text-slate-500">
          No machine steps yet.
        </div>
      ) : (
        steps.map((step, index) => (
          <div key={step.key} className={`rounded-xl border border-slate-700/80 bg-slate-950/80 ${compact ? "p-2.5" : "p-3"}`}>
            <div className="grid items-center gap-2 lg:grid-cols-[38px_minmax(170px,1.4fr)_minmax(145px,1fr)_96px_82px_72px]">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/15 text-xs font-black text-amber-300">
                {index + 1}
              </div>
              <div>
                <label className="mb-1 block text-[9px] font-black uppercase tracking-wider text-slate-500">Operation</label>
                <input
                  value={step.operationName}
                  onChange={(event) => update(index, { operationName: event.target.value })}
                  placeholder="e.g. Re-cut pressed panel"
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs font-bold text-white outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-[9px] font-black uppercase tracking-wider text-slate-500">Machine type</label>
                {step.auto ? (
                  <select
                    value={step.machineCategory}
                    onChange={(event) => update(index, { machineCategory: event.target.value })}
                    className="w-full rounded-lg border border-teal-800 bg-slate-900 px-2 py-2 text-xs font-bold text-teal-200 outline-none"
                  >
                    <option value="">Choose type…</option>
                    {categories.map((category) => <option key={category} value={category}>{category}</option>)}
                  </select>
                ) : (
                  <select
                    value={step.machineId}
                    onChange={(event) => {
                      const selected = machines.find((machine: any) => String(machine.id) === event.target.value);
                      update(index, {
                        machineId: event.target.value,
                        machineCategory: selected?.category || step.machineCategory,
                      });
                    }}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 text-xs font-bold text-white outline-none"
                  >
                    <option value="">Assign later…</option>
                    {categories.map((category) => (
                      <optgroup key={category} label={category}>
                        {machines.filter((machine: any) => machine.category === category).map((machine: any) => (
                          <option key={machine.id} value={machine.id}>{machine.code} — {machine.name}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                )}
              </div>
              <div>
                <label className="mb-1 block text-[9px] font-black uppercase tracking-wider text-slate-500">Assign</label>
                <button
                  type="button"
                  onClick={() => update(index, { auto: !step.auto, machineId: "" })}
                  className={`w-full rounded-lg border px-2 py-2 text-[10px] font-black uppercase ${step.auto ? "border-amber-500/50 bg-amber-500/15 text-amber-300" : "border-sky-500/50 bg-sky-500/10 text-sky-300"}`}
                >
                  {step.auto ? "Auto" : "Exact"}
                </button>
              </div>
              <div>
                <label className="mb-1 block text-[9px] font-black uppercase tracking-wider text-slate-500">Minutes</label>
                <input
                  type="number"
                  min={1}
                  max={1440}
                  value={step.estimatedMinutes}
                  onChange={(event) => update(index, { estimatedMinutes: event.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 text-center font-mono text-xs text-white outline-none"
                />
              </div>
              <div className="flex items-end justify-end gap-0.5 pt-4">
                <button type="button" onClick={() => move(index, -1)} disabled={index === 0} title="Move up" className="rounded p-1 text-slate-400 hover:text-amber-300 disabled:opacity-25"><ChevronUp className="h-4 w-4" /></button>
                <button type="button" onClick={() => move(index, 1)} disabled={index === steps.length - 1} title="Move down" className="rounded p-1 text-slate-400 hover:text-amber-300 disabled:opacity-25"><ChevronDown className="h-4 w-4" /></button>
                <button type="button" onClick={() => setSteps(steps.filter((_, i) => i !== index))} title="Remove step" className="rounded p-1 text-slate-500 hover:text-rose-400"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          </div>
        ))
      )}
      <button
        type="button"
        onClick={() => setSteps([...steps, blank()])}
        className="flex items-center gap-1.5 rounded-lg border border-dashed border-amber-500/40 px-3 py-2 text-[11px] font-black text-amber-300 hover:bg-amber-500/10"
      >
        <Plus className="h-3.5 w-3.5" /> Add machine pass
      </button>
    </div>
  );
}

export default function NewOrderWizard({
  open,
  onClose,
  onCreated,
  customers = [],
  templates = [],
  machines = [],
  inventoryItems = [],
  currentUser,
  cloneSeed,
  onCloneConsumed,
}: NewOrderWizardProps) {
  const keyCounter = useRef(0);
  const makeKey = () => `draft-${Date.now()}-${++keyCounter.current}`;

  const defaultDueDate = () => {
    const date = new Date();
    date.setDate(date.getDate() + 7);
    return date.toISOString().split("T")[0];
  };

  const [page, setPage] = useState<WizardPage>("details");
  const [customerId, setCustomerId] = useState("");
  const [title, setTitle] = useState("");
  const [projectType, setProjectType] = useState("Custom Kitchens");
  const [priority, setPriority] = useState("Normal");
  const [totalValue, setTotalValue] = useState("");
  const [dueDate, setDueDate] = useState(defaultDueDate);
  const [notes, setNotes] = useState("");
  const [defaultSteps, setDefaultSteps] = useState<StepDraft[]>([]);
  const [defaultRecipeId, setDefaultRecipeId] = useState("");
  const [newRecipeName, setNewRecipeName] = useState("");
  const [recipeMessage, setRecipeMessage] = useState("");
  const [materials, setMaterials] = useState<MaterialDraft[]>([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [projectTypes, setProjectTypes] = useState<string[]>(DEFAULT_PROJECT_TYPES);
  const [showProjectTypes, setShowProjectTypes] = useState(false);
  const [newProjectType, setNewProjectType] = useState("");
  const [projectTypeMessage, setProjectTypeMessage] = useState("");
  const [managedCategories, setManagedCategories] = useState<string[]>([]);
  const [showCategories, setShowCategories] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [categoryMessage, setCategoryMessage] = useState("");
  const [kits, setKits] = useState<BomKit[]>([]);
  const [kitChoice, setKitChoice] = useState("");
  const [kitMessage, setKitMessage] = useState("");

  const machineCategories = useMemo(
    () => Array.from(new Set(machines.map((machine: any) => String(machine.category || "")).filter(Boolean))).sort(),
    [machines],
  );
  const categories = useMemo(
    () => Array.from(new Set([...managedCategories, ...machineCategories])).sort(),
    [managedCategories, machineCategories],
  );
  const itemById = useMemo(
    () => new Map(inventoryItems.map((item: any) => [Number(item.id), item])),
    [inventoryItems],
  );
  const shortfalls = useMemo(
    () => stockShortfall(materials.map((item) => ({ itemId: item.itemId, qty: item.qty })), itemById),
    [materials, itemById],
  );

  const reset = () => {
    setPage("details");
    setCustomerId(customers[0]?.id ? String(customers[0].id) : "");
    setTitle("");
    setProjectType(projectTypes[0] || "");
    setPriority("Normal");
    setTotalValue("");
    setDueDate(defaultDueDate());
    setNotes("");
    setDefaultSteps([]);
    setDefaultRecipeId("");
    setNewRecipeName("");
    setRecipeMessage("");
    setMaterials([]);
    setError("");
    setKitChoice("");
    setKitMessage("");
  };

  useEffect(() => {
    Promise.all([
      fetch("/api/project-types", { cache: "no-store" }).then((response) => response.ok ? response.json() : { types: [] }),
      fetch("/api/machine-categories", { cache: "no-store" }).then((response) => response.ok ? response.json() : { categories: [] }),
      fetch("/api/bom-kits", { cache: "no-store" }).then((response) => response.ok ? response.json() : { kits: [] }),
    ]).then(([projectData, categoryData, kitData]) => {
      if (Array.isArray(projectData.types)) {
        setProjectTypes(projectData.types);
        setProjectType((current) => reconcileProjectType(projectData.types, current));
      }
      if (Array.isArray(categoryData.categories)) setManagedCategories(categoryData.categories);
      if (Array.isArray(kitData.kits)) setKits(kitData.kits);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!open) return;
    reset();
    if (!cloneSeed) return;

    if (cloneSeed.customerId != null) setCustomerId(String(cloneSeed.customerId));
    setTitle(String(cloneSeed.title || ""));
    if (cloneSeed.projectType) {
      const clonedType = String(cloneSeed.projectType);
      setProjectType(clonedType);
      setProjectTypes((current) => current.includes(clonedType) ? current : [...current, clonedType]);
    }
    setPriority(String(cloneSeed.priority || "Normal"));
    setTotalValue(cloneSeed.totalValue != null ? String(cloneSeed.totalValue) : "");
    setDueDate(/^\d{4}-\d{2}-\d{2}$/.test(String(cloneSeed.dueDate || "")) ? String(cloneSeed.dueDate) : defaultDueDate());
    setNotes(String(cloneSeed.notes || ""));

    const clonedDefault = Array.isArray(cloneSeed.defaultSteps) && cloneSeed.defaultSteps.length > 0
      ? cloneSeed.defaultSteps
      : cloneSeed.steps;
    if (Array.isArray(clonedDefault)) {
      setDefaultSteps(clonedDefault.map((step: any) => ({
        key: makeKey(),
        operationName: String(step.operationName || ""),
        machineCategory: String(step.machineCategory || ""),
        estimatedMinutes: String(step.estimatedMinutes || 60),
        auto: step.auto !== false,
        machineId: step.machineId != null ? String(step.machineId) : "",
      })));
    }

    if (Array.isArray(cloneSeed.productionItems) && cloneSeed.productionItems.length > 0) {
      setMaterials(cloneSeed.productionItems.map((item: any) => ({
        key: makeKey(),
        name: String(item.name || "Material batch"),
        nameTouched: true,
        itemId: String(item.itemId || ""),
        qty: String(item.quantityUsed || item.qty || 1),
        routeChoice: item.routeSource === "default" ? "default" : "custom",
        customSteps: (item.steps || []).map((step: any) => ({
          key: makeKey(),
          operationName: String(step.operationName || ""),
          machineCategory: String(step.machineCategory || ""),
          estimatedMinutes: String(step.estimatedMinutes || 60),
          auto: step.auto !== false,
          machineId: step.machineId != null ? String(step.machineId) : "",
        })),
      })));
    } else if (Array.isArray(cloneSeed.bom)) {
      setMaterials(cloneSeed.bom.map((line: any) => {
        const stock = itemById.get(Number(line.itemId));
        return {
          key: makeKey(),
          name: stock?.name ? `${stock.name} batch` : "Material batch",
          nameTouched: false,
          itemId: String(line.itemId || ""),
          qty: String(line.qty || 1),
          routeChoice: "default",
          customSteps: [],
        };
      }));
    }
    onCloneConsumed?.();
    // Run only when a modal is opened with a new clone seed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open && !customerId && customers[0]?.id) setCustomerId(String(customers[0].id));
  }, [open, customers, customerId]);

  const selectedDefaultRecipe = templates.find((template: any) => String(template.id) === defaultRecipeId);

  const materialRoute = (material: MaterialDraft): { steps: StepDraft[]; source: ProductionRouteSource; recipeId: number | null; recipeName: string } => {
    if (material.routeChoice.startsWith("recipe:")) {
      const id = material.routeChoice.slice("recipe:".length);
      const template = templates.find((entry: any) => String(entry.id) === id);
      return {
        steps: template ? templateSteps(template) : [],
        source: "recipe",
        recipeId: template ? Number(template.id) : null,
        recipeName: template?.name || "",
      };
    }
    if (material.routeChoice === "custom") {
      return { steps: material.customSteps, source: "custom", recipeId: null, recipeName: "Custom route" };
    }
    return {
      steps: defaultSteps,
      source: "default",
      recipeId: selectedDefaultRecipe ? Number(selectedDefaultRecipe.id) : null,
      recipeName: selectedDefaultRecipe?.name || (defaultSteps.length > 0 ? "Order default" : ""),
    };
  };

  const updateMaterial = (key: string, patch: Partial<MaterialDraft>) => {
    setMaterials((current) => current.map((material) => material.key === key ? { ...material, ...patch } : material));
  };

  const addMaterial = (itemId = "", qty = "1") => {
    const stock = itemById.get(Number(itemId));
    setMaterials((current) => [...current, {
      key: makeKey(),
      name: stock?.name ? `${stock.name} batch` : "",
      nameTouched: false,
      itemId,
      qty,
      routeChoice: "default",
      customSteps: [],
    }]);
  };

  const applyKit = (name: string) => {
    const kit = kits.find((entry) => entry.name === name);
    if (!kit) return;
    setMaterials((current) => {
      const next = [...current];
      for (const kitItem of kit.items) {
        const existing = next.find((item) => Number(item.itemId) === kitItem.itemId && item.routeChoice === "default" && !item.nameTouched);
        if (existing) {
          existing.qty = String((Number(existing.qty) || 0) + kitItem.qty);
        } else {
          const stock = itemById.get(kitItem.itemId);
          next.push({
            key: makeKey(),
            name: stock?.name ? `${stock.name} batch` : "Material batch",
            nameTouched: false,
            itemId: String(kitItem.itemId),
            qty: String(kitItem.qty),
            routeChoice: "default",
            customSteps: [],
          });
        }
      }
      return next;
    });
    setKitMessage(`Kit “${kit.name}” added. Every new row uses the order default route until changed.`);
  };

  const saveKit = async () => {
    const rows = materials.filter((material) => material.itemId && Number(material.qty) > 0);
    if (rows.length === 0) { setKitMessage("Add material rows before saving a kit."); return; }
    const name = window.prompt("Name this reusable material kit:", "");
    if (!name?.trim()) return;
    try {
      const response = await fetch("/api/bom-kits", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          items: rows.map((material) => ({ itemId: Number(material.itemId), qty: Math.max(1, Number(material.qty) || 1) })),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save kit.");
      setKits(Array.isArray(data.kits) ? data.kits : []);
      setKitMessage(`Kit “${name.trim()}” saved.`);
    } catch (cause) {
      setKitMessage(cause instanceof Error ? cause.message : "Could not save kit.");
    }
  };

  const saveProjectTypes = async (next: string[]) => {
    setProjectTypeMessage("");
    try {
      const response = await fetch("/api/project-types", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ types: next }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update project categories.");
      const savedTypes = Array.isArray(data.types) ? data.types : next;
      setProjectTypes(savedTypes);
      setProjectType((current) => reconcileProjectType(savedTypes, current));
      setProjectTypeMessage("Project categories updated.");
    } catch (cause) {
      setProjectTypeMessage(cause instanceof Error ? cause.message : "Could not update project categories.");
    }
  };

  const saveMachineCategories = async (next: string[]) => {
    setCategoryMessage("");
    try {
      const response = await fetch("/api/machine-categories", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories: next }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update machine types.");
      setManagedCategories(Array.isArray(data.categories) ? data.categories : next);
      setCategoryMessage("Machine types updated.");
    } catch (cause) {
      setCategoryMessage(cause instanceof Error ? cause.message : "Could not update machine types.");
    }
  };

  const saveDefaultAsRecipe = async () => {
    const name = newRecipeName.trim();
    const steps = routePayload(defaultSteps);
    if (!name || steps.length === 0 || steps.length !== defaultSteps.length) {
      setRecipeMessage("Enter a recipe name and complete every route pass first.");
      return;
    }
    setRecipeMessage("");
    try {
      const response = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: "Saved from the Production Order Builder",
          defaultStepsJson: steps.map((step, index) => ({ ...step, stepOrder: index + 1 })),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not save the routing recipe.");
      setNewRecipeName("");
      setRecipeMessage(`Recipe “${name}” saved.`);
      onCreated();
    } catch (cause) {
      setRecipeMessage(cause instanceof Error ? cause.message : "Could not save the routing recipe.");
    }
  };

  const validatePage = (target: WizardPage): boolean => {
    setError("");
    if (target === "details") {
      if (!customerId || !projectType || !title.trim() || !dueDate) {
        setError("Choose a customer and project category, enter the project title, and set the due date.");
        setPage("details");
        return false;
      }
      return true;
    }
    if (target === "default") {
      if (defaultSteps.length > 0 && routePayload(defaultSteps).length !== defaultSteps.length) {
        setError("Every default-route pass needs an operation name and machine type.");
        setPage("default");
        return false;
      }
      return true;
    }
    if (target === "materials" || target === "review") {
      if (materials.length === 0) {
        setError("An order cannot be issued without materials. Add at least one material job (batch) first.");
        setPage("materials");
        return false;
      }
      for (let index = 0; index < materials.length; index++) {
        const material = materials[index];
        if (!material.name.trim() || !material.itemId || Number(material.qty) <= 0) {
          setError(`Material job ${index + 1} needs a batch name, stock item, and quantity.`);
          setPage("materials");
          return false;
        }
        const resolved = materialRoute(material);
        if (routePayload(resolved.steps).length !== resolved.steps.length || resolved.steps.length === 0) {
          setError(`“${material.name}” needs a complete route. Choose a recipe or finish every custom/default step.`);
          setPage(material.routeChoice === "default" ? "default" : "materials");
          return false;
        }
      }
      return true;
    }
    return true;
  };

  const goNext = () => {
    if (!validatePage(page)) return;
    const index = PAGE_ORDER.indexOf(page);
    setPage(PAGE_ORDER[Math.min(PAGE_ORDER.length - 1, index + 1)]);
  };

  const goBack = () => {
    setError("");
    const index = PAGE_ORDER.indexOf(page);
    setPage(PAGE_ORDER[Math.max(0, index - 1)]);
  };

  const submit = async () => {
    if (!validatePage("details") || !validatePage("default") || !validatePage("review")) return;
    setSubmitting(true);
    setError("");
    try {
      const productionItems = materials.map((material) => {
        const resolved = materialRoute(material);
        return {
          clientKey: material.key,
          name: material.name.trim(),
          itemId: Number(material.itemId),
          quantityUsed: Math.max(1, Number(material.qty) || 1),
          routeSource: resolved.source,
          recipeId: resolved.recipeId,
          recipeName: resolved.recipeName,
          steps: routePayload(resolved.steps),
        };
      });
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: Number(customerId),
          title: title.trim(),
          projectType,
          priority,
          totalValue: totalValue || "0.00",
          dueDate: new Date(`${dueDate}T12:00:00`),
          notes: notes.trim(),
          defaultSteps: routePayload(defaultSteps),
          productionItems,
          customSteps: productionItems.length === 0 ? routePayload(defaultSteps) : [],
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "The production order could not be created.");
      const scheduling = data?.dispatchScheduling;
      const skippedDetails = Array.isArray(scheduling?.skippedDetails) ? scheduling.skippedDetails : [];
      const dueDateWarnings = Array.isArray(scheduling?.dueDateWarnings) ? scheduling.dueDateWarnings : [];
      const stockWarnings = Array.isArray(data?.stockCheck?.warnings) ? data.stockCheck.warnings : [];
      if (skippedDetails.length > 0 || dueDateWarnings.length > 0 || stockWarnings.length > 0) {
        const parts: string[] = [
          `${data.orderNumber || "Order"} was issued and ${Number(scheduling?.planned) || 0}/${Number(scheduling?.attempted) || totalJobs} operation slots were booked automatically.`,
        ];
        if (skippedDetails.length > 0) {
          parts.push(`Still needs attention:\n• ${skippedDetails.slice(0, 5).join("\n• ")}`);
        }
        if (dueDateWarnings.length > 0) {
          parts.push(`Due-date check:\n• ${dueDateWarnings.slice(0, 5).join("\n• ")}`);
        }
        if (stockWarnings.length > 0) {
          parts.push(`Stock check:\n• ${stockWarnings.slice(0, 5).join("\n• ")}`);
        }
        window.alert(parts.join("\n\n"));
      }
      reset();
      onClose();
      onCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The production order could not be created.");
      setPage("review");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  const canManageProjectTypes = currentUser?.role === "Manager";
  const canManageCategories = currentUser?.role === "Manager" || currentUser?.role === "Technician";
  const totalJobs = materials.length > 0
    ? materials.reduce((sum, material) => sum + routePayload(materialRoute(material).steps).length, 0)
    : routePayload(defaultSteps).length;
  const totalMinutes = materials.length > 0
    ? materials.reduce((sum, material) => sum + routeMinutes(materialRoute(material).steps), 0)
    : routeMinutes(defaultSteps);
  const allPlannedSteps = materials.length > 0
    ? materials.flatMap((material) => routePayload(materialRoute(material).steps))
    : routePayload(defaultSteps);
  const assignmentWarnings = Array.from(new Set(allPlannedSteps.flatMap((step) => {
    if (!step.auto && !step.machineId) return [`${step.operationName}: exact machine will be assigned later`];
    if (!step.auto) {
      const machine = machines.find((candidate: any) => String(candidate.id) === String(step.machineId));
      return machine && ["Maintenance", "Offline"].includes(machine.status)
        ? [`${step.operationName}: ${machine.code} is ${machine.status.toLowerCase()}`]
        : [];
    }
    const category = step.machineCategory.toLowerCase();
    const hasMachine = machines.some((machine: any) => {
      const actual = String(machine.category || "").toLowerCase();
      return !["Maintenance", "Offline"].includes(machine.status) && (actual === category || actual.includes(category));
    });
    return hasMachine ? [] : [`${step.operationName}: no active machine exists for ${step.machineCategory}`];
  })));

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-stretch justify-center bg-slate-950/80 p-0 backdrop-blur-md sm:p-4 lg:p-6">
      <div className="flex h-full w-full max-w-7xl flex-col overflow-hidden border border-slate-700/80 bg-slate-900 shadow-2xl shadow-black/70 sm:h-[94vh] sm:rounded-2xl">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-800 bg-slate-950/80 px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-lg font-black text-white sm:text-xl">
              <Sparkles className="h-5 w-5 shrink-0 text-amber-400" />
              <span className="truncate">Production Order Builder</span>
            </h2>
            <p className="mt-0.5 text-[11px] font-semibold text-slate-400">Each named material batch receives its own complete, independent machine job chain.</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white" title="Close">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="shrink-0 border-b border-slate-800 bg-slate-950/45 p-3 lg:border-b-0 lg:border-r lg:p-4">
            <div className="grid grid-cols-4 gap-1 lg:grid-cols-1 lg:gap-2">
              {PAGE_META.map((entry) => {
                const active = page === entry.id;
                const currentIndex = PAGE_ORDER.indexOf(page);
                const done = PAGE_ORDER.indexOf(entry.id) < currentIndex;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => {
                      const targetIndex = PAGE_ORDER.indexOf(entry.id);
                      if (targetIndex <= currentIndex) setPage(entry.id);
                      else if (targetIndex === currentIndex + 1 && validatePage(page)) setPage(entry.id);
                    }}
                    className={`flex min-w-0 items-center gap-2 rounded-xl border px-2 py-2.5 text-left transition lg:px-3 ${active ? "border-amber-400 bg-amber-500 text-slate-950" : done ? "border-emerald-600/40 bg-emerald-500/10 text-emerald-300" : "border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700 hover:text-white"}`}
                  >
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[10px] font-black ${active ? "bg-slate-950/15" : done ? "bg-emerald-500/20" : "bg-slate-800"}`}>{done ? <Check className="h-3.5 w-3.5" /> : entry.number}</span>
                    <span className="truncate text-[10px] font-black uppercase tracking-wide lg:text-xs">{entry.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-4 hidden rounded-xl border border-slate-800 bg-slate-900/60 p-3 lg:block">
              <div className="text-[9px] font-black uppercase tracking-wider text-slate-500">Live plan</div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-center">
                <div className="rounded-lg bg-slate-950 p-2"><div className="text-lg font-black text-white">{materials.length}</div><div className="text-[9px] uppercase text-slate-500">batches</div></div>
                <div className="rounded-lg bg-slate-950 p-2"><div className="text-lg font-black text-amber-300">{totalJobs}</div><div className="text-[9px] uppercase text-slate-500">jobs</div></div>
              </div>
            </div>
          </aside>

          <main className="min-h-0 overflow-y-auto p-4 custom-scrollbar sm:p-6">
            {error && (
              <div className="mb-5 flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs font-bold text-rose-200" role="alert">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" /> {error}
              </div>
            )}

            {page === "details" && (
              <section className="mx-auto max-w-4xl space-y-5">
                <div>
                  <h3 className="flex items-center gap-2 text-xl font-black text-white"><ClipboardList className="h-5 w-5 text-amber-400" /> Order information</h3>
                  <p className="mt-1 text-xs text-slate-400">Identify the project before building its production jobs.</p>
                </div>
                <div className="grid gap-4 rounded-2xl border border-slate-800 bg-slate-950/50 p-5 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-slate-300">Client / Architect *</label>
                    <select value={customerId} onChange={(event) => setCustomerId(event.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white outline-none focus:border-amber-500">
                      <option value="">Choose customer…</option>
                      {customers.map((customer: any) => <option key={customer.id} value={customer.id}>{customer.company} ({customer.name})</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-slate-300">Project category *</label>
                    <select value={projectType} onChange={(event) => setProjectType(event.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white outline-none focus:border-amber-500">
                      {projectTypes.length === 0 && <option value="">No project categories — add one below</option>}
                      {projectTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                    </select>
                    {canManageProjectTypes && (
                      <button type="button" onClick={() => setShowProjectTypes((value) => !value)} className="mt-1.5 flex items-center gap-1 text-[10px] font-black text-teal-300 hover:text-teal-200"><Wrench className="h-3 w-3" /> Manage categories</button>
                    )}
                  </div>
                  <div className="sm:col-span-2">
                    <label className="mb-1.5 block text-xs font-bold text-slate-300">Project title *</label>
                    <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Achrafieh apartment — kitchen and wardrobes" className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm font-bold text-white outline-none placeholder:text-slate-600 focus:border-amber-500" />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-slate-300">Priority</label>
                    <select value={priority} onChange={(event) => setPriority(event.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white"><option>Normal</option><option>High</option><option>Urgent</option></select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-slate-300">Target due date *</label>
                    <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white" />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-slate-300">Quote value ($)</label>
                    <input type="number" min={0} step="0.01" value={totalValue} onChange={(event) => setTotalValue(event.target.value)} placeholder="0.00" className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-xs text-white" />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-slate-300">Client / engineering notes</label>
                    <input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Finishes, drawing revision, delivery constraints…" className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white" />
                  </div>
                </div>
                {showProjectTypes && canManageProjectTypes && (
                  <div className="rounded-2xl border border-teal-800/60 bg-slate-950/70 p-4">
                    <div className="flex flex-wrap gap-2">{projectTypes.map((type) => <span key={type} className="flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] text-white">{type}<button type="button" onClick={() => saveProjectTypes(projectTypes.filter((entry) => entry !== type))} className="text-rose-400"><X className="h-3 w-3" /></button></span>)}</div>
                    <div className="mt-3 flex gap-2"><input value={newProjectType} onChange={(event) => setNewProjectType(event.target.value)} placeholder="New project category" className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white" /><button type="button" onClick={() => { const value = newProjectType.trim(); if (value) { saveProjectTypes([...projectTypes, value]); setNewProjectType(""); } }} className="rounded-lg bg-teal-600 px-4 text-xs font-black text-white">Add</button></div>
                    {projectTypeMessage && <p className="mt-2 text-[11px] font-bold text-amber-300">{projectTypeMessage}</p>}
                  </div>
                )}
              </section>
            )}

            {page === "default" && (
              <section className="mx-auto max-w-5xl space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="flex items-center gap-2 text-xl font-black text-white"><Route className="h-5 w-5 text-amber-400" /> Order default route</h3>
                    <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">This route is copied to every material job marked <strong className="text-slate-200">Use order default</strong>. It is not combined with overrides, so sequences cannot corrupt one another.</p>
                  </div>
                  {canManageCategories && <button type="button" onClick={() => setShowCategories((value) => !value)} className="flex items-center gap-1.5 rounded-lg border border-teal-700/60 px-3 py-2 text-[10px] font-black uppercase text-teal-300"><Wrench className="h-3.5 w-3.5" /> Machine types</button>}
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
                  <div className="mb-3 text-[10px] font-black uppercase tracking-wider text-slate-500">Start from a routing recipe</div>
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {templates.map((template: any) => {
                      const preview = productionRouteFromTemplate(template.defaultStepsJson);
                      const selected = defaultRecipeId === String(template.id);
                      return (
                        <button key={template.id} type="button" onClick={() => { setDefaultRecipeId(String(template.id)); setDefaultSteps(templateSteps(template)); }} className={`rounded-xl border p-3 text-left transition ${selected ? "border-amber-400 bg-amber-500/15" : "border-slate-800 bg-slate-900 hover:border-slate-600"}`}>
                          <div className={`text-xs font-black ${selected ? "text-amber-300" : "text-white"}`}>{template.name}</div>
                          <div className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-slate-500">{preview.map((step, index) => `${index + 1}. ${step.operationName}`).join(" → ")}</div>
                          <div className="mt-2 text-[9px] font-black uppercase tracking-wider text-slate-600">{preview.length} separate pass{preview.length === 1 ? "" : "es"}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {showCategories && canManageCategories && (
                  <div className="rounded-2xl border border-teal-800/60 bg-slate-950/70 p-4">
                    <div className="flex flex-wrap gap-2">{categories.map((category) => <span key={category} className="flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] text-white">{category}{managedCategories.includes(category) && <button type="button" onClick={() => saveMachineCategories(managedCategories.filter((entry) => entry !== category))} className="text-rose-400"><X className="h-3 w-3" /></button>}</span>)}</div>
                    <div className="mt-3 flex gap-2"><input value={newCategory} onChange={(event) => setNewCategory(event.target.value)} placeholder="New machine type" className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white" /><button type="button" onClick={() => { const value = newCategory.trim(); if (value) { saveMachineCategories([...managedCategories, value]); setNewCategory(""); } }} className="rounded-lg bg-teal-600 px-4 text-xs font-black text-white">Add</button></div>
                    {categoryMessage && <p className="mt-2 text-[11px] font-bold text-amber-300">{categoryMessage}</p>}
                  </div>
                )}

                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div><div className="text-sm font-black text-white">Edit the exact pass sequence</div><div className="text-[10px] text-slate-500">Repeated machines are kept as separate passes.</div></div>
                    <div className="rounded-lg bg-slate-950 px-3 py-1.5 text-[10px] font-black text-slate-400">{defaultSteps.length} jobs · {routeMinutes(defaultSteps)} min per default batch</div>
                  </div>
                  <RouteEditor steps={defaultSteps} setSteps={(next) => { setDefaultSteps(next); setDefaultRecipeId(""); }} machines={machines} categories={categories} makeKey={makeKey} />
                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-3">
                    <input value={newRecipeName} onChange={(event) => setNewRecipeName(event.target.value)} placeholder="Save this route as a recipe…" className="min-w-[220px] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white" />
                    <button type="button" onClick={saveDefaultAsRecipe} className="flex items-center gap-1.5 rounded-lg border border-amber-500/40 px-3 py-2 text-[10px] font-black uppercase text-amber-300 hover:bg-amber-500/10"><Save className="h-3.5 w-3.5" /> Save recipe</button>
                    {recipeMessage && <span className="text-[11px] font-bold text-teal-300">{recipeMessage}</span>}
                  </div>
                </div>
              </section>
            )}

            {page === "materials" && (
              <section className="space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="flex items-center gap-2 text-xl font-black text-white"><Package className="h-5 w-5 text-amber-400" /> Material jobs / cut lists</h3>
                    <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">One row = one named production batch, one stock allocation, and one independent station-job chain.</p>
                  </div>
                  <button type="button" onClick={() => addMaterial()} className="flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-black text-slate-950 shadow-lg shadow-amber-950/40 hover:bg-amber-400"><Plus className="h-4 w-4" /> Add material job</button>
                </div>

                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-teal-800/50 bg-slate-950/70 p-3">
                  <span className="text-[10px] font-black uppercase tracking-wider text-teal-400">Material kits</span>
                  <select value={kitChoice} onChange={(event) => { setKitChoice(event.target.value); if (event.target.value) applyKit(event.target.value); }} className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-[11px] font-bold text-white"><option value="">Load a saved kit…</option>{kits.map((kit) => <option key={kit.name} value={kit.name}>{kit.name} ({kit.items.length})</option>)}</select>
                  <button type="button" onClick={saveKit} className="flex items-center gap-1 text-[10px] font-black uppercase text-teal-300"><Save className="h-3.5 w-3.5" /> Save rows as kit</button>
                  {kitMessage && <span className="text-[11px] font-bold text-teal-200">{kitMessage}</span>}
                </div>

                {shortfalls.length > 0 && (
                  <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-[11px] font-bold text-amber-200">
                    <div className="mb-1 font-black">Stock warning — {shortfalls.length} item{shortfalls.length === 1 ? "" : "s"} short:</div>
                    {shortfalls.slice(0, 5).map((entry) => <div key={entry.itemId}>{entry.name}: need {entry.needed}, stock {entry.stock}, short {entry.missing}</div>)}
                  </div>
                )}

                {materials.length === 0 ? (
                  <button type="button" onClick={() => addMaterial()} className="flex w-full flex-col items-center rounded-2xl border-2 border-dashed border-slate-700 bg-slate-950/40 px-6 py-12 text-slate-500 hover:border-amber-500/50 hover:text-amber-300"><Package className="mb-3 h-10 w-10" /><span className="text-sm font-black">Add the first material batch / cut list</span><span className="mt-1 text-xs">Orders without material rows will use one legacy order-level route.</span></button>
                ) : (
                  <div className="space-y-4">
                    {materials.map((material, index) => {
                      const stock = itemById.get(Number(material.itemId));
                      const resolved = materialRoute(material);
                      const resolvedSteps = routePayload(resolved.steps);
                      const shortage = shortfalls.find((entry) => entry.itemId === Number(material.itemId));
                      return (
                        <article key={material.key} className="overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-900 shadow-sm">
                          <div className="flex items-center justify-between gap-3 border-b border-slate-800 bg-slate-950/45 px-4 py-3">
                            <div className="flex min-w-0 items-center gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-xs font-black text-amber-300">{index + 1}</span><div className="min-w-0"><div className="truncate text-sm font-black text-white">{material.name || "Unnamed material job"}</div><div className="text-[10px] font-bold text-slate-500">{resolvedSteps.length} station job{resolvedSteps.length === 1 ? "" : "s"} · {resolvedSteps.reduce((sum, step) => sum + step.estimatedMinutes, 0)} min</div></div></div>
                            <button type="button" onClick={() => setMaterials((current) => current.filter((entry) => entry.key !== material.key))} className="rounded-lg p-2 text-slate-500 hover:bg-rose-500/10 hover:text-rose-400" title="Remove material job"><Trash2 className="h-4 w-4" /></button>
                          </div>
                          <div className="grid gap-3 p-4 lg:grid-cols-[minmax(170px,1fr)_minmax(250px,1.5fr)_100px_minmax(220px,1.2fr)]">
                            <div><label className="mb-1 block text-[9px] font-black uppercase tracking-wider text-slate-500">Batch / cut-list name *</label><input value={material.name} onChange={(event) => updateMaterial(material.key, { name: event.target.value, nameTouched: true })} placeholder="e.g. Kitchen doors" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs font-bold text-white" /></div>
                            <div><label className="mb-1 block text-[9px] font-black uppercase tracking-wider text-slate-500">Inventory material *</label><select value={material.itemId} onChange={(event) => { const selected = itemById.get(Number(event.target.value)); updateMaterial(material.key, { itemId: event.target.value, name: !material.nameTouched && selected?.name ? `${selected.name} batch` : material.name }); }} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-white"><option value="">Choose stock item…</option>{inventoryItems.map((item: any) => <option key={item.id} value={item.id}>{item.name} · {item.sku} · {item.stockQuantity} {item.unit}</option>)}</select></div>
                            <div><label className="mb-1 block text-[9px] font-black uppercase tracking-wider text-slate-500">Quantity *</label><input type="number" min={1} value={material.qty} onChange={(event) => updateMaterial(material.key, { qty: event.target.value })} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-center font-mono text-xs text-white" />{stock && <div className={`mt-1 text-[9px] font-bold ${shortage ? "text-rose-400" : "text-slate-600"}`}>{stock.unit}{shortage ? ` · short ${shortage.missing}` : ""}</div>}</div>
                            <div><label className="mb-1 block text-[9px] font-black uppercase tracking-wider text-slate-500">Route for this batch *</label><select value={material.routeChoice} onChange={(event) => { const value = event.target.value; updateMaterial(material.key, { routeChoice: value, customSteps: value === "custom" && material.customSteps.length === 0 ? resolved.steps.map((step) => ({ ...step, key: makeKey() })) : material.customSteps }); }} className="w-full rounded-lg border border-amber-600/50 bg-slate-950 px-2.5 py-2 text-xs font-black text-amber-200"><option value="default">Use order default ({defaultSteps.length} jobs)</option>{templates.map((template: any) => <option key={template.id} value={`recipe:${template.id}`}>{template.name}</option>)}<option value="custom">Custom route for this batch</option></select></div>
                          </div>
                          <div className="border-t border-slate-800 px-4 py-3">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="mr-1 flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-slate-500"><Route className="h-3 w-3" /> {resolved.recipeName || "Route"}</span>
                              {resolvedSteps.length === 0 ? <span className="text-[11px] font-bold text-rose-300">No valid route</span> : resolvedSteps.map((step, stepIndex) => <React.Fragment key={`${material.key}-${stepIndex}`}><span className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[10px] font-bold text-amber-200">{stepIndex + 1}. {step.operationName}<span className="ml-1 text-slate-600">· {step.machineCategory}</span></span>{stepIndex < resolvedSteps.length - 1 && <ArrowRight className="h-3 w-3 text-slate-600" />}</React.Fragment>)}
                            </div>
                          </div>
                          {material.routeChoice === "custom" && (
                            <div className="border-t border-amber-500/20 bg-slate-950/35 p-4"><div className="mb-2 text-[10px] font-black uppercase tracking-wider text-amber-300">Custom passes for “{material.name || `job ${index + 1}`}”</div><RouteEditor compact steps={material.customSteps} setSteps={(next) => updateMaterial(material.key, { customSteps: next })} machines={machines} categories={categories} makeKey={makeKey} /></div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            )}

            {page === "review" && (
              <section className="mx-auto max-w-5xl space-y-5">
                <div>
                  <h3 className="flex items-center gap-2 text-xl font-black text-white"><CheckCircle2 className="h-5 w-5 text-emerald-400" /> Review production plan</h3>
                  <p className="mt-1 text-xs text-slate-400">Nothing is created until you press the final button below. Issuing the order automatically books every routable operation into its earliest conflict-free machine Dispatch slot.</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><div className="text-[9px] font-black uppercase tracking-wider text-slate-500">Project</div><div className="mt-1 truncate text-sm font-black text-white">{title || "—"}</div></div>
                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><div className="text-[9px] font-black uppercase tracking-wider text-slate-500">Material batches</div><div className="mt-1 text-xl font-black text-white">{materials.length}</div></div>
                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><div className="text-[9px] font-black uppercase tracking-wider text-slate-500">Independent station jobs</div><div className="mt-1 text-xl font-black text-amber-300">{totalJobs}</div></div>
                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><div className="text-[9px] font-black uppercase tracking-wider text-slate-500">Estimated work</div><div className="mt-1 text-xl font-black text-teal-300">{Math.floor(totalMinutes / 60)}h {totalMinutes % 60}m</div></div>
                </div>

                {materials.length === 0 ? (
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-5"><div className="text-sm font-black text-white">Order-level route (no material jobs)</div><div className="mt-3 flex flex-wrap items-center gap-2">{routePayload(defaultSteps).map((step, index) => <React.Fragment key={index}><span className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-[11px] font-bold text-amber-200">{index + 1}. {step.operationName}</span>{index < routePayload(defaultSteps).length - 1 && <ArrowRight className="h-3.5 w-3.5 text-slate-600" />}</React.Fragment>)}</div></div>
                ) : (
                  <div className="space-y-3">
                    {materials.map((material, index) => {
                      const resolved = materialRoute(material);
                      const steps = routePayload(resolved.steps);
                      const stock = itemById.get(Number(material.itemId));
                      return (
                        <div key={material.key} className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-2"><div><div className="text-sm font-black text-white">{index + 1}. {material.name || "Unnamed"}</div><div className="mt-0.5 text-[10px] font-bold text-slate-500">{stock?.sku || "No stock item"} · {material.qty || 0} {stock?.unit || ""} · {resolved.recipeName || "No route"}</div></div><span className="rounded-lg bg-amber-500/10 px-2.5 py-1 text-[10px] font-black uppercase text-amber-300">Separate job chain</span></div>
                          <div className="mt-3 flex flex-wrap items-center gap-1.5">{steps.map((step, stepIndex) => <React.Fragment key={stepIndex}><span className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-[10px] font-bold text-slate-200">{stepIndex + 1}. {step.operationName}<span className="ml-1 text-slate-500">({step.machineCategory}, {step.estimatedMinutes}m)</span></span>{stepIndex < steps.length - 1 && <ArrowRight className="h-3 w-3 text-slate-600" />}</React.Fragment>)}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {assignmentWarnings.length > 0 && (
                  <div className="rounded-xl border border-sky-500/40 bg-sky-500/10 p-3 text-xs font-bold text-sky-200">
                    <div className="mb-1 flex items-center gap-2 font-black"><Cpu className="h-4 w-4" /> Machine assignment warnings</div>
                    {assignmentWarnings.slice(0, 6).map((warning) => <div key={warning}>• {warning}</div>)}
                  </div>
                )}
                {shortfalls.length > 0 && <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs font-bold text-amber-200"><AlertTriangle className="h-4 w-4 shrink-0" /> Stock shortages are warnings only. Warehouse preparation will still track the requested quantities.</div>}
              </section>
            )}
          </main>
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-800 bg-slate-950/80 px-4 py-3 sm:px-6">
          <button type="button" onClick={page === "details" ? onClose : goBack} className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-black text-slate-300 hover:bg-slate-700">
            {page === "details" ? <X className="h-4 w-4" /> : <ArrowLeft className="h-4 w-4" />} {page === "details" ? "Cancel" : "Back"}
          </button>
          <div className="hidden items-center gap-4 text-[10px] font-bold text-slate-500 sm:flex"><span>{materials.length} material batches</span><span>{totalJobs} station jobs</span><span>{totalMinutes} estimated minutes</span></div>
          {page === "review" ? (
            <button
              type="button"
              onClick={submit}
              disabled={submitting || materials.length === 0}
              title={materials.length === 0 ? "Add at least one material job (batch) before issuing" : undefined}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 px-5 py-2.5 text-xs font-black text-slate-950 shadow-lg shadow-emerald-950/40 hover:from-emerald-400 hover:to-emerald-500 disabled:opacity-50"
            >
              <CheckCircle2 className="h-4 w-4" /> {submitting ? "Issuing & booking slots…" : "Issue Order & Auto-book Dispatch"}
            </button>
          ) : (
            <button type="button" onClick={goNext} className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 px-5 py-2.5 text-xs font-black text-slate-950 shadow-lg shadow-amber-950/40 hover:from-amber-400 hover:to-amber-500">
              Continue <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
