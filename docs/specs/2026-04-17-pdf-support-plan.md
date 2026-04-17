# PDF Support — Implementation Plan

Based on [the design spec](../designs/2026-04-17-pdf-support-design.md).

## Step 1: Add pdfjs-dist dependency

- `bun add pdfjs-dist`
- Verify the worker file is accessible (check `node_modules/pdfjs-dist/build/pdf.worker.min.mjs`)

**Acceptance:** dependency installs, worker file exists.

## Step 2: Create `src/pdf.ts`

Implement:
```ts
renderPdfPages(file: File): Promise<{ pageCount: number; images: string[] }>
```

- Load PDF from `File` (via `ArrayBuffer`)
- Configure the pdfjs worker (using `new URL(..., import.meta.url)` for Vite)
- Validate page count ≤ 10, throw descriptive error if exceeded
- Render each page to an offscreen `<canvas>` at 2x scale
- Convert to PNG data URLs
- Return images array

**Acceptance:** can call `renderPdfPages()` with a test PDF and get back an array of data URL strings, one per page. Pages >10 throws.

## Step 3: Refactor App.tsx state from single image to `PageResult[]`

- Define `PageResult` type (pageIndex, imageDataUrl, boxes, error?)
- Replace `imageUrl`, `imageFile`, `boxes` state with `pages: PageResult[]` and `currentPageIndex: number`
- Keep `imageFile` for the raw file reference (needed for detection)
- Update `handleFile` for images: create a single `PageResult` with the object URL, set `pages` to `[it]`
- Update `handleDetect`: read from `pages[0].imageDataUrl` for single images
- Update `draw()`: read image and boxes from `pages[currentPageIndex]`
- Update sidebar: read boxes from `pages[currentPageIndex]`

**Acceptance:** existing image upload + detection flow works identically to before. No visual or behavioral changes.

## Step 4: Add PDF branch to `handleFile`

- Detect PDF by file type (`application/pdf`) or extension
- Call `renderPdfPages(file)`
- Create a `PageResult` for each page (boxes empty, imageDataUrl from rendered image)
- Set `pages` state, `currentPageIndex` to 0
- Handle errors (>10 pages, corrupt PDF) with user-facing error message

**Acceptance:** uploading a PDF shows page 1 in the viewer. Upload zone accepts PDFs. Error shown for PDFs >10 pages.

## Step 5: Update detection flow for multi-page

- Map over all `pages`, fire Gemini API calls in parallel (`Promise.allSettled`)
- As results come in, update each `PageResult.boxes` (or `.error` on failure)
- Show progress indicator: "X of Y pages complete"
- Replace streaming thinking text with the progress counter during multi-page detection

**Acceptance:** uploading a PDF and running detection processes all pages in parallel, results populate per-page, failed pages show error without blocking others.

## Step 6: Update results sidebar for page grouping

- When `pages.length > 1`, render collapsible sections grouped by page: "Page 1 (N items)", "Page 2 (N items)", etc.
- When `pages.length === 1`, render flat list (current behavior)
- Clicking a result: set `currentPageIndex` to that result's page, set `selectedIndex` to highlight the box
- Show inline error for pages that failed detection
- Collapse empty pages (0 results, no error) by default

**Acceptance:** sidebar shows grouped results for PDFs, flat list for images. Clicking a result from a different page swaps the viewer to that page and highlights the box.

## Step 7: Update upload zone UI

- Change `accept` to `image/*,.pdf`
- Update drop handler to accept `application/pdf`
- Update helper text to "PNG, JPG, WebP, GIF, or PDF"

**Acceptance:** drag-and-drop and file picker both accept PDFs. Helper text is updated.

## Order & Dependencies

Steps 1 → 2 → 3 → 4 → 5 → 6 are sequential (each builds on the prior).
Step 7 can be done alongside step 4 (it's just UI text/attribute changes).

Step 3 is the critical refactor — it must not break existing image functionality.
