"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useLanguage } from "../context/LanguageContext";

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

const PRESET_COLORS = [
  "#3B82F6", "#10B981", "#EF4444", "#F59E0B",
  "#8B5CF6", "#EC4899", "#F97316", "#06B6D4",
  "#6B7280", "#84CC16",
];

export default function LibraryPage() {
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

  async function fetchCategories() {
    try {
      const res = await fetch("/api/categories");
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        setCategories(data.categories || []);
        setUncatCount(data.uncategorizedCount || 0);
      }

      const docRes = await fetch("/api/documents");
      if (docRes.ok) {
        const docData = await docRes.json();
        const docs = (docData.documents || []).map(function (d: any) {
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
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }

  function filterDocuments(categoryId: string | null) {
    setDocLoading(true);
    setTimeout(function () {
      if (categoryId) {
        setDocuments(allDocs.filter(function (d) { return d.category_id === categoryId; }));
      } else {
        setDocuments(allDocs.filter(function (d) { return !d.category_id; }));
      }
      setDocLoading(false);
    }, 100);
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

  async function moveDocument(docId: string, categoryId: string | null) {
    try {
      await fetch("/api/documents/" + docId, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId: categoryId }),
      });
      await fetchCategories();
      if (activeCat) {
        filterDocuments(activeCat.id);
      } else if (showUncat) {
        filterDocuments(null);
      }
    } catch {
      // silent
    }
  }

  async function deleteDocument(docId: string, fileName: string) {
    const msg = isEn
      ? 'Delete "' + fileName + '"?'
      : 'حذف "' + fileName + '"؟';
    if (!confirm(msg)) return;
    try {
      const res = await fetch("/api/documents/" + docId, { method: "DELETE" });
      if (res.ok) {
        await fetchCategories();
        if (activeCat) {
          filterDocuments(activeCat.id);
        } else if (showUncat) {
          filterDocuments(null);
        }
      }
    } catch {
      // silent
    }
  }

  useEffect(function () {
    fetchCategories();
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center" dir={dir}>
        <div className="flex flex-col items-center gap-3">
          <span className="h-8 w-8 animate-spin rounded-full border-3 border-slate-200 border-t-slate-800" />
          <p className="text-sm text-slate-400">
            {isEn ? "Loading library..." : "جاري تحميل المكتبة..."}
          </p>
        </div>
      </div>
    );
  }

  const totalDocs = categories.reduce(function (sum, c) { return sum + c.documentCount; }, 0) + uncatCount;
  const isInside = activeCat !== null || showUncat;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50" dir={dir}>
      <div className="mx-auto max-w-4xl px-5 py-8 pt-20 lg:px-8 lg:pt-8">

        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 text-xl text-white shadow-lg">
              📚
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">
                {isEn ? "My Library" : "مكتبتي"}
              </h1>
              <div className="mt-1 flex items-center gap-2.5">
                <span className="rounded-full bg-blue-50 px-3 py-0.5 text-[10px] font-bold text-blue-600 ring-1 ring-blue-100">
                  {categories.length} {isEn ? "categories" : "كتالوج"}
                </span>
                <span className="rounded-full bg-slate-100 px-3 py-0.5 text-[10px] font-medium text-slate-500">
                  {totalDocs} {isEn ? "files" : "ملف"}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={function () { setLang(lang === "ar" ? "en" : "ar"); }}
              className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-600 shadow-sm transition hover:bg-white"
            >
              🌐 {isEn ? "العربية" : "English"}
            </button>
            <button
              onClick={function () { setShowCreate(true); }}
              className="flex items-center gap-2 rounded-xl bg-slate-800 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-700"
            >
              ➕ {isEn ? "New Category" : "كتالوج جديد"}
            </button>
          </div>
        </div>

        {showCreate && (
          <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-bold text-slate-800 mb-3">
              {isEn ? "Create New Category" : "إنشاء كتالوج جديد"}
            </h3>
            <div className="flex gap-2">
              <input
                value={newName}
                onChange={function (e) { setNewName(e.target.value); }}
                placeholder={isEn ? "Category name..." : "اسم الكتالوج..."}
                dir={dir}
                className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-800 outline-none transition focus:border-slate-400 focus:bg-white"
                onKeyDown={function (e) {
                  if (e.key === "Enter" && newName.trim()) createCategory();
                }}
              />
              <button
                onClick={createCategory}
                disabled={!newName.trim() || creating}
                className="rounded-xl bg-slate-800 px-5 py-2.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:bg-slate-300"
              >
                {creating ? "..." : isEn ? "Create" : "إنشاء"}
              </button>
              <button
                onClick={function () { setShowCreate(false); setNewName(""); }}
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-medium text-slate-500 hover:bg-slate-50"
              >
                ✕
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {PRESET_COLORS.map(function (c) {
                return (
                  <button
                    key={c}
                    onClick={function () { setNewColor(c); }}
                    className={"h-7 w-7 rounded-full transition " + (newColor === c ? "ring-2 ring-offset-2 ring-slate-800" : "hover:scale-110")}
                    style={{ backgroundColor: c }}
                  />
                );
              })}
            </div>
          </div>
        )}

        {isInside && (
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <button
                onClick={function () { setActiveCat(null); setShowUncat(false); setDocuments([]); }}
                className="flex items-center gap-2 text-xs font-semibold text-slate-600 hover:text-slate-800 transition"
              >
                ← {isEn ? "Back" : "رجوع"}
              </button>
              <div className="flex items-center gap-3">
                {activeCat && (
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: activeCat.color }} />
                )}
                <span className="text-sm font-bold text-slate-800">
                  {showUncat ? (isEn ? "Uncategorized" : "بدون تصنيف") : (activeCat ? activeCat.name : "")}
                </span>
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-medium text-slate-500">
                  {documents.length} {isEn ? "files" : "ملف"}
                </span>
                {activeCat && (
                  <button
                    onClick={function () { deleteCategory(activeCat.id, activeCat.name); }}
                    className="rounded-lg px-2 py-1 text-[10px] text-red-400 hover:bg-red-50 hover:text-red-600 transition"
                  >
                    🗑️
                  </button>
                )}
              </div>
            </div>
            <div className="divide-y divide-slate-50">
              {docLoading ? (
                <div className="flex items-center justify-center py-16">
                  <span className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-slate-800" />
                </div>
              ) : documents.length === 0 ? (
                <div className="flex flex-col items-center py-16 text-center">
                  <span className="text-4xl mb-3">📭</span>
                  <p className="text-sm text-slate-400">
                    {isEn ? "No documents yet" : "لا توجد مستندات"}
                  </p>
                  <Link
                    href="/"
                    className="mt-3 rounded-xl bg-slate-800 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700 transition"
                  >
                    {isEn ? "Upload a file" : "ارفع ملف"}
                  </Link>
                </div>
              ) : (
                documents.map(function (doc) {
                  return (
                    <div key={doc.id} className="flex items-center justify-between px-6 py-4 hover:bg-slate-50 transition">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-lg">
                          {doc.media_type === "media" ? "🎬" : "📄"}
                        </div>
                        <div className="min-w-0">
<Link
  href={"/topics?docId=" + doc.id}
  className="truncate text-sm font-medium text-slate-700 hover:text-blue-600 transition"
>
  {doc.file_name}
</Link>
                          <p className="text-[11px] text-slate-400">
                            {new Date(doc.created_at).toLocaleDateString(isEn ? "en-US" : "ar-EG")}
                            {doc.status === "completed" && <span className="ml-2 text-emerald-500">✓</span>}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <select
                          value={doc.category_id || ""}
                          onChange={function (e) { moveDocument(doc.id, e.target.value || null); }}
                          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] text-slate-600 outline-none"
                        >
                          <option value="">{isEn ? "Uncategorized" : "بدون تصنيف"}</option>
                          {categories.map(function (cat) {
                            return <option key={cat.id} value={cat.id}>{cat.name}</option>;
                          })}
                        </select>
                        <button
                          onClick={function () { deleteDocument(doc.id, doc.file_name); }}
                          className="rounded-lg px-2 py-1.5 text-[10px] text-slate-400 hover:bg-red-50 hover:text-red-500 transition"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {!isInside && (
          categories.length === 0 && uncatCount === 0 ? (
            <div className="flex flex-col items-center py-20 text-center">
              <span className="text-6xl mb-4">📂</span>
              <p className="text-lg font-bold text-slate-700">
                {isEn ? "Your library is empty" : "مكتبتك فارغة"}
              </p>
              <p className="mt-2 text-sm text-slate-400">
                {isEn ? "Create a category and upload files." : "أنشئ كتالوج وارفع ملفات."}
              </p>
              <div className="mt-6 flex gap-3">
                <button
                  onClick={function () { setShowCreate(true); }}
                  className="rounded-xl bg-slate-800 px-5 py-2.5 text-xs font-semibold text-white hover:bg-slate-700 transition"
                >
                  ➕ {isEn ? "Create Category" : "إنشاء كتالوج"}
                </button>
                <Link
                  href="/"
                  className="rounded-xl border border-slate-200 px-5 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
                >
                  📄 {isEn ? "Upload File" : "رفع ملف"}
                </Link>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {categories.map(function (cat) {
                return (
                  <button
                    key={cat.id}
                    onClick={function () { setActiveCat(cat); setShowUncat(false); filterDocuments(cat.id); }}
                    className="group flex flex-col items-center gap-3 rounded-2xl border-2 border-slate-200 bg-white p-6 text-center transition-all hover:border-slate-300 hover:shadow-md"
                  >
                    <div
                      className="flex h-14 w-14 items-center justify-center rounded-2xl text-2xl text-white shadow-sm transition-transform group-hover:scale-110"
                      style={{ backgroundColor: cat.color }}
                    >
                      📁
                    </div>
                    <p className="text-sm font-semibold text-slate-700 truncate w-full">{cat.name}</p>
                    <p className="text-[11px] text-slate-400">
                      {cat.documentCount} {isEn ? "files" : "ملف"}
                    </p>
                  </button>
                );
              })}

              {uncatCount > 0 && (
                <button
                  onClick={function () { setActiveCat(null); setShowUncat(true); filterDocuments(null); }}
                  className="group flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/50 p-6 text-center transition-all hover:border-slate-300 hover:bg-slate-50"
                >
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-200 text-2xl">📂</div>
                  <p className="text-sm font-semibold text-slate-500">
                    {isEn ? "Uncategorized" : "بدون تصنيف"}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {uncatCount} {isEn ? "files" : "ملف"}
                  </p>
                </button>
              )}

              <button
                onClick={function () { setShowCreate(true); }}
                className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-slate-300/50 p-6 text-center transition-all hover:border-slate-400 hover:bg-slate-50/50"
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-2xl">➕</div>
                <p className="text-sm font-medium text-slate-400">
                  {isEn ? "New Category" : "كتالوج جديد"}
                </p>
              </button>
            </div>
          )
        )}

      </div>
    </div>
  );
}