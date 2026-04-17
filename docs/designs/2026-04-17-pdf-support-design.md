# PDF Support for Object Detector

## Overview

Add PDF upload support to the object detector app. Users can upload a PDF (max 10 pages), and the app runs object detection on all pages in parallel. Results are grouped by page in the sidebar, and clicking a result navigates the viewer to the relevant page.

Since Gemini's bounding box detection doesn't work reliably on PDFs directly, each PDF page is rasterized to a PNG image client-side before being sent to the API.

## Data Model

Detection results become page-aware:

```ts
type Box = { box_2d: [number, number, number, number]; label: string };

type PageResult = {
  pageIndex: number;       // 0 for single images, 0..N for PDF pages
  imageDataUrl: string;    // rasterized page image (data URL) or object URL for images
  boxes: Box[];
  error?: string;          // per-page detection error, if any
};
```

App state changes from `imageUrl + boxes[]` to:
- `pages: PageResult[]` — all pages (1 for images, N for PDFs)
- `currentPageIndex: number` — which page is displayed in the viewer

For single image uploads, there is one `PageResult` with `pageIndex: 0`, preserving current behavior.

## File Handling & PDF Rendering

### Upload zone changes
- File input `accept` changes from `image/*` to `image/*,.pdf`
- Drop handler accepts both `image/*` and `application/pdf` MIME types
- Helper text updates to "PNG, JPG, WebP, GIF, or PDF"

### handleFile branching
- **Image:** Same as today — create object URL, wrap in single-element `PageResult[]`
- **PDF:** Use `pdfjs-dist` to render pages to images

### PDF rendering (new module: `src/pdf.ts`)

Exports:
```ts
renderPdfPages(file: File): Promise<{ pageCount: number; images: string[] }>
```

Behavior:
1. Load the PDF document with pdfjs-dist
2. Reject with an error if page count exceeds 10
3. Render each page to an offscreen canvas at 2x scale (72 DPI × 2 = ~1224×1584px for standard letter)
4. Convert each canvas to a PNG data URL
5. Return the array of data URLs

Note: pdfjs-dist requires a web worker for parsing. The worker can be loaded from the pdfjs-dist package's `build/pdf.worker.min.mjs` — Vite handles this as a static asset or via `new URL(..., import.meta.url)`.

## Detection Flow

1. **Parallel processing** — map over all `pages[]` and call the Gemini API concurrently for each page's image
2. **Progressive results** — as each promise resolves, update that page's `PageResult.boxes` in state
3. **Per-page error handling** — if a single page's detection fails, store the error on that `PageResult` but don't fail the batch
4. **Progress indicator** — show "X of Y pages complete" during processing instead of streaming thinking text for all pages simultaneously
5. **Prompt** — unchanged; each page is sent as a standalone image

## Results Sidebar

- **Grouped by page** — collapsible sections with headers: "Page 1", "Page 2", etc.
- **Single images** — no page header shown (preserves current clean behavior)
- **Clicking a result** — sets `currentPageIndex` to that result's page and highlights the selected box
- **Box count per page** — shown in page header, e.g. "Page 3 (5 items)"
- **Page errors** — inline error message in that page's group section

## Viewer

The canvas/viewer stays mostly the same. It reads from `pages[currentPageIndex]` instead of a single `imageUrl` + `boxes[]`. The zoom/pan controls, bounding box drawing, and box highlighting all work identically — they just operate on whichever page is currently selected.

## File Changes

| File | Change |
|------|--------|
| `src/pdf.ts` | **New** — `renderPdfPages()` using pdfjs-dist |
| `src/App.tsx` | **Modified** — refactor state to `PageResult[]`, branch `handleFile` on file type, update sidebar to group by page, swap canvas by current page |
| `package.json` | **Modified** — add `pdfjs-dist` dependency |

## Constraints

- Maximum 10 PDF pages (enforced at upload time with user-facing error)
- PDF pages rendered at 2x scale for detection quality
- All processing is client-side; PDFs are never sent to any server other than Google's Gemini API (as rasterized images)
