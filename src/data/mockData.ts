import { Role, User, Physician, Pharmacy, Product, KeyMessage, AuditLog, Permissions, PhysicianVisit, PharmacyVisit, OrderRecord } from "../types";
import { getDefaultSampleCapabilities } from "../lib/sampleAuthorization";

export const initialUsers: User[] = [
  { 
    id: "U01", 
    name: "Mustafa shwayat", 
    email: "shwayat.mustafa@gmail.com", 
    role: Role.SUPER_ADMIN, 
    territory: "Al-Laythi Benghazi East zone", 
    region: "Tripoli", 
    active: true,
    joinedDate: "2/21/2026",
    territories: [
      "Al-Laythi Benghazi East zone",
      "Hay Qatar Benghazi East zone",
      "Venecia Benghazi West zone",
      "Beloun Benghazi West zone",
      "Al-Fuwayhat Benghazi West zone",
      "Al-Zaytoun Benghazi West zone",
      "Hun Al Jufra East Zone",
      "Waddan Al Jufra East Zone",
      "Al Jufra Al Jufra East Zone",
      "Sirte - Tahani Sirte Centre Zone",
      "Sokna Al Jufra East Zone",
      "Gharyan - Thani Al Jufra East Zone",
      "Al Khums Al Khums Centre Zone",
      "Ka'am Al Khums Centre Zone",
      "Aljweeihat Al Khums Centre Zone",
      "Soua alkhamees Al Khums Centre Zone",
      "Az Zawiyah Az Zawiyah West Zone",
      "Bani Walid Bani Walid Centre Zone",
      "Garabulli Garabulli Tripoli Zone",
      "Gharyan Gharyan Tripoli Zone",
      "Gharyan - Tahani Gharyan Tripoli Zone",
      "Misrata - Cash Misrata Centre Zone",
      "Misrata - Izz ad-Din Hamouda Misrata Centre Zone",
      "Misrata - Abd al-Muhaimin Misrata Centre Zone",
      "Sabha Sabha East Zone",
      "Sabratha Sabratha West Zone",
      "Sorman Sorman West Zone",
      "Tarhuna Tarhuna Tripoli Zone",
      "Al Mansoura Tripoli Centre Tripoli Zone",
      "Al Sawalem Tripoli Centre Tripoli Zone",
      "Az Zahra Tripoli Centre Tripoli Zone",
      "Bab Bin Ghashir Tripoli Centre Tripoli Zone",
      "Wasat al Madina Tripoli Centre Tripoli Zone",
      "Sidi Khalifa Tripoli Centre Tripoli Zone",
      "Fashloum Tripoli Centre Tripoli Zone"
    ]
  },
  { 
    id: "U02", 
    name: "Mustafa Super Admin", 
    email: "mustafa@pharmacrm.com", 
    role: Role.SUPER_ADMIN, 
    territory: "-", 
    region: "Tripoli", 
    active: true,
    joinedDate: "2/13/2026",
    territories: []
  },
  { 
    id: "U03", 
    name: "admin", 
    email: "admin@esnad.com", 
    role: Role.ADMIN, 
    territory: "-", 
    region: "Tripoli", 
    active: true,
    joinedDate: "2/21/2026",
    territories: []
  },
  { 
    id: "U04", 
    name: "Salah Hmouda", 
    email: "gm@esand.com", 
    role: Role.GENERAL_MANAGER, 
    territory: "-", 
    region: "Tripoli", 
    active: true,
    joinedDate: "2/21/2026",
    territories: []
  },
  { 
    id: "U05", 
    name: "Libyasmm Manager", 
    email: "libyasmm.test@esand.com", 
    role: Role.SALES_MARKETING_MANAGER, 
    territory: "-", 
    region: "Tripoli", 
    active: true,
    joinedDate: "2/21/2026",
    territories: []
  },
  { 
    id: "U06", 
    name: "libyaM Marketing", 
    email: "libyamk.test@esand.com", 
    role: Role.MARKETING_MANAGER, 
    territory: "-", 
    region: "Tripoli", 
    active: true,
    joinedDate: "2/21/2026",
    territories: []
  },
  { id: "U07", name: "Omar Al-Fares", email: "omar@menareps.com", role: Role.MEDICAL_REP, territory: "Amman-West", region: "Amman", active: true, joinedDate: "1/10/2026" },
  { id: "U08", name: "Rania Haddad", email: "rania@menareps.com", role: Role.MEDICAL_REP, territory: "Tripoli-Central", region: "Tripoli", active: true, joinedDate: "1/15/2026" },
  { id: "U09", name: "Zaid Al-Ibrahimi", email: "zaid@menareps.com", role: Role.SALES_REP, territory: "Baghdad-Karada", region: "Baghdad", active: true, joinedDate: "2/01/2026" },
  { id: "U10", name: "Yousef Al-Mansoori", email: "yousef@menareps.com", role: Role.GENERAL_MANAGER, territory: "GCC", region: "Riyadh", active: true, joinedDate: "12/15/2025" }
];

