# Roboflow Sports footage import check

Measured on 2026-09-07. This is issue 1 of 5. It does not implement an extension or service.

## Decision

**NO-GO. Stop the footage-import series after this issue.**

The detector worked on the one clear still, but the available evidence is not enough to build a product integration:

- Only one independently licensed match image was available. The other three cases are derivatives of it, not independent screenshots or video frames.
- Detection fell from 95% recall on the clear still to 10% on the poor-quality case. Aggregate precision was 83.05%, recall 70.00%, and F1 75.97%.
- Roboflow Sports team classification was not valid on one frame. Its classifier fits SigLIP, UMAP, and KMeans from player crops collected across video. No independent licensed video was available.
- Absolute image-to-pitch error could not be measured because the image lacks enough unambiguous, manually identifiable pitch intersections. The model's own keypoints had a 1.258 m median and 4.375 m p95 internal fit error. Internal fit is not ground-truth accuracy.
- Manual calibration was blocked by the same missing landmarks. Four guessed points would produce a transform but no evidence that it is correct.
- The two YOLO checkpoint files contain `AGPL-3.0` metadata. Ultralytics' current licensing page says a commercial SaaS that does not release the whole project under AGPL needs an Enterprise license. Whether those terms govern this exact use still needs legal or vendor confirmation, and the training-data terms were not available with the downloads.
- Warm CPU processing took 50.05 to 76.49 seconds per image for the detector and pitch model together. That is too slow for an import flow.

Do not start issues 2 through 5 until a human supplies permitted representative footage and resolves the model and training-data terms. A new evaluation must meet every criterion below.

## Go criteria for a new evaluation

Use at least five permitted matches from at least two camera systems. Include at least 20 independently selected frames split across wide, partial-pitch, occluded, and poor-quality cases.

A GO requires:

1. Player and goalkeeper precision at least 95% and recall at least 90% overall, with neither below 80% in any required case. Match the predicted bottom-center to a hand-labeled foot point within 20 pixels at 1280px input.
2. Permutation-aware two-team accuracy at least 90% on detected outfield players. Report goalkeepers separately. Do not claim identity or jersey recognition.
3. Automatic pitch mapping against independent held-out landmarks with median error at most 1.0 m and p95 at most 2.0 m.
4. Manual calibration with the same mapping limits on frames where at least six named landmarks are visible. Reject frames that cannot supply four non-collinear points plus two held-out checks.
5. Warm p95 processing at most 5 seconds for an asynchronous selected-frame import, including detection, team suggestion, and calibration.
6. Written permission for the sample footage, model weights, training data, and commercial deployment terms.

A frame that misses a calibration limit must return no pitch coordinates. The UI may still show image-space detections for manual review.

## Sample provenance

`scripts/fixtures/match-real.jpg` is "Football match at the i2i Stadium" by Bill Boaden, from Geograph Britain and Ireland via Wikimedia Commons. It is licensed CC BY-SA 2.0. The source and attribution are in [`scripts/fixtures/README.md`](../../../scripts/fixtures/README.md).

The script creates these CC BY-SA 2.0 derivatives locally:

- `samples/match-real.jpg`: recompressed clear wide shot.
- `samples/partial-pitch.jpg`: crop from `(320, 330)` to `(1280, 853)`.
- `samples/occlusion.jpg`: clear shot with an opaque rectangle over ten labeled players.
- `samples/poor-quality.jpg`: downscaled to 384x256, reduced to 72% contrast, enlarged, and saved at JPEG quality 18.

The derivatives test failure handling. They do not count as independent footage. No image or frame was uploaded to Roboflow, Google, or another inference service.

## Pinned inputs

