"use client";

import { useState, useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useLanguage } from "./context/LanguageContext";

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

interface UploadResult {
  success: boolean;
  fileName: string;
  mediaType?: string;
  textLength?: number;
  text?: string;
  analysis?: Analysis;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

type QuizQuestionType = "mcq" | "true_false" | "short_answer";

interface QuizQuestion {
  id: number;
  type: QuizQuestionType;
  question: string;
  options?: string[];
  correctIndex?: number;
  correctAnswer?: string | boolean;
  explanation: string;
}

/* =========================================================
   Home
========================================================= */

export default function Home() {
  const { lang, setLang, dir } = useLanguage();
  const isEn = lang === "en";

  /* State to toggle between Landing Page and App */
  const [started, setStarted] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error" | "info">("success");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [activeTool, setActiveTool] = useState<string | null>(null);

  /* Chat */
  const [question, setQuestion] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  /* Quiz */
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [generatingQuiz, setGeneratingQuiz] = useState(false);
  const [userAnswers, setUserAnswers] = useState<Record<number, string | number | boolean>>({});
  const [showResults, setShowResults] = useState(false);
  const [pastQuestionsText, setPastQuestionsText] = useState("");

  /* ★ الشرح التفصيلي */
  const [explanation, setExplanation] = useState("");
  const [explanationLoading, setExplanationLoading] = useState(false);

  const analysis = result?.analysis;

  /* =====================================================
     Duplicate Check + Upload
  ===================================================== */
  async function uploadFile() {
    if (!file) {
      setMessage(isEn ? "Please select a file first" : "اختر ملفًا أولاً");
      setMessageType("error");
      return;
    }

    setLoading(true);
    setMessage("");
    setMessageType("success");
    setResult(null);
    setChatMessages([]);
    setQuestion("");
    setActiveTool(null);
    setQuizQuestions([]);
    setUserAnswers({});
    setShowResults(false);
    setPastQuestionsText("");
    setExplanation("");

    try {
      const listRes = await fetch("/api/documents");

      if (listRes.ok) {
        const listData = await listRes.json();
        const docs: Array<{ id: string; file_name: string }> = listData.documents || [];
        const existing = docs.find(
          (d) => d.file_name.toLowerCase() === file.name.toLowerCase()
        );

        if (existing) {
          const docRes = await fetch(`/api/documents/${existing.id}`);
          const docData = await docRes.json();

          if (docRes.ok && docData.document) {
            const doc = docData.document;
            setResult({
              success: true,
              fileName: doc.file_name,
              mediaType: doc.media_type || undefined,
              textLength: 0,
              text: "",
              analysis: doc.analysis || undefined,
            });
            setMessage(
              isEn
                ? "This file already exists. Previous analysis loaded successfully."
                : "هذا الملف موجود بالفعل. تم تحميل التحليل السابق بنجاح."
            );
            setMessageType("info");
            return;
          }
        }
      }

      const fd = new FormData();
      fd.append("file", file);
      fd.append("lang", lang);

      const response = await fetch("/api/documents/upload", {
        method: "POST",
        body: fd,
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage(data.error || (isEn ? "An error occurred" : "حدث خطأ"));
        setMessageType("error");
        return;
      }

      setResult(data);
      setMessage(isEn ? "Processed successfully" : "تمت المعالجة بنجاح");
      setMessageType("success");
    } catch {
      setMessage(isEn ? "Connection error" : "خطأ في الاتصال");
      setMessageType("error");
    } finally {
      setLoading(false);
    }
  }

  /* =====================================================
     Detailed Explanation (AI-generated)
  ===================================================== */

  async function loadExplanation() {
    if (!result?.text || explanation) return;

    setExplanationLoading(true);
    try {
      const prompt = isEn
        ? `Provide a comprehensive, detailed explanation of this document. Structure it as follows:

1. **Introduction**: Brief overview of what the document covers.
2. **Detailed Breakdown by Topic**: For each main topic in the document:
   - Explain the core concepts clearly
   - Cover any rules, principles, or laws mentioned
   - Describe any procedures or step-by-step processes
   - Include and explain any examples found
   - Mention important notes or warnings
3. **Key Takeaways**: The most important points a student must remember.

Be thorough, clear, and educational. Write as if explaining to a student studying this for the first time. Use simple language but don't oversimplify. Do NOT use Markdown formatting.`
        : `قدّم شرحًا تفصيليًا شاملاً لهذا المستند. نظّم الشرح كالتالي:

١. **مقدمة**: نظرة عامة موجزة عن محتوى المستند.
٢. **الشرح المفصّل حسب الموضوعات**: لكل موضوع رئيسي في المستند:
   - اشرح المفاهيم الأساسية بوضوح
   - غطِّ أي قواعد أو مبادئ أو قوانين مذكورة
   - اشرح أي إجراءات أو خطوات متسلسلة
   - اذكر واشرح الأمثلة الموجودة
   - أشر إلى الملاحظات أو التحذيرات المهمة
٣. **أهم ما يجب تذكّره**: أهم النقاط التي يجب على الطالب حفظها وفهمها.

كن شاملاً وواضحًا وتعليميًا. اكتب وكأنك تشرح لطالب يدرس هذا الموضوع لأول مرة. استخدم لغة بسيطة لكن دون تبسيط مُخلّ. لا تستخدم تنسيق Markdown.`;

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: prompt,
          documentText: result.text,
          analysis: result.analysis,
          lang,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setExplanation(data.answer || "");
      } else {
        setMessage(data.error || (isEn ? "Failed to generate explanation" : "فشل توليد الشرح"));
        setMessageType("error");
      }
    } catch {
      setMessage(isEn ? "Connection error" : "خطأ في الاتصال");
      setMessageType("error");
    } finally {
      setExplanationLoading(false);
    }
  }

  /* =====================================================
     Chat
  ===================================================== */

  async function askQuestion() {
    const q = question.trim();
    if (!q || !result?.text) return;

    setChatMessages((p) => [...p, { role: "user", content: q }]);
    setQuestion("");
    setChatLoading(true);
    setMessage("");

    try {
      const prefix = isEn
        ? `Regarding the document "${result.fileName}": ${q}`
        : `بخصوص المستند "${result.fileName}": ${q}`;

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: prefix,
          documentText: result.text,
          analysis: result.analysis,
          lang,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage(data.error || (isEn ? "An error occurred" : "خطأ"));
        setMessageType("error");
        return;
      }

      setChatMessages((p) => [...p, { role: "assistant", content: data.answer || "—" }]);
    } catch {
      setMessage(isEn ? "Connection error" : "خطأ");
      setMessageType("error");
    } finally {
      setChatLoading(false);
    }
  }

