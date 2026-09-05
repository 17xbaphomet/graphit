"""Parse Graphit JSON configs."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .engine import Params

DEFAULT_MASTER = {
    "maxSize": 680,
    "edgeThreshold": 16,
    "inkThreshold": 38,
    "includeInk": True,
    "minStroke": 3,
    "levels": 10,
    "lineMs": 4800,
    "toneMs": 7200,
    "holdMs": 1600,
    "transparency": 100,
}

DEFAULT_STAGE = {"width": 1280, "height": 720}


def load_config(raw: str | dict | None) -> dict[str, Any]:
    if raw is None or raw == "":
        data: dict[str, Any] = {}
    elif isinstance(raw, dict):
        data = dict(raw)
    else:
        text = str(raw).strip()
        if not text:
            data = {}
        elif text.startswith("{") or text.startswith("["):
            data = json.loads(text)
        else:
            data = json.loads(Path(text).read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("Graphit JSON muss ein Objekt sein")
    data.setdefault("version", 1)
    data.setdefault("stage", dict(DEFAULT_STAGE))
    data.setdefault("fps", 30)
    data.setdefault("paper", [243, 238, 228])
    master = {**DEFAULT_MASTER, **(data.get("master") or {})}
    data["master"] = master
    data.setdefault("plates", [])
    return data


def params_from(master: dict, plate: dict | None = None) -> Params:
    src = dict(master)
    if plate:
        for key in DEFAULT_MASTER:
            if key in plate and plate[key] is not None:
                src[key] = plate[key]
    return Params(
        max_size=int(src["maxSize"]),
        edge_threshold=float(src["edgeThreshold"]),
        ink_threshold=int(src["inkThreshold"]),
        include_ink=bool(src["includeInk"]),
        min_stroke=int(src["minStroke"]),
        levels=max(1, int(src["levels"])),
        line_ms=int(src["lineMs"]),
        tone_ms=int(src["toneMs"]),
        hold_ms=int(src["holdMs"]),
        transparency=float(src["transparency"]),
    )


def dumps_example() -> str:
    return json.dumps(
        {
            "version": 1,
            "stage": {"width": 1280, "height": 720},
            "fps": 30,
            "paper": [243, 238, 228],
            "master": DEFAULT_MASTER,
            "plates": [
                {
                    "image": 0,
                    "kind": "image",
                    "name": "skizze",
                    "frame": {"x": 0.04, "y": 0.04, "w": 0.92, "h": 0.92},
                    "startMs": 0,
                }
            ],
        },
        indent=2,
        ensure_ascii=False,
    )
