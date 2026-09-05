"""ComfyUI nodes: images + JSON in, frame batch out."""

from __future__ import annotations

import json

import numpy as np
import torch

from .engine import (
    Plate,
    analyze_rgb,
    composition_ms,
    raster_text,
    render_frame,
    resize_max,
)
from .schema import dumps_example, load_config, params_from

CATEGORY = "graphit"


def _tensor_to_rgb(t: torch.Tensor) -> np.ndarray:
    if t.ndim == 4:
        t = t[0]
    arr = t.detach().cpu().numpy()
    if arr.max() <= 1.01:
        arr = arr * 255.0
    return np.clip(arr, 0, 255).astype(np.uint8)


def _images_from(kwargs: dict) -> list[np.ndarray]:
    out: list[np.ndarray] = []
    for i in range(8):
        key = "image" if i == 0 else f"image_{i}"
        val = kwargs.get(key)
        if val is None:
            continue
        if isinstance(val, torch.Tensor) and val.ndim == 4 and val.shape[0] > 1 and i == 0:
            for b in range(int(val.shape[0])):
                out.append(_tensor_to_rgb(val[b]))
        else:
            out.append(_tensor_to_rgb(val))
    return out


def _build_plates(cfg: dict, images: list[np.ndarray]) -> list[Plate]:
    master = cfg["master"]
    specs = cfg.get("plates") or []
    if not specs:
        specs = [
            {
                "image": i,
                "kind": "image",
                "name": f"bild-{i}",
                "frame": {"x": 0.04, "y": 0.04, "w": 0.92, "h": 0.92},
                "startMs": 0,
            }
            for i in range(len(images))
        ]
        if len(specs) > 1:
            n = len(specs)
            for i, s in enumerate(specs):
                col = i % 2
                row = (i // 2) % 2
                s["frame"] = {
                    "x": 0.04 + col * 0.48,
                    "y": 0.06 + row * 0.46,
                    "w": 0.44 if n > 1 else 0.92,
                    "h": 0.42 if n > 1 else 0.92,
                }
    plates: list[Plate] = []
    for spec in specs:
        p = params_from(master, spec)
        kind = spec.get("kind") or ("text" if spec.get("text") else "image")
        if kind == "text":
            rgb = raster_text(spec.get("text") or {}, p)
        else:
            idx = int(spec.get("image", 0))
            if idx < 0 or idx >= len(images):
                raise ValueError(f"JSON image:{idx} — nur {len(images)} Bild(er) angeschlossen")
            rgb = resize_max(images[idx], p.max_size)
        job = analyze_rgb(rgb, p)
        if kind == "text" and spec.get("text", {}).get("speed"):
            speed = float(spec["text"]["speed"])
            pix = max(1, int(job.line_order.size))
            p.line_ms = int(min(28000, max(700, (pix / 7000) * (4800 / max(0.25, min(2.5, speed))))))
            p.tone_ms = 0
        plates.append(
            Plate(
                name=str(spec.get("name") or kind),
                kind=kind,
                frame=spec.get("frame") or {"x": 0.04, "y": 0.04, "w": 0.92, "h": 0.92},
                start_ms=int(spec.get("startMs") or 0),
                params=p,
                job=job,
                text=spec.get("text"),
            )
        )
    return plates


def _frames_to_tensor(frames: list[np.ndarray]) -> torch.Tensor:
    stack = np.stack(frames, axis=0).astype(np.float32) / 255.0
    return torch.from_numpy(stack)


class GraphitAnimate:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "config": (
                    "STRING",
                    {
                        "multiline": True,
                        "default": dumps_example(),
                        "dynamicPrompts": False,
                    },
                ),
            },
            "optional": {
                "image_1": ("IMAGE",),
                "image_2": ("IMAGE",),
                "image_3": ("IMAGE",),
                "image_4": ("IMAGE",),
                "json_file": ("STRING", {"default": ""}),
                "fps": ("INT", {"default": 0, "min": 0, "max": 60, "step": 1}),
            },
        }

    RETURN_TYPES = ("IMAGE", "INT", "INT")
    RETURN_NAMES = ("frames", "frame_count", "duration_ms")
    FUNCTION = "run"
    CATEGORY = CATEGORY

    def run(self, image, config, image_1=None, image_2=None, image_3=None, image_4=None, json_file="", fps=0):
        raw = json_file.strip() if json_file and str(json_file).strip() else config
        cfg = load_config(raw)
        if fps and int(fps) > 0:
            cfg["fps"] = int(fps)
        images = _images_from(
            {
                "image": image,
                "image_1": image_1,
                "image_2": image_2,
                "image_3": image_3,
                "image_4": image_4,
            }
        )
        plates = _build_plates(cfg, images)
        stage = cfg["stage"]
        sw, sh = int(stage["width"]), int(stage["height"])
        duration = composition_ms(plates)
        rate = max(1, int(cfg.get("fps") or 30))
        n = max(1, round((duration / 1000.0) * rate))
        frames = []
        for i in range(n):
            t = (i / rate) * 1000.0
            frames.append(render_frame((sw, sh), plates, t))
        return (_frames_to_tensor(frames), n, duration)


