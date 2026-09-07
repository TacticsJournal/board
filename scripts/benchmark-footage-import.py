#!/usr/bin/env python3
"""Offline benchmark for the pinned Roboflow soccer models.

The normal command runs the measured 1280px path. Use --worker only through
the parent process. --verify checks the committed, generated artifacts without
importing Ultralytics.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import resource
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "scripts/fixtures/match-real.jpg"
OUT = ROOT / "docs/research/footage-import"
SAMPLES = OUT / "samples"
OVERLAYS = OUT / "overlays"
PLAYER_MODEL = Path("/tmp/roboflow-models/player.pt")
PITCH_MODEL = Path("/tmp/roboflow-models/pitch.pt")
UPSTREAM_COMMIT = "42c80c06b6b65a7f89455b89fe31cdf4c38ba227"
MODEL_URLS = {
    "player": "https://drive.google.com/uc?id=17PXFNlx-jI7VjVo_vQnB1sONjRyvoB-q",
    "pitch": "https://drive.google.com/uc?id=1Ma5Kt86tgpdjCTKfum79YMgNnSjcoOyf",
}

# Complete visual foot-point labels for the 20 visible players in the source
# fixture. `team` records only the visible jersey-color group, not identity or
# verified club membership. The black-clad referee is excluded. One goalkeeper
# and one opposing outfield player are off screen or not separable, so this is
# not a 22-player claim.
MANUAL_PLAYERS = [
    {"id": "red-01", "team": "red", "foot_px": [459, 410]},
    {"id": "red-02", "team": "red", "foot_px": [544, 418]},
    {"id": "red-03", "team": "red", "foot_px": [554, 411]},
    {"id": "red-04", "team": "red", "foot_px": [631, 418]},
    {"id": "red-05", "team": "red", "foot_px": [668, 410]},
    {"id": "red-06", "team": "red", "foot_px": [742, 401]},
    {"id": "red-07", "team": "red", "foot_px": [770, 407]},
    {"id": "red-08", "team": "red", "foot_px": [851, 414]},
    {"id": "red-09", "team": "red", "foot_px": [945, 402]},
    {"id": "red-10", "team": "red", "foot_px": [1029, 410]},
    {"id": "yellow-01", "team": "yellow", "foot_px": [480, 410]},
    {"id": "yellow-02", "team": "yellow", "foot_px": [492, 412]},
    {"id": "yellow-03", "team": "yellow", "foot_px": [593, 410]},
    {"id": "yellow-04", "team": "yellow", "foot_px": [619, 416]},
    {"id": "yellow-05", "team": "yellow", "foot_px": [681, 407]},
    {"id": "yellow-06", "team": "yellow", "foot_px": [759, 408]},
    {"id": "yellow-07", "team": "yellow", "foot_px": [882, 403]},
    {"id": "yellow-08", "team": "yellow", "foot_px": [892, 413]},
    {"id": "yellow-09", "team": "yellow", "foot_px": [905, 403]},
    {"id": "goalkeeper", "team": "green_goalkeeper", "foot_px": [1008, 586]},
]

# Roboflow Sports `SoccerPitchConfiguration.vertices`, in centimeters.
PITCH_VERTICES = [
    [0, 0], [0, 1450], [0, 2584], [0, 4416], [0, 5550], [0, 7000],
    [550, 2584], [550, 4416], [1100, 3500], [2015, 1450], [2015, 2584],
    [2015, 4416], [2015, 5550], [6000, 0], [6000, 2585], [6000, 4415],
    [6000, 7000], [9985, 1450], [9985, 2584], [9985, 4416], [9985, 5550],
    [10900, 3500], [11450, 2584], [11450, 4416], [12000, 0], [12000, 1450],
    [12000, 2584], [12000, 4416], [12000, 5550], [12000, 7000],
    [5085, 3500], [6915, 3500],
]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def json_dump(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def make_samples() -> list[dict[str, Any]]:
    from PIL import Image, ImageEnhance, ImageDraw

    image = Image.open(SOURCE).convert("RGB")
    SAMPLES.mkdir(parents=True, exist_ok=True)
    original = SAMPLES / "match-real.jpg"
    image.save(original, quality=92, optimize=True)

    partial = image.crop((320, 330, 1280, 853))
    partial.save(SAMPLES / "partial-pitch.jpg", quality=88, optimize=True)

    occluded = image.copy()
    draw = ImageDraw.Draw(occluded, "RGBA")
    draw.rectangle((520, 330, 815, 555), fill=(25, 25, 25, 205), outline=(255, 180, 0, 255), width=5)
    occluded.save(SAMPLES / "occlusion.jpg", quality=88, optimize=True)

    poor = image.resize((384, 256), Image.Resampling.BILINEAR)
    poor = ImageEnhance.Contrast(poor).enhance(0.72)
    poor = poor.resize(image.size, Image.Resampling.BILINEAR)
    poor.save(SAMPLES / "poor-quality.jpg", quality=18, optimize=True)

    records = []
    for path in sorted(SAMPLES.glob("*.jpg")):
        with Image.open(path) as sample:
            records.append({
                "id": path.stem,
                "path": str(path.relative_to(ROOT)),
                "sha256": sha256(path),
                "width": sample.width,
                "height": sample.height,
                "source": "fixture" if path.stem == "match-real" else "locally generated derivative",
            })
    return records


def normalized_xyxy(box: list[float], width: int, height: int) -> list[float]:
    x1, y1, x2, y2 = box
    return [x1 / width, y1 / height, x2 / width, y2 / height]


def worker(args: argparse.Namespace) -> int:
    import cv2
    import numpy as np
    from ultralytics import YOLO

    model_path = PLAYER_MODEL if args.worker == "player" else PITCH_MODEL
    OVERLAYS.mkdir(parents=True, exist_ok=True)
    model = YOLO(str(model_path))
    records = []
    warmup_start = time.perf_counter()
    model(str(args.images[0]), imgsz=args.size, verbose=False)
    warmup_seconds = time.perf_counter() - warmup_start
    for image_path in args.images:
        start = time.perf_counter()
        result = model(str(image_path), imgsz=args.size, conf=0.25, verbose=False)[0]
        inference_seconds = time.perf_counter() - start
        image = cv2.imread(str(image_path))
        height, width = image.shape[:2]
        overlay = image.copy()
        entry: dict[str, Any] = {
            "id": Path(image_path).stem,
            "width": width,
            "height": height,
            "inference_seconds": round(inference_seconds, 4),
            "rss_peak_kb": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
        }
        if args.worker == "player":
            boxes = result.boxes
            detections = []
            if boxes is not None:
                xyxy = boxes.xyxy.cpu().numpy().tolist()
                conf = boxes.conf.cpu().numpy().tolist()
                classes = boxes.cls.cpu().numpy().tolist()
                for box, score, class_id in zip(xyxy, conf, classes):
                    detections.append({
                        "xyxy_px": [round(float(value), 2) for value in box],
                        "xyxy_norm": [round(value, 6) for value in normalized_xyxy(box, width, height)],
                        "confidence": round(float(score), 5),
                        "class_id": int(class_id),
                    })
                    x1, y1, x2, y2 = map(int, box)
                    cv2.rectangle(overlay, (x1, y1), (x2, y2), (0, 220, 80), 2)
                    cv2.putText(overlay, f"{score:.2f}", (x1, max(16, y1 - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 220, 80), 1)
            entry["detections"] = detections
        else:
            keypoints = result.keypoints
            points = []
            if keypoints is not None:
                xy = keypoints.xy.cpu().numpy()
                conf = keypoints.conf.cpu().numpy() if keypoints.conf is not None else np.ones(xy.shape[:2])
                for point, score in zip(xy[0], conf[0]):
                    points.append({
                        "xy_px": [round(float(point[0]), 2), round(float(point[1]), 2)],
                        "xy_norm": [round(float(point[0]) / width, 6), round(float(point[1]) / height, 6)],
                        "confidence": round(float(score), 5),
                    })
                    if float(score) >= 0.25:
                        cv2.circle(overlay, (int(point[0]), int(point[1])), 5, (255, 80, 0), -1)
            entry["keypoints"] = points
        overlay_path = OVERLAYS / f"{Path(image_path).stem}-{args.worker}.jpg"
        cv2.imwrite(str(overlay_path), overlay, [int(cv2.IMWRITE_JPEG_QUALITY), 82])
        entry["overlay"] = str(overlay_path.relative_to(ROOT))
        entry["artifact_size_bytes"] = overlay_path.stat().st_size
        records.append(entry)
    json_dump(Path(args.output), {"component": args.worker, "size": args.size, "warmup_seconds": round(warmup_seconds, 4), "records": records})
    return 0


def run_worker(component: str, size: int, timeout: int, images: list[Path], temp: Path) -> dict[str, Any]:
    command = [sys.executable, str(Path(__file__).resolve()), "--worker", component, "--size", str(size), "--output", str(temp)]
    command += ["--images", *(str(path) for path in images)]
    environment = os.environ.copy()
    environment.update({"OMP_NUM_THREADS": "2", "MKL_NUM_THREADS": "2"})
    started = time.perf_counter()
    try:
        completed = subprocess.run(command, env=environment, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return {"status": "timeout", "timeout_seconds": timeout, "elapsed_seconds": round(time.perf_counter() - started, 2), "command": command}
    if completed.returncode != 0:
        return {"status": "error", "returncode": completed.returncode, "stderr_tail": completed.stderr[-2000:]}
    value = json.loads(temp.read_text(encoding="utf-8"))
    value.update({"status": "ok", "command_timeout_seconds": timeout})
    return value


def truths_for_sample(sample_id: str) -> list[dict[str, Any]]:
    truths = [dict(item, foot_px=list(item["foot_px"])) for item in MANUAL_PLAYERS]
    if sample_id == "partial-pitch":
        for item in truths:
            item["foot_px"] = [item["foot_px"][0] - 320, item["foot_px"][1] - 330]
    if sample_id == "occlusion":
        truths = [item for item in truths if not (520 <= item["foot_px"][0] <= 815 and 330 <= item["foot_px"][1] <= 555)]
    return truths


def make_metrics(player: dict[str, Any]) -> dict[str, Any]:
    if player.get("status") != "ok":
        return {"status": "unavailable", "reason": "player component did not complete"}
    records = []
    total_truth = total_predictions = total_matches = 0
    for record in player["records"]:
        truths = truths_for_sample(record["id"])
        predictions = []
        for detection in record["detections"]:
            if detection["class_id"] not in (1, 2):
                continue
            x1, _y1, x2, y2 = detection["xyxy_px"]
            predictions.append([(x1 + x2) / 2, y2])
        used: set[int] = set()
        matches = []
        for truth in truths:
            tx, ty = truth["foot_px"]
            choices = sorted((((tx - px) ** 2 + (ty - py) ** 2) ** 0.5, index) for index, (px, py) in enumerate(predictions) if index not in used)
            if choices and choices[0][0] <= 20:
                distance, index = choices[0]
                used.add(index)
                matches.append({"truth_id": truth["id"], "distance_px": round(distance, 2), "prediction": index})
        true_positive = len(matches)
        precision = true_positive / len(predictions) if predictions else 0
        recall = true_positive / len(truths) if truths else 0
        records.append({
            "id": record["id"],
            "visible_ground_truth": len(truths),
            "player_or_goalkeeper_predictions": len(predictions),
            "matches_within_20_px": true_positive,
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "f1": round(2 * precision * recall / (precision + recall), 4) if precision + recall else 0,
            "matches": matches,
        })
        total_truth += len(truths)
        total_predictions += len(predictions)
        total_matches += true_positive
    precision = total_matches / total_predictions if total_predictions else 0
    recall = total_matches / total_truth if total_truth else 0
    return {
        "status": "measured_foot_point",
        "match_rule": "predicted bottom-center within 20 image pixels of a hand-labeled visible-player foot point; classes 1 goalkeeper and 2 player only",
        "aggregate": {
            "visible_ground_truth": total_truth,
            "predictions": total_predictions,
            "matches": total_matches,
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "f1": round(2 * precision * recall / (precision + recall), 4) if precision + recall else 0,
        },
        "samples": records,
        "caveat": "All four cases come from one still image. Derivative results are correlated and are not dataset-level accuracy.",
    }


def build_result(size: int, timeout: int, samples: list[dict[str, Any]], player: dict[str, Any], pitch: dict[str, Any]) -> dict[str, Any]:
    field: dict[str, Any] = {
        "coordinate_convention": "image origin is top-left; x increases right and y increases down",
        "normalized_image": "[x / image_width, y / image_height]",
        "normalized_pitch": "[pitch_length_cm / 12000, pitch_width_cm / 7000], origin at the upper-left corner of the canonical Roboflow Sports pitch",
        "automatic_error_status": "No independent semantic pitch-landmark labels are available, so absolute image-to-pitch error is not measurable from this sample.",
        "manual_fallback": {
            "status": "blocked_on_this_sample",
            "required_input": "at least four non-collinear user-selected landmarks with known canonical identities; six or more are preferred so landmarks can be held out",
            "checks": ["reject duplicate or collinear points", "fit with RANSAC", "reject a mirrored or non-convex pitch", "hold out at least two landmarks and require median error <= 1.0 m and p95 <= 2.0 m"],
            "observation": "This frame does not expose four unambiguous named pitch intersections. A manual transform could not be tested without inventing correspondences.",
        },
    }
    if pitch.get("status") == "ok":
        import cv2
        import numpy as np

        source = next((x for x in pitch["records"] if x["id"] == "match-real"), None)
        if source:
            selected = [(index, item) for index, item in enumerate(source["keypoints"]) if item["confidence"] >= 0.5]
            field["model_keypoints_at_confidence_0_5"] = len(selected)
            if len(selected) >= 4:
                image_points = np.array([item["xy_px"] for _index, item in selected], dtype=np.float32)
                pitch_points = np.array([PITCH_VERTICES[index] for index, _item in selected], dtype=np.float32)
                transform, mask = cv2.findHomography(image_points, pitch_points, cv2.RANSAC, 500)
                projected = cv2.perspectiveTransform(image_points[:, None, :], transform)[:, 0, :]
                pitch_errors_m = np.linalg.norm(projected - pitch_points, axis=1) / 100
                inverse = np.linalg.inv(transform)
                reprojected = cv2.perspectiveTransform(pitch_points[:, None, :], inverse)[:, 0, :]
                pixel_errors = np.linalg.norm(reprojected - image_points, axis=1)
                field["model_internal_consistency"] = {
                    "method": "RANSAC homography fit against the model's own >=0.5-confidence keypoints; this is not ground-truth mapping accuracy",
                    "points": len(selected),
                    "inliers": int(mask.sum()),
                    "pitch_error_median_m": round(float(np.median(pitch_errors_m)), 3),
                    "pitch_error_p95_m": round(float(np.percentile(pitch_errors_m, 95)), 3),
                    "pitch_error_max_m": round(float(pitch_errors_m.max()), 3),
                    "image_reprojection_median_px": round(float(np.median(pixel_errors)), 3),
                    "image_reprojection_p95_px": round(float(np.percentile(pixel_errors, 95)), 3),
                }
    player_metric = make_metrics(player)
    team = {
        "status": "unvalidated",
        "method": "The upstream SigLIP, UMAP, and KMeans classifier was not run because its extra model artifacts were not pinned or licensed for this evaluation. Hand labels are ground truth only, not a substitute result.",
        "manual_team_labels": {item["id"]: item["team"] for item in MANUAL_PLAYERS},
    }
    return {
        "schema_version": 1,
        "generated_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "sample_scope": "one CC BY-SA 2.0 fixture plus local partial-pitch, occlusion, and poor-quality derivatives; no independent licensed video",
        "runtime": {"python": platform.python_version(), "platform": platform.platform(), "cpu_threads": len(os.sched_getaffinity(0)), "torch_threads": 2, "device": "cpu"},
        "upstream": {"repository": "https://github.com/roboflow/sports", "commit": UPSTREAM_COMMIT},
        "models": {
            "player": {"url": MODEL_URLS["player"], "path": str(PLAYER_MODEL), "sha256": sha256(PLAYER_MODEL) if PLAYER_MODEL.exists() else None, "license": "Ultralytics YOLOv8 checkpoint metadata says AGPL-3.0"},
            "pitch": {"url": MODEL_URLS["pitch"], "path": str(PITCH_MODEL), "sha256": sha256(PITCH_MODEL) if PITCH_MODEL.exists() else None, "license": "Ultralytics YOLOv8 checkpoint metadata says AGPL-3.0"},
        },
        "images": samples,
        "attempts": {
            "selected": {"status": "completed", "imgsz": size, "hard_component_timeout_seconds": timeout},
        },
        "components": {"player": player, "pitch": pitch},
        "metrics": {"player_detection": player_metric, "pitch_mapping": field, "team_grouping": team},
        "manual_annotations": {"players": MANUAL_PLAYERS, "field_points_px": [], "completeness": "complete for the 20 visible players; no defensible semantic pitch-point set"},
        "limitations": ["No independent licensed match video was available. This is a NO-GO blocker.", "Identity, OCR, tracking, and production integration were not tested."],
    }


def verify() -> int:
    result_path = OUT / "results.json"
    annotation_path = OUT / "annotations.json"
    if not result_path.exists() or not annotation_path.exists():
        raise SystemExit("missing generated results.json or annotations.json")
    result = json.loads(result_path.read_text(encoding="utf-8"))
    annotations = json.loads(annotation_path.read_text(encoding="utf-8"))
    assert result["schema_version"] == 1
    assert result["models"]["player"]["sha256"] and result["models"]["pitch"]["sha256"]
    assert result["components"]["player"]["status"] == "ok"
    assert result["components"]["pitch"]["status"] == "ok"
    assert annotations["players"] == MANUAL_PLAYERS
    assert result["manual_annotations"]["players"] == MANUAL_PLAYERS
    assert result["metrics"]["player_detection"] == make_metrics(result["components"]["player"])
    for image in result["images"]:
        path = ROOT / image["path"]
        assert path.exists() and sha256(path) == image["sha256"]
    overlay_paths = []
    for component in result["components"].values():
        for record in component["records"]:
            path = ROOT / record["overlay"]
            assert path.stat().st_size == record["artifact_size_bytes"]
            overlay_paths.append(path)
    assert overlay_paths and all(path.exists() and path.stat().st_size > 0 for path in overlay_paths)
    print(f"offline verification ok: {len(result['images'])} samples, {len(overlay_paths)} overlays")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--worker", choices=["player", "pitch"])
    parser.add_argument("--size", type=int, default=1280)
    parser.add_argument("--timeout", type=int, default=360)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--images", nargs="*", type=Path)
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    if args.verify:
        return verify()
    if args.worker:
        if not args.output or not args.images:
            parser.error("worker requires --output and --images")
        return worker(args)

    samples = make_samples()
    images = [ROOT / item["path"] for item in samples]
    OUT.mkdir(parents=True, exist_ok=True)
    temp_player = OUT / ".player-worker.json"
    temp_pitch = OUT / ".pitch-worker.json"
    player = run_worker("player", args.size, args.timeout, images, temp_player)
    pitch = run_worker("pitch", args.size, args.timeout, images, temp_pitch)
    result = build_result(args.size, args.timeout, samples, player, pitch)
    json_dump(OUT / "annotations.json", {"schema_version": 1, "coordinate_convention": "pixel points use a top-left origin; normalized values divide by image width and height", "players": MANUAL_PLAYERS, "field_points_px": [], "field_target_points_norm": [], "source": "manual visual annotation of scripts/fixtures/match-real.jpg", "completeness": "complete for the 20 visible players; referee excluded; no defensible semantic pitch-point set"})
    json_dump(OUT / "results.json", result)
    for path in (temp_player, temp_pitch):
        path.unlink(missing_ok=True)
    print(json.dumps({"player": player.get("status"), "pitch": pitch.get("status"), "size": args.size, "results": str(OUT / "results.json")}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
