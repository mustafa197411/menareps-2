import React, { useState, useEffect } from "react";
import {
  Bell,
  Check,
  Trash2,
  CheckCircle2,
  Calendar,
  ShoppingCart,
  Coins,
  Warehouse,
  FileText,
  Package,
  Truck,
  ShieldAlert,
  ArrowUpRight
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { doc, setDoc, deleteDoc } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { User, Notification } from "../../types";
import { 
  subscribeToNotifications, 
  markNotificationStatus, 
  markAllNotificationsAsRead 
} from "../../lib/notificationService";
import { decorateRecord } from "../../lib/firebaseSync";

interface NotificationsHubProps {
  lang: "en" | "ar";
  currentUser: User;
  setActiveView: (view: string) => void;
  profileLoaded?: boolean;
}

export default function NotificationsHub({ lang, currentUser, setActiveView, profileLoaded }: NotificationsHubProps) {
  const isRtl = lang === "ar";
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profileLoaded) return;
    if (!currentUser) return;

    setLoading(true);
    const unsubscribe = subscribeToNotifications(
      currentUser.id,
      currentUser.role,
      (loadedNotifs) => {
        setNotifications(loadedNotifs);
        setLoading(false);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [currentUser, profileLoaded]);

  const unreadCount = notifications.filter(n => n.status === "unread").length;

  const handleMarkAllRead = async () => {
    if (!currentUser) return;
    try {
      await markAllNotificationsAsRead(currentUser.id, currentUser.role);
      
      // Audit log
      const auditLogId = `AUD-EXP-${Math.floor(100000 + Math.random() * 900000)}`;
      await setDoc(doc(db, "auditLogs", auditLogId), decorateRecord({
        id: auditLogId,
        userId: currentUser.id,
        userName: currentUser.name,
        userRole: currentUser.role,
        action: "All Notifications Marked Read",
        entityType: "Notification",
        entityId: currentUser.id,
        details: `Operator ${currentUser.name} marked all active notifications as read.`,
        timestamp: new Date().toISOString()
      }, currentUser.id, "create"));
    } catch (err) {
      console.error("Mark all notifications read error:", err);
    }
  };

  const handleDelete = async (id: string, title: string) => {
    if (!currentUser) return;
    try {
      await deleteDoc(doc(db, "notifications", id));

      // Audit log
      const auditLogId = `AUD-EXP-${Math.floor(100000 + Math.random() * 900000)}`;
      await setDoc(doc(db, "auditLogs", auditLogId), decorateRecord({
        id: auditLogId,
        userId: currentUser.id,
        userName: currentUser.name,
        userRole: currentUser.role,
        action: "Notification Dismissed",
        entityType: "Notification",
        entityId: id,
        details: `Operator ${currentUser.name} dismissed notification: "${title}"`,
        timestamp: new Date().toISOString()
      }, currentUser.id, "create"));
    } catch (err) {
      console.error("Delete notification error:", err);
    }
  };

  const mapDeepLinkToView = (deepLink?: string): string | null => {
    if (!deepLink) return null;
    const path = deepLink.split("?")[0];
    switch (path) {
      case "/supervision/approvals":
      case "/supervision/orders":
        return "supervision-approvals";
      case "/finance/manager":
        return "finance-dashboard";
      case "/inventory/manager":
        return "inventory-dashboard";
      case "/operations/hub":
        return "operations-order-operations";
      case "/samples/requests":
        return "samples-requests";
      case "/marketing/materials":
        return "marketing-materials-requests";
      default:
        return null;
    }
  };

  const handleNotificationClick = async (notif: Notification) => {
    if (!currentUser) return;
    try {
      if (notif.status === "unread") {
        await markNotificationStatus(notif.id, "read", currentUser.id);
      }
      
      const mappedView = mapDeepLinkToView(notif.deepLink);
      if (mappedView) {
        setActiveView(mappedView);
      }
    } catch (err) {
      console.error("Notification click handling error:", err);
    }
  };

  const getCategoryIcon = (category?: string) => {
    switch (category) {
      case "planner":
        return <Calendar size={20} className="text-indigo-600 shrink-0 mt-0.5" />;
      case "order":
        return <ShoppingCart size={20} className="text-amber-600 shrink-0 mt-0.5" />;
      case "finance":
      case "finance_alert":
        return <Coins size={20} className="text-emerald-600 shrink-0 mt-0.5" />;
      case "sample":
        return <Warehouse size={20} className="text-sky-600 shrink-0 mt-0.5" />;
      case "marketing":
        return <FileText size={20} className="text-purple-600 shrink-0 mt-0.5" />;
      case "warehouse":
      case "stock":
        return <Package size={20} className="text-rose-600 shrink-0 mt-0.5" />;
      case "delivery":
        return <Truck size={20} className="text-teal-600 shrink-0 mt-0.5" />;
      default:
        return <Bell size={20} className="text-slate-600 shrink-0 mt-0.5" />;
    }
  };

  const formatNotifTime = (isoString: string) => {
    if (!isoString) return "";
    const diffMs = Date.now() - new Date(isoString).getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return isRtl ? "الآن" : "Just now";
    if (diffMins < 60) return isRtl ? `منذ ${diffMins} دقيقة` : `${diffMins} mins ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return isRtl ? `منذ ${diffHours} ساعة` : `${diffHours} hours ago`;
    const diffDays = Math.floor(diffHours / 24);
    return isRtl ? `منذ ${diffDays} يوم` : `${diffDays} days ago`;
  };

  const t = {
    title: isRtl ? "الإشعارات" : "Notifications",
    unreadBadge: isRtl ? `${unreadCount} غير مقروء` : `${unreadCount} unread`,
    markAllRead: isRtl ? "تحديد الكل كمقروء" : "Mark All Read",
    earlier: isRtl ? "سابقاً" : "Earlier",
    noNotifs: isRtl ? "لا توجد إشعارات حالياً" : "No notifications available",
    loading: isRtl ? "جاري تحميل الإشعارات..." : "Loading notifications..."
  };

  return (
    <div className="w-full max-w-7xl mx-auto p-4 md:p-8 text-slate-800 dark:text-slate-100" dir={isRtl ? "rtl" : "ltr"}>
      {/* Top Header Row */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Bell size={24} className="text-slate-800 dark:text-slate-200" />
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            {t.title}
          </h1>
          {unreadCount > 0 && (
            <span className="bg-slate-200/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs px-2.5 py-0.5 rounded-md font-semibold">
              {t.unreadBadge}
            </span>
          )}
        </div>

        {unreadCount > 0 && (
          <button
            onClick={handleMarkAllRead}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 px-4 py-2 rounded-xl font-semibold text-xs flex items-center gap-2 shadow-xxs transition-colors cursor-pointer shrink-0"
          >
            <Check size={16} className="text-slate-800 dark:text-slate-200" />
            <span>{t.markAllRead}</span>
          </button>
        )}
      </div>

      {/* Earlier Section Title */}
      <div className="mt-8 mb-3">
        <span className="text-xs font-semibold text-slate-400 dark:text-slate-500 block">
          {t.earlier}
        </span>
      </div>

      {/* Notifications Cards Feed */}
      <div className="space-y-3">
        {loading ? (
          <div className="py-16 text-center text-slate-400 text-sm">
            <CheckCircle2 size={32} className="mx-auto mb-2 opacity-40 animate-pulse" />
            <p>{t.loading}</p>
          </div>
        ) : (
          <AnimatePresence>
            {notifications.length === 0 ? (
              <div className="py-16 text-center text-slate-400 text-sm">
                <CheckCircle2 size={32} className="mx-auto mb-2 opacity-40" />
                <p>{t.noNotifs}</p>
              </div>
            ) : (
              notifications.map(notif => (
                <motion.div
                  key={notif.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  className={`rounded-2xl p-4 flex items-start justify-between gap-4 border border-slate-200/50 dark:border-slate-800/80 relative group hover:bg-slate-100 dark:hover:bg-slate-900/60 transition-colors ${
                    notif.status === "unread"
                      ? "bg-slate-50/90 dark:bg-slate-900/60 border-l-4 border-l-indigo-600 dark:border-l-indigo-500"
                      : "bg-slate-100/70 dark:bg-slate-900/40"
                  }`}
                >
                  <div 
                    onClick={() => handleNotificationClick(notif)}
                    className="flex items-start gap-3 flex-1 cursor-pointer"
                  >
                    {getCategoryIcon(notif.category)}
                    <div className="flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-slate-900 dark:text-white">
                          {notif.title}
                        </span>
                        {notif.priority === "high" && (
                          <span className="bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-400 text-[10px] px-1.5 py-0.2 rounded font-mono font-bold uppercase tracking-wider">
                            {isRtl ? "عاجل" : "Urgent"}
                          </span>
                        )}
                        {notif.status === "unread" && (
                          <span className="w-2 h-2 rounded-full bg-[#2563eb] inline-block" />
                        )}
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                        {notif.message}
                      </p>
                      
                      <div className="flex items-center gap-3 mt-2">
                        <span className="text-[10px] text-slate-400 font-medium">
                          {formatNotifTime(notif.createdAt)}
                        </span>
                        {notif.deepLink && (
                          <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-semibold flex items-center gap-1">
                            {isRtl ? "انتقال سريع" : "Deep Link"} <ArrowUpRight size={10} />
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => handleDelete(notif.id, notif.title)}
                    className="text-slate-400 hover:text-red-600 dark:hover:text-red-400 p-1 rounded-lg transition-colors cursor-pointer shrink-0 mt-0.5"
                    title="Delete"
                  >
                    <Trash2 size={16} />
                  </button>
                </motion.div>
              ))
            )}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
