import React, { useState } from "react";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Plus,
  X,
  ChevronDown,
  Check,
  Users,
  Clock,
  FileText
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface MeetingHubProps {
  lang: "en" | "ar";
}

interface MeetingItem {
  id: string;
  title: string;
  date: string;
  time: string;
  scope: string;
  agenda: string;
}

export default function MeetingHub({ lang }: MeetingHubProps) {
  const isRtl = lang === "ar";

  // Week days matching screenshot 7 exact dates Sun 21 to Sat 27
  const weekDays = [
    { dayName: isRtl ? "الأحد" : "Sun", dayNum: "21" },
    { dayName: isRtl ? "الاثنين" : "Mon", dayNum: "22" },
    { dayName: isRtl ? "الثلاثاء" : "Tue", dayNum: "23" },
    { dayName: isRtl ? "الأربعاء" : "Wed", dayNum: "24" },
    { dayName: isRtl ? "الخميس" : "Thu", dayNum: "25" },
    { dayName: isRtl ? "الجمعة" : "Fri", dayNum: "26" },
    { dayName: isRtl ? "السبت" : "Sat", dayNum: "27" }
  ];

  const [selectedDate, setSelectedDate] = useState("27");
  const [isModalOpen, setIsModalOpen] = useState(false);

  // New Meeting Form State matching screenshots 8, 9, 10
  const [meetingDate, setMeetingDate] = useState("27-Jun-2026");
  const [duration, setDuration] = useState("Full Day");
  const [isDurationMenuOpen, setIsDurationMenuOpen] = useState(false);

  const [teamScope, setTeamScope] = useState("Direct Reports");
  const [isTeamScopeMenuOpen, setIsTeamScopeMenuOpen] = useState(false);

  const [agenda, setAgenda] = useState("Sales");
  const [isAgendaMenuOpen, setIsAgendaMenuOpen] = useState(false);
  const [agendaDetails, setAgendaDetails] = useState("");

  const [selectedInvitees, setSelectedInvitees] = useState<string[]>([
    "Libyasmm Manager",
    "libyaMedical Manager",
    "libyaM Marketing",
    "Hisham Rajab",
    "Esam Rajab"
  ]);

  const [notes, setNotes] = useState("");
  const [meetings, setMeetings] = useState<MeetingItem[]>([]);
  const [toast, setToast] = useState("");

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  };

  const t = {
    title: isRtl ? "مركز الاجتماعات" : "Meeting Hub",
    subtitle: isRtl ? "جدولة وإدارة اجتماعات فريق العمل" : "Schedule and manage team meetings",
    newMeeting: isRtl ? "اجتماع جديد" : "New Meeting",
    meetingsFor: isRtl ? "اجتماعات يوم السبت، 27 يونيو" : "Meetings for Saturday, June 27",
    noMeetings: isRtl ? "لا توجد اجتماعات مجدولة" : "No meetings scheduled",
    scheduleAMeeting: isRtl ? "جدولة اجتماع" : "Schedule a Meeting",
    upcomingMeetings: isRtl ? "الاجتماعات القادمة" : "Upcoming Meetings",
    noUpcoming: isRtl ? "لا توجد اجتماعات قادمة" : "No upcoming meetings",
    modalTitle: isRtl ? "اجتماع جديد" : "New Meeting",
    dateLabel: isRtl ? "التاريخ" : "Date",
    durationLabel: isRtl ? "المدة" : "Duration",
    teamScopeLabel: isRtl ? "نطاق الفريق" : "Team Scope",
    agendaLabel: isRtl ? "بنود جدول الأعمال" : "Agenda Items",
    agendaPlaceholder: isRtl ? "أدخل تفاصيل جدول الأعمال" : "enter agenda details",
    inviteesLabel: isRtl ? "المدعوون" : "Invitees",
    notesLabel: isRtl ? "ملاحظات" : "Notes",
    notesPlaceholder: isRtl ? "أضف ملاحظات الاجتماع..." : "Add meeting notes...",
    cancel: isRtl ? "إلغاء" : "Cancel",
    createMeeting: isRtl ? "إنشاء اجتماع" : "Create Meeting",
    createdSuccess: isRtl ? "تم إنشاء الاجتماع بنجاح!" : "Meeting created successfully!"
  };

  const durationsList = [
    { id: "Full Day", label: isRtl ? "يوم كامل" : "Full Day" },
    { id: "1 Hour", label: isRtl ? "ساعة واحدة" : "1 Hour" },
    { id: "2 Hours", label: isRtl ? "ساعتان" : "2 Hours" }
  ];

  const teamScopesList = [
    { id: "Direct Reports", label: isRtl ? "التقارير المباشرة" : "Direct Reports" },
    { id: "All Subordinates", label: isRtl ? "جميع المرؤوسين" : "All Subordinates" },
    { id: "Custom Selection", label: isRtl ? "تحديد مخصص" : "Custom Selection" }
  ];

  const agendasList = [
    { id: "Sales", label: isRtl ? "المبيعات" : "Sales" },
    { id: "Marketing", label: isRtl ? "التسويق" : "Marketing" },
    { id: "Training", label: isRtl ? "التدريب" : "Training" }
  ];

  const inviteesList = [
    "Libyasmm Manager",
    "libyaMedical Manager",
    "libyaM Marketing",
    "Hisham Rajab",
    "Esam Rajab"
  ];

  const toggleInvitee = (name: string) => {
    setSelectedInvitees(prev =>
      prev.includes(name) ? prev.filter(i => i !== name) : [...prev, name]
    );
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newM: MeetingItem = {
      id: Date.now().toString(),
      title: agenda + (agendaDetails ? ` - ${agendaDetails}` : " Meeting"),
      date: meetingDate,
      time: duration,
      scope: teamScope,
      agenda: agenda
    };
    setMeetings(prev => [...prev, newM]);
    setIsModalOpen(false);
    showToast(t.createdSuccess);
    setAgendaDetails("");
    setNotes("");
  };

  return (
    <div className="w-full max-w-7xl mx-auto p-4 md:p-8 text-slate-800 dark:text-slate-100" dir={isRtl ? "rtl" : "ltr"}>
      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-5 right-5 z-50 bg-[#2563eb] text-white px-4 py-3 rounded-xl shadow-lg flex items-center gap-2 text-xs font-bold"
          >
            <Check size={16} />
            <span>{toast}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top Header Row (Screenshot 7 Exact Layout) */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            {t.title}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {t.subtitle}
          </p>
        </div>

        <button
          onClick={() => setIsModalOpen(true)}
          className="bg-[#2563eb] hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 shadow-sm transition-colors cursor-pointer shrink-0"
        >
          <Plus size={16} strokeWidth={2.5} />
          <span>{t.newMeeting}</span>
        </button>
      </div>

      {/* 7-Day Horizontal Calendar Navigator (Screenshot 7 Exact Layout) */}
      <div className="flex items-center gap-2 mt-6">
        <button
          type="button"
          className="p-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer shrink-0"
        >
          <ChevronLeft size={18} className={isRtl ? "rotate-180" : ""} />
        </button>

        <div className="grid grid-cols-7 gap-2 sm:gap-3 flex-1 overflow-x-auto">
          {weekDays.map(day => {
            const isSelected = day.dayNum === selectedDate;
            return (
              <div
                key={day.dayNum}
                onClick={() => setSelectedDate(day.dayNum)}
                className={`py-3 px-2 rounded-xl text-center flex flex-col items-center justify-center transition-all cursor-pointer min-w-[45px] sm:min-w-[70px] ${
                  isSelected
                    ? "bg-[#2563eb] text-white font-bold shadow-sm"
                    : "bg-slate-100 dark:bg-slate-900/60 text-slate-700 dark:text-slate-300 font-medium hover:bg-slate-200/70 dark:hover:bg-slate-800"
                }`}
              >
                <span className={`text-[11px] font-medium ${isSelected ? "text-blue-100" : "text-slate-400 dark:text-slate-500"}`}>
                  {day.dayName}
                </span>
                <span className="text-base sm:text-lg mt-0.5">
                  {day.dayNum}
                </span>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          className="p-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer shrink-0"
        >
          <ChevronRight size={18} className={isRtl ? "rotate-180" : ""} />
        </button>
      </div>

      {/* 2 Main Cards Side by Side (Screenshot 7 Exact Layout) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
        {/* Left Card: Meetings for selected day */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-6 shadow-xxs min-h-[380px] flex flex-col">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">
            {t.meetingsFor}
          </h2>

          <div className="flex-1 flex flex-col items-center justify-center py-16 text-center my-auto">
            {meetings.length === 0 ? (
              <>
                <div className="w-12 h-12 rounded-full border-2 border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-400 dark:text-slate-500 mb-3 shadow-xxs">
                  <Calendar size={24} />
                </div>
                <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-4">
                  {t.noMeetings}
                </p>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(true)}
                  className="px-4 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 transition-colors cursor-pointer shadow-xxs"
                >
                  <Plus size={14} />
                  <span>{t.scheduleAMeeting}</span>
                </button>
              </>
            ) : (
              <div className="w-full space-y-3 text-left">
                {meetings.map(m => (
                  <div key={m.id} className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between">
                    <div>
                      <h3 className="text-xs font-bold text-slate-900 dark:text-white">{m.title}</h3>
                      <p className="text-[11px] text-slate-500 mt-1">{m.scope} • {m.time}</p>
                    </div>
                    <span className="text-[10px] bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 font-bold px-2 py-1 rounded">
                      {m.agenda}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Card: Upcoming Meetings */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-6 shadow-xxs min-h-[380px] flex flex-col">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">
            {t.upcomingMeetings}
          </h2>

          <div className="flex-1 flex flex-col items-center justify-center py-16 text-center my-auto">
            <div className="w-12 h-12 rounded-full border-2 border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-400 dark:text-slate-500 mb-3 shadow-xxs">
              <Calendar size={24} />
            </div>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
              {t.noUpcoming}
            </p>
          </div>
        </div>
      </div>

      {/* Exact Replica Modal Dialog for New Meeting (Screenshots 8, 9, 10) */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 overflow-y-auto backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 15 }}
              className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden relative flex flex-col my-auto max-h-[90vh] text-left"
            >
              {/* Modal Header */}
              <div className="px-6 pt-6 pb-3 relative border-b border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="absolute top-5 right-5 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                  {t.modalTitle}
                </h2>
              </div>

              {/* Form Content */}
              <form onSubmit={handleCreateSubmit} className="px-6 py-4 overflow-y-auto space-y-4 flex-1 text-xs">
                {/* Date & Duration Row */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                      {t.dateLabel}
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        readOnly
                        value={meetingDate}
                        onChange={e => setMeetingDate(e.target.value)}
                        className="w-full px-3 py-2.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none shadow-xxs pr-9"
                      />
                      <Calendar size={14} className="absolute right-3 top-3 text-slate-800 dark:text-slate-200 pointer-events-none" />
                    </div>
                  </div>

                  {/* Duration Dropdown */}
                  <div className="relative">
                    <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                      {t.durationLabel}
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setIsDurationMenuOpen(!isDurationMenuOpen);
                        setIsTeamScopeMenuOpen(false);
                        setIsAgendaMenuOpen(false);
                      }}
                      className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-100 focus:outline-none shadow-xxs flex items-center justify-between cursor-pointer"
                    >
                      <span>{durationsList.find(d => d.id === duration)?.label}</span>
                      <ChevronDown size={15} className="text-slate-400" />
                    </button>

                    <AnimatePresence>
                      {isDurationMenuOpen && (
                        <motion.div
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 4 }}
                          className="absolute left-0 right-0 top-full mt-1 bg-slate-100/95 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-30 p-1.5 space-y-1 text-xs backdrop-blur-md"
                        >
                          {durationsList.map(item => (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => {
                                setDuration(item.id);
                                setIsDurationMenuOpen(false);
                              }}
                              className={`w-full px-3 py-1.5 rounded-lg text-left flex items-center justify-between transition-colors cursor-pointer ${
                                duration === item.id ? "font-bold text-slate-900 dark:text-white" : "text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-700"
                              }`}
                            >
                              <span>{item.label}</span>
                              {duration === item.id && <Check size={14} />}
                            </button>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                {/* Team Scope (Screenshot 9 Exact Replica) */}
                <div className="relative">
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {t.teamScopeLabel}
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setIsTeamScopeMenuOpen(!isTeamScopeMenuOpen);
                      setIsDurationMenuOpen(false);
                      setIsAgendaMenuOpen(false);
                    }}
                    className={`w-full px-3.5 py-2.5 bg-white dark:bg-slate-950 border rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-100 focus:outline-none shadow-xxs flex items-center justify-between cursor-pointer ${
                      isTeamScopeMenuOpen ? "border-[#2563eb]" : "border-slate-200 dark:border-slate-800"
                    }`}
                  >
                    <span>{teamScopesList.find(s => s.id === teamScope)?.label}</span>
                    <ChevronDown size={15} className="text-slate-400" />
                  </button>

                  <AnimatePresence>
                    {isTeamScopeMenuOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 4 }}
                        className="absolute left-0 right-0 top-full mt-1.5 bg-slate-100/95 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-30 p-2 space-y-1 text-xs backdrop-blur-md"
                      >
                        {teamScopesList.map(item => {
                          const isSelected = teamScope === item.id;
                          return (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => {
                                setTeamScope(item.id);
                                setIsTeamScopeMenuOpen(false);
                              }}
                              className={`w-full px-3 py-2 rounded-lg text-left flex items-center gap-2.5 transition-colors cursor-pointer ${
                                isSelected ? "font-bold text-slate-900 dark:text-white" : "text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-700"
                              }`}
                            >
                              <span className="w-4 flex items-center justify-center">
                                {isSelected && <Check size={14} className="text-slate-900 dark:text-white" />}
                              </span>
                              <span>{item.label}</span>
                            </button>
                          );
                        })}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Agenda Items (Screenshot 10 Exact Replica) */}
                <div className="relative space-y-2">
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    {t.agendaLabel}
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setIsAgendaMenuOpen(!isAgendaMenuOpen);
                      setIsTeamScopeMenuOpen(false);
                      setIsDurationMenuOpen(false);
                    }}
                    className={`w-full px-3.5 py-2.5 bg-white dark:bg-slate-950 border rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-100 focus:outline-none shadow-xxs flex items-center justify-between cursor-pointer ${
                      isAgendaMenuOpen ? "border-[#2563eb]" : "border-slate-200 dark:border-slate-800"
                    }`}
                  >
                    <span>{agendasList.find(a => a.id === agenda)?.label}</span>
                    <ChevronDown size={15} className="text-slate-400" />
                  </button>

                  <AnimatePresence>
                    {isAgendaMenuOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 4 }}
                        className="absolute left-0 right-0 top-10 mt-1.5 bg-slate-100/95 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-30 p-2 space-y-1 text-xs backdrop-blur-md"
                      >
                        {agendasList.map(item => {
                          const isSelected = agenda === item.id;
                          return (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => {
                                setAgenda(item.id);
                                setIsAgendaMenuOpen(false);
                              }}
                              className={`w-full px-3 py-2 rounded-lg text-left flex items-center gap-2.5 transition-colors cursor-pointer ${
                                isSelected ? "font-bold text-slate-900 dark:text-white" : "text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-700"
                              }`}
                            >
                              <span className="w-4 flex items-center justify-center">
                                {isSelected && <Check size={14} className="text-slate-900 dark:text-white" />}
                              </span>
                              <span>{item.label}</span>
                            </button>
                          );
                        })}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Textarea for enter agenda details */}
                  <textarea
                    rows={2}
                    value={agendaDetails}
                    onChange={e => setAgendaDetails(e.target.value)}
                    placeholder={t.agendaPlaceholder}
                    className="w-full p-3 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-blue-500 shadow-xxs resize-none mt-2"
                  />
                </div>

                {/* Invitees (Screenshot 8 Exact Replica) */}
                <div className="pt-1">
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-2">
                    {t.inviteesLabel}
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {inviteesList.map(inv => {
                      const isChecked = selectedInvitees.includes(inv);
                      return (
                        <button
                          key={inv}
                          type="button"
                          onClick={() => toggleInvitee(inv)}
                          className={`px-3 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-2 transition-colors cursor-pointer ${
                            isChecked
                              ? "bg-blue-50 dark:bg-blue-950/50 border-[#2563eb] text-blue-700 dark:text-blue-300 font-semibold"
                              : "bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100"
                          }`}
                        >
                          <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${isChecked ? "bg-[#2563eb] border-[#2563eb] text-white" : "border-slate-300 dark:border-slate-600"}`}>
                            {isChecked && <Check size={11} strokeWidth={3} />}
                          </div>
                          <span>{inv}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Notes Textarea (Screenshot 8 Exact Replica) */}
                <div className="pt-1">
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {t.notesLabel}
                  </label>
                  <textarea
                    rows={3}
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder={t.notesPlaceholder}
                    className="w-full p-3 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-blue-500 shadow-xxs resize-none"
                  />
                </div>

                {/* Footer Actions */}
                <div className="flex items-center justify-end gap-3 pt-5 pb-1 border-t border-slate-100 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-semibold cursor-pointer transition-colors shadow-xxs"
                  >
                    {t.cancel}
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2.5 bg-[#2563eb] hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-sm cursor-pointer transition-colors"
                  >
                    {t.createMeeting}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
