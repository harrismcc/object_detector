import {
  useState,
  useRef,
  useCallback,
  useEffect,
  type DragEvent,
} from "react";
import {
  GoogleGenAI,
  ThinkingLevel as SDKThinkingLevel,
  FinishReason,
  type GenerateContentResponseUsageMetadata,
} from "@google/genai";
import { z } from "zod/v4";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ChevronDown,
  Brain,
  Upload,
  ScanSearch,
  X,
  Settings2,
  Crosshair,
  KeyRound,
  ShieldCheck,
} from "lucide-react";

const DEFAULT_MODEL = "gemma-4-26b-a4b-it";
const API_KEY_STORAGE = "gemini-api-key";
const DEFAULT_PROMPT_TEMPLATE =
  'Detect all {{object}} in the image. Use descriptive, human-readable labels for each detected item (e.g. "Master bedroom" instead of "bedrooms"). Return ONLY a JSON array with this exact shape: [{"box_2d": [y_min, x_min, y_max, x_max], "label": "descriptive label"}] where coordinates are 0-1000 normalized. No other text.';

const AVAILABLE_MODELS = [
  "gemini-3-flash-preview",
  "gemma-4-26b-a4b-it",
  "gemma-4-31b-it",
];

const THINKING_LEVELS = ["none", "low", "medium", "high"] as const;
type ThinkingLevel = (typeof THINKING_LEVELS)[number];

const SDK_THINKING_LEVEL_MAP: Record<Exclude<ThinkingLevel, "none">, SDKThinkingLevel> = {
  low: SDKThinkingLevel.LOW,
  medium: SDKThinkingLevel.MEDIUM,
  high: SDKThinkingLevel.HIGH,
};

type Box = {
  box_2d: [number, number, number, number];
  label: string;
};

const BoxSchema = z.object({
  box_2d: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  label: z.string(),
});
const BoxesSchema = z.array(BoxSchema);

