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
};

const DICTS: Record<"ar" | "fr", Record<string, string>> = { ar: AR, fr: FR };

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