export const initialPhysicians: Physician[] = [
  { id: "PHY01", name: "Dr. Ahmad Al-Masri", nameAr: "د. أحمد المصري", specialty: "Cardiologist", classification: "A", territory: "Amman-West", region: "Amman", latitude: 31.9539, longitude: 35.9106, lastVisitDate: "2026-06-20", lastVisitStatus: "Completed", address: "Al-Khalidi Medical Center, Suite 302", primaryBrand: "CardioMax", targetBrands: ["CardioMax"] },
  { id: "PHY02", name: "Dr. Layla Khoury", nameAr: "د. ليلى خوري", specialty: "Pediatrician", classification: "A", territory: "Amman-West", region: "Amman", latitude: 31.9632, longitude: 35.8851, lastVisitDate: "2026-06-18", lastVisitStatus: "Completed", address: "Ibn Al-Haytham Hospital Complex", primaryBrand: "KidVits", targetBrands: ["KidVits"] },
  { id: "PHY03", name: "Dr. Mustafa El-Gheryani", nameAr: "د. مصطفى الغرياني", specialty: "Dermatologist", classification: "B", territory: "Tripoli-Central", region: "Tripoli", latitude: 32.8872, longitude: 13.1913, lastVisitDate: "2026-06-22", lastVisitStatus: "Completed", address: "Zawiyat Dahmani Clinic, Tripoli", primaryBrand: "Dermacure", targetBrands: ["Dermacure", "OrthoFlex"] },
  { id: "PHY04", name: "Dr. Zainab Al-Jawadi", nameAr: "د. زينب الجوادي", specialty: "Gynecologist", classification: "C", territory: "Baghdad-Karada", region: "Baghdad", latitude: 33.3128, longitude: 44.4244, lastVisitDate: "2026-06-25", lastVisitStatus: "Completed", address: "Al-Harithiya Medical Street", primaryBrand: "KidVits", targetBrands: ["KidVits", "CardioMax"] },
  { id: "PHY05", name: "Dr. Khalid Al-Faisal", nameAr: "د. خالد الفيصل", specialty: "Cardiologist", classification: "A", territory: "Riyadh-East", region: "Riyadh", latitude: 24.7136, longitude: 46.6753, address: "Sulaiman Al-Habib Hospital", primaryBrand: "CardioMax", targetBrands: ["CardioMax"] },
  { id: "PHY06", name: "Dr. Nuha Al-Tarawneh", nameAr: "د. نهى الطراونة", specialty: "Internal Medicine", classification: "B", territory: "Amman-West", region: "Amman", latitude: 31.9512, longitude: 35.9014, plannedVisitDate: "2026-06-26", address: "Shmeisani Hospital Clinics", primaryBrand: "OrthoFlex", targetBrands: ["OrthoFlex", "CardioMax"] },
  { id: "PHY07", name: "Dr. Ali Al-Shehri", nameAr: "د. علي الشهري", specialty: "Pediatrician", classification: "C", territory: "Riyadh-East", region: "Riyadh", latitude: 24.7215, longitude: 46.7022, address: "Olaya Pediatric Care Center", primaryBrand: "KidVits", targetBrands: ["KidVits"] },
  { id: "PHY08", name: "Dr. Abdulhadi Al-Libi", nameAr: "د. عبد الهادي الليبي", specialty: "Cardiologist", classification: "B", territory: "Tripoli-Central", region: "Tripoli", latitude: 32.8901, longitude: 13.1804, plannedVisitDate: "2026-06-26", address: "Gergarish Road Specialist Medical Complex", primaryBrand: "CardioMax", targetBrands: ["CardioMax", "OrthoFlex"] }
];

