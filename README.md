# Graphit

Zeichenanimation aus einem Graustufenbild.

Zuerst zieht eine Hand die schwarzen Linien — ein zusammenhängender Zug, Form für Form. Danach legt dieselbe Hand die Tonwerte, dunkel zuerst, als Schraffur den Flächen entlang.

## Lokal starten

```bash
npm install
npm run dev
```

Öffnet die Studio-Oberfläche (Port 8080). Bild laden oder eine der Vorlagen wählen, abspielen, als WebM exportieren.

## Einstellungen

| Gruppe | Parameter |
| --- | --- |
| Bild | Auflösung bis **4K UHD** (3840 px längste Seite), Presets HD / FHD / QHD / 4K |
| Ablauf | Liniendauer, Tondauer, Halten, Schleife |
| Erkennung | Tonstufen, Kanten, Tusche, Feinstriche, dunkle Konturen |

Änderungen an Bild und Erkennung gelten nach **Änderungen anwenden**. Ablauf wirkt sofort.

## Technik

- React 19, TanStack Start, Vite, Tailwind v4
- Kantenerkennung (Sobel) + Kontur-Tracing
- Zeichenreihenfolge: nächster Strich zur Stiftposition
- Tonstufen werden genauso abgelaufen, nicht als Welle
- Export über `MediaRecorder` (WebM)

## Lizenz

Privat / nach Absprache.
