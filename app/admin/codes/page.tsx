"use client";

import { useState, useEffect, useCallback } from "react";
import { useLanguage } from "../../context/LanguageContext";

/* =========================================================
   Types
========================================================= */

interface PlanOption {
  id: string;
  name: string;
  price: number;
  duration_days: number;
}

interface CodeRecord {
  id: string;
  code: string;
  is_used: boolean;
  used_at: string | null;
  created_at: string;
  used_by: string | null;
  plans: PlanOption | null;
  users: {
    id: string;
    full_name: string | null;
    username: string | null;
    phone: string | null;
    email: string | null;
  } | null;
}

/* =========================================================
   Page
========================================================= */

export default function AdminCodesPage() {
  const { lang, dir } = useLanguage();
  const isEn = lang === "en";

  const [codes, setCodes] = useState<CodeRecord[]>([]);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [loading, setLoading] = useState(true);

  /* Filters */
  const [filterPlan, setFilterPlan] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  /* Create Form */
  const [showCreate, setShowCreate] = useState(false);
  const [createPlanId, setCreatePlanId] = useState("");
  const [createCount, setCreateCount] = useState("1");
  const [createPrefix, setCreatePrefix] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  /* Generated Codes (لعرضها بعد الإنشاء) */
  const [generatedCodes, setGeneratedCodes] =
    useState<string[]>([]);
  const [showGenerated, setShowGenerated] =
    useState(false);

  /* Copy Feedback */
  const [copiedId, setCopiedId] = useState<string | null>(
    null
  );
  const [copiedAll, setCopiedAll] = useState(false);

  /* =====================================================
     Load Plans
  ===================================================== */

  useEffect(() => {
    fetch("/api/plans")
      .then((r) => r.json())
      .then((d) => setPlans(d.plans || []))
      .catch(() => {});
  }, []);

  /* =====================================================
     Load Codes
  ===================================================== */

  const loadCodes = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterPlan) params.set("planId", filterPlan);
      if (filterStatus)
        params.set("status", filterStatus);

      const res = await fetch(
        `/api/admin/codes?${params.toString()}`
      );

      if (res.status === 403) {
        setCodes([]);
        setLoading(false);
        return;
      }

      const data = await res.json();
      setCodes(data.codes || []);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, [filterPlan, filterStatus]);

  useEffect(() => {
    loadCodes();
  }, [loadCodes]);

  /* =====================================================
     Create Codes
  ===================================================== */

  async function handleCreate() {
    if (!createPlanId) {
      setCreateError("اختر الباقة");
      return;
    }

    setCreating(true);
    setCreateError("");

    try {
      const res = await fetch("/api/admin/codes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          planId: createPlanId,
          count: Number(createCount) || 1,
          prefix: createPrefix,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setCreateError(data.error || "فشل الإنشاء");
        return;
      }

      setGeneratedCodes(data.generatedCodes || []);
      setShowGenerated(true);
      setShowCreate(false);
      setCreatePlanId("");
      setCreateCount("1");
      setCreatePrefix("");
      loadCodes();
    } catch {
      setCreateError("خطأ في الاتصال");
    } finally {
      setCreating(false);
    }
  }

  /* =====================================================
     Copy Helpers
  ===================================================== */

  async function copyCode(code: string, id: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      /* fallback */
      const ta = document.createElement("textarea");
      ta.value = code;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  }

  async function copyAllGenerated() {
    const text = generatedCodes.join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2000);
    }
  }

  /* =====================================================
     Helpers
  ===================================================== */

  function formatDate(d: string) {
    return new Date(d).toLocaleDateString(
      isEn ? "en-US" : "ar-EG",
      {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }
    );
  }

  function getPlanName(code: CodeRecord) {
    return (code.plans as PlanOption)?.name || "—";
  }

  function getUserDisplay(code: CodeRecord) {
    if (!code.users) return "—";
    const u = code.users;
    return (
      u.full_name ||
      u.username ||
      u.phone ||
      u.email ||
      u.id
    );
  }

  const availableCount = codes.filter(
    (c) => !c.is_used
  ).length;
  const usedCount = codes.filter((c) => c.is_used).length;

  /* =====================================================
     Render
  ===================================================== */

  return (
    <div
      className="mx-auto max-w-5xl px-5 py-8"
      dir={dir}
    >
      {/* ========================= Header ========================= */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text">
            {isEn
              ? "Activation Codes"
              : "كودات التفعيل"}
          </h1>
          <p className="mt-1 text-xs text-muted">
            {isEn
              ? "Create and manage activation codes"
              : "إنشاء وإدارة كودات التفعيل"}
          </p>
        </div>

        <button
          onClick={() => setShowCreate(!showCreate)}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-bold text-surface shadow-sm transition hover:brightness-110"
        >
          <svg
            className="h-3.5 w-3.5"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 4.5v15m7.5-7.5h-15"
            />
          </svg>
          {isEn ? "Create Codes" : "إنشاء كودات"}
        </button>
      </div>

      {/* ========================= Stats ========================= */}
      <div className="mb-6 grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-border bg-surface p-4 text-center">
          <p className="text-2xl font-black text-text">
            {codes.length}
          </p>
          <p className="mt-1 text-[11px] text-muted">
            {isEn ? "Total" : "الإجمالي"}
          </p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center">
          <p className="text-2xl font-black text-emerald-700">
            {availableCount}
          </p>
          <p className="mt-1 text-[11px] text-emerald-600">
            {isEn ? "Available" : "متاح"}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center">
          <p className="text-2xl font-black text-slate-500">
            {usedCount}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            {isEn ? "Used" : "مُستخدم"}
          </p>
        </div>
      </div>

      {/* ========================= Create Form ========================= */}
      {showCreate && (
        <div className="mb-6 rounded-xl border border-primary/20 bg-primary/5 p-5">
          <h3 className="mb-4 text-sm font-bold text-text">
            {isEn
              ? "Generate New Codes"
              : "توليد كودات جديدة"}
          </h3>

          <div className="grid gap-4 sm:grid-cols-3">
            {/* Plan Select */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-text-soft">
                {isEn ? "Plan" : "الباقة"}
              </label>
              <select
                value={createPlanId}
                onChange={(e) =>
                  setCreatePlanId(e.target.value)
                }
                className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-xs outline-none focus:border-primary"
              >
                <option value="">
                  {isEn
                    ? "Choose a plan..."
                    : "اختر باقة..."}
                </option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{" "}
                    {p.price === 0
                      ? isEn
                        ? "(Free)"
                        : "(مجاني)"
                      : `(${p.price} ${isEn ? "EGP" : "جنيه"})`}
                  </option>
                ))}
              </select>
            </div>

            {/* Count */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-text-soft">
                {isEn ? "Count" : "العدد"}
              </label>
              <input
                type="number"
                value={createCount}
                onChange={(e) =>
                  setCreateCount(e.target.value)
                }
                min="1"
                max="100"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-xs outline-none focus:border-primary"
                dir="ltr"
              />
            </div>

            {/* Prefix */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-text-soft">
                {isEn
                  ? "Prefix (optional)"
                  : "بادئة (اختياري)"}
              </label>
              <input
                value={createPrefix}
                onChange={(e) =>
                  setCreatePrefix(e.target.value)
                }
                placeholder={
                  isEn ? "e.g. STUDENT" : "مثال: STUDENT"
                }
                maxLength={15}
                dir="ltr"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-xs outline-none focus:border-primary"
              />
            </div>
          </div>

          {createError && (
            <p className="mt-3 text-xs font-medium text-red-500">
              {createError}
            </p>
          )}

          <div className="mt-4 flex gap-3">
            <button
              onClick={handleCreate}
              disabled={creating || !createPlanId}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-xs font-bold text-surface transition hover:brightness-110 disabled:opacity-50"
            >
              {creating
                ? isEn
                  ? "Generating..."
                  : "جاري التوليد..."
                : isEn
                ? "Generate"
                : "توليد"}
            </button>
            <button
              onClick={() => {
                setShowCreate(false);
                setCreateError("");
              }}
              className="rounded-lg border border-border px-5 py-2.5 text-xs font-medium text-text-soft transition hover:bg-surface-hover"
            >
              {isEn ? "Cancel" : "إلغاء"}
            </button>
          </div>
        </div>
      )}

      {/* ========================= Generated Codes Modal ========================= */}
      {showGenerated && (
        <>
          <div
            className="fixed inset-0 z-50 bg-foreground/20 backdrop-blur-sm"
            onClick={() => setShowGenerated(false)}
          />
          <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2">
            <div className="rounded-xl border border-border bg-surface p-6 shadow-2xl">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-bold text-text">
                  {isEn
                    ? "Generated Codes"
                    : "الكودات المُولّدة"}
                </h3>
                <button
                  onClick={() => setShowGenerated(false)}
                  className="text-muted hover:text-text"
                >
                  ✕
                </button>
              </div>

              <div className="max-h-60 overflow-auto rounded-lg bg-background p-3">
                {generatedCodes.map((code, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between border-b border-border py-2 last:border-0"
                  >
                    <span
                      className="font-mono text-xs font-bold text-text"
                      dir="ltr"
                    >
                      {code}
                    </span>
                    <button
                      onClick={() =>
                        copyCode(code, `gen-${i}`)
                      }
                      className="text-[10px] font-medium text-primary hover:underline"
                    >
                      {copiedId === `gen-${i}`
                        ? isEn
                          ? "Copied!"
                          : "تم النسخ!"
                        : isEn
                        ? "Copy"
                        : "نسخ"}
                    </button>
                  </div>
                ))}
              </div>

              <button
                onClick={copyAllGenerated}
                className="mt-4 w-full rounded-lg bg-primary py-2.5 text-xs font-bold text-surface transition hover:brightness-110"
              >
                {copiedAll
                  ? isEn
                    ? "All Copied!"
                    : "تم نسخ الكل!"
                  : isEn
                  ? "Copy All Codes"
                  : "نسخ كل الكودات"}
              </button>

              <p className="mt-3 text-center text-[10px] text-muted">
                {isEn
                  ? "Send these codes to users via WhatsApp, SMS, etc."
                  : "أرسل هذه الكودات للمستخدمين عبر واتساب أو رسائل وغيرها"}
              </p>
            </div>
          </div>
        </>
      )}

      {/* ========================= Filters ========================= */}
      <div className="mb-4 flex flex-wrap gap-3">
        <select
          value={filterPlan}
          onChange={(e) => setFilterPlan(e.target.value)}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-xs outline-none focus:border-primary"
        >
          <option value="">
            {isEn ? "All Plans" : "كل الباقات"}
          </option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <select
          value={filterStatus}
          onChange={(e) =>
            setFilterStatus(e.target.value)
          }
          className="rounded-lg border border-border bg-surface px-3 py-2 text-xs outline-none focus:border-primary"
        >
          <option value="">
            {isEn ? "All Status" : "كل الحالات"}
          </option>
          <option value="available">
            {isEn ? "Available" : "متاح"}
          </option>
          <option value="used">
            {isEn ? "Used" : "مُستخدم"}
          </option>
        </select>
      </div>

      {/* ========================= Codes Table ========================= */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="h-7 w-7 animate-spin rounded-full border-4 border-border border-t-primary" />
        </div>
      ) : codes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-4xl">🔑</p>
          <p className="mt-4 text-sm text-muted">
            {isEn
              ? "No codes found"
              : "لا توجد كودات"}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          {/* Desktop Table */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-surface-soft">
                  <th className="px-4 py-3 text-right font-semibold text-muted">
                    {isEn ? "Code" : "الكود"}
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-muted">
                    {isEn ? "Plan" : "الباقة"}
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-muted">
                    {isEn ? "Status" : "الحالة"}
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-muted">
                    {isEn ? "Used By" : "استخدمه"}
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-muted">
                    {isEn ? "Created" : "التاريخ"}
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-muted">
                    {isEn ? "Action" : "إجراء"}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {codes.map((code) => (
                  <tr
                    key={code.id}
                    className="hover:bg-surface-hover transition"
                  >
                    <td className="px-4 py-3">
                      <span
                        className="font-mono text-xs font-bold text-text"
                        dir="ltr"
                      >
                        {code.code}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-text-soft">
                      {getPlanName(code)}
                    </td>
                    <td className="px-4 py-3">
                      {code.is_used ? (
                        <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                          {isEn ? "Used" : "مُستخدم"}
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-600">
                          {isEn ? "Available" : "متاح"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-text-soft">
                      {code.is_used
                        ? getUserDisplay(code)
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {formatDate(code.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      {!code.is_used && (
                        <button
                          onClick={() =>
                            copyCode(code.code, code.id)
                          }
                          className="font-medium text-primary hover:underline"
                        >
                          {copiedId === code.id
                            ? isEn
                              ? "Copied!"
                              : "تم!"
                            : isEn
                            ? "Copy"
                            : "نسخ"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="space-y-3 p-3 sm:hidden">
            {codes.map((code) => (
              <div
                key={code.id}
                className="rounded-lg border border-border bg-surface p-3"
              >
                <div className="flex items-center justify-between">
                  <span
                    className="font-mono text-xs font-bold text-text"
                    dir="ltr"
                  >
                    {code.code}
                  </span>
                  {code.is_used ? (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                      {isEn ? "Used" : "مُستخدم"}
                    </span>
                  ) : (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-600">
                      {isEn ? "Available" : "متاح"}
                    </span>
                  )}
                </div>

                <div className="mt-2 flex items-center justify-between text-[11px] text-muted">
                  <span>{getPlanName(code)}</span>
                  <span>{formatDate(code.created_at)}</span>
                </div>

                {code.is_used && (
                  <p className="mt-1.5 text-[11px] text-text-soft">
                    {isEn ? "Used by" : "استخدمه"}:{" "}
                    {getUserDisplay(code)}
                  </p>
                )}

                {!code.is_used && (
                  <button
                    onClick={() =>
                      copyCode(code.code, code.id)
                    }
                    className="mt-2 w-full rounded-lg border border-border py-1.5 text-[11px] font-medium text-primary transition hover:bg-surface-hover"
                  >
                    {copiedId === code.id
                      ? isEn
                        ? "Copied!"
                        : "تم النسخ!"
                      : isEn
                      ? "Copy Code"
                      : "نسخ الكود"}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}