export const initialPharmacies: Pharmacy[] = [
  { 
    id: "PHM01", 
    name: "Al Saydaliya Al Markaziya", 
    nameAr: "الصيدلية المركزية", 
    territory: "Gharyan Gharyan Tripoli Zone", 
    region: "Tripoli", 
    latitude: 32.1678, 
    longitude: 13.0189, 
    outstandingBalance: 5112.0, 
    lastVisitDate: "Feb 2, 2026", 
    address: "Gharyan",
    type: "Retail",
    contact: "-",
    nextVisitDate: "Not set"
  },
  { 
    id: "PHM02", 
    name: "Cash Customer", 
    nameAr: "زبون نقدي", 
    territory: "Cash Office Tripoli East Tripoli Zone", 
    region: "Tripoli", 
    latitude: 32.8950, 
    longitude: 13.1901, 
    outstandingBalance: 0.0, 
    lastVisitDate: "-", 
    address: "Cash Office",
    type: "Retail",
    contact: "-",
    nextVisitDate: "-"
  },
  { 
    id: "PHM03", 
    name: "Clinic Abdulazim Abu Dabous", 
    nameAr: "د عبد العظيم ابو دبوس", 
    territory: "Tajoura Tripoli East Tripoli Zone", 
    region: "Tripoli", 
    latitude: 32.8850, 
    longitude: 13.3424, 
    outstandingBalance: 12500.0, 
    lastVisitDate: "-", 
    address: "Tajoura",
    type: "Retail",
    contact: "-",
    nextVisitDate: "-"
  },
  { 
    id: "PHM04", 
    name: "Clinic Al Mihad", 
    nameAr: "عيادة المهاد", 
    territory: "Abu Salim Tripoli South Tripoli Zone", 
    region: "Tripoli", 
    latitude: 32.8423, 
    longitude: 13.1789, 
    outstandingBalance: 3200.0, 
    lastVisitDate: "-", 
    address: "Abu Salim",
    type: "Retail",
    contact: "-",
    nextVisitDate: "-"
  },
  { 
    id: "PHM05", 
    name: "Clinic Allyby Alswysry", 
    nameAr: "مركز الليبي السويسري", 
    territory: "Jaraba Tripoli Centre Tripoli Zone", 
    region: "Tripoli", 
    latitude: 32.8795, 
    longitude: 13.1952, 
    outstandingBalance: 0.0, 
    lastVisitDate: "-", 
    address: "Jaraba",
    type: "Retail",
    contact: "-",
    nextVisitDate: "-"
  },
  { 
    id: "PHM06", 
    name: "Clinic Alsafa", 
    nameAr: "عيادة الصفاء", 
    territory: "Gharyan Gharyan Tripoli Zone", 
    region: "Tripoli", 
    latitude: 32.1702, 
    longitude: 13.0210, 
    outstandingBalance: 0.0, 
    lastVisitDate: "-", 
    address: "No address",
    type: "Retail",
    contact: "-",
    nextVisitDate: "-"
  },
  { 
    id: "PHM07", 
    name: "Clinic Dhkra Altbwly", 
    nameAr: "عيادة ذكرى الطبولي", 
    territory: "Shara' Dimashq Tripoli South Tripoli Zone", 
    region: "Tripoli", 
    latitude: 32.8591, 
    longitude: 13.1812, 
    outstandingBalance: 430.0, 
    lastVisitDate: "-", 
    address: "Al Dribi",
    type: "Retail",
    contact: "-",
    nextVisitDate: "-"
  },
  { 
    id: "PHM08", 
    name: "Clinic Fyzaj", 
    nameAr: "مركز فيزاج", 
    territory: "Al Furnaj Tripoli South Tripoli Zone", 
    region: "Tripoli", 
    latitude: 32.8512, 
    longitude: 13.2201, 
    outstandingBalance: 7800.0, 
    lastVisitDate: "-", 
    address: "Al Furnaj",
    type: "Retail",
    contact: "-",
    nextVisitDate: "-"
  },
  { 
    id: "PHM09", 
    name: "Clinic Hawa Al Kusher", 
    nameAr: "د. حواء الكشر", 
    territory: "Al Khums Al Khums Centre Zone", 
    region: "Tripoli", 
    latitude: 32.6514, 
    longitude: 14.2612, 
    outstandingBalance: 0.0, 
    lastVisitDate: "-", 
    address: "Al Khums",
    type: "Retail",
    contact: "-",
    nextVisitDate: "-"
  },
  { 
    id: "PHM10", 
    name: "Riyadh Modern Pharmacy", 
    nameAr: "صيدلية الرياض الحديثة", 
    territory: "Riyadh-East", 
    region: "Riyadh", 
    latitude: 24.7150, 
    longitude: 46.6810, 
    outstandingBalance: 8350.0, 
    lastVisitDate: "2026-06-10", 
    address: "King Abdullah Road, exit 10",
    type: "Retail",
    contact: "-",
    nextVisitDate: "-"
  }
];

