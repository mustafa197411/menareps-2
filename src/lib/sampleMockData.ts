import { LegacySampleAllocation as SampleAllocation, LegacySampleApproval as SampleApproval, LegacySampleRequest as SampleRequest } from "../types";

export const initialSampleAllocations: SampleAllocation[] = [
  {
    id: "AL001",
    repId: "U02",
    repName: "Omar Al-Fares",
    productId: "PROD01",
    productName: "CardioMax 10mg",
    brand: "CardioMax",
    allocatedQuantity: 100,
    distributedQuantity: 45,
    remainingQuantity: 55,
    month: "2026-06",
    region: "Amman"
  },
  {
    id: "AL002",
    repId: "U02",
    repName: "Omar Al-Fares",
    productId: "PROD03",
    productName: "KidVits Chewable",
    brand: "KidVits",
    allocatedQuantity: 200,
    distributedQuantity: 120,
    remainingQuantity: 80,
    month: "2026-06",
    region: "Amman"
  },
  {
    id: "AL003",
    repId: "U03",
    repName: "Lina Al-Hassan",
    productId: "PROD01",
    productName: "CardioMax 10mg",
    brand: "CardioMax",
    allocatedQuantity: 150,
    distributedQuantity: 60,
    remainingQuantity: 90,
    month: "2026-06",
    region: "Tripoli"
  },
  {
    id: "AL004",
    repId: "U03",
    repName: "Lina Al-Hassan",
    productId: "PROD04",
    productName: "OrthoFlex Gel",
    brand: "OrthoFlex",
    allocatedQuantity: 80,
    distributedQuantity: 30,
    remainingQuantity: 50,
    month: "2026-06",
    region: "Tripoli"
  }
];

export const initialSampleApprovals: SampleApproval[] = [
  {
    id: "APR001",
    repId: "U02",
    repName: "Omar Al-Fares",
    productId: "PROD01",
    productName: "CardioMax 10mg",
    brand: "CardioMax",
    requestedQuantity: 50,
    originalAllocation: 100,
    reason: "Preparing for high-attendance clinical symposium next week.",
    status: "Pending",
    submittedDate: "2026-06-25"
  },
  {
    id: "APR002",
    repId: "U03",
    repName: "Lina Al-Hassan",
    productId: "PROD03",
    productName: "KidVits Chewable",
    brand: "KidVits",
    requestedQuantity: 100,
    originalAllocation: 150,
    reason: "New hospital accounts opened demanding immediate detailing kits.",
    status: "Pending",
    submittedDate: "2026-06-26"
  },
  {
    id: "APR003",
    repId: "U02",
    repName: "Omar Al-Fares",
    productId: "PROD04",
    productName: "OrthoFlex Gel",
    brand: "OrthoFlex",
    requestedQuantity: 30,
    originalAllocation: 50,
    reason: "Orthopedic clinic campaign running in West Amman.",
    status: "Approved",
    submittedDate: "2026-06-20",
    actionBy: "Dr. Supervisor",
    actionDate: "2026-06-21"
  },
  {
    id: "APR004",
    repId: "U05",
    repName: "Ahmad Al-Jamil",
    productId: "PROD02",
    productName: "CardioMax 20mg",
    brand: "CardioMax",
    requestedQuantity: 150,
    originalAllocation: 120,
    reason: "Requested double stock without giving details of physician clinic lists.",
    status: "Rejected",
    submittedDate: "2026-06-18",
    actionBy: "Dr. Supervisor",
    actionDate: "2026-06-19"
  }
];

export const initialSampleRequests: SampleRequest[] = [
  {
    id: "REQ001",
    repId: "U02",
    repName: "Omar Al-Fares",
    productId: "PROD01",
    productName: "CardioMax 10mg",
    brand: "CardioMax",
    quantity: 150,
    reason: "Severe surge in hypertension patient visits in the central province.",
    status: "Pending",
    requestedDate: "2026-06-24",
    urgent: true,
    physicianId: "PHY01",
    physicianName: "Dr. Ahmad Al-Masri"
  },
  {
    id: "REQ002",
    repId: "U03",
    repName: "Lina Al-Hassan",
    productId: "PROD03",
    productName: "KidVits Chewable",
    brand: "KidVits",
    quantity: 200,
    reason: "Replenishing bags for summer child medical campaign.",
    status: "Shipped",
    requestedDate: "2026-06-20",
    urgent: false,
    physicianId: "PHY02",
    physicianName: "Dr. Layla Khoury"
  },
  {
    id: "REQ003",
    repId: "U02",
    repName: "Omar Al-Fares",
    productId: "PROD04",
    productName: "OrthoFlex Gel",
    brand: "OrthoFlex",
    quantity: 80,
    reason: "Local clinics run out of trial gels.",
    status: "Delivered",
    requestedDate: "2026-06-15",
    urgent: false,
    physicianId: "PHY06",
    physicianName: "Dr. Nuha Al-Tarawneh"
  }
];

