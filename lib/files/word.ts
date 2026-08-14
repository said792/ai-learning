import fs from "fs";
import mammoth from "mammoth";

export async function extractWordText(filePath: string) {
  const buffer = fs.readFileSync(filePath);

  const result = await mammoth.extractRawText({
    buffer,
  });

  return result.value;
}