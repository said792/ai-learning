"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";

interface Msg { role: "user" | "assistant"; content: string; }

export default function AskPage() {
  const { user, loading: authLoading } = useAuth();
  const { lang, setLang, dir } = useLanguage();
  const isEn = lang === "en";

  const [context, setContext] = useState<string>("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const [loadingCtx, setLoadingCtx] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) { setLoadingCtx(false); return; }

    let cancelled = false;

    const loadContext = async () => {
      try {
        setLoadingCtx(true);

        /* استخدام الـ API الخاص بنا بدل Supabase مباشرة
           عشاننا بنستخدم نظام كوكيز مخصص وليس Supabase Auth */
        const res = await fetch("/api/documents");
        
        if (!res.ok || res.status === 401) {
          if (!cancelled) setContext("NO_DOCS");
          return;
        }

        const data = await res.json();
        const docs = data.documents || [];

        if (docs.length === 0) {
          if (!cancelled) setContext("NO_DOCS");
          return;
        }

        let combined = "";
        docs.forEach((doc: any, i: number) => {
          const a = doc.analysis;
          combined += `\n======================== DOCUMENT ${i + 1}: ${doc.file_name} ========================\n`;
          if (a?.summary) combined += `\nSummary:\n${a.summary}\n`;
          if (a?.keyPoints?.length) combined += `\nKey Points:\n${a.keyPoints.join("\n")}\n`;
          if (a?.rules?.length) combined += `\nRules:\n${a.rules.map((r: any) => `- ${r.title}: ${r.description}`).join("\n")}\n`;
          if (a?.definitions?.length) combined += `\nDefinitions:\n${a.definitions.map((d: any) => `- ${d.term}: ${d.definition}`).join("\n")}\n`;
          if (a?.importantNotes?.length) combined += `\nImportant Notes:\n${a.importantNotes.join("\n")}\n`;
        });

        if (!cancelled) setContext(combined.substring(0, 100000));
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Error loading documents");
      } finally {
        if (!cancelled) setLoadingCtx(false);
      }
    };

    loadContext();
    return () => { cancelled = true; };
  }, [user]);

  const send = useCallback(async () => {
    const txt = input.trim();
    if (!txt || sending || context === "NO_DOCS") return;

    setMsgs((p) => [...p, { role: "user", content: txt }]);
    setInput(""); setSending(true); setErr("");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: txt, documentText: context, lang }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMsgs((p) => [...p, { role: "assistant", content: data.answer || "—" }]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setSending(false);
    }
  }, [input, sending, context, lang]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, sending]);

  /* === States === */
  if (authLoading || loadingCtx) {
    return (
      <div className="flex h-screen items-center justify-center" dir={dir}>
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-800" />
          <p className="text-sm text-slate-500">{isEn ? "Preparing your library..." : "جاري تجهيز مكتبتك..."}</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex h-screen items-center justify-center px-5" dir={dir}>
        <div className="text-center max-w-md">
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-slate-100 text-4xl">🔒</div>
          <h2 className="text-lg font-bold text-slate-800">{isEn ? "Login Required" : "يجب تسجيل الدخول"}</h2>
          <p className="mt-2 text-sm text-slate-500">{isEn ? "You need to login to use this feature. Your questions will be answered based on your uploaded documents only." : "يجب تسجيل الدخول لاستخدام هذه الميزة. سيتم الرد على أسئلتك بناءً على مستنداتك المرفوعة فقط."}</p>
        </div>
      </div>
    );
  }

  if (context === "NO_DOCS") {
    return (
      <div className="flex h-screen items-center justify-center px-5" dir={dir}>
        <div className="text-center max-w-md">
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-slate-100 text-4xl">📂</div>
          <h2 className="text-lg font-bold text-slate-800">{isEn ? "No Documents Found" : "لا توجد مستندات"}</h2>
          <p className="mt-2 text-sm text-slate-500">{isEn ? "Upload documents first, then come back here to ask any questions about them." : "ارفع بعض المستندات أولاً، ثم عد هنا لأسأل أي سؤال عنها."}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-screen max-w-3xl flex-col px-5 pt-20 lg:px-8 lg:pt-8" dir={dir}>
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-800 text-lg text-white shadow-sm">🧠</div>
          <div>
            <h1 className="text-lg font-bold text-slate-800">{isEn ? "Ask Me Anything" : "اسألني أي شيء"}</h1>
            <p className="text-[11px] text-slate-400">{isEn ? "Based on your uploaded documents" : "بناءً على مستنداتك المرفوعة"}</p>
          </div>
        </div>
        <button onClick={() => setLang(lang === "ar" ? "en" : "ar")} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-50">
          <span>🌐</span> {isEn ? "العربية" : "English"}
        </button>
      </div>

      {/* Chat Area */}
      <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {msgs.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-50 text-3xl ring-1 ring-slate-100">💬</div>
              <p className="text-sm text-slate-400">{isEn ? "Ask about anything in your documents..." : "اسأل عن أي شيء في مستنداتك..."}</p>
              <div className="flex flex-wrap justify-center gap-2">
                {[
                  isEn ? "Summarize all my documents" : "لخّص لي كل مستنداتي",
                  isEn ? "What are the main topics?" : "ما هي المواضيع الرئيسية؟",
                  isEn ? "Any common mistakes to avoid?" : "هل هناك أخطاء شائعة يجب تجنبها؟",
                ].map((s, i) => (
                  <button key={i} onClick={() => setInput(s)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500 shadow-sm hover:bg-slate-50 hover:text-slate-700 transition">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {msgs.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-start" : "justify-end"}`}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-xs leading-7 shadow-sm ${
                m.role === "user" ? "bg-slate-800 text-white rounded-tl-sm" : "bg-slate-50 text-slate-700 border border-slate-100 rounded-tr-sm"
              }`} dir={dir}>
                {m.content}
              </div>
            </div>
          ))}

          {sending && (
            <div className="flex justify-end">
              <div className="flex items-center gap-1.5 rounded-2xl rounded-tr-sm bg-slate-50 border border-slate-100 px-4 py-3 shadow-sm">
                <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: "150ms" }} />
                <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        {err && <p className="mx-5 text-[11px] text-red-500">{err}</p>}

        <div className="border-t border-slate-100 bg-white p-4">
          <div className="flex gap-3">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!sending) send(); } }}
              disabled={sending}
              placeholder={isEn ? "Type your question here..." : "اكتب سؤالك هنا..."}
              rows={2}
              dir={dir}
              className="flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-sm outline-none transition focus:border-slate-400 focus:bg-white focus:ring-1 focus:ring-slate-100 disabled:opacity-50"
            />
            <button onClick={send} disabled={sending || !input.trim()} className="self-end rounded-xl bg-slate-800 px-6 py-3 text-sm font-bold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300 shadow-sm">
              {sending ? "..." : isEn ? "Send" : "إرسال"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}