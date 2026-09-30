// ============================================================================
// Label language — English / العربية / Français for KEY surfaces only
// (sidebar menu, sign-in screen, top bar). Pure + client-safe: no react,
// no node. The working language stays English everywhere else (data entry,
// forms, reports) by design — this pass covers the chrome people stare at.
//
// Translation is keyed by the EXACT English default string, so names the
// Manager customized in the Menu Designer are never overwritten.
// ============================================================================

export type Lang = "en" | "ar" | "fr";

export const LANG_LABELS: Record<Lang, string> = {
  en: "English",
  ar: "العربية",
  fr: "Français",
};

export const LANG_STORAGE_KEY = "woodtek-lang";

export function loadSavedLang(): Lang {
  try {
    const v = localStorage.getItem(LANG_STORAGE_KEY);
    return v === "ar" || v === "fr" ? v : "en";
  } catch {
    return "en";
  }
}

export function saveLang(lang: Lang): void {
  try {
    localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    /* private mode */
  }
}

const AR: Record<string, string> = {
  // --- sidebar menu defaults ---
  "Executive Dashboard": "لوحة القيادة",
  "Live WIP Board": "لوحة الإنتاج المباشرة",
  "Plant Performance": "أداء المصنع",
  "Orders & Routing": "الطلبات والتوجيه",
  "Routing Recipes": "وصفات التوجيه",
  "Dispatch Schedule": "جدول التوزيع",
  "Gantt Chart": "مخطط جانت",
  "Shop Floor Monitor": "مراقب ورشة الإنتاج",
  "Asset CMMS": "صيانة المعدات",
  "Downtime Log": "سجل التوقفات",
  "Scrap & Rework": "الهالك وإعادة العمل",
  "Workforce & Shifts": "العمالة والورديات",
  "Operator Station Mode": "وضعية محطة المشغل",
  "Clients & Architects": "العملاء والمهندسون",
  "Warehouse & BOM": "المستودع والمواد",
  "Material Reception": "استلام المواد",
  "Wood & Edge Stock": "مخزون الخشب والإكليل",
  "PIMS Import": "استيراد PIMS",
  "System Reports": "تقارير النظام",
  "General Settings": "الإعدادات العامة",
  "Menu Designer": "مصمم القائمة",
  // --- sidebar chrome ---
  "Operations & Control": "العمليات والتحكم",
  "Factory Automation": "أتمتة المصنع",
  "Auto Workflow Engine": "محرك سير العمل التلقائي",
  "Active Role Persona": "الصفحة النشطة",
  "Switch profile (PIN required)": "تبديل الحساب (مطلوب الرمز)",
  "Sign in to continue": "سجّل الدخول للمتابعة",
  "Not signed in": "غير مسجل الدخول",
  "Sign in required": "مطلوب تسجيل الدخول",
  "Furniture Service Center": "مركز خدمة الأثاث",
  // --- header ---
  "Search orders, clients, machines…": "ابحث في الطلبات والعملاء والمعدات…",
  "New Order": "طلب جديد",
  Lock: "قفل",
  Exit: "خروج",
  // --- sign-in screen ---
  "WoodTek ERP Sign In": "تسجيل الدخول إلى وودتك",
  "Authorize Role Switch": "تأكيد تبديل الحساب",
  "Select your profile and enter your personal shop PIN.":
    "اختر حسابك وأدخل الرمز السري الخاص بك.",
  "Choose a demo mode or sign in with your employee PIN.":
    "اختر وضع العرض أو سجّل الدخول برمز الموظف.",
  "Enter your personal four-digit PIN. Accounts lock for 5 minutes after 5 failed attempts.":
    "أدخل رمزك المكوّن من أربعة أرقام. يُقفل الحساب 5 دقائق بعد 5 محاولات فاشلة.",
  "Sign In": "تسجيل الدخول",
  "Cancel": "إلغاء",
  "Select profile": "اختر الحساب",
  "PIN": "الرمز",
  "Auto-lock soon — move the mouse to stay signed in": "قفل تلقائي قريباً — حرّك الفأرة للبقاء مسجلاً",
  // --- domain vocabulary: order / operation states ---
  Pending: "قيد الانتظار",
  "In Production": "قيد الإنتاج",
  "Quality Review": "مراجعة الجودة",
  Completed: "مكتمل",
  Delivered: "تم التسليم",
  "On Hold": "معلّق",
  Cancelled: "ملغى",
  Quoted: "عرض سعر",
  "Deposit Paid": "دفعة مقدمة مدفوعة",
  All: "الكل",
  Urgent: "عاجل",
  High: "مرتفع",
  Normal: "عادي",
  Low: "منخفض",
  "Pending Start": "قيد البدء",
  "Completed & Ready": "مكتمل وجاهز",
  List: "قائمة",
  Kanban: "كانبان",
  // --- dispatch stages & warehouse board ---
  Cleaning: "التنظيف",
  QC: "فحص الجودة",
  Packing: "التغليف",
  "Awaiting delivery": "بانتظار التسليم",
  Requested: "مطلوب",
  Prepare: "تجهيز",
  Prepared: "جاهز",
  Send: "إرسال",
  Undo: "تراجع",
  "Hide delivered": "إخفاء المُسلَّم",
  Refresh: "تحديث",
  "Reception approved": "تم استلام المواد",
  "NOT received": "لم يتم الاستلام",
  "Reception DECLINED": "تم رفض الاستلام",
  // --- shop floor (operator station) ---
  START: "ابدأ",
  FINISH: "إنهاء",
  "START MACHINING": "ابدأ التشغيل",
  "START MATERIAL JOB": "ابدأ تشغيل المادة",
  "FINISH & PASS NEXT": "إنهاء وتمرير للتالي",
  "FINISH MATERIAL PASS": "إنهاء مرور المادة",
  "TAP AGAIN TO CONFIRM": "اضغط مرة أخرى للتأكيد",
  "REJECT / REWORK": "رفض / إعادة عمل",
  "Waiting for a workstation assignment": "بانتظار تعيين محطة عمل",
  "Active Queue for": "قائمة الانتظار لـ",
  "Your station": "محطتك",
  "Start / finish each material below — the machine job opens and closes by itself":
    "ابدأ وأنهِ كل مادة أدناه — مهمة الماكينة تُفتح وتُغلق تلقائياً",
  // --- dashboard & orders chrome ---
  "Morning digest": "ملخّص الصباح",
  "need attention": "بحاجة إلى متابعة",
  "Needs attention": "بحاجة إلى متابعة",
  "All clear — nothing needs attention.": "لا شيء يستدعي المتابعة.",
  "Orders by status — click to open": "الطلبات حسب الحالة — اضغط للفتح",
  "Status:": "الحالة:",
  "Priority: All": "الأولوية: الكل",
  "Priority: Urgent": "الأولوية: عاجل",
  "Priority: High": "الأولوية: مرتفع",
  "Priority: Normal": "الأولوية: عادي",
  Archived: "مؤرشف",
  "No Orders Matching Filter": "لا توجد طلبات مطابقة",
  "Loading orders…": "جارٍ تحميل الطلبات…",
  // --- delivery dispatch queue ---
  "Delivery Dispatch queue — material batches": "قائمة توزيع التسليم — دفعات المواد",
  "Print manifest": "طباعة قائمة التسليم",
  "Mark batch delivered": "تسليم الدفعة",
  "Production pending": "بانتظار الإنتاج",
  "QC checklist first": "قائمة فحص الجودة أولاً",
  Next: "التالي",
};

