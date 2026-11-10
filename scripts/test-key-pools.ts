/* =========================================================
   اختبار نظام برجَي المفاتيح (مجاني / مدفوع) — v2.3.2
   يشغّل: npx tsx scripts/test-key-pools.ts

   يتحقق من:
   1) البرج المجاني هو المستخدم افتراضيًا (free tier)
   2) المجاني لا يلمس مفاتيح المدفوعين أبدًا
   3) المدفوع يبدأ بالبرج المدفوع ثم يرجع للمجاني كملجأ
   4) بدون مفاتيح مدفوعة → المدفوع يعمل على المجاني (توافق كامل)
   5) الدوران اللاصق لكل برج منفصل عن الآخر
========================================================= */

import {
  getGeminiKeys,
  hasPaidKeys,
  withKeyRotation,
} from "../lib/ai/gemini";

/* أدوات مساعدة */
let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.error(`  ❌ ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

function section(title: string) {
  console.log(`\n━━ ${title} ━━`);
}

/* تنظيف البيئة قبل الاختبار */
function cleanEnv() {
  const envKeys = Object.keys(process.env).filter(
    (k) => k.startsWith("GEMINI_API_KEY") || k.startsWith("GEMINI_PAID_API_KEY")
  );
  for (const k of envKeys) delete process.env[k];
}

async function main() {
/* =========================================================
   1) قراءة البرجين من البيئة
========================================================= */
section("1) قراءة البرجين من .env");

cleanEnv();
process.env.GEMINI_API_KEY_1 = "FREE_A";
process.env.GEMINI_API_KEY_2 = "FREE_B";
process.env.GEMINI_PAID_API_KEY_1 = "PAID_X";
process.env.GEMINI_PAID_API_KEY_2 = "PAID_Y";
process.env.GEMINI_PAID_API_KEY_3 = "PAID_Z";

const free = getGeminiKeys("free");
const paid = getGeminiKeys("paid");

check("برج المجانيين = [FREE_A, FREE_B]", JSON.stringify(free) === '["FREE_A","FREE_B"]', JSON.stringify(free));
check("برج المدفوعين = [PAID_X, PAID_Y, PAID_Z]", JSON.stringify(paid) === '["PAID_X","PAID_Y","PAID_Z"]', JSON.stringify(paid));
check("getGeminiKeys() بدون وسيط = برج المجانيين (توافق خلفي)", JSON.stringify(getGeminiKeys()) === JSON.stringify(free));
check("hasPaidKeys() = true", hasPaidKeys() === true);

/* =========================================================
   2) التير المجاني لا يلمس مفاتيح المدفوعين
========================================================= */
section("2) tier=free → البرج المجاني فقط");

const usedFree: string[] = [];
const resultFree = await withKeyRotation(async (_c, apiKey) => {
  usedFree.push(apiKey);
  return "ok-free";
}, { tier: "free" });

check("نجحت المهمة", resultFree === "ok-free");
check("استُخدم مفتاح من المجاني فقط", usedFree.length === 1 && usedFree[0].startsWith("FREE_"), JSON.stringify(usedFree));
check("صفر استخدام لمفاتيح المدفوعين", usedFree.every((k) => !k.startsWith("PAID_")));

/* =========================================================
   3) التير المدفوع يبدأ بالبرج المدفوع
========================================================= */
section("3) tier=paid → البرج المدفوع أولًا");

const usedPaid: string[] = [];
const resultPaid = await withKeyRotation(async (_c, apiKey) => {
  usedPaid.push(apiKey);
  return "ok-paid";
}, { tier: "paid" });

check("نجحت المهمة", resultPaid === "ok-paid");
check("استُخدم مفتاح مدفوع أولًا", usedPaid.length === 1 && usedPaid[0].startsWith("PAID_"), JSON.stringify(usedPaid));

/* =========================================================
   4) الملجأ: كل مفاتيح المدفوعين 429 → يرجع للمجاني
========================================================= */
section("4) tier=paid + فشل البرج المدفوع كله → ملجأ مجاني");

const touched: string[] = [];
const resultFallback = await withKeyRotation(async (_c, apiKey) => {
  touched.push(apiKey);
  if (apiKey.startsWith("PAID_")) {
    throw new Error("429 RESOURCE_EXHAUSTED quota exceeded");
  }
  return "ok-fallback";
}, {
  tier: "paid",
  retriesPerKey: 1,
  baseDelayMs: 1,
});

check("نجحت المهمة عبر الملجأ", resultFallback === "ok-fallback");
check("جرّب مفاتيح المدفوعين الثلاثة أولًا", touched.filter((k) => k.startsWith("PAID_")).length === 3, JSON.stringify(touched));
check("ثم نجح على مفتاح مجاني", touched[touched.length - 1].startsWith("FREE_"), JSON.stringify(touched));

/* =========================================================
   5) بدون مفاتيح مدفوعة → المدفوع يعمل على المجاني
========================================================= */
section("5) tier=paid بدون مفاتيح مدفوعة → تشغيل عادي على المجاني");

delete process.env.GEMINI_PAID_API_KEY_1;
delete process.env.GEMINI_PAID_API_KEY_2;
delete process.env.GEMINI_PAID_API_KEY_3;
check("hasPaidKeys() = false بعد المسح", hasPaidKeys() === false);

const usedNoPaid: string[] = [];
const resultNoPaid = await withKeyRotation(async (_c, apiKey) => {
  usedNoPaid.push(apiKey);
  return "ok-no-paid";
}, { tier: "paid" });

check("نجحت المهمة بدون أي دروج", resultNoPaid === "ok-no-paid");
check("اتخدم مفتاح مجاني", usedNoPaid.length === 1 && usedNoPaid[0].startsWith("FREE_"), JSON.stringify(usedNoPaid));

/* =========================================================
   6) الدوران اللاصق منفصل لكل برج
========================================================= */
section("6) الدوران اللاصق منفصل لكل برج");

process.env.GEMINI_PAID_API_KEY_1 = "PAID_X";
process.env.GEMINI_PAID_API_KEY_2 = "PAID_Y";

const order: string[] = [];
for (let i = 0; i < 3; i++) {
  await withKeyRotation(async (_c, apiKey) => {
    order.push(apiKey);
    return "ok";
  }, { tier: "paid" });
}

check(
  "3 نداءات مدفوعة تتناوب على مفاتيح المدفوعين (sticky rotation — البداية من موضع المؤشر الحالي)",
  order.length === 3 &&
    order.every((k) => k.startsWith("PAID_")) &&
    order[0] !== order[1] &&
    order[1] !== order[2] &&
    order[0] === order[2],
  JSON.stringify(order)
);

/* =========================================================
   النتيجة
========================================================= */
console.log(`\n${"═".repeat(50)}`);
console.log(`النتيجة: ${passed} نجح / ${failed} فشل`);
console.log(failed === 0 ? "🎉 كل اختبارات برجَي المفاتيح سليمة" : "⚠️ فيه اختبارات فاشلة — راجع فوق");
process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("فشل تشغيل الاختبار:", e);
  process.exit(1);
});
