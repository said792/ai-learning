import { supabaseAdmin } from "@/lib/supabaseAdmin";

/* =========================================================
   مكتبة الاشتراكات الموحدة — منطق التفعيل والقراءة المشترك بين:
   - كود التفعيل (POST /api/subscription)
   - الدفع (POST /api/payments)
   - موافقة الأدمن على دفعة (POST /api/admin/payments)
   - ضمان الخطة المجانية لكل مستخدم (register + upload + backfill)

   النموذج:
   - كل مستخدم ليه اشتراك مجاني مدى الحياة بيتتفعل تلقائيًا
   - لما يشترك في باقة مدفوعة: اشتراك مدفوع جديد من النهاردة
     (مش بيتمسح المجاني — بيفضل موجود كشبكة أمان)
   - الاشتراك الفعّال = الباقة المدفوعة السارية لو موجودة،
     وإلا الخطة المجانية → يعني بعد انتهاء المدفوع بيرجع للمجاني تلقائيًا
   - التجديد التراكمي (الأيام فوق المتبقي) بين الباقات المدفوعة فقط —
     الانتقال من المجاني للمدفوع يبدأ من النهاردة (مش فوق الـ 100 سنة!)
========================================================= */

export type PlanRecord = {
  id: string;
  name: string;
  price: number | string;
  duration_days: number;
};

export type ActivationResult = {
  renewed: boolean;
  endDate: string;
  daysAdded: number;
  daysRemaining: number;
  subscriptionId: string | null;
};

/* ---------- إعدادات التطبيق (app_settings) ---------- */

/** قراءة إعداد من app_settings */
export async function getSetting(key: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();

  return data?.value ?? null;
}

