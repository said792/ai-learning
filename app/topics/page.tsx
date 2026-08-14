"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useLanguage } from "../context/LanguageContext";

/* =========================================================
   Types
========================================================= */

interface Analysis {
  title: string;
  documentType?: string;
  summary: string;
  subject?: string;
  recipient?: string;
  requester?: string;
  locations?: string[];
  topics: string[];
  rules: { title: string; description: string }[];
  procedures: { title: string; steps: string[] }[];
  settings: { name: string; value: string; description: string }[];
  calculations: { name: string; description: string; formula?: string }[];
  importantNotes: string[];
  keywords: string[];
  learningObjectives?: string[];
  keyPoints?: string[];
  examples?: string[];
  questions?: string[];
  commonMistakes?: string[];
  definitions?: { term: string; definition: string }[];
}

interface Doc {
  id: string;
  file_name: string;
  file_type: string | null;
  media_type: string | null;
  file_size: number | null;
  extracted_text: string | null;
  analysis: Analysis | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface Topic {
  id: string;
  name: string;
  documentId: string;
  documentName: string;
  documentType?: string;
  createdAt: string;
}

interface Msg {
  role: "user" | "assistant";
  content: string;
}

/* =========================================================
   Clean Markdown & LaTeX from AI Responses
========================================================= */

function cleanAI(text: string): string {
  return text
    .replace(/###\s*/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\$\$([^$]+)\$\$/g, "$1")
    .replace(/\$([^$]+)\$/g, "$1")
    .replace(/\\text\{([^}]+)\}/g, "$1")
    .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, "($1)/($2)")
    .replace(/\\sqrt\{([^}]+)\}/g, "√($1)")
    .replace(/\\theta/g, "θ")
    .replace(/\\sin/g, "sin")
    .replace(/\\cos/g, "cos")
    .replace(/\\tan/g, "tan")
    .replace(/\\csc/g, "csc")
    .replace(/\\sec/g, "sec")
    .replace(/\\cot/g, "cot")
    .replace(/\\left/g, "")
    .replace(/\\right/g, "")
    .replace(/\\,/g, ", ")
    .replace(/\\[a-zA-Z]+/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* =========================================================
   Helper: Build Context from Analysis
========================================================= */

function buildAnalysisContext(analysis: Analysis | null): string {
  if (!analysis) return "";

  const parts: string[] = [];

  parts.push(`العنوان: ${analysis.title}`);
  if (analysis.summary) parts.push(`الملخص: ${analysis.summary}`);
  if (analysis.subject) parts.push(`الموضوع الرئيسي: ${analysis.subject}`);
  if (analysis.topics?.length) parts.push(`المواضيع: ${analysis.topics.join("، ")}`);
  if (analysis.keywords?.length) parts.push(`الكلمات المفتاحية: ${analysis.keywords.join("، ")}`);

  if (analysis.definitions?.length) {
    parts.push("\nالتعريفات:");
    analysis.definitions.forEach((d) => parts.push(`- ${d.term}: ${d.definition}`));
  }
  if (analysis.rules?.length) {
    parts.push("\nالقواعد:");
    analysis.rules.forEach((r) => parts.push(`- ${r.title}: ${r.description}`));
  }
  if (analysis.procedures?.length) {
    parts.push("\nالإجراءات:");
    analysis.procedures.forEach((p) => {
      parts.push(`- ${p.title}:`);
      p.steps.forEach((s, i) => parts.push(`  ${i + 1}. ${s}`));
    });
  }
  if (analysis.keyPoints?.length) {
    parts.push("\nالنقاط المهمة:");
    analysis.keyPoints.forEach((kp) => parts.push(`- ${kp}`));
  }
  if (analysis.examples?.length) {
    parts.push("\nالأمثلة:");
    analysis.examples.forEach((ex) => parts.push(`- ${ex}`));
  }
  if (analysis.importantNotes?.length) {
    parts.push("\nملاحظات مهمة:");
    analysis.importantNotes.forEach((n) => parts.push(`- ${n}`));
  }
  if (analysis.commonMistakes?.length) {
    parts.push("\nأخطاء شائعة:");
    analysis.commonMistakes.forEach((m) => parts.push(`- ${m}`));
  }
  if (analysis.calculations?.length) {
    parts.push("\nالحسابات:");
    analysis.calculations.forEach((c) =>
      parts.push(`- ${c.name}: ${c.description}${c.formula ? ` (المعادلة: ${c.formula})` : ""}`)
    );
  }
  if (analysis.questions?.length) {
    parts.push("\nأسئلة:");
    analysis.questions.forEach((q) => parts.push(`- ${q}`));
  }
  if (analysis.learningObjectives?.length) {
    parts.push("\nأهداف التعلم:");
    analysis.learningObjectives.forEach((obj) => parts.push(`- ${obj}`));
  }

  return parts.join("\n");
}

/* =========================================================
   Main Component
========================================================= */

export default function TopicsPage() {
  const { lang, setLang, dir } = useLanguage();
  const isEn = lang === "en";

  const [docs, setDocs] = useState<Doc[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [sel, setSel] = useState<Topic | null>(null);
  const [selDoc, setSelDoc] = useState<Doc | null>(null);
  const [cache, setCache] = useState<Record<string, Doc>>({});
  const [loading, setLoading] = useState(true);
  const [docLoad, setDocLoad] = useState(false);
  const [err, setErr] = useState("");

  const [q, setQ] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [cq, setCq] = useState("");
  const [cl, setCl] = useState(false);
  const [ce, setCe] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);

  const [topicExplanation, setTopicExplanation] = useState("");
  const [loadingExplanation, setLoadingExplanation] = useState(false);
  const [explanationError, setExplanationError] = useState("");

  /* =====================================================
     Load
  ===================================================== */
  const load = useCallback(async () => {
    try {
      setLoading(true);
      setErr("");
      const r = await fetch("/api/documents");
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "فشل تحميل المستندات");
      const ds: Doc[] = d.documents || [];
      setDocs(ds);
      const ts: Topic[] = [];
      ds.forEach((d) => {
        d.analysis?.topics?.forEach((name, i) => {
          ts.push({
            id: `${d.id}-${i}`,
            name,
            documentId: d.id,
            documentName: d.file_name,
            documentType: d.analysis?.documentType,
            createdAt: d.created_at,
          });
        });
      });
      setTopics(ts);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "حدث خطأ أثناء تحميل الموضوعات");
    } finally {
      setLoading(false);
    }
  }, [lang]);

  useEffect(() => {
    load();
  }, [load]);

  /* =====================================================
     Pick
  ===================================================== */
  const pick = useCallback(
    async (tp: Topic) => {
      if (sel?.id === tp.id && selDoc) return;
      setSel(tp);
      setMsgs([]);
      setCq("");
      setCe("");
      setTopicExplanation("");
      setExplanationError("");
      mainRef.current?.scrollTo({ top: 0, behavior: "smooth" });

      if (cache[tp.documentId]) {
        setSelDoc(cache[tp.documentId]);
        return;
      }
      try {
        setDocLoad(true);
        const r = await fetch(`/api/documents/${tp.documentId}`);
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "فشل تحميل المستند");
        const doc: Doc = d.document;
        setSelDoc(doc);
        setCache((p) => ({ ...p, [doc.id]: doc }));
      } catch (e) {
        setCe(e instanceof Error ? e.message : "فشل تحميل المستند");
      } finally {
        setDocLoad(false);
      }
    },
    [cache, sel?.id, selDoc]
  );

  const filtered = q.trim()
    ? topics.filter(
        (tp) =>
          tp.name.toLowerCase().includes(q.toLowerCase()) ||
          tp.documentName.toLowerCase().includes(q.toLowerCase())
      )
    : topics;

  /* =====================================================
     Explanation
  ===================================================== */
  const getTopicExplanation = useCallback(
    async (topicName: string, doc: Doc) => {
      setLoadingExplanation(true);
      setTopicExplanation("");
      setExplanationError("");
      try {
        const shortQuestion = isEn
          ? `Provide a detailed, comprehensive, and clear explanation of the topic: "${topicName}". Include: definition, detailed explanation, related rules, procedures with steps, examples, important notes, and common mistakes to avoid.`
          : `قدم شرحاً مفصلاً وشاملاً وواضحاً لموضوع: "${topicName}". يتضمن: التعريف، الشرح التفصيلي، القواعد المتعلقة، الإجراءات بالخطوات، أمثلة توضيحية، ملاحظات مهمة، وأخطاء شائعة يجب تجنبها.`;

        const r = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: shortQuestion,
            documentText: doc.extracted_text || "",
            analysisText: buildAnalysisContext(doc.analysis),
            analysis: doc.analysis,
            lang,
          }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || d.message || `خطأ HTTP: ${r.status}`);
        setTopicExplanation(d.answer || d.response || d.content || d.message || "");
      } catch (e) {
        const msg = e instanceof Error ? e.message : "فشل في الحصول على شرح الموضوع";
        setExplanationError(msg);
      } finally {
        setLoadingExplanation(false);
      }
    },
    [isEn, lang]
  );

  useEffect(() => {
    if (sel && selDoc && selDoc.analysis) {
      setTopicExplanation("");
      setExplanationError("");
      getTopicExplanation(sel.name, selDoc);
    }
  }, [sel?.id, selDoc?.id, lang]);

  /* =====================================================
     Chat
  ===================================================== */
  const ask = useCallback(async () => {
    const txt = cq.trim();
    if (!txt || !selDoc) return;
    const questionContext = sel
      ? isEn
        ? `Regarding the topic "${sel.name}" from the document "${sel.documentName}": ${txt}`
        : `بخصوص موضوع "${sel.name}" من مستند "${sel.documentName}": ${txt}`
      : txt;
    setMsgs((p) => [...p, { role: "user", content: txt }]);
    setCq("");
    setCl(true);
    setCe("");
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: questionContext,
          documentText: selDoc.extracted_text || "",
          analysisText: buildAnalysisContext(selDoc.analysis),
          analysis: selDoc.analysis,
          lang,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || d.message || `خطأ HTTP: ${r.status}`);
      setMsgs((p) => [
        ...p,
        { role: "assistant", content: d.answer || d.response || d.content || d.message || "—" },
      ]);
    } catch (e) {
      setCe(e instanceof Error ? e.message : "فشل في إرسال السؤال");
    } finally {
      setCl(false);
    }
  }, [cq, selDoc, sel, lang, isEn]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, cl]);

  const navigateToTopic = useCallback(
    (topicName: string) => {
      const found = topics.find((t) => t.name === topicName && t.id !== sel?.id);
      if (found) pick(found);
    },
    [topics, sel?.id, pick]
  );

  const suggestions = sel
    ? isEn
      ? [
          `Explain "${sel.name}" simply`,
          `Key points of "${sel.name}"?`,
          `Examples for "${sel.name}"`,
        ]
      : [
          `اشرح "${sel.name}" ببساطة`,
          `نقاط "${sel.name}" المهمة؟`,
          `أمثلة عن "${sel.name}"`,
        ]
    : [];

  /* =====================================================
     Render
  ===================================================== */

  if (loading) return <LoadingState message={isEn ? "Loading your topics..." : "جاري تحميل موضوعاتك..."} />;
  if (err) return <ErrorState message={err} onRetry={load} isEn={isEn} dir={dir} />;
  if (!topics.length) return <EmptyState isEn={isEn} dir={dir} />;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50" dir={dir}>
      <div className="mx-auto max-w-6xl px-4 py-6 pt-20 sm:px-6 lg:px-8 lg:pt-6">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 text-xl text-white shadow-lg shadow-slate-800/20">
              📚
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900">
                {isEn ? "Topics Reference" : "مرجع الموضوعات"}
              </h1>
              <div className="mt-1 flex items-center gap-2.5">
                <span className="rounded-full bg-blue-50 px-3 py-0.5 text-[10px] font-bold text-blue-600 ring-1 ring-blue-100">
                  {topics.length} {isEn ? "Topics" : "موضوع"}
                </span>
                <span className="rounded-full bg-slate-100 px-3 py-0.5 text-[10px] font-medium text-slate-500">
                  {docs.length} {isEn ? "Documents" : "مستند"}
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={() => setLang(lang === "ar" ? "en" : "ar")}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white/80 px-4 py-2 text-xs font-medium text-slate-600 shadow-sm backdrop-blur-sm transition-all hover:bg-white hover:shadow-md"
          >
            <span>🌐</span>
            {isEn ? "العربية" : "English"}
          </button>
        </div>

        {/* Layout */}
        <div className="flex gap-6">
          {/* Sidebar */}
          <aside className="hidden w-72 shrink-0 lg:block">
            <div className="sticky top-6 space-y-3">
              <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm backdrop-blur-sm">
                <div className="relative">
                  <span className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">
                    🔍
                  </span>
                  <input
                    type="text"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder={isEn ? "Search topics..." : "ابحث في الموضوعات..."}
                    dir={dir}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2.5 ps-9 pe-3 text-xs outline-none transition-all placeholder:text-slate-400 focus:border-slate-300 focus:bg-white focus:ring-2 focus:ring-slate-100"
                  />
                </div>
              </div>
              <div className="max-h-[calc(100vh-8rem)] overflow-y-auto rounded-2xl border border-slate-200/80 bg-white/80 p-2 shadow-sm backdrop-blur-sm scrollbar-thin">
                <TopicList
                  topics={filtered}
                  selectedId={sel?.id ?? null}
                  onSelect={pick}
                  dir={dir}
                  isEn={isEn}
                />
              </div>
            </div>
          </aside>

          {/* Mobile Tabs */}
          <div className="w-full lg:hidden">
            <div className="mb-4 rounded-2xl border border-slate-200/80 bg-white/80 p-3 shadow-sm backdrop-blur-sm">
              <div className="relative">
                <span className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">
                  🔍
                </span>
                <input
                  type="text"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={isEn ? "Search..." : "ابحث..."}
                  dir={dir}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2.5 ps-9 pe-3 text-sm outline-none transition-all placeholder:text-slate-400 focus:border-slate-300 focus:bg-white focus:ring-2 focus:ring-slate-100"
                />
              </div>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-3 scrollbar-none">
              {filtered.map((tp) => (
                <button
                  key={tp.id}
                  onClick={() => pick(tp)}
                  className={`shrink-0 rounded-2xl px-5 py-2.5 text-xs font-semibold transition-all duration-300 ${
                    tp.id === sel?.id
                      ? "bg-slate-900 text-white shadow-lg shadow-slate-900/20"
                      : "border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:shadow-md"
                  }`}
                >
                  {tp.name}
                </button>
              ))}
            </div>
          </div>

          {/* Main */}
          <div className="min-w-0 flex-1">
            <div
              className="overflow-y-auto rounded-2xl border border-slate-200/80 bg-white/80 shadow-sm backdrop-blur-sm"
              ref={mainRef}
              style={{ maxHeight: "calc(100vh - 7rem)" }}
            >
              <div className="p-6">
                {!sel ? (
                  <div className="flex flex-col items-center justify-center py-24">
                    <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-slate-50 to-slate-100 text-4xl ring-1 ring-slate-200/50">
                      📖
                    </div>
                    <p className="mt-6 text-sm font-medium text-slate-400">
                      {isEn ? "Select a topic to explore" : "اختر موضوعاً لاستكشافه"}
                    </p>
                  </div>
                ) : docLoad ? (
                  <div className="flex flex-col items-center justify-center py-24">
                    <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-800" />
                    <p className="mt-4 text-sm text-slate-400">
                      {isEn ? "Loading..." : "جاري التحميل..."}
                    </p>
                  </div>
                ) : selDoc ? (
                  <div className="animate-slideUp space-y-6">
                    {/* Banner */}
                    <div className="rounded-2xl bg-gradient-to-r from-slate-900 to-slate-800 p-5 text-white shadow-lg shadow-slate-900/10">
                      <div className="flex items-center justify-between mb-3">
                        <span className="rounded-full bg-white/15 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-white/70">
                          {isEn ? "Selected Topic" : "الموضوع المختار"}
                        </span>
                        <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-3 py-1 text-[10px] font-semibold text-emerald-300">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          {isEn ? "Analyzed" : "تم التحليل"}
                        </span>
                      </div>
                      <h2 className="text-lg font-bold leading-snug">{sel.name}</h2>
                      <p className="mt-1.5 text-xs text-white/50">
                        {isEn ? `From: ${sel.documentName}` : `من: ${sel.documentName}`}
                      </p>
                    </div>

                    {/* Explanation */}
                    <div className="rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50/80 to-white overflow-hidden shadow-sm">
                      <div className="flex items-center justify-between border-b border-blue-100/60 bg-blue-50/40 px-5 py-3">
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-100 text-sm">
                            📖
                          </span>
                          <span className="text-[11px] font-bold text-blue-700 uppercase tracking-wider">
                            {isEn ? "Detailed Explanation" : "شرح تفصيلي"}
                          </span>
                        </div>
                        {topicExplanation && (
                          <button
                            onClick={() => getTopicExplanation(sel.name, selDoc)}
                            className="rounded-lg bg-blue-100/60 px-2.5 py-1 text-[10px] font-semibold text-blue-600 transition-colors hover:bg-blue-100"
                          >
                            {isEn ? "↻ Refresh" : "↻ تحديث"}
                          </button>
                        )}
                      </div>
                      <div className="p-5">
                        {loadingExplanation ? (
                          <div className="flex flex-col items-center py-10 gap-3">
                            <span className="h-7 w-7 animate-spin rounded-full border-[3px] border-blue-200 border-t-blue-600" />
                            <p className="text-xs font-medium text-blue-500">
                              {isEn ? "Generating explanation..." : "جاري إنشاء الشرح..."}
                            </p>
                          </div>
                        ) : explanationError ? (
                          <div className="text-center py-8">
                            <p className="text-xs text-red-500 mb-3">{explanationError}</p>
                            <button
                              onClick={() => getTopicExplanation(sel.name, selDoc)}
                              className="rounded-xl bg-blue-600 px-5 py-2.5 text-[11px] font-semibold text-white shadow-sm hover:bg-blue-700 transition-colors"
                            >
                              {isEn ? "Try Again" : "حاول مرة أخرى"}
                            </button>
                          </div>
                        ) : topicExplanation ? (
                          <div className="whitespace-pre-line text-[13px] leading-8 text-slate-700" dir={dir}>
                            {cleanAI(topicExplanation)}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    {/* Analysis */}
                    <AnalysisPanel
                      doc={selDoc}
                      hl={sel.name}
                      dir={dir}
                      isEn={isEn}
                      onTopicClick={navigateToTopic}
                      lang={lang}
                    />

                    {/* Chat */}
                    <div className="rounded-2xl border border-slate-200/80 overflow-hidden shadow-sm">
                      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-sm">
                            💬
                          </span>
                          <span className="text-xs font-bold text-slate-700">
                            {isEn ? "Ask about this topic" : "اسأل عن هذا الموضوع"}
                          </span>
                        </div>
                        {!selDoc.extracted_text && selDoc.analysis && (
                          <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[10px] font-medium text-amber-600 ring-1 ring-amber-100">
                            {isEn ? "Using analysis" : "استخدام التحليل"}
                          </span>
                        )}
                      </div>

                      <div className="h-72 space-y-3 overflow-y-auto p-4 bg-slate-50/30">
                        {msgs.length === 0 && !cl ? (
                          <div className="flex h-full flex-col items-center justify-center gap-4">
                            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-2xl shadow-sm ring-1 ring-slate-100">
                              💬
                            </div>
                            <p className="text-xs text-slate-400">
                              {isEn
                                ? "Ask anything about this topic..."
                                : "اسأل أي شيء عن هذا الموضوع..."}
                            </p>
                            <div className="flex flex-wrap justify-center gap-2">
                              {suggestions.map((s: string, i: number) => (
                                <button
                                  key={i}
                                  onClick={() => setCq(s)}
                                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-[11px] font-medium text-slate-500 shadow-sm transition-all hover:bg-slate-50 hover:shadow-md"
                                >
                                  {s}
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : (
                          msgs.map((m, i) => (
                            <div
                              key={i}
                              className={`flex ${
                                m.role === "user" ? "justify-start" : "justify-end"
                              }`}
                            >
                              <div
                                className={`max-w-[85%] rounded-2xl px-4 py-3 text-xs leading-7 shadow-sm ${
                                  m.role === "user"
                                    ? "bg-slate-800 text-white rounded-tl-md"
                                    : "bg-white text-slate-700 border border-slate-100 rounded-tr-md"
                                }`}
                                dir={dir}
                              >
                                {m.role === "assistant" ? cleanAI(m.content) : m.content}
                              </div>
                            </div>
                          ))
                        )}
                        {cl && (
                          <div className="flex justify-end">
                            <div className="flex items-center gap-2 rounded-2xl rounded-tr-md bg-white border border-slate-100 px-4 py-3 shadow-sm">
                              <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400" />
                              <span
                                className="h-2 w-2 animate-bounce rounded-full bg-slate-400"
                                style={{ animationDelay: "150ms" }}
                              />
                              <span
                                className="h-2 w-2 animate-bounce rounded-full bg-slate-400"
                                style={{ animationDelay: "300ms" }}
                              />
                            </div>
                          </div>
                        )}
                        <div ref={endRef} />
                      </div>

                      {ce && (
                        <div className="mx-4 mb-2 flex items-center justify-between rounded-xl bg-red-50 px-4 py-2.5">
                          <p className="text-[11px] text-red-600">{ce}</p>
                          <button
                            onClick={() => setCe("")}
                            className="text-red-400 hover:text-red-600 transition-colors"
                          >
                            ✕
                          </button>
                        </div>
                      )}

                      <div id="chat-input" className="border-t border-slate-100 p-4">
                        <div className="flex gap-3">
                          <textarea
                            value={cq}
                            onChange={(e) => setCq(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                if (!cl) ask();
                              }
                            }}
                            disabled={cl}
                            placeholder={
                              isEn
                                ? "e.g., Explain the second rule..."
                                : "مثال: اشرح لي القاعدة الثانية..."
                            }
                            rows={2}
                            dir={dir}
                            className="flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-xs outline-none transition-all focus:border-slate-300 focus:bg-white focus:ring-2 focus:ring-slate-100 disabled:opacity-50"
                          />
                          <button
                            onClick={ask}
                            disabled={cl || !cq.trim()}
                            className="self-end rounded-xl bg-slate-900 px-6 py-3 text-xs font-bold text-white shadow-sm transition-all hover:bg-slate-800 hover:shadow-md disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
                          >
                            {cl ? (
                              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                            ) : isEn ? (
                              "Send"
                            ) : (
                              "إرسال"
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-24">
                    <p className="text-sm text-red-500">
                      {isEn ? "Failed to load document" : "فشل تحميل المستند"}
                    </p>
                    <button
                      onClick={() => pick(sel)}
                      className="mt-3 rounded-xl bg-slate-900 px-5 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-slate-800 transition-colors"
                    >
                      {isEn ? "Try Again" : "حاول مرة أخرى"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <style jsx global>{`
        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(16px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-slideUp {
          animation: slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .scrollbar-thin::-webkit-scrollbar {
          width: 4px;
        }
        .scrollbar-thin::-webkit-scrollbar-track {
          background: transparent;
        }
        .scrollbar-thin::-webkit-scrollbar-thumb {
          background: #e2e8f0;
          border-radius: 999px;
        }
        .scrollbar-none::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </div>
  );
}

/* =========================================================
   States
======================================================== */

function LoadingState({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-white to-slate-50">
      <div className="text-center">
        <span className="mx-auto mb-5 inline-block h-10 w-10 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-800" />
        <p className="text-sm font-medium text-slate-500">{message}</p>
      </div>
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
  isEn,
  dir,
}: {
  message: string;
  onRetry: () => void;
  isEn: boolean;
  dir: "rtl" | "ltr";
}) {
  return (
    <div
      className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-white to-slate-50 px-5"
      dir={dir}
    >
      <div className="text-center max-w-sm">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-red-50 text-3xl ring-1 ring-red-100">
          ⚠️
        </div>
        <p className="text-sm font-bold text-slate-800">
          {isEn ? "Failed to load topics" : "فشل تحميل الموضوعات"}
        </p>
        <p className="mt-2 text-sm text-red-500">{message}</p>
        <button
          onClick={onRetry}
          className="mt-5 rounded-xl bg-slate-900 px-6 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-slate-800 transition-colors"
        >
          {isEn ? "Try Again" : "حاول مرة أخرى"}
        </button>
      </div>
    </div>
  );
}

function EmptyState({ isEn, dir }: { isEn: boolean; dir: "rtl" | "ltr" }) {
  return (
    <div
      className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-white to-slate-50 px-5"
      dir={dir}
    >
      <div className="text-center max-w-sm">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-slate-100 text-3xl ring-1 ring-slate-200">
          📚
        </div>
        <p className="text-sm font-bold text-slate-800">
          {isEn ? "No Topics Available" : "لا توجد موضوعات بعد"}
        </p>
        <p className="mt-2 text-sm text-slate-400">
          {isEn
            ? "Upload and analyze documents first."
            : "ارفع وحلل المستندات أولاً."}
        </p>
        <Link
          href="/"
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-6 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-slate-800 transition-colors"
        >
          {isEn ? "Go to Upload" : "الذهاب للرفع"}
        </Link>
      </div>
    </div>
  );
}

/* =========================================================
   Topic List
======================================================== */

function TopicList({
  topics,
  selectedId,
  onSelect,
  dir,
  isEn,
}: {
  topics: Topic[];
  selectedId: string | null;
  onSelect: (t: Topic) => void;
  dir: "rtl" | "ltr";
  isEn: boolean;
}) {
  const grouped = topics.reduce<
    Record<string, { n: string; items: Topic[] }>
  >((a, tp) => {
    if (!a[tp.documentId])
      a[tp.documentId] = { n: tp.documentName, items: [] };
    a[tp.documentId].items.push(tp);
    return a;
  }, {});

  if (!topics.length)
    return (
      <p className="py-10 text-center text-xs text-slate-400">
        {isEn ? "No results" : "لا توجد نتائج"}
      </p>
    );

  return (
    <div className="space-y-5">
      {Object.entries(grouped).map(([id, gr]) => (
        <div key={id}>
          <p className="mb-2 truncate px-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            {gr.n}
          </p>
          <div className="space-y-1">
            {gr.items.map((tp) => (
              <button
                key={tp.id}
                onClick={() => onSelect(tp)}
                dir={dir}
                className={`w-full rounded-xl px-3.5 py-3 text-[11px] leading-5 transition-all duration-200 ${
                  tp.id === selectedId
                    ? "bg-slate-900 font-semibold text-white shadow-md shadow-slate-900/15"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-800"
                }`}
              >
                {tp.name}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* =========================================================
   Questions Quiz
======================================================== */

function QuestionsQuiz({
  questions,
  dir,
  isEn,
  selDoc,
  selName,
  lang,
}: {
  questions: string[];
  dir: "rtl" | "ltr";
  isEn: boolean;
  selDoc: Doc;
  selName: string;
  lang: "ar" | "en";
}) {
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [feedback, setFeedback] = useState<Record<number, string>>({});
  const [loadingIndex, setLoadingIndex] = useState<number | null>(null);

  const checkAnswer = async (question: string, index: number) => {
    const userAnswer = answers[index]?.trim();
    if (!userAnswer) return;
    setLoadingIndex(index);
    setFeedback((p) => ({ ...p, [index]: "" }));
    try {
      const prompt = isEn
        ? `You are an educational assistant grading a student about the topic "${selName}". Question: "${question}" Student answered: "${userAnswer}" Evaluate: 1) If correct: Confirm and add a detail. 2) If partially correct: Point out right/wrong parts. 3) If wrong: Explain the correct answer. No Markdown.`
        : `أنت مساعد تعليمي يقيّم طالب عن موضوع "${selName}". السؤال: "${question}" إجابة الطالب: "${userAnswer}" قيّم: ١) إذا صح: أكّد وأضف تفصيلة. ٢) إذا صح جزئياً: أشر للصحيح والخاطئ. ٣) إذا خطأ: اشرح الإجابة الصحيحة. بدون Markdown.`;

      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: prompt,
          documentText: selDoc.extracted_text || "",
          analysisText: buildAnalysisContext(selDoc.analysis),
          analysis: selDoc.analysis,
          lang,
        }),
      });
      const d = await r.json();
      if (r.ok)
        setFeedback((p) => ({ ...p, [index]: d.answer || "—" }));
      else
        setFeedback((p) => ({
          ...p,
          [index]: `❌ ${d.error || (isEn ? "Error" : "خطأ")}`,
        }));
    } catch {
      setFeedback((p) => ({
        ...p,
        [index]: isEn ? "❌ Connection error" : "❌ خطأ في الاتصال",
      }));
    } finally {
      setLoadingIndex(null);
    }
  };

  return (
    <div className="space-y-4">
      {questions.map((qu, i) => {
        const hasFeedback = !!feedback[i];
        const isLoading = loadingIndex === i;
        return (
          <div
            key={i}
            className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/50 to-white p-4 shadow-sm"
          >
            <div className="flex gap-3 mb-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-[10px] font-bold text-white shadow-sm">
                {i + 1}
              </span>
              <p className="text-xs leading-6 text-indigo-900 font-medium flex-1">
                {qu}
              </p>
            </div>
            {!hasFeedback ? (
              <div className="space-y-2.5">
                <textarea
                  value={answers[i] || ""}
                  onChange={(e) =>
                    setAnswers((p) => ({ ...p, [i]: e.target.value }))
                  }
                  disabled={isLoading}
                  placeholder={isEn ? "Write your answer..." : "اكتب إجابتك هنا..."}
                  rows={2}
                  dir={dir}
                  className="w-full resize-none rounded-xl border border-indigo-200/60 bg-white px-4 py-3 text-xs outline-none transition-all focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 disabled:opacity-50"
                />
                <button
                  onClick={() => checkAnswer(qu, i)}
                  disabled={isLoading || !answers[i]?.trim()}
                  className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-[11px] font-semibold text-white shadow-sm transition-all hover:bg-indigo-700 hover:shadow-md disabled:cursor-not-allowed disabled:bg-indigo-300 disabled:shadow-none flex items-center justify-center gap-2"
                >
                  {isLoading ? (
                    <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  ) : isEn ? (
                    "Check Answer"
                  ) : (
                    "تصحيح الإجابة"
                  )}
                </button>
              </div>
            ) : (
              <div className="space-y-2.5">
                <div className="rounded-xl bg-white border border-indigo-100 px-4 py-3.5">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                    {isEn ? "AI Feedback" : "تقييم الذكاء الاصطناعي"}
                  </p>
                  <div
                    className="whitespace-pre-line text-xs leading-7 text-slate-700"
                    dir={dir}
                  >
                    {cleanAI(feedback[i])}
                  </div>
                </div>
                <button
                  onClick={() => {
                    setFeedback((p) => ({ ...p, [i]: "" }));
                    setAnswers((p) => ({ ...p, [i]: "" }));
                  }}
                  className="text-[10px] font-semibold text-indigo-500 hover:text-indigo-700 transition-colors"
                >
                  {isEn ? "↻ Try Again" : "↻ حاول مرة أخرى"}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* =========================================================
   Analysis Panel
======================================================== */

function AnalysisPanel({
  doc,
  hl,
  dir,
  isEn,
  onTopicClick,
  lang,
}: {
  doc: Doc;
  hl: string;
  dir: "rtl" | "ltr";
  isEn: boolean;
  onTopicClick: (t: string) => void;
  lang: "ar" | "en";
}) {
  const a = doc.analysis;
  if (!a) return null;

  const sections: {
    key: string;
    title: string;
    badge?: number;
    children: React.ReactNode;
  }[] = [];

  sections.push({
    key: "info",
    title: isEn ? "File Info" : "معلومات الملف",
    children: (
      <div className="divide-y divide-slate-100">
        <InfoRow
          l={isEn ? "File" : "الملف"}
          v={doc.file_name}
        />
        <InfoRow
          l={isEn ? "Type" : "النوع"}
          v={
            doc.media_type === "media"
              ? isEn
                ? "Audio / Video"
                : "صوت / فيديو"
              : isEn
              ? "Document"
              : "مستند"
          }
        />
        <InfoRow
          l={isEn ? "Characters" : "الأحرف"}
          v={
            doc.extracted_text
              ? doc.extracted_text.length.toLocaleString()
              : "—"
          }
        />
      </div>
    ),
  });

  if (a.summary)
    sections.push({
      key: "summary",
      title: isEn ? "Summary" : "ملخص شامل",
      children: (
        <p className="whitespace-pre-line text-xs leading-7 text-slate-600">
          {a.summary}
        </p>
      ),
    });

  if (a.topics?.length)
    sections.push({
      key: "topics",
      title: isEn ? "Topics" : "الموضوعات",
      badge: a.topics.length,
      children: (
        <>
          <p className="text-[10px] text-slate-400 mb-3">
            {isEn
              ? "💡 Click to navigate"
              : "💡 اضغط للانتقال"}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {a.topics.map((tp, i) => {
              const cur = tp === hl;
              const nav = !cur;
              return (
                <button
                  key={i}
                  onClick={() => nav && onTopicClick(tp)}
                  disabled={!nav}
                  className={`flex items-start gap-2.5 rounded-xl px-3.5 py-3 transition-all duration-200 text-start ${
                    cur
                      ? "bg-blue-50 ring-1 ring-blue-200"
                      : nav
                      ? "bg-slate-50/50 hover:bg-blue-50/50 hover:ring-1 hover:ring-blue-100 cursor-pointer"
                      : "bg-slate-50/50"
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[9px] font-bold ${
                      cur
                        ? "bg-blue-600 text-white"
                        : "bg-slate-200 text-slate-500"
                    }`}
                  >
                    {i + 1}
                  </span>
                  <p
                    className={`text-xs leading-5 ${
                      cur
                        ? "font-semibold text-blue-800"
                        : "text-slate-600"
                    }`}
                  >
                    {tp}
                  </p>
                </button>
              );
            })}
          </div>
        </>
      ),
    });

  if (a.keywords?.length)
    sections.push({
      key: "kw",
      title: isEn ? "Keywords" : "الكلمات المهمة",
      badge: a.keywords.length,
      children: (
        <div className="flex flex-wrap gap-2">
          {a.keywords.map((k, i) => (
            <span
              key={i}
              className="rounded-lg bg-slate-100 px-3 py-1.5 text-[11px] font-medium text-slate-600"
            >
              {k}
            </span>
          ))}
        </div>
      ),
    });

  if (a.definitions?.length)
    sections.push({
      key: "def",
      title: isEn ? "Definitions" : "التعريفات",
      badge: a.definitions.length,
      children: (
        <div className="space-y-2">
          {a.definitions.map((d, i) => (
            <div
              key={i}
              className="rounded-xl border border-indigo-100 bg-indigo-50/50 px-4 py-3"
            >
              <p className="text-xs font-bold text-indigo-800">{d.term}</p>
              <p className="mt-1 text-xs leading-5 text-indigo-700">
                {d.definition}
              </p>
            </div>
          ))}
        </div>
      ),
    });

  if (a.rules?.length)
    sections.push({
      key: "rules",
      title: isEn ? "Rules" : "القواعد",
      badge: a.rules.length,
      children: (
        <div className="space-y-2">
          {a.rules.map((r, i) => (
            <div
              key={i}
              className="rounded-xl bg-slate-50/50 border border-slate-100 px-4 py-3"
            >
              <p className="text-xs font-bold text-slate-700">{r.title}</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                {r.description}
              </p>
            </div>
          ))}
        </div>
      ),
    });

  if (a.procedures?.length)
    sections.push({
      key: "proc",
      title: isEn ? "Procedures" : "الإجراءات",
      badge: a.procedures.length,
      children: (
        <div className="space-y-2">
          {a.procedures.map((p, i) => (
            <div
              key={i}
              className="rounded-xl bg-slate-50/50 border border-slate-100 px-4 py-3"
            >
              <p className="mb-2 text-xs font-bold text-slate-700">
                {p.title}
              </p>
              <ol className="space-y-2">
                {p.steps.map((s, si) => (
                  <li key={si} className="flex gap-2.5">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[9px] font-bold text-slate-600">
                      {si + 1}
                    </span>
                    <span className="text-xs text-slate-600 leading-5">{s}</span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      ),
    });

  if (a.calculations?.length)
    sections.push({
      key: "calc",
      title: isEn ? "Calculations" : "الحسابات",
      badge: a.calculations.length,
      children: (
        <div className="space-y-2">
          {a.calculations.map((c, i) => (
            <div
              key={i}
              className="rounded-xl bg-slate-50/50 border border-slate-100 px-4 py-3"
            >
              <p className="text-xs font-bold text-slate-700">{c.name}</p>
              <p className="mt-1 text-xs text-slate-500">
                {c.description}
              </p>
              {c.formula && (
                <code className="mt-2 block rounded-lg bg-slate-900 px-3.5 py-2.5 text-[11px] text-emerald-400 font-mono">
                  {c.formula}
                </code>
              )}
            </div>
          ))}
        </div>
      ),
    });

  if (a.questions?.length)
    sections.push({
      key: "quiz",
      title: isEn ? "Answer & Get Corrected" : "أجب وسيتم التصحيح",
      badge: a.questions.length,
      children: (
        <>
          <p className="text-[10px] text-slate-400 mb-3">
            {isEn
              ? "💡 Write your answer and the AI will correct it"
              : "💡 اكتب إجابتك والذكاء الاصطناعي سيصححها"}
          </p>
          <QuestionsQuiz
            key={lang}
            questions={a.questions}
            dir={dir}
            isEn={isEn}
            selDoc={doc}
            selName={hl}
            lang={lang}
          />
        </>
      ),
    });

  if (a.importantNotes?.length)
    sections.push({
      key: "notes",
      title: isEn ? "Important Notes" : "ملاحظات مهمة",
      badge: a.importantNotes.length,
      children: (
        <div className="space-y-2">
          {a.importantNotes.map((n, i) => (
            <div
              key={i}
              className="flex gap-3 rounded-xl bg-amber-50/50 border border-amber-100 px-4 py-3"
            >
              <span className="text-sm">⚠️</span>
              <p className="text-xs text-amber-800 leading-5">{n}</p>
            </div>
          ))}
        </div>
      ),
    });

  if (a.commonMistakes?.length)
    sections.push({
      key: "mistakes",
      title: isEn ? "Common Mistakes" : "أخطاء شائعة",
      badge: a.commonMistakes.length,
      children: (
        <div className="space-y-2">
          {a.commonMistakes.map((m, i) => (
            <div
              key={i}
              className="flex gap-3 rounded-xl bg-red-50/50 border border-red-100 px-4 py-3"
            >
              <span className="text-sm">✗</span>
              <p className="text-xs text-red-800 leading-5">{m}</p>
            </div>
          ))}
        </div>
      ),
    });

  if (a.learningObjectives?.length)
    sections.push({
      key: "obj",
      title: isEn ? "Learning Objectives" : "أهداف التعلم",
      badge: a.learningObjectives.length,
      children: (
        <div className="space-y-2">
          {a.learningObjectives.map((obj, i) => (
            <div
              key={i}
              className="flex gap-3 rounded-xl bg-emerald-50/50 border border-emerald-100 px-4 py-3"
            >
              <span className="text-sm">🎯</span>
              <p className="text-xs text-emerald-900 leading-5">{obj}</p>
            </div>
          ))}
        </div>
      ),
    });

  if (a.keyPoints?.length)
    sections.push({
      key: "kp",
      title: isEn ? "Key Points" : "أهم النقاط",
      badge: a.keyPoints.length,
      children: (
        <div className="space-y-2">
          {a.keyPoints.map((kp, i) => (
            <div
              key={i}
              className="flex gap-3 rounded-xl bg-slate-50/50 border border-slate-100 px-4 py-3"
            >
              <span className="text-slate-300 mt-0.5 text-xs">●</span>
              <p className="text-xs text-slate-700 leading-5">{kp}</p>
            </div>
          ))}
        </div>
      ),
    });

  if (a.examples?.length)
    sections.push({
      key: "ex",
      title: isEn ? "Examples" : "أمثلة",
      badge: a.examples.length,
      children: (
        <div className="space-y-2">
          {a.examples.map((ex, i) => (
            <div
              key={i}
              className="rounded-xl bg-cyan-50/50 border border-cyan-100 px-4 py-3"
            >
              <p className="text-xs text-cyan-900 leading-5">{ex}</p>
            </div>
          ))}
        </div>
      ),
    });

  return (
    <div className="space-y-4">
      {sections.map((s) => (
        <SectionCard key={s.key} title={s.title} badge={s.badge}>
          {s.children}
        </SectionCard>
      ))}
    </div>
  );
}

/* =========================================================
   UI Components
======================================================== */

function SectionCard({
  title,
  badge,
  children,
}: {
  title: string;
  badge?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white/60 shadow-sm overflow-hidden backdrop-blur-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3 bg-slate-50/30">
        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">
          {title}
        </span>
        {badge !== undefined && badge > 0 && (
          <span className="rounded-full bg-white px-2.5 py-0.5 text-[10px] font-bold text-slate-500 shadow-sm border border-slate-100">
            {badge}
          </span>
        )}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function InfoRow({ l, v }: { l: string; v: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-[10px] font-medium text-slate-400">{l}</span>
      <span className="text-xs font-semibold text-slate-700">{v || "—"}</span>
    </div>
  );
}