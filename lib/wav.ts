/* =========================================================
   مشفّر WAV بسيط: PCM (s16le) → ملف WAV صالح للتشغيل
========================================================= */

export function pcmToWav(
  pcm: Buffer,
  sampleRate = 24_000,
  channels = 1,
  bitsPerSample = 16
): Buffer {
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcm.length;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");

  // fmt chunk
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16); // chunk size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  // data chunk
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  pcm.copy(buffer, 44);

  return buffer;
}

/* =========================================================
   دمج عدة ملفات WAV بنفس المواصفات في ملف واحد
========================================================= */

export function concatWavBuffers(wavs: Buffer[]): Buffer {
  if (wavs.length === 1) return wavs[0];

  const pcmChunks: Buffer[] = [];
  let sampleRate = 24_000;
  let channels = 1;
  let bitsPerSample = 16;

  for (const wav of wavs) {
    // قراءة المواصفات من أول ملف
    if (pcmChunks.length === 0 && wav.length > 44) {
      channels = wav.readUInt16LE(22);
      sampleRate = wav.readUInt32LE(24);
      bitsPerSample = wav.readUInt16LE(34);
    }

    const dataStart = 44; // رأس WAV قياسي 44 بايت
    pcmChunks.push(wav.subarray(dataStart));
  }

  const totalPcm = Buffer.concat(pcmChunks);

  return pcmToWav(totalPcm, sampleRate, channels, bitsPerSample);
}

/* =========================================================
   دمج عدة مقاطع PCM الخام في ملف WAV واحد
========================================================= */

export function pcmChunksToWav(
  chunks: Buffer[],
  sampleRate = 24_000,
  channels = 1,
  bitsPerSample = 16
): Buffer {
  return pcmToWav(Buffer.concat(chunks), sampleRate, channels, bitsPerSample);
}

/* =========================================================
   تقدير مدة WAV بالثواني
========================================================= */

export function wavDurationSeconds(wav: Buffer): number {
  if (wav.length <= 44) return 0;

  const sampleRate = wav.readUInt32LE(24) || 24_000;
  const byteRate = wav.readUInt32LE(28) || sampleRate * 2;
  const dataSize = wav.readUInt32LE(40) || wav.length - 44;

  return byteRate > 0 ? dataSize / byteRate : 0;
}
