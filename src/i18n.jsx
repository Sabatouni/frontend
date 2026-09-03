import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "./context/AuthContext";

// Lightweight translation layer -- deliberately NOT a full i18n framework
// (no ICU plural rules, no lazy-loaded locale bundles, no route-based
// locale switching). This app has two fixed languages and a few hundred
// short interface strings; a plain lookup table plus one interpolation
// helper covers that completely without adding a dependency.
//
// IMPORTANT: this dictionary is for INTERFACE text only -- labels, buttons,
// messages the app itself generates. It must never be used to translate
// user-entered business data (a worker's sale note, an expense item
// description, a customer's name, a service name someone typed in). Those
// stay exactly as entered, in whichever language the person used.
export const translations = {
  en: {
    // Loading / access
    loadingBrand: "Loading Swahili Tent Village…",
    noAccessTitle: "No access to the POS",
    noAccessBody: "{{email}} is signed in, but doesn't have a role in Swahili Tent Village POS yet.",
    noAccessHint: "Ask an Owner to grant you access, then sign in again.",
    signOut: "Sign out",

    // Sidebar / nav
    navDashboard: "Dashboard",
    navHome: "Home",
    navSales: "Sales",
    navRecordSale: "Record Sale",
    navExpenses: "Expenses",
    navReports: "Reports",
    navUsers: "Users",
    ownerDashboardLabel: "OWNER DASHBOARD",
    workerPanelLabel: "WORKER PANEL",
    roleOwner: "Owner",
    roleWorker: "Worker",
    language: "Language",
    toggleSidebar: "Toggle sidebar",
    serviceAddedToast: '"{{name}}" added ✓',
    mainNavigation: "Main navigation",

    // Dashboard (owner)
    overview: "Overview",
    monthPerformance: "This month's performance",
    todaysSales: "Today's Sales",
    todayExpensesSub: "Today expenses: {{amount}}",
    monthlyRevenue: "Monthly Revenue",
    monthlyExpenses: "Monthly Expenses",
    netProfit: "Net Profit",
    salesVsExpenses7d: "Sales vs Expenses — Last 7 Days",
    revenueByService: "Revenue by Service",
    revenueByServiceBar: "Revenue by Service (Bar)",
    recentTransactions: "Recent Transactions",
    noDataThisMonth: "No data this month",
    noSalesYet: "No sales yet",
    noData: "No data",
    colDate: "Date",
    colService: "Service",
    colAmount: "Amount",
    colNote: "Note",

    // Worker home
    goodDay: "Good day, {{name}} 👋",
    whatToRecordToday: "What would you like to record today?",
    transactionsRecorded: "{{count}} transaction{{plural}} recorded",
    recordSale: "Record Sale",
    recordExpense: "Record Expense",
    recordSaleCardSub: "Restaurant, Go Kart, Paintball…",
    recordExpenseCardSub: "Supplies, purchases, costs…",

    // Sales page
    salesTitle: "Sales",
    recordASale: "Record a Sale",
    serviceLabel: "Service",
    addNewService: "＋ Add New Service",
    amountTzs: "Amount (TZS)",
    dateLabel: "Date",
    notesOptional: "Notes (optional)",
    notesPlaceholderSale: "e.g. Group of 5",
    saving: "Saving…",
    recordSaleBtn: "✓ Record Sale",
    filterByService: "Filter by service",
    fromDate: "From date",
    toDate: "To date",
    reset: "Reset",
    confirmDeleteSale: "Delete this sale?",
    saleDeleted: "Sale deleted",
    saleRecorded: "Sale recorded ✓",
    notAuthenticated: "Not authenticated",
    enterValidAmount: "Enter a valid amount",
    selectService: "Select a service",
    delete: "Delete",
    printReceipt: "🧾 Print Receipt",
    amountPlaceholder: "e.g. 15000",

    // Expenses page
    expensesTitle: "Expenses",
    recordAnExpense: "Record an Expense",
    categoryLabel: "Category",
    itemDescription: "Item / Description",
    itemPlaceholder: "e.g. Potato sack, Fuel…",
    costTzs: "Cost (TZS)",
    recordExpenseBtn: "✓ Record Expense",
    total: "Total",
    confirmDeleteExpense: "Delete this expense?",
    expenseDeleted: "Expense deleted",
    expenseRecorded: "Expense recorded ✓",
    enterItemDescription: "Enter an item description",
    enterValidCost: "Enter a valid cost",
    colCategory: "Category",
    colItem: "Item",
    colCost: "Cost",
    noExpensesYet: "No expenses yet",
    costPlaceholder: "e.g. 20000",

    // Expense categories (fixed picklist -- display only; the value saved
    // to the database stays the canonical English string, see App.jsx)
    catRestaurant: "Restaurant",
    catGoKart: "Go Kart",
    catPaintball: "Paintball",
    catParkEntry: "Park Entry",
    catUtilities: "Utilities",
    catStaff: "Staff",
    catMaintenance: "Maintenance",
    catOther: "Other",

    // Reports page
    reportsTitle: "Reports",
    exportCsv: "↓ CSV",
    exportExcel: "↓ Excel",
    exportTaxExcel: "📊 Export Tax / Excel Report",
    totalRevenue: "Total Revenue",
    totalExpensesStat: "Total Expenses",
    revenueVsExpensesTime: "Revenue vs Expenses Over Time",
    noTaxDataToast: "No transactions found for the selected period.",
    taxExportedToast: "Tax report exported ✓",
    noDataToExport: "No data to export",
    csvExportedToast: "CSV exported ✓",
    excelExportedToast: "Excel exported ✓",
    filterByServiceReports: "Filter by service",
    allServices: "All",
    resetFilters: "Reset filters",
    exportTaxAria: "Export Tax / Excel Report for accounting",

    // Users page
    usersTitle: "Users",
    addUser: "＋ Add User",
    cancel: "Cancel",
    newUser: "New User",
    emailLabel: "Email",
    displayNameLabel: "Display Name",
    passwordLabel: "Password",
    roleLabel: "Role",
    roleAdmin: "Admin",
    createUserBtn: "✓ Create User",
    creating: "Creating…",
    noAccessOption: "No access",
    active: "Active",
    disabled: "Disabled",
    disable: "Disable",
    enable: "Enable",
    confirmRevokeAccess: "Remove this person's access to the POS entirely?",
    accessRevoked: "Access revoked",
    roleUpdated: "Role updated ✓",
    userCreated: "User created ✓",
    noUsersFound: "No users found",
    couldNotLoadUsers: "Could not load users — {{error}}",
    emailAndPasswordRequired: "Email and password required",
    colStatus: "Status",
    colCreated: "Created",
    colActions: "Actions",
    colName: "Name",
    colEmail: "Email",
    colRole: "Role",
    userEnabledToast: "User enabled",
    userDisabledToast: "User disabled",
    emailPlaceholder: "user@example.com",
    namePlaceholder: "e.g. John",
    passwordHint: "min 6 characters",

    // Add Service modal
    addServiceTitle: "Add New Service",
    serviceNameLabel: "Service Name",
    serviceNamePlaceholder: "e.g. Swimming Pool",
    serviceNameRequired: "Service name is required.",
    serviceNameExists: "A service with this name already exists.",
    iconLabel: "Icon",
    colorLabel: "Color",
    preview: "Preview",
    addServiceBtn: "Add Service",
    iconAriaLabel: "Icon: {{emoji}}",
    colorSwatchAriaLabel: "Color swatch {{color}}",

    // Receipt
    receiptHeading: "RECEIPT",
    receiptNo: "Receipt No.",
    receiptTime: "Time",
    receiptCustomer: "Customer",
    receiptName: "Name",
    receiptContact: "Contact",
    receiptServiceProvided: "Service Provided",
    receiptPaymentMethod: "Payment Method",
    receiptServedBy: "Served by",
    receiptThankYou: "Thank you for visiting Swahili Tent Village!",
    receiptClose: "Close",
    receiptSkip: "Skip",
    receiptAddCustomerOptional: "Add customer details (optional)",
    customerNamePlaceholder: "e.g. John Smith",
    customerContactPlaceholder: "e.g. +255 7XX XXX XXX",
    selectPaymentMethodOptional: "Payment method (optional)",
    paymentCash: "Cash",
    paymentMobileMoney: "Mobile Money",
    paymentCard: "Card",
    paymentNone: "Not specified",
    saleSavedPrompt: "Sale saved ✓",
    printReceiptQuestion: "Print a receipt for this customer?",
  },

  sw: {
    loadingBrand: "Inapakia Swahili Tent Village…",
    noAccessTitle: "Huna ruhusa ya kuingia kwenye POS",
    noAccessBody: "{{email}} umeingia, lakini huna wadhifa katika Swahili Tent Village POS bado.",
    noAccessHint: "Muombe Mmiliki akupe ruhusa, kisha ingia tena.",
    signOut: "Toka",

    navDashboard: "Dashibodi",
    navHome: "Mwanzo",
    navSales: "Mauzo",
    navRecordSale: "Rekodi Mauzo",
    navExpenses: "Gharama",
    navReports: "Ripoti",
    navUsers: "Watumiaji",
    ownerDashboardLabel: "DASHIBODI YA MMILIKI",
    workerPanelLabel: "PANELI YA MFANYAKAZI",
    roleOwner: "Mmiliki",
    roleWorker: "Mfanyakazi",
    language: "Lugha",
    toggleSidebar: "Fungua/funga menyu",
    serviceAddedToast: '"{{name}}" imeongezwa ✓',
    mainNavigation: "Menyu kuu",

    overview: "Muhtasari",
    monthPerformance: "Utendaji wa mwezi huu",
    todaysSales: "Mauzo ya Leo",
    todayExpensesSub: "Gharama za leo: {{amount}}",
    monthlyRevenue: "Mapato ya Mwezi",
    monthlyExpenses: "Gharama za Mwezi",
    netProfit: "Faida Halisi",
    salesVsExpenses7d: "Mauzo dhidi ya Gharama — Siku 7 Zilizopita",
    revenueByService: "Mapato kwa Huduma",
    revenueByServiceBar: "Mapato kwa Huduma (Chati)",
    recentTransactions: "Miamala ya Hivi Karibuni",
    noDataThisMonth: "Hakuna data mwezi huu",
    noSalesYet: "Bado hakuna mauzo",
    noData: "Hakuna data",
    colDate: "Tarehe",
    colService: "Huduma",
    colAmount: "Kiasi",
    colNote: "Maelezo",

    goodDay: "Siku njema, {{name}} 👋",
    whatToRecordToday: "Ungependa kurekodi nini leo?",
    transactionsRecorded: "Miamala {{count}} imerekodiwa",
    recordSale: "Rekodi Mauzo",
    recordExpense: "Rekodi Gharama",
    recordSaleCardSub: "Restaurant, Go Kart, Paintball…",
    recordExpenseCardSub: "Vifaa, manunuzi, gharama…",

    salesTitle: "Mauzo",
    recordASale: "Rekodi Mauzo",
    serviceLabel: "Huduma",
    addNewService: "＋ Ongeza Huduma Mpya",
    amountTzs: "Kiasi (TZS)",
    dateLabel: "Tarehe",
    notesOptional: "Maelezo (hiari)",
    notesPlaceholderSale: "mfano: Kikundi cha watu 5",
    saving: "Inahifadhi…",
    recordSaleBtn: "✓ Rekodi Mauzo",
    filterByService: "Chuja kwa huduma",
    fromDate: "Kuanzia tarehe",
    toDate: "Hadi tarehe",
    reset: "Weka upya",
    confirmDeleteSale: "Ungependa kufuta mauzo haya?",
    saleDeleted: "Mauzo yamefutwa",
    saleRecorded: "Mauzo yamerekodiwa ✓",
    notAuthenticated: "Haujaingia kwenye mfumo",
    enterValidAmount: "Weka kiasi sahihi",
    selectService: "Chagua huduma",
    delete: "Futa",
    printReceipt: "🧾 Chapisha Risiti",
    amountPlaceholder: "mfano: 15000",

    expensesTitle: "Gharama",
    recordAnExpense: "Rekodi Gharama",
    categoryLabel: "Aina",
    itemDescription: "Kitu / Maelezo",
    itemPlaceholder: "mfano: Gunia la viazi, Mafuta…",
    costTzs: "Gharama (TZS)",
    recordExpenseBtn: "✓ Rekodi Gharama",
    total: "Jumla",
    confirmDeleteExpense: "Ungependa kufuta gharama hii?",
    expenseDeleted: "Gharama imefutwa",
    expenseRecorded: "Gharama imerekodiwa ✓",
    enterItemDescription: "Weka maelezo ya kitu",
    enterValidCost: "Weka gharama sahihi",
    colCategory: "Aina",
    colItem: "Kitu",
    colCost: "Gharama",
    noExpensesYet: "Bado hakuna gharama",
    costPlaceholder: "mfano: 20000",

    catRestaurant: "Restaurant",
    catGoKart: "Go Kart",
    catPaintball: "Paintball",
    catParkEntry: "Park Entry",
    catUtilities: "Huduma za Jamii",
    catStaff: "Wafanyakazi",
    catMaintenance: "Matengenezo",
    catOther: "Nyingine",

    reportsTitle: "Ripoti",
    exportCsv: "↓ CSV",
    exportExcel: "↓ Excel",
    exportTaxExcel: "📊 Hamisha Ripoti ya Kodi (Excel)",
    totalRevenue: "Mapato Yote",
    totalExpensesStat: "Gharama Zote",
    revenueVsExpensesTime: "Mapato dhidi ya Gharama kwa Muda",
    noTaxDataToast: "Hakuna miamala kwa kipindi ulichochagua.",
    taxExportedToast: "Ripoti ya kodi imehamishwa ✓",
    noDataToExport: "Hakuna data ya kuhamisha",
    csvExportedToast: "CSV imehamishwa ✓",
    excelExportedToast: "Excel imehamishwa ✓",
    filterByServiceReports: "Chuja kwa huduma",
    allServices: "Zote",
    resetFilters: "Weka upya vichujio",
    exportTaxAria: "Hamisha Ripoti ya Kodi / Excel kwa uhasibu",

    usersTitle: "Watumiaji",
    addUser: "＋ Ongeza Mtumiaji",
    cancel: "Ghairi",
    newUser: "Mtumiaji Mpya",
    emailLabel: "Barua pepe",
    displayNameLabel: "Jina la Kuonyesha",
    passwordLabel: "Nenosiri",
    roleLabel: "Wadhifa",
    roleAdmin: "Msimamizi",
    createUserBtn: "✓ Unda Mtumiaji",
    creating: "Inaunda…",
    noAccessOption: "Hakuna ruhusa",
    active: "Hai",
    disabled: "Amezimwa",
    disable: "Zima",
    enable: "Washa",
    confirmRevokeAccess: "Ungependa kuondoa kabisa ruhusa ya mtu huyu kwenye mfumo?",
    accessRevoked: "Ruhusa imeondolewa",
    roleUpdated: "Wadhifa umesasishwa ✓",
    userCreated: "Mtumiaji ameundwa ✓",
    noUsersFound: "Hakuna watumiaji waliopatikana",
    couldNotLoadUsers: "Imeshindikana kupakia watumiaji — {{error}}",
    emailAndPasswordRequired: "Barua pepe na nenosiri vinahitajika",
    colStatus: "Hali",
    colCreated: "Imeundwa",
    colActions: "Vitendo",
    colName: "Jina",
    colEmail: "Barua pepe",
    colRole: "Wadhifa",
    userEnabledToast: "Mtumiaji amewashwa",
    userDisabledToast: "Mtumiaji amezimwa",
    emailPlaceholder: "mtumiaji@mfano.com",
    namePlaceholder: "mfano: John",
    passwordHint: "angalau herufi 6",

    addServiceTitle: "Ongeza Huduma Mpya",
    serviceNameLabel: "Jina la Huduma",
    serviceNamePlaceholder: "mfano: Bwawa la Kuogelea",
    serviceNameRequired: "Jina la huduma linahitajika.",
    serviceNameExists: "Huduma yenye jina hili tayari ipo.",
    iconLabel: "Alama",
    colorLabel: "Rangi",
    preview: "Muonekano",
    addServiceBtn: "Ongeza Huduma",
    iconAriaLabel: "Alama: {{emoji}}",
    colorSwatchAriaLabel: "Rangi {{color}}",

    receiptHeading: "RISITI",
    receiptNo: "Namba ya Risiti",
    receiptTime: "Muda",
    receiptCustomer: "Mteja",
    receiptName: "Jina",
    receiptContact: "Mawasiliano",
    receiptServiceProvided: "Huduma Iliyotolewa",
    receiptPaymentMethod: "Njia ya Malipo",
    receiptServedBy: "Amehudumiwa na",
    receiptThankYou: "Asante kwa kututembelea Swahili Tent Village!",
    receiptClose: "Funga",
    receiptSkip: "Ruka",
    receiptAddCustomerOptional: "Ongeza taarifa za mteja (hiari)",
    customerNamePlaceholder: "mfano: John Smith",
    customerContactPlaceholder: "mfano: +255 7XX XXX XXX",
    selectPaymentMethodOptional: "Njia ya malipo (hiari)",
    paymentCash: "Taslimu",
    paymentMobileMoney: "Pesa za Simu",
    paymentCard: "Kadi",
    paymentNone: "Haijaainishwa",
    saleSavedPrompt: "Mauzo yamehifadhiwa ✓",
    printReceiptQuestion: "Chapisha risiti kwa mteja huyu?",
  },
};

