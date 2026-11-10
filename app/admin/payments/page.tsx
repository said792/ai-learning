"use client";

import { useState, useEffect, useCallback } from "react";
import { useLanguage } from "../../context/LanguageContext";

/* =========================================================
   لوحة الأدمن — المدفوعات والإعدادات
   1) قائمة طلبات الدفع + قبول/رفض:
      - أول اشتراك (new) → القبول بيولّد كود تفعيل مربوط بالمستخدم — انسخه وابعته له
      - تجديد (renewal) → القبول بيجدد فورًا من يوم الدفع نفسه (من غير كود)
   2) طرق الدفع اللي بتظهر للمستخدمين (نص حر — سطر لكل طريقة)
   3) إحصائيات التكلفة: إجمالي المقبوضات + الدروس المولدة
========================================================= */

interface PaymentRecord {
  id: string;
  amount: number;
  method: string;
  reference: string | null;
  request_type?: "new" | "renewal";
  status: "pending" | "approved" | "rejected";
  created_at: string;
  decided_at: string | null;
  plans: { id: string; name: string; price: number; duration_days: number } | null;
  users: {
    id: string;
    full_name: string | null;
    username: string | null;
    phone: string | null;
    email: string | null;
  } | null;
}

interface Stats {
  revenue: number;
  ttsTotal: number;
  videoTotal: number;
  ttsToday: number;
  videoToday: number;
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("ar-EG", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  pending: { label: "قيد المراجعة", cls: "bg-amber-100 text-amber-800" },
  approved: { label: "مقبولة", cls: "bg-emerald-100 text-emerald-800" },
  rejected: { label: "مرفوضة", cls: "bg-red-100 text-red-700" },
};

export default function AdminPaymentsPage() {
  const { lang, dir } = useLanguage();
  const isEn = lang === "en";

  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [filterStatus, setFilterStatus] = useState("");
  const [actionMsg, setActionMsg] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  /* Settings */
  const [methodsText, setMethodsText] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  /* كود التفعيل المولد بعد قبول دفعة أول اشتراك — ينسخه الأدمن ويبعته للمستخدم */
  const [generatedCode, setGeneratedCode] = useState<{
    code: string;
    userName: string;
    planName: string;
  } | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set("status", filterStatus);

      const res = await fetch(`/api/admin/payments?${params.toString()}`);

      if (res.status === 403) {
        setForbidden(true);
        setLoading(false);
        return;
      }

      const data = await res.json();
      setPayments(data.payments || []);
      setStats(data.stats || null);
      setMethodsText(data.settings?.paymentMethods || "");
      setForbidden(false);
    } catch {
      /* تجاهل */
    } finally {
      setLoading(false);
    }
  }, [filterStatus]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function decide(paymentId: string, decision: "approved" | "rejected") {
    setBusyId(paymentId);
    setActionMsg("");
    setGeneratedCode(null);
    try {
      const res = await fetch("/api/admin/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentId, decision }),
      });
      const data = await res.json();

      if (!res.ok) {
        setActionMsg(data.error || "فشل تنفيذ القرار");
        return;
      }

      /* أول اشتراك → عرض كود التفعيل المولد للأدمن ينسخه يبعته للمستخدم */
      if (decision === "approved" && data.code) {
        setGeneratedCode({
          code: data.code,
          userName: data.userName || "المستخدم",
          planName:
            payments.find((p) => p.id === paymentId)?.plans?.name || "",
        });
      }

      setActionMsg(data.message || "تم");
      loadData();
    } catch {
      setActionMsg("خطأ في الاتصال");
    } finally {
      setBusyId(null);
    }
  }

  async function copyCode() {
    if (!generatedCode) return;
    try {
      await navigator.clipboard.writeText(generatedCode.code);
      setActionMsg("تم نسخ الكود ✅ — ابعته للمستخدم");
    } catch {
      /* المتصفح منع النسخ — الأدمن ينقله يدوي */
    }
  }

  async function saveSettings() {
    setSavingSettings(true);
    setActionMsg("");
    try {
      const res = await fetch("/api/admin/payments", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentMethods: methodsText }),
      });
      const data = await res.json();

      if (!res.ok) {
        setActionMsg(data.error || "فشل حفظ الإعدادات");
        return;
      }

      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2500);
    } catch {
      setActionMsg("خطأ في الاتصال");
    } finally {
      setSavingSettings(false);
    }
  }

  const pendingCount = payments.filter((p) => p.status === "pending").length;

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-border border-t-primary" />
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-16 text-center" dir={dir}>
        <p className="text-4xl">🔒</p>
        <p className="mt-4 text-sm font-medium text-muted">
          {isEn ? "Admins only" : "الصفحة دي للأدمن فقط"}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-5 py-8" dir={dir}>
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text">
            {isEn ? "Payments & Settings" : "المدفوعات والإعدادات"}
          </h1>
          <p className="mt-1 text-xs text-muted">
            {isEn
              ? "Approve payments, edit payment methods and track usage costs"
              : "قبول الدفعات، تعديل طرق الدفع، ومتابعة تكلفة الاستخدام"}
          </p>
        </div>
        <button
          onClick={loadData}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-xs font-medium text-text-soft transition hover:bg-surface-hover"
        >
          ⟳ {isEn ? "Refresh" : "تحديث"}
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-border bg-surface p-4">
            <p className="text-[10px] font-medium text-muted">
              {isEn ? "Total revenue" : "إجمالي المقبوضات"}
            </p>
            <p className="mt-1 text-xl font-black text-emerald-600" dir="ltr">
              {stats.revenue} {isEn ? "EGP" : "جنيه"}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-surface p-4">
            <p className="text-[10px] font-medium text-muted">
              {isEn ? "Audio lessons (today)" : "دروس صوتية (اليوم)"}
            </p>
            <p className="mt-1 text-xl font-black text-text" dir="ltr">
              {stats.ttsToday}
            </p>
            <p className="text-[10px] text-muted">
              {isEn ? `Total: ${stats.ttsTotal}` : `الإجمالي: ${stats.ttsTotal}`}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-surface p-4">
            <p className="text-[10px] font-medium text-muted">
              {isEn ? "Video lessons (today)" : "دروس فيديو (اليوم)"}
            </p>
            <p className="mt-1 text-xl font-black text-text" dir="ltr">
              {stats.videoToday}
            </p>
            <p className="text-[10px] text-muted">
              {isEn ? `Total: ${stats.videoTotal}` : `الإجمالي: ${stats.videoTotal}`}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-surface p-4">
            <p className="text-[10px] font-medium text-muted">
              {isEn ? "Pending payments" : "دفعات معلقة"}
            </p>
            <p className="mt-1 text-xl font-black text-amber-600" dir="ltr">
              {pendingCount}
            </p>
          </div>
        </div>
      )}

      {/* Settings */}
      <div className="mb-6 rounded-xl border border-border bg-surface p-5">
        <h2 className="text-sm font-bold text-text">
          ⚙️ {isEn ? "Payment settings" : "إعدادات الدفع"}
        </h2>

        <label className="mt-4 mb-1.5 block text-xs font-semibold text-text-soft">
          {isEn
            ? "Payment methods shown to users (one method per line)"
            : "طرق الدفع اللي بتظهر للمستخدمين (طريقة واحدة في كل سطر)"}
        </label>
        <textarea
          value={methodsText}
          onChange={(e) => setMethodsText(e.target.value)}
          rows={4}
          dir="rtl"
          placeholder={"فودافون كاش — 010XXXXXXXX\nإنستاباي — 010XXXXXXXX\nتحويل بنكي — ..."}
          className="w-full rounded-lg border border-border bg-background px-4 py-3 text-sm leading-6 outline-none transition focus:border-primary"
        />

        <p className="mt-4 rounded-lg bg-surface-soft px-3 py-2.5 text-[11px] leading-5 text-muted">
          {isEn
            ? "Every payment request waits for your approval below: first-time subscriptions generate an activation code for you to send, renewals apply instantly from the user's payment day."
            : "كل طلب دفع بيستنى موافقتك من الجدول تحت: أول اشتراك بيتولد له كود تفعيل تبعته للمستخدم، والتجديد بيتعمل فورًا من يوم الدفع نفسه — والمدة بتتحسب من يوم الدفع مش من يوم موافقتك."}
        </p>

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={saveSettings}
            disabled={savingSettings}
            className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-surface transition hover:brightness-110 disabled:opacity-50"
          >
            {savingSettings
              ? isEn
                ? "Saving..."
                : "جاري الحفظ..."
              : isEn
              ? "Save settings"
              : "حفظ الإعدادات"}
          </button>
          {savedFlash && (
            <span className="text-xs font-medium text-emerald-600">
              ✅ {isEn ? "Saved" : "اتحفظت"}
            </span>
          )}
        </div>
      </div>

      {actionMsg && (
        <p className="mb-4 rounded-lg bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-700">
          {actionMsg}
        </p>
      )}

      {/* كود التفعيل المولد بعد قبول دفعة أول اشتراك */}
      {generatedCode && (
        <div className="mb-4 rounded-xl border-2 border-emerald-300 bg-emerald-50 p-4">
          <p className="text-xs font-bold text-emerald-800">
            🔑 {isEn ? "Activation code generated" : "كود التفعيل تم إنشاؤه"}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <code
              dir="ltr"
              className="rounded-lg bg-white px-4 py-2 text-base font-black tracking-wider text-emerald-700 shadow-sm"
            >
              {generatedCode.code}
            </code>
            <button
              onClick={copyCode}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-emerald-700"
            >
              {isEn ? "Copy code" : "نسخ الكود"}
            </button>
          </div>
          <p className="mt-2 text-[11px] leading-5 text-emerald-700">
            {isEn
              ? `Send this code to ${generatedCode.userName}${generatedCode.planName ? ` (${generatedCode.planName})` : ""} — their subscription starts from their payment day once they enter it.`
              : `ابعث الكود ده لـ ${generatedCode.userName}${generatedCode.planName ? ` (${generatedCode.planName})` : ""} — اشتراكه هيبدأ من يوم ما دفع أول ما يدخل الكود.`}
          </p>
        </div>
      )}

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-2">
        {[
          { v: "", label: isEn ? "All" : "الكل" },
          { v: "pending", label: isEn ? "Pending" : "قيد المراجعة" },
          { v: "approved", label: isEn ? "Approved" : "مقبولة" },
          { v: "rejected", label: isEn ? "Rejected" : "مرفوضة" },
        ].map((f) => (
          <button
            key={f.v}
            onClick={() => setFilterStatus(f.v)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition ${
              filterStatus === f.v
                ? "bg-primary text-surface"
                : "border border-border bg-surface text-text-soft hover:bg-surface-hover"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Payments list */}
      {payments.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-4xl">💳</p>
          <p className="mt-4 text-sm text-muted">
            {isEn ? "No payments yet" : "لا توجد دفعات بعد"}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {payments.map((p) => {
            const badge = STATUS_BADGE[p.status] || STATUS_BADGE.pending;
            const plan = Array.isArray(p.plans) ? p.plans[0] : p.plans;
            const user = Array.isArray(p.users) ? p.users[0] : p.users;

            return (
              <div
                key={p.id}
                className={`rounded-xl border bg-surface p-4 ${
                  p.status === "pending"
                    ? "border-amber-200 bg-amber-50/40"
                    : "border-border"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-text">
                        {plan?.name || "—"}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${badge.cls}`}
                      >
                        {badge.label}
                      </span>
                      {p.request_type && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            p.request_type === "new"
                              ? "bg-sky-100 text-sky-700"
                              : "bg-violet-100 text-violet-700"
                          }`}
                        >
                          {p.request_type === "new"
                            ? isEn
                              ? "First subscription"
                              : "أول اشتراك"
                            : isEn
                            ? "Renewal"
                            : "تجديد"}
                        </span>
                      )}
                      <span className="text-sm font-black text-emerald-600" dir="ltr">
                        {p.amount} {isEn ? "EGP" : "جنيه"}
                      </span>
                    </div>

                    <p className="mt-1.5 text-xs text-text-soft">
                      👤 {user?.full_name || user?.username || "—"}
                      {user?.phone ? ` · ${user.phone}` : ""}
                      {user?.email ? ` · ${user.email}` : ""}
                    </p>

                    <p className="mt-0.5 text-[11px] text-muted" dir="rtl">
                      💳 {p.method}
                      {p.reference ? ` · مرجع: ${p.reference}` : ""}
                    </p>

                    <p className="mt-0.5 text-[10px] text-muted">
                      {fmtDate(p.created_at)}
                      {p.decided_at ? ` · ${isEn ? "decided" : "اتخذ القرار"}: ${fmtDate(p.decided_at)}` : ""}
                    </p>
                  </div>

                  {p.status === "pending" && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => decide(p.id, "approved")}
                        disabled={busyId === p.id}
                        className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                      >
                        ✅{" "}
                        {(p.request_type || "new") === "new"
                          ? isEn
                            ? "Approve & generate code"
                            : "قبول وإنشاء كود تفعيل"
                          : isEn
                          ? "Approve & renew"
                          : "قبول وتجديد فوري"}
                      </button>
                      <button
                        onClick={() => decide(p.id, "rejected")}
                        disabled={busyId === p.id}
                        className="rounded-lg border border-red-200 bg-surface px-3 py-2 text-xs font-bold text-red-600 transition hover:bg-red-50 disabled:opacity-50"
                      >
                        ✕ {isEn ? "Reject" : "رفض"}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