export const initialProducts: Product[] = [
  { id: "PROD01", name: "CardioMax 10mg", brand: "CardioMax", therapeuticArea: "Physician Direct promotion Program", price: 45.0, stock: 1200, description: "Advanced ACE Inhibitor for long-term hypertension management." },
  { id: "PROD02", name: "CardioMax 20mg", brand: "CardioMax", therapeuticArea: "Physician Direct promotion Program", price: 65.0, stock: 850, description: "High-dose blood pressure moderator for high-risk cardiac patient detailing." },
  { id: "PROD03", name: "KidVits Chewable", brand: "KidVits", therapeuticArea: "Patient engagements Program", price: 18.5, stock: 3400, description: "Tasty multi-vitamin chewables for dynamic pediatric development." },
  { id: "PROD04", name: "OrthoFlex Gel", brand: "OrthoFlex", therapeuticArea: "Patient engagements Program", price: 24.0, stock: 1500, description: "Highly penetrating anti-inflammatory joint and muscle relief gel." },
  { id: "PROD05", name: "Dermacure Cream", brand: "Dermacure", therapeuticArea: "Patient/pharmacy/ physician engagements Program", price: 32.0, stock: 980, description: "Eczema and psoriasis calming barrier-repair formulation." },
  { id: "PROD06", name: "ACNE CARE 25G", brand: "ACNE LLINE", therapeuticArea: "Dermatology Program", price: 28.0, stock: 1100, description: "Acne care and skin blemishes clearing formulation." },
  { id: "PROD07", name: "ACNE WASH OILY SKIN 150ML", brand: "ACNE LLINE", therapeuticArea: "Dermatology Program", price: 22.0, stock: 0, description: "Acne face wash for oily skin skin clarifying cleanser." },
  { id: "PROD08", name: "ACNIPARE GEL 30G", brand: "ACNE LLINE", therapeuticArea: "Dermatology Program", price: 30.0, stock: 1450, description: "Acne and pimple reduction topical gel." }
];

export const initialKeyMessages: KeyMessage[] = [
  { id: "MSG01", brandId: "CardioMax", brandName: "CardioMax", message: "Achieves rapid 24-hour ambulatory blood pressure control with a clean metabolic profile.", messageAr: "يحقق تحكماً سريعاً في ضغط الدم على مدار 24 ساعة مع ملف أيضي نظيف.", therapeuticArea: "Physician Direct promotion Program" },
  { id: "MSG02", brandId: "CardioMax", brandName: "CardioMax", message: "Significantly reduces microalbuminuria in diabetic hypertensive patients by up to 34%.", messageAr: "يقلل بشكل كبير من البيلة الألبومينية الدقيقة لدى مرضى السكري المصابين بارتفاع ضغط الدم بنسبة تصل إلى 34٪.", therapeuticArea: "Physician Direct promotion Program" },
  { id: "MSG03", brandId: "KidVits", brandName: "KidVits", message: "Zero artificial sugars. Features active folate and zinc for robust child immunity and growth.", messageAr: "خالٍ من السكريات الاصطناعية. يحتوي على حمض الفوليك النشط والزنك لمناعة ونمو قويين للأطفال.", therapeuticArea: "Patient engagements Program" },
  { id: "MSG04", brandId: "OrthoFlex", brandName: "OrthoFlex", message: "Fast action joint relief with micro-liposomal technology delivering instant therapeutic effect.", messageAr: "تخفيف آلام المفاصل سريع المفعول بتقنية الجزيئات الشحمية الدقيقة التي تمنح تأثيراً علاجياً فورياً.", therapeuticArea: "Patient engagements Program" }
];

