import fs from "fs";
import { extractText } from "unpdf";

export async function extractPdfText(filePath: string) {
  const buffer = fs.readFileSync(filePath);

  const { text } = await extractText(new Uint8Array(buffer));

  return text.join("\n\n");
}