# Graphit

Zeichenanimation aus Graustufenbildern — im Studio oder als **ComfyUI-Node**.

Zuerst die schwarzen Linien als Zug, dann die Tonwerte dunkel zuerst.

## Studio

```bash
npm install
npm run dev
```

Bild laden, Rahmen und Zeiten setzen, **Comfy JSON** exportieren.

## ComfyUI

Ordner [`comfy_graphit/`](comfy_graphit/) nach `ComfyUI/custom_nodes/graphit` kopieren.

- **Graphit Animate** — `IMAGE` + JSON → Frame-Batch
- **Graphit Config JSON** — Slider bauen das JSON

Bilder gehen in `image` / `image_1` / … JSON legt Bühne, Zeiten, Frames, Master und Textplatten fest. Beispiel: [`comfy_graphit/example.json`](comfy_graphit/example.json).

Platte überschreibt den Master, sobald das Feld im JSON steht.

## LLM-Steuerung

| URL | Format |
| --- | --- |
| [/llms.txt](/llms.txt) | Markdown, Endpunkte, Felder, Regeln, Beispiele |
| [/api/tool](/api/tool) | dasselbe als JSON für Function Calling |
| [/api/schema](/api/schema) | JSON-Schema der Anfrage |

| Feld | Bedeutung |
| --- | --- |
| `stage.width/height` | Ausgabefläche bis 4K |
| `fps` | Frames |
| `master.*` | Erkennung + Zeiten für alle Platten |
| `plates[].image` | Index des angeschlossenen Bildes |
| `plates[].frame` | relative Lage `x,y,w,h` (0–1, darf überstehen) |
| `plates[].startMs` | Start auf der Timeline |
| `plates[].kind` | `image` oder `text` |

## Lizenz

Privat / nach Absprache.
