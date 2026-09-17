export interface SidebarNavigationItem {
  id: string;
  label: { en: string; ar: string };
  badge?: string | number;
}

export interface SidebarNavigationGroup extends SidebarNavigationItem {
  children?: readonly SidebarNavigationItem[];
}

const item = (id: string, en: string, ar: string, badge?: string | number): SidebarNavigationItem => ({ id, label: { en, ar }, ...(badge === undefined ? {} : { badge }) });
const group = (id: string, en: string, ar: string, children?: readonly SidebarNavigationItem[]): SidebarNavigationGroup => ({ id, label: { en, ar }, ...(children ? { children } : {}) });

export const SIDEBAR_NAVIGATION_REGISTRY = Object.freeze([
  group("dashboard", "Dashboard", "لوحة التحكم"),
  group("field-operations", "Field Operations", "العمليات الميدانية", [
    item("field-physician-list", "Physicians", "الأطباء"), item("field-physician-visit", "Physician Visits", "زيارات الأطباء"), item("visits-review", "Visits", "سجل الزيارات"), item("field-gps-verified", "GPS Verified Physicians", "الأطباء الموثقين جغرافياً"), item("field-medical-planner", "Medical Planner", "مخطط الأطباء الميداني"),
  ]),
  group("pharmacies", "Pharmacies", "الصيدليات", [
    item("pharmacies-list", "Pharmacy List", "سجل الصيدليات"), item("pharmacies-gps-verified", "GPS Verified Pharmacies", "الصيدليات الموثقة جغرافياً"), item("pharmacies-sales-planner", "Sales Planner", "مخطط المبيعات والجرد"), item("pharmacies-pharmacy-visit", "Pharmacy Visit", "زيارة صيدلية جديدة"), item("pharmacies-visit-drafts", "Visit Drafts", "مسودات الزيارات"), item("visits-review", "Visits", "سجل الزيارات"),
  ]),
  group("products", "Products", "المنتجات والأدوية", [item("products-list", "Product List", "كتالوج الأدوية"), item("products-resource-center", "Resource Center & Brochures", "مركز المصادر والمطويات الدعائية")]),
  group("master-data", "Master Data", "البيانات الأساسية", [item("master-promotion-groups", "Promotion Groups", "مجموعات الترويج"), item("master-specialties", "Physician Specialties", "تخصصات الأطباء"), item("products-key-messages", "Key Messages", "الرسائل الترويجية الأساسية"), item("admin-template-catalog", "Template Catalog", "كتالوج القوالب المؤسسية")]),
  group("samples", "Samples", "العينات الطبية", [item("sample-management", "Sample Management", "إدارة العينات"), item("samples-reports", "Sample Reports", "تقارير استهلاك العينات")]),
  group("marketing", "Marketing", "التسويق والمؤتمرات", [item("marketing-my-requests", "My Marketing Requests", "طلبات التسويق الخاصة بي"), item("marketing-activities", "Marketing Activities", "الأنشطة التسويقية"), item("marketing-add-activity", "Add Marketing Activity", "إضافة نشاط تسويقي"), item("marketing-calendar", "Activity Calendar", "جدول الفعاليات الترويجية"), item("marketing-campaigns", "Campaigns", "الحملات الترويجية المركزية"), item("marketing-events", "Events", "إدارة الندوات الطبية"), item("marketing-materials-requests", "Materials Requests", "طلبات الهدايا والدعايات"), item("marketing-approvals", "Marketing Approvals", "اعتمادات ميزانيات التسويق"), item("marketing-settings", "Marketing Settings", "إعدادات التسويق واللوائح")]),
  group("sales-and-orders", "Sales & Orders", "المبيعات والمستحقات", [item("sales-offers", "Offers", "عروض وشروط البيع"), item("sales-orders", "Order Operations", "إدارة وتدقيق العمليات والطلبات"), item("payment-collection", "Payment Collections", "تحصيل المدفوعات والذكاء المالي"), item("sales-stock-requests", "Stock Requests", "طلبات توريد المخزون")]),
  group("territory-team", "Area & Team", "المناطق وفرق العمل", [item("territory-my-territory", "My Area", "منطقتي الجغرافية"), item("territory-team-list", "Team", "فريق العمل الميداني"), item("territory-organization", "Organization", "الهيكل التنظيمي")]),
  group("supervision", "Supervision", "الإشراف والرقابة", [item("supervision-coaching-reports", "Coaching Reports", "تقارير التوجيه الميداني"), item("supervision-team-activity", "Team Activity", "نشاط وتغطية الفريق"), item("supervision-approvals", "Approvals", "اعتمادات طلبات المندوبين"), item("supervision-leave-approvals", "Leave Approvals", "اعتمادات الإجازات والغياب"), item("supervision-planning", "Supervisor Planning", "تخطيط مسارات المشرف"), item("supervision-field-visits", "Supervisor Field Visit", "الزيارة الميدانية للمشرف"), item("supervision-visits", "Supervisor Visits", "زيارات المشرف الميدانية"), item("supervision-task-center", "Task Center", "مركز مهام المشرفين")]),
  group("finance", "Finance", "المالية والمحاسبة", [item("finance-customer-accounts", "Customer Accounts & AR", "حسابات العملاء والذمم"), item("finance-financials", "Financials", "البيانات المالية"), item("finance-receipt-books", "Receipt Books", "دفاتر الإيصالات"), item("finance-receipt-tracking", "Receipt Tracking", "تتبع الإيصالات"), item("finance-dashboard", "Finance Dashboard", "لوحة التحكم المالية"), item("finance-payment-processing", "Payment Processing", "معالجة المدفوعات"), item("finance-reports", "Financial Reports", "التقارير المالية"), item("finance-budget-management", "Budget Management", "إدارة الميزانية")]),
  group("productivity", "Productivity", "الإنتاجية والعمل اليومي", [item("productivity-notifications", "Notifications", "الإشعارات", 1), item("productivity-tasks", "My Tasks", "مهامي اليومية"), item("productivity-notes", "Notes", "الملاحظات"), item("productivity-workday", "My Workday", "يومي الميداني"), item("productivity-meetings", "Meetings", "الاجتماعات المجدولة")]),
  group("targets", "Targets", "الأهداف البيعية", [item("targets-product-targets", "Product Targets", "أهداف ومبيعات المستحضرات")]),
  group("inventory", "Inventory", "المخازن والمستودعات", [item("inventory-bulk-updates", "Bulk Updates", "التحديثات الجماعية للمخزون"), item("inventory-purchase-orders", "Purchase Orders", "أوامر الشراء والتوريد"), item("inventory-dashboard", "Inventory Dashboard", "لوحة التحكم بالمخزون"), item("inventory-batch-management", "Batch Management", "إدارة التشغيلات والتواريخ"), item("inventory-reports", "Inventory Reports", "تقارير المخزون الإحصائية")]),
  group("operations", "Operations", "العمليات اللوجستية", [item("operations-order-operations", "Order Operations", "إدارة وتدقيق طلبات العملاء"), item("operations-customer-service", "Customer Service", "خدمة العملاء والدعم الفني")]),
  group("analytics", "Analytics", "التحليلات والمؤشرات", [item("analytics-reports", "Reports", "التقارير"), item("analytics-performance", "Performance Analytics", "تحليلات الأداء"), item("analytics-medical-quality", "Medical Visit Quality", "مؤشر جودة زيارات الأطباء"), item("analytics-sales-quality", "Sales Visit Quality", "مؤشر جودة مبيعات الصيدليات"), item("analytics-territory-synergy", "Territory Synergy", "تآزر وتكامل الأقاليم الميدانية"), item("analytics-product", "Product Dashboard", "تحليل مبيعات الأدوية"), item("analytics-sample", "Sample Analytics", "اقتصاديات العينات الطبية"), item("analytics-supervisor-reports", "Supervisor Reports", "تقارير المشرفين"), item("analytics-supervisor-performance", "Supervisor Performance", "أداء المشرفين الميدانيين"), item("analytics-ai-reports", "AI Reports", "تقارير الذكاء الاصطناعي المتقدمة"), item("analytics-security-tests", "Security Verification Suite", "جناح التحقق وضمان الخصوصية")]),
  group("administration", "Administration", "الإدارة والصلاحيات", [item("admin-user-management", "User Management", "إدارة المستخدمين"), item("admin-product-assignment-audit", "Product Assignment Audit", "تدقيق تعيين المنتجات للأدوار"), item("admin-role-settings", "Role Sidebar Settings", "إعدادات صلاحيات وواجهات الأدوار"), item("admin-data-import", "Data Import", "مركز استيراد الملفات")]),
  group("account", "Account", "الحساب الشخصي", [item("account-user-manual", "User Manual", "دليل المستخدم الإلكتروني"), item("account-settings", "Settings", "إعدادات الحساب الشخصي"), item("account-logout", "Logout", "تسجيل الخروج")]),
] as const);

