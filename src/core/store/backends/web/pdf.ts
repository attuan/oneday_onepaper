// pdf.js による本文抽出。Tauri 版の extract_pdf_text(Rust)と同じ役目

import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const task = pdfjs.getDocument({ data: bytes });
  try {
    const doc = await task.promise;
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.map((it) => ("str" in it ? it.str : "")).join(" "));
    }
    return pages.join("\n\n");
  } finally {
    await task.destroy();
  }
}
