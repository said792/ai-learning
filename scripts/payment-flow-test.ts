/* =========================================================
   اختبار تدفق الدفع الكامل (v2.3) على قاعدة البيانات الحقيقية:
   1) تسجيل مستخدم تجريبي + مستخدم أدمن تجريبي
   2) رفض دفع من غير رقم مرجعي (إلزامي)
   3) طلب دفع أول اشتراك → pending
   4) منع طلب دفع معلق مكرر
   5) موافقة الأدمن → توليد كود تفعيل
   6) (بعد الترقية) منع مستخدم تاني من استخدام الكود المربوط
   7) المستخدم يدخل الكود → اشتراك يعمل
   8) (بعد الترقية) الاشتراك يبدأ من يوم الدفع (anchor)
   9) طلب تجديد → موافقة الأدمن → تجديد فوري تراكمي بدون كود
   10) غير الأدمن ممنوع من لوحة المدفوعات
   11) تنظيف كل بيانات الاختبار من القاعدة

   الوضع يتحقق تلقائيًا:
   - بعد تشغيل sql/03 → اختبارات كاملة (ربط الكود + تثبيت يوم الدفع)
   - قبل تشغيل sql/03 → اختبارات التدفق الأساسية (وضع التدهور المؤقت)
========================================================= */
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

const BASE = "http://localhost:3111";

/* قراءة .env.local يدويًا */
const envText = fs.readFileSync(
  path.join(process.cwd(), ".env.local"),
  "utf-8"
);
const env: Record<string, string> = {};
for (const line of envText.split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);
  if (m) env[m[1]] = m[2];
}

const SUPA_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL || !SUPA_KEY) {
  console.error("❌ متغيرات Supabase مش موجودة في .env.local");
  process.exit(1);
}