  /* =====================================================
     Quiz
  ===================================================== */

  async function generateQuiz() {
    if (!analysis || !result?.text) return;

    setGeneratingQuiz(true);
    setActiveTool("quiz");
    setMessage("");
    setMessageType("success");
    setShowResults(false);
    setUserAnswers({});

    try {
      const avoidancePrompt = pastQuestionsText
        ? isEn
          ? `\n\nIMPORTANT: The student has already answered these questions:\n${pastQuestionsText}\nYou MUST generate completely NEW and DIFFERENT questions. Do not rephrase old questions.`
          : `\n\nملاحظة هامة: الطالب حل بالفعل هذه الأسئلة:\n${pastQuestionsText}\nيجب أن تولد أسئلة جديدة ومختلفة تمامًا. لا تعيد صياغة الأسئلة السابقة.`
        : "";

      const quizPrompt = isEn
        ? `Create a diverse quiz of 5 questions based on the document.

Must include:
- 2 Multiple Choice (MCQ) questions, each with 4 options.
- 2 True/False questions.
- 1 Short Answer / Essay question.

Generate questions, options, explanations, and correct answers in English.

Return ONLY valid JSON without Markdown or extra text:

[
  { "type": "mcq", "question": "...", "options": ["...", "...", "...", "..."], "correctIndex": 0, "explanation": "..." },
  { "type": "true_false", "question": "...", "correctAnswer": true, "explanation": "..." },
  { "type": "short_answer", "question": "...", "correctAnswer": "...", "explanation": "..." }
]
 ${avoidancePrompt}`
        : `أنشئ اختبارًا متنوعًا من 5 أسئلة بناءً على المستند.

يجب أن يحتوي على:
- سؤالين اختيار من متعدد MCQ، ولكل سؤال 4 اختيارات.
- سؤالين صح أو خطأ.
- سؤال واحد إجابة قصيرة / مقالي.

اكتب الأسئلة والخيارات والتوضيحات والإجابات الصحيحة باللغة العربية.

أجب بصيغة JSON فقط بدون Markdown وبدون أي نص إضافي:

[
  { "type": "mcq", "question": "...", "options": ["...", "...", "...", "..."], "correctIndex": 0, "explanation": "..." },
  { "type": "true_false", "question": "...", "correctAnswer": true, "explanation": "..." },
  { "type": "short_answer", "question": "...", "correctAnswer": "...", "explanation": "..." }
]
 ${avoidancePrompt}`;

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: quizPrompt,
          documentText: result.text,
          analysis,
          lang,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage(data.error || (isEn ? "Failed to generate questions" : "فشل توليد الأسئلة"));
        setMessageType("error");
        setActiveTool(null);
        return;
      }

      const answer = String(data.answer || "");
      const cleaned = answer.replace(/```json/gi, "").replace(/```/g, "").trim();
      const jsonMatch = cleaned.match(/\[[\s\S]*\]/);

      if (!jsonMatch) {
        setMessage(isEn ? "Failed to generate questions. Try again." : "فشل توليد الأسئلة، حاول مرة أخرى.");
        setMessageType("error");
        setActiveTool(null);
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        setMessage(isEn ? "Invalid quiz response. Try again." : "استجابة الاختبار غير صالحة، حاول مرة أخرى.");
        setMessageType("error");
        setActiveTool(null);
        return;
      }

      if (!Array.isArray(parsed)) {
        setMessage(isEn ? "Invalid quiz format." : "صيغة الاختبار غير صحيحة.");
        setMessageType("error");
        setActiveTool(null);
        return;
      }

      const newQuestions: QuizQuestion[] = parsed
        .slice(0, 5)
        .map((item: unknown, index: number) => {
          const q = item as Partial<QuizQuestion>;
          let type: QuizQuestionType = "short_answer";
          if (q.type === "mcq" || q.type === "true_false" || q.type === "short_answer") type = q.type;
          return {
            id: index + 1,
            type,
            question: String(q.question || ""),
            options: Array.isArray(q.options) ? q.options.map(String) : undefined,
            correctIndex: typeof q.correctIndex === "number" ? q.correctIndex : undefined,
            correctAnswer: typeof q.correctAnswer === "boolean" || typeof q.correctAnswer === "string" ? q.correctAnswer : undefined,
            explanation: String(q.explanation || ""),
          };
        })
        .filter((q) => q.question.trim().length > 0);

      if (newQuestions.length === 0) {
        setMessage(isEn ? "No valid questions were generated." : "لم يتم إنشاء أسئلة صحيحة.");
        setMessageType("error");
        setActiveTool(null);
        return;
      }

      setQuizQuestions(newQuestions);
      setPastQuestionsText((p) => (p ? `${p}\n${newQuestions.map((q) => q.question).join("\n")}` : newQuestions.map((q) => q.question).join("\n")));
    } catch {
      setMessage(isEn ? "An error occurred while generating the quiz." : "حدث خطأ أثناء توليد الاختبار.");
      setMessageType("error");
      setActiveTool(null);
    } finally {
      setGeneratingQuiz(false);
    }
  }

  const calculateScore = () => {
    if (quizQuestions.length === 0) return 0;
    let correct = 0;
    quizQuestions.forEach((q) => {
      const ua = userAnswers[q.id];
      if (ua === undefined || ua === "") return;
      if (q.type === "mcq" && typeof q.correctIndex === "number" && ua === q.correctIndex) correct++;
      else if (q.type === "true_false" && ua === q.correctAnswer) correct++;
      else if (q.type === "short_answer" && String(ua).trim().toLowerCase() === String(q.correctAnswer ?? "").trim().toLowerCase()) correct++;
    });
    return Math.round((correct / quizQuestions.length) * 100);
  };

  /* =====================================================
     Auto-load explanation when tool activated
  ===================================================== */

  useEffect(() => {
    if (activeTool === "explain" && result?.text && !explanation && !explanationLoading) {
      loadExplanation();
    }
  }, [activeTool]); // eslint-disable-line react-hooks/exhaustive-deps

  /* =====================================================
     Render
  ===================================================== */

    // ====================================================================
  // ★ الصفحة الترحيبية الجديدة (Landing Page)
  // ====================================================================
  if (!started) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-slate-50 to-white px-5 text-center" dir={dir}>
        {/* زر تغيير اللغة */}
        <div className="absolute top-5 left-5 right-5 flex justify-between">
           <div />
           <button
             onClick={() => setLang(lang === "ar" ? "en" : "ar")}
             className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
           >
             <span>🌐</span>
             {isEn ? "العربية" : "English"}
           </button>
        </div>

        {/* اللوجو أو الأيقونة (تم استبدال الإيموجي بالصورة) */}
        <div className="mb-6 flex h-28 w-28 items-center justify-center rounded-full bg-white shadow-xl ring-1 ring-slate-100 animate-fadeIn overflow-hidden">
          <img 
            src="/icon.png" 
            alt="Nexora Learning" 
            className="h-full w-full object-cover"
          />
        </div>

        {/* العنوان الرئيسي (الاسم بالإنجليزي دايماً) */}
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl animate-fadeIn">
          {isEn ? "Welcome to Nexora Learning" : "اهلا بك في برنامج Nexora Learning"}
        </h1>

        {/* العنوان الفرعي */}
        <p className="mt-3 text-xl font-semibold text-indigo-600 sm:text-2xl animate-fadeIn">
          {isEn ? "Learning with us has become easy" : "التعلم معنا اصبح سهلا"}
        </p>

        {/* الوصف */}
        <p className="mx-auto mt-5 max-w-md text-sm leading-7 text-slate-500 sm:text-base animate-fadeIn">
          {isEn 
            ? "Simplifying the learning process. It explains and interprets any document, video, PDF, or PowerPoint effortlessly."
            : "برنامجك الذكي لتبسيط عملية التعلم. يشرح ويفسر أي مستند، فيديو، PDF أو بوربوينت بكل سهولة ويسر."
          }
        </p>

        {/* زر يلا بينا نبدأ */}
        <button
          onClick={() => setStarted(true)}
          className="mt-10 inline-flex items-center gap-2 rounded-xl bg-slate-800 px-8 py-4 text-base font-bold text-white shadow-lg transition-all duration-300 hover:bg-slate-700 hover:shadow-xl hover:scale-105 active:scale-100 sm:text-lg animate-fadeIn"
        >
          <span>🚀</span>
          {isEn ? "Let's Start" : "يلا بينا نبدأ"}
        </button>
        
        <p className="mt-6 text-xs text-slate-400 animate-fadeIn">
          {isEn ? "Start by uploading your file to explore its content" : "ابدأ برفع ملفك لاستكشاف محتواه بسهولة"}
        </p>

        <style jsx global>{`
          @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
          .animate-fadeIn { animation: fadeIn 0.5s ease-out forwards; }
        `}</style>
      </div>
    );
  }
  // ====================================================================
  // ★ الصفحة الرئيسية للتطبيق (بعد الضغط على زر البدء)
  // ====================================================================
  return (
    <div className="mx-auto max-w-3xl px-5 py-8 pt-20 lg:px-8 lg:pt-8" dir={dir}>
      {/* ========================= Upload ========================= */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="px-5 py-4">
          <h2 className="font-semibold text-slate-800">
            {isEn ? "Upload & Analyze File" : "رفع وتحليل ملف"}
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            {isEn ? "Upload a document, video, or audio to analyze it" : "ارفع مستند أو فيديو أو ملف صوت لتحليله"}
          </p>
        </div>

        <div className="border-t border-slate-100 px-5 py-5">
          <label
            htmlFor="f"
            className="flex cursor-pointer flex-col items-center rounded-lg border border-dashed border-slate-200 bg-slate-50/50 p-8 transition hover:border-slate-300 hover:bg-slate-50"
          >
            <input
              id="f"
              type="file"
              accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.mp4,.webm,.mov,.avi,.wmv,.mkv,.mp3,.wav,.m4a,.ogg,.flac,.aac,.wma"
              onChange={(e) => {
                setFile(e.target.files?.[0] || null);
                setMessage("");
                setResult(null);
                setActiveTool(null);
                setExplanation("");
              }}
              className="hidden"
            />
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white text-xl shadow-sm ring-1 ring-slate-100">
              📄
            </div>
            <p className="mt-3 text-sm font-medium text-slate-600">
              {isEn ? "Click to select a file" : "اضغط لاختيار ملف"}
            </p>
            <p className="mt-1 text-xs text-slate-400">PDF · Word · PPTX · TXT · {isEn ? "Video" : "فيديو"} · {isEn ? "Audio" : "صوت"}</p>
          </label>

          {file && (
            <div className="mt-4 flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/50 px-4 py-2.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="text-sm">📎</span>
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-slate-700">{file.name}</p>
                  <p className="text-[11px] text-slate-400">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
              </div>
              <button
                onClick={() => { setFile(null); setResult(null); setActiveTool(null); setExplanation(""); }}
                disabled={loading}
                className="text-xs text-slate-400 hover:text-slate-600 disabled:opacity-50"
              >
                {isEn ? "Remove" : "إزالة"}
              </button>
            </div>
          )}

          <div className="mt-4">
            <button
              onClick={uploadFile}
              disabled={!file || loading}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {loading ? (
                <>
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  {isEn ? "Analyzing..." : "جاري التحليل..."}
                </>
              ) : (
                isEn ? "Upload & Analyze" : "رفع وتحليل"
              )}
            </button>
          </div>

          {message && (
            <p
              className={`mt-3 text-xs font-medium ${
                messageType === "success"
                  ? "text-emerald-600"
                  : messageType === "info"
                    ? "text-blue-600"
                    : "text-red-500"
              }`}
            >
              {messageType === "info" && "ℹ️ "}
              {message}
            </p>
          )}
        </div>
      </div>

      {/* ========================= Results ========================= */}
      {result && (
        <div className="mt-5 space-y-5">
          {/* Tools */}
          <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-800">
                {isEn ? "What do you want to do?" : "ماذا تريد أن تفعل بهذا المحتوى؟"}
              </h3>
              <button
                onClick={() => { setLang(lang === "ar" ? "en" : "ar"); setExplanation(""); }}
                className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
              >
                <span>🌐</span>
                {isEn ? "العربية" : "English"}
              </button>
            </div>

            <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
              <ToolButton icon="📝" label={isEn ? "Summary" : "ملخص"} onClick={() => setActiveTool(activeTool === "summary" ? null : "summary")} active={activeTool === "summary"} />
              <ToolButton icon="📖" label={isEn ? "Explanation" : "شرح تفصيلي"} onClick={() => setActiveTool(activeTool === "explain" ? null : "explain")} active={activeTool === "explain"} loading={explanationLoading} />
              <ToolButton icon="🎯" label={isEn ? "Key Points" : "أهم النقاط"} onClick={() => setActiveTool(activeTool === "points" ? null : "points")} active={activeTool === "points"} />
              <ToolButton icon="❓" label={isEn ? "Q&A" : "سؤال وجواب"} onClick={() => setActiveTool(activeTool === "chat" ? null : "chat")} active={activeTool === "chat"} />
              <ToolButton icon="🧪" label={isEn ? "Quiz" : "اختبار"} onClick={generateQuiz} active={activeTool === "quiz"} loading={generatingQuiz} />
              <ToolButton icon="📊" label={isEn ? "Full Analysis" : "تحليل كامل"} onClick={() => setActiveTool(activeTool === "full" ? null : "full")} active={activeTool === "full"} />
            </div>
          </div>

          {/* ========================= Summary ========================= */}
          {activeTool === "summary" && analysis && (
            <div className="animate-fadeIn space-y-4">
              <Section title={isEn ? "Document Summary" : "ملخص شامل"}>
                <p className="whitespace-pre-line text-xs leading-7 text-slate-600">{analysis.summary || "—"}</p>
              </Section>
              {analysis.keyPoints && analysis.keyPoints.length > 0 && (
                <Section title={isEn ? "Key Points" : "النقاط الرئيسية"} badge={analysis.keyPoints.length}>
                  <div className="space-y-2">
                    {analysis.keyPoints.map((point, i) => (
                      <div key={i} className="flex gap-2 rounded-lg bg-blue-50 px-3.5 py-2.5">
                        <span className="mt-0.5 text-blue-500">•</span>
                        <p className="text-xs text-blue-900">{point}</p>
                      </div>
                    ))}
                  </div>
                </Section>
              )}
            </div>
          )}

          {/* ========================= Detailed Explanation ========================= */}
          {activeTool === "explain" && (
            <div className="animate-fadeIn space-y-4">
              <Section title={isEn ? "Detailed Explanation" : "شرح تفصيلي شامل"}>
                {explanationLoading ? (
                  <div className="flex flex-col items-center gap-3 py-12">
                    <div className="h-7 w-7 animate-spin rounded-full border-3 border-slate-200 border-t-slate-800" />
                    <p className="text-xs text-slate-400">{isEn ? "Generating detailed explanation..." : "جاري إنشاء شرح تفصيلي..."}</p>
                  </div>
                ) : explanation ? (
                  <div className="whitespace-pre-line text-xs leading-7 text-slate-600">{explanation}</div>
                ) : (
                  <div className="flex flex-col items-center gap-3 py-12">
                    <p className="text-xs text-slate-400">{isEn ? "Failed to generate explanation." : "فشل توليد الشرح."}</p>
                    <button onClick={loadExplanation} className="text-xs font-semibold text-slate-800 underline">
                      {isEn ? "Try again" : "حاول مرة أخرى"}
                    </button>
                  </div>
                )}
              </Section>
            </div>
          )}

          {/* ========================= Key Points ========================= */}
          {activeTool === "points" && analysis && (
            <div className="animate-fadeIn space-y-4">
              {analysis.learningObjectives && analysis.learningObjectives.length > 0 && (
                <Section title={isEn ? "Learning Objectives" : "أهداف التعلم"} badge={analysis.learningObjectives.length}>
                  <div className="space-y-2">
                    {analysis.learningObjectives.map((obj, i) => (
                      <div key={i} className="flex gap-2 rounded-lg bg-emerald-50 px-3.5 py-2.5">
                        <span className="mt-0.5 text-emerald-500">🎯</span>
                        <p className="text-xs text-emerald-900">{obj}</p>
                      </div>
                    ))}
                  </div>
                </Section>
              )}
              {analysis.commonMistakes && analysis.commonMistakes.length > 0 && (
                <Section title={isEn ? "Common Mistakes" : "أخطاء شائعة يجب تجنبها"} badge={analysis.commonMistakes.length}>
                  <div className="space-y-2">
                    {analysis.commonMistakes.map((m, i) => (
                      <div key={i} className="flex gap-2 rounded-lg bg-red-50 px-3.5 py-2.5">
                        <span className="mt-0.5 text-red-400">⚠️</span>
                        <p className="text-xs text-red-800">{m}</p>
                      </div>
                    ))}
                  </div>
                </Section>
              )}
              {analysis.importantNotes && analysis.importantNotes.length > 0 && (
                <Section title={isEn ? "Important Notes" : "ملاحظات مهمة"} badge={analysis.importantNotes.length}>
                  <div className="space-y-2">
                    {analysis.importantNotes.map((n, i) => (
                      <div key={i} className="flex gap-2 rounded-lg bg-amber-50 px-3.5 py-2.5">
                        <span className="mt-0.5 text-amber-500">📌</span>
                        <p className="text-xs text-amber-800">{n}</p>
                      </div>
                    ))}
                  </div>
                </Section>
              )}
            </div>
          )}

          {/* ========================= Chat ========================= */}
          {activeTool === "chat" && (
            <div className="animate-fadeIn rounded-xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-5 py-3">
                <span className="text-xs font-semibold text-slate-700">{isEn ? "Ask about the document" : "اسأل عن المستند"}</span>
              </div>
              <div className="h-75 space-y-2.5 overflow-y-auto p-4">
                {chatMessages.length === 0 ? (
                  <p className="flex h-full items-center justify-center text-xs text-slate-400">
                    {isEn ? "Ask your question..." : "اكتب سؤالك عن المحتوى"}
                  </p>
                ) : (
                  chatMessages.map((m, i) => (
                    <div key={i} className={`flex ${m.role === "user" ? "justify-start" : "justify-end"}`}>
                      <div className={`max-w-[85%] rounded-lg px-3.5 py-2.5 text-xs leading-6 ${m.role === "user" ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-700"}`} dir={dir}>
                        {m.content}
                      </div>
                    </div>
                  ))
                )}
                {chatLoading && (
                  <div className="flex justify-end">
                    <div className="flex items-center gap-1 rounded-lg bg-slate-100 px-3.5 py-2.5">
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: "150ms" }} />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: "300ms" }} />
                    </div>
                  </div>
                )}
              </div>
              <div className="border-t border-slate-100 p-3">
                <div className="flex gap-2">
                  <textarea
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!chatLoading) askQuestion(); } }}
                    disabled={chatLoading}
                    placeholder={isEn ? "e.g., Explain the second rule..." : "مثال: اشرح لي القاعدة الثانية..."}
                    rows={2}
                    dir={dir}
                    className="flex-1 resize-none rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs outline-none transition focus:border-slate-300 focus:bg-white disabled:opacity-50"
                  />
                  <button
                    onClick={askQuestion}
                    disabled={chatLoading || !question.trim()}
                    className="rounded-lg bg-slate-800 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {isEn ? "Send" : "إرسال"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ========================= Quiz ========================= */}
          {activeTool === "quiz" && (
            <div className="animate-fadeIn overflow-hidden rounded-xl border border-slate-200 bg-white">
              {generatingQuiz ? (
                <div className="flex flex-col items-center justify-center gap-3 py-16">
                  <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-800" />
                  <p className="text-sm font-medium text-slate-600">{isEn ? "Generating diverse questions..." : "الذكاء الاصطناعي يصيغ أسئلة متنوعة..."}</p>
                  <p className="text-xs text-slate-400">{isEn ? "MCQ · True/False · Short Answer" : "اختيار متعدد · صح وخطأ · مقالي"}</p>
                </div>
              ) : quizQuestions.length > 0 && !showResults ? (
                <QuizInterface questions={quizQuestions} userAnswers={userAnswers} setUserAnswers={setUserAnswers} isEn={isEn} dir={dir} onComplete={() => setShowResults(true)} />
              ) : quizQuestions.length > 0 && showResults ? (
                <QuizResults questions={quizQuestions} userAnswers={userAnswers} score={calculateScore()} isEn={isEn} dir={dir} onRetry={() => { setUserAnswers({}); setShowResults(false); generateQuiz(); }} onGoBack={() => setActiveTool("explain")} />
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <p className="mb-3 text-4xl">🤖</p>
                  <p className="text-sm text-slate-500">{isEn ? "No questions generated yet." : "لم يتم توليد أي أسئلة بعد."}</p>
                  <button onClick={generateQuiz} className="mt-4 text-xs font-semibold text-slate-800 underline">{isEn ? "Try again" : "حاول مرة أخرى"}</button>
                </div>
              )}
            </div>
          )}

          {/* ========================= Full Analysis ========================= */}
          {activeTool === "full" && analysis && (
            <div className="animate-fadeIn space-y-4">
              <Section title={isEn ? "Topics" : "الموضوعات"} badge={analysis.topics.length}>
                <div className="grid gap-2 sm:grid-cols-2">
                  {analysis.topics.map((topic, i) => (
                    <div key={i} className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2.5">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-slate-200 text-[10px] font-bold text-slate-600">{i + 1}</span>
                      <p className="text-xs leading-5 text-slate-700">{topic}</p>
                    </div>
                  ))}
                </div>
              </Section>

              <Section title={isEn ? "Keywords" : "الكلمات المهمة"} badge={analysis.keywords.length}>
                <div className="flex flex-wrap gap-1.5">
                  {analysis.keywords.map((kw, i) => (
                    <span key={i} className="rounded-md bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">{kw}</span>
                  ))}
                </div>
              </Section>

              {analysis.definitions && analysis.definitions.length > 0 && (
                <Section title={isEn ? "Definitions" : "التعريفات"} badge={analysis.definitions.length}>
                  <div className="space-y-2">
                    {analysis.definitions.map((d, i) => (
                      <div key={i} className="rounded-lg border border-indigo-100 bg-indigo-50 px-3.5 py-2.5">
                        <p className="text-xs font-bold text-indigo-800">{d.term}</p>
                        <p className="mt-1 text-xs leading-5 text-indigo-700">{d.definition}</p>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {analysis.rules.length > 0 && (
                <Section title={isEn ? "Rules" : "القواعد"} badge={analysis.rules.length}>
                  <div className="space-y-2">
                    {analysis.rules.map((r, i) => (
                      <div key={i} className="rounded-lg bg-slate-50 px-3.5 py-2.5">
                        <p className="text-xs font-semibold text-slate-700">{r.title}</p>
                        <p className="mt-0.5 text-xs leading-5 text-slate-500">{r.description}</p>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {analysis.procedures.length > 0 && (
                <Section title={isEn ? "Procedures" : "الإجراءات"} badge={analysis.procedures.length}>
                  <div className="space-y-2">
                    {analysis.procedures.map((p, i) => (
                      <div key={i} className="rounded-lg bg-slate-50 px-3.5 py-2.5">
                        <p className="mb-1.5 text-xs font-semibold text-slate-700">{p.title}</p>
                        <ol className="space-y-1.5">
                          {p.steps.map((s, si) => (
                            <li key={si} className="flex gap-2">
                              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[9px] font-bold text-slate-600">{si + 1}</span>
                              <span className="text-xs text-slate-600">{s}</span>
                            </li>
                          ))}
                        </ol>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {analysis.calculations.length > 0 && (
                <Section title={isEn ? "Calculations" : "الحسابات"} badge={analysis.calculations.length}>
                  <div className="space-y-2">
                    {analysis.calculations.map((c, i) => (
                      <div key={i} className="rounded-lg bg-slate-50 px-3.5 py-2.5">
                        <p className="text-xs font-semibold text-slate-700">{c.name}</p>
                        <p className="mt-0.5 text-xs text-slate-500">{c.description}</p>
                        {c.formula && <code className="mt-2 block rounded-md bg-slate-800 px-2.5 py-1.5 text-[11px] text-emerald-400">{c.formula}</code>}
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {analysis.questions && analysis.questions.length > 0 && (
                <Section title={isEn ? "Questions" : "أسئلة"} badge={analysis.questions.length}>
                  <div className="space-y-2">
                    {analysis.questions.map((qu, i) => (
                      <div key={i} className="flex gap-2 rounded-lg bg-indigo-50 px-3.5 py-2.5">
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-[9px] font-bold text-white">{i + 1}</span>
                        <p className="text-xs text-indigo-900">{qu}</p>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              <Section title={isEn ? "Raw Extracted Text" : "النص المستخرج"}>
                <pre className="max-h-75 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-[11px] leading-6 text-slate-500" dir={dir}>
                  {result.text?.substring(0, 2000) || "—"}
                </pre>
              </Section>
            </div>
          )}

          {/* ========================= File Info ========================= */}
          {!activeTool && (
            <div className="rounded-xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-5 py-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700">{isEn ? "File Info" : "معلومات الملف"}</span>
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600">{isEn ? "Analyzed" : "تم التحليل"}</span>
                </div>
              </div>
              <div className="divide-y divide-slate-100">
                <InfoRow label={isEn ? "File" : "الملف"} value={result.fileName} dir={dir} />
                <InfoRow label={isEn ? "Characters" : "الأحرف"} value={typeof result.textLength === "number" ? result.textLength.toLocaleString() : "—"} dir={dir} />
                <InfoRow 
                  label={isEn ? "Type" : "النوع"} 
                  value={ 
                    result.mediaType === "media" 
                      ? (isEn ? "Audio / Video" : "صوت / فيديو") 
                      : (isEn ? "Document" : "مستند")
                  } 
                  dir={dir} 
                />
                <InfoRow label={isEn ? "Topics" : "الموضوعات"} value={`${analysis?.topics?.length || 0} ${isEn ? "topics" : "موضوع"}`} dir={dir} />
              </div>
            </div>
          )}
        </div>
      )}

      <style jsx global>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fadeIn { animation: fadeIn 0.3s ease-out forwards; }
      `}</style>
    </div>
  );
}

/* =========================================================
   Tool Button
========================================================= */

function ToolButton({ icon, label, onClick, active, loading }: { icon: string; label: string; onClick: () => void; active?: boolean; loading?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 p-4 transition-all duration-200 ${
        active ? "border-slate-800 bg-slate-50 shadow-sm" : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
      } ${loading ? "cursor-wait opacity-50" : ""}`}
    >
      <span className="text-2xl">
        {loading ? <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-slate-800" /> : icon}
      </span>
      <span className={`text-[11px] font-semibold ${active ? "text-slate-800" : "text-slate-500"}`}>{label}</span>
    </button>
  );
}

/* =========================================================
   Section
========================================================= */
function Section({ title, badge, children }: { title: string; badge?: number; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
        <span className="text-xs font-semibold text-slate-700">{title}</span>
        {typeof badge === "number" && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">{badge}</span>
        )}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

/* =========================================================
   Info Row
========================================================= */
function InfoRow({ label, value, dir }: { label: string; value: string | number; dir: "rtl" | "ltr" }) {
  return (
    <div className="flex items-center justify-between px-5 py-3" dir={dir}>
      <span className="text-xs text-slate-500">{label}</span>
      <span className="max-w-[60%] truncate text-xs font-medium text-slate-800">{value}</span>
    </div>
  );
}

/* =========================================================
   Quiz Interface
========================================================= */

function QuizInterface({
  questions, userAnswers, setUserAnswers, isEn, dir, onComplete,
}: {
  questions: QuizQuestion[];
  userAnswers: Record<number, string | number | boolean>;
  setUserAnswers: Dispatch<SetStateAction<Record<number, string | number | boolean>>>;
  isEn: boolean;
  dir: "rtl" | "ltr";
  onComplete: () => void;
}) {
  const [currentQ, setCurrentQ] = useState(0);
  const q = questions[currentQ];
  if (!q) return null;

  const isAnswered = userAnswers[q.id] !== undefined && userAnswers[q.id] !== "";

  const handleNext = () => {
    if (currentQ < questions.length - 1) setCurrentQ((p) => p + 1);
    else onComplete();
  };

  return (
    <div>
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-700">{isEn ? "Quiz" : "الاختبار"}</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
            {q.type === "mcq" ? (isEn ? "MCQ" : "اختيار متعدد") : q.type === "true_false" ? (isEn ? "True/False" : "صح أو خطأ") : (isEn ? "Short Answer" : "مقالي")}
          </span>
        </div>
        <span className="text-[11px] text-slate-400">{currentQ + 1}/{questions.length}</span>
      </div>

      <div className="p-5">
        <div className="mb-6 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div className="h-full bg-slate-800 transition-all duration-300" style={{ width: `${((currentQ + 1) / questions.length) * 100}%` }} />
        </div>

        <h3 className="mb-6 text-sm font-bold text-slate-800" dir={dir}>{q.question}</h3>

        <div className="space-y-3">
          {q.type === "mcq" && q.options?.map((option, index) => {
            const selected = userAnswers[q.id] === index;
            const correct = index === q.correctIndex;
            return (
              <button
                key={index}
                onClick={() => { if (!isAnswered) { setUserAnswers((p) => ({ ...p, [q.id]: index })); setTimeout(handleNext, 400); } }}
                disabled={isAnswered}
                className={`flex w-full items-center gap-3 rounded-lg border-2 px-4 py-3 text-xs font-medium transition-all duration-200 ${
                  selected ? (correct ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-red-500 bg-red-50 text-red-800") : "border-slate-200 text-slate-700 hover:border-slate-300"
                } ${isAnswered ? "cursor-default" : "cursor-pointer"}`}
                dir={dir}
              >
                <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold ${
                  selected ? (correct ? "border-emerald-500 bg-emerald-100 text-emerald-600" : "border-red-500 bg-red-100 text-red-600") : "border-slate-300 text-slate-500"
                }`}>
                  {String.fromCharCode(65 + index)}
                </span>
                {option}
              </button>
            );
          })}

          {q.type === "true_false" && (
            <div className="grid grid-cols-2 gap-3">
              {
              [
                { value: true, label: isEn ? "True" : "صح" },
                { value: false, label: isEn ? "False" : "خطأ" },
              ].map((btn) => {
                const selected = userAnswers[q.id] === btn.value;
                const correct = btn.value === q.correctAnswer;
                return (
                  <button
                    key={String(btn.value)}
                    onClick={() => { if (!isAnswered) { setUserAnswers((p) => ({ ...p, [q.id]: btn.value })); setTimeout(handleNext, 400); } }}
                    disabled={isAnswered}
                    className={`flex items-center justify-center gap-2 rounded-lg border-2 py-4 text-sm font-bold transition-all ${
                      selected ? (correct ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-red-500 bg-red-50 text-red-700") : "border-slate-200 text-slate-600 hover:border-slate-300"
                    } ${isAnswered ? "cursor-default" : "cursor-pointer"}`}
                  >
                    {btn.value ? "✅" : "❌"} {btn.label}
                  </button>
                );
              })}
            </div>
          )}

          {q.type === "short_answer" && (
            <div className="space-y-3">
              <textarea
                value={String(userAnswers[q.id] || "")}
                onChange={(e) => setUserAnswers((p) => ({ ...p, [q.id]: e.target.value }))}
                disabled={isAnswered}
                placeholder={isEn ? "Type your answer..." : "اكتب إجابتك..."}
                rows={3}
                dir={dir}
                className="w-full resize-none rounded-lg border-2 border-slate-200 bg-white px-4 py-3 text-xs outline-none transition focus:border-slate-400 disabled:opacity-70"
              />
              {!isAnswered && (
                <button
                  onClick={() => { if (String(userAnswers[q.id] || "").trim()) handleNext(); }}
                  disabled={!String(userAnswers[q.id] || "").trim()}
                  className="w-full rounded-lg bg-slate-800 py-2.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {isEn ? "Submit Answer" : "تقديم الإجابة"}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   Quiz Results
========================================================= */

function QuizResults({
  questions, userAnswers, score, isEn, dir, onRetry, onGoBack,
}: {
  questions: QuizQuestion[];
  userAnswers: Record<number, string | number | boolean>;
  score: number;
  isEn: boolean;
  dir: "rtl" | "ltr";
  onRetry: () => void;
  onGoBack: () => void;
}) {
  const scoreColor = score >= 80 ? "text-emerald-600" : score >= 50 ? "text-amber-600" : "text-red-600";
  const scoreBg = score >= 80 ? "bg-emerald-50" : score >= 50 ? "bg-amber-50" : "bg-red-50";
  const scoreMsg = score >= 80 ? (isEn ? "Excellent!" : "ممتاز!") : score >= 50 ? (isEn ? "Good effort!" : "جيد!") : (isEn ? "Keep studying!" : "واصل الدراسة!");

  return (
    <div>
      <div className={`flex flex-col items-center gap-2 border-b border-slate-100 px-5 py-8 ${scoreBg}`}>
        <span className="text-5xl font-black text-slate-300">{score}%</span>
        <span className={`text-sm font-bold ${scoreColor}`}>{scoreMsg}</span>
        <span className="text-[11px] text-slate-400">
          {isEn ? `${questions.filter((q) => {
            const ua = userAnswers[q.id];
            if (ua === undefined || ua === "") return false;
            if (q.type === "mcq" && typeof q.correctIndex === "number") return ua === q.correctIndex;
            if (q.type === "true_false") return ua === q.correctAnswer;
            if (q.type === "short_answer") return String(ua).trim().toLowerCase() === String(q.correctAnswer ?? "").trim().toLowerCase();
            return false;
          }).length} of ${questions.length} correct` : `${questions.filter((q) => {
            const ua = userAnswers[q.id];
            if (ua === undefined || ua === "") return false;
            if (q.type === "mcq" && typeof q.correctIndex === "number") return ua === q.correctIndex;
            if (q.type === "true_false") return ua === q.correctAnswer;
            if (q.type === "short_answer") return String(ua).trim().toLowerCase() === String(q.correctAnswer ?? "").trim().toLowerCase();
            return false;
          }).length} من ${questions.length} صحيح`}
        </span>
      </div>

      <div className="max-h-96 space-y-3 overflow-y-auto p-5">
        {questions.map((q) => {
          const ua = userAnswers[q.id];
          let isCorrect = false;

          if (q.type === "mcq" && typeof q.correctIndex === "number") isCorrect = ua === q.correctIndex;
          else if (q.type === "true_false") isCorrect = ua === q.correctAnswer;
          else if (q.type === "short_answer") isCorrect = String(ua || "").trim().toLowerCase() === String(q.correctAnswer ?? "").trim().toLowerCase();

          let userAnswerText = "—";
          if (q.type === "mcq" && typeof ua === "number" && q.options) userAnswerText = q.options[ua] || "—";
          else if (q.type === "true_false") userAnswerText = ua === true ? (isEn ? "True" : "صح") : ua === false ? (isEn ? "False" : "خطأ") : "—";
          else if (q.type === "short_answer") userAnswerText = String(ua || "—");

          let correctAnswerText = "";
          if (q.type === "mcq" && typeof q.correctIndex === "number" && q.options) correctAnswerText = q.options[q.correctIndex];
          else if (q.type === "true_false") correctAnswerText = q.correctAnswer === true ? (isEn ? "True" : "صح") : (isEn ? "False" : "خطأ");
          else if (q.type === "short_answer") correctAnswerText = String(q.correctAnswer ?? "");

          return (
            <div key={q.id} className={`rounded-lg border px-4 py-3 ${isCorrect ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}>
              <p className="text-xs font-bold text-slate-800" dir={dir}>{q.question}</p>
              <div className="mt-2 space-y-1 text-[11px]" dir={dir}>
                <p className={isCorrect ? "text-emerald-700" : "text-red-700"}>
                  {isEn ? "Your answer" : "إجابتك"}: {userAnswerText}
                </p>
                {!isCorrect && (
                  <p className="text-emerald-700">
                    {isEn ? "Correct answer" : "الإجابة الصحيحة"}: {correctAnswerText}
                  </p>
                )}
                <p className="mt-1 text-slate-500 italic">
                  {q.explanation}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex gap-3 border-t border-slate-100 p-4">
        <button
          onClick={onRetry}
          className="flex-1 rounded-lg bg-slate-800 py-2.5 text-xs font-semibold text-white hover:bg-slate-700"
        >
          {isEn ? "Try New Questions" : "أسئلة جديدة"}
        </button>
        <button
          onClick={onGoBack}
          className="flex-1 rounded-lg border border-slate-200 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          {isEn ? "Read Explanation" : "اقرأ الشرح"}
        </button>
      </div>
    </div>
  );
}