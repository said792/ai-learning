"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import DocumentViewer from "../components/DocumentViewer";

interface Category {
  id: string;
  name: string;
  color: string;
  documentCount: number;
}

interface Doc {
  id: string;
  file_name: string;
  media_type: string | null;
  status: string;
  created_at: string;
  category_id: string | null;
}

interface FolderLesson {
  id: string;
  kind: string;
  mode: string;
  title: string;
  mimeType: string | null;
  durationSec: number | null;
  status: string;
  url: string | null;
  documentTitle: string | null;
}

const PRESET_COLORS = [
  "#3B82F6", "#10B981", "#EF4444", "#F59E0B",
  "#8B5CF6", "#EC4899", "#F97316", "#06B6D4",
  "#6B7280", "#84CC16",
];

export default function LibraryPage() {
  const { user, loading: authLoading } = useAuth();
  const { lang, setLang, dir } = useLanguage();
  const isEn = lang === "en";

  const [categories, setCategories] = useState<Category[]>([]);
  const [uncatCount, setUncatCount] = useState(0);
  const [allDocs, setAllDocs] = useState<Doc[]>([]);
  const [documents, setDocuments] = useState<Doc[]>([]);
  const [activeCat, setActiveCat] = useState<Category | null>(null);
  const [showUncat, setShowUncat] = useState(false);
  const [loading, setLoading] = useState(true);
  const [docLoading, setDocLoading] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#3B82F6");
  const [creating, setCreating] = useState(false);

  const [viewingDoc, setViewingDoc] = useState<{ id: string; fileName: string } | null>(null);

  /* رسالة نجاح/خطأ مؤقتة (إشعار صغير أسفل الشاشة) */
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(function () {
    if (!notice) return;
    const timer = setTimeout(function () { setNotice(null); }, 3500);
    return function () { clearTimeout(timer); };
  }, [notice]);

  function showNotice(type: "success" | "error", text: string) {
    setNotice({ type: type, text: text });
  }

  /* دروس الفولدر الحالي — بتظهر جوه الفولدر */
  const [folderLessons, setFolderLessons] = useState<FolderLesson[]>([]);
  const [lessonsLoading, setLessonsLoading] = useState(false);

  /* جلب قائمة المستندات — بترجّع البيانات الجديدة عشان
     نتفادى مشكلة الـ stale closure اللي كانت بتخلي نقل الملف
     بين الفولدرات يظهر كأنه مش بينفذ */
  async function fetchDocumentsList(): Promise<Doc[]> {
    try {
      const docRes = await fetch("/api/documents");
      if (!docRes.ok) return [];
      const docData = await docRes.json();
      const docs: Doc[] = (docData.documents || []).map(function (d: any) {
        return {
          id: d.id,
          file_name: d.file_name,
          media_type: d.media_type,
          status: d.status,
          created_at: d.created_at,
          category_id: d.category_id || null,
        };
      });
      setAllDocs(docs);
      return docs;
    } catch {
      return [];
    }
  }

  /* تصفية من مصفوفة محددة (مش من الحالة القديمة) */
  function applyFilter(docs: Doc[], categoryId: string | null) {
    setDocLoading(true);
    setTimeout(function () {
      if (categoryId) {
        setDocuments(docs.filter(function (d) { return d.category_id === categoryId; }));
      } else {
        setDocuments(docs.filter(function (d) { return !d.category_id; }));
      }
      setDocLoading(false);
    }, 100);
  }

  async function fetchCategories() {
    try {
      const res = await fetch("/api/categories");
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        setCategories(data.categories || []);
        setUncatCount(data.uncategorizedCount || 0);
      }

      await fetchDocumentsList();
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }

  async function createCategory() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), color: newColor }),
      });
      const data = await res.json();
      if (data.success) {
        setNewName("");
        setNewColor("#3B82F6");
        setShowCreate(false);
        await fetchCategories();
      }
    } catch {
      // silent
    } finally {
      setCreating(false);
    }
  }

  async function deleteCategory(id: string, name: string) {
    const msg = isEn
      ? 'Delete "' + name + '"? Files move to uncategorized.'
      : 'حذف "' + name + '"؟ الملفات ستنتقل لبدون تصنيف.';
    if (!confirm(msg)) return;
    try {
      const res = await fetch("/api/categories/" + id, { method: "DELETE" });
      if (res.ok) {
        if (activeCat && activeCat.id === id) {
          setActiveCat(null);
          setDocuments([]);
        }
        await fetchCategories();
      }
    } catch {
      // silent
    }
  }

  /* نقل ملف لفولدر آخر — بنجيب البيانات الجديدة بعد النقل مباشرة
     (النسخة القديمة كانت بتعرض القديمة فبيبان كأن النقل مش بينفذ) */
  async function moveDocument(docId: string, categoryId: string | null) {
    const targetName = categoryId
      ? (categories.find(function (c) { return c.id === categoryId; })?.name || "")
      : (isEn ? "Uncategorized" : "بدون تصنيف");

    try {
      const res = await fetch("/api/documents/" + docId, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category_id: categoryId }),
      });

      const data = await res.json().catch(function () { return null; });

      if (!res.ok || !data || data.success === false) {
        showNotice("error", data?.error || (isEn ? "Failed to move the file" : "فشل نقل الملف"));
        return;
      }

      showNotice("success",
        isEn
          ? "Moved to \"" + targetName + "\" successfully"
          : "تم نقل الملف إلى \"" + targetName + "\" بنجاح"
      );

      const fresh = await fetchDocumentsList();
      if (activeCat) applyFilter(fresh, activeCat.id);
      else if (showUncat) applyFilter(fresh, null);
    } catch {
      showNotice("error", isEn ? "Connection error while moving the file" : "خطأ في الاتصال أثناء نقل الملف");
    }
  }

  async function deleteDocument(docId: string, fileName: string) {
    const msg = isEn ? 'Delete "' + fileName + '"?' : 'حذف "' + fileName + '"؟';
    if (!confirm(msg)) return;
    try {
      const res = await fetch("/api/documents/" + docId, { method: "DELETE" });
      const data = await res.json().catch(function () { return null; });
      if (res.ok && data && data.success !== false) {
        showNotice("success", isEn ? "File deleted" : "تم حذف الملف بنجاح");
        await fetchCategories();
        if (activeCat) applyFilter(allDocs, activeCat.id);
        else if (showUncat) applyFilter(allDocs, null);
      } else {
        showNotice("error", data?.error || (isEn ? "Failed to delete the file" : "فشل حذف الملف"));
      }
    } catch {
      showNotice("error", isEn ? "Connection error" : "خطأ في الاتصال");
    }
  }

  /* فتح مستند موجود في الصفحة الرئيسية بدون رفعه تاني —
     عشان تولّد له درس صوتي/فيديو أو تعمل اختبار أو تشات من غير ما تدور على الملف الأصلي */
  function openInHome(docId: string) {
    try {
      sessionStorage.setItem("ai_open_document", JSON.stringify({ id: docId }));
    } catch {
      /* تجاهل */
    }
    window.location.href = "/";
  }

  useEffect(function () { fetchCategories(); }, []);

  /* تحميل دروس الفولدر عند دخوله */
  useEffect(function () {
    if (!activeCat) {
      setFolderLessons([]);
      return;
    }
    let cancelled = false;
    (async function () {
      setLessonsLoading(true);
      try {
        const res = await fetch("/api/lessons?categoryId=" + activeCat.id, { credentials: "include" });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setFolderLessons(data.lessons || []);
      } catch {
        // silent
      } finally {
        if (!cancelled) setLessonsLoading(false);
      }
    })();
    return function () { cancelled = true; };
  }, [activeCat]);

  /* === Loading === */
  if (authLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center" dir={dir}>
        <div className="flex flex-col items-center gap-3">
          <span className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-800" />
          <p className="text-sm text-slate-400">
            {isEn ? "Loading library..." : "جاري تحميل المكتبة..."}
          </p>
        </div>
      </div>
    );
  }

  /* === Not Logged In === */
  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center px-5" dir={dir}>
        <div className="text-center max-w-md">
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-slate-100 text-4xl">🔒</div>
          <h2 className="text-lg font-bold text-slate-800">
            {isEn ? "Login Required" : "يجب تسجيل الدخول"}
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            {isEn ? "Login to access your library." : "سجل دخول للوصول لمكتبتك."}
          </p>
        </div>
      </div>
    );
  }

  const totalDocs = categories.reduce(function (sum, c) { return sum + c.documentCount; }, 0) + uncatCount;
  const isInside = activeCat !== null || showUncat;

  return (
    <div className="min-h-screen bg-slate-50" dir={dir}>
      <div className="mx-auto max-w-4xl px-4 py-6 pt-20 sm:px-6 sm:py-8 lg:px-8 lg:pt-8">

        {/* ===== Header ===== */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-800 text-lg text-white shadow-sm sm:h-12 sm:w-12 sm:rounded-2xl">
              📚
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-slate-900 sm:text-xl">
                {isEn ? "My Library" : "مكتبتي"}
              </h1>
              <div className="mt-0.5 flex items-center gap-2">
                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-600 ring-1 ring-blue-100">
                  {categories.length} {isEn ? "categories" : "تصنيف"}
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                  {totalDocs} {isEn ? "files" : "ملف"}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={function () { setLang(lang === "ar" ? "en" : "ar"); }}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 shadow-sm transition hover:bg-slate-50"
            >
              🌐 <span className="hidden sm:inline">{isEn ? "العربية" : "English"}</span>
            </button>
            <button
              onClick={function () { setShowCreate(true); }}
              className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-700"
            >
              ➕ <span className="hidden sm:inline">{isEn ? "New Category" : "تصنيف جديد"}</span>
            </button>
          </div>
        </div>

        {/* ===== Create Category ===== */}
        {showCreate && (
          <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <h3 className="mb-3 text-sm font-bold text-slate-800">
              {isEn ? "Create New Category" : "إنشاء تصنيف جديد"}
            </h3>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={newName}
                onChange={function (e) { setNewName(e.target.value); }}
                placeholder={isEn ? "Category name..." : "اسم التصنيف..."}
                dir={dir}
                className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-slate-400 focus:bg-white"
                onKeyDown={function (e) {
                  if (e.key === "Enter" && newName.trim()) createCategory();
                }}
              />
              <div className="flex gap-2">
                <button
                  onClick={createCategory}
                  disabled={!newName.trim() || creating}
                  className="flex-1 rounded-lg bg-slate-800 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:bg-slate-300 sm:flex-none"
                >
                  {creating ? "..." : isEn ? "Create" : "إنشاء"}
                </button>
                <button
                  onClick={function () { setShowCreate(false); setNewName(""); }}
                  className="rounded-lg border border-slate-200 px-4 py-2.5 text-xs font-medium text-slate-500 hover:bg-slate-50"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {PRESET_COLORS.map(function (c) {
                return (
                  <button
                    key={c}
                    onClick={function () { setNewColor(c); }}
                    className={"h-6 w-6 rounded-full transition sm:h-7 sm:w-7 " + (newColor === c ? "ring-2 ring-offset-2 ring-slate-800" : "hover:scale-110")}
                    style={{ backgroundColor: c }}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* ===== Inside Category View ===== */}
        {isInside && (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            {/* Category Header */}
            <div className="flex flex-col gap-2 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-4">
              <div className="flex items-center gap-2">
                <button
                  onClick={function () { setActiveCat(null); setShowUncat(false); setDocuments([]); }}
                  className="flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-800 transition"
                >
                  ← {isEn ? "Back" : "رجوع"}
                </button>
                <span className="text-slate-300">|</span>
                <div className="flex items-center gap-2">
                  {activeCat && (
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: activeCat.color }} />
                  )}
                  <span className="text-sm font-bold text-slate-800 truncate">
                    {showUncat ? (isEn ? "Uncategorized" : "بدون تصنيف") : (activeCat ? activeCat.name : "")}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-medium text-slate-500">
                  {documents.length} {isEn ? "files" : "ملف"}
                </span>
                {activeCat && (
                  <button
                    onClick={function () { deleteCategory(activeCat.id, activeCat.name); }}
                    className="rounded-lg px-2 py-1 text-[10px] text-red-400 hover:bg-red-50 hover:text-red-600 transition"
                  >
                    🗑️ {isEn ? "Delete" : "حذف"}
                  </button>
                )}
              </div>
            </div>

            {/* Documents List */}
            <div className="divide-y divide-slate-50">
              {docLoading ? (
                <div className="flex items-center justify-center py-16">
                  <span className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-slate-800" />
                </div>
              ) : documents.length === 0 ? (
                <div className="flex flex-col items-center py-12 text-center sm:py-16">
                  <span className="mb-3 text-4xl">📭</span>
                  <p className="text-sm text-slate-400">
                    {isEn ? "No documents yet" : "لا توجد مستندات"}
                  </p>
                  <Link
                    href="/"
                    className="mt-3 rounded-lg bg-slate-800 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700 transition"
                  >
                    {isEn ? "Upload a file" : "ارفع ملف"}
                  </Link>
                </div>
              ) : (
                documents.map(function (doc) {
                  return (
                    <div key={doc.id} className="flex flex-col gap-2 px-4 py-3 hover:bg-slate-50 transition sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-4">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-base sm:h-10 sm:w-10 sm:rounded-xl sm:text-lg">
                          {doc.media_type === "media" ? "🎬" : "📄"}
                        </div>
                        <div className="min-w-0">
                          <Link
                            href={"/topics?docId=" + doc.id}
                            className="truncate text-sm font-medium text-slate-700 hover:text-blue-600 transition"
                          >
                            {doc.file_name}
                          </Link>
                          <p className="text-[10px] text-slate-400 sm:text-[11px]">
                            {new Date(doc.created_at).toLocaleDateString(isEn ? "en-US" : "ar-EG")}
                            {doc.status === "completed" && <span className="ml-1.5 text-emerald-500">✓</span>}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 pl-12 sm:pl-0">
                        <button
                          onClick={function () { openInHome(doc.id); }}
                          title={isEn ? "Open in home page — create audio/video lessons, quiz, chat" : "افتح في الصفحة الرئيسية — ولّد دروس صوت/فيديو واختبارات وشات"}
                          className="shrink-0 rounded-lg px-2 py-1.5 text-[10px] text-slate-400 hover:bg-emerald-50 hover:text-emerald-600 transition"
                        >
                          🚀
                        </button>
                        <button
                          onClick={function () { setViewingDoc({ id: doc.id, fileName: doc.file_name }); }}
                          title={isEn ? "View analysis" : "عرض التحليل"}
                          className="shrink-0 rounded-lg px-2 py-1.5 text-[10px] text-slate-400 hover:bg-blue-50 hover:text-blue-500 transition"
                        >
                          👁️
                        </button>
                        <select
                          value={doc.category_id || ""}
                          onChange={function (e) { moveDocument(doc.id, e.target.value || null); }}
                          className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[10px] text-slate-600 outline-none sm:w-auto sm:text-[11px]"
                        >
                          <option value="">{isEn ? "Uncategorized" : "بدون تصنيف"}</option>
                          {categories.map(function (cat) {
                            return <option key={cat.id} value={cat.id}>{cat.name}</option>;
                          })}
                        </select>
                        <button
                          onClick={function () { deleteDocument(doc.id, doc.file_name); }}
                          className="shrink-0 rounded-lg px-2 py-1.5 text-[10px] text-slate-400 hover:bg-red-50 hover:text-red-500 transition"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            {/* دروس هذا الفولدر */}
            {activeCat && (
              <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-4 sm:px-6">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h4 className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
                    🎧 {isEn ? "Lessons in this folder" : "دروس هذا الفولدر"}
                    {folderLessons.length > 0 && (
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] text-slate-600">
                        {folderLessons.length}
                      </span>
                    )}
                  </h4>
                  <Link
                    href="/lessons"
                    className="shrink-0 text-[11px] font-medium text-blue-600 transition hover:text-blue-700"
                  >
                    {isEn ? "All my lessons →" : "كل دروسي ←"}
                  </Link>
                </div>

                {lessonsLoading ? (
                  <div className="py-4 text-center">
                    <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-slate-600" />
                  </div>
                ) : folderLessons.length === 0 ? (
                  <p className="rounded-lg bg-white px-3 py-2.5 text-[11px] text-slate-400 ring-1 ring-slate-100">
                    {isEn
                      ? "No lessons generated from this folder's files yet — open a file and convert it"
                      : "لا توجد دروس مولدة من ملفات هذا الفولدر بعد — افتح أي ملف وحوّله لدرس"}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {folderLessons.map(function (l) {
                      const dur = l.durationSec
                        ? Math.floor(l.durationSec / 60) + ":" + String(Math.round(l.durationSec % 60)).padStart(2, "0")
                        : null;
                      return (
                        <div key={l.id} className="rounded-lg bg-white p-3 ring-1 ring-slate-100">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-xs font-semibold text-slate-700">
                              {l.kind === "audio" ? "🎧" : "🎬"} {l.title}
                            </p>
                            <div className="flex shrink-0 items-center gap-1.5">
                              {l.documentTitle && (
                                <span className="max-w-[140px] truncate rounded-full bg-slate-100 px-2 py-0.5 text-[9px] text-slate-500">
                                  📄 {l.documentTitle}
                                </span>
                              )}
                              {dur && (
                                <span className="text-[10px] text-slate-400" dir="ltr">
                                  {dur}
                                </span>
                              )}
                            </div>
                          </div>

                          {l.status === "completed" && l.url && (
                            <div className="mt-2">
                              {l.mimeType && l.mimeType.includes("audio") ? (
                                <audio controls src={l.url} className="w-full" />
                              ) : (
                                <video controls src={l.url} className="max-h-44 w-full rounded-lg bg-black" />
                              )}
                            </div>
                          )}

                          {l.status === "failed" && (
                            <p className="mt-1 text-[10px] text-red-500">
                              ⚠️ {isEn ? "Generation failed" : "فشل إنشاء الدرس"}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ===== Category Grid ===== */}
        {!isInside && (
          categories.length === 0 && uncatCount === 0 ? (
            <div className="flex flex-col items-center py-16 text-center sm:py-20">
              <span className="mb-4 text-5xl sm:text-6xl">📂</span>
              <p className="text-base font-bold text-slate-700 sm:text-lg">
                {isEn ? "Your library is empty" : "مكتبتك فارغة"}
              </p>
              <p className="mt-2 text-sm text-slate-400">
                {isEn ? "Create a category and upload files." : "أنشئ تصنيف وارفع ملفات."}
              </p>
              <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:gap-3">
                <button
                  onClick={function () { setShowCreate(true); }}
                  className="rounded-lg bg-slate-800 px-5 py-2.5 text-xs font-semibold text-white hover:bg-slate-700 transition"
                >
                  ➕ {isEn ? "Create Category" : "إنشاء تصنيف"}
                </button>
                <Link
                  href="/"
                  className="rounded-lg border border-slate-200 px-5 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition text-center"
                >
                  📄 {isEn ? "Upload File" : "رفع ملف"}
                </Link>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
              {categories.map(function (cat) {
                return (
                  <button
                    key={cat.id}
                    onClick={function () { setActiveCat(cat); setShowUncat(false); applyFilter(allDocs, cat.id); }}
                    className="group flex flex-col items-center gap-2 rounded-xl border-2 border-slate-200 bg-white p-4 text-center transition-all hover:border-slate-300 hover:shadow-md sm:gap-3 sm:p-6"
                  >
                    <div
                      className="flex h-11 w-11 items-center justify-center rounded-xl text-xl text-white shadow-sm transition-transform group-hover:scale-110 sm:h-14 sm:w-14 sm:rounded-2xl sm:text-2xl"
                      style={{ backgroundColor: cat.color }}
                    >
                      📁
                    </div>
                    <p className="w-full truncate text-xs font-semibold text-slate-700 sm:text-sm">{cat.name}</p>
                    <p className="text-[10px] text-slate-400 sm:text-[11px]">
                      {cat.documentCount} {isEn ? "files" : "ملف"}
                    </p>
                  </button>
                );
              })}

              {uncatCount > 0 && (
                <button
                  onClick={function () { setActiveCat(null); setShowUncat(true); applyFilter(allDocs, null); }}
                  className="group flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/50 p-4 text-center transition-all hover:border-slate-300 hover:bg-slate-50 sm:gap-3 sm:p-6"
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-200 text-xl sm:h-14 sm:w-14 sm:rounded-2xl sm:text-2xl">📂</div>
                  <p className="text-xs font-semibold text-slate-500 sm:text-sm">
                    {isEn ? "Uncategorized" : "بدون تصنيف"}
                  </p>
                  <p className="text-[10px] text-slate-400 sm:text-[11px]">
                    {uncatCount} {isEn ? "files" : "ملف"}
                  </p>
                </button>
              )}

              <button
                onClick={function () { setShowCreate(true); }}
                className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300/50 p-4 text-center transition-all hover:border-slate-400 hover:bg-slate-50/50 sm:gap-3 sm:p-6"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-xl sm:h-14 sm:w-14 sm:rounded-2xl sm:text-2xl">➕</div>
                <p className="text-xs font-medium text-slate-400 sm:text-sm">
                  {isEn ? "New Category" : "تصنيف جديد"}
                </p>
              </button>
            </div>
          )
        )}
      </div>

      {/* ====== رسالة النجاح/الخطأ ====== */}
      {notice && (
        <div
          className={
            "fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-xl px-4 py-2.5 text-xs font-semibold shadow-lg transition " +
            (notice.type === "success"
              ? "bg-emerald-600 text-white"
              : "bg-red-600 text-white")
          }
          role="status"
        >
          {notice.type === "success" ? "✅ " : "⚠️ "}
          {notice.text}
        </div>
      )}

      {/* ====== عارض المستند ====== */}
      {viewingDoc && (
        <DocumentViewer
          documentId={viewingDoc.id}
          fileName={viewingDoc.fileName}
          isEn={isEn}
          onClose={function () { setViewingDoc(null); }}
        />
      )}
    </div>
  );
}