import React, { useState, useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  FileText, 
  Download, 
  Search, 
  ArrowLeft, 
  Sparkles, 
  Share2, 
  Check, 
  AlertCircle,
  Plus,
  Edit,
  Trash2,
  X,
  UploadCloud,
  FileCheck2,
  Eye,
  RefreshCw,
  AlertTriangle,
  FileIcon,
  Tag,
  ExternalLink,
  Target
} from "lucide-react";
import { collection, onSnapshot, doc, setDoc, query, where } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { decorateRecord } from "../../lib/firebaseSync";
import { handleFirestoreError, OperationType } from "../../lib/firebaseError";
import { Role, User, Product, AuditLog, ProductPromotionGroup, Permissions, UserProductAssignment } from "../../types";
import { saveAuditLogRecord } from "../../lib/firestoreService";
import PhysicianSpecialtySelector from "../PhysicianSpecialtySelector";
import { useSpecialties } from "../../utils/specialtyService";
import {
  canUserManageResources,
  validateResourceFile,
  sanitizeFileName,
  formatFileSize,
  resolveEligibleProductsForPromotionGroup,
  resolveTherapeuticAreaForPromotionGroup,
  validateProductCascade,
  validateDates,
  ResourceScope,
  CONTROLLED_RESOURCE_CATEGORIES,
  RECOMMENDED_FILE_SIZE_LIMITS,
  APPROVED_FILE_TYPES,
  UploadProgress,
  AcademicResourceMetadata,
  FileValidationResult,
  resolveResourceAuthoringProducts,
  canShowResourceMutationControls
} from "../../lib/resourceMaterialService";
import { mutateAcademicResourceMetadata, uploadAcademicResourceThroughBackend } from "../../lib/resourceUploadClient";
import { downloadResourceBinary, resolveResourceBinary } from "../../lib/resourceBinaryResolver";
import { discoverManagementResources } from "../../lib/resourceReadClient";
import HotspotManagerModal from "../resources/HotspotManagerModal";
import { canManageHotspots } from "../../lib/detailingHotspotService";

export function getDisplayFileSize(res: Partial<AcademicResourceMetadata>): string {
  if (res.fileSizeBytes && res.fileSizeBytes > 0) {
    return formatFileSize(res.fileSizeBytes);
  }
  if (res.size && res.size !== "0 Bytes" && res.size !== "0 B" && res.size !== "Unknown" && res.size !== "N/A") {
    return res.size;
  }
  return "N/A";
}

interface ResourceCenterProps {
  lang: "en" | "ar";
  currentUser: User;
  permissions: Permissions;
  products: Product[];
  productPromotionGroups?: ProductPromotionGroup[];
  onNavigate?: (target: string) => void;
}