export const initialPermissions: Record<Role, Permissions> = {
  [Role.SUPER_ADMIN]: {
    view: true, create: true, edit: true, delete: true, approve: true, export: true, import: true, assign: true, reassign: true, viewTeamData: true, viewNationalData: true, viewFinancialData: true
  },
  [Role.ADMIN]: {
    view: true, create: true, edit: true, delete: true, approve: true, export: true, import: true, assign: true, reassign: true, viewTeamData: true, viewNationalData: true, viewFinancialData: true
  },
  [Role.GENERAL_MANAGER]: {
    view: true, create: false, edit: false, delete: false, approve: true, export: true, import: false, assign: false, reassign: false, viewTeamData: true, viewNationalData: true, viewFinancialData: true
  },
  [Role.REGIONAL_MANAGER]: {
    view: true, create: false, edit: true, delete: false, approve: true, export: true, import: false, assign: true, reassign: true, viewTeamData: true, viewNationalData: true, viewFinancialData: true
  },
  [Role.COUNTRY_MANAGER]: {
    view: true, create: false, edit: true, delete: false, approve: true, export: true, import: false, assign: true, reassign: true, viewTeamData: true, viewNationalData: true, viewFinancialData: true
  },
  [Role.AREA_SALES_MANAGER]: {
    view: true, create: true, edit: true, delete: false, approve: true, export: true, import: false, assign: true, reassign: true, viewTeamData: true, viewNationalData: false, viewFinancialData: true
  },
  [Role.MEDICAL_SUPERVISOR]: {
    view: true, create: true, edit: true, delete: false, approve: true, export: true, import: false, assign: true, reassign: true, viewTeamData: true, viewNationalData: false, viewFinancialData: false
  },
  [Role.SALES_SUPERVISOR]: {
    view: true, create: true, edit: true, delete: false, approve: true, export: true, import: false, assign: true, reassign: true, viewTeamData: true, viewNationalData: false, viewFinancialData: true
  },
  [Role.MEDICAL_REP]: {
    view: true, create: true, edit: true, delete: false, approve: false, export: true, import: false, assign: false, reassign: false, viewTeamData: false, viewNationalData: false, viewFinancialData: false
  },
  [Role.SALES_REP]: {
    view: true, create: true, edit: true, delete: false, approve: false, export: true, import: false, assign: false, reassign: false, viewTeamData: false, viewNationalData: false, viewFinancialData: false
  },
  [Role.FINANCE]: {
    view: true, create: true, edit: true, delete: false, approve: true, export: true, import: false, assign: false, reassign: false, viewTeamData: true, viewNationalData: true, viewFinancialData: true
  },
  [Role.WAREHOUSE_INVENTORY]: {
    view: true, create: true, edit: true, delete: false, approve: false, export: true, import: true, assign: false, reassign: false, viewTeamData: false, viewNationalData: false, viewFinancialData: false
  },
  [Role.MARKETING]: {
    view: true, create: true, edit: true, delete: false, approve: false, export: true, import: false, assign: false, reassign: false, viewTeamData: true, viewNationalData: true, viewFinancialData: false
  },
  [Role.PRODUCT_MANAGER]: {
    view: true, create: true, edit: true, delete: false, approve: true, export: true, import: false, assign: false, reassign: false, viewTeamData: true, viewNationalData: true, viewFinancialData: false
  },
  [Role.DELIVERY_OFFICER]: {
    view: true, create: false, edit: true, delete: false, approve: false, export: false, import: false, assign: false, reassign: false, viewTeamData: false, viewNationalData: false, viewFinancialData: false
  },
  [Role.ORDER_OPS_OFFICER]: {
    view: true, create: true, edit: true, delete: false, approve: true, export: true, import: false, assign: false, reassign: false, viewTeamData: true, viewNationalData: false, viewFinancialData: false
  },
  [Role.SALES_MARKETING_MANAGER]: {
    view: true, create: true, edit: true, delete: false, approve: true, export: true, import: false, assign: true, reassign: true, viewTeamData: true, viewNationalData: true, viewFinancialData: true
  },
  [Role.MARKETING_MANAGER]: {
    view: true, create: true, edit: true, delete: false, approve: true, export: true, import: false, assign: false, reassign: false, viewTeamData: true, viewNationalData: true, viewFinancialData: false
  },
  [Role.MEDICAL_MANAGER]: {
    view: true, create: true, edit: true, delete: false, approve: true, export: true, import: false, assign: true, reassign: true, viewTeamData: true, viewNationalData: true, viewFinancialData: false
  },
  [Role.SALES_MANAGER]: {
    view: true, create: true, edit: true, delete: false, approve: true, export: true, import: false, assign: true, reassign: true, viewTeamData: true, viewNationalData: true, viewFinancialData: true
  },
  [Role.TREASURY_OFFICER]: {
    view: true, create: true, edit: true, delete: false, approve: true, export: true, import: false, assign: false, reassign: false, viewTeamData: true, viewNationalData: true, viewFinancialData: true
  },
  [Role.STORE_MANAGER]: {
    view: true, create: true, edit: true, delete: false, approve: true, export: true, import: true, assign: false, reassign: false, viewTeamData: true, viewNationalData: false, viewFinancialData: false
  },
  [Role.WAREHOUSE_MANAGER]: {
    view: true, create: true, edit: true, delete: false, approve: true, export: true, import: true, assign: false, reassign: false, viewTeamData: true, viewNationalData: true, viewFinancialData: false
  },
  [Role.SYSTEM_ADMINISTRATOR]: {
    view: true, create: true, edit: true, delete: true, approve: true, export: true, import: true, assign: true, reassign: true, viewTeamData: true, viewNationalData: true, viewFinancialData: true
  },
  [Role.FINANCE_MANAGER]: {
    view: true, create: true, edit: true, delete: false, approve: true, export: true, import: false, assign: false, reassign: false, viewTeamData: true, viewNationalData: true, viewFinancialData: true
  },
  [Role.INVENTORY_OFFICER]: {
    view: true, create: true, edit: true, delete: false, approve: false, export: true, import: true, assign: false, reassign: false, viewTeamData: false, viewNationalData: false, viewFinancialData: false
  },
  [Role.MARKETING_OFFICER]: {
    view: true, create: true, edit: true, delete: false, approve: false, export: true, import: false, assign: false, reassign: false, viewTeamData: true, viewNationalData: true, viewFinancialData: false
  }
};

