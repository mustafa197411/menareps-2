import React, { useState } from "react";
import {
  FileText,
  Plus,
  Search,
  Trash2,
  X,
  Check,
  Tag,
  Clock
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface NotesHubProps {
  lang: "en" | "ar";
}

interface NoteItem {
  id: string;
  title: string;
  content: string;
  category: string;
  date: string;
}

export default function NotesHub({ lang }: NotesHubProps) {
  const isRtl = lang === "ar";

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCat, setSelectedCat] = useState("All");
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState("Field Visit");

  const [notes, setNotes] = useState<NoteItem[]>([
    {
      id: "1",
      title: isRtl ? "ملاحظات زيارة صيدلية الشفاء" : "Al-Shifa Pharmacy Visit Notes",
      content: isRtl
        ? "تمت مناقشة توفر الطلبية الجديدة ومراجعة المخزون الحالي من المستحضرات المستهدفة."
        : "Discussed new order availability and reviewed current stock of target products.",
      category: isRtl ? "زيارة ميدانية" : "Field Visit",
      date: isRtl ? "اليوم، 10:30 صباحاً" : "Today, 10:30 AM"
    },
    {
      id: "2",
      title: isRtl ? "أفكار العرض التقديمي القادم" : "Upcoming Presentation Ideas",
      content: isRtl
        ? "التركيز على المزايا التنافسية ودراسات الحالة السريرية الحديثة لفريق الأطباء."
        : "Focus on competitive advantages and recent clinical case studies for the physician team.",
      category: isRtl ? "أفكار تسويقية" : "Marketing",
      date: isRtl ? "أمس، 04:15 مساءً" : "Yesterday, 04:15 PM"
    }
  ]);

  const [toast, setToast] = useState("");

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  };

  const t = {
    title: isRtl ? "الملاحظات اليومية" : "My Notes",
    subtitle: isRtl ? "تدوين وحفظ الملاحظات والأفكار السريعة خلال عملك الميداني" : "Capture and save quick notes and field insights",
    newNote: isRtl ? "ملاحظة جديدة" : "New Note",
    searchPlaceholder: isRtl ? "البحث في الملاحظات..." : "Search notes...",
    all: isRtl ? "الكل" : "All",
    fieldVisit: isRtl ? "زيارة ميدانية" : "Field Visit",
    marketing: isRtl ? "أفكار تسويقية" : "Marketing",
    general: isRtl ? "عام" : "General",
    noNotes: isRtl ? "لا توجد ملاحظات متطابقة مع البحث" : "No notes matching your search",
    modalTitle: isRtl ? "إضافة ملاحظة جديدة" : "New Note",
    titleLabel: isRtl ? "عنوان الملاحظة" : "Note Title",
    titlePlaceholder: isRtl ? "مثال: ملاحظات اجتماع د. أحمد" : "e.g. Dr. Ahmed Meeting Notes",
    categoryLabel: isRtl ? "التصنيف" : "Category",
    contentLabel: isRtl ? "التفاصيل والمحتوى" : "Content",
    contentPlaceholder: isRtl ? "اكتب تفاصيل الملاحظة هنا..." : "Write note details here...",
    cancel: isRtl ? "إلغاء" : "Cancel",
    saveNote: isRtl ? "حفظ الملاحظة" : "Save Note",
    savedSuccess: isRtl ? "تم حفظ الملاحظة بنجاح!" : "Note saved successfully!"
  };

  const categories = [
    { id: "All", label: t.all },
    { id: "Field Visit", label: t.fieldVisit },
    { id: "Marketing", label: t.marketing },
    { id: "General", label: t.general }
  ];

  const handleSaveNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() && !content.trim()) return;

    const catLabel = categories.find(c => c.id === category)?.label || category;
    const newN: NoteItem = {
      id: Date.now().toString(),
      title: title || (isRtl ? "ملاحظة بدون عنوان" : "Untitled Note"),
      content: content,
      category: catLabel,
      date: isRtl ? "الآن" : "Just now"
    };

    setNotes(prev => [newN, ...prev]);
    setIsModalOpen(false);
    setTitle("");
    setContent("");
    showToast(t.savedSuccess);
  };

  const handleDelete = (id: string) => {
    setNotes(prev => prev.filter(n => n.id !== id));
  };

  const filteredNotes = notes.filter(n => {
    const matchesSearch = n.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          n.content.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCat = selectedCat === "All" || n.category === (categories.find(c => c.id === selectedCat)?.label || selectedCat);
    return matchesSearch && matchesCat;
  });

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

      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2.5">
            <FileText size={24} className="text-[#2563eb]" />
            <span>{t.title}</span>
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
          <span>{t.newNote}</span>
        </button>
      </div>

      {/* Filter Row */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-6">
        {/* Category Pills */}
        <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
          {categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => setSelectedCat(cat.id)}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold shrink-0 transition-colors cursor-pointer ${
                selectedCat === cat.id
                  ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-xxs"
                  : "bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800"
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Search Input */}
        <div className="relative w-full sm:w-[280px]">
          <Search size={16} className="absolute left-3.5 top-3 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={t.searchPlaceholder}
            className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-blue-500 transition-colors shadow-xxs"
          />
        </div>
      </div>

      {/* Notes Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 mt-6">
        <AnimatePresence>
          {filteredNotes.length === 0 ? (
            <div className="col-span-full py-20 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center text-center text-slate-400">
              <FileText size={36} className="mb-3 opacity-40" />
              <p className="text-sm font-medium">{t.noNotes}</p>
            </div>
          ) : (
            filteredNotes.map(note => (
              <motion.div
                key={note.id}
                layout
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200/80 dark:border-slate-800 shadow-xxs flex flex-col justify-between group hover:border-blue-300 dark:hover:border-blue-800 transition-colors min-h-[180px]"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2.5">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 text-[10px] font-bold rounded-lg tracking-wide">
                      <Tag size={11} />
                      <span>{note.category}</span>
                    </span>
                    <button
                      onClick={() => handleDelete(note.id)}
                      className="text-slate-300 hover:text-red-500 dark:text-slate-600 dark:hover:text-red-400 p-1 rounded transition-colors cursor-pointer"
                      title="Delete Note"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>

                  <h3 className="text-sm font-bold text-slate-900 dark:text-white line-clamp-1">
                    {note.title}
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-2 line-clamp-4 leading-relaxed">
                    {note.content}
                  </p>
                </div>

                <div className="flex items-center gap-1.5 text-[10px] text-slate-400 mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 font-medium">
                  <Clock size={12} />
                  <span>{note.date}</span>
                </div>
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>

      {/* New Note Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 overflow-y-auto backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 15 }}
              className="bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden relative flex flex-col my-auto max-h-[90vh] text-left"
            >
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

              <form onSubmit={handleSaveNote} className="px-6 py-4 overflow-y-auto space-y-4 flex-1 text-xs">
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {t.titleLabel}
                  </label>
                  <input
                    type="text"
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    placeholder={t.titlePlaceholder}
                    className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:border-blue-500 shadow-xxs"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {t.categoryLabel}
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {categories.filter(c => c.id !== "All").map(cat => (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => setCategory(cat.id)}
                        className={`py-2 px-2 rounded-xl text-xs font-semibold border text-center transition-colors cursor-pointer ${
                          category === cat.id
                            ? "bg-blue-50 dark:bg-blue-950/60 border-[#2563eb] text-[#2563eb] dark:text-blue-300"
                            : "bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100"
                        }`}
                      >
                        {cat.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {t.contentLabel}
                  </label>
                  <textarea
                    rows={5}
                    value={content}
                    onChange={e => setContent(e.target.value)}
                    placeholder={t.contentPlaceholder}
                    className="w-full p-3 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-blue-500 shadow-xxs resize-none leading-relaxed"
                  />
                </div>

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
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
                    {t.saveNote}
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
