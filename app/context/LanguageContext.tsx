// app/context/LanguageContext.tsx
"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";

type Lang = "ar" | "en";

interface Trans {
  /* Navigation */
  upload: string;
  analyze: string;
  topics: string;
  settings: string;
  /* Upload Page */
  dropFiles: string;
  browse: string;
  orText: string;
  pasteHere: string;
  startAnalysis: string;
  analyzing: string;
  noFile: string;
  /* Analysis Page */
  summary: string;
  topicsLabel: string;
  keywords: string;
  rules: string;
  procedures: string;
  notes: string;
  calculations: string;
  questions: string;
  info: string;
  fileName: string;
  fileType: string;
  subject: string;
  commonMistakes: string;
  learningObjectives: string;
  keyPoints: string;
  examples: string;
  definitions: string;
  /* Topics Page */
  topicCount: string;
  docCount: string;
  search: string;
  loading: string;
  retry: string;
  noTopics: string;
  selectTopic: string;
  selectedTopic: string;
  from: string;
  askAbout: string;
  startQuestion: string;
  yourQuestion: string;
  send: string;
  loadFailed: string;
  noResults: string;
  explain: string;
  keyPointsOf: string;
  rulesOf: string;
  err: string;
  /* Settings */
  language: string;
  arabic: string;
  english: string;
}

const ar: Trans = {
  upload: "رفع ملف",
  analyze: "تحليل",
  topics: "المواضيع",
  settings: "الإعدادات",
  dropFiles: "اسحب الملفات هنا أو",
  browse: "تصفّح",
  orText: "أو أدخل النص مباشرة",
  pasteHere: "الصق النص هنا...",
  startAnalysis: "بدء التحليل",
  analyzing: "جاري التحليل...",
  noFile: "يرجى رفع ملف أو إدخال نص",
  summary: "ملخص",
  topicsLabel: "الموضوعات",
  keywords: "كلمات مهمة",
  rules: "قواعد",
  procedures: "إجراءات",
  notes: "ملاحظات",
  calculations: "حسابات",
  questions: "أسئلة",
  info: "معلومات",
  fileName: "الملف",
  fileType: "النوع",
  subject: "الموضوع",
  commonMistakes: "أخطاء شائعة",
  learningObjectives: "أهداف تعليمية",
  keyPoints: "نقاط رئيسية",
  examples: "أمثلة",
  definitions: "تعريفات",
  topicCount: "موضوع",
  docCount: "مستند",
  search: "بحث...",
  loading: "جاري التحميل...",
  retry: "إعادة",
  noTopics: "لا توجد موضوعات — ارفع مستندات من الصفحة الرئيسية",
  selectTopic: "اختر موضوعًا من القائمة",
  selectedTopic: "الموضوع المحدد",
  from: "من:",
  askAbout: "اسأل عن الموضوع",
  startQuestion: "ابدأ بسؤال",
  yourQuestion: "سؤالك...",
  send: "إرسال",
  loadFailed: "فشل تحميل المستند",
  noResults: "لا نتائج",
  explain: "اشرح",
  keyPointsOf: "نقاط",
  rulesOf: "قواعد",
  err: "خطأ",
  language: "اللغة",
  arabic: "العربية",
  english: "English",
};

const en: Trans = {
  upload: "Upload",
  analyze: "Analyze",
  topics: "Topics",
  settings: "Settings",
  dropFiles: "Drop files here or",
  browse: "Browse",
  orText: "Or enter text directly",
  pasteHere: "Paste text here...",
  startAnalysis: "Start Analysis",
  analyzing: "Analyzing...",
  noFile: "Please upload a file or enter text",
  summary: "Summary",
  topicsLabel: "Topics",
  keywords: "Keywords",
  rules: "Rules",
  procedures: "Procedures",
  notes: "Important Notes",
  calculations: "Calculations",
  questions: "Questions",
  info: "Information",
  fileName: "File",
  fileType: "Type",
  subject: "Subject",
  commonMistakes: "Common Mistakes",
  learningObjectives: "Learning Objectives",
  keyPoints: "Key Points",
  examples: "Examples",
  definitions: "Definitions",
  topicCount: "topic(s)",
  docCount: "document(s)",
  search: "Search...",
  loading: "Loading...",
  retry: "Retry",
  noTopics: "No topics — upload documents from the home page",
  selectTopic: "Select a topic from the list",
  selectedTopic: "Selected Topic",
  from: "From:",
  askAbout: "Ask about the topic",
  startQuestion: "Start with a question",
  yourQuestion: "Your question...",
  send: "Send",
  loadFailed: "Failed to load document",
  noResults: "No results",
  explain: "Explain",
  keyPointsOf: "Key points",
  rulesOf: "Rules",
  err: "Error",
  language: "Language",
  arabic: "العربية",
  english: "English",
};

interface Ctx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: Trans;
  dir: "rtl" | "ltr";
}

const C = createContext<Ctx>({
  lang: "ar",
  setLang: () => {},
  t: ar,
  dir: "rtl",
});

export const useLanguage = () => useContext(C);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>("ar");

  useEffect(() => {
    const saved = localStorage.getItem("app-lang");
    if (saved === "en" || saved === "ar") {
      setLang(saved);
    }
  }, []);

  const change = (l: Lang) => {
    setLang(l);
    localStorage.setItem("app-lang", l);
  };

  return (
    <C.Provider
      value={{
        lang,
        setLang: change,
        t: lang === "ar" ? ar : en,
        dir: lang === "ar" ? "rtl" : "ltr",
      }}
    >
      {children}
    </C.Provider>
  );
}