for (const role of Object.values(Role)) {
  initialPermissions[role].sampleCapabilities = getDefaultSampleCapabilities(role);
}

export const initialAuditLogs: AuditLog[] = [
  { id: "AUD01", userId: "U01", userName: "Wajdi Al-Gharbi", userRole: Role.SUPER_ADMIN, action: "Login", entityType: "User", details: "Super Admin logged into Amman headquarters workstation.", timestamp: "2026-06-26T08:30:11-07:00" },
  { id: "AUD02", userId: "U02", userName: "Omar Al-Fares", userRole: Role.MEDICAL_REP, action: "Visit completion", entityType: "Visit", entityId: "V001", details: "Completed medical detailing visit with Dr. Ahmad Al-Masri with GPS validation verified.", timestamp: "2026-06-25T11:45:00-07:00" },
  { id: "AUD03", userId: "U04", userName: "Zaid Al-Ibrahimi", userRole: Role.SALES_REP, action: "Order processing", entityType: "Order", entityId: "ORD981", details: "Booked a pharmacy sales order of 50 packs CardioMax with Al-Shifa Pharmacy.", timestamp: "2026-06-24T14:15:32-07:00" },
  { id: "AUD04", userId: "U06", userName: "Fatima Al-Riyami", userRole: Role.FINANCE, action: "Payment processing", entityType: "Payment", details: "Processed cash collection of 1200 USD from Ibn Sina Pharmacy. Outstanding balance decreased.", timestamp: "2026-06-21T09:12:00-07:00" },
  { id: "AUD05", userId: "U08", userName: "Muna Al-Saeed", userRole: Role.MARKETING, action: "Update", entityType: "KeyMessage", entityId: "MSG03", details: "Updated promotional key message for KidVits formulation.", timestamp: "2026-06-20T16:00:22-07:00" }
];

