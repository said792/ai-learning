"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "../context/LanguageContext";
import { useAuth } from "../context/AuthContext";

export default function LoginPage() {
  const router = useRouter();
  const { dir } = useLanguage();
  const { refreshUser } = useAuth();

  const isEn = dir === "ltr";

  const [isLogin, setIsLogin] = useState(true);

  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [phone, setPhone] = useState("");
  const [nationalId, setNationalId] = useState("");
  const [email, setEmail] = useState("");

  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [success, setSuccess] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    setLoading(true);
    setErr("");
    setSuccess("");

    try {
      if (isLogin) {
        const response = await fetch("/api/auth/login", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({
            login,
            password,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.error ||
              (isEn
                ? "Login failed"
                : "فشل تسجيل الدخول")
          );
        }

        await refreshUser();

        router.push("/");
        router.refresh();

        return;
      }

      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          fullName,
          username,
          phone,
          nationalId,
          email,
          password,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            (isEn
              ? "Registration failed"
              : "فشل إنشاء الحساب")
        );
      }

      setSuccess(
        isEn
          ? "Account created successfully. You can now login."
          : "تم إنشاء الحساب بنجاح. يمكنك الآن تسجيل الدخول."
      );

      setIsLogin(true);

      setLogin(username);
      setPassword("");

    } catch (error) {
      setErr(
        error instanceof Error
          ? error.message
          : isEn
          ? "An error occurred"
          : "حدث خطأ"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="flex min-h-screen items-center justify-center px-5"
      dir={dir}
    >
      <div className="w-full max-w-sm">

        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-800 text-2xl text-white shadow-lg">
            🎓
          </div>

          <h1 className="text-xl font-bold text-slate-800">
            {isEn
              ? "Welcome to AI Learning"
              : "مرحباً بك في AI Learning"}
          </h1>

          <p className="mt-1 text-sm text-slate-400">
            {isLogin
              ? isEn
                ? "Login to access your documents"
                : "سجل دخول للوصول لمستنداتك"
              : isEn
              ? "Create a new account"
              : "أنشئ حساباً جديداً"}
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4"
        >

          {!isLogin && (
            <>
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-600">
                  {isEn ? "Full Name" : "الاسم بالكامل"}
                </label>

                <input
                  value={fullName}
                  onChange={(e) =>
                    setFullName(e.target.value)
                  }
                  required
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-slate-400"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-600">
                  {isEn ? "Username" : "اسم المستخدم"}
                </label>

                <input
                  value={username}
                  onChange={(e) =>
                    setUsername(e.target.value)
                  }
                  required
                  dir="ltr"
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-slate-400"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-600">
                  {isEn ? "Phone (optional)" : "رقم الهاتف (اختياري)"}
                </label>

                <input
                  value={phone}
                  onChange={(e) =>
                    setPhone(e.target.value)
                  }
                  dir="ltr"
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-slate-400"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-600">
                  {isEn
                    ? "National ID (optional)"
                    : "الرقم القومي (اختياري)"}
                </label>

                <input
                  value={nationalId}
                  onChange={(e) =>
                    setNationalId(e.target.value)
                  }
                  dir="ltr"
                  maxLength={14}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-slate-400"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-600">
                  {isEn
                    ? "Email (optional)"
                    : "البريد الإلكتروني (اختياري)"}
                </label>

                <input
                  type="email"
                  value={email}
                  onChange={(e) =>
                    setEmail(e.target.value)
                  }
                  dir="ltr"
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-slate-400"
                />
              </div>
            </>
          )}

          {isLogin && (
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-600">
                {isEn
                  ? "Username / Phone / National ID / Email"
                  : "اسم المستخدم / الهاتف / الرقم القومي / الإيميل"}
              </label>

              <input
                value={login}
                onChange={(e) =>
                  setLogin(e.target.value)
                }
                required
                dir="ltr"
                placeholder={
                  isEn
                    ? "Enter your login"
                    : "أدخل بيانات الدخول"
                }
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-slate-400"
              />
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-600">
              {isEn ? "Password" : "كلمة المرور"}
            </label>

            <input
              type="password"
              value={password}
              onChange={(e) =>
                setPassword(e.target.value)
              }
              required
              minLength={6}
              dir="ltr"
              placeholder="••••••••"
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-slate-400"
            />
          </div>

          {err && (
            <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-2.5 text-xs text-red-600">
              {err}
            </div>
          )}

          {success && (
            <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-700">
              {success}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-slate-800 py-3 text-sm font-bold text-white shadow-lg transition hover:bg-slate-700 disabled:opacity-50"
          >
            {loading
              ? isEn
                ? "Please wait..."
                : "يرجى الانتظار..."
              : isLogin
              ? isEn
                ? "Login"
                : "تسجيل الدخول"
              : isEn
              ? "Create Account"
              : "إنشاء حساب"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-400">
          {isLogin
            ? isEn
              ? "Don't have an account?"
              : "ليس لديك حساب؟"
            : isEn
            ? "Already have an account?"
            : "لديك حساب بالفعل؟"}{" "}

          <button
            type="button"
            onClick={() => {
              setIsLogin(!isLogin);
              setErr("");
              setSuccess("");
            }}
            className="font-semibold text-slate-800 underline hover:text-slate-600"
          >
            {isLogin
              ? isEn
                ? "Sign Up"
                : "إنشاء حساب"
              : isEn
              ? "Login"
              : "تسجيل الدخول"}
          </button>
        </p>

      </div>
    </div>
  );
}