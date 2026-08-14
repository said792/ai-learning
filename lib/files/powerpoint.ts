import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export async function extractPowerPointText(filePath: string) {
  const extension = filePath.toLowerCase().endsWith(".pptx")
    ? ".pptx"
    : ".ppt";

  if (extension === ".ppt") {
    throw new Error("صيغة PPT القديمة تحتاج معالجة مختلفة");
  }

  const buffer = fs.readFileSync(filePath);

  if (!buffer.length) {
    throw new Error("ملف PowerPoint فارغ");
  }

  try {
    const { stdout } = await execFileAsync(
      "node",
      [
        "-e",
        `
        const fs = require("fs");
        const JSZip = require("jszip");

        (async () => {
          const data = fs.readFileSync(process.argv[1]);
          const zip = await JSZip.loadAsync(data);
          let text = "";

          for (const name of Object.keys(zip.files)) {
            if (name.startsWith("ppt/slides/slide") && name.endsWith(".xml")) {
              const xml = await zip.files[name].async("text");
              text += xml
                .replace(/<a:t>/g, "")
                .replace(/<\\/a:t>/g, " ")
                .replace(/<[^>]+>/g, " ")
                .replace(/\\\\s+/g, " ")
                .trim() + "\\n\\n";
            }
          }

          process.stdout.write(text);
        })();
        `,
        filePath,
      ],
      {
        maxBuffer: 20 * 1024 * 1024,
      },
    );

    return stdout;
  } catch {
    throw new Error("تعذر قراءة ملف PowerPoint");
  }
}