/** كتابة إعداد في app_settings */
export async function setSetting(
  key: string,
  value: string
): Promise<void> {
  await supabaseAdmin
    .from("app_settings")
    .upsert(
      { key, value, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );
}

/* ملاحظة: الموافقة التلقائية على الدفعات أتلغت نهائيًا —
   كل دفعة بتستنى مراجعة الأدمن (أول اشتراك → كود تفعيل، تجديد → تفعيل فوري) */

/* ---------- توافق الترقية (sql/03) ----------
   لو الكود اتحدث قبل تشغيل sql/03 في Supabase — التطبيق شغال عادي
   مع تدهور بسيط، وأول ما الـ SQL يتشغل كل الميزات بتتفتح تلقائيًا:
   - أعمدة الترقية مش موجودة؟ من غير تثبيت يوم الدفع على الكود
     ومن غير حفظ نوع الطلب (بيتحسب وقت الموافقة) */

const migrationSupport: {
  paymentsRequestType?: boolean;
  codeBinding?: boolean;
} = {};

/** هل عمود request_type موجود في جدول payments؟ (ترقية 03) */
export async function paymentsHaveRequestType(): Promise<boolean> {
  if (migrationSupport.paymentsRequestType !== undefined) {
    return migrationSupport.paymentsRequestType;
  }
  const { error } = await supabaseAdmin
    .from("payments")
    .select("request_type")
    .limit(1);
  migrationSupport.paymentsRequestType = !error;
  return migrationSupport.paymentsRequestType;
}

/** هل أعمدة ربط الكود (bound_user_id/anchor_date) موجودة؟ (ترقية 03) */
export async function codesHaveBinding(): Promise<boolean> {
  if (migrationSupport.codeBinding !== undefined) {
    return migrationSupport.codeBinding;
  }
  const { error } = await supabaseAdmin
    .from("activation_codes")
    .select("bound_user_id")
    .limit(1);
  migrationSupport.codeBinding = !error;
  return migrationSupport.codeBinding;
}

/* ---------- الخطة المجانية ---------- */

/**
 * ضمان وجود خطة مجانية — لو مش موجودة نعملها.
 * بترجع الخطة المجانية (سعرها 0) بمدى الحياة.
 */
export async function ensureFreePlan(): Promise<PlanRecord> {
  const { data: existing } = await supabaseAdmin
    .from("plans")
    .select("id, name, price, duration_days")
    .eq("price", 0)
    .limit(1)
    .maybeSingle();

  if (existing) return existing as PlanRecord;

  const { data: created, error } = await supabaseAdmin
    .from("plans")
    .insert({
      name: "المجانية",
      description:
        "خطة مجانية مدى الحياة — تحليل الملفات والأسئلة بشروط يومية، ومن غير دروس صوت/فيديو",
      daily_limit: 10,
      monthly_limit: 100,
      tts_daily_limit: 0,
      video_daily_limit: 0,
      price: 0,
      duration_days: 36500,
      features: [
        "تحليل 10 ملفات يومياً",
        "100 ملف شهرياً",
        "أسئلة ومحادثة مع الذكاء الاصطناعي",
        "مكتبة ملفات وفولدرات",
        "مدى الحياة بدون تفعيل",
      ],
    })
    .select("id, name, price, duration_days")
    .single();

  if (error || !created) {
    throw new Error("فشل إنشاء الخطة المجانية");
  }

  return created as PlanRecord;
}

/**
 * ضمان أن المستخدم عنده اشتراك ساري على الخطة المجانية
 * (شبكة الأمان — بتتفعل حتى لو عنده اشتراك مدفوع ساري)
 */
export async function ensureFreeSubscription(userId: string): Promise<void> {
  const freePlan = await ensureFreePlan();

  const { data: existingFreeSub } = await supabaseAdmin
    .from("subscriptions")
    .select("id")
    .eq("user_id", userId)
    .eq("plan_id", freePlan.id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (existingFreeSub) return;

  const end = new Date();
  end.setDate(end.getDate() + Math.max(Number(freePlan.duration_days) || 36500, 30));

  await supabaseAdmin.from("subscriptions").insert({
    user_id: userId,
    plan_id: freePlan.id,
    start_date: new Date().toISOString(),
    end_date: end.toISOString(),
    status: "active",
  });
}

/* ---------- الاشتراك الفعّال ---------- */

/** اختيار الاشتراك الفعّال: المدفوع الساري لو موجود، وإلا المجاني */
export function pickEffectiveSubscription<
  T extends { end_date: string; plans?: unknown }
>(subs: T[]): T | null {
  const planOf = (s: T): { price?: number | string } | null => {
    const p = Array.isArray(s.plans) ? (s.plans as unknown[])[0] : s.plans;
    return (p as { price?: number | string } | null) ?? null;
  };

  const paid = subs.filter((s) => Number(planOf(s)?.price ?? 0) > 0);
  const pool = paid.length > 0 ? paid : subs;

  return (
    [...pool].sort(
      (a, b) => new Date(b.end_date).getTime() - new Date(a.end_date).getTime()
    )[0] ?? null
  );
}

/**
 * جلب الاشتراك الفعّال للمستخدم:
 * الباقة المدفوعة السارية (لو أكتر من واحدة: الأحدث انتهاءً)،
 * وإلا الخطة المجانية، وإلا null.
 * select = أعمدة subscriptions + العش المطلوب من plans
 * مثال: "id, start_date, end_date, plans ( id, name, price )"
 */
export async function getEffectiveSubscription(
  userId: string,
  select: string
): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabaseAdmin
    .from("subscriptions")
    .select(select)
    .eq("user_id", userId)
    .eq("status", "active")
    .gt("end_date", new Date().toISOString())
    .order("end_date", { ascending: false })
    .limit(10);

  if (error) {
    console.error("[Subscription] Lookup error:", error);
    throw new Error("تعذر التحقق من الاشتراك");
  }

  if (!data || data.length === 0) return null;

  return pickEffectiveSubscription(
    data as unknown as Array<{ end_date: string; plans?: unknown }>
  );
}

/* ---------- نوع طلب الدفع ---------- */

/**
 * تحديد نوع طلب الدفع: أول اشتراك (new) أم تجديد (renewal)
 * - لو عنده أي دفعة معتمدة قبل كده → تجديد
 * - أو أي اشتراك سابق على باقة مدفوعة (حتى لو خلص) → تجديد
 * - غير كده → أول اشتراك (التأكيد هيكون بكود تفعيل من الإدارة)
 */
export async function getPaymentRequestType(
  userId: string
): Promise<"new" | "renewal"> {
  const { count: approvedCount } = await supabaseAdmin
    .from("payments")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "approved");

  if ((approvedCount ?? 0) > 0) return "renewal";

  const { data: subs } = await supabaseAdmin
    .from("subscriptions")
    .select("id, plans ( price )")
    .eq("user_id", userId)
    .limit(50);

  const hadPaidSub = (subs || []).some((s: { plans: unknown }) => {
    const p = Array.isArray(s.plans) ? (s.plans as unknown[])[0] : s.plans;
    return Number((p as { price?: number | string } | null)?.price ?? 0) > 0;
  });

  return hadPaidSub ? "renewal" : "new";
}

