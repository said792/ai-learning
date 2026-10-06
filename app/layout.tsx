import type { Metadata } from "next";
import { Cairo } from "next/font/google";
import Script from "next/script";

import Sidebar from "./components/Sidebar";
import { AuthProvider } from "./context/AuthContext";
import { LanguageProvider } from "./context/LanguageContext";
import "./globals.css";

const cairo = Cairo({
  subsets: ["arabic"],
  variable: "--font-cairo",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: {
    default: "AI Learning",
    template: "%s | AI Learning",
  },
  description: "منصة ذكية لفهم وتحليل الملفات التعليمية",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" data-theme="pearl" suppressHydrationWarning>
      <head>
        <Script id="theme-init" strategy="beforeInteractive">
          {`(function(){try{var s=localStorage.getItem("ai-learning-theme");var t=["pearl","royal","ocean","emerald","midnight"];document.documentElement.setAttribute("data-theme",t.indexOf(s)!==-1?s:"pearl")}catch(e){document.documentElement.setAttribute("data-theme","pearl")}})();`}
        </Script>
      </head>
      <body className={cairo.variable}>
        <AuthProvider>
          <LanguageProvider>
            <div className="min-h-screen bg-background text-foreground transition-colors duration-200">
              <div className="flex min-h-screen">
                <Sidebar />

<main className="min-w-0 flex-1 pb-[78px] lg:pb-0">
  <div className="relative min-h-screen overflow-hidden">
    {/* Soft decorative lights */}
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      <div className="absolute -left-32 -top-32 h-72 w-72 rounded-full bg-primary/5 blur-3xl" />
      <div className="absolute -right-32 top-1/4 h-80 w-80 rounded-full bg-accent/5 blur-3xl" />
      <div className="absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-primary/5 blur-3xl" />
    </div>

    {children}
  </div>
</main>              </div>
            </div>
          </LanguageProvider>
        </AuthProvider>
      </body>
    </html>
  );
}