export const initialPhysicianVisits: PhysicianVisit[] = [
  {
    id: "V001",
    physicianId: "PHY01",
    physicianName: "Dr. Ahmad Al-Masri",
    repId: "U02",
    repName: "Omar Al-Fares",
    visitDate: "2026-06-25",
    durationSeconds: 260,
    detailing: [
      { productId: "PROD01", brandName: "CardioMax", reaction: "Positive", notes: "Highly interested in diabetic-hypertension protection." }
    ],
    samples: [
      { productId: "PROD01", productName: "CardioMax 10mg", brand: "CardioMax", quantity: 5 }
    ],
    additionalSampleRequests: [],
    prescriptionIntent: 9,
    generalNotes: "Excellent interaction. Doctor promised to prescribe CardioMax for new patients this week.",
    gpsVerified: true,
    latitude: 31.9539,
    longitude: 35.9106,
    createdAt: "2026-06-25T11:45:00-07:00"
  },
  {
    id: "V002",
    physicianId: "PHY02",
    physicianName: "Dr. Layla Khoury",
    repId: "U02",
    repName: "Omar Al-Fares",
    visitDate: "2026-06-18",
    durationSeconds: 180,
    detailing: [
      { productId: "PROD03", brandName: "KidVits", reaction: "Neutral", notes: "Asked for child compliance study on chewable dosage." }
    ],
    samples: [
      { productId: "PROD03", productName: "KidVits Chewable", brand: "KidVits", quantity: 10 }
    ],
    additionalSampleRequests: [
      { productName: "KidVits Chewable", quantityNeeded: 20, expectedDeliveryDate: "2026-07-01", reason: "Preparing for a child health event at local clinic" }
    ],
    prescriptionIntent: 6,
    generalNotes: "Requested child growth chart brochures for clinical distribution.",
    gpsVerified: true,
    latitude: 31.9632,
    longitude: 35.8851,
    createdAt: "2026-06-18T14:10:00-07:00"
  }
];

export const initialPharmacyVisits: PharmacyVisit[] = [
  {
    id: "PV001",
    pharmacyId: "PHM01",
    pharmacyName: "Al-Haramain Pharmacy",
    repId: "U04",
    repName: "Zaid Al-Ibrahimi",
    visitDate: "2026-06-19",
    gpsVerified: true,
    visitPurpose: "Order Intake",
    items: [
      { productId: "PROD01", productName: "CardioMax 10mg", quantity: 40, price: 45.0, discount: 5 },
      { productId: "PROD03", productName: "KidVits Chewable", quantity: 20, price: 18.5, discount: 0 }
    ],
    totalAmount: 2170,
    discountApplied: 90,
    netAmount: 2080,
    paymentMethod: "Cash",
    paymentCollected: 1000,
    outstandingBalanceAfter: 1080,
    stockAudit: [],
    intelNotes: "Competitor cardio drug is offering 7% discounts. Stocked 100 packs of competitor brand.",
    createdAt: "2026-06-19T13:00:00-07:00"
  }
];