| Input | Pin | SHA256 or source |
| --- | --- | --- |
| Roboflow Sports code | `42c80c06b6b65a7f89455b89fe31cdf4c38ba227` | <https://github.com/roboflow/sports> |
| Player checkpoint | Ultralytics 8.2.11 checkpoint, 136,802,409 bytes | `75b09c377fbf9d0791d23f6cfb689f5aed6eaa43a6818bd1fb884cf7507fffaf` |
| Pitch checkpoint | Ultralytics 8.2.10 checkpoint, 140,212,306 bytes | `28f68f7c4056d6d9b137efd2e7ab5f3c494039380c63831649126ced25628b36` |
| Source fixture | repository copy | `5c5dd89db639fe5118474e4c8652c6303525fe0c1a9f9bbf626972ed26c98d02` |

The checkpoint URLs come from `examples/soccer/setup.sh` at the pinned Sports commit:

- Player: <https://drive.google.com/uc?id=17PXFNlx-jI7VjVo_vQnB1sONjRyvoB-q>
- Pitch: <https://drive.google.com/uc?id=1Ma5Kt86tgpdjCTKfum79YMgNnSjcoOyf>

`results.json` records the generated sample hashes and raw predictions. `annotations.json` contains the 20 manually marked visible-player foot points. The referee is excluded. One goalkeeper is visible; the other goalkeeper and one outfield player are off screen or not separable in the image.

## Reproduce locally

These commands keep the upstream checkout, environment, and 265 MiB of weights outside Board. They require about 2 GiB for the Python environment plus the weights.

```bash
git clone --filter=blob:none https://github.com/roboflow/sports.git /tmp/roboflow-sports
git -C /tmp/roboflow-sports checkout 42c80c06b6b65a7f89455b89fe31cdf4c38ba227

git -C /tmp/roboflow-sports show 42c80c06b6b65a7f89455b89fe31cdf4c38ba227:examples/soccer/setup.sh

python3 -m venv /tmp/roboflow-bench-venv
/tmp/roboflow-bench-venv/bin/pip install --index-url https://download.pytorch.org/whl/cpu \
  torch==2.14.0+cpu torchvision==0.29.0+cpu
/tmp/roboflow-bench-venv/bin/pip install -r docs/research/footage-import/requirements-benchmark.txt

mkdir -p /tmp/roboflow-models
/tmp/roboflow-bench-venv/bin/gdown 'https://drive.google.com/uc?id=17PXFNlx-jI7VjVo_vQnB1sONjRyvoB-q' \
  -O /tmp/roboflow-models/player.pt
/tmp/roboflow-bench-venv/bin/gdown 'https://drive.google.com/uc?id=1Ma5Kt86tgpdjCTKfum79YMgNnSjcoOyf' \
  -O /tmp/roboflow-models/pitch.pt
sha256sum /tmp/roboflow-models/player.pt /tmp/roboflow-models/pitch.pt

OMP_NUM_THREADS=2 MKL_NUM_THREADS=2 \
  /tmp/roboflow-bench-venv/bin/python scripts/benchmark-footage-import.py \
  --size 1280 --timeout 360
/tmp/roboflow-bench-venv/bin/python scripts/benchmark-footage-import.py --verify
```

The benchmark executes the two checkpoints linked by Roboflow Sports with Ultralytics and uses the exact 32-point pitch configuration from the pinned Sports commit. It does not install the whole Sports package because the team-classifier dependencies and SigLIP artifact were not part of the completed test.

## Detection results

The test uses classes 1, goalkeeper, and 2, player. It matches each box's bottom-center to the nearest unused manual foot point within 20 image pixels.

| Case | Visible truth | Predictions | Matches | Precision | Recall | F1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Clear wide shot | 20 | 19 | 19 | 100.00% | 95.00% | 97.44% |
| Synthetic occlusion | 10 | 18 | 9 | 50.00% | 90.00% | 64.29% |
| Partial pitch | 20 | 20 | 19 | 95.00% | 95.00% | 95.00% |
| Poor quality | 20 | 2 | 2 | 100.00% | 10.00% | 18.18% |
| Aggregate | 70 | 59 | 49 | 83.05% | 70.00% | 75.97% |

