import { EXAMPLE_CONFIG, type GraphitConfig } from "./config";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
  "cache-control": "public, max-age=120",
} as const;

export function jsonResponse(data: unknown, extra?: HeadersInit): Response {
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...CORS,
      ...extra,
    },
  });
}

export function textResponse(body: string, type: string): Response {
  return new Response(body, {
    headers: {
      "content-type": `${type}; charset=utf-8`,
      ...CORS,
    },
  });
}

export function optionsResponse(): Response {
  return new Response(null, { status: 204, headers: { ...CORS } });
}

const masterProps = {
  maxSize: {
    type: "integer",
    minimum: 128,
    maximum: 3840,
    default: 680,
    description:
      "Längste Seite der Analyse in Pixeln. Bis 4K (3840). Höher = schärfer, langsamer.",
  },
  edgeThreshold: {
    type: "number",
    minimum: 0,
    maximum: 100,
    default: 16,
    description: "Anteil der Peak-Sobel-Stärke, der als Linie gilt (0–100).",
  },
  inkThreshold: {
    type: "integer",
    minimum: 0,
    maximum: 255,
    default: 38,
    description: "Pixel dunkler als dieser Grauwert werden als Tusche gezeichnet.",
  },
  includeInk: {
    type: "boolean",
    default: true,
    description: "Dunkle Konturen zusätzlich zu Kanten in die Linienphase nehmen.",
  },
  minStroke: {
    type: "integer",
    minimum: 1,
    maximum: 80,
    default: 3,
    description: "Striche kürzer als dieser Pixelwert entfallen.",
  },
  levels: {
    type: "integer",
    minimum: 1,
    maximum: 24,
    default: 10,
    description: "Anzahl Tonstufen, dunkel zuerst.",
  },
  lineMs: {
    type: "integer",
    minimum: 0,
    maximum: 60000,
    default: 4800,
    description: "Dauer der Linienphase in Millisekunden.",
  },
  toneMs: {
    type: "integer",
    minimum: 0,
    maximum: 60000,
    default: 7200,
    description: "Dauer der Tonschraffur in Millisekunden.",
  },
  holdMs: {
    type: "integer",
    minimum: 0,
    maximum: 30000,
    default: 1600,
    description: "Haltezeit des fertigen Bildes in Millisekunden.",
  },
  transparency: {
    type: "number",
    minimum: 0,
    maximum: 100,
    default: 100,
    description:
      "0–100. Papier/Weiß werden durchsichtig, damit Überlappungen nichts zudecken.",
  },
} as const;

const frameSchema = {
  type: "object",
  additionalProperties: false,
  required: ["x", "y", "w", "h"],
  properties: {
    x: { type: "number", description: "Linke Kante relativ zur Bühne (0–1, darf negativ sein)." },
    y: { type: "number", description: "Obere Kante relativ zur Bühne." },
    w: { type: "number", description: "Breite relativ zur Bühne. Darf >1 sein (Beschnitt)." },
    h: { type: "number", description: "Höhe relativ zur Bühne." },
  },
} as const;

const textSchema = {
  type: "object",
  additionalProperties: false,
  required: ["content"],
  properties: {
    content: { type: "string", description: "Text, der als eigene Platte geschrieben wird." },
    fontFamily: { type: "string", default: "DejaVu Serif" },
    fontWeight: { type: "integer", minimum: 100, maximum: 900, default: 400 },
    italic: { type: "boolean", default: false },
    speed: {
      type: "number",
      minimum: 0.25,
      maximum: 2.5,
      default: 1,
      description: "Schreibtempo. 1 = normal.",
    },
  },
} as const;