export const initialOrders: OrderRecord[] = [
  {
    id: "ORD-2026-000488",
    pharmacyId: "PHR-401",
    pharmacyName: "Al-Amal Al-Hadeetha Pharmacy (صيدلية الأمل الحديثة)",
    pharmacyAddress: "Wasat al Madina, Tripoli",
    date: "Jun 27, 2026",
    total: 1170.00,
    paidStatus: "Unpaid",
    paidAmount: 0.00,
    status: "Pending Financial Review",
    salesRep: "Ahmed Al-Taji",
    items: [
      { id: "ITEM-001", name: "TACRUS 0.1% OINTMENT 10GM", quantity: 15, price: 78.00, total: 1170.00 }
    ],
    notes: ""
  },
  {
    id: "ORD-2026-000487",
    pharmacyId: "PHR-402",
    pharmacyName: "Ibn Sina Community Pharmacy (صيدلية ابن سينا المجتمعية)",
    pharmacyAddress: "Al Akouakh Hub, Benghazi",
    date: "Jun 25, 2026",
    total: 2180.00,
    paidStatus: "Unpaid",
    paidAmount: 0.00,
    status: "Pending Supervisor Review",
    salesRep: "Omar Al-Mokhtar",
    items: [
      { id: "ITEM-002", name: "CardioMax 10mg", quantity: 20, price: 85.00, total: 1700.00 },
      { id: "ITEM-003", name: "KidVits Pediatric Syrup", quantity: 8, price: 60.00, total: 480.00 }
    ],
    notes: "Requires Supervisor validation due to bulk request exceeding standard rep limits."
  },
  {
    id: "ORD-2026-000486",
    pharmacyId: "PHR-403",
    pharmacyName: "Al-Shifa Al-Alamiya Pharmacy (صيدلية الشفاء العالمية)",
    pharmacyAddress: "Tripoli Central",
    date: "Jun 25, 2026",
    total: 1511.00,
    paidStatus: "Unpaid",
    paidAmount: 0.00,
    status: "Pending Financial Review",
    salesRep: "Sarah Al-Sharif",
    items: [
      { id: "ITEM-004", name: "Amlodipine 5mg", quantity: 43, price: 35.14, total: 1511.00 }
    ],
    notes: ""
  },
  {
    id: "ORD-2026-000485",
    pharmacyId: "PHR-404",
    pharmacyName: "Al-Rawda Pharmacy (صيدلية الروضة)",
    pharmacyAddress: "Siyahiya Area, Tripoli",
    date: "Jun 25, 2026",
    total: 1558.00,
    paidStatus: "Unpaid",
    paidAmount: 0.00,
    status: "Returned to Rep",
    salesRep: "Omar Al-Mokhtar",
    items: [
      { id: "ITEM-005", name: "KidVits Pediatric Syrup", quantity: 26, price: 59.92, total: 1558.00 }
    ],
    notes: "Returned for correction: Please double-check client's credit limit eligibility."
  }
];

export const initialPhysicianSpecialties = [
  { id: "spec_cardio", name: "Cardiology", nameAr: "أمراض القلب", normalizedName: "CARDIOLOGY", aliases: ["CARDIOLOGIST", "HEART SPECIALIST"], isActive: true, createdAt: "2026-06-01T00:00:00Z", createdBy: "system", source: "system" },
  { id: "spec_pedia", name: "Pediatrics", nameAr: "طب الأطفال", normalizedName: "PEDIATRICS", aliases: ["PEDIATRICIAN", "CHILD HEALTH"], isActive: true, createdAt: "2026-06-01T00:00:00Z", createdBy: "system", source: "system" },
  { id: "spec_derma", name: "Dermatology", nameAr: "أمراض الجلدية", normalizedName: "DERMATOLOGY", aliases: ["DERMATOLOGIST", "SKIN SPECIALIST"], isActive: true, createdAt: "2026-06-01T00:00:00Z", createdBy: "system", source: "system" },
  { id: "spec_gyne", name: "Gynecology", nameAr: "أمراض النساء والتوليد", normalizedName: "GYNECOLOGY", aliases: ["GYNECOLOGIST", "OBSTETRICIAN", "OB-GYN"], isActive: true, createdAt: "2026-06-01T00:00:00Z", createdBy: "system", source: "system" },
  { id: "spec_internal", name: "Internal Medicine", nameAr: "الباطنية", normalizedName: "INTERNAL MEDICINE", aliases: ["INTERNIST", "INTERNAL"], isActive: true, createdAt: "2026-06-01T00:00:00Z", createdBy: "system", source: "system" },
  { id: "spec_gp", name: "General Practitioner", nameAr: "ممارس عام", normalizedName: "GENERAL PRACTITIONER", aliases: ["GP", "GENERAL"], isActive: true, createdAt: "2026-06-01T00:00:00Z", createdBy: "system", source: "system" }
];