The clear-shot detector found 19 outfield players and missed the nearby goalkeeper. In the occlusion case it emitted nine unmatched player boxes, so hiding players did not produce a safe low-confidence failure. Poor quality removed 18 of 20 detections.

These measurements describe one image and correlated derivatives. They cannot estimate production accuracy.

## Team classification

Not measured. Roboflow Sports pins `google/siglip-base-patch16-224`, extracts embeddings, reduces them with UMAP, and fits two KMeans clusters. Its example collects crops across video before fitting. A single still does not provide the intended sample, and the SigLIP files were not downloaded or licensed for this test.

The `team` values in `annotations.json` and `results.json` are manual jersey-color groups only. They do not establish club membership or player identity. A future result must map cluster IDs to home and away by the best permutation before calculating accuracy. Goalkeepers need a separate suggestion based on nearby outfield players, with `null` when the evidence is weak.

## Pitch mapping

At 1280px, the pitch model returned 32 keypoint slots and nine points at confidence 0.5 or higher on the clear image. A RANSAC homography fitted to those same predictions had:

- 8 inliers from 9 points.
- 1.258 m median internal pitch residual.
- 4.375 m p95 internal pitch residual.
- 5.513 m maximum internal pitch residual.
- 8.048 px median and 24.099 px p95 image reprojection residual.

The internal residuals exceed the numerical guard proposed for a future held-out test, but they cannot pass or fail that accuracy test. There were no independent semantic pitch-point labels against which to measure real error. The overlay also shows several high-confidence points in open grass, so confidence alone cannot accept calibration.

### Manual fallback

A safe fallback should ask for named landmarks from the Sports 32-point pitch configuration. Require four non-collinear points to fit and prefer at least six so two can remain held out. Reject duplicate or collinear points, mirrored or non-convex pitch geometry, and any fit over the mapping limits.

This sample does not expose four unambiguous named intersections. Manual mapping is therefore unavailable for this frame. Asking a user to click arbitrary grass points would create precise-looking but unsupported coordinates.

## Coordinate conventions and output

Image coordinates use a top-left origin. `x` increases right and `y` increases down. Normalize with `x / imageWidth` and `y / imageHeight`.

The canonical pitch is 12000 cm long and 7000 cm wide, matching `SoccerPitchConfiguration` at the pinned commit. Its origin is the upper-left corner in the top-down model. Normalize pitch points as `[lengthCm / 12000, widthCm / 7000]`. Keep this canonical orientation independent of Board's display orientation. A later host API, if the series is unblocked, must do the Board-specific rotation or reflection explicitly.

Proposed result shape:

```json
{
  "schemaVersion": 1,
  "source": { "width": 1280, "height": 853 },
  "calibration": {
    "mode": "automatic",
    "status": "rejected",
    "medianErrorM": null,
    "p95ErrorM": null
  },
  "detections": [
    {
      "sourceBox": { "x": 0.1, "y": 0.2, "width": 0.03, "height": 0.08 },
      "sourceFoot": { "x": 0.115, "y": 0.28 },
      "pitch": null,
      "role": "player",
      "teamSuggestion": null,
      "confidence": { "detection": 0.88, "team": null }
    }
  ]
}
```

Do not clamp out-of-range pitch points into the field. Mark them invalid. Never add an off-screen player. `pitch` stays `null` until calibration passes.

## Latency and resources

Runner: Linux x86-64, 2 CPU cores, 3.8 GiB RAM, no NVIDIA GPU, Python 3.12.3, PyTorch 2.14.0 CPU, Ultralytics 8.4.142. Both components used two Torch threads.

| Case | Player | Pitch | Combined warm inference |
| --- | ---: | ---: | ---: |
| Clear wide shot | 34.84 s | 40.25 s | 75.09 s |
| Synthetic occlusion | 37.84 s | 38.65 s | 76.49 s |
| Partial pitch | 27.17 s | 22.88 s | 50.05 s |
| Poor quality | 26.59 s | 39.91 s | 66.49 s |

