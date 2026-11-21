# Reframe Studio - GAN-Based Image Inpainting

A complete, **Vercel-ready image restoration workspace**. Repair scratches and missing regions with pretrained MI-GAN, a fast context-fill algorithm, or the project's small edge-guided GAN. Processing happens entirely in the browser: no photo uploads, Python server, API keys or GPU service.

![Studio interface](docs/studio-editor.png)

## Deploy to Vercel

Import **PRABHMANNAT/GAN-BASED-IMAGE-INPAINTING**, leave **Root Directory** as **./**, and deploy. The committed root `vercel.json` selects Vite, `npm ci`, `npm run build`, and output directory `web/dist`. Use Node.js 22 or 24. **No environment variables are required.**

See [DEPLOY_TO_VERCEL.md](DEPLOY_TO_VERCEL.md) for full instructions. Deployment is left to the repository owner as requested; this delivery does not claim a live Vercel URL.

## Run locally

Install Node.js **22 or newer**:

```bash
npm ci
npm run dev
```

Open the printed URL, usually **http://127.0.0.1:5173**. Windows users can double-click **start_studio_windows.bat**.

To test the static production build:

```bash
npm run build
npm run preview
```

The production directory is `web/dist`. Runtime binaries, neural models, samples and icons are self-hosted. Inference does not call a remote AI service.

## New in Studio 2.0

- **Pretrained AI repair:** author-released MI-GAN-512-Places2 runs locally through ONNX Runtime Web.
- **Three real methods:** pretrained MI-GAN, fast distance-ordered context fill, and the separate edge-guided teaching GAN.
- **Precise selection:** brush, eraser, rectangle, 25-step undo/redo, and mask visibility.
- **Automatic scratch suggestions:** OpenCV top-hat/black-hat morphology with adjustable sensitivity. Review suggestions before repair.
- **Canvas controls:** zoom, fit, pan, touch drawing and keyboard shortcuts.
- **Repair settings:** classical context radius, inward edge softness and repair strength.
- **Before/after slider:** inspect original and restored images at the same scale.
- **Traceable exports:** PNG result, binary mask and JSON with input/mask hashes, model provenance, settings and processing time.
- **Reference scores:** full-image and masked PSNR only when a clean reference is declared. Uploaded images default to no reference.
- **Responsive interface:** desktop, tablet and phone layouts, a guide and two original sample illustrations.
- **Private execution:** a Web Worker processes images without uploading them or saving them in the cloud.

## Try it

1. Open a sample or upload a PNG, JPEG or WebP up to 20 MB.
2. Click **Add scratches**, draw with brush/rectangle, or try **Detect thin scratches**.
3. Choose a method and click **Restore image**.
4. Move the comparison slider and inspect the details.
5. Download the PNG and processing record. **Save mask** exports white selected regions on black; **Import mask** requires the working image's exact dimensions.

Shortcuts: **B** brush, **E** eraser, **R** rectangle, **H** pan, **[ / ]** brush size, **Ctrl/Cmd+Z** undo, **Ctrl/Cmd+Shift+Z** redo, **Enter** restore. Hold **Space** and drag to pan, or scroll to zoom.

The first neural run loads its model and WebAssembly runtime from the deployment. Pretrained MI-GAN is about 28 MB. Subsequent runs reuse the loaded session. Older devices can use Fast repair or repair smaller regions.

## Actual methods

| Method | Implementation | Use and limits |
| --- | --- | --- |
| AI repair | Official MI-GAN-512-Places2 ONNX pipeline v2, CPU/WebAssembly | Natural-scene inpainting; may invent incorrect details |
| Fast repair | Original distance-ordered, inverse-distance weighted context propagation in JavaScript | Thin scratches and smooth areas; not OpenCV Telea or Navier-Stokes |
| Edge-guided GAN | Five-channel U-Net: masked RGB, binary mask and visible Canny edges | Teaching checkpoint trained for 300 steps on synthetic facade illustrations only |

Pretrained MI-GAN improves on the tiny teaching model, but neither is the report's trained EdgeAwareGAN. This independent implementation follows preparation, generation, composition and review. It does not claim the report's accuracy or reproduce its experiments.

Visible pixels are copied exactly into the final composite. Softness blends **inward**, preserving pixels outside the binary mask. MI-GAN receives an internal five-pixel mask margin so its pipeline's boundary feathering falls outside the actual selected region; final composition still uses only the user mask. Hidden original values are removed before neural conditioning. Model errors are shown explicitly, with no silent substitution.

Images are EXIF-oriented, flattened on white and proportionally resized to at most **1,200 pixels** on the longest side. Exports contain this working-size image. The teaching GAN predicts at 256 square; the published MI-GAN pipeline handles its own crop and 512-square inference. Browser and Python interpolation need not be pixel-identical.

Automatic detection can select real hair, lettering, windows or texture. Correct its suggestions with the eraser. Large holes may produce blur or implausible structures. Treat every output as an unreviewed derivative.

PSNR requires a clean target. A score against an already damaged input does not measure restoration accuracy. Full-image PSNR can hide errors in small regions; inspect masked PSNR and the actual output. Infinite PSNR is `null` in JSON and shown as infinity in the interface. SSIM is not implemented.

## Code map

```text
package.json / package-lock.json  Root installation and build commands
vercel.json                      Vite static hosting configuration
DEPLOY_TO_VERCEL.md               Import-and-deploy instructions
web/index.html                   Studio interface
web/src/main.js                  Canvas, tools, comparison and exports
web/src/style.css                Responsive styling
web/public/processor.js          Inference and analysis worker
web/public/repair-core.js        Context fill, masks, compositing and PSNR
web/public/models/               ONNX models, licenses and provenance
web/public/samples/              Original procedural illustrations
web/scripts/prepare-runtime.mjs  Copies matching locked runtime assets
web/tests/                       Numerical and real-browser tests
export_web_model.py              Teaching-model ONNX export and parity check
app.py / model.py / train.py      Original Flask/PyTorch teaching demo
```

Python source and training remain available for study in the [original Python instructions](docs/PYTHON_DEMO.md). **Python is not needed for Studio or Vercel.** `start_windows.bat` starts the original demo; `start_studio_windows.bat` starts Studio 2.0.

## Verify

```bash
npm ci
npm test
npm run build
npm run test:browser
```

For browser tests, install Chromium with `npx --prefix web playwright install chromium` if system Chrome is unavailable. You can also set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to your browser binary. Tests build and serve production files.

Numerical tests cover mask validation, hidden-target invariance, visible-pixel preservation with feathering, analytic PSNR, conservative mask resizing and boundary distance. Browser tests execute both real neural models and context fill, exercise editing and exports, check mobile width and absent reference scores, and verify neural hidden-target invariance. Teaching-model ONNX export is checked against PyTorch with maximum absolute error below 0.0001.

## Credits

MI-GAN: Andranik Sargsyan, Shant Navasardyan, Xingqian Xu and Humphrey Shi, *MI-GAN: A Simple Baseline for Image Inpainting on Mobile Devices*, ICCV 2023. The authors' [official repository](https://github.com/Picsart-AI-Research/MI-GAN) links the redistributed ONNX pipeline. Weights are MIT-licensed; the full notice and SHA-256 are included.

See [third-party notices](web/THIRD_PARTY_NOTICES.md), [ONNX deployment documentation](https://onnxruntime.ai/docs/tutorials/web/deploy.html) and [Vite deployment documentation](https://vite.dev/guide/static-deploy). Samples are original illustrations. The supplied PDF is not redistributed.