export default function ResourceCenter({ 
  lang, 
  currentUser, 
  permissions,
  products = [], 
  productPromotionGroups = [], 
  onNavigate 
}: ResourceCenterProps) {
  const isRtl = lang === "ar";
  const { specialties: allSpecialties } = useSpecialties();

  // Role authorization
  const canManage = useMemo(() => canUserManageResources(currentUser, permissions), [currentUser, permissions]);

  // Main state
  const [resources, setResources] = useState<AcademicResourceMetadata[]>([]);
  const [ownProductAssignments, setOwnProductAssignments] = useState<UserProductAssignment[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");

  // Interaction states
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadedIds, setDownloadedIds] = useState<string[]>([]);
  const [previewResource, setPreviewResource] = useState<AcademicResourceMetadata | null>(null);
  const [hotspotResource, setHotspotResource] = useState<AcademicResourceMetadata | null>(null);
  const [previewObjectUrl, setPreviewObjectUrl] = useState("");
  const [previewMimeType, setPreviewMimeType] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [binaryActionError, setBinaryActionError] = useState("");

  // Modal & Form States
  const [showModal, setShowModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [currentResourceId, setCurrentResourceId] = useState("");
  
  // Metadata Fields
  const [formTitleEn, setFormTitleEn] = useState("");
  const [formTitleAr, setFormTitleAr] = useState("");
  const [formCategory, setFormCategory] = useState<string>("BROCHURE");
  const [formPromotionGroupId, setFormPromotionGroupId] = useState("");
  const [formResourceScope, setFormResourceScope] = useState<ResourceScope>(ResourceScope.PROMOTION_GROUP);
  const [formProductIds, setFormProductIds] = useState<string[]>([]);
  const [formSpecialtyIds, setFormSpecialtyIds] = useState<string[]>([]);
  const [formTherapeuticArea, setFormTherapeuticArea] = useState("");
  const [formLanguage, setFormLanguage] = useState("English");
  const [formFileVersion, setFormFileVersion] = useState(1);
  const [formEffectiveDate, setFormEffectiveDate] = useState("");
  const [formExpiryDate, setFormExpiryDate] = useState("");
  const [formApprovalStatus, setFormApprovalStatus] = useState<any>("PUBLISHED");
  const [formActive, setFormActive] = useState(true);

  // File Upload & Replacement States
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileValidation, setFileValidation] = useState<FileValidationResult | null>(null);
  const [isReplacingFile, setIsReplacingFile] = useState(false);
  const [existingFileDetails, setExistingFileDetails] = useState<{
    fileName: string;
    size: string;
    type: string;
    url?: string;
    storagePath?: string;
    version: number;
    fileSizeBytes?: number;
  } | null>(null);

  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [warningMsg, setWarningMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const refreshAuthorizedResources = async () => {
    const { resources: authorized } = await discoverManagementResources();
    setResources(authorized.map(resource => ({ ...resource, resourceId: resource.resourceId || resource.id, readContext: { purpose: "MANAGEMENT" } } as any)));
  };

  // Trusted backend management discovery; Firestore is not a Resource read boundary.
  useEffect(() => {
    let cancelled = false;
    void discoverManagementResources().then(({ resources }) => {
      if (!cancelled) setResources(resources.map(resource => ({ ...resource, resourceId: resource.resourceId || resource.id, readContext: { purpose: "MANAGEMENT" } } as any)));
    }).catch(err => { if (!cancelled) { console.warn("[ResourceCenter] Authorized discovery failed:", err); setErrorMsg(err instanceof Error ? err.message : "RESOURCE_READ_FAILED"); } });
    return () => { cancelled = true; };
  }, [currentUser.id]);

  useEffect(() => {
    if (currentUser.role !== Role.PRODUCT_MANAGER) {
      setOwnProductAssignments([]);
      return;
    }
    return onSnapshot(
      query(collection(db, "userProductAssignments"), where("userId", "==", currentUser.id)),
      snapshot => setOwnProductAssignments(snapshot.docs.map(item => ({ assignmentId: item.id, ...item.data() } as UserProductAssignment))),
      error => {
        console.warn("[ResourceCenter] Product assignment listener warning:", error);
        setOwnProductAssignments([]);
      },
    );
  }, [currentUser.id, currentUser.role]);

  const authoringProducts = useMemo(() => resolveResourceAuthoringProducts({
    currentUser,
    products,
    assignments: ownProductAssignments,
  }), [currentUser, ownProductAssignments, products]);

  // 2. Active promotion groups list
  const activePromotionGroups = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    
    // Add groups from productPromotionGroups prop
    const manageableGroupIds = currentUser.role === Role.PRODUCT_MANAGER
      ? new Set(authoringProducts.map(product => product.promotionGroupId).filter(Boolean))
      : null;
    productPromotionGroups.forEach((g) => {
      if (g.isActive !== false && (!manageableGroupIds || manageableGroupIds.has(g.id))) {
        map.set(g.id, { id: g.id, name: g.name });
      }
    });

    // Fallback: derive promotion groups from products array if not present
    authoringProducts.forEach((p) => {
      if (p.promotionGroupId && !map.has(p.promotionGroupId)) {
        map.set(p.promotionGroupId, { id: p.promotionGroupId, name: p.brand || p.promotionGroupId });
      }
    });

    // Guarantee default standard groups if empty
    if (map.size === 0 && currentUser.role !== Role.PRODUCT_MANAGER) {
      map.set("PG-ACNE", { id: "PG-ACNE", name: "Acne Line" });
      map.set("PG-CARDIO", { id: "PG-CARDIO", name: "Cardiology Line" });
      map.set("PG-DERMA", { id: "PG-DERMA", name: "Dermatology Line" });
    }

    return Array.from(map.values());
  }, [authoringProducts, currentUser.role, productPromotionGroups]);

  // 3. Eligible products for the selected Promotion Group
  const eligibleProductsForSelectedGroup = useMemo(() => {
    if (!formPromotionGroupId) return [];
    return resolveEligibleProductsForPromotionGroup(formPromotionGroupId, authoringProducts);
  }, [authoringProducts, formPromotionGroupId]);

  // 4. Handle Promotion Group Change & Product Cascade
  const handlePromotionGroupChange = (newGroupId: string) => {
    setFormPromotionGroupId(newGroupId);
    setWarningMsg("");

    // Auto-resolve Therapeutic Area from canonical data
    const autoTa = resolveTherapeuticAreaForPromotionGroup(newGroupId, activePromotionGroups, products);
    setFormTherapeuticArea(autoTa);

    if (!newGroupId) {
      setFormProductIds([]);
      return;
    }

    // Recalculate eligible products
    const eligible = resolveEligibleProductsForPromotionGroup(newGroupId, authoringProducts);
    const eligibleIds = new Set(eligible.map((p) => p.id));

    // Detect previously selected products that are no longer eligible
    const invalidSelections = formProductIds.filter((id) => !eligibleIds.has(id));
    if (invalidSelections.length > 0) {
      const validSelections = formProductIds.filter((id) => eligibleIds.has(id));
      setFormProductIds(validSelections);
      setWarningMsg(
        isRtl
          ? `تم إزالة ${invalidSelections.length} من المستحضرات المحددة لأنها لا تنتمي للمجموعة الترويجية الجديدة.`
          : `${invalidSelections.length} selected Product(s) were removed because they do not belong to the newly selected Promotion Group.`
      );
    }
  };

  // 5. File Selection & Validation
  const handleFileSelect = (file: File | null) => {
    setErrorMsg("");
    setWarningMsg("");

    if (!file) {
      setSelectedFile(null);
      setFileValidation(null);
      return;
    }

    const validation = validateResourceFile(file);
    setSelectedFile(file);
    setFileValidation(validation);

    if (!validation.valid) {
      setErrorMsg(validation.error || "Invalid file selected.");
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  // 6. Audit Logging Helper
  const logAudit = async (action: string, details: string) => {
    const logId = `AL-${Math.floor(1000 + Math.random() * 9000)}`;
    const auditRecord: AuditLog = {
      id: logId,
      timestamp: new Date().toISOString().replace("T", " ").substring(0, 19) + " UTC",
      userId: currentUser?.id || "unknown",
      userName: currentUser?.name || "Anonymous",
      userRole: currentUser?.role,
      action,
      entityType: "AcademicResource",
      entityName: "Academic Resources",
      details
    };

    try {
      await saveAuditLogRecord(auditRecord);
    } catch (e) {
      console.error("Audit log failed:", e);
    }
  };

  // 7. Download Helper
  useEffect(() => {
    let cleanup = () => {};
    let cancelled = false;
    setPreviewObjectUrl("");
    setPreviewMimeType("");
    setPreviewError("");
    setPreviewLoading(Boolean(previewResource));
    if (previewResource) {
      void resolveResourceBinary(previewResource).then(resolved => {
        if (cancelled) {
          resolved.cleanup();
          return;
        }
        cleanup = resolved.cleanup;
        setPreviewObjectUrl(resolved.url);
        setPreviewMimeType(resolved.mimeType);
        setPreviewLoading(false);
      }).catch(error => {
        console.error("Authenticated resource preview failed:", error);
        if (!cancelled) {
          setPreviewError(isRtl ? "تعذر تحميل ملف المورد. تحقق من صلاحية الوصول وحاول مرة أخرى." : "Unable to load this resource file. Check access and try again.");
          setPreviewLoading(false);
        }
      });
    }
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [isRtl, previewResource]);

  const handleDownload = async (res: AcademicResourceMetadata) => {
    setDownloadingId(res.resourceId);
    setBinaryActionError("");
    try {
      await downloadResourceBinary(res);
      setDownloadedIds((prev) => [...prev, res.resourceId]);
      await logAudit("Download", `Downloaded resource: "${res.titleEn}"`);
    } catch (error) {
      console.error("Authenticated resource download failed:", error);
      setBinaryActionError(isRtl ? "فشل تنزيل ملف المورد. لم يتم حفظ نسخة محلية." : "Resource download failed. No local copy was saved.");
    } finally {
      setDownloadingId(null);
    }
  };

  // 8. Open Add Modal
  const openAddModal = () => {
    setIsEditing(false);
    setCurrentResourceId("");
    setFormTitleEn("");
    setFormTitleAr("");
    setFormCategory("BROCHURE");
    const defaultPg = activePromotionGroups[0]?.id || (currentUser.role === Role.PRODUCT_MANAGER ? "" : "PG-ACNE");
    setFormPromotionGroupId(defaultPg);
    setFormResourceScope(currentUser.role === Role.PRODUCT_MANAGER ? ResourceScope.SELECTED_PRODUCTS : ResourceScope.PROMOTION_GROUP);
    setFormProductIds([]);
    setFormSpecialtyIds([]);
    
    // Auto-resolve Therapeutic Area
    const initialTa = resolveTherapeuticAreaForPromotionGroup(defaultPg, activePromotionGroups, products);
    setFormTherapeuticArea(initialTa);

    setFormLanguage("English");
    setFormFileVersion(1);
    setFormEffectiveDate(new Date().toISOString().split("T")[0]);
    setFormExpiryDate("");
    setFormApprovalStatus("PUBLISHED");
    setFormActive(true);

    setSelectedFile(null);
    setFileValidation(null);
    setIsReplacingFile(false);
    setExistingFileDetails(null);
    setUploadProgress(null);
    setIsSubmitting(false);
    setErrorMsg("");
    setWarningMsg("");
    setShowModal(true);
  };

  // 9. Open Edit Modal
  const openEditModal = (res: AcademicResourceMetadata) => {
    setIsEditing(true);
    setCurrentResourceId(res.resourceId || (res as any).id);
    setFormTitleEn(res.titleEn || res.title || "");
    setFormTitleAr(res.titleAr || "");
    setFormCategory(res.category || "BROCHURE");
    const pgId = res.promotionGroupId || activePromotionGroups[0]?.id || "";
    setFormPromotionGroupId(pgId);
    setFormResourceScope(res.resourceScope || ResourceScope.PROMOTION_GROUP);
    setFormProductIds(res.productIds || []);
    setFormSpecialtyIds(res.specialtyIds || []);

    const resolvedTa = res.therapeuticArea || res.therapeuticAreaId || resolveTherapeuticAreaForPromotionGroup(pgId, activePromotionGroups, products);
    setFormTherapeuticArea(resolvedTa);

    setFormLanguage(res.language || "English");
    setFormFileVersion(res.fileVersion || 1);
    setFormEffectiveDate(res.effectiveDate || "");
    setFormExpiryDate(res.expiryDate || "");
    setFormApprovalStatus(res.approvalStatus || "PUBLISHED");
    setFormActive(res.active !== false);

    setSelectedFile(null);
    setFileValidation(null);
    setIsReplacingFile(false);
    setExistingFileDetails({
      fileName: res.fileName || res.sanitizedFileName || res.originalFileName || "File Attached",
      size: getDisplayFileSize(res),
      type: res.mimeType || res.type || "Document",
      storagePath: res.storagePath,
      version: res.fileVersion || 1,
      fileSizeBytes: res.fileSizeBytes || 0
    });

    setUploadProgress(null);
    setIsSubmitting(false);
    setErrorMsg("");
    setWarningMsg("");
    setShowModal(true);
  };

  // 10. Save Resource Submission Flow
  const handleSaveResource = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setWarningMsg("");

    // A. Metadata Validations
    if (!formTitleEn.trim()) {
      setErrorMsg(isRtl ? "يرجى إدخال عنوان المورد الإنجليزي." : "Resource Title (English) is required.");
      return;
    }

    if (!formPromotionGroupId) {
      setErrorMsg(isRtl ? "يرجى اختيار المجموعة الترويجية المرتبطة." : "Linked Promotion Group is required.");
      return;
    }

    if (formResourceScope === ResourceScope.SELECTED_PRODUCTS) {
      if (!formProductIds || formProductIds.length === 0) {
        setErrorMsg(
          isRtl
            ? "يرجى تحديد مستحضر واحد على الأقل عندما يكون نطاق المورد 'مستحضرات محددة'."
            : "At least one Product must be selected when Resource Scope is 'Selected Products'."
        );
        return;
      }
    }

    // Validate Product Cascade
    const cascadeCheck = validateProductCascade(formPromotionGroupId, formProductIds, currentUser.role === Role.PRODUCT_MANAGER ? authoringProducts : products);
    if (!cascadeCheck.valid) {
      setErrorMsg(
        isRtl
          ? "بعض المستحضرات المحددة لا تنتمي إلى المجموعة الترويجية المختارة."
          : "Selected products mismatch: one or more products do not belong to the selected Promotion Group."
      );
      return;
    }

    // Validate Effective and Expiry Dates
    const dateCheck = validateDates(formEffectiveDate, formExpiryDate);
    if (!dateCheck.valid) {
      setErrorMsg(dateCheck.error || "Invalid date range.");
      return;
    }

    // File Requirement Check
    const isFileRequired = !isEditing || isReplacingFile;
    if (isFileRequired) {
      if (!selectedFile) {
        setErrorMsg(isRtl ? "يرجى اختيار ملف لرفعه." : "Please select a file to upload.");
        return;
      }
      if (fileValidation && !fileValidation.valid) {
        setErrorMsg(fileValidation.error || "The selected file is invalid.");
        return;
      }
    }

    setIsSubmitting(true);

    // B. Staged Execution Strategy
    const resId = isEditing ? currentResourceId : `RES-${Math.floor(100000 + Math.random() * 900000)}`;
    const version = isEditing && isReplacingFile ? formFileVersion + 1 : formFileVersion;

    let uploadedStoragePath = "";
    let uploadedFileName = existingFileDetails?.fileName || "unnamed";
    let uploadedFileExtension = "";
    let uploadedMimeType = existingFileDetails?.type || "application/pdf";
    let uploadedFileSizeBytes = 0;

    try {
      // 1. Upload Physical File to Firebase Storage if selected
      if (selectedFile) {
        const validation = validateResourceFile(selectedFile);
        uploadedFileName = sanitizeFileName(selectedFile.name);
        uploadedFileExtension = validation.fileExtension || "";
        uploadedMimeType = validation.mimeType || selectedFile.type;
        uploadedFileSizeBytes = selectedFile.size;
      } else if (existingFileDetails) {
        uploadedStoragePath = existingFileDetails.storagePath || "";
        uploadedFileName = existingFileDetails.fileName;
        uploadedMimeType = existingFileDetails.type;
        uploadedFileSizeBytes = existingFileDetails.fileSizeBytes || 0;
      }

      const finalFileSizeBytes = uploadedFileSizeBytes || selectedFile?.size || existingFileDetails?.fileSizeBytes || 0;

      // 2. Resolve Display Snapshots
      const pgObj = activePromotionGroups.find((g) => g.id === formPromotionGroupId);
      const pgName = pgObj?.name || formPromotionGroupId;

      const selectedProductObjs = products.filter((p) => formProductIds.includes(p.id));
      const productNames = selectedProductObjs.map((p) => p.name);

      const selectedSpecObjs = allSpecialties.filter((s) => formSpecialtyIds.includes(s.id));
      const specialtyNames = selectedSpecObjs.map((s) => s.name);

      // 3. Construct Complete Canonical Document
      const metadataRecord: AcademicResourceMetadata = {
        resourceId: resId,
        titleEn: formTitleEn.trim(),
        titleAr: formTitleAr.trim() || formTitleEn.trim(),
        title: formTitleEn.trim(),
        category: formCategory,
        promotionGroupId: formPromotionGroupId,
        resourceScope: formResourceScope,
        productIds: formProductIds,
        specialtyIds: formSpecialtyIds,
        therapeuticAreaId: formTherapeuticArea,
        therapeuticArea: formTherapeuticArea,
        language: formLanguage,
        fileName: uploadedFileName,
        originalFileName: selectedFile?.name || existingFileDetails?.fileName || uploadedFileName,
        sanitizedFileName: uploadedFileName,
        fileExtension: uploadedFileExtension || uploadedFileName.split(".").pop() || "",
        mimeType: uploadedMimeType,
        fileSizeBytes: finalFileSizeBytes,
        storagePath: uploadedStoragePath,
        fileVersion: version,
        uploadStatus: "COMPLETE",
        approvalStatus: formApprovalStatus,
        active: formActive,
        effectiveDate: formEffectiveDate,
        expiryDate: formExpiryDate,
        uploadedByUid: currentUser?.id || "system",
        uploadedAt: new Date().toISOString(),
        updatedByUid: currentUser?.id || "system",
        updatedAt: new Date().toISOString(),

        // UI Snapshots
        brand: pgName,
        promotionGroupName: pgName,
        productNames,
        specialtyNames,
        size: formatFileSize(finalFileSizeBytes),
        type: APPROVED_FILE_TYPES[uploadedMimeType]?.label || uploadedMimeType,
        isDeleted: false
      };

      // 4. Backend authorization owns new/replacement upload and metadata.
      try {
        if (selectedFile) {
          await uploadAcademicResourceThroughBackend({
            file: selectedFile,
            promotionGroupId: formPromotionGroupId,
            productIds: formProductIds,
            metadata: metadataRecord as unknown as Record<string, unknown>,
            replaceResourceId: isEditing ? resId : undefined,
            onProgress: (prog) => setUploadProgress(prog),
          });
        } else {
          await mutateAcademicResourceMetadata(resId, {
            titleEn: metadataRecord.titleEn, titleAr: metadataRecord.titleAr, title: metadataRecord.title,
            category: metadataRecord.category, resourceScope: metadataRecord.resourceScope, specialtyIds: metadataRecord.specialtyIds,
            therapeuticAreaId: metadataRecord.therapeuticAreaId, therapeuticArea: metadataRecord.therapeuticArea,
            language: metadataRecord.language, approvalStatus: metadataRecord.approvalStatus, active: metadataRecord.active,
            effectiveDate: metadataRecord.effectiveDate, expiryDate: metadataRecord.expiryDate, brand: metadataRecord.brand,
            promotionGroupName: metadataRecord.promotionGroupName, productNames: metadataRecord.productNames,
            specialtyNames: metadataRecord.specialtyNames, size: metadataRecord.size, type: metadataRecord.type, isDeleted: metadataRecord.isDeleted,
          });
        }
      } catch (resourceSaveError) {
        console.error("[ResourceCenter] Resource upload/save failed:", resourceSaveError);
        // Attempt cleanup of orphaned file if new file was uploaded
        throw resourceSaveError;
      }

      // 5. Audit Log & UI Cleanup
      await logAudit(
        isEditing ? (isReplacingFile ? "ReplaceFile" : "Update") : "Create",
        `${isEditing ? "Updated" : "Created"} academic resource "${formTitleEn}" (Version v${version}) under Promotion Group ${pgName}`
      );

      setIsSubmitting(false);
      setShowModal(false);
      await refreshAuthorizedResources();
    } catch (err: any) {
      console.error("[ResourceCenter] Save resource error:", err);
      setIsSubmitting(false);
      setErrorMsg(
        err.message || (isRtl ? "فشل حفظ المورد الأكاديمي." : "Failed to save resource. Please check file and permissions.")
      );
      handleFirestoreError(err, OperationType.WRITE, `academicResources/${resId}`);
    }
  };

  // 11. Handle Deactivate
  const handleDeactivate = async (resId: string, title: string) => {
    if (
      !confirm(
        isRtl
          ? "هل أنت متأكد من إلغاء تفعيل هذا المورد؟ لن يعود متاحاً للمندوبين الميدانيين."
          : "Are you sure you want to deactivate this resource? It will no longer be available to field representatives."
      )
    ) {
      return;
    }

    try {
      await mutateAcademicResourceMetadata(resId, { active: false, uploadStatus: "ARCHIVED" });
      await logAudit("Deactivate", `Deactivated Academic Resource ID ${resId}: "${title}"`);
      await refreshAuthorizedResources();
    } catch (e) {
      console.error(e);
      handleFirestoreError(e, OperationType.WRITE, `academicResources/${resId}`);
    }
  };

  // 12. Filtering for display
  const filteredResources = useMemo(() => {
    return resources.filter((res) => {
      // Reps can only see published, active, completed uploads
      if (!canManage) {
        if (!res.active || res.uploadStatus !== "COMPLETE") return false;
        if (res.expiryDate) {
          const now = new Date().toISOString().split("T")[0];
          if (res.expiryDate < now) return false;
        }
      }

      const matchesSearch =
        !searchTerm ||
        (res.titleEn && res.titleEn.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (res.titleAr && res.titleAr.includes(searchTerm)) ||
        (res.promotionGroupName && res.promotionGroupName.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (res.fileName && res.fileName.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchesCategory = selectedCategory === "All" || res.category === selectedCategory;

      return matchesSearch && matchesCategory;
    });
  }, [resources, searchTerm, selectedCategory, canManage]);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -15 }}
      transition={{ duration: 0.3 }}
      className="p-6 max-w-6xl mx-auto space-y-6" 
      dir={isRtl ? "rtl" : "ltr"}
    >
      {/* Header Bar */}
      <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => onNavigate && onNavigate("products-list")}
            className="p-2 rounded-xl border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer text-slate-500"
          >
            <ArrowLeft size={16} className={isRtl ? "rotate-180" : ""} />
          </button>
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              {isRtl ? "مركز المصادر والمطويات الأكاديمي" : "Academic Resource Center & Brochures"}
            </h2>
            <p className="text-xxs text-slate-400">
              {isRtl 
                ? "الأبحاث السريرية المعتمدة والمواد الإعلانية ومجموعات الدعاية الرقمية المعتمدة للميدان" 
                : "Scientific studies, approved brochures, and digital detailing materials with canonical metadata."}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {canManage && (
            <button
              onClick={openAddModal}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-sm transition-colors cursor-pointer"
            >
              <Plus size={14} />
              <span>{isRtl ? "رفع مورد جديد" : "Add Resource Material"}</span>
            </button>
          )}

          <button 
            onClick={() => onNavigate && onNavigate("products-key-messages")}
            className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
          >
            {isRtl ? "تصفح رسائل الدعاية" : "View Key Messages"}
          </button>
        </div>
      </div>

      {/* Sync Banner */}
      <div className="bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 p-4 rounded-2xl flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-100 dark:bg-emerald-950/80 text-emerald-600 rounded-xl">
            <Sparkles size={16} />
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-900 dark:text-white">
              {isRtl ? "المزامنة الرقمية والمستندات المعتمدة" : "Canonical Academic Resources Active"}
            </h4>
            <p className="text-[10px] text-slate-500 max-w-xl">
              {isRtl 
                ? "جميع المواد العلمية مرفوعة وآمنة على Firebase Storage ومرتبطة بالمجموعات الترويجية والتخصصات المعتمدة."
                : "All material binaries are stored securely in Firebase Storage with canonical IDs for promotion groups, products, and specialties."
              }
            </p>
          </div>
        </div>
        <span className="text-[10px] bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 font-bold px-2 py-0.5 rounded-full">
          {isRtl ? "مُزامَن" : "Synced"}
        </span>
      </div>

      {/* Toolbar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-2xl flex flex-col md:flex-row gap-3 items-center justify-between">
        <div className="relative w-full md:w-72">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input 
            type="text" 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={isRtl ? "البحث بالاسم أو المادة العلمية..." : "Search title, filename, or promotion group..."}
            className="w-full text-xs pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-transparent focus:border-indigo-500 bg-transparent"
          />
        </div>

        {/* Category Filters */}
        <div className="flex gap-2 overflow-x-auto w-full md:w-auto pb-1 md:pb-0">
          <button
            onClick={() => setSelectedCategory("All")}
            className={`px-3 py-1.5 rounded-xl text-xxs font-bold transition-all cursor-pointer whitespace-nowrap ${
              selectedCategory === "All" 
                ? "bg-indigo-600 text-white shadow-sm" 
                : "bg-slate-50 dark:bg-slate-800/40 text-slate-500 hover:text-slate-700 border border-transparent"
            }`}
          >
            {isRtl ? "الكل" : "All Categories"}
          </button>
          {CONTROLLED_RESOURCE_CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-xl text-xxs font-bold transition-all cursor-pointer whitespace-nowrap ${
                selectedCategory === cat 
                  ? "bg-indigo-600 text-white shadow-sm" 
                  : "bg-slate-50 dark:bg-slate-800/40 text-slate-500 hover:text-slate-700 border border-transparent"
              }`}
            >
              {cat.replace("_", " ")}
            </button>
          ))}
        </div>
      </div>

      {/* Resources List */}
      <div className="space-y-3">
        {binaryActionError && (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
            {binaryActionError}
          </div>
        )}
        {filteredResources.map((res) => {
          const isDownloading = downloadingId === res.resourceId;
          const isDownloaded = downloadedIds.includes(res.resourceId);

          return (
            <div 
              key={res.resourceId}
              className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-2xl shadow-xxs hover:border-indigo-100 dark:hover:border-indigo-950 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4 group"
            >
              <div className="flex items-start gap-3">
                <div className="p-3 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 rounded-xl mt-1">
                  <FileText size={22} />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400">
                      {res.category}
                    </span>
                    <span className="text-[10px] font-semibold text-slate-400">
                      PG: {res.promotionGroupName || res.promotionGroupId} • Version v{res.fileVersion || 1}
                    </span>
                    {!res.active && (
                      <span className="text-[9px] bg-rose-100 text-rose-700 font-bold px-1.5 py-0.5 rounded">
                        INACTIVE
                      </span>
                    )}
                  </div>
                  <h4 className="text-xs font-bold text-slate-800 dark:text-white">
                    {isRtl ? res.titleAr : res.titleEn || res.title}
                  </h4>
                  
                  {/* File Metadata Badges */}
                  <div className="flex items-center gap-3 text-xxs text-slate-400 font-mono flex-wrap">
                    <span>File: {res.fileName || res.sanitizedFileName}</span>
                    <span>• Size: {getDisplayFileSize(res)}</span>
                    <span>• Type: {res.mimeType || res.type}</span>
                  </div>

                  {/* Linked Products and Specialties */}
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {res.resourceScope === ResourceScope.PROMOTION_GROUP ? (
                      <span className="text-[9px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold px-2 py-0.5 rounded-md">
                        Scope: All Products in PG
                      </span>
                    ) : (
                      (res.productNames || []).map((pName, idx) => (
                        <span key={idx} className="text-[9px] bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-semibold px-2 py-0.5 rounded-md flex items-center gap-1">
                          <Tag size={10} />
                          {pName}
                        </span>
                      ))
                    )}

                    {(res.specialtyNames || []).map((sName, idx) => (
                      <span key={idx} className="text-[9px] bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-semibold px-2 py-0.5 rounded-md">
                        {sName}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Action Controls */}
              <div className="flex items-center gap-2 sm:self-center self-end">
                {res.resourceId && (
                  <button
                    onClick={() => setPreviewResource(res)}
                    className="p-1.5 text-slate-400 hover:text-indigo-600 cursor-pointer rounded-lg border border-transparent hover:border-slate-100 dark:hover:border-slate-800"
                    title={isRtl ? "معاينة" : "Preview Material"}
                  >
                    <Eye size={15} />
                  </button>
                )}

                {canShowResourceMutationControls(currentUser.role, res.resourceScope, canManage) && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => openEditModal(res)}
                      className="p-1.5 text-slate-400 hover:text-indigo-600 cursor-pointer rounded-lg border border-transparent hover:border-slate-100 dark:hover:border-slate-800"
                      title={isRtl ? "تعديل" : "Edit / Replace File"}
                    >
                      <Edit size={14} />
                    </button>
                    {canManageHotspots(currentUser.role) && !String(res.mimeType || res.type || "").startsWith("video/") && (
                      <button type="button" onClick={() => setHotspotResource(res)} className="rounded-lg p-1.5 text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/30" title={isRtl ? "إدارة النقاط التفاعلية" : "Manage hotspots"}><Target size={14} /></button>
                    )}
                    {res.active && (
                      <button
                        onClick={() => handleDeactivate(res.resourceId, res.titleEn)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 cursor-pointer rounded-lg border border-transparent hover:border-slate-100 dark:hover:border-slate-800"
                        title={isRtl ? "إلغاء التفعيل" : "Deactivate Resource"}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                )}

                {canManage && currentUser.role === Role.PRODUCT_MANAGER && res.resourceScope === ResourceScope.PROMOTION_GROUP && (
                  <span className="max-w-48 text-[9px] leading-tight text-amber-600 dark:text-amber-400" title="Group-wide mutation requires explicit Promotion Group ownership">
                    {isRtl ? "تتطلب إدارة المورد الشامل ملكية صريحة لمجموعة الترويج" : "Group-wide management requires explicit Promotion Group ownership"}
                  </span>
                )}

                {isDownloaded ? (
                  <span className="px-3 py-1.5 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 text-xxs font-bold rounded-lg inline-flex items-center gap-1">
                    <Check size={12} />
                    <span>{isRtl ? "جاهز للميدان" : "Offline Ready"}</span>
                  </span>
                ) : (
                  <button 
                    onClick={() => handleDownload(res)}
                    disabled={isDownloading}
                    className="px-3 py-1.5 border border-indigo-100 dark:border-indigo-950 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 text-xxs font-bold text-indigo-600 dark:text-indigo-400 rounded-lg inline-flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50"
                  >
                    {isDownloading ? (
                      <>
                        <div className="h-3 w-3 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                        <span>{isRtl ? "جاري التنزيل..." : "Syncing..."}</span>
                      </>
                    ) : (
                      <>
                        <Download size={12} />
                        <span>{isRtl ? "تنزيل" : "Download"}</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {filteredResources.length === 0 && (
          <div className="py-12 px-6 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-3xl bg-slate-50/50 dark:bg-slate-900/50 space-y-3">
            <div className="p-3 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-500 rounded-2xl w-fit mx-auto">
              <FileText size={28} />
            </div>
            {resources.length === 0 ? (
              <div className="space-y-1 max-w-md mx-auto">
                <h4 className="font-bold text-sm text-slate-800 dark:text-white">
                  {isRtl ? "لم يتم رفع أي موارد علمية حتى الآن." : "No academic resources have been uploaded yet."}
                </h4>
                <p className="text-xs text-slate-400">
                  {isRtl 
                    ? "تظهر هنا المواد السريرية والمطويات المعتمدة فور رفعها من قبل مدراء المنتجات." 
                    : "Approved clinical studies, brochures, and visual aids will appear here once uploaded."}
                </p>
                {canManage && (
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={openAddModal}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-sm transition-colors cursor-pointer inline-flex items-center gap-1.5"
                    >
                      <Plus size={14} />
                      <span>{isRtl ? "قم برفع المورد الأول" : "Upload the first resource"}</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-1">
                <h4 className="font-bold text-sm text-slate-800 dark:text-white">
                  {isRtl ? "لا توجد نتائج مطابقة" : "No Matching Resources"}
                </h4>
                <p className="text-xs text-slate-400">
                  {isRtl ? "لا توجد مواد علمية معتمدة تطابق هذا البحث." : "No academic resource materials match your current criteria."}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* CREATE / EDIT MODAL */}
      <AnimatePresence>
        {showModal && (
          <div className="fixed inset-0 bg-slate-900/60 dark:bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800 max-w-2xl w-full p-6 shadow-xl space-y-4 my-8"
            >
              <div className="flex items-center justify-between border-b pb-3">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  {isEditing 
                    ? (isRtl ? `تعديل المورد الأكاديمي (${currentResourceId})` : `Edit Academic Resource (${currentResourceId})`) 
                    : (isRtl ? "إضافة مورد علمي معتمد" : "Add Academic Resource Material")
                  }
                </h3>
                <button 
                  onClick={() => setShowModal(false)}
                  className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-400 transition-colors"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Warning Banner */}
              {warningMsg && (
                <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 rounded-xl text-xxs flex items-center gap-2">
                  <AlertTriangle size={14} className="shrink-0" />
                  <span>{warningMsg}</span>
                </div>
              )}

              {/* Error Banner */}
              {errorMsg && (
                <div className="p-3 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 rounded-xl text-xxs flex items-center gap-2">
                  <AlertCircle size={14} className="shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <form onSubmit={handleSaveResource} className="space-y-4 text-xs max-h-[75vh] overflow-y-auto pr-1">
                {/* Title Section */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                      {isRtl ? "عنوان المورد الإنجليزي *" : "Resource Title (English) *"}
                    </label>
                    <input
                      type="text"
                      value={formTitleEn}
                      onChange={(e) => setFormTitleEn(e.target.value)}
                      placeholder="e.g. Acneline Clinical Study 2026"
                      className="w-full bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 font-medium"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                      {isRtl ? "عنوان المورد بالعربية" : "Resource Title (Arabic)"}
                    </label>
                    <input
                      type="text"
                      value={formTitleAr}
                      onChange={(e) => setFormTitleAr(e.target.value)}
                      dir="rtl"
                      placeholder="مثال: الدراسة السريرية لمطوية أكنيلين"
                      className="w-full bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 font-medium"
                    />
                  </div>
                </div>

                {/* Category & Linked Promotion Group */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                      {isRtl ? "الفئة التصنيفية *" : "Category *"}
                    </label>
                    <select
                      value={formCategory}
                      onChange={(e) => setFormCategory(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 font-semibold text-slate-700 dark:text-slate-300"
                    >
                      {CONTROLLED_RESOURCE_CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat.replace("_", " ")}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                      {isRtl ? "المجموعة الترويجية المرتبطة *" : "Linked Promotion Group *"}
                    </label>
                    <select
                      value={formPromotionGroupId}
                      onChange={(e) => handlePromotionGroupChange(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 font-semibold text-slate-700 dark:text-slate-300"
                    >
                      <option value="">{isRtl ? "-- اختر المجموعة الترويجية --" : "-- Select Promotion Group --"}</option>
                      {activePromotionGroups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name} ({g.id})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Resource Scope Selection */}
                <div className="space-y-2 p-3 bg-slate-50/70 dark:bg-slate-850/70 rounded-2xl border border-slate-100 dark:border-slate-800">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase">
                    {isRtl ? "نطاق المورد *" : "Resource Scope *"}
                  </label>
                  <div className="flex gap-4 items-center">
                    <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                      <input
                        type="radio"
                        name="resourceScope"
                        value={ResourceScope.PROMOTION_GROUP}
                        disabled={currentUser.role === Role.PRODUCT_MANAGER}
                        checked={formResourceScope === ResourceScope.PROMOTION_GROUP}
                        onChange={() => {
                          setFormResourceScope(ResourceScope.PROMOTION_GROUP);
                          setFormProductIds([]);
                          setWarningMsg("");
                        }}
                        className="text-indigo-600 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                      />
                      <span>{isRtl ? "جميع مستحضرات المجموعة الترويجية" : "All Products in Promotion Group"}</span>
                    </label>

                    <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                      <input
                        type="radio"
                        name="resourceScope"
                        value={ResourceScope.SELECTED_PRODUCTS}
                        checked={formResourceScope === ResourceScope.SELECTED_PRODUCTS}
                        onChange={() => setFormResourceScope(ResourceScope.SELECTED_PRODUCTS)}
                        className="text-indigo-600 focus:ring-indigo-500"
                      />
                      <span>{isRtl ? "مستحضرات محددة فقط" : "Selected Products Only"}</span>
                    </label>
                  </div>
                  {currentUser.role === Role.PRODUCT_MANAGER && (
                    <p className="text-xxs font-semibold text-amber-600 dark:text-amber-400">
                      {isRtl
                        ? "يتطلب النطاق الكامل للمجموعة ملكية صريحة للمجموعة الترويجية، وهي غير متاحة حالياً. استخدم نطاق المستحضرات المحددة."
                        : "Group-wide authoring requires explicit Promotion Group ownership, which is not available yet. Use Selected Products Only."}
                    </p>
                  )}

                  {/* Multi-Select Products when Resource Scope = SELECTED_PRODUCTS */}
                  {formResourceScope === ResourceScope.SELECTED_PRODUCTS && (
                    <div className="pt-2">
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                        {isRtl ? "المستحضرات المرتبطة (تحديد متعدد) *" : "Linked Products (Multi-Select) *"}
                      </label>
                      {eligibleProductsForSelectedGroup.length === 0 ? (
                        <p className="text-xxs text-amber-600 font-semibold p-2 bg-amber-50 dark:bg-amber-950/30 rounded-xl">
                          {isRtl 
                            ? "لا تتوفر مستحضرات نشطة في المجموعة الترويجية المحددة." 
                            : "No active Products are available for the selected Promotion Group."}
                        </p>
                      ) : (
                        <div className="max-h-36 overflow-y-auto space-y-1.5 p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
                          {eligibleProductsForSelectedGroup.map((prod) => {
                            const isChecked = formProductIds.includes(prod.id);
                            return (
                              <label
                                key={prod.id}
                                className={`flex items-center justify-between p-2 rounded-lg text-xs cursor-pointer transition-colors ${
                                  isChecked
                                    ? "bg-indigo-50/70 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-bold"
                                    : "hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setFormProductIds((prev) => [...prev, prod.id]);
                                      } else {
                                        setFormProductIds((prev) => prev.filter((id) => id !== prod.id));
                                      }
                                    }}
                                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                  />
                                  <span>{prod.name}</span>
                                </div>
                                <span className="text-[10px] font-mono text-slate-400">
                                  SKU: {prod.sku || prod.code || prod.id}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Physician Specialties Multi-Select */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                    {isRtl ? "التخصصات الطبية المستهدفة (تحديد متعدد)" : "Target Physician Specialties (Multi-Select)"}
                  </label>
                  <PhysicianSpecialtySelector
                    multiple={true}
                    valueType="id"
                    value={formSpecialtyIds}
                    onChange={(selectedIds: string[]) => setFormSpecialtyIds(selectedIds)}
                    lang={lang}
                    currentUser={currentUser}
                    allowRegistration={canManage}
                    placeholder={isRtl ? "اختر التخصصات الطبية..." : "Select physician specialties..."}
                  />
                </div>

                {/* Therapeutic Area & Language */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                      {isRtl ? "المجال العلاجي (محدد تلقائياً)" : "Therapeutic Area (Auto-Resolved)"}
                    </label>
                    <input
                      type="text"
                      value={formTherapeuticArea || "General Therapeutics"}
                      readOnly
                      disabled
                      placeholder="General Therapeutics"
                      className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 font-semibold text-slate-600 dark:text-slate-400 cursor-not-allowed"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                      {isRtl ? "اللغة" : "Language"}
                    </label>
                    <select
                      value={formLanguage}
                      onChange={(e) => setFormLanguage(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 font-semibold text-slate-700 dark:text-slate-300"
                    >
                      <option value="English">English</option>
                      <option value="Arabic">Arabic</option>
                      <option value="Bilingual">Bilingual (EN / AR)</option>
                    </select>
                  </div>
                </div>

                {/* Effective & Expiry Dates */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                      {isRtl ? "تاريخ السريان" : "Effective Date"}
                    </label>
                    <input
                      type="date"
                      value={formEffectiveDate}
                      onChange={(e) => setFormEffectiveDate(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 font-medium"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                      {isRtl ? "تاريخ الانتهاء" : "Expiry Date"}
                    </label>
                    <input
                      type="date"
                      value={formExpiryDate}
                      onChange={(e) => setFormExpiryDate(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 font-medium"
                    />
                  </div>
                </div>

                {/* UPLOAD MATERIAL SECTION */}
                <div className="p-4 bg-indigo-50/40 dark:bg-indigo-950/20 rounded-2xl border border-indigo-100 dark:border-indigo-900/50 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-indigo-950 dark:text-indigo-200 flex items-center gap-1.5">
                      <UploadCloud size={16} />
                      <span>{isRtl ? "رفع المادة العلمية *" : "Upload Material *"}</span>
                    </h4>

                    {isEditing && !isReplacingFile && (
                      <button
                        type="button"
                        onClick={() => setIsReplacingFile(true)}
                        className="text-xxs font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <RefreshCw size={12} />
                        <span>{isRtl ? "استبدال الملف وإصدار نسخة جديدة" : "Replace File & Increment Version"}</span>
                      </button>
                    )}
                  </div>

                  {/* Display existing file details if editing and not replacing */}
                  {isEditing && !isReplacingFile && existingFileDetails && (
                    <div className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FileCheck2 size={20} className="text-emerald-600" />
                        <div>
                          <p className="text-xs font-bold text-slate-800 dark:text-white">
                            {existingFileDetails.fileName}
                          </p>
                          <p className="text-[10px] text-slate-400">
                            Version v{existingFileDetails.version} • Size: {existingFileDetails.size} • Type: {existingFileDetails.type}
                          </p>
                        </div>
                      </div>
                      <span className="text-[10px] bg-emerald-50 text-emerald-700 font-bold px-2 py-0.5 rounded-full">
                        Existing File Preserved
                      </span>
                    </div>
                  )}

                  {/* Dropzone & File Selection Controls */}
                  {(!isEditing || isReplacingFile) && (
                    <div className="space-y-3">
                      {/* Limits hint */}
                      <p className="text-[10px] text-slate-500 font-mono">
                        Limits: PDF ≤50MB | PPTX ≤75MB | Word ≤30MB | Image ≤15MB | Video ≤250MB
                      </p>

                      <div
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                        className={`border-2 border-dashed rounded-2xl p-4 text-center transition-all cursor-pointer ${
                          isDragOver
                            ? "border-indigo-600 bg-indigo-100/50 dark:bg-indigo-950/60"
                            : "border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 hover:border-indigo-400"
                        }`}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <input
                          ref={fileInputRef}
                          type="file"
                          className="hidden"
                          accept=".pdf,.ppt,.pptx,.doc,.docx,.jpg,.jpeg,.png,.webp,.mp4,.webm"
                          onChange={(e) => {
                            if (e.target.files && e.target.files[0]) {
                              handleFileSelect(e.target.files[0]);
                            }
                          }}
                        />

                        <UploadCloud size={28} className="mx-auto text-indigo-500 mb-1" />
                        <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
                          {isRtl ? "اسحب الملف هنا أو انقر للتصفح" : "Drag & drop file here or click to browse"}
                        </p>
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          PDF, PPTX, DOCX, JPEG, PNG, WEBP, MP4, WEBM
                        </p>
                      </div>

                      {/* Read-Only Detected File Details */}
                      {selectedFile && fileValidation && fileValidation.valid && (
                        <div className="p-3 bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-900 rounded-xl space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <FileCheck2 size={18} className="text-emerald-600" />
                              <div>
                                <p className="text-xs font-bold text-slate-800 dark:text-white">
                                  {selectedFile.name}
                                </p>
                                <p className="text-[10px] text-slate-500 font-mono">
                                  Detected Type: {fileValidation.mimeType} • Size: {fileValidation.formattedSize}
                                </p>
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => {
                                setSelectedFile(null);
                                setFileValidation(null);
                              }}
                              className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-400 hover:text-rose-600"
                              title={isRtl ? "إزالة الملف" : "Remove file"}
                            >
                              <X size={14} />
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Upload Progress Display */}
                      {uploadProgress && (
                        <div className="p-3 bg-white dark:bg-slate-900 border border-indigo-100 dark:border-indigo-900 rounded-xl space-y-1.5">
                          <div className="flex justify-between text-[10px] font-mono font-bold text-slate-600 dark:text-slate-300">
                            <span>Status: {uploadProgress.status}</span>
                            <span>{uploadProgress.percentage}% ({formatFileSize(uploadProgress.bytesTransferred)} / {formatFileSize(uploadProgress.totalBytes)})</span>
                          </div>
                          <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2 overflow-hidden">
                            <div 
                              className="bg-indigo-600 h-full transition-all duration-300" 
                              style={{ width: `${uploadProgress.percentage}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Form Buttons */}
                <div className="flex gap-2 justify-end pt-3 border-t">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    disabled={isSubmitting}
                    className="px-4 py-2 border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl font-bold text-slate-500 cursor-pointer disabled:opacity-50"
                  >
                    {isRtl ? "إلغاء" : "Cancel"}
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting || (fileValidation !== null && !fileValidation.valid)}
                    className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-sm cursor-pointer disabled:opacity-50 flex items-center gap-2"
                  >
                    {isSubmitting ? (
                      <>
                        <div className="h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span>{isRtl ? "جاري الحفظ..." : "Uploading & Saving..."}</span>
                      </>
                    ) : (
                      <span>{isRtl ? "حفظ المورد" : "Save Resource"}</span>
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {hotspotResource && <HotspotManagerModal resource={hotspotResource} onClose={() => setHotspotResource(null)} />}

      {/* PREVIEW MODAL */}
      <AnimatePresence>
        {previewResource && (
          <div className="fixed inset-0 bg-slate-900/70 dark:bg-slate-950/90 backdrop-blur-xs flex items-center justify-center p-4 z-50">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800 max-w-4xl w-full p-6 shadow-2xl space-y-4"
            >
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    {previewResource.titleEn || previewResource.title}
                  </h3>
                  <p className="text-xxs text-slate-400 font-mono">
                    Category: {previewResource.category} • File: {previewResource.fileName} • Size: {getDisplayFileSize(previewResource)} • v{previewResource.fileVersion || 1}
                  </p>
                </div>
                <button
                  onClick={() => setPreviewResource(null)}
                  className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-400 transition-colors"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="h-[520px] w-full bg-slate-950/90 dark:bg-slate-950 rounded-2xl flex items-center justify-center overflow-hidden border border-slate-800">
                {previewLoading ? (
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-300"><div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />Loading material…</div>
                ) : previewError ? (
                  <div role="alert" className="max-w-md px-6 text-center text-sm font-semibold text-rose-300">{previewError}</div>
                ) : previewMimeType.startsWith("image/") ? (
                  <img
                    src={previewObjectUrl}
                    alt={previewResource.titleEn || previewResource.title}
                    className="max-h-full max-w-full object-contain p-2"
                  />
                ) : previewMimeType.startsWith("video/") ? (
                  <video
                    src={previewObjectUrl}
                    controls
                    className="max-h-full max-w-full rounded-xl"
                  />
                ) : previewMimeType === "application/pdf" || (previewResource.fileName && previewResource.fileName.toLowerCase().endsWith(".pdf")) ? (
                  <iframe
                    src={previewObjectUrl}
                    title={previewResource.titleEn || previewResource.title}
                    className="w-full h-full border-0 rounded-xl bg-white"
                  />
                ) : previewObjectUrl ? (
                  <div className="max-w-md space-y-3 px-6 text-center text-slate-300">
                    <FileText size={36} className="mx-auto text-indigo-400" />
                    <p className="text-sm font-bold">Browser preview is not available for this document format.</p>
                    <p className="text-xs text-slate-400">Use the authenticated open or download action below and view the file in a compatible application.</p>
                  </div>
                ) : null}
              </div>

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <span className="text-[10px] text-slate-400 font-mono">
                  {previewMimeType || previewResource.mimeType || "Document"}
                </span>
                <div className="flex items-center gap-2">
                  <a
                    href={previewObjectUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={`px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold flex items-center gap-2 transition-colors ${!previewObjectUrl ? "pointer-events-none opacity-50" : ""}`}
                  >
                    <ExternalLink size={14} />
                    <span>Open in New Tab</span>
                  </a>
                  <button
                    type="button"
                    onClick={() => void handleDownload(previewResource)}
                    disabled={previewLoading || Boolean(previewError)}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 transition-colors"
                  >
                    <Download size={14} />
                    <span>Download File</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