Model warmup totaled 106.86 seconds. The complete reproducible run took 418.29 seconds. Peak process RSS was 1,337,356 KiB. The weights total 277,014,715 bytes. Keeping both models resident may need roughly 3 GiB before the API, decoder, and concurrency overhead. Measure the deployed process rather than relying on that estimate.

### Cost check

Prices were read from first-party pages on 2026-09-07.

- A DigitalOcean Basic 2 vCPU, 4 GiB Droplet is $0.03571/hour or $24/month. At the measured 67.03-second mean warm inference, one serial worker can process about 53 frames/hour. Pure compute for 1,000 frames is about $0.67, but an always-on worker costs $24/month and shared-CPU latency can vary.
- A CPU-Optimized 2 vCPU, 4 GiB Droplet is $0.06250/hour or $42/month. The same measured workload is about $1.16 per 1,000 frames in compute time or $42/month always on.
- Modal lists an NVIDIA L4 at $0.000222/second, plus CPU and memory. No GPU benchmark was run. A planning assumption of two GPU-seconds per frame would be $0.44 per 1,000 frames for GPU time, but that is not an estimate fit for a launch decision. Cold starts, model loading, storage, network, and request handling are excluded.

Sources: <https://www.digitalocean.com/pricing/droplets> and <https://modal.com/pricing>.

The CPU path misses the latency criterion. Get an actual GPU p95 and memory measurement before choosing hosting. Any third-party processor also needs an explicit footage-processing and retention policy.

## License inventory

| Item | Terms found | Status |
| --- | --- | --- |
| Board repository | MIT, with separate trademark and third-party notices | Clear for this research commit |
| Roboflow Sports code at pinned commit | MIT | Clear for code review and research |
| Player and pitch checkpoints | Each loaded checkpoint's top-level `license` field says `AGPL-3.0 (https://ultralytics.com/license)` | Exact product-use terms need legal or vendor confirmation; unresolved release blocker |
| Ultralytics runtime | Vendor offers AGPL-3.0 or paid Enterprise terms | Vendor says proprietary commercial SaaS needs Enterprise terms; confirm before integration |
| Football player and field training datasets | Roboflow Universe links exist, but the pages returned HTTP 403 during this run and the weight downloads had no data-license sidecar | Unresolved; release blocker |
| `google/siglip-base-patch16-224` | Not downloaded or inspected | Unresolved for this product path |
| Source fixture and generated derivatives | CC BY-SA 2.0 with attribution | Permitted for this benchmark; preserve attribution and ShareAlike terms |
| PyTorch and torchvision | BSD-style licenses | Record exact notices if redistributed |
| NumPy and psutil | BSD-3-Clause | Record exact notices if redistributed |
| OpenCV Python headless | Apache-2.0 package, with bundled third-party notices | Review notices before redistribution |
| Pillow | HPND | Record notice if redistributed |
| gdown | MIT | Development-only downloader |

The metadata was inspected with `torch.load(..., weights_only=False)` in the isolated benchmark environment. Both files had a top-level `license` value of `AGPL-3.0 (https://ultralytics.com/license)`. Ultralytics' current page says its trained models use AGPL-3.0 by default and that proprietary commercial SaaS needs an Enterprise license: <https://www.ultralytics.com/license>. This report is not a legal conclusion. Product use stays blocked until counsel or the vendor confirms the exact terms, rather than assuming the Sports repository's MIT license covers downloaded weights.

## Visual evidence

Each overlay comes from the predictions stored in `results.json`:

- `overlays/match-real-player.jpg`
- `overlays/match-real-pitch.jpg`
- `overlays/partial-pitch-player.jpg`
- `overlays/partial-pitch-pitch.jpg`
- `overlays/occlusion-player.jpg`
- `overlays/occlusion-pitch.jpg`
- `overlays/poor-quality-player.jpg`
- `overlays/poor-quality-pitch.jpg`

Green boxes are detections with confidence labels. Blue dots are pitch keypoints at confidence 0.25 or higher. The files contain only the permitted fixture and its derivatives.
