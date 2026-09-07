# Graphit für ComfyUI

Ordner nach `ComfyUI/custom_nodes/graphit` kopieren und Comfy neu starten.

## Nodes

**Graphit Animate**
- `image` … `image_7` — Platten (Reihenfolge = JSON-`image`-Index). Studio-UI und Engine können acht Bilder; die Node zeigt dieselben acht Sockets.
- `config` — JSON, das **alles** steuert (Bühne, Zeiten, Erkennung, Frames)
- `json_file` — optionaler Pfad zu einer `.json` (überschreibt das Textfeld)
- `fps` — `0` = Wert aus JSON

Ausgabe: `frames` (IMAGE-Batch), `frame_count`, `duration_ms`.

Ein Board mit sechs Bildplatten: `image` … `image_5` verdrahten, in der Config `"image": 0` … `"image": 5`. Ob der Abschnitt Familie, Krieg oder eine Rede ist, entscheidet nicht Graphit.

**Graphit Config JSON** — Slider → JSON-String, den du in Animate steckst. `plates_json` ist das Array der Platten.

## JSON

Felder auf einer Platte überschreiben den Master, sobald sie gesetzt sind.

```json
{
  "version": 1,
  "stage": { "width": 1280, "height": 720 },
  "fps": 30,
  "master": { "maxSize": 680, "lineMs": 4800, "toneMs": 7200, "holdMs": 1600, "transparency": 100, "levels": 10, "edgeThreshold": 16, "inkThreshold": 38, "includeInk": true, "minStroke": 3 },
  "plates": [
    { "image": 0, "kind": "image", "name": "skizze", "frame": { "x": 0.04, "y": 0.04, "w": 0.92, "h": 0.92 }, "startMs": 0 }
  ]
}
```

Text-Platte ohne Bild:

```json
{ "kind": "text", "name": "titel", "startMs": 8000, "frame": { "x": 0.1, "y": 0.8, "w": 0.8, "h": 0.15 }, "text": { "content": "Graphit", "fontFamily": "DejaVu Serif", "fontWeight": 400, "italic": false, "speed": 1 } }
```

Das Studio exportiert dasselbe JSON (Button **Comfy JSON**).
