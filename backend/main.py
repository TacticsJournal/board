from __future__ import annotations

from typing import Any

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Tactics Board Mapper API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://tactics-board-mapper.pages.dev",
        "https://board.tacticsjournal.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/health")
def health() -> dict[str, str]:
    return {"ok": "true"}


class Point(BaseModel):
    x: float
    y: float


class MapRequest(BaseModel):
    source_points: list[Point]
    target_points: list[Point]
    points: list[Point]


@app.post("/api/map-points")
def map_points(req: MapRequest) -> dict[str, Any]:
    if len(req.source_points) < 4 or len(req.target_points) < 4:
        raise HTTPException(status_code=400, detail="At least four source and target points are required")
    if len(req.source_points) != len(req.target_points):
        raise HTTPException(status_code=400, detail="source_points and target_points must have the same length")

    src = np.array([[p.x, p.y] for p in req.source_points], dtype=np.float32)
    dst = np.array([[p.x, p.y] for p in req.target_points], dtype=np.float32)
    h, mask = cv2.findHomography(src, dst, method=0)
    if h is None:
        raise HTTPException(status_code=400, detail="Could not compute homography from those reference points")

    pts = np.array([[[p.x, p.y]] for p in req.points], dtype=np.float32)
    mapped = cv2.perspectiveTransform(pts, h).reshape((-1, 2))
    return {
        "homography": h.tolist(),
        "mapped": [{"x": float(x), "y": float(y)} for x, y in mapped],
        "inlier_mask": mask.flatten().astype(int).tolist() if mask is not None else None,
    }
