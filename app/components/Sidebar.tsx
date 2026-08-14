"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import ThemeSwitcher from "./ThemeSwitcher";

const links = [
  { href: "/", labelKey: "upload", icon: "upload" },
  { href: "/topics", labelKey: "topics", icon: "book" },
  { href: "/ask", labelKey: "ask", icon: "brain" },
  { href: "/exams", labelKey: "exams", icon: "exam" },
  { href: "/subscribe", labelKey: "subscribe", icon: "crown" },
];

function NavIcon({ name }: { name: string }) {
  if (name === "upload")
    return (
      <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
      </svg>
    );
  if (name === "brain")
    return (
      <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09l.813-2.846zm0 0L16.5 7.5m-1.403-6.033L12 3.75l-1.403 2.217a4.5 4.5 0 00-1.906 1.1l-1.34 2.847 2.847 1.34a4.5 4.5 0 001.1 1.906L14.25 12l-5.533-3.097z" />
      </svg>
    );
  if (name === "exam")
    return (
      <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.3 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896 0-1.78-.192-2.658-.513m-15.482 0A50.697 50.697 0 0112 13.5a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A75.37 75.37 0 0112 15.75a75.39 75.39 0 016.75 0v3.675m0 0v-3.675A75.376 75.376 0 0012 6.375a75.376 75.376 0 00-6.75 0v3.675m0 0a75.376 75.376 0 016.75 0v-3.675M3.75 15a.75.75 0 100-1.5.75.75 0 000 1.5z" />
      </svg>
    );
  if (name === "crown")
    return (
      <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
      </svg>
    );
  return (
    <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
    </svg>
  );
}

export default function Sidebar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const { lang, setLang } = useLanguage();
  const isEn = lang === "en";

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    });
    router.push("/login");
    router.refresh();
  };

  const getLabel = (key: string) => {
    const map: Record<string, string> = {
      upload: isEn ? "Upload & Analyze" : "رفع وتحليل",
      topics: isEn ? "Topics Reference" : "مرجع الموضوعات",
      ask: isEn ? "Ask Me" : "اسألني",
      exams: isEn ? "Exams" : "اختبارات",
      subscribe: isEn ? "Subscription" : "الاشتراك",
    };
    return map[key] || key;
  };

  const displayName = user
    ? user.fullName || user.username || ""
    : "";

  return (
    <>
      {/* ====== Mobile Button ====== */}
      <button
        onClick={() => setOpen(true)}
        className="fixed right-4 top-4 z-50 flex h-9 w-9 items-center justify-center rounded-lg bg-surface text-text-soft shadow-sm ring-1 ring-border transition hover:shadow-md lg:hidden"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
        </svg>
      </button>

      {/* ====== Overlay ====== */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-foreground/10 backdrop-blur-[2px] lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* ====== Sidebar ====== */}
      <aside
        className={`fixed top-0 right-0 z-50 flex h-full w-62.5 flex-col border-l border-sidebar-border bg-sidebar transition-transform duration-200 lg:static lg:translate-x-0 ${
          open ? "translate-x-0 shadow-lg" : "translate-x-full lg:translate-x-0"
        }`}
      >
        {/* ---- Brand ---- */}
        <div className="px-5 pt-6 pb-5">
          <Link
            href="/"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-[10px] font-bold text-surface">
              AI
            </div>
            <div>
              <h1 className="text-sm font-bold text-text">AI Learning</h1>
              <p className="text-[10px] text-muted">{isEn ? "Smart File Analysis" : "تحليل ذكي للملفات"}</p>
            </div>
          </Link>
        </div>

        <div className="mx-4 h-px bg-border" />

        {/* ---- Welcome Message ---- */}
        <div className="px-5 pt-4 pb-2">
          {user && displayName ? (
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-bold text-primary">
                {displayName.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold text-text">
                  {isEn ? "Welcome," : "مرحباً،"}
                </p>
                <p className="truncate text-[12px] font-medium text-primary">
                  {displayName}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-soft text-xs text-muted ring-1 ring-border">
                👤
              </div>
              <p className="text-[13px] font-medium text-muted">
                {isEn ? "Welcome, Guest" : "مرحباً بك كزائر"}
              </p>
            </div>
          )}
        </div>

        <div className="mx-4 h-px bg-border" />

        {/* ---- Navigation ---- */}
        <nav className="flex-1 space-y-0.5 px-3 pt-4">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[13px] font-medium transition ${
                isActive(link.href)
                  ? "bg-primary-soft text-primary"
                  : "text-text-soft hover:bg-surface-hover hover:text-text"
              }`}
            >
              <NavIcon name={link.icon} />
              {getLabel(link.labelKey)}
            </Link>
          ))}
        </nav>

        {/* ---- Bottom Section ---- */}
        <div className="space-y-2 px-3 pb-5">
          {/* Admin Link — only for admins */}
          {user?.role === "admin" && (
            <Link
              href="/admin/codes"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] font-medium text-amber-700 transition hover:bg-amber-100"
            >
              <span>🔑</span>
              {isEn ? "Admin: Codes" : "أدمن: الكودات"}
            </Link>
          )}

          {/* Language Switcher */}
          <button
            onClick={() => setLang(lang === "ar" ? "en" : "ar")}
            className="flex w-full items-center gap-2 rounded-lg border border-border bg-surface-soft px-3 py-2.5 text-[12px] font-medium text-text-soft transition hover:bg-surface-hover hover:text-text"
          >
            <span>🌐</span>
            {isEn ? "العربية" : "English"}
          </button>

          {/* Theme Switcher */}
          <div className="rounded-lg border border-border bg-surface-soft">
            <div className="px-3 pt-2.5 pb-1">
              <p className="text-[10px] font-medium text-muted">{isEn ? "Appearance" : "المظهر"}</p>
            </div>
            <ThemeSwitcher />
          </div>

          {/* Supported Formats */}
          <div className="rounded-lg bg-surface-soft px-3 py-2.5">
            <p className="text-[10px] font-medium text-muted">
              {isEn ? "Supported Formats" : "صيغ مدعومة"}
            </p>
            <p className="mt-1 text-[10px] text-muted">
              PDF · Word · PPTX · TXT · {isEn ? "Video" : "فيديو"} · {isEn ? "Audio" : "صوت"}
            </p>
          </div>

          {/* Auth Section */}
          {user ? (
            <div className="rounded-lg border border-border bg-surface-soft p-3 space-y-2">
              <div className="truncate text-[11px] text-muted" dir="ltr">
                @{user.username}
                {user.email ? ` · ${user.email}` : ""}
              </div>
              <button
                onClick={handleLogout}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[12px] font-medium text-red-500 transition hover:bg-red-50"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-3A2.25 2.25 0 008.25 5.25v4.5A2.25 2.25 0 0010.5 12H3.75m0 0V9m12 3l-1.5 1.5m0 0l1.5-1.5M12 15.75V12" />
                </svg>
                {isEn ? "Logout" : "خروج"}
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-[12px] font-bold text-surface shadow-sm transition hover:brightness-110"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013-3h4.5a3 3 0 013 3v13.5a3 3 0 01-3 3h-4.5a3 3 0 01-3-3V5.25zm0 0h7.5m-7.5 0l7.5 7.5" />
              </svg>
              {isEn ? "Login" : "دخول"}
            </Link>
          )}
        </div>

        {/* ---- Mobile Close ---- */}
        <button
          onClick={() => setOpen(false)}
          className="absolute left-3 top-5 flex h-7 w-7 items-center justify-center rounded-md text-muted transition hover:bg-surface-hover hover:text-text lg:hidden"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </aside>
    </>
  );
}