const FR: Record<string, string> = {
  // --- sidebar menu defaults ---
  "Executive Dashboard": "Tableau de bord",
  "Live WIP Board": "Production en direct",
  "Plant Performance": "Performance usine",
  "Orders & Routing": "Commandes & routage",
  "Routing Recipes": "Recettes de routage",
  "Dispatch Schedule": "Planification livraison",
  "Gantt Chart": "Diagramme de Gantt",
  "Shop Floor Monitor": "Suivi d'atelier",
  "Asset CMMS": "Maintenance (GMAO)",
  "Downtime Log": "Journal des arrêts",
  "Scrap & Rework": "Rebuts & reprises",
  "Workforce & Shifts": "Personnel & équipes",
  "Operator Station Mode": "Mode poste opérateur",
  "Clients & Architects": "Clients & architectes",
  "Warehouse & BOM": "Magasin & nomenclature",
  "Material Reception": "Réception matière",
  "Wood & Edge Stock": "Stock bois & chants",
  "PIMS Import": "Import PIMS",
  "System Reports": "Rapports système",
  "General Settings": "Paramètres généraux",
  "Menu Designer": "Concepteur de menu",
  // --- sidebar chrome ---
  "Operations & Control": "Opérations & contrôle",
  "Factory Automation": "Automatisation usine",
  "Auto Workflow Engine": "Moteur de flux automatique",
  "Active Role Persona": "Profil actif",
  "Switch profile (PIN required)": "Changer de profil (code requis)",
  "Sign in to continue": "Connectez-vous pour continuer",
  "Not signed in": "Non connecté",
  "Sign in required": "Connexion requise",
  "Furniture Service Center": "Centre de service meubles",
  // --- header ---
  "Search orders, clients, machines…": "Rechercher commandes, clients, machines…",
  "New Order": "Nouvelle commande",
  Lock: "Verrouiller",
  Exit: "Quitter",
  // --- sign-in screen ---
  "WoodTek ERP Sign In": "Connexion WoodTek ERP",
  "Authorize Role Switch": "Confirmer le changement de profil",
  "Select your profile and enter your personal shop PIN.":
    "Choisissez votre profil et saisissez votre code personnel.",
  "Choose a demo mode or sign in with your employee PIN.":
    "Choisissez le mode démo ou connectez-vous avec votre code employé.",
  "Enter your personal four-digit PIN. Accounts lock for 5 minutes after 5 failed attempts.":
    "Saisissez votre code à quatre chiffres. Le compte se bloque 5 minutes après 5 tentatives échouées.",
  "Sign In": "Se connecter",
  "Cancel": "Annuler",
  "Select profile": "Choisir le profil",
  "PIN": "Code",
  "Auto-lock soon — move the mouse to stay signed in": "Verrouillage bientôt — bougez la souris pour rester connecté",
  // --- domain vocabulary: order / operation states ---
  Pending: "En attente",
  "In Production": "En production",
  "Quality Review": "Contrôle qualité",
  Completed: "Terminé",
  Delivered: "Livré",
  "On Hold": "En pause",
  Cancelled: "Annulé",
  Quoted: "Devis",
  "Deposit Paid": "Acompte payé",
  All: "Tous",
  // "Urgent" and "Normal" are spelled identically in French — deliberate
  // identity entries (allowed by IDENTICAL_BY_LANGUAGE in render-test.js).
  Urgent: "Urgent",
  High: "Élevée",
  Normal: "Normal",
  Low: "Faible",
  "Pending Start": "À démarrer",
  "Completed & Ready": "Terminé & prêt",
  List: "Liste",
  Kanban: "Vue kanban",
  // --- dispatch stages & warehouse board ---
  Cleaning: "Nettoyage",
  QC: "CQ",
  Packing: "Emballage",
  "Awaiting delivery": "En attente de livraison",
  Requested: "Demandé",
  Prepare: "Préparer",
  Prepared: "Préparé",
  Send: "Envoyer",
  Undo: "Annuler",
  "Hide delivered": "Masquer les livrés",
  Refresh: "Actualiser",
  "Reception approved": "Réception approuvée",
  "NOT received": "NON reçu",
  "Reception DECLINED": "Réception refusée",
  // --- shop floor (operator station) ---
  START: "DÉMARRER",
  FINISH: "TERMINER",
  "START MACHINING": "DÉMARRER L'USINAGE",
  "START MATERIAL JOB": "DÉMARRER LE LOT",
  "FINISH & PASS NEXT": "TERMINER & TRANSMETTRE",
  "FINISH MATERIAL PASS": "TERMINER LE LOT",
  "TAP AGAIN TO CONFIRM": "APPUYEZ ENCORE POUR CONFIRMER",
  "REJECT / REWORK": "REJET / REPRISE",
  "Waiting for a workstation assignment": "En attente d'affectation d'un poste",
  "Active Queue for": "File active pour",
  "Your station": "Votre poste",
  "Start / finish each material below — the machine job opens and closes by itself":
    "Démarrez et terminez chaque matériau ci-dessous — la tâche machine s'ouvre et se ferme automatiquement",
  // --- dashboard & orders chrome ---
  "Morning digest": "Point du matin",
  "need attention": "à traiter",
  "Needs attention": "À traiter",
  "All clear — nothing needs attention.": "Tout est en ordre — rien à signaler.",
  "Orders by status — click to open": "Commandes par statut — cliquez pour ouvrir",
  "Status:": "Statut :",
  "Priority: All": "Priorité : Tous",
  "Priority: Urgent": "Priorité : Urgente",
  "Priority: High": "Priorité : Élevée",
  "Priority: Normal": "Priorité : Normale",
  Archived: "Archivé",
  "No Orders Matching Filter": "Aucune commande correspondante",
  "Loading orders…": "Chargement des commandes…",
  // --- delivery dispatch queue ---
  "Delivery Dispatch queue — material batches": "File de livraison — lots de matériaux",
  "Print manifest": "Imprimer le manifeste",
  "Mark batch delivered": "Marquer le lot livré",
  "Production pending": "Production en attente",
  "QC checklist first": "Checklist CQ d'abord",
  Next: "Suivant",
};

