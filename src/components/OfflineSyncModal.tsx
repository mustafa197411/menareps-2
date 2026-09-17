import React, { useState } from "react";
import { 
  X, 
  Wifi, 
  WifiOff, 
  RefreshCw, 
  AlertTriangle, 
  CheckCircle2, 
  Trash2, 
  Eye, 
  Database, 
  Info,
  Clock,
  ArrowRight,
  Sparkles
} from "lucide-react";
import { 
  OfflineQueueItem, 
  ConnectivityStatus, 
  triggerAutomaticSync, 
  forceRetryItem, 
  resolveConflictManually, 
  deleteQueueItem, 
  clearQueue 
} from "../lib/offlineSyncEngine";
import { resolveFinancialIdentity } from "../lib/financialIdentity";
import { formatCurrencyForIdentity } from "../lib/marketSettings";

interface OfflineSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectivityStatus: ConnectivityStatus;
  offlineQueues: {
    pending: OfflineQueueItem[];
    completed: OfflineQueueItem[];
    failed: OfflineQueueItem[];
    retry: OfflineQueueItem[];
    conflict: OfflineQueueItem[];
  };
}

export default function OfflineSyncModal({
  isOpen,
  onClose,
  connectivityStatus,
  offlineQueues
}: OfflineSyncModalProps) {
  const offlineMoney = (item: OfflineQueueItem) => { const identity = resolveFinancialIdentity([item.data || {}]); try { return identity ? formatCurrencyForIdentity(item.data.total || 0, { marketId: identity.marketId }) : "Currency configuration required"; } catch { return "Currency configuration required"; } };
  const [activeTab, setActiveTab] = useState<"pending" | "conflict" | "completed" | "failed">("pending");
  const [selectedItem, setSelectedItem] = useState<OfflineQueueItem | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [simulationStatus, setSimulationStatus] = useState<ConnectivityStatus | null>(null);

  if (!isOpen) return null;

  const handleManualSync = async () => {
    setIsSyncing(true);
    try {
      await triggerAutomaticSync();
    } catch (e) {
      console.error(e);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleRetry = async (itemId: string) => {
    await forceRetryItem(itemId);
    if (selectedItem && selectedItem.id === itemId) {
      setSelectedItem(null);
    }
  };

  const handleResolve = async (itemId: string, resolution: "client_wins" | "server_wins") => {
    await resolveConflictManually(itemId, resolution);
    if (selectedItem && selectedItem.id === itemId) {
      setSelectedItem(null);
    }
  };

  const handleDelete = (itemId: string, queueName: "pending" | "completed" | "failed" | "retry" | "conflict") => {
    deleteQueueItem(itemId, queueName);
    if (selectedItem && selectedItem.id === itemId) {
      setSelectedItem(null);
    }
  };

  const handleClear = (queueName: "pending" | "completed" | "failed" | "retry" | "conflict") => {
    if (confirm(`Are you sure you want to clear all records in the ${queueName} queue?`)) {
      clearQueue(queueName);
      setSelectedItem(null);
    }
  };

  // Simulation controls to toggle connection status manually inside AI Studio preview iframe
  const toggleSimulation = (status: ConnectivityStatus) => {
    setSimulationStatus(status);
    const eventName = status === "offline" ? "offline" : "online";
    // Dispatch native network status event to trigger the engine listeners
    window.dispatchEvent(new Event(eventName));
    
    // Custom trigger if we want to force simulation statuses
    if (status === "poor") {
      console.log("[Simulation] Testing POOR connection performance parameters...");
    }
  };

  const getModuleBadgeColor = (mod: OfflineQueueItem["module"]) => {
    switch (mod) {
      case "physicianVisit": return "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/20 dark:text-blue-400 dark:border-blue-900/40";
      case "pharmacyVisit": return "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/20 dark:text-purple-400 dark:border-purple-900/40";
      case "order": return "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/40";
      case "medicalPlanner":
      case "salesPlanner": return "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/20 dark:text-teal-400 dark:border-teal-900/40";
      default: return "bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-800";
    }
  };

  // Combine pending and retry into one display tab
  const pendingDisplayList = [...offlineQueues.pending, ...offlineQueues.retry];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in" id="sync-engine-modal">
      <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden" id="sync-modal-container">
        
        {/* Header section */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800/80 flex justify-between items-center bg-slate-50/50 dark:bg-slate-900/40" id="sync-modal-header">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl border ${
              connectivityStatus === "online" || connectivityStatus === "recovered"
                ? "bg-emerald-50 border-emerald-100 text-emerald-600 dark:bg-emerald-950/20 dark:border-emerald-900/30 dark:text-emerald-400"
                : connectivityStatus === "poor"
                ? "bg-amber-50 border-amber-100 text-amber-600 dark:bg-amber-950/20 dark:border-amber-900/30 dark:text-amber-400"
                : "bg-rose-50 border-rose-100 text-rose-600 dark:bg-rose-950/20 dark:border-rose-900/30 dark:text-rose-400"
            }`}>
              {connectivityStatus === "offline" ? <WifiOff size={20} /> : <Wifi size={20} />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-slate-900 dark:text-white tracking-tight uppercase text-sm">
                  MENAREPS 2.0 Synchronizer
                </h3>
                <span className="text-[10px] bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-1.5 py-0.5 rounded font-mono font-bold uppercase tracking-wide">
                  Enterprise Offline V19
                </span>
              </div>
              <p className="text-xxs text-slate-500 dark:text-slate-400">
                Network Quality: <strong className="uppercase">{connectivityStatus}</strong> • Sync engine offline queue manager
              </p>
            </div>
          </div>
          
          <button 
            onClick={onClose}
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 shrink-0 cursor-pointer transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Diagnostic simulation dashboard bar */}
        <div className="px-6 py-2.5 bg-slate-100/50 dark:bg-slate-900/60 border-b border-slate-200/50 dark:border-slate-800/60 flex flex-wrap items-center justify-between gap-3" id="sync-diagnostic-bar">
          <div className="flex items-center gap-2 text-xxs font-semibold text-slate-500 dark:text-slate-400">
            <Info size={12} className="text-blue-500" />
            <span>Developer Sandbox Connectivity Simulator:</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => toggleSimulation("online")}
              className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer transition-all ${
                connectivityStatus === "online" && !simulationStatus
                  ? "bg-emerald-600 text-white shadow-xs"
                  : simulationStatus === "online"
                  ? "bg-emerald-500 text-white shadow-xs"
                  : "bg-white dark:bg-slate-800 hover:bg-slate-50 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
              }`}
            >
              Simulate Online
            </button>
            <button
              onClick={() => toggleSimulation("poor")}
              className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer transition-all ${
                simulationStatus === "poor"
                  ? "bg-amber-500 text-white shadow-xs"
                  : "bg-white dark:bg-slate-800 hover:bg-slate-50 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
              }`}
            >
              Simulate Poor
            </button>
            <button
              onClick={() => toggleSimulation("offline")}
              className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer transition-all ${
                connectivityStatus === "offline" || simulationStatus === "offline"
                  ? "bg-rose-600 text-white shadow-xs"
                  : "bg-white dark:bg-slate-800 hover:bg-slate-50 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
              }`}
            >
              Simulate Offline
            </button>
          </div>
        </div>

        {/* Workspace body layout */}
        <div className="flex-1 flex overflow-hidden" id="sync-modal-body">
          
          {/* Left panel: Queue lists and tabs */}
          <div className="w-1/2 border-r border-slate-150 dark:border-slate-800 flex flex-col h-full bg-slate-50/20 dark:bg-slate-950/20">
            
            {/* Nav Tabs with item count indicators */}
            <div className="flex border-b border-slate-200/60 dark:border-slate-800/60 p-2 gap-1 shrink-0 bg-slate-100/10 dark:bg-slate-900/10">
              <button
                onClick={() => { setActiveTab("pending"); setSelectedItem(null); }}
                className={`flex-1 py-2 px-1.5 rounded-lg text-xxs font-bold uppercase tracking-wider flex items-center justify-center gap-1 cursor-pointer transition-all ${
                  activeTab === "pending"
                    ? "bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 border border-slate-200 dark:border-slate-700 shadow-xs"
                    : "text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-900"
                }`}
              >
                Pending
                {pendingDisplayList.length > 0 && (
                  <span className="bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-400 text-[10px] font-black px-1.5 py-0.5 rounded-full shrink-0">
                    {pendingDisplayList.length}
                  </span>
                )}
              </button>

              <button
                onClick={() => { setActiveTab("conflict"); setSelectedItem(null); }}
                className={`flex-1 py-2 px-1.5 rounded-lg text-xxs font-bold uppercase tracking-wider flex items-center justify-center gap-1 cursor-pointer transition-all ${
                  activeTab === "conflict"
                    ? "bg-white dark:bg-slate-800 text-amber-600 dark:text-amber-400 border border-slate-200 dark:border-slate-700 shadow-xs"
                    : "text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-900"
                }`}
              >
                Conflicts
                {offlineQueues.conflict.length > 0 && (
                  <span className="bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-400 text-[10px] font-black px-1.5 py-0.5 rounded-full shrink-0">
                    {offlineQueues.conflict.length}
                  </span>
                )}
              </button>

              <button
                onClick={() => { setActiveTab("completed"); setSelectedItem(null); }}
                className={`flex-1 py-2 px-1.5 rounded-lg text-xxs font-bold uppercase tracking-wider flex items-center justify-center gap-1 cursor-pointer transition-all ${
                  activeTab === "completed"
                    ? "bg-white dark:bg-slate-800 text-emerald-600 dark:text-emerald-400 border border-slate-200 dark:border-slate-700 shadow-xs"
                    : "text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-900"
                }`}
              >
                Synced
                {offlineQueues.completed.length > 0 && (
                  <span className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-400 text-[10px] font-black px-1.5 py-0.5 rounded-full shrink-0">
                    {offlineQueues.completed.length}
                  </span>
                )}
              </button>

              <button
                onClick={() => { setActiveTab("failed"); setSelectedItem(null); }}
                className={`flex-1 py-2 px-1.5 rounded-lg text-xxs font-bold uppercase tracking-wider flex items-center justify-center gap-1 cursor-pointer transition-all ${
                  activeTab === "failed"
                    ? "bg-white dark:bg-slate-800 text-rose-600 dark:text-rose-400 border border-slate-200 dark:border-slate-700 shadow-xs"
                    : "text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-900"
                }`}
              >
                Failed
                {offlineQueues.failed.length > 0 && (
                  <span className="bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-400 text-[10px] font-black px-1.5 py-0.5 rounded-full shrink-0">
                    {offlineQueues.failed.length}
                  </span>
                )}
              </button>
            </div>

            {/* List area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              
              {/* Tab: Pending / Retry Queue */}
              {activeTab === "pending" && (
                <>
                  {pendingDisplayList.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center py-16 px-4">
                      <CheckCircle2 size={36} className="text-slate-300 dark:text-slate-700 mb-2" />
                      <p className="text-xs font-bold text-slate-700 dark:text-slate-300">Pending offline queue is empty</p>
                      <p className="text-[10px] text-slate-400 mt-1">All newly created visits, orders, and logs have been synced.</p>
                    </div>
                  ) : (
                    pendingDisplayList.map((item) => (
                      <div
                        key={item.id}
                        onClick={() => setSelectedItem(item)}
                        className={`p-3.5 rounded-xl border transition-all cursor-pointer text-left flex flex-col gap-1.5 ${
                          selectedItem?.id === item.id
                            ? "bg-blue-50/50 dark:bg-blue-950/20 border-blue-400 dark:border-blue-800/80 shadow-xs"
                            : item.retryCount > 0
                            ? "bg-amber-50/20 hover:bg-slate-50 dark:hover:bg-slate-900 border-amber-200 dark:border-amber-900/40"
                            : "bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-900 border-slate-150 dark:border-slate-800/60"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-mono text-slate-400 uppercase font-black tracking-wider">
                            {item.id}
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono flex items-center gap-1">
                            <Clock size={10} />
                            {new Date(item.createdAt).toLocaleTimeString()}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-slate-800 dark:text-slate-200 text-xs truncate">
                            {item.module === "physicianVisit" && `Dr. ${item.data.physicianName || "Physician Visit"}`}
                            {item.module === "pharmacyVisit" && `${item.data.pharmacyName || "Pharmacy Visit"}`}
                            {item.module === "order" && `Order Total: ${offlineMoney(item)}`}
                            {item.module === "sample" && `Sample Disbursal: ${item.data.productName || "Product"}`}
                            {item.module === "stock" && `Warehouse Update`}
                            {item.module === "medicalPlanner" && `Medical Planner Approval`}
                            {item.module === "salesPlanner" && `Sales Planner Approval`}
                            {item.module === "gps" && `GPS Verification Check`}
                            {item.module === "note" && `productivity Note`}
                          </span>
                          <span className={`px-2 py-0.5 rounded border text-[9px] font-bold uppercase shrink-0 ${getModuleBadgeColor(item.module)}`}>
                            {item.module}
                          </span>
                        </div>
                        {item.retryCount > 0 && (
                          <div className="flex items-center gap-1.5 bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 px-2.5 py-1 rounded-md text-[10px] border border-amber-100 dark:border-amber-900/30">
                            <AlertTriangle size={11} className="shrink-0 animate-pulse" />
                            <span className="truncate font-semibold">
                              Retrying... Attempt #{item.retryCount} (Error: {item.lastError})
                            </span>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </>
              )}

              {/* Tab: Conflicts */}
              {activeTab === "conflict" && (
                <>
                  {offlineQueues.conflict.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center py-16 px-4">
                      <CheckCircle2 size={36} className="text-slate-300 dark:text-slate-700 mb-2" />
                      <p className="text-xs font-bold text-slate-700 dark:text-slate-300">No active conflicts detected</p>
                      <p className="text-[10px] text-slate-400 mt-1">Perfect transactional integrity. No concurrent version collisions.</p>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between pb-1" id="conflict-tab-header">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">COLLISION RESOLUTION REQUIRED</span>
                        <button
                          onClick={() => handleClear("conflict")}
                          className="text-[10px] font-bold text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
                        >
                          Clear Queue
                        </button>
                      </div>
                      {offlineQueues.conflict.map((item) => (
                        <div
                          key={item.id}
                          onClick={() => setSelectedItem(item)}
                          className={`p-3.5 rounded-xl border transition-all cursor-pointer text-left flex flex-col gap-1.5 bg-amber-50/20 dark:bg-amber-950/5 border-amber-300 dark:border-amber-900/60 ${
                            selectedItem?.id === item.id ? "ring-2 ring-amber-500/50" : ""
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-mono text-amber-700 dark:text-amber-400 uppercase font-black tracking-wider">
                              COLLISION: {item.id}
                            </span>
                            <span className="text-[10px] text-amber-600 dark:text-amber-400 font-mono font-bold uppercase flex items-center gap-1 animate-pulse">
                              <AlertTriangle size={10} />
                              BLOCKED
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-slate-800 dark:text-slate-200 text-xs truncate">
                              {item.module === "physicianVisit" && `Dr. ${item.data.physicianName || "Physician Visit"}`}
                              {item.module === "pharmacyVisit" && `${item.data.pharmacyName || "Pharmacy Visit"}`}
                              {item.module === "order" && `Order ID: ${item.data.id}`}
                              {item.module === "medicalPlanner" && `Medical Plan Period`}
                              {item.module === "salesPlanner" && `Sales Plan Period`}
                            </span>
                            <span className={`px-2 py-0.5 rounded border text-[9px] font-bold uppercase shrink-0 ${getModuleBadgeColor(item.module)}`}>
                              {item.module}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-900 p-2 rounded border border-slate-100 dark:border-slate-800 font-mono">
                            {item.conflictDetails || "Unknown collision cause."}
                          </p>
                        </div>
                      ))}
                    </>
                  )}
                </>
              )}

              {/* Tab: Succeeded */}
              {activeTab === "completed" && (
                <>
                  {offlineQueues.completed.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center py-16 px-4">
                      <RefreshCw size={36} className="text-slate-300 dark:text-slate-700 mb-2" />
                      <p className="text-xs font-bold text-slate-700 dark:text-slate-300">No synced history on this device yet</p>
                      <p className="text-[10px] text-slate-400 mt-1">Once connection resumes, pending queues will sync here.</p>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between pb-1" id="completed-tab-header">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">SUCCESSFULLY UPLOADED TO CLOUD</span>
                        <button
                          onClick={() => handleClear("completed")}
                          className="text-[10px] font-bold text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
                        >
                          Clear Log
                        </button>
                      </div>
                      {offlineQueues.completed.map((item) => (
                        <div
                          key={item.id}
                          onClick={() => setSelectedItem(item)}
                          className={`p-3.5 rounded-xl border transition-all cursor-pointer text-left flex flex-col gap-1 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-900 border-slate-150 dark:border-slate-800/60 ${
                            selectedItem?.id === item.id ? "bg-emerald-50/10 border-emerald-400 dark:border-emerald-900/60" : ""
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 uppercase font-black tracking-wider flex items-center gap-1">
                              <CheckCircle2 size={10} />
                              {item.id}
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono">
                              {new Date(item.updatedAt).toLocaleTimeString()}
                            </span>
                          </div>
                          <span className="font-semibold text-slate-800 dark:text-slate-200 text-xs truncate">
                            {item.module === "physicianVisit" && `Dr. ${item.data.physicianName || "Physician Visit"}`}
                            {item.module === "pharmacyVisit" && `${item.data.pharmacyName || "Pharmacy Visit"}`}
                            {item.module === "order" && `Order ID: ${item.data.id}`}
                            {item.module === "sample" && `Sample Disbursed: ${item.data.productName}`}
                            {item.module === "stock" && `Warehouse Update`}
                            {item.module === "medicalPlanner" && `Medical Planner Approved`}
                            {item.module === "salesPlanner" && `Sales Planner Approved`}
                          </span>
                        </div>
                      ))}
                    </>
                  )}
                </>
              )}

              {/* Tab: Failed */}
              {activeTab === "failed" && (
                <>
                  {offlineQueues.failed.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center py-16 px-4">
                      <CheckCircle2 size={36} className="text-slate-300 dark:text-slate-700 mb-2" />
                      <p className="text-xs font-bold text-slate-700 dark:text-slate-300">No failed offline logs</p>
                      <p className="text-[10px] text-slate-400 mt-1">Excellent performance. All requests executed flawlessly.</p>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between pb-1" id="failed-tab-header">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">CRITICAL UPLOAD FAILURES</span>
                        <button
                          onClick={() => handleClear("failed")}
                          className="text-[10px] font-bold text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
                        >
                          Clear All
                        </button>
                      </div>
                      {offlineQueues.failed.map((item) => (
                        <div
                          key={item.id}
                          onClick={() => setSelectedItem(item)}
                          className={`p-3.5 rounded-xl border transition-all cursor-pointer text-left flex flex-col gap-1.5 bg-rose-50/10 dark:bg-rose-950/5 border-rose-300 dark:border-rose-900/55 ${
                            selectedItem?.id === item.id ? "ring-2 ring-rose-500/50" : ""
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-mono text-rose-700 dark:text-rose-400 uppercase font-black tracking-wider">
                              CRITICAL: {item.id}
                            </span>
                            <span className="text-[10px] text-rose-600 dark:text-rose-400 font-mono font-bold uppercase flex items-center gap-1">
                              <AlertTriangle size={10} />
                              HALTED
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-slate-800 dark:text-slate-200 text-xs truncate">
                              {item.module === "physicianVisit" && `Dr. ${item.data.physicianName || "Physician Visit"}`}
                              {item.module === "pharmacyVisit" && `${item.data.pharmacyName || "Pharmacy Visit"}`}
                              {item.module === "order" && `Order Total: ${item.data.total || 0}`}
                            </span>
                            <span className={`px-2 py-0.5 rounded border text-[9px] font-bold uppercase shrink-0 ${getModuleBadgeColor(item.module)}`}>
                              {item.module}
                            </span>
                          </div>
                          <p className="text-[10px] text-rose-700 dark:text-rose-400 bg-rose-500/5 dark:bg-rose-950/20 p-2 rounded border border-rose-100 dark:border-rose-950/50 font-mono truncate">
                            Error: {item.lastError || "No exception message provided."}
                          </p>
                        </div>
                      ))}
                    </>
                  )}
                </>
              )}

            </div>
          </div>

          {/* Right panel: Full inspection and manual overrides */}
          <div className="w-1/2 flex flex-col h-full bg-slate-50/10 dark:bg-slate-900/10 p-5 overflow-y-auto">
            {selectedItem ? (
              <div className="space-y-5 animate-fade-in text-left" id="sync-inspector-panel">
                
                {/* Entity status block */}
                <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-4 bg-white dark:bg-slate-950 shadow-xs space-y-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="text-[10px] bg-slate-100 dark:bg-slate-900 px-2 py-0.5 rounded text-slate-500 dark:text-slate-400 font-mono uppercase font-black">
                        ID: {selectedItem.id}
                      </span>
                      <h4 className="font-bold text-sm text-slate-800 dark:text-white mt-1.5">
                        {selectedItem.module === "physicianVisit" && "Physician Visit Detailing"}
                        {selectedItem.module === "pharmacyVisit" && "Pharmacy Sales Visit"}
                        {selectedItem.module === "order" && "Sales Commercial Order"}
                        {selectedItem.module === "sample" && "Sample Disbursal Record"}
                        {selectedItem.module === "stock" && "Stock Adjustment Receipt"}
                        {selectedItem.module === "medicalPlanner" && "Medical Planner Period Approval"}
                        {selectedItem.module === "salesPlanner" && "Sales Planner Period Approval"}
                        {selectedItem.module === "gps" && "GPS Verification Audit Log"}
                        {selectedItem.module === "note" && "productivity Memo Note"}
                        {selectedItem.module === "attachment" && "Media Attachment metadata"}
                      </h4>
                    </div>
                    <span className={`px-2.5 py-1 rounded-full border text-[10px] font-bold uppercase tracking-wider ${
                      selectedItem.status === "pending" || selectedItem.status === "uploading"
                        ? "bg-blue-50 border-blue-200 text-blue-600 dark:bg-blue-950/20 dark:border-blue-900/30 dark:text-blue-400"
                        : selectedItem.status === "uploaded"
                        ? "bg-emerald-50 border-emerald-200 text-emerald-600 dark:bg-emerald-950/20 dark:border-emerald-900/30 dark:text-emerald-400"
                        : selectedItem.status === "conflict"
                        ? "bg-amber-50 border-amber-200 text-amber-600 dark:bg-amber-950/20 dark:border-amber-900/30 dark:text-amber-400 animate-pulse"
                        : "bg-rose-50 border-rose-200 text-rose-600 dark:bg-rose-950/20 dark:border-rose-900/30 dark:text-rose-400"
                    }`}>
                      {selectedItem.status}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-2 text-[10px] font-medium text-slate-500 dark:text-slate-400 border-t border-slate-100 dark:border-slate-900">
                    <div>
                      <span className="block text-[9px] text-slate-400 uppercase font-bold">Action Type:</span>
                      <span className="font-bold text-slate-700 dark:text-slate-200 uppercase">{selectedItem.action}</span>
                    </div>
                    <div>
                      <span className="block text-[9px] text-slate-400 uppercase font-bold">Retry count:</span>
                      <span className="font-mono text-slate-700 dark:text-slate-200">{selectedItem.retryCount} / 3</span>
                    </div>
                    <div>
                      <span className="block text-[9px] text-slate-400 uppercase font-bold">Created at:</span>
                      <span className="font-mono">{new Date(selectedItem.createdAt).toLocaleString()}</span>
                    </div>
                    <div>
                      <span className="block text-[9px] text-slate-400 uppercase font-bold">Origin Representative:</span>
                      <span className="truncate block font-bold text-slate-700 dark:text-slate-200">
                        {selectedItem.userName || "Unknown Rep"} ({selectedItem.userId})
                      </span>
                    </div>
                  </div>
                </div>

                {/* Overrides and manual resolve actions block */}
                {selectedItem.status === "conflict" && (
                  <div className="border border-amber-200 dark:border-amber-900/50 bg-amber-500/5 rounded-xl p-4 space-y-3">
                    <div className="flex gap-2 text-amber-800 dark:text-amber-400">
                      <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                      <div>
                        <h5 className="font-bold text-xs uppercase tracking-wider">COLLISION CONFLICT LOCK</h5>
                        <p className="text-[10px] leading-relaxed mt-1">
                          Another representative or manager has updated this record concurrently on the server. You must resolve this conflict.
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <button
                        onClick={() => handleResolve(selectedItem.id, "server_wins")}
                        className="py-2 px-3 rounded-lg bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xxs font-bold cursor-pointer transition-all uppercase tracking-wide flex items-center justify-center gap-1.5"
                      >
                        Accept Server
                        <ArrowRight size={11} />
                      </button>
                      <button
                        onClick={() => handleResolve(selectedItem.id, "client_wins")}
                        className="py-2 px-3 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xxs font-bold cursor-pointer transition-all uppercase tracking-wide flex items-center justify-center gap-1.5 shadow-xs"
                      >
                        <Sparkles size={11} />
                        Force Client
                      </button>
                    </div>
                  </div>
                )}

                {selectedItem.status === "failed" && (
                  <div className="border border-rose-200 dark:border-rose-900/50 bg-rose-500/5 rounded-xl p-4 space-y-3">
                    <div className="flex gap-2 text-rose-800 dark:text-rose-400">
                      <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                      <div>
                        <h5 className="font-bold text-xs uppercase tracking-wider">CRITICAL UPLOAD FAILURE</h5>
                        <p className="text-[10px] leading-relaxed font-mono mt-1 bg-white dark:bg-slate-900 p-2 rounded border border-rose-100/50 dark:border-rose-950/40">
                          {selectedItem.lastError || "Unknown exception block."}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleRetry(selectedItem.id)}
                        className="flex-1 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xxs font-bold cursor-pointer transition-all uppercase tracking-wider flex items-center justify-center gap-1 shadow-xs"
                      >
                        <RefreshCw size={11} />
                        Force Retry Now
                      </button>
                      <button
                        onClick={() => handleDelete(selectedItem.id, activeTab)}
                        className="p-2 rounded-lg border border-rose-200 dark:border-rose-900 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/20 cursor-pointer transition-all"
                        title="Delete from Queue"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                )}

                {/* Raw payload inspector */}
                <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-4 bg-white dark:bg-slate-950 shadow-xs flex flex-col min-h-[150px]" id="payload-inspector-json">
                  <div className="flex justify-between items-center pb-2 border-b border-slate-100 dark:border-slate-900 shrink-0">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                      <Database size={11} />
                      PAYLOAD ENVELOPE INSPECTOR
                    </span>
                    <span className="text-[9px] text-slate-400 font-mono">
                      Strict Master master-data structure
                    </span>
                  </div>
                  <pre className="flex-1 text-[10px] font-mono text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-900 p-3 rounded-lg border border-slate-100 dark:border-slate-900 overflow-auto mt-3 max-h-[220px]">
                    {JSON.stringify(selectedItem.data, null, 2)}
                  </pre>
                </div>

              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center py-20 px-6">
                <Eye size={42} className="text-slate-300 dark:text-slate-700 mb-2" />
                <p className="text-xs font-bold text-slate-700 dark:text-slate-300">Select an item to inspect</p>
                <p className="text-[10px] text-slate-400 mt-1 max-w-[250px]">
                  View complete master-data schema payloads, diagnose retry attempts, or bypass transactional collision blocks.
                </p>
              </div>
            )}
          </div>

        </div>

        {/* Footer controls */}
        <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 flex items-center justify-between shrink-0" id="sync-modal-footer">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <p className="text-xxs font-medium text-slate-500 dark:text-slate-400">
              Offline Cache Engine initialized • Persistent Cache Storage: <strong>LocalForage/LocalStorage</strong>
            </p>
          </div>
          <button
            onClick={handleManualSync}
            disabled={isSyncing || connectivityStatus === "offline" || pendingDisplayList.length === 0}
            className={`py-2 px-4 rounded-xl text-xs font-bold cursor-pointer transition-all flex items-center gap-1.5 uppercase tracking-wide shadow-md ${
              isSyncing
                ? "bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed border border-slate-200 dark:border-slate-700"
                : connectivityStatus === "offline" || pendingDisplayList.length === 0
                ? "bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed border border-slate-100 dark:border-slate-800/80"
                : "bg-blue-600 hover:bg-blue-700 text-white"
            }`}
          >
            {isSyncing ? (
              <>
                <RefreshCw size={13} className="animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <RefreshCw size={13} />
                Sync Pending Now
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
}