/**
 * Former Sidebar shortcuts that remain supported direct/restored routes.
 * They are intentionally absent from presentation, but remain valid exact
 * navigation-restriction targets for backward compatibility.
 */
export const SIDEBAR_COMPATIBILITY_VIEW_IDS = Object.freeze([
  "admin-location",
  "admin-order-workflow-settings",
] as const);

const FINANCE_OFFICER_VIEWS = Object.freeze([
  item("finance-customer-status", "Customer Financial Status", "الوضعية المالية للعملاء"),
  item("finance-balances", "Outstanding Balances", "المديونيات المعلقة للعملاء"),
  item("finance-credit-monitoring", "Credit Limit Monitoring", "مراقبة الحدود الائتمانية"),
]);

export function sidebarNavigationRegistryForRole(role: string): readonly SidebarNavigationGroup[] {
  const supervisor=role==="Medical Supervisor"||role==="Sales Supervisor";
  return SIDEBAR_NAVIGATION_REGISTRY.map(entry => {
    if(entry.id==="finance"&&role==="Finance Officer") return {...entry,children:FINANCE_OFFICER_VIEWS};
    if(entry.id==="field-operations"&&supervisor) return {...entry,children:entry.children?.map(child=>child.id==="visits-review"?{...child,label:{en:"Representative Visits",ar:"زيارات المندوبين"}}:child)};
    return entry;
  });
}