const admin = createClient(SUPA_URL, SUPA_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/* أدوات */
function cookieOf(res: Response): string {
  const raw = res.headers.get("set-cookie") || "";
  const token = raw.match(/ai_learning_session=([^;]+)/)?.[1] || "";
  return `ai_learning_session=${token}`;
}

const results: Array<{ name: string; ok: boolean; extra?: string }> = [];
const check = (name: string, ok: boolean, extra = "") => {
  results.push({ name, ok, extra });
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`);
};

const stamp = Date.now().toString(36).toUpperCase();
let userACookie = "";
let adminCookie = "";
let userIdA = "";
let userIdAdmin = "";
let paymentId = "";
let generatedCode = "";
let planId = "";
let planDuration = 0;
let paymentCreatedAt = "";
let migrationApplied = false;

async function registerUser(
  fullName: string
): Promise<{ cookie: string; id: string; username: string }> {
  const username = `t${stamp}${Math.random().toString(36).slice(2, 6)}`;
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fullName,
      username,
      email: `${username}@test.local`,
      password: "Test12345!",
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`register failed: ${JSON.stringify(data)}`);
  const cookie = cookieOf(res);
  /* جلب الـ id من قاعدة البيانات بالـ username */
  const { data: u } = await admin
    .from("users")
    .select("id")
    .eq("username", username)
    .maybeSingle();
  return { cookie, id: u?.id || "", username };
}

async function main() {
  /* ===== 0) الوضع: هل ترقية 03 متطبقة؟ ===== */
  await admin.from("app_settings").delete().eq("key", "payments_auto_approve");
  const { data: autoRow } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", "payments_auto_approve")
    .maybeSingle();
  check("إلغاء الموافقة التلقائية من الإعدادات", !autoRow);

  const { error: rtError } = await admin
    .from("payments")
    .select("request_type")
    .limit(1);
  const { error: bindError } = await admin
    .from("activation_codes")
    .select("bound_user_id")
    .limit(1);
  migrationApplied = !rtError && !bindError;
  console.log(
    migrationApplied
      ? "📋 الوضع: ترقية sql/03 متطبقة → اختبار كامل"
      : "📋 الوضع: ترقية sql/03 مش متطبقة بعد → اختبار أساسي (وضع التدهور)"
  );

  /* ===== 1) الباقات ===== */
  const plansRes = await fetch(`${BASE}/api/plans`);
  const plansData = await plansRes.json();
  const paidPlan = (plansData.plans || []).find(
    (p: { price: number; is_active?: boolean }) => Number(p.price) > 0
  );
  if (!paidPlan) {
    console.error("❌ مفيش باقة مدفوعة في القاعدة للاختبار");
    process.exit(1);
  }
  planId = paidPlan.id;
  planDuration = Number(paidPlan.duration_days) || 30;
  check(
    "يوجد باقة مدفوعة للاختبار",
    true,
    `${paidPlan.name} — ${paidPlan.price} ج — ${planDuration} يوم`
  );

  /* ===== 2) مستخدم عادي + أدمن ===== */
  const userA = await registerUser(`مستخدم تجريبي ${stamp}`);
  userACookie = userA.cookie;
  userIdA = userA.id;

  const userAdmin = await registerUser(`أدمن تجريبي ${stamp}`);
  userIdAdmin = userAdmin.id;
  await admin.from("users").update({ role: "admin" }).eq("id", userIdAdmin);
  const adminLogin = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login: userAdmin.username, password: "Test12345!" }),
  });
  adminCookie = cookieOf(adminLogin);
  check(
    "تسجيل مستخدم + أدمن تجريبي",
    !!userIdA && !!adminCookie && adminLogin.ok
  );

  /* ===== 3) دفع من غير رقم مرجعي → مرفوض ===== */
  const noRefRes = await fetch(`${BASE}/api/payments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: userACookie },
    body: JSON.stringify({ planId, method: "فودافون كاش", reference: "" }),
  });
  const noRefData = await noRefRes.json();
  check(
    "رفض الدفع من غير رقم مرجعي",
    noRefRes.status === 400 && String(noRefData.error || "").includes("المرجع"),
    noRefData.error || ""
  );

  /* ===== 4) طلب دفع صحيح → pending ===== */
  const payRes = await fetch(`${BASE}/api/payments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: userACookie },
    body: JSON.stringify({
      planId,
      method: "فودافون كاش — 01000000000",
      reference: `REF-TEST-${stamp}`,
    }),
  });
  const payData = await payRes.json();
  check(
    "طلب أول اشتراك → pending + رسالة المراجعة",
    payRes.ok &&
      String(payData.message || "").includes("الإدارة") &&
      !payData.autoApproved,
    (payData.message || "").substring(0, 60)
  );

  const { data: payRow } = await admin
    .from("payments")
    .select("id, status, created_at")
    .eq("user_id", userIdA)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  paymentId = payRow?.id || "";
  paymentCreatedAt = payRow?.created_at || "";
  check("الدفعة اتسجلت في القاعدة pending", payRow?.status === "pending");

  /* ===== 5) منع الطلب المكرر ===== */
  const dupRes = await fetch(`${BASE}/api/payments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: userACookie },
    body: JSON.stringify({ planId, method: "x", reference: "REF-DUP" }),
  });
  const dupData = await dupRes.json();
  check(
    "منع طلب دفع معلق مكرر",
    dupRes.status === 400 &&
      String(dupData.error || "").includes("قيد المراجعة"),
    dupData.error || ""
  );

  /* ===== 6) الأدمن يشوف الطلب ===== */
  const adminListRes = await fetch(
    `${BASE}/api/admin/payments?status=pending`,
    { headers: { Cookie: adminCookie } }
  );
  const adminListData = await adminListRes.json();
  const found = (adminListData.payments || []).find(
    (p: { id: string }) => p.id === paymentId
  );
  check(
    "الأدمن يشوف الطلب المعلق بتفاصيله",
    adminListRes.ok && !!found && !!found.users?.full_name,
    found
      ? `${found.users?.full_name} — ${found.amount} ج — ${found.reference}`
      : "not found"
  );

  /* ===== 7) موافقة الأدمن → كود تفعيل ===== */
  const approveRes = await fetch(`${BASE}/api/admin/payments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: adminCookie },
    body: JSON.stringify({ paymentId, decision: "approved" }),
  });
  const approveData = await approveRes.json();
  generatedCode = approveData.code || "";
  check(
    "الموافقة على أول اشتراك → توليد كود تفعيل",
    approveRes.ok && /^AIB-[A-Z0-9]{8}$/.test(generatedCode),
    `${generatedCode} — ${(approveData.message || "").substring(0, 50)}`
  );

  /* ===== 8) فحص الربط والتثبيت (بعد الترقية بس) ===== */
  if (migrationApplied) {
    const { data: codeRow } = await admin
      .from("activation_codes")
      .select("bound_user_id, anchor_date, is_used")
      .eq("code", generatedCode)
      .maybeSingle();
    check(
      "الكود مربوط بالمستخدم + anchor = يوم الدفع",
      codeRow?.bound_user_id === userIdA &&
        !!codeRow?.anchor_date &&
        Math.abs(
          new Date(codeRow.anchor_date).getTime() -
            new Date(paymentCreatedAt).getTime()
        ) < 5000,
      `anchor=${codeRow?.anchor_date}`
    );

    /* مستخدم تاني مش بيعرف يستخدم الكود المربوط */
    const otherUser = await registerUser(`مستخدم تاني ${stamp}`);
    const stealRes = await fetch(`${BASE}/api/subscription`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: otherUser.cookie,
      },
      body: JSON.stringify({ code: generatedCode }),
    });
    const stealData = await stealRes.json();
    check(
      "منع استخدام كود مستخدم تاني",
      stealRes.status === 403 &&
        String(stealData.error || "").includes("مخصص لمستخدم آخر"),
      stealData.error || ""
    );
    /* تنظيف المستخدم الإضافي فورًا */
    await admin.from("users").delete().eq("id", otherUser.id);
  }

  /* ===== 9) المستخدم يدخل الكود → اشتراك يعمل ===== */
  await new Promise((r) => setTimeout(r, 1200));
  const redeemRes = await fetch(`${BASE}/api/subscription`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: userACookie },
    body: JSON.stringify({ code: generatedCode }),
  });
  const redeemData = await redeemRes.json();
  check(
    "تفعيل الكود من صاحبه",
    redeemRes.ok && redeemData.success === true,
    (redeemData.message || JSON.stringify(redeemData)).substring(0, 60)
  );

  const subRes = await fetch(`${BASE}/api/subscription`, {
    headers: { Cookie: userACookie },
  });
  const subData = await subRes.json();
  const endDate = new Date(subData.subscription?.endDate || 0);
  check(
    "الاشتراك بقى مدفوع ساري",
    Number(subData.plan?.price) > 0 && endDate.getTime() > Date.now(),
    `${subData.plan?.name} — ينتهي ${endDate.toISOString().substring(0, 10)}`
  );

  /* تثبيت يوم الدفع (بعد الترقية بس — الكود شايل anchor_date) */
  if (migrationApplied) {
    const expectedEnd = new Date(
      new Date(paymentCreatedAt).getTime() + planDuration * 86400000
    );
    const anchorOk =
      Math.abs(endDate.getTime() - expectedEnd.getTime()) < 60000 &&
      endDate.getTime() <
        Date.now() + planDuration * 86400000 - 86400000 * 0.9;
    check(
      "الاشتراك بيبدأ من يوم الدفع (مش يوم إدخال الكود)",
      anchorOk,
      `الدفع: ${paymentCreatedAt.substring(0, 10)} → النهاية: ${endDate
        .toISOString()
        .substring(0, 10)} (متوقع ${expectedEnd.toISOString().substring(0, 10)})`
    );
  }

  /* ===== 10) طلب تجديد → موافقة → تجديد فوري تراكمي بدون كود ===== */
  const beforeEnd = endDate.getTime();
  const renewRes = await fetch(`${BASE}/api/payments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: userACookie },
    body: JSON.stringify({
      planId,
      method: "إنستاباي",
      reference: `RENEW-TEST-${stamp}`,
    }),
  });
  const renewData = await renewRes.json();
  check(
    "طلب التجديد اتحط pending",
    renewRes.ok && String(renewData.message || "").includes("تجديد"),
    (renewData.message || "").substring(0, 60)
  );

  const { data: renewRow } = await admin
    .from("payments")
    .select("id")
    .eq("user_id", userIdA)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const renewApproveRes = await fetch(`${BASE}/api/admin/payments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: adminCookie },
    body: JSON.stringify({ paymentId: renewRow?.id, decision: "approved" }),
  });
  const renewApproveData = await renewApproveRes.json();
  check(
    "موافقة التجديد → فوري بدون كود",
    renewApproveRes.ok &&
      !renewApproveData.code &&
      String(renewApproveData.message || "").includes("تم تجديد"),
    (renewApproveData.message || "").substring(0, 70)
  );

  const sub2Res = await fetch(`${BASE}/api/subscription`, {
    headers: { Cookie: userACookie },
  });
  const sub2Data = await sub2Res.json();
  const newEnd = new Date(sub2Data.subscription?.endDate || 0).getTime();
  const expectedNewEnd = beforeEnd + planDuration * 86400000;
  check(
    "التجديد تراكمي فوق المتبقي",
    Math.abs(newEnd - expectedNewEnd) < 60000,
    `قبل: ${new Date(beforeEnd).toISOString().substring(0, 10)} → بعد: ${sub2Data.subscription?.endDate?.substring(0, 10)}`
  );

  /* ===== 11) غير الأدمن مش بيشوف لوحة الأدمن ===== */
  const forbiddenRes = await fetch(`${BASE}/api/admin/payments`, {
    headers: { Cookie: userACookie },
  });
  check("غير الأدمن ممنوع من لوحة المدفوعات", forbiddenRes.status === 403);

  /* ===== 12) تنظيف بيانات الاختبار ===== */
  const ids = [userIdA, userIdAdmin].filter(Boolean);
  for (const uid of ids) {
    await admin.from("subscriptions").delete().eq("user_id", uid);
    await admin.from("payments").delete().eq("user_id", uid);
    await admin.from("activation_codes").delete().eq("bound_user_id", uid);
    await admin.from("auth_sessions").delete().eq("user_id", uid);
    await admin.from("usage").delete().eq("user_id", uid);
    await admin.from("users").delete().eq("id", uid);
  }
  /* كود بدون ربط (وضع التدهور) — يمسح بالكود نفسه */
  if (generatedCode) {
    await admin.from("activation_codes").delete().eq("code", generatedCode);
  }
  check("تنظيف بيانات الاختبار", true, `${ids.length} مستخدمين`);

  const passed = results.filter((r) => r.ok).length;
  console.log(
    `\n===== النتيجة: ${passed}/${results.length} اختبارات ناجحة =====`
  );
  if (passed < results.length) process.exit(1);
}

main().catch((e) => {
  console.error("TEST CRASH:", e);
  process.exit(1);
});
