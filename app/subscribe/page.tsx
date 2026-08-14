"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "../context/LanguageContext";
import { useAuth } from "../context/AuthContext";

/* =========================================================
   Types
========================================================= */

interface Plan {
  id: string;
  name: string;
  description: string | null;
  monthly_limit: number | null;
  daily_limit: number | null;
  price: number;
  duration_days: number;
  features: string[] | Record<string, unknown>;
}

interface Subscription {
  id: string;
  startDate: string;
  endDate: string;
  status: string;
}

/* =========================================================
   Page
========================================================= */

export default function SubscribePage() {
  const router = useRouter();
  const { user } = useAuth();
  const { lang, dir } = useLanguage();
  const isEn = lang === "en";

  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscription, setSubscription] =
    useState<Subscription | null>(null);
  const [currentPlan, setCurrentPlan] =
    useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);

  /* Modal */
  const [selectedPlan, setSelectedPlan] =
    useState<Plan | null>(null);
  const [code, setCode] = useState("");
  const [activating, setActivating] = useState(false);
  const [modalError, setModalError] = useState("");
  const [modalSuccess, setModalSuccess] =
    useState("");

  /* =====================================================
     Load Data
  ===================================================== */

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [plansRes, subRes] = await Promise.all([
        fetch("/api/plans"),
        fetch("/api/subscription"),
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
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }

  /* =====================================================
     Activate
  ===================================================== */

  async function handleActivate() {
    if (!selectedPlan || !code.trim()) return;

    setActivating(true);
    setModalError("");
    setModalSuccess("");

    try {
      const res = await fetch("/api/subscription", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          planId: selectedPlan.id,
          code: code.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setModalError(
          data.error ||
            (isEn
              ? "Activation failed"
              : "فشل التفعيل")
        );
        return;
      }

      setModalSuccess(
        isEn
          ? "Subscription activated!"
          : "تم تفعيل الاشتراك بنجاح!"
      );

      setTimeout(() => {
        closeModal();
        loadData();
      }, 1500);
    } catch {
      setModalError(
        isEn
          ? "Connection error"
          : "خطأ في الاتصال"
      );
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
    setCode("");
    setModalError("");
    setModalSuccess("");
  }

  function closeModal() {
    setSelectedPlan(null);
    setCode("");
    setModalError("");
    setModalSuccess("");
  }

  /* =====================================================
     Helpers
  ===================================================== */

  function formatDate(dateStr: string) {
    const d = new Date(dateStr);
    return d.toLocaleDateString(
      isEn ? "en-US" : "ar-EG",
      {
        year: "numeric",
        month: "long",
        day: "numeric",
      }
    );
  }

  function isCurrentPlan(planId: string) {
    return (
      subscription &&
      currentPlan &&
      currentPlan.id === planId
    );
  }

  function featuresList(
    features: string[] | Record<string, unknown>
  ): string[] {
    if (Array.isArray(features)) return features;
    if (
      typeof features === "object" &&
      features !== null
    ) {
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
    <div
      className="mx-auto max-w-5xl px-5 py-8"
      dir={dir}
    >
      {/* ========================= Header ========================= */}
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-text">
          {isEn
            ? "Subscription Plans"
            : "باقات الاشتراك"}
        </h1>
        <p className="mt-2 text-sm text-muted">
          {isEn
            ? "Choose the plan that suits your needs"
            : "اختر الباقة المناسبة لاحتياجاتك"}
        </p>
      </div>

      {/* ========================= Current Subscription ========================= */}
      {subscription && currentPlan && (
        <div className="mb-8 rounded-xl border border-emerald-200 bg-emerald-50 p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-emerald-600">
                {isEn
                  ? "Your Current Plan"
                  : "اشتراكك الحالي"}
              </p>
              <p className="mt-1 text-lg font-bold text-emerald-800">
                {currentPlan.name}
              </p>
              <p className="mt-1 text-xs text-emerald-600">
                {isEn ? "Expires on" : "ينتهي في"}:{" "}
                {formatDate(subscription.endDate)}
              </p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-2xl">
              ✅
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
                    {isEn
                      ? "Current Plan"
                      : "الخطة الحالية"}
                  </div>
                )}

                {/* Plan Name */}
                <h3 className="text-lg font-bold text-text">
                  {plan.name}
                </h3>

                {plan.description && (
                  <p className="mt-1 text-xs text-muted">
                    {plan.description}
                  </p>
                )}

                {/* Price */}
                <div className="mt-4">
                  <span className="text-3xl font-black text-text">
                    {isFree
                      ? isEn
                        ? "Free"
                        : "مجاني"
                      : plan.price}
                  </span>
                  {!isFree && (
                    <span className="text-sm text-muted">
                      {" "}
                      {isEn ? "EGP" : "جنيه"} /{" "}
                      {plan.duration_days}{" "}
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
                            isEn
                              ? "documents/month"
                              : "مستند/شهر"
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
                            isEn
                              ? "documents/day"
                              : "مستند/يوم"
                          }`}
                    </div>
                  )}
                </div>

                {/* Features */}
                {features.length > 0 && (
                  <div className="mt-5 space-y-2 border-t border-border pt-4">
                    {features.map((f, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-2 text-xs text-text-soft"
                      >
                        <span className="mt-0.5 text-emerald-500">
                          ✓
                        </span>
                        {f}
                      </div>
                    ))}
                  </div>
                )}

                {/* Button */}
                <div className="mt-auto pt-6">
                  {isCurrent ? (
                    <button
                      disabled
                      className="w-full rounded-lg border-2 border-emerald-300 bg-emerald-100 py-2.5 text-xs font-bold text-emerald-600"
                    >
                      {isEn ? "Active" : "مُفعّل"}
                    </button>
                  ) : (
                    <button
                      onClick={() => openModal(plan)}
                      className="w-full rounded-lg bg-primary py-2.5 text-xs font-bold text-surface shadow-sm transition hover:brightness-110"
                    >
                      {isFree
                        ? isEn
                          ? "Activate Free Plan"
                          : "تفعيل المجاني"
                        : isEn
                        ? "Subscribe"
                        : "اشترك الآن"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ========================= Activation Modal ========================= */}
      {selectedPlan && (
        <>
          <div
            className="fixed inset-0 z-50 bg-foreground/20 backdrop-blur-sm"
            onClick={closeModal}
          />

          <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2">
            <div className="rounded-xl border border-border bg-surface p-6 shadow-2xl">
              <h3 className="text-base font-bold text-text">
                {isEn
                  ? "Activate Plan"
                  : "تفعيل الباقة"}
              </h3>
              <p className="mt-1 text-sm text-muted">
                {selectedPlan.name} —{" "}
                {selectedPlan.price === 0
                  ? isEn
                    ? "Free"
                    : "مجاني"
                  : `${selectedPlan.price} ${
                      isEn ? "EGP" : "جنيه"
                    }`}
              </p>

              <div className="mt-5">
                <label className="mb-1.5 block text-xs font-semibold text-text-soft">
                  {isEn
                    ? "Activation Code"
                    : "كود التفعيل"}
                </label>
                <input
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value);
                    setModalError("");
                  }}
                  placeholder={
                    isEn
                      ? "Enter your activation code"
                      : "أدخل كود التفعيل"
                  }
                  dir="ltr"
                  maxLength={50}
                  className="w-full rounded-lg border border-border bg-background px-4 py-3 text-sm outline-none focus:border-primary"
                  autoFocus
                />
              </div>

              {modalError && (
                <p className="mt-3 text-xs font-medium text-red-500">
                  {modalError}
                </p>
              )}

              {modalSuccess && (
                <p className="mt-3 text-xs font-medium text-emerald-600">
                  {modalSuccess}
                </p>
              )}

              <div className="mt-5 flex gap-3">
                <button
                  onClick={closeModal}
                  disabled={activating}
                  className="flex-1 rounded-lg border border-border py-2.5 text-xs font-medium text-text-soft transition hover:bg-surface-hover disabled:opacity-50"
                >
                  {isEn ? "Cancel" : "إلغاء"}
                </button>
                <button
                  onClick={handleActivate}
                  disabled={
                    activating || !code.trim()
                  }
                  className="flex-1 rounded-lg bg-primary py-2.5 text-xs font-bold text-surface transition hover:brightness-110 disabled:opacity-50"
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
            </div>
          </div>
        </>
      )}
    </div>
  );
}