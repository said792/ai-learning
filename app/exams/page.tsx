"use client";

import { useState, useEffect, useRef } from "react";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";

interface DocTopic {
  id: string;
  name: string;
  docId: string;
  docName: string;
  analysis: any;
}

interface QuizQ {
  id: number;
  type: "mcq" | "true_false" | "short_answer";
  question: string;
  options?: string[];
  correctIndex?: number;
  correctAnswer?: string | boolean;
  explanation: string;
}

interface Category {
  id: string;
  name: string;
  documentCount: number;
}

export default function ExamsPage() {
  const { user, loading: authLoading } = useAuth();
  const { lang, setLang, dir } = useLanguage();
  const isEn = lang === "en";

  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [allTopics, setAllTopics] = useState<DocTopic[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [step, setStep] = useState<"select" | "gen" | "exam" | "results">(
    "select"
  );
  const [questions, setQuestions] = useState<QuizQ[]>([]);
  const [answers, setAnswers] = useState<
    Record<number, string | number | boolean>
  >({});
  const [currentQ, setCurrentQ] = useState(0);
  const [err, setErr] = useState("");
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [catOpen, setCatOpen] = useState(false);
  const catRef = useRef<HTMLDivElement>(null);

  /* إغلاق الـ dropdown لما المستخدم يضغط بره */
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (catRef.current && !catRef.current.contains(e.target as Node)) {
        setCatOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  /* تحميل الكتالوجات */
  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    const loadCategories = async () => {
      try {
        const res = await fetch("/api/categories");
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setCategories(data.categories || []);
        }
      } catch {
        // silent fail
      }
    };

    loadCategories();
    return () => {
      cancelled = true;
    };
  }, [user]);

  /* تحميل المستندات والمواضيع */
  useEffect(() => {
    if (!user) {
      setLoadingDocs(false);
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        setLoadingDocs(true);

        const url =
          selectedCategory === "all"
            ? "/api/documents"
            : `/api/documents?categoryId=${selectedCategory}`;

        const res = await fetch(url);

        if (!res.ok || res.status === 401) {
          if (!cancelled) setAllTopics([]);
          return;
        }

        const data = await res.json();
        const docs = data.documents || [];

        const ts: DocTopic[] = [];
        docs.forEach((doc: any) => {
          doc.analysis?.topics?.forEach((name: string, i: number) => {
            ts.push({
              id: `${doc.id}-${i}`,
              name,
              docId: doc.id,
              docName: doc.file_name,
              analysis: doc.analysis,
            });
          });
        });

        if (!cancelled) setAllTopics(ts);
      } catch (e) {
        console.error("Failed to load topics:", e);
      } finally {
        if (!cancelled) setLoadingDocs(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [user, selectedCategory]);

  /* إعادة التعيين لما الكتالوج يتغير */
  useEffect(() => {
    setSelected(new Set());
    setStep("select");
    setQuestions([]);
    setAnswers({});
    setCurrentQ(0);
  }, [selectedCategory]);

  const toggleTopic = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const selectAll = () => setSelected(new Set(allTopics.map((t) => t.id)));
  const deselectAll = () => setSelected(new Set());

  const generateExam = async () => {
    if (selected.size === 0) return;
    setStep("gen");
    setErr("");

    const selectedTopics = allTopics.filter((t) => selected.has(t.id));
    const topicsText = selectedTopics.map((t) => `- ${t.name}`).join("\n");

    const analysisContext = selectedTopics
      .map((t) => {
        const a = t.analysis;
        let ctx = `\n--- ${t.docName} ---\n`;
        if (a?.summary) ctx += `الملخص: ${a.summary}\n`;
        if (a?.rules?.length)
          ctx += `القواعد:\n${a.rules.map((r: any) => `- ${r.title}: ${r.description}`).join("\n")}\n`;
        if (a?.definitions?.length)
          ctx += `التعريفات:\n${a.definitions.map((d: any) => `- ${d.term}: ${d.definition}`).join("\n")}\n`;
        if (a?.keyPoints?.length)
          ctx += `النقاط المهمة:\n${a.keyPoints.join("\n")}\n`;
        if (a?.importantNotes?.length)
          ctx += `ملاحظات مهمة:\n${a.importantNotes.join("\n")}\n`;
        if (a?.commonMistakes?.length)
          ctx += `أخطاء شائعة:\n${a.commonMistakes.join("\n")}\n`;
        return ctx;
      })
      .join("\n\n");

    const prompt = isEn
      ? `Generate a diverse exam of 10 questions based on these specific topics:\n${topicsText}\n\nHere is the detailed context from the documents:\n${analysisContext}\n\nInclude: 4 MCQ (4 options each), 4 True/False, 2 Short Answer.\nReturn ONLY valid JSON array. No markdown.\n[{"type":"mcq","question":"...","options":["A","B","C","D"],"correctIndex":0,"explanation":"..."},{"type":"true_false","question":"...","correctAnswer":true,"explanation":"..."},{"type":"short_answer","question":"...","correctAnswer":"...","explanation":"..."}]`
      : `أنشئ اختباراً متنوعاً من 10 أسئلة بناءً على هذه المواضيع المحددة:\n${topicsText}\n\nإليك التفاصيل المستخلصة من المستندات:\n${analysisContext}\n\nيشمل: 4 اختيار متعدد (4 اختيارات لكل سؤال)، 4 صح أو خطأ، سؤالين إجابة قصيرة.\nأجب بصيغة JSON فقط بدون Markdown.\n[{"type":"mcq","question":"...","options":["أ","ب","ج","د"],"correctIndex":0,"explanation":"..."},{"type":"true_false","question":"...","correctAnswer":true,"explanation":"..."},{"type":"short_answer","question":"...","correctAnswer":"...","explanation":"..."}]`;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: prompt,
          documentText: analysisContext,
          lang,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const clean = String(data.answer || "")
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();
      const match = clean.match(/\[[\s\S]*\]/);
      if (!match) throw new Error("Invalid response");

      const parsed = JSON.parse(match[0]);
      const qs: QuizQ[] = parsed
        .slice(0, 10)
        .map((q: any, i: number) => ({
          id: i + 1,
          type: ["mcq", "true_false", "short_answer"].includes(q.type)
            ? q.type
            : "short_answer",
          question: String(q.question || ""),
          options: Array.isArray(q.options)
            ? q.options.map(String)
            : undefined,
          correctIndex:
            typeof q.correctIndex === "number" ? q.correctIndex : undefined,
          correctAnswer: q.correctAnswer,
          explanation: String(q.explanation || ""),
        }))
        .filter((q: { question: any }) => q.question);

      if (qs.length === 0) throw new Error("No questions generated");
      setQuestions(qs);
      setStep("exam");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
      setStep("select");
    }
  };

  const getScore = () => {
    let c = 0;
    questions.forEach((q) => {
      const a = answers[q.id];
      if (a === undefined || a === "") return;
      if (q.type === "mcq" && a === q.correctIndex) c++;
      else if (q.type === "true_false" && a === q.correctAnswer) c++;
      else if (
        q.type === "short_answer" &&
        String(a)
          .trim()
          .toLowerCase() ===
          String(q.correctAnswer ?? "")
            .trim()
            .toLowerCase()
      )
        c++;
    });
    return Math.round((c / questions.length) * 100);
  };

  /* اسم الكتالوج المحدد */
  const selectedCategoryName =
    selectedCategory === "all"
      ? isEn
        ? "All Documents"
        : "كل المستندات"
      : categories.find((c) => c.id === selectedCategory)?.name || "";

  /* ==================== Loading ==================== */
  if (authLoading || loadingDocs) {
    return (
      <div className="flex h-screen items-center justify-center" dir={dir}>
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-800" />
          <p className="text-sm text-slate-500">
            {isEn ? "Loading your topics..." : "جاري تحميل مواضيعك..."}
          </p>
        </div>
      </div>
    );
  }

  /* ==================== Not Logged In ==================== */
  if (!user) {
    return (
      <div
        className="flex h-screen items-center justify-center px-5"
        dir={dir}
      >
        <div className="text-center max-w-md">
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-slate-100 text-4xl">
            🔒
          </div>
          <h2 className="text-lg font-bold text-slate-800">
            {isEn ? "Login Required" : "يجب تسجيل الدخول"}
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            {isEn
              ? "Login to access your custom exams."
              : "سجل دخول للوصول لاختباراتك المخصصة."}
          </p>
        </div>
      </div>
    );
  }

  /* ==================== No Topics ==================== */
  if (allTopics.length === 0) {
    return (
      <div
        className="flex h-screen items-center justify-center px-5"
        dir={dir}
      >
        <div className="text-center max-w-md">
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-slate-100 text-4xl">
            📝
          </div>
          <h2 className="text-lg font-bold text-slate-800">
            {selectedCategory === "all"
              ? isEn
                ? "No Topics Available"
                : "لا توجد مواضيع"
              : isEn
                ? "No topics in this category"
                : "لا توجد مواضيع في هذا التصنيف"}
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            {selectedCategory === "all"
              ? isEn
                ? "Upload documents first to generate exams."
                : "ارفع مستندات أولاً لإنشاء اختبارات."
              : isEn
                ? "Upload documents to this category or select a different one."
                : "ارفع مستندات لهذا التصنيف أو اختر تصنيف آخر."}
          </p>
          {selectedCategory !== "all" && (
            <button
              onClick={() => setSelectedCategory("all")}
              className="mt-4 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-700 transition"
            >
              {isEn ? "View All Documents" : "عرض كل المستندات"}
            </button>
          )}
        </div>
      </div>
    );
  }

  /* ==================== Step 1: Topic Selection ==================== */
  if (step === "select" || step === "gen") {
    const grouped = allTopics.reduce<Record<string, DocTopic[]>>(
      (a, t) => {
        (a[t.docName] = a[t.docName] || []).push(t);
        return a;
      },
      {}
    );

    return (
      <div
        className="mx-auto max-w-3xl px-5 py-8 pt-20 lg:px-8 lg:pt-8"
        dir={dir}
      >
        {/* Header */}
        <div className="mb-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-800 text-lg text-white shadow-sm">
              🧪
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-slate-800 truncate">
                {isEn ? "Custom Exam" : "اختبار مخصص"}
              </h1>
              <p className="text-[11px] text-slate-400 truncate">
                {isEn ? "From" : "من"}{" "}
                <span className="font-medium text-slate-500">
                  {selectedCategoryName}
                </span>{" "}
                —{" "}
                {isEn
                  ? "Select topics to generate your exam"
                  : "اختر المواضيع لتوليد الاختبار"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Category Dropdown */}
            <div className="relative" ref={catRef}>
              <button
                onClick={() => setCatOpen(!catOpen)}
                className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-50 transition"
              >
                <span>📁</span>
                <span className="max-w-[100px] truncate">
                  {selectedCategoryName}
                </span>
                <svg
                  className={`h-3 w-3 text-slate-400 transition-transform ${catOpen ? "rotate-180" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>

              {catOpen && (
                <div
                  className={`absolute mt-1.5 min-w-[200px] rounded-xl border border-slate-200 bg-white py-1.5 shadow-lg z-50 ${isEn ? "right-0" : "left-0"}`}
                >
                  <button
                    onClick={() => {
                      setSelectedCategory("all");
                      setCatOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-xs transition ${
                      selectedCategory === "all"
                        ? "bg-slate-800 text-white"
                        : "text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <span>📚</span>
                    <span className="flex-1 text-left">
                      {isEn ? "All Documents" : "كل المستندات"}
                    </span>
                  </button>

                  {categories.length > 0 && (
                    <div className="my-1.5 border-t border-slate-100" />
                  )}

                  {categories.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => {
                        setSelectedCategory(c.id);
                        setCatOpen(false);
                      }}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-xs transition ${
                        selectedCategory === c.id
                          ? "bg-slate-800 text-white"
                          : "text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      <span>📂</span>
                      <span className="flex-1 text-left truncate">
                        {c.name}
                      </span>
                      <span
                        className={`text-[10px] ${
                          selectedCategory === c.id
                            ? "text-slate-300"
                            : "text-slate-400"
                        }`}
                      >
                        {c.documentCount}
                      </span>
                    </button>
                  ))}

                  {categories.length === 0 && (
                    <p className="px-3 py-2 text-[11px] text-slate-400">
                      {isEn
                        ? "No categories yet"
                        : "لا توجد تصنيفات بعد"}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Language Toggle */}
            <button
              onClick={() => setLang(lang === "ar" ? "en" : "ar")}
              className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-50 transition"
            >
              <span>🌐</span> {isEn ? "العربية" : "English"}
            </button>
          </div>
        </div>

        {/* Select All / Deselect All */}
        <div className="mb-4 flex gap-2">
          <button
            onClick={selectAll}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            {isEn ? "Select All" : "تحديد الكل"}
          </button>
          <button
            onClick={deselectAll}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            {isEn ? "Deselect All" : "إلغاء الكل"}
          </button>
          <span className="flex items-center rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-600">
            {selected.size} / {allTopics.length}
          </span>
        </div>

        {err && (
          <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-xs text-red-600">
            {err}
          </p>
        )}

        {/* Topics Grouped by Document */}
        <div className="space-y-4">
          {Object.entries(grouped).map(([doc, topics]) => (
            <div
              key={doc}
              className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
            >
              <div className="border-b border-slate-100 bg-slate-50/50 px-4 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  {doc}
                </p>
              </div>
              <div className="grid gap-2 p-3 sm:grid-cols-2">
                {topics.map((tp) => (
                  <button
                    key={tp.id}
                    onClick={() => toggleTopic(tp.id)}
                    className={`flex items-center gap-2.5 rounded-lg border-2 px-3 py-2.5 text-xs font-medium transition-all ${
                      selected.has(tp.id)
                        ? "border-blue-500 bg-blue-50 text-blue-800"
                        : "border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 text-[10px] font-bold ${
                        selected.has(tp.id)
                          ? "border-blue-500 bg-blue-600 text-white"
                          : "border-slate-300 text-slate-400"
                      }`}
                    >
                      {selected.has(tp.id) ? "✓" : ""}
                    </span>
                    {tp.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Generate Button */}
        <div className="mt-6 sticky bottom-8 flex justify-center">
          <button
            onClick={generateExam}
            disabled={selected.size === 0 || step === "gen"}
            className="rounded-xl bg-slate-800 px-8 py-3 text-sm font-bold text-white shadow-lg transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {step === "gen" ? (
              <>
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />{" "}
                {isEn ? "Generating..." : "جاري التوليد..."}
              </>
            ) : (
              `${isEn ? "Generate Exam" : "توليد الاختبار"} (${Math.min(selected.size * 2, 10)} ${isEn ? "Questions" : "سؤال"})`
            )}
          </button>
        </div>
      </div>
    );
  }

  /* ==================== Step 2: Exam Interface ==================== */
  const q = questions[currentQ];
  const isAnswered = answers[q.id] !== undefined && answers[q.id] !== "";

  if (step === "exam") {
    return (
      <div
        className="mx-auto max-w-3xl px-5 py-8 pt-20 lg:px-8 lg:pt-8"
        dir={dir}
      >
        {/* Header with category info */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-slate-800">
              🧪 {selectedCategoryName}
            </span>
          </div>
          <button
            onClick={() => {
              setStep("select");
              setAnswers({});
              setCurrentQ(0);
            }}
            className="text-xs text-slate-500 hover:text-slate-700 transition"
          >
            {isEn ? "← Back to topics" : "← رجوع للمواضيع"}
          </button>
        </div>

        {/* Progress Bar */}
        <div className="mb-6 h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full bg-slate-800 transition-all duration-500"
            style={{
              width: `${((currentQ + 1) / questions.length) * 100}%`,
            }}
          />
        </div>

        <div className="mb-4 flex items-center justify-between">
          <span className="text-xs font-bold text-slate-400">
            {isEn ? "Question" : "سؤال"} {currentQ + 1}/{questions.length}
          </span>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-500">
            {q.type === "mcq"
              ? isEn
                ? "MCQ"
                : "اختيار متعدد"
              : q.type === "true_false"
                ? isEn
                  ? "True / False"
                  : "صح / خطأ"
                : isEn
                  ? "Short Answer"
                  : "مقالي"}
          </span>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-6 text-base font-bold text-slate-800">
            {q.question}
          </h2>

          <div className="space-y-3">
            {q.type === "mcq" &&
              q.options?.map((opt, i) => {
                const sel = answers[q.id] === i;
                const correct = i === q.correctIndex;
                return (
                  <button
                    key={i}
                    onClick={() => {
                      if (!isAnswered) {
                        setAnswers((p) => ({ ...p, [q.id]: i }));
                        setTimeout(
                          () =>
                            currentQ < questions.length - 1
                              ? setCurrentQ((p) => p + 1)
                              : setStep("results"),
                          400
                        );
                      }
                    }}
                    disabled={isAnswered}
                    className={`flex w-full items-center gap-3 rounded-xl border-2 px-5 py-4 text-sm font-medium transition-all ${
                      sel
                        ? correct
                          ? "border-emerald-500 bg-emerald-50 text-emerald-800"
                          : "border-red-500 bg-red-50 text-red-800"
                        : "border-slate-200 text-slate-700 hover:border-slate-300"
                    }`}
                  >
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 text-xs font-bold ${
                        sel
                          ? correct
                            ? "border-emerald-500 bg-emerald-100 text-emerald-600"
                            : "border-red-500 bg-red-100 text-red-600"
                          : "border-slate-300 text-slate-500"
                      }`}
                    >
                      {String.fromCharCode(65 + i)}
                    </span>
                    {opt}
                  </button>
                );
              })}

            {q.type === "true_false" && (
              <div className="grid grid-cols-2 gap-4">
                {[
                  { v: true, l: isEn ? "True" : "صح", i: "✅" },
                  { v: false, l: isEn ? "False" : "خطأ", i: "❌" },
                ].map((btn) => {
                  const sel = answers[q.id] === btn.v;
                  const correct = btn.v === q.correctAnswer;
                  return (
                    <button
                      key={String(btn.v)}
                      onClick={() => {
                        if (!isAnswered) {
                          setAnswers((p) => ({ ...p, [q.id]: btn.v }));
                          setTimeout(
                            () =>
                              currentQ < questions.length - 1
                                ? setCurrentQ((p) => p + 1)
                                : setStep("results"),
                            400
                          );
                        }
                      }}
                      disabled={isAnswered}
                      className={`flex items-center justify-center gap-2 rounded-xl border-2 py-5 text-lg font-bold transition-all ${
                        sel
                          ? correct
                            ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                            : "border-red-500 bg-red-50 text-red-700"
                          : "border-slate-200 text-slate-600 hover:border-slate-300"
                      }`}
                    >
                      {btn.i} {btn.l}
                    </button>
                  );
                })}
              </div>
            )}

            {q.type === "short_answer" && (
              <>
                <textarea
                  value={String(answers[q.id] || "")}
                  onChange={(e) =>
                    setAnswers((p) => ({ ...p, [q.id]: e.target.value }))
                  }
                  disabled={isAnswered}
                  placeholder={isEn ? "Your answer..." : "إجابتك..."}
                  rows={3}
                  dir={dir}
                  className="w-full resize-none rounded-xl border-2 border-slate-200 px-4 py-3 text-sm outline-none focus:border-slate-400 disabled:opacity-70"
                />
                {!isAnswered && (
                  <button
                    onClick={() => {
                      if (String(answers[q.id] || "").trim()) {
                        currentQ < questions.length - 1
                          ? setCurrentQ((p) => p + 1)
                          : setStep("results");
                      }
                    }}
                    disabled={!String(answers[q.id] || "").trim()}
                    className="w-full rounded-xl bg-slate-800 py-3 text-sm font-bold text-white hover:bg-slate-700 disabled:bg-slate-300"
                  >
                    {isEn ? "Submit & Next" : "تقديم والتالي"}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ==================== Step 3: Results ==================== */
  const score = getScore();
  const color = score >= 80 ? "emerald" : score >= 50 ? "amber" : "red";

  return (
    <div
      className="mx-auto max-w-3xl px-5 py-8 pt-20 lg:px-8 lg:pt-8"
      dir={dir}
    >
      <div
        className={`mb-8 flex flex-col items-center gap-3 rounded-2xl border bg-${color}-50 border-${color}-100 px-6 py-10`}
      >
        <span className={`text-6xl font-black text-${color}-600`}>
          {score}%
        </span>
        <span className={`text-lg font-bold text-${color}-700`}>
          {score >= 80
            ? isEn
              ? "Excellent!"
              : "ممتاز!"
            : score >= 50
              ? isEn
                ? "Good Job!"
                : "جيد جداً!"
              : isEn
                ? "Keep Studying!"
                : "واصل الدراسة!"}
        </span>
        <span className="text-xs text-slate-400">
          {selectedCategoryName}
        </span>
      </div>

      <div className="mb-8 space-y-3">
        {questions.map((qu) => {
          const ua = answers[qu.id];
          let correct = false;
          if (qu.type === "mcq" && ua === qu.correctIndex) correct = true;
          else if (qu.type === "true_false" && ua === qu.correctAnswer)
            correct = true;
          else if (
            qu.type === "short_answer" &&
            String(ua || "")
              .trim()
              .toLowerCase() ===
              String(qu.correctAnswer ?? "")
                .trim()
                .toLowerCase()
          )
            correct = true;

          return (
            <div
              key={qu.id}
              className={`rounded-xl border p-4 ${correct ? "border-emerald-200 bg-emerald-50/50" : "border-red-200 bg-red-50/50"}`}
            >
              <div className="flex items-start gap-2">
                <span className="mt-0.5 text-lg">
                  {correct ? "✅" : "❌"}
                </span>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-slate-800">
                    {qu.question}
                  </p>
                  {!correct && qu.type === "mcq" && (
                    <p className="mt-1 text-xs text-emerald-600">
                      {isEn ? "Correct:" : "الصحيح:"}{" "}
                      {qu.options?.[qu.correctIndex || 0]}
                    </p>
                  )}
                  {!correct && qu.type === "true_false" && (
                    <p className="mt-1 text-xs text-emerald-600">
                      {isEn ? "Correct:" : "الصحيح:"}{" "}
                      {qu.correctAnswer === true
                        ? isEn
                          ? "True"
                          : "صح"
                        : isEn
                          ? "False"
                          : "خطأ"}
                    </p>
                  )}
                  {!correct && qu.type === "short_answer" && (
                    <p className="mt-1 text-xs text-emerald-600">
                      {isEn ? "Correct:" : "الصحيح:"} {qu.correctAnswer}
                    </p>
                  )}
                  <p className="mt-2 text-xs text-slate-500">
                    {qu.explanation}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex gap-3">
        <button
          onClick={() => {
            setAnswers({});
            setCurrentQ(0);
            setStep("select");
          }}
          className="flex-1 rounded-xl bg-slate-800 py-3 text-sm font-bold text-white hover:bg-slate-700"
        >
          {isEn ? "New Exam" : "اختبار جديد"}
        </button>
        <button
          onClick={() => {
            setAnswers({});
            setCurrentQ(0);
            generateExam();
          }}
          className="flex-1 rounded-xl border border-slate-200 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50"
        >
          {isEn ? "Retry Same Topics" : "إعادة نفس المواضيع"}
        </button>
      </div>
    </div>
  );
}