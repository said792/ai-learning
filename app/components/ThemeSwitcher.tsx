"use client";

import { useEffect, useState } from "react";

interface Theme {
  id: string;
  label: string;
  dot: string;
  ring: string;
}

const themes: Theme[] = [
  { id: "pearl", label: "لؤلؤي", dot: "#64748b", ring: "#e2e8f0" },
  { id: "royal", label: "ملكي", dot: "#7c6aa6", ring: "#e9e2f5" },
  { id: "ocean", label: "محيطي", dot: "#4f8296", ring: "#dcecf1" },
  { id: "emerald", label: "زمردي", dot: "#4f806d", ring: "#dcebe4" },
  { id: "midnight", label: "ليلي", dot: "#7d91b1", ring: "#3b4658" },
];

const STORAGE_KEY = "ai-learning-theme";

export default function ThemeSwitcher() {
  const [current, setCurrent] = useState("pearl");
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && themes.some((t) => t.id === saved)) {
        setCurrent(saved);
        document.documentElement.setAttribute("data-theme", saved);
      } else {
        document.documentElement.setAttribute("data-theme", "pearl");
      }
    } catch {
      document.documentElement.setAttribute("data-theme", "pearl");
    }
  }, []);

  function applyTheme(themeId: string) {
    const theme = themes.find((t) => t.id === themeId);
    if (!theme) return;
    setCurrent(themeId);
    document.documentElement.setAttribute("data-theme", themeId);
    try {
      localStorage.setItem(STORAGE_KEY, themeId);
    } catch {
      /* ignore */
    }
    setOpen(false);
  }

  const active = themes.find((t) => t.id === current) ?? themes[0];

  if (!mounted) {
    return (
      <div className="relative w-full">
        <button
          type="button"
          disabled
          className="flex h-10 w-full items-center gap-3 rounded-xl px-3 text-sm text-text-soft opacity-70"
        >
          <span
            className="h-4 w-4 shrink-0 rounded-full border"
            style={{ backgroundColor: themes[0].dot, borderColor: themes[0].ring }}
          />
          <span className="flex-1 text-right">لؤلؤي</span>
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className="relative w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex h-10 w-full items-center gap-3 rounded-xl px-3 text-sm font-medium text-text-soft transition-colors duration-200 hover:bg-surface-hover"
      >
        <span
          className="h-4 w-4 shrink-0 rounded-full border shadow-sm"
          style={{ backgroundColor: active.dot, borderColor: active.ring }}
        />
        <span className="flex-1 text-right">{active.label}</span>
        <svg
          className={"h-4 w-4 text-muted transition-transform duration-200 " + (open ? "rotate-180" : "")}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="إغلاق"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />

          <div
            className="absolute bottom-full left-0 right-0 z-50 mb-2 overflow-hidden rounded-2xl border border-border bg-surface p-1.5 shadow-lg"
            role="listbox"
            aria-label="اختيار الخلفية"
          >
            {themes.map((theme) => {
              const isSelected = current === theme.id;
              return (
                <button
                  key={theme.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => applyTheme(theme.id)}
                  className={
                    "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-right text-sm transition-colors duration-200 " +
                    (isSelected
                      ? "bg-primary-soft text-primary"
                      : "text-text-soft hover:bg-surface-hover")
                  }
                >
                  <span
                    className="h-4 w-4 shrink-0 rounded-full border shadow-sm transition-transform duration-200 hover:scale-110"
                    style={{ backgroundColor: theme.dot, borderColor: theme.ring }}
                  />
                  <span className="flex-1">{theme.label}</span>
                  {isSelected && (
                    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M5 12.5l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}