import ffmpeg from "fluent-ffmpeg";
import path from "path";

const ffmpegPath = path.join(
  process.cwd(),
  "node_modules",
  "ffmpeg-static",
  "ffmpeg.exe"
);

ffmpeg.setFfmpegPath(ffmpegPath);

export function extractAudioFromVideo(
  videoPath: string,
  outputPath: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .noVideo()
      .audioCodec("pcm_s16le")
      .audioFrequency(16000)
      .audioChannels(1)
      .format("wav")
      .on("end", () => resolve(outputPath))
      .on("error", (error) => reject(error))
      .save(outputPath);
  });
}