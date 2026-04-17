import {
  useState,
  useRef,
  useCallback,
  useEffect,
  type DragEvent,
} from "react";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod/v4";

const MODEL = "gemma-4-26b-a4b-it";
const API_KEY_STORAGE = "gemini-api-key";

type Box = {
  box_2d: [number, number, number, number];
  label: string;
};

const BoxSchema = z.object({
  box_2d: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  label: z.string(),
});
const BoxesSchema = z.array(BoxSchema);

const COLORS = [
  "#ef4444", // red
  "#3b82f6", // blue
  "#22c55e", // green
  "#f59e0b", // amber
  "#a855f7", // purple
  "#06b6d4", // cyan
  "#ec4899", // pink
  "#f97316", // orange
];
const HIGHLIGHT_COLOR = "#facc15";
const STROKE_WIDTH = 2;
const HIGHLIGHT_STROKE = 4;
const FONT = "bold 13px sans-serif";
const LABEL_PAD_X = 6;
const LABEL_PAD_Y = 4;

function colorForIndex(i: number): string {
  return COLORS[i % COLORS.length]!;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the data:...;base64, prefix
      resolve(result.split(",")[1]!);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function App() {
  const [apiKey, setApiKey] = useState(
    () => localStorage.getItem(API_KEY_STORAGE) ?? "",
  );
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [ready, setReady] = useState(
    () => !!localStorage.getItem(API_KEY_STORAGE),
  );
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [object, setObject] = useState("");
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const saveApiKey = () => {
    if (apiKeyInput.trim()) {
      const key = apiKeyInput.trim();
      localStorage.setItem(API_KEY_STORAGE, key);
      setApiKey(key);
      setReady(true);
    }
  };

  const clearApiKey = () => {
    localStorage.removeItem(API_KEY_STORAGE);
    setApiKey("");
    setApiKeyInput("");
    setReady(false);
  };

  const handleFile = useCallback((file: File) => {
    setImageFile(file);
    setImageUrl(URL.createObjectURL(file));
    setBoxes([]);
    setError(null);
    setSelectedIndex(null);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file?.type.startsWith("image/")) handleFile(file);
    },
    [handleFile],
  );

  const handleDetect = async () => {
    if (!imageFile || !object.trim() || !apiKey.trim()) return;
    setLoading(true);
    setError(null);
    setBoxes([]);
    setSelectedIndex(null);

    try {
      const base64 = await readFileAsBase64(imageFile);
      const mimeType = imageFile.type || "image/png";

      const ai = new GoogleGenAI({ apiKey: apiKey.trim() });

      const response = await ai.models.generateContent({
        model: MODEL,
        config: {
          temperature: 1,
          thinkingConfig: {
            includeThoughts: true,
          },
        },
        contents: [
          {
            role: "user",
            parts: [
              { text: `Detect all ${object.trim()} in the image.` },
              { inlineData: { data: base64, mimeType } },
            ],
          },
        ],
      });

      const text = response.text ?? "";
      const jsonMatch = text.match(/\[\s*\{[\s\S]*?\}\s*\]/);
      if (!jsonMatch) {
        throw new Error("No bounding boxes found in model response");
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const detectedBoxes = BoxesSchema.parse(parsed);
      setBoxes(detectedBoxes);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !img.naturalWidth) return;

    const ctx = canvas.getContext("2d")!;
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;

    ctx.drawImage(img, 0, 0);

    const w = img.naturalWidth;
    const h = img.naturalHeight;

    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i]!;
      const [yMin, xMin, yMax, xMax] = box.box_2d;
      const isSelected = selectedIndex === i;

      const x = (xMin / 1000) * w;
      const y = (yMin / 1000) * h;
      const bw = ((xMax - xMin) / 1000) * w;
      const bh = ((yMax - yMin) / 1000) * h;

      const color = isSelected ? HIGHLIGHT_COLOR : colorForIndex(i);
      const stroke = isSelected ? HIGHLIGHT_STROKE : STROKE_WIDTH;

      ctx.strokeStyle = color;
      ctx.lineWidth = stroke;
      ctx.strokeRect(x, y, bw, bh);

      ctx.font = FONT;
      const text = box.label;
      const metrics = ctx.measureText(text);
      const labelW = metrics.width + LABEL_PAD_X * 2;
      const labelH = 13 + LABEL_PAD_Y * 2;
      const labelY = y - labelH;

      ctx.fillStyle = color;
      ctx.fillRect(x, labelY > 0 ? labelY : y, labelW, labelH);

      ctx.fillStyle = isSelected ? "#000" : "#fff";
      ctx.fillText(
        text,
        x + LABEL_PAD_X,
        (labelY > 0 ? labelY : y) + LABEL_PAD_Y + 13,
      );
    }
  }, [boxes, selectedIndex]);

  useEffect(() => {
    draw();
  }, [draw]);

  const onImageLoad = useCallback(() => {
    draw();
  }, [draw]);

  if (!ready) {
    return (
      <main className="max-w-md mx-auto px-4 py-24">
        <h1 className="text-3xl font-bold mb-2">Object Detector</h1>
        <p className="text-gray-400 mb-8">
          Detect objects in images using the Gemini API. Everything runs 100%
          in your browser — your images and API key are never sent to any
          server other than Google's Gemini API directly.
        </p>

        <label className="block text-sm font-medium text-gray-300 mb-2">
          Gemini API Key
        </label>
        <input
          type="password"
          value={apiKeyInput}
          onChange={(e) => setApiKeyInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveApiKey();
          }}
          placeholder="AIza..."
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 mb-4"
        />
        <button
          onClick={saveApiKey}
          disabled={!apiKeyInput.trim()}
          className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 px-6 py-2.5 rounded-lg font-medium transition-colors mb-6"
        >
          Continue
        </button>

        <p className="text-xs text-gray-500">
          Your key is saved in your browser's local storage so you don't have
          to enter it again. It is never sent anywhere except directly to
          Google's API from your browser.
        </p>
      </main>
    );
  }

  return (
    <main className="max-w-6xl mx-auto px-4 py-12">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold">Object Detector</h1>
        <button
          onClick={clearApiKey}
          className="text-sm text-gray-400 hover:text-gray-200 transition-colors"
        >
          Change API Key
        </button>
      </div>

      {!imageUrl ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-16 text-center cursor-pointer transition-colors ${
            dragOver
              ? "border-blue-400 bg-blue-400/10"
              : "border-gray-600 hover:border-gray-400"
          }`}
        >
          <p className="text-lg text-gray-400">
            Drop an image here or click to upload
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex gap-3">
            <input
              type="text"
              value={object}
              onChange={(e) => setObject(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleDetect();
              }}
              placeholder="What do you want to detect? (e.g. cars, faces, dogs)"
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={handleDetect}
              disabled={loading || !object.trim() || !apiKey.trim()}
              className="bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 px-6 py-2.5 rounded-lg font-medium transition-colors"
            >
              {loading ? "Detecting..." : "Detect"}
            </button>
            <button
              onClick={() => {
                setImageUrl(null);
                setImageFile(null);
                setBoxes([]);
                setObject("");
                setError(null);
                setSelectedIndex(null);
              }}
              className="bg-gray-800 hover:bg-gray-700 px-4 py-2.5 rounded-lg transition-colors"
            >
              Clear
            </button>
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <div className="flex gap-6">
            <div className="relative flex-1 min-w-0">
              <img
                ref={imgRef}
                src={imageUrl}
                alt=""
                className="hidden"
                onLoad={onImageLoad}
              />
              <canvas ref={canvasRef} className="max-w-full rounded-lg" />
              {loading && (
                <div className="absolute inset-0 bg-black/50 rounded-lg flex items-center justify-center">
                  <div className="flex items-center gap-3 bg-gray-900 px-5 py-3 rounded-lg">
                    <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                    <span>Detecting {object}...</span>
                  </div>
                </div>
              )}
            </div>

            {boxes.length > 0 && (
              <div className="w-64 shrink-0">
                <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
                  Detected ({boxes.length})
                </h2>
                <ul className="space-y-1">
                  {boxes.map((box, i) => {
                    const isSelected = selectedIndex === i;
                    return (
                      <li key={i}>
                        <button
                          onClick={() =>
                            setSelectedIndex(isSelected ? null : i)
                          }
                          className={`w-full text-left px-3 py-2 rounded-lg flex items-center gap-3 transition-colors ${
                            isSelected
                              ? "bg-yellow-500/20 text-yellow-300"
                              : "hover:bg-gray-800 text-gray-300"
                          }`}
                        >
                          <span
                            className="w-3 h-3 rounded-full shrink-0"
                            style={{
                              backgroundColor: isSelected
                                ? HIGHLIGHT_COLOR
                                : colorForIndex(i),
                            }}
                          />
                          <span className="truncate">{box.label}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
