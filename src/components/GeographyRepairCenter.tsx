import React, { useState, useMemo } from "react";
import { 
  Shield, 
  Check, 
  AlertCircle, 
  RotateCcw, 
  Download, 
  Play, 
  Users, 
  MapPin, 
  Activity, 
  FileText, 
  CheckCircle2, 
  Search, 
  Building2,
  AlertTriangle,
  RefreshCw,
  Sliders,
  ChevronRight,
  Database
} from "lucide-react";
import { collection, doc, setDoc, writeBatch, getDocs, addDoc, query, orderBy, limit, deleteDoc } from "firebase/firestore";
import { classifyPhysicianGeography, isCanonical, removeUndefinedRecursively } from "../utils/importNormalization";
import { Role } from "../types";

interface GeographyRepairCenterProps {
  lang: "en" | "ar";
  isRtl: boolean;
  physicians: any[];
  areas: any[];
  usersList: any[];
  territoryAssignments: any[];
  physicianVisitsList: any[];
  onLogAudit: (action: string, entity: string, details: string) => void;
  db: any;
}

export default function GeographyRepairCenter({
  lang,
  isRtl,
  physicians,
  areas,
  usersList,
  territoryAssignments,
  physicianVisitsList,
  onLogAudit,
  db
}: GeographyRepairCenterProps) {
  // Scan States
  const [isScanning, setIsScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [classifiedList, setClassifiedList] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterClass, setFilterClass] = useState<string>("ALL");

  // Migration States
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationProgress, setMigrationProgress] = useState(0);
  const [migrationLogs, setMigrationLogs] = useState<string[]>([]);
  const [migrationHistory, setMigrationHistory] = useState<any[]>([]);

  const addLog = (text: string) => {
    setMigrationLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${text}`]);
  };

  // Rollback States
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [rollbackProgress, setRollbackProgress] = useState(0);

  // Manual Mapping State
  const [manualAreaSelections, setManualAreaSelections] = useState<Record<string, string>>({});
  const [isApplyingManual, setIsApplyingManual] = useState<Record<string, boolean>>({});

  // 1. Core Diagnostic Scan Routine
  const runDiagnosticScan = () => {
    setIsScanning(true);
    setScanned(false);
    
    setTimeout(() => {
      try {
        const results = physicians.map(p => {
          const classification = classifyPhysicianGeography(p, areas);
          const linkedVisits = physicianVisitsList.filter(v => v.physicianId === p.id);
          const linkedSamplesCount = linkedVisits.filter(v => v.samples && v.samples.length > 0).length;

          return {
            id: p.id,
            name: p.name || p.firstName || "Unnamed Physician",
            specialty: p.specialty || "General Medicine",
            original: p,
            classification: classification.classification,
            proposedGeo: classification.proposedGeo,
            fieldsToChange: classification.fieldsToChange || [],
            reason: classification.reason || "",
            assignedRepId: p.assignedRepId || p.representativeId || "",
            managerId: p.managerId || "",
            visitsCount: linkedVisits.length,
            samplesCount: linkedSamplesCount
          };
        });

        setClassifiedList(results);
        setScanned(true);
        onLogAudit("Scan", "physicians", `Executed geography diagnostic scan. Total scanned: ${results.length}`);
      } catch (err: any) {
        console.error("Diagnostic Scan Error: ", err);
        alert(isRtl ? "خطأ أثناء إجراء الفحص الجغرافي: " + err.message : "Error during geographic scan: " + err.message);
      } finally {
        setIsScanning(false);
      }
    }, 600);
  };

  // 2. Classifications Stats Calculations
  const stats = useMemo(() => {
    const counts = {
      TOTAL: classifiedList.length,
      CANONICAL: 0,
      ALIAS_RESOLVABLE: 0,
      LEGACY_RESOLVABLE: 0,
      CONFLICTING_IDS_AND_LABELS: 0,
      INVALID_HIERARCHY: 0,
      AMBIGUOUS: 0,
      UNRESOLVED: 0
    };

    classifiedList.forEach(item => {
      if (item.classification in counts) {
        counts[item.classification as keyof typeof counts]++;
      }
    });

    const eligibleToRepair = counts.ALIAS_RESOLVABLE + counts.LEGACY_RESOLVABLE;

    return { ...counts, eligibleToRepair };
  }, [classifiedList]);

  // 3. Representative Scope Impact Calculations
  const repScopeImpact = useMemo(() => {
    if (!scanned) return [];

    // Filter to only Medical Representatives
    const reps = usersList.filter(u => 
      u.role === "Medical Representative" || 
      u.role === Role.MEDICAL_REP
    );

    return reps.map(rep => {
      // 1. Identify assigned Area IDs
      const assignedAreaIds = new Set<string>();
      
      // Check direct areaIds array
      if (Array.isArray(rep.areaIds)) {
        rep.areaIds.forEach((id: string) => assignedAreaIds.add(id));
      }
      
      // Check territoryAssignments
      territoryAssignments
        .filter(asg => asg.userId === rep.id)
        .forEach(asg => {
          if (asg.territoryId) assignedAreaIds.add(asg.territoryId);
        });

      // 2. Calculate visibility before
      const visibleBefore = physicians.filter(p => p.areaId && assignedAreaIds.has(p.areaId)).length;

      // 3. Calculate visibility after (simulating auto-repairs)
      const visibleAfter = classifiedList.filter(item => {
        const p = item.original;
        // If CANONICAL, check original areaId
        if (item.classification === "CANONICAL") {
          return p.areaId && assignedAreaIds.has(p.areaId);
        }
        // If auto-resolvable (ALIAS or LEGACY), check proposed areaId
        if (item.classification === "ALIAS_RESOLVABLE" || item.classification === "LEGACY_RESOLVABLE") {
          return item.proposedGeo?.areaId && assignedAreaIds.has(item.proposedGeo.areaId);
        }
        // Else, check original areaId
        return p.areaId && assignedAreaIds.has(p.areaId);
      }).length;

      const diff = visibleAfter - visibleBefore;
      
      const assignedAreaNames = Array.from(assignedAreaIds)
        .map(id => {
          const match = areas.find(a => a.id === id);
          return match ? match.name : id;
        })
        .join(", ");

      return {
        id: rep.id,
        name: rep.name || rep.displayName || rep.email,
        email: rep.email,
        assignedAreas: assignedAreaNames || "No assigned areas",
        before: visibleBefore,
        after: visibleAfter,
        diff
      };
    }).filter(rep => rep.diff !== 0 || rep.before > 0); // Only show relevant reps
  }, [scanned, usersList, territoryAssignments, physicians, classifiedList, areas]);

  // 4. Download / Export Dry-Run Report
  const downloadReport = () => {
    if (classifiedList.length === 0) return;

    try {
      const headers = [
        "Physician Document ID",
        "Physician Name",
        "Specialty",
        "Classification",
        "Linked Visits",
        "Linked Samples Count",
        "Current Country",
        "Current Country ID",
        "Current District",
        "Current District ID",
        "Current City",
        "Current City ID",
        "Current Area",
        "Current Area ID",
        "Proposed Country",
        "Proposed District",
        "Proposed City",
        "Proposed Area",
        "Proposed Area ID",
        "Proposed Area Code",
        "Fields to Change",
        "Validation Error/Reason"
      ];

      const rows = classifiedList.map(item => [
        item.id,
        item.name,
        item.specialty,
        item.classification,
        item.visitsCount,
        item.samplesCount,
        item.original.countryName || item.original.country || "",
        item.original.countryId || "",
        item.original.districtName || item.original.district || "",
        item.original.districtId || "",
        item.original.cityName || item.original.city || item.original.region || "",
        item.original.cityId || "",
        item.original.areaName || item.original.area || item.original.territory || "",
        item.original.areaId || "",
        item.proposedGeo?.countryName || "",
        item.proposedGeo?.districtName || "",
        item.proposedGeo?.cityName || "",
        item.proposedGeo?.areaName || "",
        item.proposedGeo?.areaId || "",
        item.proposedGeo?.areaCode || "",
        item.fieldsToChange.join("; "),
        item.reason.replace(/,/g, " ")
      ]);

      const csvContent = "data:text/csv;charset=utf-8," 
        + [headers.join(","), ...rows.map(e => e.map(val => `"${val}"`).join(","))].join("\n");
      
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", `MENAREPS_Physicians_Geography_Audit_Report_${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      onLogAudit("Export", "physicians", "Downloaded geographic dry-run audit report.");
    } catch (err: any) {
      alert("Export failed: " + err.message);
    }
  };

  // 5. Automatic Background Migration Routine
  const executeAutomaticMigration = async () => {
    const eligibleRecords = classifiedList.filter(item => 
      item.classification === "ALIAS_RESOLVABLE" || 
      item.classification === "LEGACY_RESOLVABLE"
    );

    if (eligibleRecords.length === 0) {
      alert(isRtl ? "لا توجد سجلات مؤهلة للإصلاح التلقائي." : "No eligible records found for automatic repair.");
      return;
    }

    const confirmMsg = isRtl
      ? `هل أنت متأكد من إجراء الإصلاح التلقائي لـ ${eligibleRecords.length} طبيب؟ هذه العملية ستحدث معرفات ومسميات النطاقات الجغرافية آلياً مع تدوين سجلات التدقيق والمزامنة الحية.`
      : `Are you sure you want to run automatic background repair for ${eligibleRecords.length} physicians? This will rewrite geographic fields with complete canonical metadata, log audits, and support seamless rollbacks.`;
    
    if (!window.confirm(confirmMsg)) return;

    setIsMigrating(true);
    setMigrationProgress(0);
    setMigrationLogs([]);
    const batchId = `MIG-GEO-${Date.now().toString().slice(-6)}`;
    const timestamp = new Date().toISOString();

    addLog(`Starting migration batch ${batchId}...`);
    addLog(`Identified ${eligibleRecords.length} eligible physicians for auto-repair.`);

    try {
      const chunkSize = 100; // Chunk size for WriteBatch
      const totalChunks = Math.ceil(eligibleRecords.length / chunkSize);
      
      // Store backup/rollback state in the migrations ledger
      const backupRecords: any[] = [];

      for (let i = 0; i < totalChunks; i++) {
        const chunk = eligibleRecords.slice(i * chunkSize, (i + 1) * chunkSize);
        const batch = writeBatch(db);

        addLog(`Processing chunk ${i + 1} of ${totalChunks} (${chunk.length} physicians)...`);

        chunk.forEach(item => {
          const docRef = doc(db, "physicians", item.id);
          const orig = item.original;

          // Backup original geographic fields
          backupRecords.push({
            id: item.id,
            previousGeography: removeUndefinedRecursively({
              countryId: orig.countryId || "",
              countryName: orig.countryName || orig.country || "",
              country: orig.country || "",
              districtId: orig.districtId || "",
              districtName: orig.districtName || orig.district || "",
              district: orig.district || "",
              cityId: orig.cityId || "",
              cityName: orig.cityName || orig.city || orig.region || "",
              city: orig.city || "",
              region: orig.region || "",
              areaId: orig.areaId || "",
              areaName: orig.areaName || orig.area || orig.territory || "",
              area: orig.area || "",
              territory: orig.territory || "",
              areaCode: orig.areaCode || ""
            })
          });

          // Prepare updated fields strictly targeting geography schema
          const proposed = item.proposedGeo;
          const updatedGeoFields = removeUndefinedRecursively({
            countryId: proposed.countryId,
            countryName: proposed.countryName,
            country: proposed.countryName,
            districtId: proposed.districtId,
            districtName: proposed.districtName,
            district: proposed.districtName,
            cityId: proposed.cityId,
            cityName: proposed.cityName,
            city: proposed.cityName,
            region: proposed.cityName,
            areaId: proposed.areaId,
            areaName: proposed.areaName,
            area: proposed.areaName,
            territory: proposed.areaName,
            areaCode: proposed.areaCode,
            
            // Additive metadata
            lastMigratedAt: timestamp,
            migratedBy: db.app?.options?.projectId ? "System Admin Geography Sync" : "Local Administrator",
            migrationBatchId: batchId,
            geographyAuditHistory: [
              ...(orig.geographyAuditHistory || []),
              {
                timestamp,
                batchId,
                action: "AUTOMATIC_REPAIR",
                previousAreaId: orig.areaId || "",
                previousAreaName: orig.areaName || orig.area || "",
                newAreaId: proposed.areaId,
                newAreaName: proposed.areaName,
                fieldsModified: item.fieldsToChange
              }
            ]
          });

          // Update record safely by merging fields
          batch.set(docRef, updatedGeoFields, { merge: true });
        });

        await batch.commit();
        setMigrationProgress(Math.round(((i + 1) / totalChunks) * 100));
        addLog(`Successfully committed chunk ${i + 1}.`);
      }

      // Store rollback ledger document
      const migrationDocRef = doc(db, "geographyMigrations", batchId);
      await setDoc(migrationDocRef, removeUndefinedRecursively({
        id: batchId,
        timestamp,
        executor: "Administrator",
        type: "AUTOMATIC",
        count: eligibleRecords.length,
        backups: backupRecords
      }));

      addLog(`Migration batch ${batchId} fully completed!`);
      onLogAudit("Migration", "physicians", `Successfully executed automatic geography repair batch ${batchId} on ${eligibleRecords.length} physicians.`);
      alert(isRtl ? "اكتمل الإصلاح التلقائي والمزامنة بنجاح!" : "Automatic background repair completed successfully!");
      
      // Reload scan to verify new status
      runDiagnosticScan();
    } catch (err: any) {
      console.error("Migration Error: ", err);
      addLog(`[CRITICAL ERROR] Migration failed: ${err.message}`);
      alert("Migration Error: " + err.message);
    } finally {
      setIsMigrating(false);
    }
  };

  // 6. Rollback Routine
  const executeRollback = async () => {
    try {
      addLog("Fetching last migration batch...");
      
      const colRef = collection(db, "geographyMigrations");
      const snap = await getDocs(query(colRef, orderBy("timestamp", "desc"), limit(1)));
      
      if (snap.empty) {
        alert(isRtl ? "لا توجد أي دفعات هجرة مسجلة للتراجع عنها." : "No registered geography migrations available to rollback.");
        return;
      }

      const migration = snap.docs[0].data();
      const confirmMsg = isRtl
        ? `هل أنت متأكد من التراجع عن الدفعة الجغرافية "${migration.id}" المنجزة بتاريخ ${new Date(migration.timestamp).toLocaleString()} والتي تضم ${migration.count} سجلات؟`
        : `Are you sure you want to rollback migration batch "${migration.id}" executed on ${new Date(migration.timestamp).toLocaleString()} restoring ${migration.count} physicians to their previous state?`;

      if (!window.confirm(confirmMsg)) return;

      setIsRollingBack(true);
      setRollbackProgress(0);
      addLog(`Initiating rollback of batch ${migration.id}...`);

      const backups = migration.backups || [];
      const chunkSize = 100;
      const totalChunks = Math.ceil(backups.length / chunkSize);

      for (let i = 0; i < totalChunks; i++) {
        const chunk = backups.slice(i * chunkSize, (i + 1) * chunkSize);
        const batch = writeBatch(db);

        addLog(`Restoring chunk ${i + 1} of ${totalChunks}...`);

        chunk.forEach((item: any) => {
          const docRef = doc(db, "physicians", item.id);
          const prev = item.previousGeography;

          // Prepare restored properties with audit trace
          const restoredFields = removeUndefinedRecursively({
            ...prev,
            lastMigratedAt: new Date().toISOString(),
            migrationBatchId: `ROLLBACK-${migration.id}`,
            // Append rollback event to history
            geographyAuditHistory: [
              ...(physicians.find(p => p.id === item.id)?.geographyAuditHistory || []),
              {
                timestamp: new Date().toISOString(),
                batchId: `ROLLBACK-${migration.id}`,
                action: "ROLLBACK",
                restoredFromBatch: migration.id
              }
            ]
          });

          batch.set(docRef, restoredFields, { merge: true });
        });

        await batch.commit();
        setRollbackProgress(Math.round(((i + 1) / totalChunks) * 100));
      }

      // Delete the migration document after rollback
      await deleteDoc(doc(db, "geographyMigrations", migration.id));

      addLog(`Rollback of batch ${migration.id} completed successfully!`);
      onLogAudit("Rollback", "physicians", `Successfully rolled back geography repair batch ${migration.id} on ${backups.length} physicians.`);
      alert(isRtl ? "تم التراجع عن التعديلات وإسترجاع البيانات الجغرافية السابقة بنجاح!" : "Rollback completed successfully! Previous geography states fully restored.");
      
      setIsRollingBack(false);
      runDiagnosticScan();
    } catch (err: any) {
      console.error("Rollback Error: ", err);
      alert("Rollback Error: " + err.message);
      setIsRollingBack(false);
    }
  };

  // 7. Controlled Manual Correction Routine
  const handleManualAreaChange = (physicianId: string, selectedAreaId: string) => {
    setManualAreaSelections({
      ...manualAreaSelections,
      [physicianId]: selectedAreaId
    });
  };

  const applyManualCorrection = async (item: any) => {
    const selectedAreaId = manualAreaSelections[item.id];
    if (!selectedAreaId) {
      alert(isRtl ? "الرجاء اختيار حي جغرافي صحيح أولاً." : "Please select a valid canonical Area first.");
      return;
    }

    const matchArea = areas.find(a => a.id === selectedAreaId);
    if (!matchArea) return;

    setIsApplyingManual({ ...isApplyingManual, [item.id]: true });

    try {
      const docRef = doc(db, "physicians", item.id);
      const timestamp = new Date().toISOString();
      const orig = item.original;

      const manualGeoFields = removeUndefinedRecursively({
        countryId: matchArea.countryId || "",
        countryName: matchArea.countryName || "",
        country: matchArea.countryName || "",
        districtId: matchArea.districtId || "",
        districtName: matchArea.districtName || "",
        district: matchArea.districtName || "",
        cityId: matchArea.cityId || "",
        cityName: matchArea.cityName || "",
        city: matchArea.cityName || "",
        region: matchArea.cityName || "",
        areaId: matchArea.id,
        areaName: matchArea.name,
        area: matchArea.name,
        territory: matchArea.name,
        areaCode: matchArea.code || matchArea.id,

        // Audit tags
        lastMigratedAt: timestamp,
        migratedBy: "Administrator Manual Action",
        migrationBatchId: "MANUAL_REPAIR",
        geographyAuditHistory: [
          ...(orig.geographyAuditHistory || []),
          {
            timestamp,
            batchId: "MANUAL_REPAIR",
            action: "MANUAL_CORRECTION",
            previousAreaId: orig.areaId || "",
            previousAreaName: orig.areaName || orig.area || "",
            newAreaId: matchArea.id,
            newAreaName: matchArea.name
          }
        ]
      });

      await setDoc(docRef, manualGeoFields, { merge: true });
      
      onLogAudit("Manual Repair", "physicians", `Manually repaired physician geography: ${item.id} (${item.name}) mapped to Area ID: ${matchArea.id}`);
      
      // Update local scan state item directly
      setClassifiedList(prevList => 
        prevList.map(p => p.id === item.id ? {
          ...p,
          classification: "CANONICAL",
          fieldsToChange: [],
          reason: "Manually resolved and mapped to canonical area.",
          original: { ...p.original, ...manualGeoFields }
        } : p)
      );

    } catch (err: any) {
      console.error(err);
      alert("Manual Repair Error: " + err.message);
    } finally {
      setIsApplyingManual({ ...isApplyingManual, [item.id]: false });
    }
  };

  // Lists filtering
  const filteredList = useMemo(() => {
    return classifiedList.filter(item => {
      const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            item.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            item.specialty.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesClass = filterClass === "ALL" || item.classification === filterClass;

      return matchesSearch && matchesClass;
    });
  }, [classifiedList, searchQuery, filterClass]);

  const activeCanonicalAreas = useMemo(() => {
    return areas.filter(isCanonical);
  }, [areas]);

  return (
    <div className="space-y-6 text-xs text-left">
      {/* 1. Header & Primary Scanning Controls */}
      <div className="bg-slate-50 dark:bg-slate-950/40 p-5 border border-slate-100 dark:border-slate-800 rounded-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="space-y-1">
          <h4 className="text-sm font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <Shield size={18} className="text-blue-500" />
            {isRtl ? "مركز محاذاة وتطهير النطاقات الجغرافية للأطباء" : "Physician Canonical Geography Repair & Sync Engine"}
          </h4>
          <p className="text-xxs text-slate-400 max-w-2xl leading-relaxed">
            {isRtl 
              ? "يقوم هذا المركز بفحص جميع وثائق الأطباء لتصنيفها، إصلاح التهجئات الخاطئة (مثل TAJURA -> TAJOURA)، تعبئة المعرفات (IDs) المفقودة، وحظر النطاقات المتضاربة أو الخاطئة مع حساب تغييرات نطاقات مندوبي المبيعات بشكل آمن وتدريجي."
              : "Scans all Physician documents to diagnose spelling aliases (e.g. TAJURA -> TAJOURA), hydrate missing structural IDs, flag invalid cascades, and resolve discrepancies securely without altering non-geography relationship tags."}
          </p>
        </div>

        <div className="flex gap-2 w-full md:w-auto">
          <button
            onClick={runDiagnosticScan}
            disabled={isScanning || isMigrating || isRollingBack}
            className="flex-1 md:flex-none px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-800 text-white font-bold rounded-lg cursor-pointer flex items-center justify-center gap-1.5 transition-colors shadow-xs"
          >
            <RefreshCw size={14} className={isScanning ? "animate-spin" : ""} />
            {isScanning ? (isRtl ? "جاري الفحص..." : "Scanning...") : (isRtl ? "بدء فحص وتشخيص البيانات" : "Scan & Analyze Physicians")}
          </button>
        </div>
      </div>

      {scanned && (
        <>
          {/* 2. Analysis Dashboard Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
            <div className="bg-slate-50/50 dark:bg-slate-950/10 border border-slate-100 dark:border-slate-800 p-3 rounded-xl">
              <span className="text-[9px] font-bold text-slate-400 block uppercase font-mono">TOTAL PHYSICIANS</span>
              <span className="text-xl font-bold font-mono text-slate-800 dark:text-white">{stats.TOTAL}</span>
            </div>

            <div className="bg-emerald-50/40 dark:bg-emerald-950/10 border border-emerald-100/40 dark:border-emerald-900/40 p-3 rounded-xl">
              <span className="text-[9px] font-bold text-emerald-500 block uppercase font-mono">🟢 CANONICAL</span>
              <span className="text-xl font-bold font-mono text-emerald-600 dark:text-emerald-400">{stats.CANONICAL}</span>
            </div>

            <div className="bg-blue-50/40 dark:bg-blue-950/10 border border-blue-100/40 dark:border-blue-900/40 p-3 rounded-xl">
              <span className="text-[9px] font-bold text-blue-500 block uppercase font-mono">🔵 ALIAS RESOLVABLE</span>
              <span className="text-xl font-bold font-mono text-blue-600 dark:text-blue-400">{stats.ALIAS_RESOLVABLE}</span>
            </div>

            <div className="bg-indigo-50/40 dark:bg-indigo-950/10 border border-indigo-100/40 dark:border-indigo-900/40 p-3 rounded-xl">
              <span className="text-[9px] font-bold text-indigo-500 block uppercase font-mono">🟣 LEGACY RESOLVABLE</span>
              <span className="text-xl font-bold font-mono text-indigo-600 dark:text-indigo-400">{stats.LEGACY_RESOLVABLE}</span>
            </div>

            <div className="bg-amber-50/40 dark:bg-amber-950/10 border border-amber-100/40 dark:border-amber-900/40 p-3 rounded-xl">
              <span className="text-[9px] font-bold text-amber-500 block uppercase font-mono">🟡 CONFLICTING ID/TXT</span>
              <span className="text-xl font-bold font-mono text-amber-600 dark:text-amber-400">{stats.CONFLICTING_IDS_AND_LABELS}</span>
            </div>

            <div className="bg-rose-50/40 dark:bg-rose-950/10 border border-rose-100/40 dark:border-rose-900/40 p-3 rounded-xl">
              <span className="text-[9px] font-bold text-rose-500 block uppercase font-mono">🔴 INVALID HIERARCHY</span>
              <span className="text-xl font-bold font-mono text-rose-600 dark:text-rose-400">{stats.INVALID_HIERARCHY}</span>
            </div>

            <div className="bg-purple-50/40 dark:bg-purple-950/10 border border-purple-100/40 dark:border-purple-900/40 p-3 rounded-xl">
              <span className="text-[9px] font-bold text-purple-500 block uppercase font-mono">🟠 AMBIGUOUS</span>
              <span className="text-xl font-bold font-mono text-purple-600 dark:text-purple-400">{stats.AMBIGUOUS}</span>
            </div>

            <div className="bg-slate-100/40 dark:bg-slate-800/10 border border-slate-200/40 dark:border-slate-700/40 p-3 rounded-xl">
              <span className="text-[9px] font-bold text-slate-500 block uppercase font-mono">⚫ UNRESOLVED</span>
              <span className="text-xl font-bold font-mono text-slate-600 dark:text-slate-400">{stats.UNRESOLVED}</span>
            </div>
          </div>

          {/* 3. High-Capacity Interactive Operations Panel */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left: Auto-Repair Actions and Scope Impact Check */}
            <div className="lg:col-span-1 space-y-6">
              <div className="border border-slate-100 dark:border-slate-800 p-5 rounded-2xl bg-slate-50/30 dark:bg-slate-950/10 space-y-4">
                <div className="space-y-1">
                  <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider font-mono">AUTOMATIC BATCH REPAIR</span>
                  <h5 className="font-bold text-slate-800 dark:text-white">{isRtl ? "بدء المزامنة والتطهير التلقائي" : "Auto-Repair Eligible Records"}</h5>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    {isRtl 
                      ? "إجراء تطهير ذكي للبيانات النشطة. متاح فقط للتصنيفات المؤهلة (ALIAS_RESOLVABLE و LEGACY_RESOLVABLE). سيتم حظر جميع الفئات الأخرى لحماية تكامل النظام الجغرافي."
                      : "Executes batch background repair strictly targeting only ALIAS_RESOLVABLE and LEGACY_RESOLVABLE entries. Unsafe entries will remain locked."}
                  </p>
                </div>

                <div className="p-3.5 bg-blue-50/30 dark:bg-blue-950/20 border border-blue-100/60 dark:border-blue-900/60 rounded-xl space-y-2">
                  <div className="flex justify-between items-center text-[11px] font-bold">
                    <span className="text-blue-600 dark:text-blue-400">{isRtl ? "السجلات المؤهلة للإصلاح:" : "Eligible for Automatic Repair:"}</span>
                    <span className="font-mono text-blue-700 dark:text-blue-300 bg-blue-100/60 dark:bg-blue-900/40 px-2 py-0.5 rounded text-xs">{stats.eligibleToRepair} physicians</span>
                  </div>
                </div>

                {isMigrating && (
                  <div className="space-y-2 bg-white dark:bg-slate-900 p-3 border border-slate-100 dark:border-slate-800 rounded-xl">
                    <div className="flex justify-between items-center text-[10px] font-bold text-slate-500 font-mono">
                      <span>PROCESSING BATCHES...</span>
                      <span>{migrationProgress}%</span>
                    </div>
                    <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                      <div className="bg-blue-600 h-full transition-all duration-300" style={{ width: `${migrationProgress}%` }}></div>
                    </div>
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={executeAutomaticMigration}
                    disabled={isMigrating || isRollingBack || stats.eligibleToRepair === 0}
                    className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 dark:disabled:bg-slate-800 text-white font-bold rounded-lg cursor-pointer flex items-center justify-center gap-1.5 transition-all text-xs"
                  >
                    <Play size={13} />
                    {isRtl ? "تشغيل الإصلاح التلقائي للكل" : "Run Auto-Repair"}
                  </button>

                  <button
                    onClick={downloadReport}
                    className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-lg cursor-pointer flex items-center justify-center gap-1.5 transition-all"
                    title={isRtl ? "تنزيل تقرير التدقيق كاملاً" : "Download Excel CSV Diagnostic Report"}
                  >
                    <Download size={14} />
                  </button>
                </div>

                <div className="border-t border-slate-100 dark:border-slate-800/80 pt-4 space-y-3">
                  <div>
                    <h5 className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                      <RotateCcw size={13} className="text-indigo-500" />
                      {isRtl ? "نظام استرداد البيانات والتراجع الآمن" : "Rollback Management Ledger"}
                    </h5>
                    <p className="text-[10px] text-slate-400 leading-relaxed mt-0.5">
                      {isRtl
                        ? "يمكن التراجع الكامل وإلغاء عملية التطهير الأخيرة لاستعادة النطاقات والبيانات الجغرافية السابقة بدقة متناهية."
                        : "Fully restores physicians' previous geography attributes from the automatic backup snapshot ledger if issues arise."}
                    </p>
                  </div>

                  {isRollingBack && (
                    <div className="space-y-2 bg-white dark:bg-slate-900 p-3 border border-slate-100 dark:border-slate-800 rounded-xl">
                      <div className="flex justify-between items-center text-[10px] font-bold text-slate-500 font-mono">
                        <span>RESTORING PREVIOUS STATE...</span>
                        <span>{rollbackProgress}%</span>
                      </div>
                      <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                        <div className="bg-indigo-600 h-full transition-all duration-300" style={{ width: `${rollbackProgress}%` }}></div>
                      </div>
                    </div>
                  )}

                  <button
                    onClick={executeRollback}
                    disabled={isMigrating || isRollingBack}
                    className="w-full px-3 py-1.5 border border-indigo-100 hover:border-indigo-200 bg-indigo-50/40 hover:bg-indigo-50 dark:border-indigo-900 dark:bg-indigo-950/20 text-indigo-600 dark:text-indigo-400 font-bold rounded-lg cursor-pointer flex items-center justify-center gap-1.5 transition-all"
                  >
                    <RotateCcw size={12} />
                    {isRtl ? "إلغاء التطهير الأخير واستعادة النسخة الاحتياطية" : "Rollback Last Migration Batch"}
                  </button>
                </div>
              </div>

              {/* Rep Scope Impact Check Card */}
              <div className="border border-slate-100 dark:border-slate-800 p-5 rounded-2xl bg-slate-50/30 dark:bg-slate-950/10 space-y-3">
                <div className="space-y-1">
                  <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider font-mono">REPRESENTATIVE SCOPE IMPACT INDICATOR</span>
                  <h5 className="font-bold text-slate-800 dark:text-white">{isRtl ? "تغييرات نطاق رؤية المندوبين" : "Active Rep Scope Alignments Shift"}</h5>
                  <p className="text-[10px] text-slate-400 leading-relaxed">
                    {isRtl
                      ? "يوضح هذا المؤشر الدقيق التغيير الحقيقي المترتب في عدد الأطباء المرئيين لكل مندوب طبي بمجرد إجراء المزامنة."
                      : "Calculates the visibility shift (difference in patient/physician scope) for active MedReps before and after automatic database repair."}
                  </p>
                </div>

                <div className="max-h-56 overflow-y-auto border border-slate-100 dark:border-slate-800 rounded-xl divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900/50">
                  {repScopeImpact.length === 0 ? (
                    <div className="p-4 text-center text-slate-400 text-xxs font-semibold">
                      No visibility shifts detected for any active representative.
                    </div>
                  ) : (
                    repScopeImpact.map(rep => (
                      <div key={rep.id} className="p-2.5 flex justify-between items-center text-[10px]">
                        <div className="space-y-0.5 max-w-[150px] truncate text-left">
                          <strong className="text-slate-800 dark:text-slate-200 block truncate">{rep.name}</strong>
                          <span className="text-slate-400 font-mono text-[9px] block truncate" title={rep.assignedAreas}>{rep.assignedAreas}</span>
                        </div>
                        <div className="flex items-center gap-2 font-mono text-[11px]">
                          <span className="text-slate-400">{rep.before}</span>
                          <ChevronRight size={10} className="text-slate-300" />
                          <span className="text-slate-800 dark:text-white font-bold">{rep.after}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${rep.diff > 0 ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40" : rep.diff < 0 ? "bg-rose-50 text-rose-600 dark:bg-rose-950/40" : "bg-slate-50 text-slate-500"}`}>
                            {rep.diff > 0 ? `+${rep.diff}` : rep.diff}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Right: Master Physician Classification List */}
            <div className="lg:col-span-2 space-y-4">
              {/* Filter controls */}
              <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-xl flex flex-col sm:flex-row justify-between items-center gap-3">
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-2.5 top-2 text-slate-400" size={14} />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={isRtl ? "البحث بالاسم، التخصص أو المعرف..." : "Search by name, specialty, ID..."}
                    className="w-full pl-8 pr-3 py-1.5 border border-slate-200 dark:border-slate-800 rounded-lg text-xxs bg-transparent text-slate-800 dark:text-white"
                  />
                </div>

                <div className="flex gap-2 w-full sm:w-auto">
                  <select
                    value={filterClass}
                    onChange={(e) => setFilterClass(e.target.value)}
                    className="w-full sm:w-44 px-2.5 py-1.5 border border-slate-200 dark:border-slate-800 rounded-lg text-xxs bg-transparent text-slate-800 dark:text-white font-bold font-mono uppercase"
                  >
                    <option value="ALL">{isRtl ? "-- كل التصنيفات --" : "All Classifications"}</option>
                    <option value="CANONICAL">🟢 Canonical</option>
                    <option value="ALIAS_RESOLVABLE">🔵 Alias Resolvable</option>
                    <option value="LEGACY_RESOLVABLE">🟣 Legacy Resolvable</option>
                    <option value="CONFLICTING_IDS_AND_LABELS">🟡 Conflicting ID/Labels</option>
                    <option value="INVALID_HIERARCHY">🔴 Invalid Hierarchy</option>
                    <option value="AMBIGUOUS">🟠 Ambiguous</option>
                    <option value="UNRESOLVED">⚫ Unresolved</option>
                  </select>
                </div>
              </div>

              {/* Master List Records */}
              <div className="border border-slate-100 dark:border-slate-800 rounded-2xl overflow-hidden bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800 max-h-[70vh] overflow-y-auto">
                {filteredList.length === 0 ? (
                  <div className="p-12 text-center text-slate-400 font-semibold space-y-1">
                    <Building2 className="mx-auto text-slate-300" size={28} />
                    <p>{isRtl ? "لا توجد أطباء يطابقون خيارات البحث المختارة." : "No physician records found matching search filters."}</p>
                  </div>
                ) : (
                  filteredList.map(item => {
                    const isEligible = item.classification === "ALIAS_RESOLVABLE" || item.classification === "LEGACY_RESOLVABLE";
                    const isClean = item.classification === "CANONICAL";
                    const hasConflict = item.classification === "CONFLICTING_IDS_AND_LABELS";
                    const hasInvalid = item.classification === "INVALID_HIERARCHY";

                    const originalPath = [
                      item.original.countryName || item.original.country || "",
                      item.original.districtName || item.original.district || "",
                      item.original.cityName || item.original.city || item.original.region || "",
                      item.original.areaName || item.original.area || item.original.territory || ""
                    ].filter(Boolean).join(" > ");

                    const proposedPath = item.proposedGeo 
                      ? `${item.proposedGeo.countryName} > ${item.proposedGeo.districtName} > ${item.proposedGeo.cityName} > ${item.proposedGeo.areaName}`
                      : "";

                    const selectedManualAreaId = manualAreaSelections[item.id] || "";

                    return (
                      <div key={item.id} className="p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 hover:bg-slate-50/20 dark:hover:bg-slate-950/5 transition-all text-xs">
                        {/* Record Metadata and Diagnosis Details */}
                        <div className="space-y-1.5 max-w-xl text-left">
                          <div className="flex flex-wrap items-center gap-2">
                            <strong className="text-slate-800 dark:text-white font-bold">{item.name}</strong>
                            <span className="text-[10px] text-slate-400 font-medium">({item.specialty})</span>
                            <span className="text-[9px] font-mono text-slate-400 bg-slate-50 dark:bg-slate-950/60 border border-slate-100 dark:border-slate-800 px-1.5 py-0.5 rounded font-bold">{item.id}</span>
                            
                            {/* Status Pill */}
                            <span className={`px-2 py-0.5 rounded text-[8px] font-bold tracking-wider font-mono uppercase ${
                              isClean ? "bg-emerald-50 text-emerald-600 border border-emerald-100/30 dark:bg-emerald-950/30" :
                              item.classification === "ALIAS_RESOLVABLE" ? "bg-blue-50 text-blue-600 border border-blue-100/30 dark:bg-blue-950/30" :
                              item.classification === "LEGACY_RESOLVABLE" ? "bg-indigo-50 text-indigo-600 border border-indigo-100/30 dark:bg-indigo-950/30" :
                              hasConflict ? "bg-amber-50 text-amber-600 border border-amber-100/30 dark:bg-amber-950/30" :
                              hasInvalid ? "bg-rose-50 text-rose-600 border border-rose-100/30 dark:bg-rose-950/30" :
                              "bg-slate-100 text-slate-600 border border-slate-200/30 dark:bg-slate-800/30"
                            }`}>
                              {item.classification}
                            </span>
                          </div>

                          <div className="space-y-1 font-mono text-[10px]">
                            <div className="text-slate-500 truncate flex items-center gap-1.5">
                              <span className="text-slate-400 font-semibold">{isRtl ? "الموقع الحالي:" : "Current:"}</span> 
                              <span className="text-slate-700 dark:text-slate-300 truncate" title={originalPath}>{originalPath || "Empty Geography"}</span>
                              <span className="text-slate-400 text-[9px] font-bold">({isRtl ? `معرّف الحي: ${item.original.areaId || "لا يوجد"}` : `areaId: ${item.original.areaId || "none"}`})</span>
                            </div>

                            {item.proposedGeo && !isClean && (
                              <div className="text-emerald-600 dark:text-emerald-400 truncate flex items-center gap-1.5">
                                <span className="text-slate-400 font-semibold">{isRtl ? "المسار المقترح:" : "Proposed:"}</span>
                                <span className="truncate" title={proposedPath}>{proposedPath}</span>
                                <span className="text-emerald-500 text-[9px] font-bold">({isRtl ? `معرّف الحي: ${item.proposedGeo.areaId}` : `areaId: ${item.proposedGeo.areaId}`})</span>
                              </div>
                            )}

                            {!isClean && item.reason && (
                              <div className="text-slate-400 italic text-[10px] mt-1 p-1 px-2 bg-slate-50 dark:bg-slate-950/40 rounded border-l-2 border-slate-300 dark:border-slate-700 font-sans">
                                {item.reason}
                              </div>
                            )}
                          </div>

                          {/* Historical context counts */}
                          <div className="flex gap-4 text-[10px] text-slate-400 font-mono">
                            <span>Visits: <strong className="text-slate-600 dark:text-slate-200">{item.visitsCount}</strong></span>
                            <span>Samples: <strong className="text-slate-600 dark:text-slate-200">{item.samplesCount}</strong></span>
                            {item.assignedRepId && (
                              <span className="truncate max-w-[180px]" title={item.assignedRepId}>Rep: <strong className="text-slate-600 dark:text-slate-200">{item.assignedRepId}</strong></span>
                            )}
                          </div>
                        </div>

                        {/* Interactive Actions per Physician */}
                        <div className="flex items-center gap-2 self-stretch md:self-auto justify-end">
                          {/* Automatic repair indication */}
                          {isEligible && (
                            <div className="text-right">
                              <span className="px-2 py-1 rounded bg-emerald-50 text-emerald-600 dark:bg-emerald-950/20 text-[9px] font-bold uppercase font-mono">
                                Auto-Repair Ready
                              </span>
                            </div>
                          )}

                          {/* Manual Alignment Panel for unsafe entries */}
                          {!isClean && !isEligible && (
                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-1.5 bg-slate-50 dark:bg-slate-950/60 p-2 border border-slate-100 dark:border-slate-800 rounded-xl w-full sm:w-auto">
                              <select
                                value={selectedManualAreaId}
                                onChange={(e) => handleManualAreaChange(item.id, e.target.value)}
                                className="px-2 py-1.5 border border-slate-200 dark:border-slate-800 rounded-lg text-[10px] bg-transparent text-slate-800 dark:text-white font-mono max-w-[180px] sm:max-w-[200px]"
                              >
                                <option value="">{isRtl ? "-- اختر حي صحيح --" : "-- Select Canonical Area --"}</option>
                                {activeCanonicalAreas.map(a => (
                                  <option key={a.id} value={a.id}>
                                    {a.countryName} &gt; {a.districtName} &gt; {a.cityName} &gt; {a.name}
                                  </option>
                                ))}
                              </select>

                              <button
                                onClick={() => applyManualCorrection(item)}
                                disabled={!selectedManualAreaId || isApplyingManual[item.id]}
                                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-800 text-white font-bold text-[10px] rounded-lg cursor-pointer flex items-center justify-center gap-1 transition-all whitespace-nowrap"
                              >
                                {isApplyingManual[item.id] ? (
                                  <RefreshCw size={11} className="animate-spin" />
                                ) : (
                                  <CheckCircle2 size={11} />
                                )}
                                {isRtl ? "حفظ المواءمة" : "Apply"}
                              </button>
                            </div>
                          )}

                          {/* Clean Canonical indicator */}
                          {isClean && (
                            <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/20 px-2.5 py-1 rounded-lg">
                              <CheckCircle2 size={13} />
                              <span className="text-[10px] font-bold uppercase font-mono">Canonical</span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Primary Instructions & Help Panel */}
      {!scanned && !isScanning && (
        <div className="p-8 text-center bg-slate-50/50 dark:bg-slate-950/10 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl space-y-4">
          <Database className="mx-auto text-blue-500 animate-pulse" size={42} />
          <div className="space-y-1.5 max-w-lg mx-auto">
            <h5 className="font-bold text-slate-850 dark:text-white text-sm">{isRtl ? "الفحص الأمني والتحقق الجغرافي مغلق حالياً" : "Diagnostic Audit Engine Offline"}</h5>
            <p className="text-xxs text-slate-400 leading-relaxed">
              {isRtl
                ? "انقر على زر 'بدء فحص وتشخيص البيانات' أعلاه لإطلاق Sweep كامل على مجموعة الأطباء النشطة ومقارنتها بقاموس الهيكل الجغرافي لـ MENAREPS."
                : "Click the 'Scan & Analyze Physicians' button to parse all active Physician records, calculate cascading alignments, and display detailed status classification logs."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
