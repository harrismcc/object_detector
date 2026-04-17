import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const MAX_PAGES = 10;
const SCALE = 2; // 72 DPI × 2 = ~144 DPI

export async function renderPdfPages(
  file: File,
): Promise<{ pageCount: number; images: string[] }> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  if (pdf.numPages > MAX_PAGES) {
    throw new Error(
      `PDF has ${pdf.numPages} pages, but the maximum is ${MAX_PAGES}.`,
    );
  }

  const images: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: SCALE });

    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to create canvas context");

    await page.render({ canvasContext: ctx, canvas, viewport }).promise;

    images.push(canvas.toDataURL("image/png"));
  }

  return { pageCount: pdf.numPages, images };
}
