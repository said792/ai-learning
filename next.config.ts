import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  eslint: {
    ignoreDuringBuilds: true,
  },
  // مكتبات أصلية/خارجية يجب ألا تدخل حزمة webpack
  serverExternalPackages: [
    "@napi-rs/canvas",
    "@resvg/resvg-js",
    "pdfjs-dist",
    "unpdf",
    "mammoth",
    "jszip",
    "xlsx",
    "fluent-ffmpeg",
    "ffmpeg-static",
    "ffprobe-static",
    "@google/genai",
    "@supabase/supabase-js",
  ],
  experimental: {
    // رفع ملفات كبيرة عبر Route Handlers عند الاستضافة الذاتية
    serverActions: {
      bodySizeLimit: "200mb",
    },
  },
  // مهلة أطول للعمليات الثقيلة (فيديو / Veo) عند الاستضافة الذاتية
  poweredByHeader: false,
};

export default nextConfig;
