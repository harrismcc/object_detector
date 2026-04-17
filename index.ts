import sharp from "sharp";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { z } from "zod/v4";

// --- Configuration ---
const INPUT_IMAGE = "./input.png";
const OUTPUT_IMAGE = "./output.png";
const OBJECT = process.argv[2];
if (!OBJECT) {
  console.error("Usage: bun index.ts <object to detect>");
  process.exit(1);
}
const PROMPT = `Detect all ${OBJECT} in the image.`
const MODEL = "gemma-4-26b-a4b-it";

console.log(`Running prompt "${PROMPT}" with model "${MODEL}"...`);

const BoxSchema = z.object({
  box_2d: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  label: z.string(),
});
const BoxesSchema = z.array(BoxSchema);
type Box = z.infer<typeof BoxSchema>;

const BOX_PADDING = 5;
const BOX_COLOR = "#FF0000";
const STROKE_WIDTH = 3;
const FONT_SIZE = 14;

// --- Detect bounding boxes via Gemini ---
async function detectBoxes(imagePath: string, prompt: string): Promise<Box[]> {
  const ai = new GoogleGenAI({ apiKey: process.env["GEMINI_API_KEY"] });

  const imageFile = Bun.file(imagePath);
  const imageBytes = Buffer.from(await imageFile.arrayBuffer());
  const base64 = imageBytes.toString("base64");
  const mimeType = imageFile.type || "image/png";

  const response = await ai.models.generateContent({
    model: MODEL,
    config: {
      temperature: 1,
      thinkingConfig: {
        thinkingLevel: ThinkingLevel.HIGH,
        includeThoughts: true,
      },
    },
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          { inlineData: { data: base64, mimeType } },
        ],
      },
    ],
  });

  // Log thinking and response
  for (const part of response.candidates?.[0]?.content?.parts ?? []) {
    if (part.thought) {
      console.log("\n--- Model Thinking ---");
      console.log(part.text);
    }
  }
  const text = response.text ?? "";
  console.log("\n--- Model Response ---");
  console.log(text);
  console.log("---\n");

  // Extract JSON array from the response (may be wrapped in ```json ... ```)
  const jsonMatch = text.match(/\[\s*\{[\s\S]*?\}\s*\]/);
  if (!jsonMatch) {
    throw new Error(`No bounding boxes found in model response:\n${text}`);
  }

  const parsed = JSON.parse(jsonMatch[0]);
  return BoxesSchema.parse(parsed);
}

// --- Draw boxes onto image ---
async function drawBoxes(
  imagePath: string,
  outputPath: string,
  boxes: Box[],
) {
  const image = sharp(imagePath);
  const metadata = await image.metadata();
  const width = metadata.width!;
  const height = metadata.height!;

  // box_2d values are [y_min, x_min, y_max, x_max] normalized to 0-1000
  function toPixel(box: [number, number, number, number]) {
    const [yMin, xMin, yMax, xMax] = box;
    const x = Math.round((xMin / 1000) * width) - BOX_PADDING;
    const y = Math.round((yMin / 1000) * height) - BOX_PADDING;
    const x2 = Math.round((xMax / 1000) * width) + BOX_PADDING;
    const y2 = Math.round((yMax / 1000) * height) + BOX_PADDING;
    return {
      x: Math.max(0, x),
      y: Math.max(0, y),
      w: Math.min(width, x2) - Math.max(0, x),
      h: Math.min(height, y2) - Math.max(0, y),
    };
  }

  const svgRects = boxes.map((b) => {
    const { x, y, w, h } = toPixel(b.box_2d);
    // Escape XML special characters in label
    const safeLabel = b.label
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return `
      <rect x="${x}" y="${y}" width="${w}" height="${h}"
            fill="none" stroke="${BOX_COLOR}" stroke-width="${STROKE_WIDTH}" />
      <rect x="${x}" y="${y - FONT_SIZE - 4}" width="${safeLabel.length * 8 + 8}" height="${FONT_SIZE + 4}"
            fill="${BOX_COLOR}" />
      <text x="${x + 4}" y="${y - 4}" font-size="${FONT_SIZE}" fill="white"
            font-family="sans-serif">${safeLabel}</text>
    `;
  });

  const overlay = Buffer.from(
    `<svg width="${width}" height="${height}">${svgRects.join("")}</svg>`,
  );

  await image.composite([{ input: overlay, top: 0, left: 0 }]).toFile(outputPath);
  console.log(`Done! Wrote ${outputPath} (${boxes.length} boxes drawn)`);
}

// --- Main ---
console.log(`Detecting objects in ${INPUT_IMAGE}...`);
const boxes = await detectBoxes(INPUT_IMAGE, PROMPT);
console.log(`Found ${boxes.length} object(s):`);
for (const b of boxes) {
  console.log(`  - ${b.label} ${JSON.stringify(b.box_2d)}`);
}
await drawBoxes(INPUT_IMAGE, OUTPUT_IMAGE, boxes);
Bun.$`open ${OUTPUT_IMAGE}`;
