"use client";

import { useState, useEffect } from "react";
import { useLanguage } from "../context/LanguageContext";

interface Category {
  id: string;
  name: string;
  description?: string | null;
  color: string;
  icon?: string | null;
  documentCount: number;
  created_at: string;
}

interface Document {
  id: string;
  file_name: string;
  media_type: string;
  status: string;
  created_at: string;
  category_id: string | null;
}

interface CategoryManagerProps {
  onCategorySelect?: (categoryId: string | null, categoryName: string | null) => void;
  selectedCategoryId?: string | null;
  compact?: boolean;
}

const PRESET_COLORS = [
  "#3B82F6", "#10B981", "#EF4444", "#F59E0B",
  "#8B5CF6", "#EC4899", "#F97316", "#06B6D4",
  "#6B7280", "#84CC16",
];

export default function CategoryManager({
  onCategorySelect,
  selectedCategoryId,
  compact = false,
}: CategoryManagerProps) {
  const { lang } = useLanguage();
  const isEn = lang === "en";

  const [categories, setCategories] = useState<Category[]>([]);
  const [uncategorizedCount, setUncategorizedCount] = useState(0);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [docLoading, setDocLoading] = useState(false);

  /* إنشاء كتالوج */
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#3B82F6");
  const [creating, setCreating] = useState(false);

  /* تحميل الكتالوجات */
  async function fetchCategories() {
    try {
      const res = await fetch("/api/categories");
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        setCategories(data.categories || []);
        setUncategorizedCount(data.uncategorizedCount || 0);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }

  /* تحميل مستندات كتالوج */
  async function fetchCategoryDocs(categoryId: string | null) {
    setDocLoading(true);
    try {
      let url = "/api/documents";
      if (categoryId) {
        url += `?categoryId=${categoryId}`;
      } else {
        url += `?uncategorized=true`;
      }
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      setDocuments(data.documents || []);
    } catch {
      // silently fail
    } finally {
      setDocLoading(false);
    }
  }

  /* إنشاء كتالوج جديد */
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
      // silently fail
    } finally {
      setCreating(false);
    }
  }

  /* حذف كتالوج */
  async function deleteCategory(id: string, name: string) {
    const confirmMsg = isEn
      ? `Delete "${name}"? Files will move to uncategorized.`
      : `حذف "${name}"؟ الملفات ستنتقل لـ "بدون تصنيف".`;
    if (!confirm(confirmMsg)) return;

    try {
      const res = await fetch(`/api/categories/${id}`, { method: "DELETE" });
      if (res.ok) {
        if (activeCategoryId === id) {
          setActiveCategoryId(null);
          setDocuments([]);
        }
        await fetchCategories();
      }
    } catch {
      // silently fail
    }
  }

  /* نقل ملف لكتالوج */
  async function moveDocument(docId: string, categoryId: string | null) {
    try {
      await fetch(`/api/documents/${docId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId }),
      });
      if (activeCategoryId) {
        await fetchCategoryDocs(activeCategoryId);
      }
      await fetchCategories();
    } catch {
      // silently fail
    }
  }

  useEffect(() => {
    fetchCategories();
  }, []);

  function openCategory(id: string | null) {
    setActiveCategoryId(id);
    fetchCategoryDocs(id);
  }

  /* =============== Render =============== */

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8">
        <div className="flex items-center justify-center gap-3">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-slate-800" />
          <span className="text-xs text-slate-400">
            {isEn ? "Loading categories..." : "جاري تحميل الكتالوجات..."}
          </span>
        </div>
      </div>
    );
  }

  /* --- عرض المستندات داخل كتالوج --- */
  if (activeCategoryId !== null || activeCategoryId === null && documents.length > 0) {
    const activeCat = categories.find((c) => c.id === activeCategoryId);
    const isUncategorized = activeCategoryId === null && documents.length > 0;

    return (
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <button
            onClick={() => { setActiveCategoryId(null); setDocuments([]); }}
            className="flex items-center gap-2 text-xs font-semibold text-slate-700 hover:text-slate-900"
          >
            <span>←</span>
            <span>{isEn ? "Back" : "رجوع"}</span>
          </button>
          <div className="flex items-center gap-2">
            {activeCat && (
              <span
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: activeCat.color }}
              />
            )}
            <span className="text-sm font-bold text-slate-800">
              {isUncategorized
                ? (isEn ? "Uncategorized" : "بدون تصنيف")
                : activeCat?.name || ""}
            </span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
              {documents.length}
            </span>
          </div>
          {activeCat && (
            <button
              onClick={() => deleteCategory(activeCat.id, activeCat.name)}
              className="text-xs text-red-400 hover:text-red-600"
            >
              🗑️
            </button>
          )}
        </div>

        <div className="divide-y divide-slate-50 px-5">
          {docLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-slate-800" />
            </div>
          ) : documents.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-center">
              <span className="text-3xl">📭</span>
              <p className="mt-2 text-xs text-slate-400">
                {isEn ? "No documents yet" : "لا توجد مستندات"}
              </p>
            </div>
          ) : (
            documents.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center justify-between py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="text-sm">
                    {doc.media_type === "media" ? "🎬" : "📄"}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-slate-700">
                      {doc.file_name}
                    </p>
                    <p className="text-[10px] text-slate-400">
                      {new Date(doc.created_at).toLocaleDateString(
                        isEn ? "en-US" : "ar-EG"
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={doc.category_id || ""}
                    onChange={(e) =>
                      moveDocument(
                        doc.id,
                        e.target.value || null
                      )
                    }
                    className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-600"
                  >
                    <option value="">
                      {isEn ? "Uncategorized" : "بدون تصنيف"}
                    </option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                  {onCategorySelect && (
                    <button
                      onClick={() =>
                        onCategorySelect(doc.id, doc.file_name)
                      }
                      className="rounded-md bg-slate-800 px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-slate-700"
                    >
                      {isEn ? "View" : "عرض"}
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  /* --- عرض الكتالوجات --- */
  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between px-5 py-4">
        <div>
          <h2 className="font-semibold text-slate-800">
            {isEn ? "📚 My Library" : "📚 مكتبتي"}
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            {isEn
              ? `${categories.length} categories`
              : `${categories.length} كتالوج`}
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
        >
          <span>➕</span>
          <span>{isEn ? "New" : "جديد"}</span>
        </button>
      </div>

      {/* إنشاء كتالوج */}
      {showCreate && (
        <div className="border-t border-slate-100 px-5 py-4">
          <div className="flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={isEn ? "Category name..." : "اسم الكتالوج..."}
              dir={isEn ? "ltr" : "rtl"}
              className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-slate-400"
              onKeyDown={(e) => {
                if (e.key === "Enter" && newName.trim()) createCategory();
              }}
            />
            <button
              onClick={createCategory}
              disabled={!newName.trim() || creating}
              className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:bg-slate-300"
            >
              {creating
                ? (isEn ? "..." : "...")
                : (isEn ? "Create" : "إنشاء")}
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setNewColor(c)}
                className={`h-6 w-6 rounded-full transition ${
                  newColor === c
                    ? "ring-2 ring-offset-2 ring-slate-800"
                    : "hover:scale-110"
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
      )}

      {/* شبكة الكتالوجات */}
      <div className="border-t border-slate-100 px-5 py-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => openCategory(cat.id)}
              className={`group flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-all ${
                selectedCategoryId === cat.id
                  ? "border-slate-800 bg-slate-50 shadow-sm"
                  : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
              }`}
            >
              <div
                className="flex h-10 w-10 items-center justify-center rounded-xl text-white text-lg"
                style={{ backgroundColor: cat.color }}
              >
                📁
              </div>
              <p className="text-xs font-semibold text-slate-700 truncate w-full text-center">
                {cat.name}
              </p>
              <p className="text-[10px] text-slate-400">
                {cat.documentCount} {isEn ? "files" : "ملف"}
              </p>
            </button>
          ))}

          {/* بدون تصنيف */}
          {uncategorizedCount > 0 && (
            <button
              onClick={() => {
                setActiveCategoryId(null);
                fetchCategoryDocs(null);
              }}
              className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-200 p-4 transition-all hover:border-slate-300 hover:bg-slate-50"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-lg">
                📂
              </div>
              <p className="text-xs font-semibold text-slate-500">
                {isEn ? "Uncategorized" : "بدون تصنيف"}
              </p>
              <p className="text-[10px] text-slate-400">
                {uncategorizedCount} {isEn ? "files" : "ملف"}
              </p>
            </button>
          )}
        </div>

        {categories.length === 0 && uncategorizedCount === 0 && (
          <div className="flex flex-col items-center py-8 text-center">
            <span className="text-4xl">📂</span>
            <p className="mt-2 text-xs text-slate-400">
              {isEn
                ? "No categories yet. Create one!"
                : "لا توجد كتالوجات بعد. أنشئ واحدًا!"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}