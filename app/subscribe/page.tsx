"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "../context/LanguageContext";
import { useAuth } from "../context/AuthContext";

/* =========================================================
   صفحة الاشتراك:
   - الخطة المجانية: مفعّلة تلقائيًا مع أي حساب — مدى الحياة، بدون تفعيل ولا كود
   - الباقات المدفوعة: الدفع أولاً (محفظة/تحويل) → إدخال الرقم المرجعي (إلزامي)
     → الطلب بيتسجل للأدمن → بعد المراجعة:
       * أول اشتراك: بيوصل المستخدم كود تفعيل من الإدارة → يدخله هنا
         (الاشتراك بيبدأ من يوم الدفع نفسه)
       * تجديد: بيتعمل تلقائيًا فورًا من يوم الدفع — من غير أي كود
========================================================= */

interface Plan {
  id: string;
  name: string;
  description: string | null;
  monthly_limit: number | null;
  daily_limit: number | null;
  tts_daily_limit: number | null;
  video_daily_limit: number | null;
  price: number;
  duration_days: number;
  features: string[] | Record<string, unknown>;
}

interface Subscription {
  id: string;
  startDate: string;
  endDate: string;
  status: string;
  daysRemaining?: number;
}

export default function SubscribePage() {
  const router = useRouter();
  const { user } = useAuth();
  const { lang, dir } = useLanguage();
  const isEn = lang === "en";

  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [currentPlan, setCurrentPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);

  /* إعدادات الدفع */
  const [paymentMethods, setPaymentMethods] = useState<string[]>([]);

  /* آخر طلب دفع معلق — عشان نعرض حالته (قيد المراجعة) */
  const [pendingPayment, setPendingPayment] = useState<{
    id: string;
    createdAt: string;
    requestType: "new" | "renewal";
    planName: string;
    amount: number;
  } | null>(null);

  /* Modal — دفع */
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [payMethod, setPayMethod] = useState("");
  const [payReference, setPayReference] = useState("");
  const [paying, setPaying] = useState(false);
  const [modalError, setModalError] = useState("");
  const [modalSuccess, setModalSuccess] = useState("");

  /* إدخال كود التفعيل — للي الإدارة بعتله كود بعد تأكيد الدفع (أول اشتراك) */
  const [showCodeBox, setShowCodeBox] = useState(false);
  const [code, setCode] = useState("");
  const [activating, setActivating] = useState(false);
  const [codeMsg, setCodeMsg] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  /* =====================================================
     Load Data
  ===================================================== */

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [plansRes, subRes, cfgRes, paysRes] = await Promise.all([
        fetch("/api/plans"),
        fetch("/api/subscription"),
        fetch("/api/payments/config"),
        fetch("/api/payments"),
      ]);

      if (plansRes.ok) {
        const plansData = await plansRes.json();
        setPlans(plansData.plans || []);
      }

      if (subRes.ok) {
        const subData = await subRes.json();
        setSubscription(subData.subscription);
        setCurrentPlan(subData.plan);
      }

      if (cfgRes.ok) {
        const cfgData = await cfgRes.json();
        const raw = String(cfgData.paymentMethods || "").trim();
        setPaymentMethods(
          raw
            ? raw
                .split("\n")
                .map((l) => l.trim())
                .filter(Boolean)
            : []
        );
      }

      /* آخر طلب دفع معلق */
      if (paysRes.ok) {
        const paysData = await paysRes.json();
        const list: Array<Record<string, unknown>> = paysData.payments || [];
        const pending = list.find((p) => p.status === "pending");

        if (pending) {
          const planRow = Array.isArray(pending.plans)
            ? (pending.plans as Array<Record<string, unknown>>)[0]
            : (pending.plans as Record<string, unknown> | null);
          setPendingPayment({
            id: String(pending.id),
            createdAt: String(pending.created_at),
            requestType:
              (pending.request_type as "new" | "renewal") || "new",
            planName: String(planRow?.name || ""),
            amount: Number(pending.amount) || 0,
          });
        } else {
          setPendingPayment(null);
        }
      }
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }

  /* =====================================================
     الدفع — "حولّت الفلوس، ابعت الطلب للإدارة"
     الطلب بيتسجل pending — أول ما الأدمن يراجع:
     أول اشتراك → كود تفعيل يوصل للمستخدم، تجديد → تفعيل فوري
  ===================================================== */

  async function handlePay() {
    if (!selectedPlan) return;

    setPaying(true);
    setModalError("");
    setModalSuccess("");

    try {
      const res = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: selectedPlan.id,
          method: payMethod,
          reference: payReference.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setModalError(
          data.error || (isEn ? "Payment failed" : "فشل تسجيل الدفع")
        );
        return;
      }

      setModalSuccess(data.message || (isEn ? "Done!" : "تم!"));
      setTimeout(() => {
        closeModal();
        loadData();
      }, 2200);
    } catch {
      setModalError(isEn ? "Connection error" : "خطأ في الاتصال");
    } finally {
      setPaying(false);
    }
  }

  /* =====================================================
     كود التفعيل — للي الإدارة بعتله كود بعد تأكيد دفعة أول اشتراك
  ===================================================== */

  async function handleActivate() {
    if (!code.trim()) return;

    setActivating(true);
    setCodeMsg(null);
    setModalError("");
    setModalSuccess("");

    try {
      const res = await fetch("/api/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setCodeMsg({
          ok: false,
          text: data.error || (isEn ? "Activation failed" : "فشل التفعيل"),
        });
        return;
      }

      setCodeMsg({
        ok: true,
        text: data.message || (isEn ? "Activated!" : "تم التفعيل!"),
      });
      setCode("");
      setTimeout(() => {
        loadData();
      }, 2000);
    } catch {
      setCodeMsg({
        ok: false,
        text: isEn ? "Connection error" : "خطأ في الاتصال",
      });
    } finally {
      setActivating(false);
    }
  }

  /* =====================================================
     Modal Helpers
  ===================================================== */

  function openModal(plan: Plan) {
    if (!user) {
      router.push("/login");
      return;
    }
    setSelectedPlan(plan);
    setPayMethod("");
    setPayReference("");
    setModalError("");
    setModalSuccess("");
  }

  function closeModal() {
    setSelectedPlan(null);
    setPayMethod("");
    setPayReference("");
    setModalError("");
    setModalSuccess("");
  }

  /* =====================================================
     Helpers
  ===================================================== */

  function formatDate(dateStr: string) {
    const d = new Date(dateStr);
    return d.toLocaleDateString(isEn ? "en-US" : "ar-EG", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  function isCurrentPlan(planId: string) {
    return subscription && currentPlan && currentPlan.id === planId;
  }

  function featuresList(features: string[] | Record<string, unknown>): string[] {
    if (Array.isArray(features)) return features;
    if (typeof features === "object" && features !== null) {
      return Object.values(features).map(String);
    }
    return [];
  }

  /* =====================================================
     Render
  ===================================================== */

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-border border-t-primary" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-5 py-8" dir={dir}>
      {/* ========================= Header ========================= */}
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-text">
          {isEn ? "Subscription Plans" : "باقات الاشتراك"}
        </h1>
        <p className="mt-2 text-sm text-muted">
          {isEn
            ? "Choose the plan that suits your needs"
            : "اختر الباقة المناسبة لاحتياجاتك"}
        </p>
      </div>

      {/* ========================= Current Subscription ========================= */}
      {subscription && currentPlan && (
        <div
          className={`mb-8 rounded-xl border p-5 ${
            (subscription.daysRemaining ?? 99) <= 3 &&
            (subscription.daysRemaining ?? 0) < 3650
              ? "border-amber-300 bg-amber-50"
              : "border-emerald-200 bg-emerald-50"
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p
                className={`text-xs font-medium ${
                  (subscription.daysRemaining ?? 99) <= 3 &&
                  (subscription.daysRemaining ?? 0) < 3650
                    ? "text-amber-600"
                    : "text-emerald-600"
                }`}
              >
                {isEn ? "Your Current Plan" : "اشتراكك الحالي"}
              </p>
              <p
                className={`mt-1 text-lg font-bold ${
                  (subscription.daysRemaining ?? 99) <= 3 &&
                  (subscription.daysRemaining ?? 0) < 3650
                    ? "text-amber-800"
                    : "text-emerald-800"
                }`}
              >
                {currentPlan.name}
              </p>
              <p className="mt-1 text-xs text-slate-600">
                {(subscription.daysRemaining ?? 0) > 3650 ? (
                  <>
                    {isEn
                      ? "Free plan — lifetime, no renewal needed"
                      : "الخطة المجانية — مدى الحياة، من غير أي تجديد"}
                  </>
                ) : (
                  <>
                    {isEn ? "Expires on" : "ينتهي في"}:{" "}
                    {formatDate(subscription.endDate)}
                    {" · "}
                    <span className="font-bold">
                      {isEn
                        ? `${subscription.daysRemaining ?? 0} day${subscription.daysRemaining === 1 ? "" : "s"} left`
                        : `باقي ${subscription.daysRemaining ?? 0} يوم`}
                    </span>
                  </>
                )}
              </p>
              {(subscription.daysRemaining ?? 99) <= 3 &&
                (subscription.daysRemaining ?? 0) < 3650 && (
                  <p className="mt-2 text-xs font-semibold text-amber-700">
                    ⏰{" "}
                    {isEn
                      ? "Your subscription is about to expire — press renew, pay and send the payment reference. The renewal days stack on top of your remaining days and are counted from your payment day."
                      : "اشتراكك على وشك الانتهاء — اضغط تجديد، دفع وابعت الرقم المرجعي — التجديد بيتحسب من يوم الدفع نفسه والأيام بتتضاف فوق المتبقي."}
                  </p>
                )}
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-2xl">
              {(subscription.daysRemaining ?? 99) <= 3 &&
              (subscription.daysRemaining ?? 0) < 3650
                ? "⏰"
                : "✅"}
            </div>
          </div>
        </div>
      )}

      {/* ========================= Plans Grid ========================= */}
      {plans.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-4xl">📦</p>
          <p className="mt-4 text-sm text-muted">
            {isEn
              ? "No plans available at the moment"
              : "لا توجد باقات متاحة حالياً"}
          </p>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan) => {
            const isCurrent = isCurrentPlan(plan.id);
            const features = featuresList(plan.features);
            const isFree = plan.price === 0;

            return (
              <div
                key={plan.id}
                className={`relative flex flex-col rounded-xl border-2 p-6 transition-all ${
                  isCurrent
                    ? "border-emerald-400 bg-emerald-50/50 shadow-md"
                    : "border-border bg-surface hover:border-primary/30 hover:shadow-sm"
                }`}
              >
                {isCurrent && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-emerald-500 px-3 py-0.5 text-[10px] font-bold text-white">
                    {isEn ? "Current Plan" : "الخطة الحالية"}
                  </div>
                )}

                {/* Plan Name */}
                <h3 className="text-lg font-bold text-text">{plan.name}</h3>

                {plan.description && (
                  <p className="mt-1 text-xs text-muted">{plan.description}</p>
                )}

                {/* Price */}
                <div className="mt-4">
                  <span className="text-3xl font-black text-text">
                    {isFree ? (isEn ? "Free" : "مجاني") : plan.price}
                  </span>
                  {!isFree && (
                    <span className="text-sm text-muted">
                      {" "}
                      {isEn ? "EGP" : "جنيه"} / {plan.duration_days}{" "}
                      {isEn ? "days" : "يوم"}
                    </span>
                  )}
                </div>

                {/* Limits */}
                <div className="mt-5 space-y-2">
                  {plan.monthly_limit != null && (
                    <div className="flex items-center gap-2 text-xs text-text-soft">
                      <span>📊</span>
                      {plan.monthly_limit === -1
                        ? isEn
                          ? "Unlimited monthly"
                          : "غير محدود شهرياً"
                        : `${plan.monthly_limit} ${
                            isEn ? "documents/month" : "مستند/شهر"
                          }`}
                    </div>
                  )}
                  {plan.daily_limit != null && (
                    <div className="flex items-center gap-2 text-xs text-text-soft">
                      <span>📅</span>
                      {plan.daily_limit === -1
                        ? isEn
                          ? "Unlimited daily"
                          : "غير محدود يومياً"
                        : `${plan.daily_limit} ${
                            isEn ? "documents/day" : "مستند/يوم"
                          }`}
                    </div>
                  )}
                  {/* دروس صوتية / مرئية — للباقات المدفوعة فقط */}
                  <div className="flex items-center gap-2 text-xs text-text-soft">
                    <span>🎧</span>
                    {!isFree
                      ? plan.tts_daily_limit == null ||
                        plan.tts_daily_limit === -1
                        ? isEn
                          ? "Audio lessons: unlimited"
                          : "دروس صوتية: غير محدود"
                        : `${plan.tts_daily_limit} ${isEn ? "audio lessons/day" : "درس صوتي/يوم"}`
                      : isEn
                      ? "Audio lessons: not included"
                      : "دروس صوتية: غير متاحة"}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-text-soft">
                    <span>🎬</span>
                    {!isFree
                      ? plan.video_daily_limit == null ||
                        plan.video_daily_limit === -1
                        ? isEn
                          ? "Video lessons: unlimited"
                          : "دروس فيديو: غير محدود"
                        : `${plan.video_daily_limit} ${isEn ? "video lessons/day" : "درس فيديو/يوم"}`
                      : isEn
                      ? "Video lessons: not included"
                      : "دروس فيديو: غير متاحة"}
                  </div>
                </div>

                {/* Features */}
                {features.length > 0 && (
                  <div className="mt-5 space-y-2 border-t border-border pt-4">
                    {features.map((f, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-2 text-xs text-text-soft"
                      >
                        <span className="mt-0.5 text-emerald-500">✓</span>
                        {f}
                      </div>
                    ))}
                  </div>
                )}

                {/* Button */}
                <div className="mt-auto pt-6">
                  {isFree ? (
                    /* ===== الخطة المجانية: بدون تفعيل — بتتفعل تلقائيًا مع الحساب ===== */
                    user ? (
                      <button
                        disabled
                        className="w-full cursor-default rounded-lg border-2 border-emerald-200 bg-emerald-50 py-2.5 text-xs font-bold text-emerald-700"
                      >
                        {isEn
                          ? "Auto-activated with your account ✓"
                          : "بتتفعل تلقائيًا مع حسابك ✓"}
                      </button>
                    ) : (
                      <button
                        onClick={() => router.push("/register")}
                        className="w-full rounded-lg border-2 border-emerald-300 bg-emerald-50 py-2.5 text-xs font-bold text-emerald-700 transition hover:bg-emerald-100"
                      >
                        {isEn
                          ? "Start free — lifetime, no code"
                          : "ابدأ مجاناً — مدى الحياة بدون كود"}
                      </button>
                    )
                  ) : (
                    <button
                      onClick={() => openModal(plan)}
                      className={`w-full rounded-lg py-2.5 text-xs font-bold shadow-sm transition hover:brightness-110 ${
                        isCurrent
                          ? "border-2 border-emerald-300 bg-emerald-100 text-emerald-700"
                          : "bg-primary text-surface"
                      }`}
                    >
                      {isCurrent
                        ? isEn
                          ? "Renew subscription"
                          : "تجديد الاشتراك"
                        : isEn
                        ? "Subscribe now"
                        : "اشترك الآن"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ========================= طلب دفع قيد المراجعة ========================= */}
      {pendingPayment && (
        <div className="mt-8 rounded-xl border border-amber-300 bg-amber-50 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-bold text-amber-800">
              ⏰ {isEn ? "Payment request under review" : "طلب الدفع قيد المراجعة"}
            </p>
            <span className="rounded-full bg-amber-200 px-2.5 py-0.5 text-[10px] font-bold text-amber-800">
              {isEn ? "Pending" : "قيد المراجعة"}
            </span>
          </div>
          <p className="mt-2 text-xs leading-6 text-amber-800">
            {isEn
              ? `${pendingPayment.planName} — ${pendingPayment.amount} EGP — submitted ${formatDate(pendingPayment.createdAt)}.`
              : `${pendingPayment.planName} — ${pendingPayment.amount} جنيه — بعت الطلب ${formatDate(pendingPayment.createdAt)}.`}
          </p>
          <p className="mt-1 text-xs leading-6 text-amber-700">
            {pendingPayment.requestType === "new"
              ? isEn
                ? "After the admin confirms your payment, you will receive an activation code — enter it below and your subscription starts from your payment day."
                : "بعد ما الإدارة تأكد الدفع هيوصللك كود تفعيل — ادخله تحت، واشتراكك هيبدأ من يوم ما حولت الفلوس نفسه."
              : isEn
              ? "Once the admin confirms your payment, your subscription renews automatically — no code needed, counted from your payment day."
              : "أول ما الإدارة تأكد الدفع هيتم تجديد اشتراكك تلقائيًا من غير أي كود — والمدة بتتحسب من يوم الدفع نفسه."}
          </p>
        </div>
      )}

      {/* ========================= إدخال كود التفعيل ========================= */}
      <div className="mt-6 rounded-xl border border-border bg-surface p-5">
        {!showCodeBox ? (
          <button
            onClick={() => setShowCodeBox(true)}
            className="text-xs font-medium text-primary transition hover:underline"
          >
            {isEn
              ? "Received an activation code from the admin? Enter it here"
              : "استلمت كود تفعيل من الإدارة؟ ادخله من هنا"}
          </button>
        ) : (
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-text-soft">
              {isEn ? "Activation Code" : "كود التفعيل"}
            </label>
            <input
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setCodeMsg(null);
              }}
              placeholder={isEn ? "e.g. AIB-XXXXXXXX" : "مثال: AIB-XXXXXXXX"}
              dir="ltr"
              maxLength={50}
              className="w-full rounded-lg border border-border bg-background px-4 py-3 text-sm outline-none focus:border-primary"
            />
            <button
              onClick={handleActivate}
              disabled={activating || !code.trim()}
              className="mt-3 rounded-lg bg-primary px-5 py-2.5 text-xs font-bold text-surface transition hover:brightness-110 disabled:opacity-50"
            >
              {activating
                ? isEn
                  ? "Activating..."
                  : "جاري التفعيل..."
                : isEn
                ? "Activate"
                : "تفعيل"}
            </button>
          </div>
        )}

        {codeMsg && (
          <p
            className={`mt-3 rounded-lg px-3 py-2 text-xs font-medium ${
              codeMsg.ok
                ? "bg-emerald-50 text-emerald-700"
                : "bg-red-50 text-red-600"
            }`}
          >
            {codeMsg.ok ? "✅ " : "⚠️ "}
            {codeMsg.text}
          </p>
        )}
      </div>

      {/* ========================= Payment Modal ========================= */}
      {selectedPlan && (
        <>
          <div
            className="fixed inset-0 z-50 bg-foreground/20 backdrop-blur-sm"
            onClick={closeModal}
          />

          <div className="fixed left-1/2 top-1/2 z-50 max-h-[92vh] w-full max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto">
            <div className="rounded-xl border border-border bg-surface p-6 shadow-2xl">
              <h3 className="text-base font-bold text-text">
                {isEn
                  ? "Subscribe / Renew"
                  : subscription && currentPlan
                  ? "تجديد الاشتراك"
                  : "الاشتراك في الباقة"}
              </h3>
              <p className="mt-1 text-sm text-muted">
                {selectedPlan.name} — {selectedPlan.price}{" "}
                {isEn ? "EGP" : "جنيه"} / {selectedPlan.duration_days}{" "}
                {isEn ? "days" : "يوم"}
              </p>

              {/* ملحوظة التجديد التراكمي */}
              {subscription && currentPlan && (
                <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-[11px] font-medium leading-5 text-emerald-700">
                  💡{" "}
                  {isEn
                    ? "Renewal days stack on top of your remaining days and are counted from your payment day — you lose nothing."
                    : "التجديد بيتضيف الأيام فوق المتبقي وبيتحسب من يوم الدفع نفسه — مش بتحاسب أي يوم."}
                </p>
              )}

              {/* ======== خطوة 1: حوّل الفلوس ======== */}
              <div className="mt-5">
                <p className="mb-2 text-xs font-semibold text-text-soft">
                  1️⃣{" "}
                  {isEn
                    ? "Transfer the amount using any of these methods:"
                    : "حوّل مبلغ الاشتراك بأي طريقة من دول:"}
                </p>

                {paymentMethods.length > 0 ? (
                  <div className="space-y-2">
                    {paymentMethods.map((m, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setPayMethod(m)}
                        dir="rtl"
                        className={`w-full rounded-lg border px-3.5 py-2.5 text-start text-xs font-medium leading-5 transition ${
                          payMethod === m
                            ? "border-primary bg-primary-soft text-primary"
                            : "border-border bg-background text-text-soft hover:bg-surface-hover"
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-lg bg-amber-50 px-3 py-2.5 text-[11px] leading-5 text-amber-700">
                    {isEn
                      ? "Payment methods are not configured yet — the admin adds them from Admin → Payments."
                      : "طرق الدفع لسه متظبطتش من الإدارة — الأدمن بيضيفها من (أدمن → المدفوعات)."}
                  </p>
                )}
              </div>

              {/* ======== خطوة 2: اكتب رقم عملية التحويل (إلزامي) ======== */}
              <div className="mt-4">
                <label className="mb-1.5 block text-xs font-semibold text-text-soft">
                  2️⃣{" "}
                  {isEn
                    ? "Transfer reference (required)"
                    : "رقم عملية التحويل / المرجع (إلزامي)"}
                  <span className="text-red-500"> *</span>
                </label>
                <input
                  value={payReference}
                  onChange={(e) => {
                    setPayReference(e.target.value);
                    setModalError("");
                  }}
                  placeholder={
                    isEn
                      ? "e.g. the transaction number shown after the transfer"
                      : "مثال: رقم عملية فودافون كاش اللي ظهر لك بعد التحويل"
                  }
                  maxLength={120}
                  className="w-full rounded-lg border border-border bg-background px-4 py-3 text-sm outline-none focus:border-primary"
                />
                <p className="mt-1 text-[10px] leading-4 text-muted">
                  {isEn
                    ? "The admin confirms your payment using this reference number."
                    : "الإدارة بتأكد الدفع بالرقم ده — بيوصلها مع الطلب بتاعك."}
                </p>
              </div>

              {/* ======== خطوة 3: ابعت الطلب للإدارة ======== */}
              <div className="mt-4">
                <button
                  onClick={handlePay}
                  disabled={paying || modalSuccess !== "" || !payReference.trim()}
                  className="w-full rounded-lg bg-emerald-600 py-3 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                >
                  {paying
                    ? isEn
                      ? "Sending..."
                      : "جاري الإرسال..."
                    : isEn
                    ? "I have paid — send my request to the admin"
                    : "3️⃣ حوّلت — ابعت الطلب للإدارة"}
                </button>

                <p className="mt-2 text-[10px] leading-4 text-muted">
                  {isEn
                    ? "Your request goes to the admin for review: first-time subscriptions receive an activation code, renewals apply automatically — both counted from your payment day."
                    : "طلبك بيروح للإدارة للمراجعة: أول اشتراك هيوصلك كود تفعيل تدخله في الصفحة دي، والتجديد بيتعمل تلقائيًا — والاتنين بيتحسبوا من يوم الدفع نفسه."}
                </p>
              </div>

              {modalError && (
                <p className="mt-3 text-xs font-medium text-red-500">
                  {modalError}
                </p>
              )}

              {modalSuccess && (
                <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-600">
                  ✅ {modalSuccess}
                </p>
              )}

              <div className="mt-5">
                <button
                  onClick={closeModal}
                  className="w-full rounded-lg border border-border py-2.5 text-xs font-medium text-text-soft transition hover:bg-surface-hover"
                >
                  {isEn ? "Close" : "إغلاق"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
