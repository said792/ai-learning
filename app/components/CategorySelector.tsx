"use client";

import { useState, useEffect } from "react";
import { useLanguage } from "../context/LanguageContext";

interface Category {
  id: string;
  name: string;
  color: string;
}

interface CategorySelectorProps {
  value: string | null;
  onChange: (categoryId: string | null) => void;
}

export default function CategorySelector({ value, onChange }: CategorySelectorProps) {
  const { lang } = useLanguage();
  const isEn = lang === "en";
  const [categories, setCategories] = useState<Category[]>([]);

  useEffect(() => {
    fetch("/api/categories")
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setCategories(data.categories || []);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="mt-3">
      <label className="block text-xs font-medium text-slate-600 mb-1.5">
        📁 {isEn ? "Category (optional)" : "الكتالوج (اختياري)"}
      </label>
      <select
        value={value || ""}
        onChange={(e) => onChange(e.target.value || null)}
        dir={isEn ? "ltr" : "rtl"}
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 outline-none transition focus:border-slate-400"
      >
        <option value="">
          {isEn ? "— No category —" : "— بدون تصنيف —"}
        </option>
        {categories.map((cat) => (
          <option key={cat.id} value={cat.id}>
            📁 {cat.name}
          </option>
        ))}
      </select>
    </div>
  );
}