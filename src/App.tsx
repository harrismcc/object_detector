import {
  useState,
  useRef,
  useCallback,
  useEffect,
  type DragEvent,
} from "react";
import { GoogleGenAI, ThinkingLevel as SDKThinkingLevel, FinishReason } from "@google/genai";
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
import { ChevronDown, Brain, Coins } from "lucide-react";

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
  "#ef4444", "#3b82f6", "#22c55e", "#f59e0b",
  "#a855f7", "#06b6d4", "#ec4899", "#f97316",
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
  const [usageMetadata, setUsageMetadata] = useState<{
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    totalTokenCount?: number;
  } | null>(null);
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

      const sdkThinkingLevelMap: Record<Exclude<ThinkingLevel, "none">, SDKThinkingLevel> = {
        low: SDKThinkingLevel.LOW,
        medium: SDKThinkingLevel.MEDIUM,
        high: SDKThinkingLevel.HIGH,
      };

      const thinkingConfig =
        thinkingLevel === "none"
          ? undefined
          : {
              thinkingLevel: sdkThinkingLevelMap[thinkingLevel],
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

        // Accumulate thinking and text from each chunk
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

        // Capture usage metadata from the final chunk
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
        <Card>
          <CardHeader>
            <CardTitle className="text-3xl">Object Detector</CardTitle>
            <CardDescription>
              Detect objects in images using the Gemini API. Everything runs 100%
              in your browser — your images and API key are never sent to any
              server other than Google's Gemini API directly.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="api-key">Gemini API Key</Label>
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
              Continue
            </Button>
            <p className="text-xs text-muted-foreground">
              Your key is saved in your browser's local storage so you don't have
              to enter it again. It is never sent anywhere except directly to
              Google's API from your browser.
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="max-w-6xl mx-auto px-4 py-12">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold">Object Detector</h1>
        <Button variant="ghost" size="sm" onClick={clearApiKey}>
          Change API Key
        </Button>
      </div>

      {!imageUrl ? (
        <Card
          className="cursor-pointer transition-colors"
          onDragOver={(e: DragEvent) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <CardContent
            className={`flex items-center justify-center py-16 border-2 border-dashed rounded-xl transition-colors ${
              dragOver
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/25 hover:border-muted-foreground/50"
            }`}
          >
            <p className="text-lg text-muted-foreground">
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
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="flex gap-3">
            <div className="flex-1 flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs focus-within:ring-1 focus-within:ring-ring">
              {objects.map((obj, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-0.5 text-sm text-secondary-foreground"
                >
                  {obj}
                  <button
                    type="button"
                    className="ml-0.5 rounded-sm hover:bg-muted-foreground/20 p-0.5 leading-none"
                    onClick={() => setObjects(objects.filter((_, j) => j !== i))}
                  >
                    &times;
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
                placeholder={objects.length === 0 ? "What do you want to detect? (e.g. cars, faces, dogs)" : "Add more..."}
                className="flex-1 min-w-[120px] bg-transparent outline-none placeholder:text-muted-foreground"
              />
            </div>
            <Button
              onClick={handleDetect}
              disabled={loading || (objects.length === 0 && !objectInput.trim()) || !apiKey.trim()}
              size="lg"
            >
              {loading ? "Detecting..." : "Detect"}
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={() => {
                setImageUrl(null);
                setImageFile(null);
                setBoxes([]);
                setObjects([]);
                setObjectInput("");
                setError(null);
                setSelectedIndex(null);
              }}
            >
              Clear
            </Button>
          </div>

          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger
              render={<Button variant="ghost" size="sm" className="gap-2 text-muted-foreground" />}
            >
              <ChevronDown
                className={`h-4 w-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
              />
              Advanced Settings
            </CollapsibleTrigger>
            <CollapsibleContent>
              <Card className="mt-2">
                <CardContent className="grid grid-cols-2 gap-4 pt-4">
                  <div className="col-span-2 space-y-2">
                    <Label htmlFor="prompt-template">
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
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="model-select">Model</Label>
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

                  <div className="space-y-2">
                    <Label htmlFor="thinking-select">Thinking Level</Label>
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

                  <div className="col-span-2 space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="temperature-slider">Temperature</Label>
                      <span className="text-sm text-muted-foreground tabular-nums">
                        {temperature.toFixed(2)}
                      </span>
                    </div>
                    <Slider
                      id="temperature-slider"
                      min={0}
                      max={2}
                      step={0.05}
                      value={[temperature]}
                      onValueChange={(v) => setTemperature(Array.isArray(v) ? v[0]! : v)}
                    />
                  </div>
                </CardContent>
              </Card>
            </CollapsibleContent>
          </Collapsible>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {(thinkingText || usageMetadata) && (
            <div className="space-y-2">
              {thinkingText && (
                <Collapsible open={thinkingOpen} onOpenChange={setThinkingOpen}>
                  <CollapsibleTrigger
                    render={<Button variant="ghost" size="sm" className="gap-2 text-muted-foreground" />}
                  >
                    <Brain className="h-4 w-4" />
                    <ChevronDown
                      className={`h-4 w-4 transition-transform ${thinkingOpen ? "rotate-180" : ""}`}
                    />
                    Model Thinking
                    {loading && (
                      <div className="w-3 h-3 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
                    )}
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <Card className="mt-1">
                      <CardContent className="pt-4">
                        <pre className="whitespace-pre-wrap text-sm text-muted-foreground font-mono max-h-64 overflow-y-auto">
                          {thinkingText}
                        </pre>
                      </CardContent>
                    </Card>
                  </CollapsibleContent>
                </Collapsible>
              )}

              {usageMetadata && !loading && (
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <Coins className="h-3.5 w-3.5" />
                  <span>Prompt: {usageMetadata.promptTokenCount?.toLocaleString() ?? "—"} tokens</span>
                  <span>Output: {usageMetadata.candidatesTokenCount?.toLocaleString() ?? "—"} tokens</span>
                  {usageMetadata.thoughtsTokenCount != null && usageMetadata.thoughtsTokenCount > 0 && (
                    <span>Thinking: {usageMetadata.thoughtsTokenCount.toLocaleString()} tokens</span>
                  )}
                  <span className="font-medium text-foreground">
                    Total: {usageMetadata.totalTokenCount?.toLocaleString() ?? "—"} tokens
                  </span>
                </div>
              )}
            </div>
          )}

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
                <div className="absolute inset-0 bg-background/50 rounded-lg flex items-center justify-center">
                  <Card className="flex-row items-center gap-3 px-5 py-3">
                    <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    <span>Detecting {[...objects, objectInput.trim()].filter(Boolean).join(", ")}...</span>
                  </Card>
                </div>
              )}
            </div>

            {boxes.length > 0 && (
              <Card className="w-64 shrink-0 h-fit">
                <CardHeader>
                  <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">
                    Detected ({boxes.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1">
                    {boxes.map((box, i) => {
                      const isSelected = selectedIndex === i;
                      return (
                        <li key={i}>
                          <Button
                            variant={isSelected ? "secondary" : "ghost"}
                            className="w-full justify-start gap-3"
                            onClick={() =>
                              setSelectedIndex(isSelected ? null : i)
                            }
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
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