export const initialSampleInventory = [
  { id: "INV001", sampleId: "S39", name: "SUNSCREEN ADVANCED - Trial", brand: "SUNSCREEN", unitSize: "50ML", unitsPerPack: 1, coldChain: false, status: "Active", qty: 59, available: 12, repsStock: 43, reorder: 100 },
  { id: "INV002", sampleId: "S33", name: "PHOTOBLOCK GEL - Trial", brand: "PHOTOBLOCK", unitSize: "75G", unitsPerPack: 1, coldChain: false, status: "Active", qty: 53, available: 16, repsStock: 36, reorder: 100 },
  { id: "INV003", sampleId: "S32", name: "PHOTOBLOCK CREAM - Trial", brand: "PHOTOBLOCK", unitSize: "75G", unitsPerPack: 1, coldChain: false, status: "Active", qty: 48, available: 3, repsStock: 49, reorder: 100 },
  { id: "INV004", sampleId: "S38", name: "SPOTEX GEL 30G - Trial", brand: "SPOTEX", unitSize: "30G", unitsPerPack: 1, coldChain: false, status: "Active", qty: 17, available: 7, repsStock: 8, reorder: 100 },
  { id: "INV005", sampleId: "S34", name: "PHOTOBLOCK PLUS - Trial", brand: "PHOTOBLOCK", unitSize: "75G", unitsPerPack: 1, coldChain: false, status: "Active", qty: 59, available: 25, repsStock: 34, reorder: 100 },
  { id: "INV006", sampleId: "S08", name: "AQUAX REPELLANT CREAM 100ML - Trial", brand: "AQUAX", unitSize: "100ML", unitsPerPack: 1, coldChain: false, status: "Active", qty: 13, available: 6, repsStock: 8, reorder: 100 },
  { id: "INV007", sampleId: "S13", name: "DELICE SOLUTION 50ML - Trial", brand: "DELICE", unitSize: "50ML", unitsPerPack: 1, coldChain: false, status: "Active", qty: 10, available: 7, repsStock: 4, reorder: 100 },
  { id: "INV008", sampleId: "S36", name: "SORAFINE FOAM - Trial", brand: "SORAFINE", unitSize: "150ML", unitsPerPack: 1, coldChain: false, status: "Active", qty: 10, available: 9, repsStock: 1, reorder: 100 },
  { id: "INV009", sampleId: "S41", name: "TRIDERMA CREAM - Trial", brand: "TRIDERMA", unitSize: "30G", unitsPerPack: 1, coldChain: false, status: "Active", qty: 40, available: 0, repsStock: 33, reorder: 100 },
  { id: "INV010", sampleId: "S42", name: "WOUND - EAZ CREAM - Trial", brand: "WOUND", unitSize: "50G", unitsPerPack: 1, coldChain: false, status: "Active", qty: 10, available: 3, repsStock: 8, reorder: 100 }
];

export const initialSampleTransactions = [
  { id: "TX01", datetime: "2026-06-27 13:57:52", type: "Distribution", product: "SUNSCREEN ADVANCED - Trial", qty: -1, change: "—", source: "—", reason: "—", notes: "Distributed 1 samples to Dr. Khaled" },
  { id: "TX02", datetime: "2026-06-27 13:39:10", type: "Distribution", product: "SUNSCREEN ADVANCED - Trial", qty: -1, change: "—", source: "—", reason: "—", notes: "Distributed 1 samples to Dr. Maryam" },
  { id: "TX03", datetime: "2026-06-27 12:47:02", type: "Distribution", product: "SUNSCREEN ADVANCED - Trial", qty: -1, change: "—", source: "—", reason: "—", notes: "Distributed 1 samples to Dr. Omar" },
  { id: "TX04", datetime: "2026-06-27 11:45:29", type: "Distribution", product: "SUNSCREEN ADVANCED - Trial", qty: -1, change: "—", source: "—", reason: "—", notes: "Distributed 1 samples to Dr. Laila" },
  { id: "TX05", datetime: "2026-06-25 20:00:44", type: "Distribution", product: "PHOTOBLOCK GEL - Trial", qty: -1, change: "—", source: "—", reason: "—", notes: "Distributed 1 samples to Dr. Ahmad" },
  { id: "TX06", datetime: "2026-06-24 13:42:52", type: "Allocation", product: "DELICE SOLUTION 50ML - Trial", qty: -1, change: "8 -> 7", source: "Sample Request", reason: "Approved 1 units for rep", notes: "Approved from sample request modal" },
  { id: "TX07", datetime: "2026-06-23 12:14:29", type: "Allocation", product: "TRIDERMA CREAM - Trial", qty: -1, change: "1 -> 0", source: "Sample Request", reason: "Approved 1 units for rep", notes: "Approved from sample request modal" },
  { id: "TX08", datetime: "2026-06-23 12:14:22", type: "Warehouse Receipt", product: "TRIDERMA CREAM - Trial", qty: 41, change: "40 -> 41", source: "—", reason: "—", notes: "Stock added: No reason provided" }
];
