import { describe, it, expect, vi, beforeEach } from "vitest";
import { 
  validateResourceFile, 
  sanitizeFileName, 
  formatFileSize,
  getResourceStoragePath,
  resolveEligibleProductsForPromotionGroup,
  resolveTherapeuticAreaForPromotionGroup,
  mapStorageErrorToUserMessage,
  validateProductCascade,
  validateDates,
  canUserManageResources,
  resolveResourceAuthoringProducts,
  ResourceScope,
  RECOMMENDED_FILE_SIZE_LIMITS,
  APPROVED_FILE_TYPES
  ,commitAcademicResourceCreation
} from "./resourceMaterialService";
import { Role, Product, ProductPromotionGroup } from "../types";

describe("resourceMaterialService - Unit & Business Rule Tests", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("File Validation & Format Support", () => {
    it("accepts valid PDF file within size limits", () => {
      const mockFile = new File(["dummy pdf content"], "acne-brochure.pdf", {
        type: "application/pdf"
      });
      Object.defineProperty(mockFile, "size", { value: 10 * 1024 * 1024 }); // 10 MB

      const res = validateResourceFile(mockFile);
      expect(res.valid).toBe(true);
      expect(res.fileExtension).toBe("pdf");
      expect(res.mimeType).toBe("application/pdf");
      expect(res.fileSizeBytes).toBe(10 * 1024 * 1024);
    });

    it("accepts valid PowerPoint pptx and ppt files", () => {
      const mockFilePptx = new File(["presentation"], "deck.pptx", {
        type: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
      });
      Object.defineProperty(mockFilePptx, "size", { value: 25 * 1024 * 1024 });
      const resPptx = validateResourceFile(mockFilePptx);
      expect(resPptx.valid).toBe(true);
      expect(resPptx.fileExtension).toBe("pptx");

      const mockFilePpt = new File(["presentation"], "old-deck.ppt", {
        type: "application/vnd.ms-powerpoint"
      });
      Object.defineProperty(mockFilePpt, "size", { value: 15 * 1024 * 1024 });
      const resPpt = validateResourceFile(mockFilePpt);
      expect(resPpt.valid).toBe(true);
      expect(resPpt.fileExtension).toBe("ppt");
    });

    it("accepts valid Word doc and docx files", () => {
      const mockFileDocx = new File(["document"], "study.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      });
      Object.defineProperty(mockFileDocx, "size", { value: 5 * 1024 * 1024 });
      const resDocx = validateResourceFile(mockFileDocx);
      expect(resDocx.valid).toBe(true);
      expect(resDocx.fileExtension).toBe("docx");

      const mockFileDoc = new File(["document"], "study.doc", {
        type: "application/msword"
      });
      Object.defineProperty(mockFileDoc, "size", { value: 5 * 1024 * 1024 });
      const resDoc = validateResourceFile(mockFileDoc);
      expect(resDoc.valid).toBe(true);
      expect(resDoc.fileExtension).toBe("doc");
    });

    it("accepts valid image files (jpeg, png, webp)", () => {
      const mockJpg = new File(["img"], "photo.jpg", { type: "image/jpeg" });
      Object.defineProperty(mockJpg, "size", { value: 2 * 1024 * 1024 });
      expect(validateResourceFile(mockJpg).valid).toBe(true);

      const mockPng = new File(["img"], "photo.png", { type: "image/png" });
      Object.defineProperty(mockPng, "size", { value: 2 * 1024 * 1024 });
      expect(validateResourceFile(mockPng).valid).toBe(true);

      const mockWebp = new File(["img"], "photo.webp", { type: "image/webp" });
      Object.defineProperty(mockWebp, "size", { value: 2 * 1024 * 1024 });
      expect(validateResourceFile(mockWebp).valid).toBe(true);
    });

    it("accepts valid video files (mp4, webm)", () => {
      const mockMp4 = new File(["video"], "clip.mp4", { type: "video/mp4" });
      Object.defineProperty(mockMp4, "size", { value: 100 * 1024 * 1024 });
      expect(validateResourceFile(mockMp4).valid).toBe(true);

      const mockWebm = new File(["video"], "clip.webm", { type: "video/webm" });
      Object.defineProperty(mockWebm, "size", { value: 100 * 1024 * 1024 });
      expect(validateResourceFile(mockWebm).valid).toBe(true);
    });

    it("rejects unsupported file formats like executable or zip", () => {
      const mockFile = new File(["exe"], "malware.exe", {
        type: "application/x-msdownload"
      });
      const res = validateResourceFile(mockFile);
      expect(res.valid).toBe(false);
      expect(res.error).toContain("Unsupported file format");
    });

    it("rejects unsupported MIME type", () => {
      const mockFile = new File(["zip"], "archive.zip", {
        type: "application/zip"
      });
      const res = validateResourceFile(mockFile);
      expect(res.valid).toBe(false);
    });

    it("rejects oversized PDF exceeding 50 MB limit", () => {
      const mockFile = new File(["oversized"], "huge-file.pdf", {
        type: "application/pdf"
      });
      Object.defineProperty(mockFile, "size", { value: 60 * 1024 * 1024 }); // 60 MB > 50 MB limit

      const res = validateResourceFile(mockFile);
      expect(res.valid).toBe(false);
      expect(res.error).toContain("exceeds the maximum allowed limit");
    });

    it("rejects extension and MIME mismatch (e.g. extension says pdf but MIME is video/mp4)", () => {
      const mockFile = new File(["video"], "fake-doc.pdf", {
        type: "video/mp4"
      });
      const res = validateResourceFile(mockFile);
      expect(res.valid).toBe(false);
      expect(res.error).toContain("does not match");
    });
  });

  describe("Sanitization & Format Helpers", () => {
    it("sanitizes file names cleanly", () => {
      expect(sanitizeFileName("Acneline Clinical Brochure 2026!.PDF")).toBe(
        "acneline-clinical-brochure-2026-.pdf"
      );
      expect(sanitizeFileName("test_file@v2.0.pptx")).toBe("test_file-v2-0.pptx");
    });

    it("formats file sizes correctly", () => {
      expect(formatFileSize(0)).toBe("0 Bytes");
      expect(formatFileSize(1024)).toBe("1 KB");
      expect(formatFileSize(2.4 * 1024 * 1024)).toBe("2.4 MB");
    });

    it("generates canonical storage path using promotion group ID and resource ID", () => {
      const path = getResourceStoragePath("PG-ACNE", "RES-000123", 1, "acne-brochure.pdf");
      expect(path).toBe("resources/PG-ACNE/RES-000123/v1/acne-brochure.pdf");
    });
  });

  describe("Promotion Group & Product Cascade Validation", () => {
    const sampleProducts: Product[] = [
      { id: "PROD-1", name: "Acne Wash", brand: "Acne", promotionGroupId: "PG-ACNE", isActive: true } as any,
      { id: "PROD-2", name: "Acne Cream", brand: "Acne", promotionGroupId: "PG-ACNE", isActive: true } as any,
      { id: "PROD-3", name: "Cardio Pill", brand: "Cardio", promotionGroupId: "PG-CARDIO", isActive: true } as any,
      { id: "PROD-4", name: "Archived Acne Item", brand: "Acne", promotionGroupId: "PG-ACNE", isActive: false } as any,
    ];

    it("resolves only active products belonging to selected Promotion Group", () => {
      const eligible = resolveEligibleProductsForPromotionGroup("PG-ACNE", sampleProducts);
      expect(eligible).toHaveLength(2);
      expect(eligible.map(p => p.id)).toEqual(["PROD-1", "PROD-2"]);
    });

    it("validates product cascade correctly and catches cross-group product mismatches", () => {
      const validCheck = validateProductCascade("PG-ACNE", ["PROD-1", "PROD-2"], sampleProducts);
      expect(validCheck.valid).toBe(true);

      const invalidCheck = validateProductCascade("PG-ACNE", ["PROD-1", "PROD-3"], sampleProducts);
      expect(invalidCheck.valid).toBe(false);
      expect(invalidCheck.invalidProductIds).toEqual(["PROD-3"]);
    });
  });

  describe("Effective & Expiry Date Validation", () => {
    it("validates that expiry date must be later than or equal to effective date", () => {
      expect(validateDates("2026-01-01", "2026-12-31").valid).toBe(true);
      expect(validateDates("2026-01-01", "2026-01-01").valid).toBe(true);

      const invalid = validateDates("2026-12-31", "2026-01-01");
      expect(invalid.valid).toBe(false);
      expect(invalid.error).toContain("Expiry date must be later");
    });
  });

  describe("Therapeutic Area Auto-Resolution Hierarchy", () => {
    const mockGroups: ProductPromotionGroup[] = [
      { id: "PG-DERMA", name: "Dermatology Care", normalizedName: "DERMATOLOGY CARE", isActive: true, therapeuticArea: "Dermatology" } as any,
      { id: "PG-CARDIO", name: "Cardio Care", normalizedName: "CARDIO CARE", isActive: true } as any
    ];

    const mockProducts: Product[] = [
      { id: "P-DERMA-1", name: "Acne Gel", promotionGroupId: "PG-DERMA", therapeuticArea: "Dermatology", isActive: true } as any,
      { id: "P-CARDIO-1", name: "Heart Care Pill", promotionGroupId: "PG-CARDIO", therapeuticArea: "Cardiology", isActive: true } as any
    ];

    it("resolves exact Therapeutic Area from Promotion Group metadata if present", () => {
      const ta = resolveTherapeuticAreaForPromotionGroup("PG-DERMA", mockGroups, mockProducts);
      expect(ta).toBe("Dermatology");
    });

    it("resolves Therapeutic Area from mapped Product if Promotion Group metadata lacks it", () => {
      const ta = resolveTherapeuticAreaForPromotionGroup("PG-CARDIO", mockGroups, mockProducts);
      expect(ta).toBe("Cardiology");
    });

    it("falls back to 'General Therapeutics' when unresolved", () => {
      const ta = resolveTherapeuticAreaForPromotionGroup("PG-UNKNOWN", mockGroups, []);
      expect(ta).toBe("General Therapeutics");
    });
  });

  describe("Storage Mapped User Messages", () => {
    it("maps unauthorized storage error to clear permission message", () => {
      const msg = mapStorageErrorToUserMessage({ code: "storage/unauthorized" });
      expect(msg).toContain("Permission denied");
    });

    it("maps bucket/404 storage error to storage service unavailable message", () => {
      const msg = mapStorageErrorToUserMessage({ code: "storage/unknown", message: "404 Not Found" });
      expect(msg).toContain("Storage service or bucket unavailable");
    });

    it("maps timeout and network errors cleanly", () => {
      const msg = mapStorageErrorToUserMessage({ message: "RESOURCE_UPLOAD_TIMEOUT" });
      expect(msg).toContain("timed out or interrupted");
    });
  });

  describe("Role Authorization Checks", () => {
    it("allows authorized roles to manage resources", () => {
      expect(canUserManageResources({ role: Role.SUPER_ADMIN } as any, { resourceCapabilities: { manage: true } })).toBe(true);
      expect(canUserManageResources({ role: Role.PRODUCT_MANAGER } as any, { resourceCapabilities: { manage: true } })).toBe(true);
      expect(canUserManageResources({ role: Role.SALES_MARKETING_MANAGER } as any, { resourceCapabilities: { manage: true } })).toBe(true);
    });

    it("denies medical reps and sales reps from managing resources", () => {
      expect(canUserManageResources({ role: Role.MEDICAL_REP } as any, { resourceCapabilities: { manage: false } })).toBe(false);
      expect(canUserManageResources({ role: Role.SALES_REP } as any, {})).toBe(false);
      expect(canUserManageResources({ role: Role.SALES_SUPERVISOR } as any, {})).toBe(false);
    });
  });

  describe("Fix 3A Product Manager authoring catalog", () => {
    const catalog = [
      { id: "A", name: "A", brand: "A", therapeuticArea: "T", price: 1, stock: 1, promotionGroupId: "PG-A", active: true },
      { id: "B", name: "B", brand: "B", therapeuticArea: "T", price: 1, stock: 1, promotionGroupId: "PG-A", active: true },
      { id: "X", name: "X", brand: "X", therapeuticArea: "T", price: 1, stock: 1, promotionGroupId: "PG-X", active: false },
    ] as any;
    const assignment = (productId: string, extra: Record<string, unknown> = {}) => ({ userId: "PM", productId, productGroupId: "PG-A", assignmentId: `PA-${productId}`, status: "Active", active: true, ...extra }) as any;

    it("offers a Product Manager only active, effective, canonically assigned Products", () => {
      expect(resolveResourceAuthoringProducts({ currentUser: { id: "PM", role: Role.PRODUCT_MANAGER } as any, products: catalog, assignments: [assignment("A"), assignment("B", { effectiveFrom: "2026-08-29" }), assignment("X")], asOf: new Date("2026-08-28T12:00:00Z") }).map(item => item.id)).toEqual(["A"]);
    });
    it("does not restrict other roles' existing authoring catalog behavior", () => {
      expect(resolveResourceAuthoringProducts({ currentUser: { id: "ADMIN", role: Role.ADMIN } as any, products: catalog, assignments: [] }).map(item => item.id)).toEqual(["A", "B", "X"]);
    });
    it("keeps existing Product cascade validation intact", () => {
      expect(validateProductCascade("PG-A", ["A"], catalog).valid).toBe(true);
      expect(validateProductCascade("PG-A", ["X"], catalog).valid).toBe(false);
    });
  });

  it("compensates only a newly uploaded object when metadata persistence fails", async () => {
    const remove = vi.fn(async () => undefined);
    await expect(commitAcademicResourceCreation({ upload: async () => ({ storagePath: "resources/PG/RES/v1/x.pdf" }), persist: async () => { throw new Error("metadata"); }, removeNewObject: remove })).rejects.toThrow("metadata");
    expect(remove).toHaveBeenCalledWith("resources/PG/RES/v1/x.pdf");
  });

  it("does not attempt cleanup when upload itself fails", async () => {
    const remove = vi.fn(async () => undefined);
    await expect(commitAcademicResourceCreation({ upload: async () => { throw new Error("storage"); }, persist: async () => undefined, removeNewObject: remove })).rejects.toThrow("storage");
    expect(remove).not.toHaveBeenCalled();
  });
});
