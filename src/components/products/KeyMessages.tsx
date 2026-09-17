import React, { useState, useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  FileText, 
  MessageSquare, 
  Search, 
  ArrowLeft, 
  BookOpen, 
  Sparkles, 
  Lightbulb,
  CheckCircle,
  HelpCircle,
  Bookmark,
  Download,
  Plus,
  Edit,
  Trash2,
  X,
  TrendingUp,
  BarChart3,
  ThumbsUp,
  Award,
  AlertCircle,
  AlertTriangle
} from "lucide-react";
import { collection, onSnapshot, doc, setDoc, deleteDoc } from "firebase/firestore";
import { auth, db } from "../../lib/firebase";
import { decorateRecord } from "../../lib/firebaseSync";
import { handleFirestoreError, OperationType } from "../../lib/firebaseError";
import { Role, User, Product, KeyMessage, PhysicianSpecialty, AuditLog } from "../../types";
import { saveAuditLogRecord } from "../../lib/firestoreService";
import { useSpecialties } from "../../utils/specialtyService";
import PhysicianSpecialtySelector from "../PhysicianSpecialtySelector";
import { mapRecordForExport, TemplateSchemas } from "../../lib/schemaEngine";
import { getCurrentUserScope, getGlobalUserProductAssignments } from "../../lib/securityEngine";
import { canExerciseProductMarketingAuthority } from "../../lib/productMarketingAuthority";

interface KeyMessagesProps {
  lang: "en" | "ar";
  currentUser: User;
  products: Product[];
  onNavigate?: (target: string) => void;
}

