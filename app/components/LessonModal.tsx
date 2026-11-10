"use client";

import { useState, useEffect, useCallback } from "react";

/* =========================================================
   نافذة إنشاء الدروس: صوتي (شرح/بودكاست) أو فيديو (شرائح/Veo)
========================================================= */

type LessonKind = "audio" | "video";
type LessonStyle = "narration" | "podcast";
type VideoMode = "slides" | "veo";
type Dialect = "egyptian" | "msa";

export type LessonResult = {
  lessonId: string;
  kind: string;
  mode: string;
  title: string;
  mimeType: string;
  durationSec: number;
  url: string | null;
};

/* درس محفوظ من قبل — بيرجع من GET /api/lessons?documentId= */
type SavedLesson = {
  id: string;
  kind: string;
  mode: string;
  title: string;
  mimeType: string | null;
  durationSec: number | null;
  status: string;
  errorMessage?: string | null;
  createdAt: string;
  url: string | null;
};

const fmtDuration = (sec: number | null) => {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

const VOICES = [
  { id: "Kore", label: "كوري (أنثى — ثابتة)" },
  { id: "Puck", label: "بَك (ذكر — حيوي)" },
  { id: "Charon", label: "خارون (ذكر — إخباري)" },
  { id: "Aoede", label: "أويدي (أنثى — هادئة)" },
  { id: "Fenrir", label: "فنرير (ذكر — متحمس)" },
  { id: "Leda", label: "ليدا (أنثى — شابة)" },
];

/* باقات تظهر عند منع الباقة المجانية (ترقية فورية من داخل النافذة) */
type UpsellPlan = {
  id: string;
  name: string;
  price: number;
  duration_days: number;
  tts_daily_limit: number | null;
  video_daily_limit: number | null;
};

export default function LessonModal(options: {
  documentId: string;
  documentTitle: string;
  onClose: () => void;
  isEn?: boolean;
}) {
  const { documentId, documentTitle, onClose, isEn } = options;

  const [kind, setKind] = useState<LessonKind>("audio");
  const [style, setStyle] = useState<LessonStyle>("narration");
  const [voice, setVoice] = useState("Kore");
  const [videoMode, setVideoMode] = useState<VideoMode>("slides");
  /* لهجة التعليق — الافتراضي مصري 🇪🇬 */
  const [dialect, setDialect] = useState<Dialect>("egyptian");

  const [loading, setLoading] = useState(false);
  const [progressLabel, setProgressLabel] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<LessonResult | null>(null);

  /* ترقية فورية: لما المنع يكون بسبب الباقة المجانية نعرض الباقات المدفوعة هنا */
  const [upgradeRequired, setUpgradeRequired] = useState(false);
  const [upsellPlans, setUpsellPlans] = useState<UpsellPlan[]>([]);

  /* الدروس المحفوظة — بتتحمل فور فتح النافذة */
  const [saved, setSaved] = useState<SavedLesson[]>([]);
  const [savedLoading, setSavedLoading] = useState(true);

  const t = (ar: string, en: string) => (isEn ? en : ar);

  const loadSaved = useCallback(async () => {
    setSavedLoading(true);
    try {
      const res = await fetch(`/api/lessons?documentId=${documentId}`, {
        credentials: "include",
      });
      const data = await res.json();
      setSaved(data.lessons || []);
    } catch {
      /* تجاهل */
    } finally {
      setSavedLoading(false);
    }
  }, [documentId]);

  useEffect(() => {
    loadSaved();
  }, [loadSaved]);

  async function createLesson() {
    setLoading(true);
    setError("");
    setResult(null);
    setUpgradeRequired(false);

    setProgressLabel(
      kind === "audio"
        ? t("جاري تحويل الدرس إلى نص منطوق ثم صوت... قد يستغرق دقيقة", "Converting lesson to speech... may take a minute")
        : videoMode === "slides"
        ? t("جاري توليد الشرائح والتعليق الصوتي وتجميع الفيديو... قد يستغرق عدة دقائق", "Rendering slides, narration and video... may take several minutes")
        : t("جاري توليد فيديو AI عبر Veo... قد يستغرق عدة دقائق", "Generating AI video via Veo... may take several minutes")
    );

    try {
      const response = await fetch("/api/lessons", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId,
          kind,
          style,
          voice,
          videoMode,
          dialect,
          lang: isEn ? "en" : "ar",
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.error || t("حدث خطأ غير متوقع", "Unexpected error"));

        /* الباقة المجانية → نجيب الباقات المدفوعة ونعرضها للترقية فوراً */
        if (data.upgradeRequired) {
          setUpgradeRequired(true);
          try {
            const plansRes = await fetch("/api/plans");
            const plansData = await plansRes.json();
            setUpsellPlans(
              (plansData.plans || []).filter(
                (p: UpsellPlan) => p.price > 0
              )
            );
          } catch {
            /* تجاهل */
          }
        }
        return;
      }

      setResult(data as LessonResult);
      loadSaved(); // تحديث قائمة الدروس المحفوظة
    } catch {
      setError(t("تعذر الاتصال بالخادم", "Failed to reach the server"));
    } finally {
      setLoading(false);
      setProgressLabel("");
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-foreground/40 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-surface p-6 shadow-2xl ring-1 ring-border">
        {/* العنوان */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-text">
              🎬 {t("حوّل الدرس", "Convert Lesson")}
            </h3>
            <p className="mt-1 line-clamp-1 text-[13px] text-muted">{documentTitle}</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition hover:bg-surface-hover hover:text-text"
            aria-label={t("إغلاق", "Close")}
          >
            ✕
          </button>
        </div>

        {result ? (
          /* ====== النتيجة ====== */
          <div className="mt-5 space-y-4">
            <div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              ✅ {t("تم إنشاء الدرس بنجاح!", "Lesson created successfully!")}
            </div>

            <div className="rounded-xl border border-border bg-surface-soft p-4">
              <p className="text-sm font-semibold text-text">{result.title}</p>
              <p className="mt-1 text-xs text-muted">
                {result.kind === "audio" ? "🎧 درس صوتي" : "🎬 درس مرئي"}
                {result.durationSec ? ` · ${Math.round(result.durationSec / 60)} دقيقة` : ""}
              </p>

              {result.url && (
                <div className="mt-3">
                  {result.mimeType.includes("audio") ? (
                    <audio controls src={result.url} className="w-full" />
                  ) : (
                    <video controls src={result.url} className="w-full rounded-lg" />
                  )}
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setResult(null)}
                className="flex-1 rounded-xl bg-primary px-4 py-2.5 text-center text-sm font-bold text-surface transition hover:brightness-110"
              >
                {t("دروس هذا المستند", "This document's lessons")}
              </button>
              <a
                href="/lessons"
                className="flex-1 rounded-xl border border-border px-4 py-2.5 text-center text-sm font-medium text-text-soft transition hover:bg-surface-hover"
              >
                {t("كل دروسي", "All my lessons")}
              </a>
            </div>
            <button
              onClick={onClose}
              className="w-full rounded-xl px-4 py-1.5 text-center text-xs text-muted transition hover:text-text"
            >
              {t("إغلاق", "Close")}
            </button>
          </div>
        ) : (
          /* ====== الخيارات ====== */
          <div className="mt-5 space-y-5">
            {/* الدروس المحفوظة لهذا المستند — بتظهر فور الفتح */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[13px] font-semibold text-text">
                  💾 {t("دروس محفوظة لهذا المستند", "Saved lessons")}
                  {saved.length > 0 && (
                    <span className="mx-1.5 inline-block rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-bold text-primary">
                      {saved.length}
                    </span>
                  )}
                </p>
                <button
                  onClick={loadSaved}
                  className="text-[11px] text-muted transition hover:text-text"
                >
                  ⟳ {t("تحديث", "Refresh")}
                </button>
              </div>

              {savedLoading ? (
                <div className="space-y-2">
                  {[1, 2].map((i) => (
                    <div key={i} className="h-14 animate-pulse rounded-xl bg-surface-soft" />
                  ))}
                </div>
              ) : saved.length === 0 ? (
                <p className="rounded-xl bg-surface-soft p-3 text-xs leading-5 text-muted">
                  {t(
                    "لا توجد دروس محفوظة بعد — أي درس تنشأه من هنا يُحفظ تلقائيًا وتلاقيه في أي وقت من جديد",
                    "No saved lessons yet — any lesson you create is saved automatically"
                  )}
                </p>
              ) : (
                <div className="max-h-72 space-y-2 overflow-y-auto">
                  {saved.map((l) => (
                    <div
                      key={l.id}
                      className="rounded-xl border border-border bg-surface-soft p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-xs font-semibold text-text">
                          {l.kind === "audio" ? "🎧" : "🎬"} {l.title}
                        </p>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {l.durationSec ? (
                            <span className="text-[10px] text-muted" dir="ltr">
                              {fmtDuration(l.durationSec)}
                            </span>
                          ) : null}
                          {l.mode && (
                            <span className="rounded-full bg-surface px-2 py-0.5 text-[9px] text-muted">
                              {l.mode === "podcast"
                                ? t("بودكاست", "Podcast")
                                : l.mode === "veo"
                                ? "AI Veo"
                                : l.mode === "slides"
                                ? t("شرائح", "Slides")
                                : t("شرح", "Narration")}
                            </span>
                          )}
                        </div>
                      </div>

                      {l.status === "completed" && l.url && (
                        <div className="mt-2">
                          {l.mimeType?.includes("audio") ? (
                            <audio controls src={l.url} className="w-full" />
                          ) : (
                            <video
                              controls
                              src={l.url}
                              className="max-h-44 w-full rounded-lg bg-black"
                            />
                          )}
                        </div>
                      )}

                      {l.status === "processing" && (
                        <p className="mt-1 text-[11px] text-amber-500">
                          ⏳ {t("جاري المعالجة...", "Processing...")}
                        </p>
                      )}

                      {l.status === "failed" && (
                        <p className="mt-1 text-[11px] text-red-500">
                          ⚠️ {l.errorMessage || t("فشل إنشاء الدرس", "Lesson failed")}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* النوع */}
            <div>
              <p className="mb-2 text-[13px] font-semibold text-text">{t("النوع", "Type")}</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setKind("audio")}
                  className={`rounded-xl border px-4 py-3 text-sm font-medium transition ${
                    kind === "audio"
                      ? "border-primary bg-primary-soft text-primary"
                      : "border-border text-text-soft hover:bg-surface-hover"
                  }`}
                >
                  🎧 {t("درس صوتي", "Audio lesson")}
                </button>
                <button
                  onClick={() => setKind("video")}
                  className={`rounded-xl border px-4 py-3 text-sm font-medium transition ${
                    kind === "video"
                      ? "border-primary bg-primary-soft text-primary"
                      : "border-border text-text-soft hover:bg-surface-hover"
                  }`}
                >
                  🎬 {t("درس فيديو", "Video lesson")}
                </button>
              </div>
            </div>

            {/* الأسلوب الصوتي */}
            {kind === "audio" && (
              <div>
                <p className="mb-2 text-[13px] font-semibold text-text">
                  {t("أسلوب الشرح", "Narration style")}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setStyle("narration")}
                    className={`rounded-xl border px-4 py-3 text-sm font-medium transition ${
                      style === "narration"
                        ? "border-primary bg-primary-soft text-primary"
                        : "border-border text-text-soft hover:bg-surface-hover"
                    }`}
                  >
                    🎙️ {t("شرح مباشر", "Narration")}
                  </button>
                  <button
                    onClick={() => setStyle("podcast")}
                    className={`rounded-xl border px-4 py-3 text-sm font-medium transition ${
                      style === "podcast"
                        ? "border-primary bg-primary-soft text-primary"
                        : "border-border text-text-soft hover:bg-surface-hover"
                    }`}
                  >
                    🎙️🎙️ {t("بودكاست بمقدمين", "Two-host podcast")}
                  </button>
                </div>
              </div>
            )}

            {/* اختيار الصوت */}
            {kind === "audio" && style === "narration" && (
              <div>
                <p className="mb-2 text-[13px] font-semibold text-text">{t("الصوت", "Voice")}</p>
                <select
                  value={voice}
                  onChange={(e) => setVoice(e.target.value)}
                  className="w-full rounded-xl border border-border bg-surface-soft px-4 py-3 text-sm text-text outline-none transition focus:ring-2 focus:ring-primary/30"
                >
                  {VOICES.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* لهجة التعليق — للعربي فقط */}
            {!isEn && (
              <div>
                <p className="mb-2 text-[13px] font-semibold text-text">
                  {t("لهجة التعليق الصوتي", "Narration dialect")}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setDialect("egyptian")}
                    className={`rounded-xl border px-4 py-3 text-sm font-medium transition ${
                      dialect === "egyptian"
                        ? "border-primary bg-primary-soft text-primary"
                        : "border-border text-text-soft hover:bg-surface-hover"
                    }`}
                  >
                    🇪🇬 {t("مصري", "Egyptian")}
                    <span className="mt-0.5 block text-[10px] text-muted">
                      {t("زي المُحاضر المصري", "Like an Egyptian teacher")}
                    </span>
                  </button>
                  <button
                    onClick={() => setDialect("msa")}
                    className={`rounded-xl border px-4 py-3 text-sm font-medium transition ${
                      dialect === "msa"
                        ? "border-primary bg-primary-soft text-primary"
                        : "border-border text-text-soft hover:bg-surface-hover"
                    }`}
                  >
                    📚 {t("فصحى", "Formal Arabic")}
                    <span className="mt-0.5 block text-[10px] text-muted">
                      {t("عربية فصحى مبسطة", "Simple formal Arabic")}
                    </span>
                  </button>
                </div>
              </div>
            )}

            {/* وضع الفيديو */}
            {kind === "video" && (
              <div>
                <p className="mb-2 text-[13px] font-semibold text-text">{t("طريقة الفيديو", "Video method")}</p>
                <div className="space-y-2">
                  <button
                    onClick={() => setVideoMode("slides")}
                    className={`w-full rounded-xl border px-4 py-3 text-start text-sm font-medium transition ${
                      videoMode === "slides"
                        ? "border-primary bg-primary-soft text-primary"
                        : "border-border text-text-soft hover:bg-surface-hover"
                    }`}
                  >
                    🖼️ {t("شرائح + تعليق صوتي", "Slides + voiceover")}
                    <span className="block text-xs text-muted">
                      {t("شرائح مصممة بالعربية مع شرح صوتي — الأسرع والأوفر", "Designed Arabic slides with narration — faster and cheaper")}
                    </span>
                  </button>
                  <button
                    onClick={() => setVideoMode("veo")}
                    className={`w-full rounded-xl border px-4 py-3 text-start text-sm font-medium transition ${
                      videoMode === "veo"
                        ? "border-primary bg-primary-soft text-primary"
                        : "border-border text-text-soft hover:bg-surface-hover"
                    }`}
                  >
                    ✨ {t("فيديو AI (Veo)", "AI video (Veo)")}
                    <span className="block text-xs text-muted">
                      {t("لقطة فيديو مولدة بالذكاء الاصطناعي (~8 ثوانٍ) — تجريبية", "AI-generated video clip (~8s) — experimental")}
                    </span>
                  </button>
                </div>
              </div>
            )}

            {/* الخطأ */}
            {error && (
              <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-300">
                {error}
              </div>
            )}

            {/* ترقية فورية: الباقات المدفوعة تظهر هنا عند منع الباقة المجانية */}
            {upgradeRequired && upsellPlans.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-[13px] font-bold text-amber-800">
                  🚀 {t("اشترك في باقة وشغّل الدروس فوراً", "Upgrade to unlock lessons")}
                </p>
                <div className="mt-3 space-y-2">
                  {upsellPlans.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-surface px-3.5 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold text-text">{p.name}</p>
                        <p className="mt-0.5 text-[10px] text-muted" dir="rtl">
                          {p.tts_daily_limit != null && p.tts_daily_limit > 0
                            ? `🎧 ${p.tts_daily_limit} ${t("درس صوتي/يوم", "audio/day")}`
                            : t("🎧 دروس صوتية غير محدودة", "🎧 Unlimited audio")}
                          {" · "}
                          {p.video_daily_limit != null && p.video_daily_limit > 0
                            ? `🎬 ${p.video_daily_limit} ${t("درس فيديو/يوم", "video/day")}`
                            : t("🎬 دروس فيديو غير محدودة", "🎬 Unlimited video")}
                        </p>
                      </div>
                      <div className="shrink-0 text-end">
                        <p className="text-sm font-black text-primary" dir="ltr">
                          {p.price} {t("جنيه", "EGP")}
                        </p>
                        <p className="text-[10px] text-muted">
                          {p.duration_days} {t("يوم", "days")}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
                <a
                  href="/subscribe"
                  className="mt-3 block rounded-lg bg-primary px-4 py-2.5 text-center text-xs font-bold text-surface transition hover:brightness-110"
                >
                  {t("اشترك دلوقتي — دفع وتفعيل فوري", "Subscribe now — instant activation")}
                </a>
              </div>
            )}

            {/* التقدم */}
            {loading && (
              <div className="rounded-xl bg-primary-soft px-4 py-3 text-sm text-primary">
                <div className="flex items-center gap-2">
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  {progressLabel}
                </div>
              </div>
            )}

            {/* زر الإنشاء */}
            <button
              onClick={createLesson}
              disabled={loading}
              className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-bold text-surface transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading
                ? t("جاري الإنشاء...", "Creating...")
                : t("إنشاء الدرس", "Create lesson")}
            </button>

            <p className="text-center text-[11px] text-muted">
              {t(
                "توليد الدروس الصوتية والمرئية متاح للباقات المدفوعة حسب حدود باقتك",
                "Audio & video lesson generation is for paid plans per your quota"
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