/* ---------- توليد كود تفعيل مربوط ---------- */

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * توليد كود تفعيل بعد موافقة الأدمن على دفعة "أول اشتراك":
 * - مربوط بمستخدم محدد (مينفعش حد تاني يستخدمه)
 * - بيحمل يوم بداية الاشتراك (يوم الدفع نفسه) —
 *   فلما المستخدم يدخله، المدة بتتحسب من يوم ما أكد الدفع مش من يوم إدخال الكود
 */
export async function generateActivationCode(input: {
  planId: string;
  boundUserId: string;
  paymentId?: string | null;
  anchorDate?: string | Date | null;
}): Promise<string> {
  /* لو ترقية 03 متشغلتش — ننشئ كود عادي من غير ربط (تدهور مؤقت) */
  const binding = await codesHaveBinding();

  for (let attempt = 0; attempt < 5; attempt++) {
    let code = "AIB-";
    for (let i = 0; i < 8; i++) {
      code += CODE_CHARS.charAt(Math.floor(Math.random() * CODE_CHARS.length));
    }

    const payload: Record<string, unknown> = {
      code,
      plan_id: input.planId,
    };

    if (binding) {
      payload.bound_user_id = input.boundUserId;
      payload.payment_id = input.paymentId ?? null;
      payload.anchor_date = input.anchorDate
        ? new Date(input.anchorDate).toISOString()
        : null;
    }

    const { error } = await supabaseAdmin
      .from("activation_codes")
      .insert(payload);

    if (!error) return code;

    /* تكرار في الكود (نادر جدًا) → جرب تاني */
    if (error.code !== "23505") {
      console.error("[Subscription] Code generation error:", error);
      throw new Error("فشل إنشاء كود التفعيل");
    }
  }

  throw new Error("فشل إنشاء كود التفعيل — حاول تاني");
}

/* ---------- التفعيل / التجديد ---------- */

/**
 * تفعيل/تجديد اشتراك على باقة — المنطق الموحد:
 * - اشتراك مدفوع ساري → تجديد تراكمي: المدة بتتزاد على المتبقي (مش بيفقد يوم)
 * - خطة مجانية أو مفيش → اشتراك مدفوع جديد
 * - opts.anchorDate = يوم الدفع (لما المستخدم بعت الرقم المرجعي):
 *   الاشتراك الجديد بيبدأ من يوم الدفع نفسه — فلما الأدمن يوافق متأخر
 *   المستخدم مبيخسرش الأيام اللي بين الدفع والموافقة
 * - تفعيل باقة مجانية بالكود (نادر) → ينطفي أي اشتراك مدفوع ساري ويرجع للمجاني
 */