export const GRAPHIT_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "/api/schema",
  title: "GraphitConfig",
  description:
    "Steuert Graphit vollständig: Bühne, Zeiten, Erkennung, Platten. Bilder kommen separat (Comfy IMAGE oder Studio-Upload). Ein gesetztes Feld auf einer Platte überschreibt den Master.",
  type: "object",
  additionalProperties: false,
  required: ["master", "plates"],
  properties: {
    version: { type: "integer", const: 1, default: 1 },
    stage: {
      type: "object",
      additionalProperties: false,
      properties: {
        width: { type: "integer", minimum: 256, maximum: 3840, default: 1280 },
        height: { type: "integer", minimum: 256, maximum: 2160, default: 720 },
      },
    },
    fps: { type: "integer", minimum: 1, maximum: 60, default: 30 },
    paper: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: { type: "integer", minimum: 0, maximum: 255 },
      default: [243, 238, 228],
      description: "Papierfarbe RGB.",
    },
    master: {
      type: "object",
      additionalProperties: false,
      description: "Standardwerte für alle Platten.",
      properties: masterProps,
    },
    plates: {
      type: "array",
      description:
        "Zeichenebenen. image-Index = Reihenfolge der angeschlossenen Bilder (0 = erstes IMAGE).",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "frame", "startMs"],
        properties: {
          image: {
            type: "integer",
            minimum: 0,
            description: "Index des Bildes. Pflicht bei kind=image.",
          },
          kind: { type: "string", enum: ["image", "text"], default: "image" },
          name: { type: "string" },
          frame: frameSchema,
          startMs: {
            type: "integer",
            minimum: 0,
            description: "Start auf der Timeline in Millisekunden.",
          },
          ...masterProps,
          text: textSchema,
        },
      },
    },
  },
  examples: [EXAMPLE_CONFIG],
} as const;

export const GRAPHIT_TOOL = {
  type: "function",
  function: {
    name: "graphit_config",
    description:
      "Erzeugt oder ändert die Graphit-Steuerung. Das JSON bestimmt Bühne, Zeiten, Kantenerkennung und alle Platten. Bilder werden nicht im JSON übergeben, sondern als IMAGE-Eingänge (Comfy) bzw. Uploads (Studio). Felder auf plates[] überschreiben master, sobald sie gesetzt sind. Ablauf: zuerst Linien, dann Tonwerte dunkel zuerst, dann Hold.",
    parameters: GRAPHIT_JSON_SCHEMA,
  },
  endpoints: [
    {
      url: "/llms.txt",
      method: "GET",
      format: "text/markdown",
      description: "Markdown: Endpunkte, Felder, Regeln, Beispiele.",
    },
    {
      url: "/api/tool",
      method: "GET",
      format: "application/json",
      description: "Dasselbe als JSON für Function Calling.",
    },
    {
      url: "/api/schema",
      method: "GET",
      format: "application/json",
      description: "JSON-Schema der Anfrage (GraphitConfig).",
    },
  ],
  rules: [
    "Bilder nie base64 ins JSON — nur Indizes (plates[].image).",
    "Ein Schlüssel auf der Platte überschreibt den Master; fehlende Schlüssel erben.",
    "kind=text braucht kein image, dafür text.content.",
    "frame ist relativ zur Bühne (0–1). Werte außerhalb schneiden ab.",
    "startMs legt die zeitliche Lage fest; Dauer = lineMs + toneMs + holdMs (Text: toneMs=0, lineMs aus speed).",
    "Linienphase zeichnet nur Pixel ≤ 158 Grau; hellere Flächen kommen in der Tonphase.",
    "transparency 100 macht Papier durchsichtig bei Überlappungen.",
    "stage bis 3840×2160 (4K UHD). maxSize begrenzt die Analyse, nicht die Ausgabefläche.",
    "Comfy: custom_nodes/graphit, Node Graphit Animate, config-String = dieses JSON.",
  ],
  examples: {
    single: EXAMPLE_CONFIG,
    overlap: {
      version: 1,
      stage: { width: 1920, height: 1080 },
      fps: 30,
      master: EXAMPLE_CONFIG.master,
      plates: [
        {
          image: 0,
          kind: "image",
          name: "hinten",
          frame: { x: 0.02, y: 0.05, w: 0.6, h: 0.9 },
          startMs: 0,
        },
        {
          image: 1,
          kind: "image",
          name: "vorn",
          frame: { x: 0.38, y: 0.08, w: 0.58, h: 0.84 },
          startMs: 3500,
          transparency: 100,
          lineMs: 3200,
        },
        {
          kind: "text",
          name: "titel",
          frame: { x: 0.08, y: 0.82, w: 0.84, h: 0.14 },
          startMs: 11000,
          text: {
            content: "Graphit",
            fontFamily: "DejaVu Serif",
            fontWeight: 400,
            italic: false,
            speed: 1,
          },
        },
      ],
    } satisfies GraphitConfig,
  },
} as const;

