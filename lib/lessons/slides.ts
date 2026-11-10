import { Resvg } from "@resvg/resvg-js";
import path from "path";

/* =========================================================
   مولّد شرائح الدروس — SVG عربي RTL → PNG عبر resvg
   (خط Cairo مرفق في assets/fonts — تشكيل عربي كامل)
========================================================= */

const W = 1280;
const H = 720;

const FONTS_DIR = path.join(process.cwd(), "assets", "fonts");

const FONT_FILES = [
  path.join(FONTS_DIR, "Cairo-Regular.ttf"),
  path.join(FONTS_DIR, "Cairo-SemiBold.ttf"),
  path.join(FONTS_DIR, "Cairo-Bold.ttf"),
];

/** لوحات ألوان متناوبة للشرائح */
const PALETTES = [
  { bg1: "#0f172a", bg2: "#1e293b", accent: "#38bdf8", text: "#f8fafc", sub: "#94a3b8" },
  { bg1: "#14532d", bg2: "#166534", accent: "#4ade80", text: "#f0fdf4", sub: "#bbf7d0" },
  { bg1: "#4c1d95", bg2: "#5b21b6", accent: "#c084fc", text: "#faf5ff", sub: "#ddd6fe" },
  { bg1: "#7f1d1d", bg2: "#991b1b", accent: "#f87171", text: "#fef2f2", sub: "#fecaca" },
  { bg1: "#134e4a", bg2: "#115e59", accent: "#2dd4bf", text: "#f0fdfa", sub: "#99f6e4" },
];

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** تقصير النص بما يناسب عرض الشريحة */
function fitText(text: string, maxChars: number): string {
  const clean = text.trim();
  if (clean.length <= maxChars) return clean;
  return clean.slice(0, maxChars - 1).trimEnd() + "…";
}

/* =========================================================
   شريحة الغلاف
========================================================= */

export function coverSlideSvg(options: {
  title: string;
  subtitle?: string;
  brand?: string;
  paletteIndex?: number;
}): string {
  const { title, subtitle, brand = "AI Learning", paletteIndex = 0 } = options;
  const p = PALETTES[paletteIndex % PALETTES.length];

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${p.bg1}"/>
      <stop offset="100%" stop-color="${p.bg2}"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="35%" r="60%">
      <stop offset="0%" stop-color="${p.accent}" stop-opacity="0.25"/>
      <stop offset="100%" stop-color="${p.accent}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <circle cx="1180" cy="90" r="180" fill="${p.accent}" opacity="0.08"/>
  <circle cx="120" cy="640" r="220" fill="${p.accent}" opacity="0.06"/>
  <rect x="0" y="0" width="14" height="${H}" fill="${p.accent}"/>
  <text x="${W / 2}" y="150" text-anchor="middle" direction="rtl" font-family="Cairo" font-weight="700" font-size="30" fill="${p.accent}">${esc(fitText(brand, 40))}</text>
  <text x="${W / 2}" y="330" text-anchor="middle" direction="rtl" font-family="Cairo" font-weight="700" font-size="${title.length > 60 ? 44 : 56}" fill="${p.text}">${esc(fitText(title, 52))}</text>
  ${
    subtitle
      ? `<text x="${W / 2}" y="430" text-anchor="middle" direction="rtl" font-family="Cairo" font-weight="400" font-size="28" fill="${p.sub}">${esc(fitText(subtitle, 64))}</text>`
      : ""
  }
  <rect x="${W / 2 - 90}" y="480" width="180" height="6" rx="3" fill="${p.accent}"/>
  <text x="${W - 40}" y="${H - 40}" text-anchor="end" direction="rtl" font-family="Cairo" font-weight="400" font-size="20" fill="${p.sub}">درس مُولَّد بالذكاء الاصطناعي</text>
</svg>`;
}

/* =========================================================
   شريحة محتوى (عنوان + نقاط)
========================================================= */

export function contentSlideSvg(options: {
  heading: string;
  bullets: string[];
  sectionNumber: number;
  totalSections: number;
  brand?: string;
  paletteIndex?: number;
}): string {
  const {
    heading,
    bullets,
    sectionNumber,
    totalSections,
    brand = "AI Learning",
    paletteIndex,
  } = options;

  const p = PALETTES[(paletteIndex ?? sectionNumber) % PALETTES.length];

  const startY = 250;
  const lineGap = 92;
  const maxBulletChars = 68;

  const bulletLines = bullets
    .slice(0, 5)
    .map((b, i) => {
      const y = startY + i * lineGap;
      const text = fitText(b, maxBulletChars);
      return `
  <circle cx="${W - 104}" cy="${y - 11}" r="9" fill="${p.accent}"/>
  <text x="${W - 136}" y="${y}" text-anchor="end" direction="rtl" font-family="Cairo" font-weight="600" font-size="32" fill="${p.text}">${esc(text)}</text>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${p.bg1}"/>
      <stop offset="100%" stop-color="${p.bg2}"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect x="0" y="0" width="${W}" height="150" fill="#000000" opacity="0.18"/>
  <rect x="0" y="0" width="${W}" height="6" fill="${p.accent}"/>
  <text x="${W - 60}" y="95" text-anchor="end" direction="rtl" font-family="Cairo" font-weight="700" font-size="42" fill="${p.text}">${esc(fitText(heading, 44))}</text>
  <text x="60" y="95" text-anchor="start" font-family="Cairo" font-weight="600" font-size="26" fill="${p.accent}">${sectionNumber} / ${totalSections}</text>
  ${bulletLines}
  <line x1="60" y1="${H - 62}" x2="${W - 60}" y2="${H - 62}" stroke="${p.accent}" stroke-opacity="0.35" stroke-width="2"/>
  <text x="${W - 60}" y="${H - 26}" text-anchor="end" direction="rtl" font-family="Cairo" font-weight="400" font-size="19" fill="${p.sub}">${esc(brand)}</text>
</svg>`;
}

/* =========================================================
   التحويل إلى PNG
========================================================= */

export function renderSvgToPng(svg: string, width = W): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    background: "rgba(0,0,0,0)",
    font: {
      fontFiles: FONT_FILES,
      loadSystemFonts: false,
      defaultFontFamily: "Cairo",
    },
  });

  return Buffer.from(resvg.render().asPng());
}

export function renderCoverSlide(options: {
  title: string;
  subtitle?: string;
  brand?: string;
  paletteIndex?: number;
}): Buffer {
  return renderSvgToPng(coverSlideSvg(options));
}

export function renderContentSlide(options: {
  heading: string;
  bullets: string[];
  sectionNumber: number;
  totalSections: number;
  brand?: string;
  paletteIndex?: number;
}): Buffer {
  return renderSvgToPng(contentSlideSvg(options));
}

export const SLIDE_WIDTH = W;
export const SLIDE_HEIGHT = H;
