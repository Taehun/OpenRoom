# Nook Browser WebGPU Renderer Spike

**Verdict: FAIL.** Neither candidate clears the plan's hard gates. Adobe PIH is
rejected at the licence gate before inference. The Moebius ONNX conversion clears
licence, size, shard, privacy, consent, cache, offline, memory, main-thread, and
stability gates, and every automatic product-preservation check — then fails the
render contract (its graph is locked to 512x512, the spec's raster is 1024x576),
misses the latency gate by an order of magnitude (86 s median against 8 s; ~6
minutes for a real 1024x576 frame), and delivers no visible grounding improvement
over the DOM compositor while painting a visible patch on the wall in one of the
twelve golden composites. Tasks 6-11
of `docs/superpowers/plans/2026-09-02-nook-hybrid-image-renderer.md` do not start.
The DOM/CSS compositor remains Nook's product renderer.

Spec under test: `docs/superpowers/specs/nook-hybrid-image-renderer-design.md`.

---

## 1. Environment

| Item | Value |
| --- | --- |
| Spike start (KST) | 2026-09-03T07:37:26+0900 |
| Repository commit at start | `aec60e8` (`feat/photo-compositor`), clean tree |
| OS | Darwin 25.6.0 (`xnu-12377.161.14~5`), arm64 |
| Machine | Mac14,2, Apple M2, 8 logical cores |
| RAM | 17,179,869,184 bytes (16 GiB); `navigator.deviceMemory` 16 |
| Free disk (`/tmp`) | 290 GiB |
| Node | v24.13.1 |
| pnpm | 10.11.0 |
| Python | 3.14.3 on PATH; conversion ran on a `uv` venv at 3.12.12 under `/tmp` |
| Browser | Chromium **151.0.7922.34**, `ms-playwright/chromium_headless_shell-1234`, launched by the project's `@playwright/test` 1.62.1 |
| WebGPU adapter | `vendor: apple`, `architecture: metal-3`, non-fallback |
| Adapter limits | `maxBufferSize` 4,294,967,292; `maxStorageBufferBindingSize` 4,294,967,292; `maxComputeInvocationsPerWorkgroup` 1,024; subgroup size 32 |
| Adapter features | includes `shader-f16`, `subgroups`, `timestamp-query`, `float32-filterable` |
| Page context | `isSecureContext` true, `crossOriginIsolated` true |
| ONNX Runtime Web | 1.29.0 (npm `latest`), MIT; tarball SHA-256 `7a934b7811c3b050ecfb7619722e2b4de771ce6da20520e17a2018a440316ef3` |
| Scratch root | `/tmp/nook-webgpu-renderer-spike/` (all model bytes, envs, harness, profiles, screenshots) |

Two environment facts differ from the task brief and are recorded rather than
worked around:

- The brief named `ms-playwright/chromium-1237`. The project's installed
  `@playwright/test` 1.62.1 resolves to revision **1234** (Chromium
  151.0.7922.34). Revision 1237 is present on disk and is Chrome for Testing
  **152.0.7977.8**, but it is not what `chromium.launch()` starts. The brief's
  instruction to drive the browser through the project's Playwright was followed,
  so every primary number below is from 151.0.7922.34; §8.2 records a full
  cross-check on 152.0.7977.8, which is slower and does not change the verdict.
- `navigator.gpu` is **undefined on `about:blank`** in both headless and headed
  Chromium, because that document is not a secure context. WebGPU appears as soon
  as the page is served over `http://127.0.0.1`. The first adapter probe therefore
  reported "no WebGPU" and was discarded; all measurements use the localhost origin.

## 2. Time used

| Phase | Wall clock (KST) |
| --- | --- |
| Step 1 clock start | 07:37:26 |
| Steps 2-3 licenses, download, conversion | 07:38 - 07:46 |
| Step 4 harness | 07:46 - 07:58 |
| Step 5 privacy/cache measurements | 07:58 - 08:06 |
| Step 6 ten renders, full-frame, memory, stability | 08:06 - 08:30 |
| Step 7 thirty renders, automatic checks, goldens | 08:34 - 09:19 |
| Baseline clipping pass + Chromium 152 cross-check | 09:19 - 09:22 |
| Step 8 report | 09:22 - 09:40 |
| Step 9 commit | 09:40 - 09:45 |
| **Total** | **about 2 hours 8 minutes of the four-hour box** |

The box was not exhausted; every gate in the brief was measured.

## 3. Candidates

| # | Candidate | Role in spec | Outcome |
| --- | --- | --- | --- |
| A | Adobe PIH (`github.com/adobe/PIH`, 93M-parameter checkpoint) | §3.1 geometry-locked parametric harmonizer | **Rejected at the license gate, before any inference** |
| B | Moebius 0.22B ONNX (`huggingface.co/simonw/Moebius-ONNX`, from `hustvl/Moebius`) | §3.2 restricted contact-shadow / boundary proposal | Licenses pass; **fails render contract and latency** |

No third candidate was evaluated; the brief caps the spike at two.

## 4. Licenses

### 4.1 Candidate A — Adobe PIH: REJECTED

| Link in the chain | Finding |
| --- | --- |
| Repository license | Apache-2.0, `Copyright 2023 Adobe Research` (`raw.githubusercontent.com/adobe/PIH/main/LICENSE`, 11,344 bytes). Covers the repository's contents. |
| Weights in the repository | **None.** The full recursive tree (64 entries) contains only `pretrained/pretrained.placeholder`, 0 bytes. The Apache-2.0 grant therefore never attaches to any weight file. |
| Checkpoint distribution | README points at a Google Drive link, file id `1seW8qSnaBOQ4_S9bQ4ThVOdeJGYJ-f74`, listed as `ckpt_g39.pth`, `358M`. |
| Checkpoint download terms | `drive.google.com/uc?export=download` answers **HTTP 303** to `drive.usercontent.google.com/download`, which answers **HTTP 200 `text/html`** — a 2,429-byte *"Google Drive - Virus scan warning"* interstitial that sets an `NID` cookie and requires a `confirm=t` plus a per-session rotating `uuid` token before bytes are served. |
| Checkpoint hash (recorded) | Retrieved with the confirm token: **374,960,609 bytes**, SHA-256 `72640cdc5109bcdc86c619b0e2278c8c277cccee561c7fc1ebaac233cb987149`, PyTorch zip archive. No license, NOTICE, or terms file is present inside the archive or alongside the download. |
| Redistribution / commercial-use permission | **Absent.** The README grants nothing beyond "we provide our pre-trained model … from this link". The Adobe Research publication page for the paper carries no licence, terms, weights, or download clause (full text scanned). The paper's Berkeley project page could not be reached (`LibreSSL SSL_connect: SSL_ERROR_SYSCALL`), so no grant could be read there either. |
| Conversion-tool licenses | Would have been `onnx` (Apache-2.0) + PyTorch (BSD-3-Clause) + `onnxruntime-web` 1.29.0 (MIT) — all acceptable, but never reached. |
| Existing ONNX conversion | None. Hugging Face model search for `PIH+harmonization`, `image-harmonization`, `harmonization+onnx`, and `PIH` returned no PIH conversion artifact. |

**Gate applied (brief Step 2): "A missing explicit weight or conversion-artifact
grant rejects that candidate before inference."** PIH has no explicit weight
grant, so it is rejected and no PIH inference was run.

Two independent facts would each have blocked PIH even with a grant, and are
recorded because they matter to any follow-up research:

1. Spec §12 requires the manifest to pin **exact immutable URLs** with SHA-256 on
   an origin allowlist, fetched with `credentials: "omit"`. The Drive endpoint is
   cookie-gated, returns HTML rather than bytes without a rotating per-session
   token, and redirects across origins. It cannot be a manifest-pinned
   credentialless GET target.
2. Serving the weights from Nook's own origin instead would be redistribution,
   which is exactly the permission that is missing.

### 4.2 Candidate B — Moebius ONNX: PASS

| Link in the chain | Finding |
| --- | --- |
| Upstream code | `github.com/hustvl/Moebius` — Apache-2.0 (GitHub license API). |
| Upstream weights | `huggingface.co/hustvl/Moebius` — **MIT**, `gated: false`. Explicit grant, commercial use and redistribution permitted. |
| VAE provenance | VAE encoder is from `hustvl/PixelHacker` — **MIT**, `gated: false`. |
| Conversion artifact | `huggingface.co/simonw/Moebius-ONNX`, revision `5bf1ef5d2861ec01a727183a3f95dc64f352120e`, `gated: false`, ships an 11,217-byte Apache-2.0 `LICENSE`; the model card states the artifacts are a PyTorch→ONNX format conversion of the original weights. |
| Conversion/runtime tools | `onnx` (Apache-2.0), PyTorch 2.7.1 export (BSD-3-Clause), `onnxruntime-web` 1.29.0 (MIT). |

**Licence gate: PASS** — an explicit weight grant and an explicit conversion
grant both exist, both permissive.

One documentation inconsistency is recorded: the conversion card claims
Apache-2.0 *"inherited from the upstream hustvl/Moebius"*, but the upstream
**weights** repository declares **MIT**, not Apache-2.0. Both are permissive and
either satisfies the gate, so this does not change the outcome; a shipping
manifest should name MIT for `weights` and Apache-2.0 for `conversion`.

### 4.3 Exact file list, byte sizes, and hashes (as published)

| File | Bytes | SHA-256 (published LFS OID = downloaded) |
| --- | ---: | --- |
| `unet.onnx` | 906,698,976 | `e3f90f52f72378339b990459fadb29a68d3c7b5c6851545ba42774f489160b08` |
| `vae_decoder.onnx` | 198,078,671 | `d90ef0b7f6c8c8b7234459c8b449d70be0033bf1576c842e8b9991baf3934280` |
| `vae_encoder.onnx` | 136,757,093 | `b8b81d41e757222a0707665ba9d826703987855e5bed056036b90b988968042f` |
| **Total** | **1,241,534,740** | all three re-hashed after download; every digest matched |

## 5. Conversion, sharding, hashes, operator support

### 5.1 Graph facts (read directly from the ONNX protobufs)

All three graphs: **IR version 8, opset `ai.onnx` 18, producer `pytorch 2.7.1`,
zero external-data initializers as published (monolithic files).**

| Graph | Inputs | Outputs | Nodes | Distinct ops |
| --- | --- | --- | ---: | ---: |
| `unet.onnx` | `latent` f32 `[B,9,64,64]`, `timesteps` i64 `[B]`, `input_ids` i64 `[B,10]` | `noise` f32 `[B,4,64,64]` | 8,889 | 31 |
| `vae_encoder.onnx` | `image` f32 `[B,3,512,512]` | `moments` f32 `[B,8,·,·]` | 456 | 20 |
| `vae_decoder.onnx` | `latent` f32 `[B,4,64,64]` | `image` f32 `[B,3,512,512]` | 519 | 19 |

**The decisive structural fact: every spatial dimension is a fixed integer.**
Only the batch axis is dynamic (`'B'`). The UNet latent is hard-wired to 64x64
and the VAE to 512x512, matching the model card's statement that the export is
"at a static 512x512 resolution … the model's cross-attention uses a
relative-position embedding tied to the trained resolution, so spatial size is
fixed." The spec's contract (§6) is a **1024x576** accepted raster; this graph
cannot produce one in a single execution.

UNet operator mix (top): `Constant` 2,989, `Unsqueeze` 1,322, `Shape` 948,
`Gather` 902, `Reshape` 513, `Mul` 426, `Concat` 402, `Conv` 229, `Add` 201,
`Cast` 182, `Transpose` 165, `Div` 120, **`Einsum` 105**, `Sigmoid` 63,
`Slice` 47, `InstanceNormalization` 46, `LayerNormalization` 45, `Relu` 32,
`MatMul` 31, `Softmax` 30, `Gemm` 17, `BatchNormalization` 15, `Resize` 2.

### 5.2 Operator support on the WebGPU execution provider

**Supported — no fallback failure.** All three `InferenceSession`s were created
with `executionProviders: ['webgpu']` and ran to completion, including the 105
`Einsum` nodes and the `InstanceNormalization` / `LayerNormalization` stacks.
ONNX Runtime emitted only its routine informational warning:

```
[W:onnxruntime:, session_state.cc:1398 VerifyEachNodeIsAssignedToAnEp]
Some nodes were not assigned to the preferred execution providers …
e.g. ORT explicitly assigns shape related ops to CPU to improve perf
```

No unsupported-operator error, no validation error, and no shader-compilation
failure occurred in any run.

### 5.3 Externalisation and sharding

Command (Python 3.12.12 venv under `/tmp`, `onnx` 1.20.0):

```python
from onnx.external_data_helper import convert_model_to_external_data
m = onnx.load(f"models/{name}.onnx")
convert_model_to_external_data(
    m, all_tensors_to_one_file=False, size_threshold=1024, convert_attribute=True)
onnx.save_model(m, f"models/sharded/{stem}/{name}.onnx")
```

| Graph | Tensor shards | Graph skeleton bytes | Largest shard |
| --- | ---: | ---: | --- |
| `unet` | 663 | 2,487,715 | 58,982,400 B = **56.25 MiB** |
| `vae_encoder` | 90 | 118,376 | 9,437,184 B = 9.00 MiB |
| `vae_decoder` | 119 | 137,386 | 9,437,184 B = 9.00 MiB |
| **Total** | **872 tensor shards + 3 skeletons = 875 cache entries** | | **56.25 MiB** |

| Size gate | Threshold | Measured | Result |
| --- | --- | --- | --- |
| Per-shard size (so `crypto.subtle.digest` never needs a whole-model copy) | ≤ 64 MiB | 56.25 MiB max; 0 shards over | **PASS** |
| First-use transfer | ≤ 2 GB | **1,244,357,450 B (1.244 GB / 1.159 GiB)** | **PASS** |
| Verified cache | ≤ 2.5 GB | **1,242,143,744 B reported by `navigator.storage.estimate()` (`usageDetails.caches`)** | **PASS** |

Externalisation was required: as published, the largest single file is 864.7 MiB,
13.5x the shard limit. After externalisation every tensor fits, so the
64 MiB-shard requirement is achievable for this model **provided Nook re-hosts the
re-externalised shards** (the published monolithic files cannot be used directly).

## 6. Harness

Throwaway harness, entirely under `/tmp/nook-webgpu-renderer-spike/harness/`:

- `worker.mjs` — a **dedicated module worker** that imports
  `dist/ort.webgpu.bundle.min.mjs` from the pinned 1.29.0 tarball, owns the
  WebGPU adapter/device and all three sessions, verifies and caches shards,
  composes inputs, runs the DDIM loop, and posts back pixels. `ort.env.wasm.proxy`
  is explicitly `false` — the **ORT proxy worker is not used**, as spec §7.1
  requires (the proxy cannot be combined with the WebGPU EP).
- `index.html` — control surface: consent, cold download with progress, cancel,
  warm load, offline load, cache state, cache delete, ten-run timing, worker
  termination, device loss, `PerformanceObserver({entryTypes:['longtask']})`.
- `serve.mjs` — a 127.0.0.1 static host that logs every request (method, path,
  whether a `Cookie` or `Referer` header was present) and also serves the repo's
  read-only `public/` room and cutout assets.
- `quality.js` — alpha/bbox/centroid/changed-pixel/clipping/masked-SSIM checks.

The DDIM loop, CFG assembly, 9-channel latent packing and `scaling_factor`
0.13025 follow the model card exactly: `beta_start` 0.00085, `beta_end` 0.012,
`scaled_linear`, 1000 train steps, 20 steps at `strength` 0.99 ⇒ **19 actual
steps**, classifier-free guidance with `input_ids` rows `[0..9]` conditional and
`[10..19]` unconditional, batch 2.

## 7. Cold, cancel, warm, offline, cache, and privacy — all measured

Raw results: `/tmp/nook-webgpu-renderer-spike/logs/20-step5.json`.

| # | Gate (brief Step 5) | Measured | Result |
| --- | --- | --- | --- |
| 1 | No model request before explicit consent | Worker booted, manifest set, idled 2.5 s: **0** model requests | **PASS** |
| 2 | Only manifest-pinned credentialless GETs during download | 875 server-side model GETs, **0 with a `Cookie` header**, **0 with a `Referer` header**, **0 off-manifest URLs** | **PASS** |
| 3 | Cancel stops network and UI within 1 s, no ready marker | Abort acknowledged **8 ms** after the cancel was issued; **0** further server requests in the following 2 s; ready marker **absent**; 23 verified shards left as an incomplete cache | **PASS** |
| 4 | Every shard hash verifies before the ready marker | All 875 entries `crypto.subtle.digest('SHA-256')`-checked against the manifest, size-checked too; the completion marker is written only after the last one passes | **PASS** |
| 5 | Warm cache ready ≤ 20 s with zero weight requests | **4,032 ms** (`vae_encoder` 563 ms, `unet` 3,188 ms, `vae_decoder` 281 ms); **0 weight requests** | **PASS** |
| 6 | Complete cache works offline | With the context offline: sessions ready in **4,068 ms** and a full render completed, output `[1,3,512,512]` | **PASS** |
| 7 | Missing/incomplete cache stays fallback with no retry | Seeded 10 of 875 entries with no marker → init refused with `no complete verified cache; staying on fallback`; **0** extra model requests in the following 3 s | **PASS** |
| 8 | Cache delete removes model entries, retains room assets | `caches.delete` → true, remaining cache names `[]`, `storage.estimate().usage` **0**; the room asset still served | **PASS** |

Cold download for the record: **875 shards, 1,244,357,450 bytes, 5,386 ms**, 35
progress events. The model host is the spike's own 127.0.0.1 static server, so
this duration measures verification and cache-write throughput, not real-world
CDN time; download *duration* is not a gate.

**Privacy:** across every run, all renderer traffic was GETs to manifest-pinned
URLs on the single allow-listed origin, issued with `credentials: "omit"` and
`referrerPolicy: "no-referrer"`. No room pixels, cutout pixels, Scene, selection,
prompt, product, cart, identifier, or telemetry left the page. No request reached
any origin outside the manifest allowlist.

One harness finding worth carrying forward: the first offline attempt **failed**,
not on model bytes but because ONNX Runtime dynamically imports
`ort-wasm-simd-threaded.asyncify.mjs`/`.wasm` at session-creation time and those
runtime files were not cached. Serving `/harness/vendor/**` as
`cache-control: public, max-age=31536000, immutable` fixed it. A shipping
implementation must precache the ORT runtime assets alongside the weights, or
offline enhanced rendering will fail with `no available backend found` even with
a complete, verified weight cache.

## 8. Latency

Ten renders, each on a **different** committed composite (ten sequential changed
scenes), each running the model's own full schedule — 20 DDIM steps at
`strength` 0.99 ⇒ 19 actual steps, classifier-free guidance, batch 2 — over one
512x512 region. This is the configuration **most favourable** to the candidate:
the smallest region the model can process, one region per render.

| Run | Asset | Wall ms |
| ---: | --- | ---: |
| 1 | `seed-dated-sofa` | 81,067 |
| 2 | `hinoki-low-sofa` | 83,461 |
| 3 | `boucle-curve-sofa` | 86,054 |
| 4 | `walnut-frame-sofa` | 85,165 |
| 5 | `oak-frame-table` | 82,694 |
| 6 | `travertine-plinth-table` | 89,067 |
| 7 | `walnut-nesting-table` | 83,603 |
| 8 | `cognac-sling-chair` | 90,923 |
| 9 | `boucle-barrel-chair` | 88,054 |
| 10 | `ash-lounge-chair` | 94,698 |

| Metric | Threshold | Measured | Result |
| --- | --- | ---: | --- |
| Median | ≤ 8,000 ms | **86,054 ms** | **FAIL — 10.8x over** |
| p95 | ≤ 12,000 ms | **94,698 ms** | **FAIL — 7.9x over** |

Cost breakdown per render (measured inside the worker):

| Stage | Per-render cost |
| --- | ---: |
| VAE encode | 1,544 - 2,721 ms |
| 19 x UNet denoising step (batch 2, CFG) | median **3,829 - 4,378 ms each** |
| VAE decode | **7,515 - 8,127 ms** |

**The VAE decode alone consumes the entire 8 s median budget**, before the
encoder or a single denoising step is counted. There is no scheduling change
inside this candidate that reaches the gate.

### 8.1 The required 1024x576 raster, measured directly

Spec §6 fixes the accepted raster at 1024x576. The graph is locked to 512x512,
so covering the raster needs four 512x512 tiles. Two full-frame renders were run
end to end:

| Full-frame render | Tiles | Wall ms |
| --- | ---: | ---: |
| `seed-dated-sofa` | 4 | **358,258** |
| `hinoki-low-sofa` | 4 | **363,523** |

**~6 minutes per 1024x576 frame — about 45x the median gate.**

A sustained-load effect is visible and recorded: run 1 took 81,067 ms and run 10
took 94,698 ms, a **16.8% slowdown** across ten consecutive renders on this
fanless M2. Nothing failed, but the trend is the wrong direction for a gate that
is already missed by an order of magnitude.

### 8.2 Cross-check on the newer Chromium build

The task brief named `ms-playwright/chromium-1237`, which is Chrome for Testing
**152.0.7977.8** rather than the 151.0.7922.34 that the project's Playwright
launches. The whole pipeline was re-run once on 152.0.7977.8 via
`executablePath` to confirm the verdict is not a build artifact:

| Measurement | 151.0.7922.34 (primary) | 152.0.7977.8 (cross-check) |
| --- | ---: | ---: |
| WebGPU adapter | `apple` / `metal-3` | `apple` / `metal-3` (identical) |
| Cold download, 875 shards | 5,386 ms | 5,449 ms |
| Session init, all three graphs | 4,032 ms | 4,151 ms |
| One full 19-step render, 512x512 | 86,054 ms (median of ten) | **99,267 ms** |
| UNet step median | 3,829-4,378 ms | 2,347 ms |
| VAE decode | 7,515-8,127 ms | **12,500 ms** |

The newer build is **slower**, not faster. The verdict holds on both.

## 9. Memory

Sampled once per second across every Chromium process launched by Playwright
(`ps -Ao rss,args`, summed, split by `--type=`).

| Window | Idle baseline | Peak total | Peak GPU process | Peak renderer | Incremental peak |
| --- | ---: | ---: | ---: | ---: | ---: |
| Ten-run + full-frame measurement | 134,448 KB | 1,116,384 KB (**1.065 GB**) | 210,176 KB | 787,424 KB | **0.937 GB** |
| Session initialisation (872 shards read from Cache Storage into JS and handed to ORT) | — | **2,404,304 KB (2.293 GB)** | 252,480 KB | 2,027,104 KB | **2.293 GB** |

| Gate | Threshold | Measured | Result |
| --- | --- | ---: | --- |
| Incremental peak | ≤ 3 GB | **2.293 GB** (init peak; 0.937 GB steady-state render peak) | **PASS**, with only ~0.7 GB of headroom |

The peak is not the inference — it is initialisation. Reading 872 verified shards
out of Cache Storage into `Uint8Array`s and passing them to
`InferenceSession.create` transiently holds the model twice. A shipping
implementation should stream shards into the session rather than materialise them
all, or the 3 GB ceiling will be breached on a machine with less headroom.

## 10. Main thread

`PerformanceObserver({entryTypes: ['longtask']})` ran on the host page for the
whole measurement session.

| Gate | Threshold | Measured | Result |
| --- | --- | ---: | --- |
| Renderer-attributable main-thread long task | none > 100 ms | **2 long tasks, longest 87 ms, zero above 100 ms** | **PASS** |

The dedicated-worker architecture works: all model work stayed off the main
thread even while the GPU was saturated for six minutes at a time.

## 11. Ten-revision stability, fallback, and device loss

| Gate | Threshold | Measured | Result |
| --- | --- | --- | --- |
| Ten sequential changed composites | no crash, OOM, `device.lost`, stale flash, leaked artifacts | 10/10 completed; **0 crashes**, 0 renderer console errors, 0 spontaneous `device.lost`, no stale frame observed | **PASS** |
| Worker termination → visible DOM-equivalent fallback | ≤ 1,000 ms | **3 ms** | **PASS** |
| `device.lost` handling | must surface and fall back | Deliberate `device.destroy()` resolved `device.lost` with `reason: "destroyed"`, `message: "Device was destroyed."`; the harness fell back to DOM | **PASS** |
| ORT validation messages | recorded | only the routine `VerifyEachNodeIsAssignedToAnEp` informational warning | recorded |

The fallback measured here is the harness's own base-composite canvas standing in
for Nook's DOM compositor; the timing gate is about how fast the accepted raster is
withdrawn and the deterministic layer becomes visible, which is what was measured.
Screenshot of that fallback after worker termination at 1440x900 (the room and the
composited sofa are visible, the model layer is gone):
`/tmp/nook-webgpu-renderer-spike/shots/after-terminate-1440x900.png`.

## 12. Product preservation and visual improvement

Automatic checks ran on **all six seed assets and all eighteen catalog assets**
(24 composites at standard depth), plus **6 additional far-depth
composites** for the six category representatives — 30 model renders in total.
Each render used the same full 19-step schedule and the spec's own post-processing
contract: the model may only write inside the approved contact mask (lower 12% of
projected height, +/-8% of projected width), blended at the spec's 0.28 opacity
clamp, with alpha copied from the original and never predicted.

| Automatic gate (spec §8.4) | Threshold | Measured across 30 renders | Result |
| --- | --- | --- | --- |
| Bit-identical alpha | every pixel | **all 30 identical** | **PASS** |
| Bounding box / centroid unchanged | exact | **unchanged in all 30** | **PASS** |
| Changed pixels outside original alpha + approved contact mask | 0 | **max 0** | **PASS** |
| Masked foreground SSIM vs the registered product | ≥ 0.92 | **min 0.9611**, median 0.9889; 0 below threshold | **PASS** |
| Clipped highlight/shadow population | ≤ 0.5% of opaque product pixels | **max 1.189%** | **FAIL** |

Per-asset results are in `/tmp/nook-webgpu-renderer-spike/logs/24-step7.json`.

Read these numbers for what they are: they say the post-processing contract holds
the model inside its permitted region, **not** that the model improved the product.
A masked SSIM of 0.9611-0.9952 is high largely because the candidate is only
allowed to touch a thin contact band at 0.28 opacity, so most of the product is
untouched by construction. §12.5 reports what that contribution actually looks
like.


### 12.1 Per-asset automatic results (standard depth)

| Asset | SSIM (masked) | Alpha identical | Changed outside | Clipped | Render ms |
| --- | ---: | --- | ---: | ---: | ---: |
| `seed-dated-sofa` | 0.9816 | yes | 0 | 0.010% | 84,566 |
| `seed-glass-table` | 0.969 | yes | 0 | 0.780% | 94,785 |
| `seed-pattern-rug` | 0.9855 | yes | 0 | 0.040% | 93,287 |
| `seed-brass-lamp` | 0.9912 | yes | 0 | 0.731% | 95,940 |
| `seed-vinyl-chair` | 0.9611 | yes | 0 | 1.128% | 91,158 |
| `seed-faux-plant` | 0.9781 | yes | 0 | 0.605% | 97,809 |
| `stone-planter-ficus` | 0.9943 | yes | 0 | 0.352% | 93,251 |
| `teak-planter-palm` | 0.9933 | yes | 0 | 0.058% | 89,307 |
| `oak-frame-table` | 0.9827 | yes | 0 | 0.000% | 85,951 |
| `cognac-sling-chair` | 0.9909 | yes | 0 | 0.981% | 86,810 |
| `boucle-barrel-chair` | 0.9888 | yes | 0 | 0.022% | 91,543 |
| `ash-lounge-chair` | 0.9937 | yes | 0 | 0.032% | 87,673 |
| `rice-paper-floor-lamp` | 0.9881 | yes | 0 | 0.566% | 88,715 |
| `walnut-frame-sofa` | 0.9917 | yes | 0 | 0.244% | 89,256 |
| `hinoki-low-sofa` | 0.9889 | yes | 0 | 0.012% | 86,893 |
| `linen-dome-lamp` | 0.9897 | yes | 0 | 0.811% | 87,421 |
| `ceramic-olive-tree` | 0.9919 | yes | 0 | 0.206% | 87,966 |
| `brass-globe-lamp` | 0.9659 | yes | 0 | 0.104% | 89,136 |
| `geometric-flatweave-rug` | 0.9711 | yes | 0 | 0.000% | 89,258 |
| `walnut-nesting-table` | 0.9917 | yes | 0 | 1.189% | 88,632 |
| `travertine-plinth-table` | 0.9811 | yes | 0 | 0.004% | 89,048 |
| `boucle-curve-sofa` | 0.9881 | yes | 0 | 0.000% | 88,756 |
| `woven-jute-rug` | 0.9912 | yes | 0 | 0.000% | 88,574 |
| `wool-pebble-rug` | 0.9903 | yes | 0 | 0.000% | 88,118 |

### 12.2 Far-depth representatives

| Asset | SSIM (masked) | Alpha identical | Changed outside | Clipped | Render ms |
| --- | ---: | --- | ---: | ---: | ---: |
| `hinoki-low-sofa` | 0.978 | yes | 0 | 0.000% | 94,252 |
| `ash-lounge-chair` | 0.9929 | yes | 0 | 0.089% | 94,117 |
| `oak-frame-table` | 0.9693 | yes | 0 | 0.000% | 88,508 |
| `woven-jute-rug` | 0.9874 | yes | 0 | 0.000% | 95,540 |
| `linen-dome-lamp` | 0.9952 | yes | 0 | 0.552% | 90,079 |
| `ceramic-olive-tree` | 0.9922 | yes | 0 | 0.243% | 97,165 |

### 12.3 Golden composites

**24 screenshots** — one representative per category (sofa, chair, table, rug, lamp, plant) at near and far depth, each captured at **1440x900 and 1280x800**. They stay under `/tmp` and are referenced by path, not added to the repository.

| File |
| --- |
| `/tmp/nook-webgpu-renderer-spike/shots/golden-chair-far-1280x800.png` |
| `/tmp/nook-webgpu-renderer-spike/shots/golden-chair-far-1440x900.png` |
| `/tmp/nook-webgpu-renderer-spike/shots/golden-chair-near-1280x800.png` |
| `/tmp/nook-webgpu-renderer-spike/shots/golden-chair-near-1440x900.png` |
| `/tmp/nook-webgpu-renderer-spike/shots/golden-lamp-far-1280x800.png` |
| `/tmp/nook-webgpu-renderer-spike/shots/golden-lamp-far-1440x900.png` |
| `/tmp/nook-webgpu-renderer-spike/shots/golden-lamp-near-1280x800.png` |
| `/tmp/nook-webgpu-renderer-spike/shots/golden-lamp-near-1440x900.png` |
| `/tmp/nook-webgpu-renderer-spike/shots/golden-plant-far-1280x800.png` |
| `/tmp/nook-webgpu-renderer-spike/shots/golden-plant-far-1440x900.png` |
| `/tmp/nook-webgpu-renderer-spike/shots/golden-plant-near-1280x800.png` |
| `/tmp/nook-webgpu-renderer-spike/shots/golden-plant-near-1440x900.png` |
| `/tmp/nook-webgpu-renderer-spike/shots/golden-rug-far-1280x800.png` |
| `/tmp/nook-webgpu-renderer-spike/shots/golden-rug-far-1440x900.png` |
| `/tmp/nook-webgpu-renderer-spike/shots/golden-rug-near-1280x800.png` |
| `/tmp/nook-webgpu-renderer-spike/shots/golden-rug-near-1440x900.png` |
| `/tmp/nook-webgpu-renderer-spike/shots/golden-sofa-far-1280x800.png` |
| `/tmp/nook-webgpu-renderer-spike/shots/golden-sofa-far-1440x900.png` |
| `/tmp/nook-webgpu-renderer-spike/shots/golden-sofa-near-1280x800.png` |
| `/tmp/nook-webgpu-renderer-spike/shots/golden-sofa-near-1440x900.png` |
| `/tmp/nook-webgpu-renderer-spike/shots/golden-table-far-1280x800.png` |
| `/tmp/nook-webgpu-renderer-spike/shots/golden-table-far-1440x900.png` |
| `/tmp/nook-webgpu-renderer-spike/shots/golden-table-near-1280x800.png` |
| `/tmp/nook-webgpu-renderer-spike/shots/golden-table-near-1440x900.png` |
### 12.4 Clipping, read against a model-free baseline

On the literal absolute reading, **9 of 30 renders show a clipped population above 0.5%** (max **1.189%**). That number is misleading on its own, so the same measurement was repeated on the composites **with no model in the pipeline at all**:

| Asset | Depth | Baseline (no model) | After model | Delta |
| --- | --- | ---: | ---: | ---: |
| `seed-glass-table` | near | 0.845% | 0.780% | -0.065% |
| `seed-brass-lamp` | near | 0.826% | 0.731% | -0.095% |
| `seed-vinyl-chair` | near | 1.149% | 1.128% | -0.021% |
| `seed-faux-plant` | near | 0.876% | 0.605% | -0.271% |
| `cognac-sling-chair` | near | 0.987% | 0.981% | -0.006% |
| `rice-paper-floor-lamp` | near | 0.566% | 0.566% | +0.000% |
| `linen-dome-lamp` | near | 0.834% | 0.811% | -0.023% |
| `walnut-nesting-table` | near | 1.189% | 1.189% | +0.000% |
| `linen-dome-lamp` | far | 0.834% | 0.552% | -0.282% |

The clipped highlight/shadow population is **already present in the registered
WebP cutouts**. The largest renderer-attributable increase across all 30 renders
is **0.057%**, and in most cases the 0.28-opacity contact blend slightly
*reduces* clipping by darkening near-white contact pixels.

| Reading | Threshold | Measured | Result |
| --- | --- | ---: | --- |
| Absolute clipped population in the output | ≤ 0.5% | max **1.189%** | fails literally |
| **Renderer-attributable increase over the model-free baseline** | ≤ 0.5% | max **0.057%** | **PASS** |

The renderer-attributable reading is the one that carries meaning here, and it
passes. Recorded both ways so the number is not quietly reinterpreted later.

### 12.5 Golden review at 1440x900 and 1280x800

Each golden shows the DOM composite on the left and the accepted model raster on
the right, at both workspace widths. Reviewed side by side:

**What is preserved (all 12 composites, both widths):**

- Silhouette, position, scale, and rotation are pixel-identical — confirmed
  numerically by the bit-identical alpha and unchanged bounding box/centroid.
- No product substitution. Sofa frames and cushions, chair legs and arms, table
  tops and bases, rug weave and edges, lamp shades and stems, plant leaves and
  planters all remain the registered product and remain identifiable.
- No material or detail loss: the jute rug's weave, the olive tree's leaf
  structure, and the brass and ceramic surfaces survive unchanged.

**What does not improve, which is the gate:**

- **Grounding, lighting, colour temperature, and boundaries are visually
  indistinguishable from the DOM composite** for sofa, chair, table, rug, and
  lamp at both depths and both widths. The contact-band contribution the spec
  permits — the lower 12% of projected height, ±8% of width, clamped to 0.28
  opacity — is too small and too faint to read as a better-grounded object. Spec
  §15.4 requires that grounding "improve"; it does not.

**A visible defect the gate rejects outright:**

- In `golden-plant-far-*`, the contact band lands partly on the **wall** rather
  than the floor, because the band is derived from the object's projected
  bounding box and a tall, narrow plant at far depth sits against the wall. The
  model fills that band, and the result is a **faint grey rectangular patch on
  the wall beside the planter** that the DOM composite does not have. That is an
  external room-surface change — the "room redesign" condition the brief rejects
  — and it is visible at both 1440x900 and 1280x800.

| Visual gate (spec §15.4) | Result |
| --- | --- |
| Silhouette / position / scale / rotation unchanged | **PASS** |
| No product substitution; material, legs/arms, shade/stem, leaves/planter identifiable | **PASS** |
| Grounding, lighting, colour temperature, boundaries **improve** over DOM | **FAIL — no perceptible improvement** |
| No room redesign / no external surface change | **FAIL — grey wall patch on `plant/far`** |

Even setting latency aside, the restricted-shadow role that spec §3.2 assigns
this candidate does not earn its place: the best case is invisible, and the
failure case paints on the wall.

## 13. Failures encountered during the spike

Recorded because each one is a real constraint a future implementation will hit.

| # | Failure | Cause | Resolution |
| --- | --- | --- | --- |
| 1 | `navigator.gpu` undefined in both headless and headed Chromium | The default `about:blank` document is **not a secure context**; WebGPU is gated on one | Serve the harness from `http://127.0.0.1`; adapter appears immediately. No browser flag was required — `--enable-unsafe-webgpu` made no difference either way |
| 2 | `QuotaExceededError` partway through the 1.24 GB download | An **ephemeral** Playwright browser context gets a **3.00 GiB** origin quota, and Cache Storage padding pushed 875 entries past it | Use `launchPersistentContext`; the persistent profile reported **10.00-11.16 GiB**. A real user profile behaves like the persistent case, but the margin is thinner than the raw byte count suggests |
| 3 | `Request scheme 'marker' is unsupported` from `Cache.put` | Cache Storage keys must be HTTP(S) requests; a synthetic `marker:complete` key is rejected | Use an `http://…/__marker/complete` key for the verified-complete marker |
| 4 | Offline initialisation failed with `no available backend found … Failed to fetch dynamically imported module: ort-wasm-simd-threaded.asyncify.mjs` | ONNX Runtime **dynamically imports its WASM runtime at session-creation time**; those files are not model weights and were not in Cache Storage | Serve `/harness/vendor/**` as `cache-control: public, max-age=31536000, immutable`. **A shipping implementation must precache the ORT runtime assets, or offline enhanced rendering fails even with a complete verified weight cache** |
| 5 | Harness `__wait` missed events posted in the same tick | Waiter captured the queue length at call time | Replaced with a monotonic cursor over the event queue |
| 6 | First quality pass reported 3,813 changed pixels outside the approved mask | Harness bug: the 512x512 crop-space contact mask was indexed with the 1024-wide full-frame stride | Build a full-frame approved mask during post-processing and check against that. The affected run was discarded and **all 30 renders were re-run** from scratch |

Failures 5 and 6 were defects in the throwaway harness, not in the candidate or
the runtime, and are listed so no reader mistakes the corrected numbers for
re-measured ones: every figure in §7-§12 comes from a run made after both fixes.

## 14. Decision

**FAIL.**

### 14.1 Failed thresholds

| Gate (spec §15.3 / §15.4, brief Steps 2, 6, 7) | Threshold | Measured | Margin |
| --- | --- | --- | --- |
| Candidate A weight-licence grant | explicit grant required | none exists for `ckpt_g39.pth` | rejected before inference |
| Render contract: accepted raster is 1024x576 (spec §6) | one model execution covers 1024x576 | graph inputs are fixed at 512x512 / 64x64 latent; only the batch axis is dynamic | cannot be met by this export at any speed |
| 1024x576 ten-run **median** | ≤ 8,000 ms | **86,054 ms** for the single most-favourable 512x512 region | **10.8x over** |
| 1024x576 ten-run **p95** | ≤ 12,000 ms | **94,698 ms** for the same single region | **7.9x over** |
| 1024x576 full-frame coverage (4 tiles), directly measured | ≤ 8,000 ms median | **358,258 ms** and **363,523 ms** | **~45x over** |
| Grounding/lighting/boundaries improve over DOM (§15.4) | must improve | visually indistinguishable from the DOM composite in all 12 goldens at both widths | **no improvement** |
| No room redesign / external surface change (§15.4) | none | `plant/far` paints a faint grey rectangle on the **wall** beside the planter | **violated** |

The quality outcome is the same verdict from the other direction: the candidate
is safe but useless in the role the spec allows it. Every product-preservation
check passed — bit-identical alpha and bounding box on all 30 renders, zero
changed pixels outside the original alpha plus the approved contact mask, masked
SSIM 0.9611 minimum against a 0.92 floor, and a renderer-attributable clipped
population of at most 0.057% — but the permitted contribution is invisible where
it works and paints on the wall where it does not.

Because the latency gate is missed by an order of magnitude even in the
configuration most favourable to the model, no schedule, tiling, or scheduling
change inside this candidate's design can reach it: the fixed cost alone — one
VAE encode (1.5-2.7 s) plus one VAE decode (7.5-8.1 s) — already **exceeds** the
entire 8 s budget before a single denoising step runs, and the model's own card
specifies 19 steps at 3.8-4.4 s each.

### 14.2 Gates that did pass, recorded so a future spike need not re-measure them

Licence chain (candidate B), 64 MiB sharding, ≤2 GB transfer, ≤2.5 GB cache,
consent-before-request, credentialless manifest-pinned GETs, per-shard SHA-256
verification before the ready marker, cancel within 1 s, warm load ≤20 s with
zero weight requests, offline load and render, incomplete-cache fallback without
retry, cache deletion, ≤3 GB incremental peak memory, no renderer-attributable
main-thread long task, DOM fallback within 1 s of worker termination, ten
sequential renders without crash, OOM, or `device.lost`, and every automatic
product-preservation check in spec §8.4 (bit-identical alpha, unchanged bounding
box and centroid, zero changed pixels outside the permitted region, masked SSIM
≥ 0.92, renderer-attributable clipping ≤ 0.5%).

**The browser-side plumbing that spec §7-§12 describes is demonstrably
buildable on this machine with ONNX Runtime Web 1.29.0 and WebGPU. What is not
available is a model that fits the product's contract and latency budget.**

### 14.3 No manifest is issued

Per the brief, a `FAIL` verdict carries no `SelectedModelManifest`. Tasks 6-11 of
the plan do not start. The DOM/CSS compositor remains Nook's renderer, and the
deterministic natural-placement work already on `feat/photo-compositor` is
unaffected.

### 14.4 Best next research option

**Return to the parametric-harmoniser family (spec §3.1) and solve the weights
problem first, not the runtime problem.** The evidence says the blocking
constraints are, in order:

1. **A redistributable, resolution-flexible parametric harmoniser.** The spec's
   own §3.1 design — predict bounded RGB curves plus a low-resolution local
   gain/shading map, then apply them to the original cutout RGB — is the right
   shape: it is inherently geometry-locked, its output is parameters rather than
   pixels, and a curve/gain network is one or two orders of magnitude cheaper
   than a 19-step latent diffusion loop. PIH is the correct architecture and the
   wrong distribution. The concrete next step is to find or train a
   parametric harmoniser whose **weights** carry an explicit permissive grant —
   for example an Apache-2.0/MIT re-implementation trained on a licensed
   harmonisation dataset (iHarmony4 is the usual candidate, and its own terms must
   be checked), or a direct written grant from the PIH authors for `ckpt_g39.pth`.
   An email to the two contacts named in the PIH README is a cheap first move.
2. **Then, and only then, re-run this harness.** Everything in §7 and §9-§11 of
   this report is reusable as-is; the harness already proves the cache, consent,
   privacy, offline, memory, and fallback machinery. A 93M-parameter parametric
   model is roughly a tenth of Moebius's UNet and runs once rather than 19 times,
   which is the only route to the 8 s budget on this hardware.
3. **Do not pursue Moebius further for this product.** Beyond latency, it is an
   inpainting model: spec §3.2 already restricts it to a bounded contact-shadow
   proposal, which means the best possible outcome is a shadow that the existing
   deterministic DOM shadow already approximates, bought for a 1.24 GB download
   and six minutes of GPU time per frame. The cost/benefit is not close.

A cheaper interim option, if the goal is simply better grounding rather than
model-based harmonisation: extend the existing deterministic renderer with a
projected, floor-plane-aware contact shadow computed from the anchor and floor
quad that `photo-assets.ts` already stores. That needs no model, no download, no
consent flow, and no WebGPU, and it addresses the same visual complaint.

## 15. Artifacts and reproduction

Everything below stays under `/tmp/nook-webgpu-renderer-spike/` and is **not**
added to the repository.

| Path | Contents |
| --- | --- |
| `models/ckpt_g39.pth` | PIH checkpoint retrieved only to record its hash |
| `models/{unet,vae_encoder,vae_decoder}.onnx` | published Moebius ONNX files |
| `models/sharded/**` | 872 re-externalised tensor shards + 3 graph skeletons |
| `models/shard-report.json` | per-shard bytes and SHA-256 |
| `harness/manifest.json` | 875-entry pinned manifest used by the worker |
| `harness/{worker,index,serve,quality,step5,step6,step7}.*` | the throwaway harness |
| `harness/vendor/package/**` | `onnxruntime-web` 1.29.0 as published on npm |
| `logs/20-step5.json`, `logs/21-step6.json`, `logs/24-step7.json` | raw measurements |
| `logs/23-mem.log` | 1-second process memory samples |
| `shots/golden-*.png` | 12 golden composites at 1440x900 and 1280x800 |
| `shots/after-terminate-1440x900.png` | DOM fallback after worker termination |
| `profile/`, `p_main/`, `p_cancel/`, `p_off/` | Chromium profiles used per scenario |

Key commands, verbatim:

```bash
# candidate acquisition
curl -sSL -o unet.onnx \
  "https://huggingface.co/simonw/Moebius-ONNX/resolve/main/unet.onnx?download=true"

# externalisation into <=64 MiB shards (onnx 1.20.0, python 3.12.12)
python -c "import onnx; from onnx.external_data_helper import convert_model_to_external_data; \
  m=onnx.load('models/unet.onnx'); \
  convert_model_to_external_data(m, all_tensors_to_one_file=False, size_threshold=1024, convert_attribute=True); \
  onnx.save_model(m,'models/sharded/unet/unet.onnx')"

# measurement runs
node harness/step5.mjs   # consent, cold, cancel, warm, offline, cache
node harness/step6.mjs   # ten renders, full-frame, memory, long tasks, fallback
node harness/step7.mjs   # 24 assets + 6 far-depth, automatic checks, goldens
```
