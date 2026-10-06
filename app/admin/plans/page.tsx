// app/admin/plans/page.tsx

"use client";

import { useState, useEffect } from "react";
import { useLanguage } from "../../context/LanguageContext";
import { useAuth } from "../../context/AuthContext";
import { useRouter } from "next/navigation";

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
  features: string[] | Record<string, unknown> | null;
}

/* =========================================================
   Page
========================================================= */
export default function AdminPlansPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { lang, dir } = useLanguage();
  const isEn = lang === "en";

  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [globalErr, setGlobalErr] = useState("");

  /* Modal State */
  const [showModal, setShowModal] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [modalErr, setModalErr] = useState("");

  /* Form State */
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [monthlyLimit, setMonthlyLimit] = useState("");
  const [dailyLimit, setDailyLimit] = useState("");
  const [price, setPrice] = useState("");
  const [durationDays, setDurationDays] = useState("");
  const [features, setFeatures] = useState("");

  /* =====================================================
     Protect: Admin Only
  ===================================================== */
  useEffect(() => {
    if (user && user.role !== "admin") {
      router.push("/");
    }
  }, [user, router]);

  /* =====================================================
     Load Plans
  ===================================================== */
  useEffect(() => {
    loadPlans();
  }, []);

  async function loadPlans() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/plans");
      if (res.ok) {
        const data = await res.json();
        setPlans(data.plans || []);
      }
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }

  /* =====================================================
     Features Helper
  ===================================================== */
  function featuresToString(f: string[] | Record<string, unknown> | null): string {
    if (!f) return "";
    if (Array.isArray(f)) return f.join("\n");
    if (typeof f === "object") return Object.values(f).join("\n");
    return "";
  }

  function stringToFeatures(s: string): string[] {
    return s
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  /* =====================================================
     Open Modal
  ===================================================== */
  function openCreate() {
    setEditingPlan(null);
    setName("");
    setDescription("");
    setMonthlyLimit("");
    setDailyLimit("");
    setPrice("");
    setDurationDays("");
    setFeatures("");
    setModalErr("");
    setShowModal(true);
  }

  function openEdit(plan: Plan) {
    setEditingPlan(plan);
    setName(plan.name);
    setDescription(plan.description || "");
    setMonthlyLimit(plan.monthly_limit == null ? "" : String(plan.monthly_limit));
    setDailyLimit(plan.daily_limit == null ? "" : String(plan.daily_limit));
    setPrice(String(plan.price));
    setDurationDays(String(plan.duration_days));
    setFeatures(featuresToString(plan.features));
    setModalErr("");
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditingPlan(null);
    setModalErr("");
  }

  /* =====================================================
     Save (Create or Update)
  ===================================================== */
  async function handleSave() {
    if (!name.trim()) {
      setModalErr(isEn ? "Plan name is required" : "اسم الخطة مطلوب");
      return;
    }

    if (price === "" || durationDays === "") {
      setModalErr(isEn ? "Price and duration are required" : "السعر ومدة الباقة مطلوبين");
      return;
    }

    setSaving(true);
    setModalErr("");

    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        monthly_limit: monthlyLimit === "" ? null : Number(monthlyLimit) === -1 ? -1 : Number(monthlyLimit),
        daily_limit: dailyLimit === "" ? null : Number(dailyLimit) === -1 ? -1 : Number(dailyLimit),
        price: Number(price),
        duration_days: Number(durationDays),
        features: features.trim() ? stringToFeatures(features) : null,
      };

      const url = editingPlan ? "/api/admin/plans" : "/api/admin/plans";
      const method = editingPlan ? "PUT" : "POST";
      const body = editingPlan ? { ...payload, id: editingPlan.id } : payload;

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setModalErr(data.error || (isEn ? "Operation failed" : "فشلت العملية"));
        return;
      }

      closeModal();
      loadPlans();
    } catch {
      setModalErr(isEn ? "Connection error" : "خطأ في الاتصال");
    } finally {
      setSaving(false);
    }
  }

  /* =====================================================
     Delete
  ===================================================== */
  async function handleDelete(planId: string, planName: string) {
    if (!confirm(
      isEn
        ? `Are you sure you want to delete "${planName}"?`
        : `هل أنت متأكد من حذف "${planName}"؟`
    )) return;

    try {
      const res = await fetch(`/api/admin/plans?id=${planId}`, {
        method: "DELETE",
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.error || (isEn ? "Delete failed" : "فشل الحذف"));
        return;
      }

      loadPlans();
    } catch {
      alert(isEn ? "Connection error" : "خطأ في الاتصال");
    }
  }

  /* =====================================================
     Render: Loading
  ===================================================== */
  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center" dir={dir}>
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-border border-t-primary" />
      </div>
    );
  }

  /* =====================================================
     Render: Page
  ===================================================== */
  return (
    <div className="mx-auto max-w-5xl px-5 py-8" dir={dir}>
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text">
            {isEn ? "Manage Plans" : "إدارة الخطط"}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {isEn ? "Add, edit, or delete subscription plans" : "إضافة أو تعديل أو حذف باقات الاشتراك"}
          </p>
        </div>

        <button
          onClick={openCreate}
          className="rounded-lg bg-primary px-4 py-2.5 text-xs font-bold text-surface shadow-sm transition hover:brightness-110"
        >
          {isEn ? "+ Add Plan" : "+ إضافة خطة"}
        </button>
      </div>

      {globalErr && (
        <div className="mb-6 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-xs text-red-600">
          {globalErr}
        </div>
      )}

      {/* Plans Table */}
      {plans.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-border py-20 text-center">
          <p className="text-4xl">📦</p>
          <p className="mt-4 text-sm text-muted">
            {isEn ? "No plans yet. Create your first plan!" : "لا توجد خطط بعد. أنشئ أول خطة!"}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-hover">
                <th className="px-4 py-3 text-right text-xs font-semibold text-text-soft">
                  {isEn ? "Name" : "الاسم"}
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-text-soft">
                  {isEn ? "Price" : "السعر"}
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-text-soft">
                  {isEn ? "Duration" : "المدة"}
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-text-soft">
                  {isEn ? "Monthly" : "شهري"}
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-text-soft">
                  {isEn ? "Daily" : "يومي"}
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-text-soft">
                  {isEn ? "Actions" : "إجراءات"}
                </th>
              </tr>
            </thead>

            <tbody>
              {plans.map((plan) => (
                <tr key={plan.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <div>
                      <p className="font-medium text-text">{plan.name}</p>
                      {plan.description && (
                        <p className="mt-0.5 text-xs text-muted">{plan.description}</p>
                      )}
                    </div>
                  </td>

                  <td className="px-4 py-3 text-text">
                    {plan.price === 0
                      ? isEn ? "Free" : "مجاني"
                      : `${plan.price} ${isEn ? "EGP" : "جنيه"}`}
                  </td>

                  <td className="px-4 py-3 text-text">
                    {plan.duration_days} {isEn ? "days" : "يوم"}
                  </td>

                  <td className="px-4 py-3 text-text">
                    {plan.monthly_limit == null
                      ? "—"
                      : plan.monthly_limit === -1
                      ? isEn ? "∞" : "غير محدود"
                      : plan.monthly_limit}
                  </td>

                  <td className="px-4 py-3 text-text">
                    {plan.daily_limit == null
                      ? "—"
                      : plan.daily_limit === -1
                      ? isEn ? "∞" : "غير محدود"
                      : plan.daily_limit}
                  </td>

                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() => openEdit(plan)}
                        className="rounded-md border border-border px-3 py-1.5 text-[11px] font-medium text-text-soft transition hover:bg-surface-hover"
                      >
                        {isEn ? "Edit" : "تعديل"}
                      </button>

                      <button
                        onClick={() => handleDelete(plan.id, plan.name)}
                        className="rounded-md border border-red-200 px-3 py-1.5 text-[11px] font-medium text-red-500 transition hover:bg-red-50"
                      >
                        {isEn ? "Delete" : "حذف"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ========================= Modal ========================= */}
      {showModal && (
        <>
          <div
            className="fixed inset-0 z-50 bg-foreground/20 backdrop-blur-sm"
            onClick={closeModal}
          />

          <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 max-h-[90vh] overflow-y-auto">
            <div className="rounded-xl border border-border bg-surface p-6 shadow-2xl">
              <h3 className="text-base font-bold text-text">
                {editingPlan
                  ? isEn ? "Edit Plan" : "تعديل الخطة"
                  : isEn ? "Add New Plan" : "إضافة خطة جديدة"}
              </h3>

              <div className="mt-5 space-y-4">
                {/* Name */}
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-text-soft">
                    {isEn ? "Plan Name *" : "اسم الخطة *"}
                  </label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
                    placeholder={isEn ? "e.g. Premium" : "مثال: بريميوم"}
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-text-soft">
                    {isEn ? "Description" : "الوصف"}
                  </label>
                  <input
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
                    placeholder={isEn ? "Brief description" : "وصف مختصر"}
                  />
                </div>

                {/* Price & Duration */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-text-soft">
                      {isEn ? "Price (EGP) *" : "السعر (جنيه) *"}
                    </label>
                    <input
                      type="number"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      min="0"
                      className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
                      dir="ltr"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-text-soft">
                      {isEn ? "Duration (days) *" : "المدة (يوم) *"}
                    </label>
                    <input
                      type="number"
                      value={durationDays}
                      onChange={(e) => setDurationDays(e.target.value)}
                      min="1"
                      className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
                      dir="ltr"
                    />
                  </div>
                </div>

                {/* Limits */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-text-soft">
                      {isEn ? "Monthly Limit" : "الحد الشهري"}
                    </label>
                    <input
                      type="number"
                      value={monthlyLimit}
                      onChange={(e) => setMonthlyLimit(e.target.value)}
                      placeholder={isEn ? "-1 for unlimited" : "-1 لغير محدود"}
                      className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
                      dir="ltr"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-text-soft">
                      {isEn ? "Daily Limit" : "الحد اليومي"}
                    </label>
                    <input
                      type="number"
                      value={dailyLimit}
                      onChange={(e) => setDailyLimit(e.target.value)}
                      placeholder={isEn ? "-1 for unlimited" : "-1 لغير محدود"}
                      className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
                      dir="ltr"
                    />
                  </div>
                </div>

                {/* Features */}
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-text-soft">
                    {isEn ? "Features (one per line)" : "المميزات (واحدة في كل سطر)"}
                  </label>
                  <textarea
                    value={features}
                    onChange={(e) => setFeatures(e.target.value)}
                    rows={4}
                    placeholder={
                      isEn
                        ? "Feature 1\nFeature 2\nFeature 3"
                        : "ميزة 1\nميزة 2\nميزة 3"
                    }
                    className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
                    dir="ltr"
                  />
                </div>

                {/* Error */}
                {modalErr && (
                  <p className="text-xs font-medium text-red-500">{modalErr}</p>
                )}

                {/* Buttons */}
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={closeModal}
                    disabled={saving}
                    className="flex-1 rounded-lg border border-border py-2.5 text-xs font-medium text-text-soft transition hover:bg-surface-hover disabled:opacity-50"
                  >
                    {isEn ? "Cancel" : "إلغاء"}
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex-1 rounded-lg bg-primary py-2.5 text-xs font-bold text-surface transition hover:brightness-110 disabled:opacity-50"
                  >
                    {saving
                      ? isEn ? "Saving..." : "جاري الحفظ..."
                      : editingPlan
                      ? isEn ? "Update" : "تحديث"
                      : isEn ? "Create" : "إنشاء"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}