const ROLE_DEFAULT_LANG = { owner: "en", admin: "en", worker: "sw" };
const FALLBACK_LANG = "en";

// Namespaced, per-user (never per-device) so a shared device never leaks one
// person's language choice into the next person's session -- the same
// pattern used for the auth access hint in AuthContext.jsx. Holds nothing
// but a two-letter language code; no password/token/sensitive data.
function langStorageKey(userId) {
  return `stv-pos-lang:${userId}`;
}

function readStoredLang(userId) {
  if (!userId) return null;
  try {
    const v = localStorage.getItem(langStorageKey(userId));
    return v === "en" || v === "sw" ? v : null;
  } catch {
    return null;
  }
}

function writeStoredLang(userId, lang) {
  if (!userId) return;
  try {
    localStorage.setItem(langStorageKey(userId), lang);
  } catch {
    // Storage unavailable -- the in-memory selection for this session still
    // works, it just won't be remembered next time. Not worth surfacing.
  }
}

const LanguageCtx = createContext(null);

export function LanguageProvider({ children }) {
  // role comes from AuthContext, which already separates "optimistic hint"
  // vs "real" role -- this provider doesn't need to know which; either way
  // it's the best current guess and is only ever used as a DEFAULT, never
  // as anything security-relevant.
  const { user, role } = useAuth() || {};
  const [lang, setLangState] = useState(FALLBACK_LANG);

  // Re-derive whenever the signed-in user (or their known role) changes:
  // a stored per-user preference wins; otherwise fall back to the
  // role-based default; signed out (or not yet known) falls back to
  // English so the brief pre-login/loading screens have a sane default.
  useEffect(() => {
    if (!user) {
      setLangState(FALLBACK_LANG);
      return;
    }
    const stored = readStoredLang(user.id);
    if (stored) {
      setLangState(stored);
    } else {
      setLangState(role && ROLE_DEFAULT_LANG[role] ? ROLE_DEFAULT_LANG[role] : FALLBACK_LANG);
    }
    // Deliberately keyed on user.id (not the whole user object) and role --
    // this re-runs when a different person signs in, or once role resolves
    // from "unknown" to a real value, but not on every unrelated context
    // update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, role]);

  const setLang = useCallback(
    (next) => {
      if (next !== "en" && next !== "sw") return;
      setLangState(next);
      // A manual choice always overrides the role default, and is scoped to
      // this specific user so it can never apply to whoever signs in next
      // on the same device.
      if (user?.id) writeStoredLang(user.id, next);
    },
    [user?.id]
  );

  const dict = translations[lang] || translations[FALLBACK_LANG];

  const t = useCallback(
    (key, vars) => {
      let str = dict[key] ?? translations[FALLBACK_LANG][key] ?? key;
      if (vars) {
        for (const k of Object.keys(vars)) {
          str = str.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), vars[k]);
        }
      }
      return str;
    },
    [dict]
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return <LanguageCtx.Provider value={value}>{children}</LanguageCtx.Provider>;
}

export const useLanguage = () => useContext(LanguageCtx);