class GraphitConfigJSON:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "width": ("INT", {"default": 1280, "min": 256, "max": 3840, "step": 8}),
                "height": ("INT", {"default": 720, "min": 256, "max": 2160, "step": 8}),
                "fps": ("INT", {"default": 30, "min": 1, "max": 60}),
                "maxSize": ("INT", {"default": 680, "min": 128, "max": 3840, "step": 8}),
                "edgeThreshold": ("FLOAT", {"default": 16.0, "min": 0, "max": 100, "step": 0.5}),
                "inkThreshold": ("INT", {"default": 38, "min": 0, "max": 255}),
                "includeInk": ("BOOLEAN", {"default": True}),
                "minStroke": ("INT", {"default": 3, "min": 1, "max": 40}),
                "levels": ("INT", {"default": 10, "min": 1, "max": 24}),
                "lineMs": ("INT", {"default": 4800, "min": 0, "max": 60000, "step": 100}),
                "toneMs": ("INT", {"default": 7200, "min": 0, "max": 60000, "step": 100}),
                "holdMs": ("INT", {"default": 1600, "min": 0, "max": 30000, "step": 100}),
                "transparency": ("INT", {"default": 100, "min": 0, "max": 100}),
            },
            "optional": {
                "plates_json": (
                    "STRING",
                    {
                        "multiline": True,
                        "default": '[{"image":0,"kind":"image","name":"skizze","frame":{"x":0.04,"y":0.04,"w":0.92,"h":0.92},"startMs":0}]',
                        "dynamicPrompts": False,
                    },
                ),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("config",)
    FUNCTION = "build"
    CATEGORY = CATEGORY

    def build(self, width, height, fps, maxSize, edgeThreshold, inkThreshold, includeInk, minStroke, levels, lineMs, toneMs, holdMs, transparency, plates_json="[]"):
        plates = json.loads(plates_json or "[]")
        cfg = {
            "version": 1,
            "stage": {"width": int(width), "height": int(height)},
            "fps": int(fps),
            "paper": [243, 238, 228],
            "master": {
                "maxSize": int(maxSize),
                "edgeThreshold": float(edgeThreshold),
                "inkThreshold": int(inkThreshold),
                "includeInk": bool(includeInk),
                "minStroke": int(minStroke),
                "levels": int(levels),
                "lineMs": int(lineMs),
                "toneMs": int(toneMs),
                "holdMs": int(holdMs),
                "transparency": int(transparency),
            },
            "plates": plates,
        }
        return (json.dumps(cfg, ensure_ascii=False, indent=2),)


NODE_CLASS_MAPPINGS = {
    "GraphitAnimate": GraphitAnimate,
    "GraphitConfigJSON": GraphitConfigJSON,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "GraphitAnimate": "Graphit Animate",
    "GraphitConfigJSON": "Graphit Config JSON",
}
