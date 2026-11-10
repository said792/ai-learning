# ============================================================
#  AI Learning — صورة إنتاج جاهزة
#  تشمل: Node 20 + ffmpeg + LibreOffice (للصيغ القديمة) + الخطوط
#  البناء:  docker build -t ai-learning .
#  التشغيل: docker compose up -d
# ============================================================

FROM node:20-bookworm-slim

# تثبيت أدوات النظام:
# - ffmpeg: استخراج صوت الفيديو + تجميع فيديو الدروس
# - libreoffice: تحويل الصيغ القديمة (doc / ppt / xls / odt / rtf ...)
# - fonts-noto-core: خطوط عربية للشرائح (احتياطي — خط Cairo مرفق بالمشروع)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libreoffice \
    fonts-noto-core \
    ca-certificates \
    curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# تثبيت الاعتماديات (طبقة منفصلة للكاش)
COPY package.json package-lock.json* ./
RUN npm ci || npm install

# نسخ المشروع
COPY . .

# البناء
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# مجلد الملفات المرفوعة (Volume اختياري)
RUN mkdir -p /app/uploads
VOLUME ["/app/uploads"]

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

CMD ["npm", "start"]