const BOX_COLOR = "#3b82f6";
const HIGHLIGHT_COLOR = "#facc15";
const STROKE_WIDTH = 2;
const HIGHLIGHT_STROKE = 4;
const FONT = "bold 13px sans-serif";
const LABEL_PAD_X = 6;
const LABEL_PAD_Y = 4;

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
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
  const [objects, setObjects] = useState<string[]>([]);
  const [objectInput, setObjectInput] = useState("");
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [thinkingText, setThinkingText] = useState("");
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const [usageMetadata, setUsageMetadata] = useState<Pick<
    GenerateContentResponseUsageMetadata,
    "promptTokenCount" | "candidatesTokenCount" | "thoughtsTokenCount" | "totalTokenCount"
  > | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [promptTemplate, setPromptTemplate] = useState(DEFAULT_PROMPT_TEMPLATE);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>("high");
  const [temperature, setTemperature] = useState(1);
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
    const allObjects = [...objects];
    if (objectInput.trim()) allObjects.push(objectInput.trim());
    if (!imageFile || allObjects.length === 0 || !apiKey.trim()) return;
    const object = allObjects.join(", ");
    setLoading(true);
    setError(null);
    setBoxes([]);
    setSelectedIndex(null);
    setThinkingText("");
    setThinkingOpen(false);
    setUsageMetadata(null);

    try {
      const base64 = await readFileAsBase64(imageFile);
      const mimeType = imageFile.type || "image/png";

      const ai = new GoogleGenAI({ apiKey: apiKey.trim() });

      const prompt = promptTemplate.replace(
        /\{\{object\}\}/g,
        object.trim(),
      );

      const thinkingConfig =
        thinkingLevel === "none"
          ? undefined
          : {
              thinkingLevel: SDK_THINKING_LEVEL_MAP[thinkingLevel],
              includeThoughts: true,
            };

      const stream = await ai.models.generateContentStream({
        model,
        config: {
          temperature,
          ...(thinkingConfig ? { thinkingConfig } : {}),
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

      let fullText = "";
      let fullThinking = "";
      let openedThinking = false;

      for await (const chunk of stream) {
        const candidate = chunk.candidates?.[0];
        if (
          candidate?.finishReason &&
          candidate.finishReason !== FinishReason.STOP &&
          candidate.finishReason !== FinishReason.MAX_TOKENS
        ) {
          throw new Error(`Model response blocked: ${candidate.finishReason}`);
        }

        for (const part of candidate?.content?.parts ?? []) {
          if (part.thought && part.text) {
            fullThinking += part.text;
            setThinkingText(fullThinking);
            if (!openedThinking) {
              openedThinking = true;
              setThinkingOpen(true);
            }
          } else if (part.text) {
            fullText += part.text;
          }
        }

        if (chunk.usageMetadata) {
          setUsageMetadata({
            promptTokenCount: chunk.usageMetadata.promptTokenCount,
            candidatesTokenCount: chunk.usageMetadata.candidatesTokenCount,
            thoughtsTokenCount: chunk.usageMetadata.thoughtsTokenCount,
            totalTokenCount: chunk.usageMetadata.totalTokenCount,
          });
        }
      }

      const jsonMatch = fullText.match(/\[\s*\{[\s\S]*?\}\s*\]/);
      if (!jsonMatch) {
        throw new Error("No bounding boxes found in model response");
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const detectedBoxes = BoxesSchema.parse(parsed);
      setBoxes(detectedBoxes);
    } catch (err: unknown) {
      setThinkingText("");
      setThinkingOpen(false);
      setUsageMetadata(null);
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

      const color = isSelected ? HIGHLIGHT_COLOR : BOX_COLOR;
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

  // ── API Key Screen ──────────────────────────────────────────────
  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm animate-fade-in-up">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/20">
              <ScanSearch className="size-7 text-primary" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Object Detector</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Detect objects in images using AI vision models
            </p>
          </div>

          <Card>
            <CardContent className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label htmlFor="api-key" className="flex items-center gap-2">
                  <KeyRound className="size-3.5" />
                  Gemini API Key
                </Label>
                <Input
                  id="api-key"
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveApiKey();
                  }}
                  placeholder="AIza..."
                />
              </div>
              <Button
                onClick={saveApiKey}
                disabled={!apiKeyInput.trim()}
                className="w-full"
                size="lg"
              >
                Get Started
              </Button>
            </CardContent>
          </Card>

          <div className="mt-4 flex items-start gap-2 rounded-lg bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
            <span>
              100% browser-based. Your images and key are only sent directly to
              Google's Gemini API — never to any other server.
            </span>
          </div>
        </div>
      </div>
    );
  }

  // ── Main App ────────────────────────────────────────────────────
  const hasImage = !!imageUrl;
  const hasBoxes = boxes.length > 0;
  const allObjectsForDetect = [...objects, ...(objectInput.trim() ? [objectInput.trim()] : [])];
  const canDetect = hasImage && allObjectsForDetect.length > 0 && apiKey.trim() && !loading;

  return (
    <div className="flex min-h-screen flex-col">
      {/* ── Header ── */}
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <ScanSearch className="size-5 text-primary" />
            <span className="text-sm font-semibold tracking-tight">Object Detector</span>
          </div>
          <Button variant="ghost" size="sm" onClick={clearApiKey}>
            Change API Key
          </Button>
        </div>
      </header>

      {/* ── Content ── */}
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 px-4 py-5 sm:px-6">
        {!hasImage ? (
          /* ── Upload Zone ── */
          <div className="flex flex-1 items-center justify-center">
            <div
              className={`group w-full max-w-2xl cursor-pointer rounded-2xl border-2 border-dashed p-12 text-center transition-all ${
                dragOver
                  ? "border-primary bg-primary/5 scale-[1.01]"
                  : "border-muted-foreground/20 hover:border-muted-foreground/40 hover:bg-muted/30"
              }`}
              onDragOver={(e: DragEvent) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className={`mx-auto mb-5 flex size-16 items-center justify-center rounded-2xl transition-colors ${
                dragOver ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground group-hover:bg-muted/80"
              }`}>
                <Upload className="size-7" />
              </div>
              <p className="text-base font-medium">
                Drop an image here, or click to browse
              </p>
              <p className="mt-1.5 text-sm text-muted-foreground">
                PNG, JPG, WebP, or GIF
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
          </div>
        ) : (
          /* ── Detection Interface ── */
          <>
            {/* ── Controls Bar ── */}
            <div className="flex items-center gap-2 animate-fade-in">
              {/* Tag Input */}
              <div className="flex min-h-[36px] flex-1 flex-wrap items-center gap-1.5 rounded-lg border border-input bg-card px-3 py-1.5 text-sm shadow-xs ring-ring/50 transition-shadow focus-within:ring-2">
                <Crosshair className="size-3.5 shrink-0 text-muted-foreground" />
                {objects.map((obj, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary ring-1 ring-primary/20"
                  >
                    {obj}
                    <button
                      type="button"
                      className="ml-0.5 rounded-sm p-0.5 leading-none opacity-60 transition-opacity hover:opacity-100"
                      onClick={() => setObjects(objects.filter((_, j) => j !== i))}
                    >
                      <X className="size-2.5" />
                    </button>
                  </span>
                ))}
                <input
                  value={objectInput}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val.includes(",")) {
                      const parts = val.split(",");
                      const newTags = parts.slice(0, -1).map((s) => s.trim()).filter(Boolean);
                      setObjects([...objects, ...newTags]);
                      setObjectInput(parts[parts.length - 1]!);
                    } else {
                      setObjectInput(val);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      if (objectInput.trim()) {
                        setObjects([...objects, objectInput.trim()]);
                        setObjectInput("");
                      } else {
                        handleDetect();
                      }
                    } else if (e.key === "Backspace" && !objectInput && objects.length > 0) {
                      setObjects(objects.slice(0, -1));
                    }
                  }}
                  placeholder={objects.length === 0 ? "What should I detect? e.g. cars, faces, dogs..." : "Add more..."}
                  className="min-w-[120px] flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
              </div>

              <Button
                onClick={handleDetect}
                disabled={!canDetect}
                size="lg"
                className="gap-2 shrink-0"
              >
                <ScanSearch className="size-4" />
                {loading ? "Detecting..." : "Detect"}
              </Button>

              <Button
                variant="outline"
                size="icon-lg"
                onClick={() => {
                  setImageUrl(null);
                  setImageFile(null);
                  setBoxes([]);
                  setObjects([]);
                  setObjectInput("");
                  setError(null);
                  setSelectedIndex(null);
                  setThinkingText("");
                  setThinkingOpen(false);
                  setUsageMetadata(null);
                }}
                title="Clear image and prompt"
              >
                <X className="size-4" />
              </Button>
            </div>

            {/* ── Advanced Settings ── */}
            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <CollapsibleTrigger
                render={<Button variant="ghost" size="xs" className="gap-1.5 text-muted-foreground" />}
              >
                <Settings2 className="size-3" />
                Settings
                <ChevronDown
                  className={`size-3 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
                />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <Card className="mt-2" size="sm">
                  <CardContent className="grid grid-cols-3 gap-4">
                    <div className="col-span-3 space-y-1.5">
                      <Label htmlFor="prompt-template" className="text-xs">
                        Prompt Template{" "}
                        <span className="text-muted-foreground font-normal">
                          (use {"{{object}}"} as placeholder)
                        </span>
                      </Label>
                      <Textarea
                        id="prompt-template"
                        value={promptTemplate}
                        onChange={(e) => setPromptTemplate(e.target.value)}
                        rows={2}
                        className="text-xs"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="model-select" className="text-xs">Model</Label>
                      <Select value={model} onValueChange={(v) => { if (v) setModel(v); }}>
                        <SelectTrigger id="model-select">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {AVAILABLE_MODELS.map((m) => (
                            <SelectItem key={m} value={m}>
                              {m}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="thinking-select" className="text-xs">Thinking</Label>
                      <Select
                        value={thinkingLevel}
                        onValueChange={(v) => setThinkingLevel(v as ThinkingLevel)}
                      >
                        <SelectTrigger id="thinking-select">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {THINKING_LEVELS.map((level) => (
                            <SelectItem key={level} value={level}>
                              {level.charAt(0).toUpperCase() + level.slice(1)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="temperature-slider" className="text-xs">Temperature</Label>
                        <span className="font-mono text-xs text-muted-foreground tabular-nums">
                          {temperature.toFixed(2)}
                        </span>
                      </div>
                      <Slider
                        id="temperature-slider"
                        min={0}
                        max={2}
                        step={0.05}
                        value={[temperature]}
                        onValueChange={(v) => { const val = Array.isArray(v) ? v[0] : v; if (val != null) setTemperature(val); }}
                      />
                    </div>
                  </CardContent>
                </Card>
              </CollapsibleContent>
            </Collapsible>

            {/* ── Error ── */}
            {error && (
              <Alert variant="destructive" className="animate-fade-in">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* ── Thinking / Loading Panel (above image) ── */}
            {(loading || thinkingText) && (
              <div className="animate-fade-in">
                <Collapsible open={loading || thinkingOpen} onOpenChange={setThinkingOpen}>
                  <Card size="sm">
                    <CardContent>
                      {/* Header row — always visible */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          {loading ? (
                            <>
                              <div className="size-3 rounded-full border-[1.5px] border-primary border-t-transparent animate-spin" />
                              <span className="font-medium text-foreground">
                                Detecting {allObjectsForDetect.join(", ")}...
                              </span>
                            </>
                          ) : (
                            <>
                              <Brain className="size-3" />
                              <span>Model Thinking</span>
                            </>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          {/* Token usage (inline, shown after loading completes) */}
                          {usageMetadata && !loading && (
                            <div className="flex items-center gap-3 font-mono text-[11px] text-muted-foreground">
                              <span>{usageMetadata.promptTokenCount?.toLocaleString() ?? "—"} in</span>
                              <span>{usageMetadata.candidatesTokenCount?.toLocaleString() ?? "—"} out</span>
                              {usageMetadata.thoughtsTokenCount != null && usageMetadata.thoughtsTokenCount > 0 && (
                                <span>{usageMetadata.thoughtsTokenCount.toLocaleString()} thinking</span>
                              )}
                            </div>
                          )}
                          {thinkingText && !loading && (
                            <CollapsibleTrigger
                              render={<Button variant="ghost" size="icon-xs" className="text-muted-foreground" />}
                            >
                              <ChevronDown
                                className={`size-3 transition-transform ${thinkingOpen ? "rotate-180" : ""}`}
                              />
                            </CollapsibleTrigger>
                          )}
                        </div>
                      </div>
                      {/* Streaming thinking text */}
                      {thinkingText && (
                        <CollapsibleContent>
                          <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap border-t border-border pt-2 font-mono text-xs leading-relaxed text-muted-foreground">
                            {thinkingText}
                          </pre>
                        </CollapsibleContent>
                      )}
                    </CardContent>
                  </Card>
                </Collapsible>
              </div>
            )}

            {/* ── Canvas + Sidebar ── */}
            <div className="flex justify-center">
              <div className="inline-flex items-start gap-3 max-w-full">
                {/* Canvas Area */}
                <div className="relative min-w-0">
                  <img
                    ref={imgRef}
                    src={imageUrl}
                    alt=""
                    className="hidden"
                    onLoad={onImageLoad}
                  />
                  <canvas
                    ref={canvasRef}
                    className="max-w-4xl w-full rounded-lg"
                  />

                  {/* Loading Overlay (subtle, since status is in the panel above) */}
                  {loading && (
                    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg">
                      <div className="h-0.5 w-full bg-gradient-to-r from-transparent via-primary/40 to-transparent animate-scan" />
                    </div>
                  )}
                </div>

                {/* Results Sidebar — always visible, compact */}
                <div className="w-44 shrink-0">
                  <div className="sticky top-20 space-y-1.5">
                    <div className="flex items-center justify-between px-1">
                      <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Detected</span>
                      {hasBoxes && (
                        <span className="rounded-full bg-primary/10 px-1.5 py-px font-mono text-[10px] font-semibold text-primary tabular-nums">
                          {boxes.length}
                        </span>
                      )}
                    </div>
                    {hasBoxes ? (
                      <ul className="space-y-px">
                        {boxes.map((box, i) => {
                          const isSelected = selectedIndex === i;
                          return (
                            <li key={i} className="animate-fade-in-up" style={{ animationDelay: `${i * 40}ms` }}>
                              <button
                                className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors ${
                                  isSelected
                                    ? "bg-secondary text-secondary-foreground"
                                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                                }`}
                                onClick={() =>
                                  setSelectedIndex(isSelected ? null : i)
                                }
                              >
                                <span
                                  className="size-2 shrink-0 rounded-full"
                                  style={{
                                    backgroundColor: isSelected
                                      ? HIGHLIGHT_COLOR
                                      : BOX_COLOR,
                                  }}
                                />
                                <span className="truncate">{box.label}</span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="px-1 text-xs text-muted-foreground/50">
                        No detections yet
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
