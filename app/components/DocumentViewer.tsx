"use client";

import { useEffect, useState } from "react";

/* =========================================================
   عارض المستند: التحليل + الصور المستخرجة + الدروس المرتبطة
========================================================= */

type AssetAnalysis = {
  description: string;
  textInImage?: string;
  educationalNote?: string;
};

type Asset = {
  id: string;
  url: string | null;
  pageNumber: number | null;
  source: string;
  analysis: AssetAnalysis | null;
};

type Lesson = {
  id: string;
  kind: string;
  mode: string;
  title: string;
  mimeType: string | null;
  durationSec: number | null;
  status: string;
  errorMessage?: string | null;
  url: string | null;
};

type AnalysisData = {
  title?: string;
  summary?: string;
  topics?: string[];
  keyPoints?: string[];
  definitions?: Array<{ term: string; definition: string }>;
  importantNotes?: string[];
};

export default function DocumentViewer(options: {
  documentId: string;
  fileName: string;
  onClose: () => void;
  isEn?: boolean;
}) {
  const { documentId, fileName, onClose, isEn } = options;

  const [analysis, setAnalysis] = useState<AnalysisData | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);

  const t = (ar: string, en: string) => (isEn ? en : ar);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [docRes, assetsRes, lessonsRes] = await Promise.all([
          fetch(`/api/documents/${documentId}`, { credentials: "include" }),
          fetch(`/api/documents/${documentId}/assets`, { credentials: "include" }),
          fetch(`/api/lessons?documentId=${documentId}`, { credentials: "include" }),
        ]);

        if (cancelled) return;

        if (docRes.ok) {
          const data = await docRes.json();
          setAnalysis(data.document?.analysis || null);
        }

        if (assetsRes.ok) {
          const data = await assetsRes.json();
          setAssets(data.assets || []);
        }

        if (lessonsRes.ok) {
          const data = await lessonsRes.json();
          setLessons(data.lessons || []);
        }
      } catch {
        /* تجاهل */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [documentId]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
        {/* العنوان */}
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-100 bg-white px-6 py-4">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-bold text-slate-800">📄 {fileName}</h3>
            <p className="text-xs text-slate-400">{t("عرض التحليل والصور والدروس", "Analysis, images & lessons")}</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label={t("إغلاق", "Close")}
          >
            ✕
          </button>
        </div>

        <div className="space-y-6 p-6">
          {loading ? (
            <div className="flex flex-col items-center gap-3 py-12">
              <div className="h-7 w-7 animate-spin rounded-full border-4 border-slate-200 border-t-slate-700" />
              <p className="text-xs text-slate-400">{t("جاري التحميل...", "Loading...")}</p>
            </div>
          ) : (
            <>
              {/* الملخص */}
              {analysis?.summary && (
                <section>
                  <h4 className="mb-2 text-sm font-bold text-slate-700">📝 {t("الملخص", "Summary")}</h4>
                  <p className="whitespace-pre-line rounded-xl bg-slate-50 p-4 text-xs leading-6 text-slate-600">
                    {analysis.summary}
                  </p>
                </section>
              )}

              {/* المواضيع */}
              {analysis?.topics && analysis.topics.length > 0 && (
                <section>
                  <h4 className="mb-2 text-sm font-bold text-slate-700">🎯 {t("المواضيع", "Topics")}</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {analysis.topics.map((topic, i) => (
                      <span key={i} className="rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                        {topic}
                      </span>
                    ))}
                  </div>
                </section>
              )}

              {/* النقاط */}
              {analysis?.keyPoints && analysis.keyPoints.length > 0 && (
                <section>
                  <h4 className="mb-2 text-sm font-bold text-slate-700">✨ {t("أهم النقاط", "Key points")}</h4>
                  <ul className="space-y-1.5">
                    {analysis.keyPoints.map((point, i) => (
                      <li key={i} className="flex gap-2 text-xs leading-5 text-slate-600">
                        <span className="text-blue-500">•</span>
                        {point}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* الصور */}
              <section>
                <h4 className="mb-2 text-sm font-bold text-slate-700">
                  🖼️ {t("الصور المستخرجة", "Extracted images")}
                  {assets.length > 0 && (
                    <span className="ml-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
                      {assets.length}
                    </span>
                  )}
                </h4>

                {assets.length === 0 ? (
                  <p className="rounded-xl bg-slate-50 p-4 text-xs text-slate-400">
                    {t("لا توجد صور مستخرجة لهذا المستند", "No images extracted for this document")}
                  </p>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {assets.map((asset) => (
                      <div key={asset.id} className="overflow-hidden rounded-xl border border-slate-200">
                        {asset.url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={asset.url}
                            alt={asset.analysis?.description || "صورة"}
                            className="max-h-56 w-full bg-slate-50 object-contain"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex h-36 items-center justify-center bg-slate-50 text-slate-300">🖼️</div>
                        )}
                        <div className="p-2.5">
                          {asset.pageNumber != null && (
                            <span className="mb-1 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
                              {t(`صفحة ${asset.pageNumber}`, `Page ${asset.pageNumber}`)}
                            </span>
                          )}
                          {asset.analysis?.description && (
                            <p className="text-[11px] leading-5 text-slate-600">{asset.analysis.description}</p>
                          )}
                          {asset.analysis?.educationalNote && (
                            <p className="mt-1 rounded-lg bg-amber-50 px-2 py-1 text-[10px] leading-4 text-amber-800">
                              💡 {asset.analysis.educationalNote}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* الدروس */}
              <section>
                <h4 className="mb-2 text-sm font-bold text-slate-700">🎧 {t("دروس هذا المستند", "Lessons from this document")}</h4>

                {lessons.length === 0 ? (
                  <p className="rounded-xl bg-slate-50 p-4 text-xs text-slate-400">
                    {t(
                      "لم تنشئ دروسًا من هذا المستند بعد — افتح الصفحة الرئيسية وارفع الملف أو استخدم أزرار الدروس",
                      "No lessons created yet — use the lesson buttons after analyzing"
                    )}
                  </p>
                ) : (
                  <div className="space-y-3">
                    {lessons.map((lesson) => (
                      <div key={lesson.id} className="rounded-xl border border-slate-200 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-xs font-semibold text-slate-700">
                            {lesson.kind === "audio" ? "🎧" : "🎬"} {lesson.title}
                          </p>
                          {lesson.durationSec ? (
                            <span className="shrink-0 text-[10px] text-slate-400">
                              {Math.round(lesson.durationSec / 60)} {t("دقيقة", "min")}
                            </span>
                          ) : null}
                        </div>

                        {lesson.status === "completed" && lesson.url && (
                          <div className="mt-2">
                            {lesson.mimeType?.includes("audio") ? (
                              <audio controls src={lesson.url} className="w-full" />
                            ) : (
                              <video controls src={lesson.url} className="max-h-64 w-full rounded-lg bg-black" />
                            )}
                          </div>
                        )}

                        {lesson.status === "failed" && (
                          <p className="mt-1 text-[11px] text-red-500">⚠️ {lesson.errorMessage}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