export async function activatePlanForUser(
  userId: string,
  plan: PlanRecord,
  opts?: { anchorDate?: string | Date | null }
): Promise<ActivationResult> {
  const durationDays = Math.max(Number(plan.duration_days) || 30, 1);
  const targetIsPaid = Number(plan.price) > 0;
  const now = new Date();

  /* الاشتراكات السارية الحالية مع سعر الباقة */
  const { data: activeSubs, error: fetchError } = await supabaseAdmin
    .from("subscriptions")
    .select("id, end_date, plans ( price )")
    .eq("user_id", userId)
    .eq("status", "active")
    .gte("end_date", now.toISOString())
    .order("end_date", { ascending: false })
    .limit(10);

  if (fetchError) {
    console.error("[Subscription] Fetch error:", fetchError);
    throw new Error("تعذر التحقق من الاشتراك الحالي");
  }

  const rows = (activeSubs || []) as Array<{
    id: string;
    end_date: string;
    plans: unknown;
  }>;

  const planPriceOf = (s: { plans: unknown }) => {
    const p = Array.isArray(s.plans) ? (s.plans as unknown[])[0] : s.plans;
    return Number((p as { price?: number | string } | null)?.price ?? 0);
  };

  const paidSubs = rows.filter((s) => planPriceOf(s) > 0);
  const latestPaid = paidSubs[0] ?? null;

  const startNew = async (): Promise<ActivationResult> => {
    /* بداية الاشتراك: من يوم الدفع نفسه لو الأدمن وافق بعد كده،
       وإلا من دلوقتي */
    const startDate = opts?.anchorDate
      ? new Date(opts.anchorDate)
      : now;

    newEndDate = new Date(
      startDate.getTime() + durationDays * 24 * 60 * 60 * 1000
    );

    const { data: created, error: subError } = await supabaseAdmin
      .from("subscriptions")
      .insert({
        user_id: userId,
        plan_id: plan.id,
        start_date: startDate.toISOString(),
        end_date: newEndDate.toISOString(),
        status: "active",
      })
      .select("id")
      .single();

    if (subError || !created) {
      console.error("[Subscription] Create error:", subError);
      throw new Error("فشل إنشاء الاشتراك");
    }

    subscriptionId = created.id as string;
    renewed = false;
    daysAdded = durationDays;
    return buildResult();
  };

  let newEndDate: Date;
  let renewed = false;
  let subscriptionId: string | null = null;
  let daysAdded = durationDays;

  const buildResult = (): ActivationResult => ({
    renewed,
    endDate: newEndDate.toISOString(),
    daysAdded,
    daysRemaining: Math.max(
      Math.ceil((newEndDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)),
      1
    ),
    subscriptionId,
  });

  /* ===== تفعيل باقة مدفوعة ===== */
  if (targetIsPaid) {
    /* عنده باقة مدفوعة سارية → تجديد تراكمي فوق المتبقي */
    if (latestPaid) {
      const currentEnd = new Date(latestPaid.end_date);
      newEndDate = new Date(
        currentEnd.getTime() + durationDays * 24 * 60 * 60 * 1000
      );

      const { error: extendError } = await supabaseAdmin
        .from("subscriptions")
        .update({
          plan_id: plan.id,
          end_date: newEndDate.toISOString(),
        })
        .eq("id", latestPaid.id);

      if (extendError) {
        console.error("[Subscription] Extend error:", extendError);
        throw new Error("فشل تجديد الاشتراك");
      }

      renewed = true;
      subscriptionId = latestPaid.id;
      daysAdded = Math.round(
        (newEndDate.getTime() - currentEnd.getTime()) / (24 * 60 * 60 * 1000)
      );

      return buildResult();
    }

    /* مجاني أو مفيش → اشتراك مدفوع جديد (المجاني بيفضل موجود كشبكة أمان).
       بدايته من يوم الدفع لو الأدمن وافق بعد كده — المستخدم مبيخسرش يوم */
    return startNew();
  }

  /* ===== تفعيل باقة مجانية بالكود (نادر) — نطفي المدفوع ونسلم المجاني ===== */
  if (paidSubs.length > 0) {
    await supabaseAdmin
      .from("subscriptions")
      .update({ status: "expired" })
      .in(
        "id",
        paidSubs.map((s) => s.id)
      );
  }

  /* لو عنده اشتراك مجاني ساري — هو ده فعلاً */
  const freeSub = rows.find((s) => planPriceOf(s) === 0);
  if (freeSub) {
    newEndDate = new Date(freeSub.end_date);
    subscriptionId = freeSub.id;
    renewed = false;
    daysAdded = 0;
    return buildResult();
  }

  return startNew();
}

/** رسالة التفعيل/التجديد الموحدة */
export function activationMessage(
  planName: string,
  result: ActivationResult
): string {
  const endDateAr = new Date(result.endDate).toLocaleDateString("ar-EG");

  return result.renewed
    ? `تم تجديد اشتراكك في باقة "${planName}" — أُضيف ${result.daysAdded} يوم، اشتراكك ساري حتى ${endDateAr} (باقي ${result.daysRemaining} يوم)`
    : `تم تفعيل باقة "${planName}" بنجاح — سارية حتى ${endDateAr} (باقي ${result.daysRemaining} يوم)`;
}