const DICTS: Record<"ar" | "fr", Record<string, string>> = { ar: AR, fr: FR };

// ---------------------------------------------------------------------------
// Client-facing QUOTATION strings (OrderWorkflowDetail's PDF / print sheet).
// Arabic uses a browser print window (jsPDF's built-in fonts cannot shape
// Arabic); English/French use the direct jsPDF download.
// ---------------------------------------------------------------------------
export interface QuoteStrings {
  quotation: string;
  tagline: string;
  billTo: string;
  details: string;
  attn: string;
  date: string;
  due: string;
  category: string;
  reference: string;
  material: string;
  qty: string;
  unit: string;
  unitCost: string;
  amount: string;
  productionSteps: string;
  operation: string;
  station: string;
  estHours: string;
  materials: string;
  productionFull: string;
  totalQuoted: string;
  terms: string;
  generated: string;
}

export const QUOTE_STRINGS: Record<Lang, QuoteStrings> = {
  en: {
    quotation: "QUOTATION",
    tagline: "Custom Woodworking · Production & Fit-out",
    billTo: "BILL TO",
    details: "QUOTE DETAILS",
    attn: "Attn:",
    date: "Date",
    due: "Target due",
    category: "Project category",
    reference: "Reference",
    material: "Material",
    qty: "Qty",
    unit: "Unit",
    unitCost: "Unit Cost",
    amount: "Amount",
    productionSteps: "Production & finishing steps",
    operation: "Operation",
    station: "Station",
    estHours: "Est. hours",
    materials: "Materials",
    productionFull: "Production, finishing & installation",
    totalQuoted: "TOTAL QUOTED",
    terms: "Terms: 50% deposit on acceptance, balance on delivery. Quote valid for 30 days unless stated otherwise.",
    generated: "Generated",
  },
  ar: {
    quotation: "عرض سعر",
    tagline: "نجارة مخصصة · إنتاج وتجهيز",
    billTo: "الفاتورة إلى",
    details: "تفاصيل العرض",
    attn: "لعناية:",
    date: "التاريخ",
    due: "التسليم المستهدف",
    category: "فئة المشروع",
    reference: "المرجع",
    material: "المادة",
    qty: "الكمية",
    unit: "الوحدة",
    unitCost: "سعر الوحدة",
    amount: "المبلغ",
    productionSteps: "خطوات الإنتاج والتشطيب",
    operation: "العملية",
    station: "المحطة",
    estHours: "ساعات متوقعة",
    materials: "المواد",
    productionFull: "الإنتاج والتشطيب والتركيب",
    totalQuoted: "إجمالي عرض السعر",
    terms: "الشروط: 50% دفعة مقدمة عند القبول، والرصيد عند التسليم. العرض ساري لمدة 30 يوماً ما لم يُذكر خلاف ذلك.",
    generated: "أُنشئ في",
  },
  fr: {
    quotation: "DEVIS",
    tagline: "Menuiserie sur mesure · Production & aménagement",
    billTo: "FACTURER À",
    details: "DÉTAILS DU DEVIS",
    attn: "À l'attention de :",
    date: "Date",
    due: "Livraison prévue",
    category: "Catégorie du projet",
    reference: "Référence",
    material: "Matériau",
    qty: "Qté",
    unit: "Unité",
    unitCost: "Coût unitaire",
    amount: "Montant",
    productionSteps: "Étapes de production & finition",
    operation: "Opération",
    station: "Poste",
    estHours: "Heures est.",
    materials: "Matériaux",
    productionFull: "Production, finition & installation",
    totalQuoted: "TOTAL DU DEVIS",
    terms: "Conditions : 50 % d'acompte à l'acceptation, solde à la livraison. Devis valable 30 jours sauf indication contraire.",
    generated: "Généré le",
  },
};

/**
 * Translate an EXACT English default label. Unknown strings (custom menu
 * names, anything not in the dictionary) come back untouched.
 */
export function tt(lang: Lang, english: string): string {
  if (lang === "en") return english;
  return DICTS[lang]?.[english] ?? english;
}

/** The set of English defaults that carry a translation for `lang`. */
export function translatedKeys(lang: "ar" | "fr"): string[] {
  return Object.keys(DICTS[lang]);
}