export default function KeyMessages({ lang, currentUser, products, onNavigate }: KeyMessagesProps) {
  const isRtl = lang === "ar";

  const mutateKeyMessage = async (operation: "UPSERT" | "SOFT_DELETE", messageId: string, payload?: Record<string, unknown>) => {
    if (!auth.currentUser || auth.currentUser.uid !== currentUser.id) throw new Error("AUTHENTICATED_KEY_MESSAGE_ACTOR_REQUIRED");
    const token = await auth.currentUser.getIdToken();
    const response = await fetch("/api/key-messages/mutate", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ operation, messageId, payload }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.success !== true) throw new Error(result.code || "KEY_MESSAGE_MUTATION_FAILED");
  };

  // Check if current user has management permissions (Marketing, Admin, etc.)
  const canManage = useMemo(() => {
    return canExerciseProductMarketingAuthority("MANAGE_KEY_MESSAGES", { user: currentUser });
  }, [currentUser]);

  // Check if current user is authorized to register a new specialty
  const canRegisterSpecialty = useMemo(() => {
    if (!currentUser) return false;
    const r = currentUser.role;
    return (
      r === Role.SUPER_ADMIN ||
      r === Role.ADMIN ||
      r === Role.MEDICAL_MANAGER ||
      r === Role.PRODUCT_MANAGER
    );
  }, [currentUser]);

  // Initial Seed Messages (fallback / defaults)
  const defaultMessages = [
    {
      id: "MSG-101",
      brandId: "atorva",
      brandName: "Atorva",
      therapeuticArea: "Vascular & Cardiology",
      message: "Atorva 20mg delivers a robust 37% to 60% LDL-C reduction within 6 weeks, securing a 92.4% compliance rate in randomized cardiovascular trials.",
      messageAr: "يحقق آتورفا 20 ملغ انخفاضاً قوياً في الكوليسترول الضار (LDL-C) بنسبة 37% إلى 60% خلال 6 أسابيع، مع نسبة التزام تبلغ 92.4% في تجارب القلب والأوعية الدموية العشوائية.",
      objectionTarget: "Patient compliance Concerns",
      objectionTargetAr: "مخاوف التزام المريض بالجرعات",
      productSku: "PROD-002",
      keyFocus: "Primary",
      detailingSequence: 1
    },
    {
      id: "MSG-102",
      brandId: "dermasol",
      brandName: "DermaSol",
      therapeuticArea: "Dermatology & Cosmeceuticals",
      message: "DermaSol SPF 50+ Fluid blocks 98% of harmful UVB rays using a non-greasy, water-based formulation suitable for hyper-sensitive or acne-prone skin.",
      messageAr: "يحجب ديرماسول SPF 50+ أكثر من 98% من الأشعة فوق البنفسجية الضارة بفضل تركيبته المائية غير الدهنية المناسبة للبشرة شديدة الحساسية والمعرضة لحب الشباب.",
      objectionTarget: "Skin feel / Greasiness",
      objectionTargetAr: "ملمس البشرة / اللزوجة",
      productSku: "PROD-001",
      keyFocus: "Primary",
      detailingSequence: 1
    },
    {
      id: "MSG-103",
      brandId: "ferrokids",
      brandName: "FerroKids",
      therapeuticArea: "Pediatrics & Nutrition",
      message: "FerroKids Drops feature carbonyl iron with high bioavailability, raising pediatric hemoglobin by an average of 1.2 g/dL within 30 days of therapy.",
      messageAr: "تتميز قطرات فيرو كيدز باحتوائها على حديد الكربونيل ذي الامتصاص العالي، مما يرفع هيموغلوبين الأطفال بمعدل 1.2 غ/ديسيلتر خلال 30 يوماً فقط.",
      objectionTarget: "Taste / Teeth staining",
      objectionTargetAr: "الطعم / تصبغ الأسنان",
      productSku: "PROD-003",
      keyFocus: "Primary",
      detailingSequence: 1
    },
    {
      id: "MSG-104",
      brandId: "atorva",
      brandName: "Atorva",
      therapeuticArea: "Vascular & Cardiology",
      message: "Atorva is clinically proven to reduce secondary myocardial infarction risk in high-risk ischemic vascular patients by up to 26% over 12 months.",
      messageAr: "تم إثبات آتورفا سريرياً لتقليل خطر الإصابة باحتشاء عضلة القلب الثانوي لدى مرضى نقص التروية بنسبة تصل إلى 26% على مدار 12 شهراً.",
      objectionTarget: "Post-Infarction Protection",
      objectionTargetAr: "الحماية بعد الاحتشاء",
      productSku: "PROD-002",
      keyFocus: "Secondary",
      detailingSequence: 2
    }
  ];

  const [messages, setMessages] = useState<any[]>([]);
  const [visits, setVisits] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedBrand, setSelectedBrand] = useState("All");

  // Form / Modal State
  const [showModal, setShowModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [currentMessageId, setCurrentMessageId] = useState("");
  const [formGroupId, setFormGroupId] = useState("");
  const [formGroupName, setFormGroupName] = useState("");
  const [formProductId, setFormProductId] = useState("");
  const [formProductName, setFormProductName] = useState("");
  const [formBrandName, setFormBrandName] = useState("");
  const [formTherapeuticArea, setFormTherapeuticArea] = useState("");
  const [formMessageEn, setFormMessageEn] = useState("");
  const [formMessageAr, setFormMessageAr] = useState("");
  const [formObjectionEn, setFormObjectionEn] = useState("");
  const [formObjectionAr, setFormObjectionAr] = useState("");
  const [formProductSku, setFormProductSku] = useState("");
  const [formKeyFocus, setFormKeyFocus] = useState("Primary");
  const [formSequence, setFormSequence] = useState(1);
  const [formPhysicianSpecialty, setFormPhysicianSpecialty] = useState("");
  const [formTargetSpecialtyIds, setFormTargetSpecialtyIds] = useState<string[]>([]);
  const { specialties } = useSpecialties();
  const [showAddSpecialtyInline, setShowAddSpecialtyInline] = useState(false);
  const [newSpecialtyNameEn, setNewSpecialtyNameEn] = useState("");
  const [newSpecialtyNameAr, setNewSpecialtyNameAr] = useState("");
  const [specialtySearchQuery, setSpecialtySearchQuery] = useState("");
  const [isSpecialtyDropdownOpen, setIsSpecialtyDropdownOpen] = useState(false);
  
  const newSpecialtyNameEnRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showAddSpecialtyInline) {
      setTimeout(() => {
        newSpecialtyNameEnRef.current?.focus();
      }, 50);
    }
  }, [showAddSpecialtyInline]);
  const [formResourceId, setFormResourceId] = useState("");
  const [formCampaignId, setFormCampaignId] = useState("");
  const [formIsApproved, setFormIsApproved] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  // 1. Listen for real-time Key Messages
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "keyMessages"), (snapshot) => {
      if (snapshot.empty) {
        // Defaults are presentation-only; canonical Product scope is required
        // before any server-owned Key Message mutation.
      } else {
        const list: any[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          if (!data.isDeleted) {
            list.push({ id: doc.id, ...data });
          }
        });
        list.sort((a, b) => (a.detailingSequence || 999) - (b.detailingSequence || 999));
        setMessages(list);
      }
    }, (err) => {
      console.warn("[KeyMessages] Failed to subscribe to keyMessages:", err);
    });

    return () => unsub();
  }, []);

  // Visit-derived analytics remain empty until supplied by a purpose-specific
  // backend scoped endpoint; this page never scans the visit ledger directly.

  // 3. Compute dynamic product unique brand list
  const uniqueBrands = useMemo(() => {
    const brands = new Set<string>();
    brands.add("All");
    
    // Add from loaded products
    products.forEach(p => {
      if (p.brand) brands.add(p.brand);
    });

    // Fallbacks from messages if products not fully seeded
    messages.forEach(m => {
      if (m.brandName) brands.add(m.brandName);
    });

    return Array.from(brands);
  }, [products, messages]);

  // Compute unique promotion groups from products
  const uniquePromotionGroups = useMemo(() => {
    const groupsMap = new Map<string, string>(); // id -> name
    products.forEach(p => {
      if (p.promotionGroupId && p.promotionGroupName) {
        groupsMap.set(p.promotionGroupId, p.promotionGroupName);
      } else if (p.brand) {
        const id = p.promotionGroupId || p.brand.toLowerCase().replace(/\s+/g, "");
        groupsMap.set(id, p.brand);
      }
    });
    return Array.from(groupsMap.entries()).map(([id, name]) => ({ id, name }));
  }, [products]);

  // Filter products cascading under the currently selected Promotion Group in form
  const cascadingProducts = useMemo(() => {
    if (!formGroupId && !formGroupName) return [];
    return products.filter(p => p.promotionGroupId === formGroupId || p.brand === formGroupName);
  }, [products, formGroupId, formGroupName]);

  const handleGroupIdChange = (groupId: string) => {
    const matchedPg = uniquePromotionGroups.find(g => g.id === groupId);
    const groupName = matchedPg ? matchedPg.name : "";
    setFormGroupId(groupId);
    setFormGroupName(groupName);
    setFormBrandName(groupName); // fallback backward compatibility
    
    // Cascade: Filter products under this promotion group
    const groupProducts = products.filter(p => p.promotionGroupId === groupId || p.brand === groupName);
    const firstProd = groupProducts[0];
    
    setFormProductId(firstProd ? firstProd.id : "");
    setFormProductSku(firstProd ? (firstProd.sku || firstProd.code || firstProd.id) : "");
    setFormProductName(firstProd ? firstProd.name : "");
    if (firstProd) {
      setFormTherapeuticArea(firstProd.therapeuticArea);
    }
  };

  const handleProductChange = (prodIdOrSku: string) => {
    const prod = products.find(p => p.id === prodIdOrSku || (p.sku || p.code || p.id) === prodIdOrSku);
    if (prod) {
      setFormProductId(prod.id);
      setFormProductSku(prod.sku || prod.code || prod.id);
      setFormProductName(prod.name);
      setFormTherapeuticArea(prod.therapeuticArea);
    } else {
      setFormProductId("");
      setFormProductSku(prodIdOrSku);
      setFormProductName("");
    }
  };

  // 4. Compute Reaction Analytics from real physician visit detailing arrays
  const analytics = useMemo(() => {
    let totalDetailings = 0;
    let positive = 0;
    let neutral = 0;
    let skeptical = 0;
    let negative = 0;
    const brandDistribution: Record<string, number> = {};

    visits.forEach(v => {
      if (v.detailing && Array.isArray(v.detailing)) {
        v.detailing.forEach((det: any) => {
          totalDetailings++;
          const rx = det.reaction || "Neutral";
          if (rx === "Positive" || rx === "Positive Response") positive++;
          else if (rx === "Neutral") neutral++;
          else if (rx === "Skeptical") skeptical++;
          else if (rx === "Negative") negative++;

          const brand = det.brandName || "Other";
          brandDistribution[brand] = (brandDistribution[brand] || 0) + 1;
        });
      }
    });

    // Fallback numbers for visual completeness in empty sandbox databases
    if (totalDetailings === 0) {
      return {
        total: 148,
        positive: 96,
        neutral: 32,
        skeptical: 15,
        negative: 5,
        brandDistribution: { Atorva: 78, DermaSol: 42, FerroKids: 28 },
        isSimulated: true
      };
    }

    return {
      total: totalDetailings,
      positive,
      neutral,
      skeptical,
      negative,
      brandDistribution,
      isSimulated: false
    };
  }, [visits]);

  // 5. Audit log helper
  const logAudit = async (action: string, details: string) => {
    const logId = `AL-${Math.floor(1000 + Math.random() * 9000)}`;
    const auditRecord: AuditLog = {
      id: logId,
      timestamp: new Date().toISOString().replace("T", " ").substring(0, 19) + " UTC",
      userId: currentUser?.id || "unknown",
      userName: currentUser?.name || "Anonymous",
      userRole: currentUser?.role,
      action,
      entityType: "KeyMessage",
      entityName: "Key Messages",
      details
    };

    try {
      await saveAuditLogRecord(auditRecord);
    } catch (e) {
      console.error("Audit log failed:", e);
    }
  };

  // Inline specialty creation handler
  const handleAddNewSpecialty = async () => {
    const cleanEn = newSpecialtyNameEn.trim();
    const cleanAr = newSpecialtyNameAr.trim();
    if (!cleanEn) return;

    const upperName = cleanEn.toUpperCase();
    const upperAr = cleanAr.toUpperCase();
    
    // Check duplication (prevent case difference or duplicate alias)
    const exists = specialties.some(s => 
      s.normalizedName === upperName || 
      s.name.toUpperCase() === upperName ||
      (s.aliases && s.aliases.some(a => a.toUpperCase() === upperName)) ||
      (s.nameAr && s.nameAr.toUpperCase() === upperAr) ||
      (cleanAr && s.nameAr && s.nameAr.trim().toUpperCase() === upperAr)
    );
    if (exists) {
      alert(isRtl ? "هذا التخصص موجود بالفعل في السجل!" : "Specialty already exists in the register!");
      return;
    }

    const safeSlug = cleanEn.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/(^_+|_+$)/g, "");
    const newId = "spec_" + (safeSlug || Date.now().toString());
    const newSpec: PhysicianSpecialty = {
      id: newId,
      name: cleanEn,
      nameAr: cleanAr || undefined,
      normalizedName: upperName,
      aliases: [upperName],
      isActive: true,
      createdAt: new Date().toISOString(),
      createdBy: currentUser?.id || "system",
      source: "manual"
    } as any;

    try {
      await setDoc(doc(db, "physicianSpecialties", newId), newSpec);
      // Automatically select it
      setFormTargetSpecialtyIds(prev => [...prev, newId]);
      // Reset inputs
      setNewSpecialtyNameEn("");
      setNewSpecialtyNameAr("");
      setShowAddSpecialtyInline(false);
      logAudit("Create Specialty", `Added new Physician Specialty: ${cleanEn}`);
    } catch (e) {
      console.error("Failed to add specialty:", e);
      alert(isRtl ? "فشل إضافة التخصص" : "Failed to add specialty");
    }
  };

  // 6. Handle Create / Update Save
  const handleSaveMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");

    if (!formProductId && !formProductSku) {
      setErrorMsg(isRtl ? "يرجى اختيار مستحضر ترويجي مستهدف." : "Please select a target Product.");
      return;
    }

    if (!formMessageEn.trim() || !formObjectionEn.trim()) {
      setErrorMsg(isRtl ? "يرجى ملء جميع الحقول الإلزامية الأساسية." : "Please fill in all mandatory core fields.");
      return;
    }

    const msgId = isEditing ? currentMessageId : `MSG-${Math.floor(100 + Math.random() * 900)}`;
    
    // Auto map therapeutic area from products if empty
    let matchedTherapeuticArea = formTherapeuticArea;
    if (!matchedTherapeuticArea && formProductId) {
      const match = products.find(p => p.id === formProductId);
      matchedTherapeuticArea = match?.therapeuticArea || "General Medicine";
    }

    const selectedSpecialtyNames = formTargetSpecialtyIds.map(id => {
      const found = specialties.find(s => s.id === id);
      return found ? found.name : id;
    });

    const payload = {
      id: msgId,
      brandId: formGroupId || formBrandName.toLowerCase().replace(/\s+/g, ""),
      brandName: formGroupName || formBrandName,
      promotionGroupId: formGroupId,
      promotionGroupName: formGroupName,
      productId: formProductId,
      productSku: formProductSku,
      productName: formProductName,
      message: formMessageEn,
      messageAr: formMessageAr,
      therapeuticArea: matchedTherapeuticArea || "General Medicine",
      objectionTarget: formObjectionEn,
      objectionTargetAr: formObjectionAr || formObjectionEn,
      keyFocus: formKeyFocus,
      detailingSequence: Number(formSequence) || 1,
      physicianSpecialty: selectedSpecialtyNames.join(", "),
      targetSpecialtyIds: formTargetSpecialtyIds,
      targetSpecialtyNames: selectedSpecialtyNames,
      resourceId: formResourceId,
      campaignId: formCampaignId,
      isApproved: formIsApproved,
      isDeleted: false,
      updatedAt: new Date().toISOString()
    };

    const decorated = decorateRecord(payload, currentUser?.id || "system", isEditing ? "update" : "create");

    try {
      await mutateKeyMessage("UPSERT", msgId, decorated);
      setShowModal(false);
      logAudit(
        isEditing ? "Update" : "Create",
        `${isEditing ? "Modified" : "Added"} Key Message ID ${msgId} for product ${formProductName}: "${formMessageEn.substring(0, 45)}..."`
      );
    } catch (e) {
      console.error(e);
      setErrorMsg(isRtl ? "فشل حفظ الرسالة في قاعدة البيانات." : "Failed to save the key message to Firestore.");
      handleFirestoreError(e, OperationType.WRITE, `keyMessages/${msgId}`);
    }
  };

  // 7. Handle Delete
  const handleDeleteMessage = async (id: string, brand: string) => {
    if (!confirm(isRtl ? "هل أنت متأكد من حذف هذه الرسالة الترويجية؟" : "Are you sure you want to delete this key message?")) return;

    try {
      await mutateKeyMessage("SOFT_DELETE", id);
      logAudit("Delete", `Deleted Key Message ID ${id} linked to brand ${brand}`);
    } catch (e) {
      console.error(e);
      handleFirestoreError(e, OperationType.WRITE, `keyMessages/${id}`);
    }
  };

  // 8. Open modal for Add
  const openAddModal = () => {
    setIsEditing(false);
    setCurrentMessageId("");

    // Default to the first promotion group if available
    const firstPg = uniquePromotionGroups[0];
    const defaultGroupId = firstPg ? firstPg.id : "";
    const defaultGroupName = firstPg ? firstPg.name : "";
    
    setFormGroupId(defaultGroupId);
    setFormGroupName(defaultGroupName);
    setFormBrandName(defaultGroupName); // fallback backward compatibility
    
    // Filter products belonging to this default group
    const groupProducts = products.filter(p => p.promotionGroupId === defaultGroupId || p.brand === defaultGroupName);
    const firstProd = groupProducts[0];
    
    setFormProductId(firstProd ? firstProd.id : "");
    setFormProductSku(firstProd ? (firstProd.sku || firstProd.code || firstProd.id) : "");
    setFormProductName(firstProd ? firstProd.name : "");

    setFormTherapeuticArea(firstProd ? firstProd.therapeuticArea : "");
    setFormMessageEn("");
    setFormMessageAr("");
    setFormObjectionEn("");
    setFormObjectionAr("");
    setFormKeyFocus("Primary");
    setFormSequence(messages.length + 1);
    setFormPhysicianSpecialty("");
    setFormTargetSpecialtyIds([]);
    setShowAddSpecialtyInline(false);
    setFormResourceId("");
    setFormCampaignId("");
    setFormIsApproved(true);
    setErrorMsg("");
    setShowModal(true);
  };

  // 9. Open modal for Edit
  const openEditModal = (msg: any) => {
    setIsEditing(true);
    setCurrentMessageId(msg.id);

    const matchedGroupId = msg.promotionGroupId || msg.brandId || "";
    const matchedGroupName = msg.promotionGroupName || msg.brandName || "";
    
    setFormGroupId(matchedGroupId);
    setFormGroupName(matchedGroupName);
    setFormBrandName(matchedGroupName); // fallback backward compatibility
    
    setFormProductId(msg.productId || "");
    setFormProductSku(msg.productSku || "");
    
    const prod = products.find(p => p.id === msg.productId || (p.sku || p.code || p.id) === msg.productSku);
    setFormProductName(prod ? prod.name : (msg.productName || ""));

    setFormTherapeuticArea(msg.therapeuticArea || (prod ? prod.therapeuticArea : ""));
    setFormMessageEn(msg.message || "");
    setFormMessageAr(msg.messageAr || "");
    setFormObjectionEn(msg.objectionTarget || "");
    setFormObjectionAr(msg.objectionTargetAr || "");
    setFormKeyFocus(msg.keyFocus || "Primary");
    setFormSequence(msg.detailingSequence || 1);
    setFormPhysicianSpecialty(msg.physicianSpecialty || "");
    setShowAddSpecialtyInline(false);

    // Populate target specialty IDs with legacy support
    const existingIds = msg.targetSpecialtyIds || [];
    if (existingIds.length > 0) {
      setFormTargetSpecialtyIds(existingIds);
    } else if (msg.physicianSpecialty) {
      const splitNames = msg.physicianSpecialty.split(",").map((s: string) => s.trim().toUpperCase());
      const matchedIds: string[] = [];
      splitNames.forEach((sName: string) => {
        const found = specialties.find(spec => 
          spec.normalizedName === sName || 
          spec.name.toUpperCase() === sName || 
          (spec.aliases && spec.aliases.some(a => a.toUpperCase() === sName))
        );
        if (found) {
          matchedIds.push(found.id);
        }
      });
      setFormTargetSpecialtyIds(matchedIds);
    } else {
      setFormTargetSpecialtyIds([]);
    }

    setFormResourceId(msg.resourceId || "");
    setFormCampaignId(msg.campaignId || "");
    setFormIsApproved(msg.isApproved !== false);
    setErrorMsg("");
    setShowModal(true);
  };

  // Apply dynamic security scope to key messages
  const displayMessages = useMemo(() => {
    const scope = getCurrentUserScope(currentUser);
    if (scope.level === "national") return messages;

    // Get assigned product IDs for personal level
    const userProducts = (getGlobalUserProductAssignments() || [])
      .filter((a) => a.userId === scope.userId && a.status === "Active")
      .map((a) => a.productId);

    if (scope.level === "personal" && userProducts.length > 0) {
      // Find products that match assigned product IDs
      const allowedSkus = products
        .filter((p) => userProducts.includes(p.id))
        .map((p) => p.sku || p.id);

      return messages.filter((msg) => {
        // If msg is created by user, allow it
        if (msg.userId === currentUser.id || msg.createdBy === currentUser.id) return true;
        // Otherwise check if productSku is in allowedSkus or brand is allowed
        const msgSku = msg.productSku;
        if (msgSku && allowedSkus.includes(msgSku)) return true;
        
        // Also allow if the brand matches any allowed products
        const msgBrand = msg.brandName?.toLowerCase();
        const allowedBrands = products
          .filter((p) => userProducts.includes(p.id))
          .map((p) => p.brand?.toLowerCase())
          .filter(Boolean);
          
        if (msgBrand && allowedBrands.includes(msgBrand)) return true;

        return false;
      });
    }
    
    return messages;
  }, [messages, currentUser, products]);

  // Compute unaligned legacy messages for Admin Review Panel
  const unlinkedMessages = useMemo(() => {
    return messages.filter(msg => {
      if (!msg.productId && !msg.productSku) return true;
      const found = products.find(p => p.id === msg.productId || (msg.productSku && (p.sku || p.code || p.id) === msg.productSku));
      return !found;
    });
  }, [messages, products]);

  // Filter messages
  const filteredMessages = displayMessages.filter(msg => {
    const matchesSearch = 
      msg.message.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (msg.messageAr && msg.messageAr.includes(searchTerm)) ||
      (msg.objectionTarget && msg.objectionTarget.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (msg.objectionTargetAr && msg.objectionTargetAr.includes(searchTerm));

    const matchesBrand = selectedBrand === "All" || msg.brandName === selectedBrand;

    return matchesSearch && matchesBrand;
  });

  // Filter specialties based on search input
  const filteredSpecialtiesForSelection = useMemo(() => {
    if (!specialtySearchQuery) return specialties;
    const lowerQuery = specialtySearchQuery.toLowerCase();
    return specialties.filter(spec => 
      spec.name.toLowerCase().includes(lowerQuery) || 
      (spec.nameAr && spec.nameAr.toLowerCase().includes(lowerQuery)) ||
      spec.normalizedName.toLowerCase().includes(lowerQuery)
    );
  }, [specialties, specialtySearchQuery]);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -15 }}
      transition={{ duration: 0.3 }}
      className="p-6 max-w-5xl mx-auto space-y-6" 
      dir={isRtl ? "rtl" : "ltr"}
    >
      {/* Header Back Row */}
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
              {isRtl ? "رسائل ومطالبات الترويج العلمي" : "Approved Promotional Key Messages"}
            </h2>
            <p className="text-xxs text-slate-400">
              {isRtl ? "الأدلة والرسائل الترويجية المعتمدة علمياً لمندوبي الدعاية لتفادي مخالفات شروط السلامة" : "Compliant academic claims structured for reps to address specific clinical concerns during doctor visits."}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {canManage && (
            <button
              onClick={openAddModal}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[10px] rounded-xl shadow-sm transition-colors cursor-pointer"
            >
              <Plus size={12} />
              <span>{isRtl ? "إضافة رسالة" : "Add Message"}</span>
            </button>
          )}

          <button
            onClick={() => {
              import("xlsx").then((XLSX) => {
                const headers = TemplateSchemas.keyMessages.filter(f => f.exportable).map(f => f.label);
                const data = [headers];
                
                messages.forEach(msg => {
                  const exportedObj = mapRecordForExport(msg, "keyMessages");
                  const row = headers.map(header => exportedObj[header] || "");
                  data.push(row);
                });
                
                const worksheet = XLSX.utils.aoa_to_sheet(data);
                const workbook = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(workbook, worksheet, "Key Messages");
                XLSX.writeFile(workbook, `key_messages_export_${new Date().toISOString().split("T")[0]}.xlsx`);
              });
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold text-[10px] rounded-xl shadow-xs transition-colors cursor-pointer"
          >
            <Download size={12} />
            <span>{isRtl ? "تصدير Excel" : "Export Excel"}</span>
          </button>
          
          <button 
            onClick={() => onNavigate && onNavigate("products-resource-center")}
            className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
          >
            {isRtl ? "مركز المصادر والمطويات" : "Resource Center & Brochures"}
          </button>
        </div>
      </div>

      {/* DETAILED REACTION ANALYTICS PANEL */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-5 rounded-2xl shadow-xxs flex flex-col justify-between">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[10px] uppercase font-bold tracking-wider">{isRtl ? "إجمالي استخدام الدعاية" : "Total Detailing Usage"}</span>
              <TrendingUp size={14} className="text-emerald-500" />
            </div>
            <div className="flex items-baseline gap-2">
              <h3 className="text-2xl font-extrabold text-slate-900 dark:text-white font-mono">{analytics.total}</h3>
              <span className="text-xxs text-slate-400">{isRtl ? "زيارة مفصلة" : "detailings registered"}</span>
            </div>
            <p className="text-[10px] text-slate-500 leading-relaxed">
              {isRtl 
                ? "يتم تتبع وتحديث استخدام هذه الادعاءات الطبية مع الأطباء فوراً عقب إتمام تقارير الزيارات." 
                : "Aggregated in real-time based on physician detailing statements selected in the planner."
              }
            </p>
          </div>
          {analytics.isSimulated && (
            <span className="text-[9px] text-indigo-500 font-semibold mt-3 bg-indigo-50 dark:bg-indigo-950/40 px-2 py-0.5 rounded-md self-start">
              {isRtl ? "توضيحي (قاعدة البيانات فارغة)" : "Simulated (Sandbox Empty)"}
            </span>
          )}
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-5 rounded-2xl shadow-xxs md:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-slate-800 dark:text-white flex items-center gap-1.5">
              <BarChart3 size={14} className="text-indigo-600" />
              {isRtl ? "تحليل ردود أفعال الأطباء تجاه الرسائل ترويجياً" : "Physician Sentiment & Reaction Distribution"}
            </h4>
            <span className="text-[10px] text-slate-400">
              {isRtl ? "ردود أفعال الزيارات النشطة" : "Active field reports"}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {/* Positive */}
            <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-100 dark:border-slate-900/60 space-y-1">
              <div className="flex items-center justify-between text-emerald-600 dark:text-emerald-400">
                <span className="text-[10px] font-bold">{isRtl ? "إيجابي" : "Positive"}</span>
                <ThumbsUp size={11} />
              </div>
              <p className="text-base font-extrabold font-mono text-slate-900 dark:text-white">
                {analytics.total > 0 ? Math.round((analytics.positive / analytics.total) * 100) : 0}%
              </p>
              <span className="text-[9px] text-slate-400 block">{analytics.positive} {isRtl ? "طبيب" : "docs"}</span>
            </div>

            {/* Neutral */}
            <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-100 dark:border-slate-900/60 space-y-1">
              <div className="flex items-center justify-between text-blue-600 dark:text-blue-400">
                <span className="text-[10px] font-bold">{isRtl ? "محايد" : "Neutral"}</span>
                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full" />
              </div>
              <p className="text-base font-extrabold font-mono text-slate-900 dark:text-white">
                {analytics.total > 0 ? Math.round((analytics.neutral / analytics.total) * 100) : 0}%
              </p>
              <span className="text-[9px] text-slate-400 block">{analytics.neutral} {isRtl ? "طبيب" : "docs"}</span>
            </div>

            {/* Skeptical */}
            <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-100 dark:border-slate-900/60 space-y-1">
              <div className="flex items-center justify-between text-amber-600 dark:text-amber-400">
                <span className="text-[10px] font-bold">{isRtl ? "متشكك" : "Skeptical"}</span>
                <HelpCircle size={11} />
              </div>
              <p className="text-base font-extrabold font-mono text-slate-900 dark:text-white">
                {analytics.total > 0 ? Math.round((analytics.skeptical / analytics.total) * 100) : 0}%
              </p>
              <span className="text-[9px] text-slate-400 block">{analytics.skeptical} {isRtl ? "طبيب" : "docs"}</span>
            </div>

            {/* Negative */}
            <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-100 dark:border-slate-900/60 space-y-1">
              <div className="flex items-center justify-between text-rose-600 dark:text-rose-400">
                <span className="text-[10px] font-bold">{isRtl ? "سلبي" : "Negative"}</span>
                <AlertCircle size={11} />
              </div>
              <p className="text-base font-extrabold font-mono text-slate-900 dark:text-white">
                {analytics.total > 0 ? Math.round((analytics.negative / analytics.total) * 100) : 0}%
              </p>
              <span className="text-[9px] text-slate-400 block">{analytics.negative} {isRtl ? "طبيب" : "docs"}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Objections Interactive Helper */}
      <div className="bg-gradient-to-br from-indigo-50/50 to-indigo-100/10 dark:from-indigo-950/10 dark:to-indigo-950/5 border border-indigo-100/80 dark:border-indigo-900/40 p-5 rounded-2xl space-y-3">
        <div className="flex items-center gap-2 text-indigo-700 dark:text-indigo-400">
          <Sparkles size={16} />
          <h3 className="text-xs font-bold uppercase tracking-wider">
            {isRtl ? "الدليل الترويجي السريع للمندوب الطبي" : "Medical Representative Fast Detailing Assistant"}
          </h3>
        </div>
        <p className="text-xs text-slate-500 leading-relaxed max-w-2xl">
          {isRtl 
            ? "يساعدك هذا الدليل في التغلب الفوري على اعتراضات الأطباء الشائعة حول الكفاءة والالتزام والملمس، بالاعتماد على الدراسات المعتمدة."
            : "Quickly counter common clinical objections using approved statements backed by clinical trials registry."
          }
        </p>
      </div>

      {/* ADMIN MIGRATION & ALIGNMENT CENTER */}
      {canManage && unlinkedMessages.length > 0 && (
        <div className="bg-amber-50/50 dark:bg-amber-950/10 border border-amber-200/80 dark:border-amber-900/30 p-5 rounded-2xl space-y-4">
          <div className="flex items-center gap-2 text-amber-800 dark:text-amber-400">
            <AlertTriangle size={16} />
            <h3 className="text-xs font-bold uppercase tracking-wider">
              {isRtl ? "مركز ترحيل ومعالجة الرسائل القديمة (UAT Stabilization)" : "Legacy Key Message Product Alignment Center"}
            </h3>
            <span className="bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 px-2 py-0.5 rounded-full text-[10px] font-bold">
              {unlinkedMessages.length} {isRtl ? "رسائل معلقة" : "unaligned"}
            </span>
          </div>
          <p className="text-xs text-slate-500 leading-relaxed">
            {isRtl 
              ? "الرسائل التالية تنتمي لمجموعات ترويجية عامة بدون ربط بمستحضر مخصص (SKU). يرجى ربطها فوراً بمستحضر فريد للامتثال لقوانين UAT ومنع التسريب عبر المنصة."
              : "The following key messages belong to general brand groups but are not aligned with a single unique Product. Align them now to ensure correct detailing access control."
            }
          </p>

          <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
            {unlinkedMessages.map((msg) => (
              <div 
                key={msg.id} 
                className="p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 text-xs"
              >
                <div className="space-y-1 max-w-xl">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-slate-500">
                      {msg.id}
                    </span>
                    <span className="text-[10px] font-bold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-1.5 py-0.5 rounded">
                      Group: {msg.promotionGroupName || msg.brandName || "None"}
                    </span>
                  </div>
                  <p className="font-medium text-slate-800 dark:text-slate-200">
                    {msg.message}
                  </p>
                </div>

                <div className="flex items-center gap-2 w-full md:w-auto">
                  <select
                    onChange={async (e) => {
                      const selectedProdId = e.target.value;
                      if (!selectedProdId) return;
                      const selectedProd = products.find(p => p.id === selectedProdId);
                      if (!selectedProd) return;

                      // Map the legacy message to this product!
                      try {
                        const updatedPayload = {
                          ...msg,
                          productId: selectedProd.id,
                          productSku: selectedProd.sku || selectedProd.code || selectedProd.id,
                          productName: selectedProd.name,
                          promotionGroupId: selectedProd.promotionGroupId || msg.promotionGroupId,
                          promotionGroupName: selectedProd.promotionGroupName || msg.promotionGroupName,
                          brandId: selectedProd.promotionGroupId || msg.brandId,
                          brandName: selectedProd.promotionGroupName || msg.brandName,
                          updatedAt: new Date().toISOString()
                        };
                        const decorated = decorateRecord(updatedPayload, currentUser?.id || "system", "update");
                        await mutateKeyMessage("UPSERT", msg.id, decorated);
                        logAudit("Align Message", `Mapped Legacy Message ID ${msg.id} to Product: ${selectedProd.name}`);
                        alert(isRtl ? "تم ربط الرسالة بنجاح!" : "Key message successfully aligned to product!");
                      } catch (err) {
                        console.error("Migration error:", err);
                        alert(isRtl ? "فشل ترحيل الرسالة" : "Failed to align key message");
                      }
                    }}
                    className="bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-lg p-1.5 text-[11px] font-medium text-slate-700 dark:text-slate-300 cursor-pointer w-full md:w-48"
                  >
                    <option value="">-- {isRtl ? "اختر المستحضر لربطه" : "Align to Product"} --</option>
                    {products
                      .filter(p => !msg.promotionGroupId || p.promotionGroupId === msg.promotionGroupId || p.brand === msg.brandName)
                      .map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.sku || p.code || p.id})
                        </option>
                      ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters and search toolbar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-2xl flex flex-col md:flex-row gap-3 items-center justify-between">
        <div className="relative w-full md:w-72">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input 
            type="text" 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={isRtl ? "البحث بالرسالة أو نوع الاعتراض..." : "Search statement or objection..."}
            className="w-full text-xs pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-transparent focus:border-indigo-500 bg-transparent"
          />
        </div>

        <div className="flex gap-2 w-full md:w-auto justify-end overflow-x-auto pb-1 md:pb-0">
          {uniqueBrands.map((brand) => (
            <button
              key={brand}
              onClick={() => setSelectedBrand(brand)}
              className={`px-3 py-1.5 rounded-xl text-xxs font-bold transition-all cursor-pointer whitespace-nowrap ${
                selectedBrand === brand 
                  ? "bg-indigo-600 text-white shadow-sm" 
                  : "bg-slate-50 dark:bg-slate-800/40 text-slate-500 hover:text-slate-700 border border-transparent hover:border-slate-100"
              }`}
            >
              {brand === "All" ? (isRtl ? "جميع المجموعات الترويجية" : "All Promotion Groups") : brand}
            </button>
          ))}
        </div>
      </div>

      {/* Messages Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {filteredMessages.map((msg) => (
          <div 
            key={msg.id}
            className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-5 rounded-2xl shadow-xxs flex flex-col justify-between space-y-4 hover:border-indigo-100 dark:hover:border-indigo-950 transition-all group"
          >
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 font-mono">
                  {msg.id} • {msg.brandName}
                </span>

                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-semibold text-slate-400">
                    {msg.therapeuticArea}
                  </span>
                  
                  {canManage && (
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                      <button
                        onClick={() => openEditModal(msg)}
                        className="p-1 text-slate-400 hover:text-indigo-600 cursor-pointer"
                        title={isRtl ? "تعديل" : "Edit"}
                      >
                        <Edit size={12} />
                      </button>
                      <button
                        onClick={() => handleDeleteMessage(msg.id, msg.brandName)}
                        className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer"
                        title={isRtl ? "حذف" : "Delete"}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* English message box */}
              <div className="space-y-1">
                <span className="text-[9px] text-slate-400 uppercase font-bold block">English Detailing Claim</span>
                <p className="text-xs text-slate-700 dark:text-slate-200 font-sans leading-relaxed">
                  "{msg.message}"
                </p>
              </div>

              {/* Arabic message box */}
              {msg.messageAr && (
                <div className="space-y-1 pt-2 border-t border-slate-50 dark:border-slate-800/40" dir="rtl">
                  <span className="text-[9px] text-slate-400 uppercase font-bold block text-right">الادعاء والترويج الطبي (عربي)</span>
                  <p className="text-xs text-slate-700 dark:text-slate-200 font-sans leading-relaxed text-right">
                    "{msg.messageAr}"
                  </p>
                </div>
              )}

              {/* Extra Metadata (Specialty, Resource, Campaign, Approval) */}
              <div className="space-y-1.5 pt-2 border-t border-slate-50 dark:border-slate-800/40 text-[9px] text-slate-400 uppercase font-semibold flex flex-wrap gap-x-2.5 gap-y-1">
                <span>Seq: {msg.detailingSequence || 1} ({msg.keyFocus || 'Primary'})</span>
                {msg.physicianSpecialty && <span>• Specialty: {msg.physicianSpecialty}</span>}
                {msg.resourceId && <span>• Resource: {msg.resourceId}</span>}
                {msg.campaignId && <span>• Campaign: {msg.campaignId}</span>}
                <span>• Status: 
                  <span className={`ml-1 px-1.5 py-0.5 rounded-full font-bold text-[8px] ${msg.isApproved !== false ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400' : 'bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400'}`}>
                    {msg.isApproved !== false ? 'Approved' : 'Pending'}
                  </span>
                </span>
              </div>
            </div>

            {/* Counter Objection Tag */}
            <div className="pt-3 border-t border-slate-50 dark:border-slate-800/50 flex justify-between items-center text-xs">
              <span className="text-slate-400 flex items-center gap-1">
                <HelpCircle size={12} />
                {isRtl ? "مُستهدف ضد اعتراض:" : "Target Objection:"}
              </span>
              <span className="font-bold text-emerald-600 dark:text-emerald-400">
                {isRtl ? msg.objectionTargetAr : msg.objectionTarget}
              </span>
            </div>
          </div>
        ))}

        {filteredMessages.length === 0 && (
          <div className="col-span-full py-12 text-center text-xs text-slate-400 border border-dashed rounded-2xl">
            {isRtl ? "لا توجد رسائل ترويجية مطابقة للبحث." : "No key messages match your current query."}
          </div>
        )}
      </div>

      {/* CREATE / EDIT DIALOG MODAL */}
      <AnimatePresence>
        {showModal && (
          <div className="fixed inset-0 bg-slate-900/60 dark:bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800 max-w-lg w-full p-6 shadow-xl space-y-4"
            >
              <div className="flex items-center justify-between border-b pb-3">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  {isEditing 
                    ? (isRtl ? "تعديل رسالة ترويجية معتمدة" : `Edit Approved Key Message (${currentMessageId})`) 
                    : (isRtl ? "إضافة رسالة ترويجية معتمدة جديدة" : "Add Compliant Key Message")
                  }
                </h3>
                <button 
                  onClick={() => setShowModal(false)}
                  className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-400 transition-colors"
                >
                  <X size={14} />
                </button>
              </div>

              {errorMsg && (
                <div className="p-3 bg-rose-50 dark:bg-rose-950/20 text-rose-600 rounded-xl text-xxs flex items-center gap-2">
                  <AlertCircle size={14} />
                  <span>{errorMsg}</span>
                </div>
              )}

              <form onSubmit={handleSaveMessage} className="space-y-4 text-xs">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                      {isRtl ? "المجموعة الترويجية *" : "Promotion Group *"}
                    </label>
                    <select
                      value={formGroupId}
                      onChange={(e) => handleGroupIdChange(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 font-semibold text-slate-700 dark:text-slate-300"
                    >
                      <option value="">{isRtl ? "اختر المجموعة الترويجية..." : "Select Promotion Group..."}</option>
                      {uniquePromotionGroups.map(g => (
                        <option key={g.id} value={g.id}>{g.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                      {isRtl ? "التركيز الترويجي" : "Key Focus"}
                    </label>
                    <select
                      value={formKeyFocus}
                      onChange={(e) => setFormKeyFocus(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 font-semibold text-slate-700 dark:text-slate-300"
                    >
                      <option value="Primary">Primary</option>
                      <option value="Secondary">Secondary</option>
                      <option value="Tertiary">Tertiary</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                      {isRtl ? "المستحضر الترويجي المستهدف *" : "Target Product *"}
                    </label>
                    <select
                      value={formProductId || formProductSku}
                      onChange={(e) => handleProductChange(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 font-semibold text-slate-700 dark:text-slate-300"
                      required
                    >
                      <option value="">{isRtl ? "اختر المستحضر..." : "Select Product..."}</option>
                      {cascadingProducts.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.sku || p.code || p.id})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                      {isRtl ? "تسلسل الدعاية" : "Detailing Sequence"}
                    </label>
                    <input
                      type="number"
                      value={formSequence}
                      onChange={(e) => setFormSequence(parseInt(e.target.value) || 1)}
                      min="1"
                      className="w-full bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                    {isRtl ? "التخصص الطبي / المجال العلاجي" : "Therapeutic Area"}
                  </label>
                  <input
                    type="text"
                    value={formTherapeuticArea}
                    onChange={(e) => setFormTherapeuticArea(e.target.value)}
                    placeholder="e.g. Vascular & Cardiology (leave blank to auto-detect)"
                    className="w-full bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5"
                  />
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                      {isRtl ? "المطالبة العلمية بالإنجليزية" : "English Claim *"}
                    </label>
                    <textarea
                      rows={3}
                      value={formMessageEn}
                      onChange={(e) => setFormMessageEn(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 font-sans leading-relaxed"
                      placeholder="Enter the approved scientific claim statement in English..."
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                      {isRtl ? "الادعاء والترويج الطبي بالعربية" : "Arabic Claim (Optional)"}
                    </label>
                    <textarea
                      rows={3}
                      value={formMessageAr}
                      onChange={(e) => setFormMessageAr(e.target.value)}
                      dir="rtl"
                      className="w-full bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 font-sans leading-relaxed"
                      placeholder="أدخل الادعاء الطبي المعتمد باللغة العربية..."
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                      {isRtl ? "الاعتراض المستهدف بالإنجليزية" : "Target Objection (EN) *"}
                    </label>
                    <input
                      type="text"
                      value={formObjectionEn}
                      onChange={(e) => setFormObjectionEn(e.target.value)}
                      placeholder="e.g. Patient compliance Concerns"
                      className="w-full bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                      {isRtl ? "الاعتراض المستهدف بالعربية" : "Target Objection (AR)"}
                    </label>
                    <input
                      type="text"
                      value={formObjectionAr}
                      onChange={(e) => setFormObjectionAr(e.target.value)}
                      dir="rtl"
                      placeholder="مثال: مخاوف التزام المريض بالجرعات"
                      className="w-full bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5"
                    />
                  </div>
                </div>

                <div className="space-y-3 p-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-850/50">
                  <div className="flex justify-between items-center">
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                      {isRtl ? "التخصصات الطبية المستهدفة" : "Target Physician Specialties"}
                    </label>
                  </div>

                  <p className="text-[10px] text-slate-400">
                    {isRtl 
                      ? "المصفوفة الفارغة تعني عدم وجود قيود على التخصص (تنطبق الرسالة على جميع الأطباء)." 
                      : "An empty selection means no specialty restriction (Message applies to all physicians)."}
                  </p>

                  <PhysicianSpecialtySelector
                    multiple={true}
                    value={formTargetSpecialtyIds}
                    valueType="id"
                    onChange={setFormTargetSpecialtyIds}
                    lang={lang}
                    currentUser={currentUser}
                    allowRegistration={true}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                      {isRtl ? "المصدر العلمي المرتبط" : "Linked Resource ID"}
                    </label>
                    <input
                      type="text"
                      value={formResourceId}
                      onChange={(e) => setFormResourceId(e.target.value)}
                      placeholder="e.g. RES-0101"
                      className="w-full bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                      {isRtl ? "الحملة التسويقية المرتبطة" : "Linked Campaign ID"}
                    </label>
                    <input
                      type="text"
                      value={formCampaignId}
                      onChange={(e) => setFormCampaignId(e.target.value)}
                      placeholder="e.g. Q3_Launch_2026"
                      className="w-full bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5"
                    />
                  </div>

                  <div className="flex items-center gap-2 pt-5">
                    <input
                      type="checkbox"
                      id="formIsApproved"
                      checked={formIsApproved}
                      onChange={(e) => setFormIsApproved(e.target.checked)}
                      className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-slate-300 rounded"
                    />
                    <label htmlFor="formIsApproved" className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase cursor-pointer select-none">
                      {isRtl ? "رسالة معتمدة وموافق عليها" : "Approved & Compliant for Visits"}
                    </label>
                  </div>
                </div>

                <div className="flex gap-2 justify-end pt-3 border-t">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="px-4 py-2 border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl font-bold text-slate-500 cursor-pointer"
                  >
                    {isRtl ? "إلغاء" : "Cancel"}
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-sm cursor-pointer"
                  >
                    {isRtl ? "حفظ" : "Save Key Message"}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
