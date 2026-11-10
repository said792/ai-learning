"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";

/* =========================================================
   صفحة "دروسي" — الدروس منظمة هرميًا:
   📁 الفولدر → 📄 الملف → 🎧/🎬 الدروس
   (زي ما المستخدم عايز: درس "الوظائف" اللي في فولدر "المهام"
    يظهر تحت فولدر "المهام" تحت ملف "الوظائف")
========================================================= */

type Lesson = {
  id: string;
  documentId: string | null;
  documentTitle: string | null;
  categoryId: string | null;
  categoryName: string | null;
  kind: string;
  mode: string;
  title: string;
  mimeType: string | null;
  durationSec: number | null;
  status: string;
  errorMessage: string | null;
  createdAt: string;
  url: string | null;
};

type Folder = {
  id: string;
  name: string;
  color: string;
};

type DocGroup = {
  id: string;
  title: string;
  lessons: Lesson[];
};

type FolderGroup = {
  id: string;
  name: string;
  color: string | null;
  docs: DocGroup[];
  count: number;
};

export default function LessonsPage() {
  const { user, loading: authLoading } = useAuth();
  const { lang } = useLanguage();
  const isEn = lang === "en";
  const router = useRouter();

  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderFilter, setFolderFilter] = useState<"all" | "none" | string>("all");
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "audio" | "video">("all");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [res, catRes] = await Promise.all([
        fetch("/api/lessons", { credentials: "include" }),
        fetch("/api/categories", { credentials: "include" }),
      ]);
      const data = await res.json();
      setLessons(data.lessons || []);
      if (catRes.ok) {
        const catData = await catRes.json();
        setFolders(catData.categories || []);
      }
    } catch {
      /* تجاهل */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login");
      return;
    }
    if (user) load();
  }, [user, authLoading, router, load]);

  async function deleteLesson(id: string) {
    if (!confirm(isEn ? "Delete this lesson?" : "حذف هذا الدرس؟")) return;
    setDeletingId(id);
    try {
      await fetch(`/api/lessons/${id}`, { method: "DELETE", credentials: "include" });
      setLessons((prev) => prev.filter((l) => l.id !== id));
    } finally {
      setDeletingId(null);
    }
  }

  /* فتح الملف المصدر في الصفحة الرئيسية — لتوليد درس جديد من غير رفع تاني */
  function openDoc(docId: string) {
    try {
      sessionStorage.setItem("ai_open_document", JSON.stringify({ id: docId }));
    } catch {
      /* تجاهل */
    }
    window.location.href = "/";
  }

  const t = (ar: string, en: string) => (isEn ? en : ar);

  const filtered = lessons.filter((l) => {
    if (filter !== "all" && l.kind !== filter) return false;
    if (folderFilter === "all") return true;
    if (folderFilter === "none") return !l.categoryId;
    return l.categoryId === folderFilter;
  });

  /* =========================================================
     التجميع الهرمي: فولدر → ملف → دروس
  ========================================================= */

  const folderOf = (l: Lesson): Folder | null => {
    if (l.categoryId) {
      const f = folders.find((x) => x.id === l.categoryId);
      if (f) return f;
    }
    if (l.categoryName) {
      return { id: l.categoryId || "", name: l.categoryName, color: "#64748b" };
    }
    return null;
  };

  const groupMap = new Map<string, FolderGroup>();

  for (const l of filtered) {
    const folder = folderOf(l);
    const key = folder ? folder.id : "__none__";

    let g = groupMap.get(key);
    if (!g) {
      g = {
        id: key,
        name: folder ? folder.name : t("بدون فولدر", "No folder"),
        color: folder ? folder.color : null,
        docs: [],
        count: 0,
      };
      groupMap.set(key, g);
    }

    const docKey = l.documentId || "__nodoc__";
    let d = g.docs.find((x) => x.id === docKey);
    if (!d) {
      d = {
        id: docKey,
        title: l.documentTitle || t("بدون ملف مصدر", "No source file"),
        lessons: [],
      };
      g.docs.push(d);
    }
    d.lessons.push(l);
    g.count += 1;
  }

  /* الترتيب: فولدرات المكتبة بأسمائها أولًا، ثم أي فولدرات أخرى، ثم "بدون فولدر" */
  const orderedKeys = [
    ...folders.filter((f) => groupMap.has(f.id)).map((f) => f.id),
    ...[...groupMap.keys()].filter(
      (k) => k !== "__none__" && !folders.some((f) => f.id === k)
    ),
    ...(groupMap.has("__none__") ? ["__none__"] : []),
  ];

  const fmtDuration = (sec: number | null) => {
    if (!sec) return "";
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  /* كارت الدرس (نفس التصميم السابق) */
  function LessonCard({ lesson }: { lesson: Lesson }) {
    return (
      <div className="rounded-xl border border-border bg-surface p-4 transition hover:shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                  lesson.kind === "audio"
                    ? "bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300"
                    : "bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300"
                }`}
              >
                {lesson.kind === "audio" ? `🎧 ${t("صوتي", "Audio")}` : `🎬 ${t("فيديو", "Video")}`}
              </span>

              {lesson.mode && (
                <span className="rounded-full bg-surface-soft px-2.5 py-0.5 text-[11px] text-muted">
                  {lesson.mode === "podcast"
                    ? t("بودكاست", "Podcast")
                    : lesson.mode === "veo"
                    ? "AI Veo"
                    : lesson.mode === "slides"
                    ? t("شرائح", "Slides")
                    : t("شرح", "Explanation")}
                </span>
              )}

              {lesson.durationSec ? (
                <span className="text-[11px] text-muted" dir="ltr">
                  {fmtDuration(lesson.durationSec)}
                </span>
              ) : null}
            </div>

            <h4 className="mt-2 truncate text-sm font-bold text-text">{lesson.title}</h4>

            {lesson.status === "failed" && (
              <p className="mt-1 text-xs text-red-500">
                ⚠️ {lesson.errorMessage || t("فشل إنشاء الدرس", "Lesson generation failed")}
              </p>
            )}

            {lesson.status === "processing" && (
              <p className="mt-1 text-xs text-amber-500">
                ⏳ {t("جاري المعالجة...", "Processing...")}
              </p>
            )}
          </div>

          <button
            onClick={() => deleteLesson(lesson.id)}
            disabled={deletingId === lesson.id}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
            aria-label={t("حذف", "Delete")}
            title={t("حذف الدرس", "Delete lesson")}
          >
            🗑️
          </button>
        </div>

        {/* المشغل */}
        {lesson.status === "completed" && lesson.url && (
          <div className="mt-3">
            {lesson.mimeType?.includes("audio") ? (
              <audio controls src={lesson.url} className="w-full" />
            ) : (
              <video
                controls
                src={lesson.url}
                className="max-h-72 w-full rounded-xl bg-black"
              />
            )}
          </div>
        )}

        <p className="mt-2 text-[11px] text-muted" dir="ltr">
          {new Date(lesson.createdAt).toLocaleString(isEn ? "en-US" : "ar-EG")}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      {/* العنوان */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text">
            🎬 {t("دروسي الصوتية والمرئية", "My Audio & Video Lessons")}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {t(
              "الدروس منظمة حسب الفولدر والملف — كل درس تحت الملف اللي اتولد منه",
              "Lessons organized by folder and file — each lesson sits under its source document"
            )}
          </p>
        </div>

        {/* الفلاتر */}
        <div className="flex gap-1.5 rounded-xl border border-border bg-surface-soft p-1">
          {(["all", "audio", "video"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-lg px-3.5 py-1.5 text-[12px] font-medium transition ${
                filter === f
                  ? "bg-primary text-surface shadow-sm"
                  : "text-text-soft hover:text-text"
              }`}
            >
              {f === "all" ? t("الكل", "All") : f === "audio" ? `🎧 ${t("صوتي", "Audio")}` : `🎬 ${t("مرئي", "Video")}`}
            </button>
          ))}
        </div>
      </div>

      {/* فلتر الفولدرات */}
      {folders.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold text-muted">
            📁 {t("الفولدر", "Folder")}:
          </span>
          <button
            onClick={() => setFolderFilter("all")}
            className={`rounded-lg px-3 py-1.5 text-[11px] font-medium transition ${
              folderFilter === "all"
                ? "bg-slate-800 text-white shadow-sm"
                : "bg-surface-soft text-text-soft hover:text-text"
            }`}
          >
            {t("الكل", "All")}
          </button>
          {folders.map((f) => (
            <button
              key={f.id}
              onClick={() => setFolderFilter(f.id)}
              className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] font-medium transition ${
                folderFilter === f.id
                  ? "bg-slate-800 text-white shadow-sm"
                  : "bg-surface-soft text-text-soft hover:text-text"
              }`}
            >
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: f.color }}
              />
              {f.name}
            </button>
          ))}
          {lessons.some((l) => !l.categoryId) && (
            <button
              onClick={() => setFolderFilter("none")}
              className={`rounded-lg px-3 py-1.5 text-[11px] font-medium transition ${
                folderFilter === "none"
                  ? "bg-slate-800 text-white shadow-sm"
                  : "bg-surface-soft text-text-soft hover:text-text"
              }`}
            >
              {t("بدون فولدر", "No folder")}
            </button>
          )}
        </div>
      )}

      {/* المحتوى */}
      {loading ? (
        <div className="grid gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-surface-soft" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface-soft px-6 py-14 text-center">
          <p className="text-3xl">🎧</p>
          <p className="mt-3 font-semibold text-text">{t("لا توجد دروس بعد", "No lessons yet")}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">
            {t(
              "ارفع مستندًا من الصفحة الرئيسية ثم اضغط «حوّل لدرس صوتي» أو «حوّل لدرس فيديو» لتجربة الميزة الجديدة",
              "Upload a document on the home page then press \"Convert to audio lesson\" or \"Convert to video lesson\""
            )}
          </p>
        </div>
      ) : (
        <div className="space-y-9">
          {orderedKeys.map((key) => {
            const g = groupMap.get(key);
            if (!g) return null;

            return (
              <section key={key}>
                {/* رأس الفولدر */}
                <div className="mb-4 flex items-center gap-2.5 border-b border-border pb-2.5">
                  <span className="text-lg">📁</span>
                  <h2 className="text-base font-bold text-text">{g.name}</h2>
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: g.color || "#64748b" }}
                  />
                  <span className="rounded-full bg-surface-soft px-2.5 py-0.5 text-[11px] font-medium text-muted">
                    {g.count} {t("درس", g.count === 1 ? "lesson" : "lessons")}
                  </span>
                </div>

                {/* الملفات داخل الفولدر */}
                <div className="space-y-5">
                  {g.docs.map((doc) => (
                    <div key={doc.id}>
                      <div className="mb-2 flex items-center gap-2">
                        <span className="text-sm">📄</span>
                        <h3 className="truncate text-sm font-semibold text-text-soft">
                          {doc.title}
                        </h3>
                        <span className="text-[10px] text-muted">
                          ({doc.lessons.length})
                        </span>
                        {doc.id !== "__nodoc__" && (
                          <button
                            onClick={() => openDoc(doc.id)}
                            title={isEn ? "Open in home page — create another lesson" : "افتح الملف في الصفحة الرئيسية — ولّد درس جديد"}
                            className="shrink-0 rounded-lg px-2 py-1 text-[10px] text-slate-400 transition hover:bg-emerald-50 hover:text-emerald-600"
                          >
                            🚀
                          </button>
                        )}
                      </div>

                      <div className="grid gap-3">
                        {doc.lessons.map((lesson) => (
                          <LessonCard key={lesson.id} lesson={lesson} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