export function graphitLlmsTxt(origin = ""): string {
  const base = origin.replace(/\/$/, "");
  return `# Graphit — LLM-Steuerung

Graphit zeichnet Graustufenbilder: zuerst zusammenhängende schwarze Linien, danach Tonwerte dunkel zuerst. Alles außer den Pixeldaten steuert ein JSON (\`GraphitConfig\`).

## Endpunkte

| URL | Format |
| --- | --- |
| ${base}/llms.txt | Markdown, Endpunkte, Felder, Regeln, Beispiele |
| ${base}/api/tool | dasselbe als JSON für Function Calling |
| ${base}/api/schema | JSON-Schema der Anfrage |

CORS: \`Access-Control-Allow-Origin: *\`. Nur GET.

## ComfyUI

Node \`Graphit Animate\`: Eingänge \`image\` … \`image_4\` plus \`config\` (dieses JSON). Optional \`json_file\` (Pfad). Ausgabe: Frame-Batch, frame_count, duration_ms.

Node \`Graphit Config JSON\`: Slider → JSON-String.

Paket: \`comfy_graphit/\` nach \`ComfyUI/custom_nodes/graphit\`.

## Felder

### Wurzel

| Feld | Typ | Default | Regel |
| --- | --- | --- | --- |
| version | 1 | 1 | fest |
| stage.width | int | 1280 | 256–3840 |
| stage.height | int | 720 | 256–2160 |
| fps | int | 30 | 1–60 |
| paper | [R,G,B] | [243,238,228] | Papierfarbe |
| master | object | siehe unten | gilt für alle Platten |
| plates | array | [] | leer = ein Frame pro Bild, nacheinander |

### master und Platten-Overrides

Auf der Platte denselben Schlüssel setzen = Eigenwert, Master ignorieren.

| Feld | Default | Bedeutung |
| --- | --- | --- |
| maxSize | 680 | Analyse-Auflösung, längste Seite, bis 3840 |
| edgeThreshold | 16 | Sobel-Schwelle 0–100 |
| inkThreshold | 38 | Tusche-Grau 0–255 |
| includeInk | true | dunkle Konturen mitzeichnen |
| minStroke | 3 | Mindestlänge in Pixeln |
| levels | 10 | Tonstufen, dunkel zuerst |
| lineMs | 4800 | Linienphase ms |
| toneMs | 7200 | Tonphase ms |
| holdMs | 1600 | Halten ms |
| transparency | 100 | Papier ausstanzen 0–100 |

### plates[]

| Feld | Pflicht | Bedeutung |
| --- | --- | --- |
| kind | ja | \`image\` oder \`text\` |
| image | bei image | Index des angeschlossenen Bildes, 0-basiert |
| name | nein | Anzeigename |
| frame | ja | {x,y,w,h} relativ zur Bühne, darf überstehen |
| startMs | ja | Timeline-Start |
| text | bei text | {content, fontFamily, fontWeight, italic, speed} |

## Regeln

1. Keine Bilddaten im JSON. Nur Indizes.
2. Gesetztes Plattenfeld schlägt Master. Fehlendes Feld erbt.
3. \`kind=text\` ohne \`image\`. \`text.content\` ist Pflicht.
4. Zeichenreihenfolge fest: Linien → Töne (dunkel→hell, gleiche Tour) → Hold.
5. Linienphase malt nur Pixel mit Grau ≤ 158.
6. Überlappende Rahmen: höhere Transparenz lässt die untere Zeichnung stehen.
7. \`startMs\` verschiebt Platten auf der Timeline; Gesamtdauer = max(startMs + lineMs + toneMs + holdMs).
8. Text: \`toneMs\` wird 0, \`lineMs\` folgt aus Pixelzahl und \`speed\` (0.25–2.5).

## Beispiele

Einzelbild:

\`\`\`json
${JSON.stringify(EXAMPLE_CONFIG, null, 2)}
\`\`\`

Zwei Bilder + Text (siehe auch ${base}/api/tool → examples.overlap).

Studio exportiert dasselbe JSON über den Button **Comfy JSON**.
`;
}
