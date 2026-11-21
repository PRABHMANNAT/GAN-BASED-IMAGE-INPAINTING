# Reframe - GAN-Based Image Inpainting

A simple local demonstration of the pipeline described in **GAN-Based Image Inpainting for Damaged Historical Images**. Upload an image, paint a damage mask, generate a candidate, compare it with the masked input, and download the result and processing record.

**This is an independent educational implementation.** The supplied report does not include source code, architecture-complete specifications, or pretrained weights. The bundled GAN was trained here on procedural facade illustrations only. It does not reproduce the report's models or numerical results and is not a validated historical-photo restoration system.

![Demo interface](demo.png)

## Run the demo

Use Python **3.11, 3.12 or 3.13**. No GPU, API key, account, or external image service is required. Internet access is needed to install dependencies once; image processing then runs locally.

### Windows - simplest option

Double-click **`start_windows.bat`**. It creates `.venv`, installs dependencies, and opens the local app. Keep the terminal open while using it. The first installation can take several minutes because PyTorch is included.

### Any platform - terminal

```bash
python -m venv .venv
```

Activate it on Windows PowerShell:

```powershell
.venv\Scripts\Activate.ps1
```

Or macOS/Linux:

```bash
source .venv/bin/activate
```

Then:

```bash
python -m pip install -r requirements.txt
python app.py
```

Open **http://127.0.0.1:5000**. Stop the server with `Ctrl+C`. The server binds only to the local computer; this is a local demonstration, not a public hosting configuration.

For a smaller CPU-only PyTorch installation, run this before installing the other requirements:

```bash
python -m pip install torch --index-url https://download.pytorch.org/whl/cpu
```

`requirements-tested.txt` records the exact Windows/Python 3.13 CPU environment used for verification. To install that environment, use `python -m pip install -r requirements-tested.txt --extra-index-url https://download.pytorch.org/whl/cpu`. `requirements.txt` uses compatible version ranges for portability.

## Demonstration in one minute

1. Use the built-in, original facade illustration or upload a PNG, JPEG or WebP.
2. Choose **Add scratches** or draw directly over a region. Use the eraser or undo to correct the mask.
3. Select **Edge-guided GAN** or **Telea baseline**.
4. Click **Generate restoration** and inspect the side-by-side images. Try a thin scratch first; the GAN's texture and detail quality are intentionally limited.
5. Download the restored PNG, binary mask, and JSON processing record.

Only check **clean image with simulated damage** when the input is an undamaged reference. Full-image and masked PSNR compare the candidate with this reference; they are meaningless as accuracy measurements for an already damaged image without a clean target. Infinite PSNR is represented as `null` in JSON and `∞` in the interface.

## What is implemented

| Report concept | Demonstration implementation |
| --- | --- |
| Masked RGB image | Missing pixels set to zero before inference |
| Binary damage mask | White/1 = missing, black/0 = visible; at most 60% coverage |
| Visible-context structural cue | Canny edges, thresholds 70/150, with a 7 x 7 dilated mask boundary suppressed |
| Edge-conditioned generator | Five-channel input, small U-Net with 16/32/64 feature widths and two skip connections |
| Conditional discriminator | Eight-channel condition/image PatchGAN used only during training |
| Training objective | Hole L1, visible-region L1, differentiable image-gradient L1, adversarial BCE |
| Composite | Original visible pixels copied exactly; predictions used only inside the mask |
| Review and export | Before/after display, PNG result, mask, JSON provenance and optional reference PSNR |

The generator uses sigmoid outputs in `[0,1]`; image tensors are RGB. Images are EXIF-oriented and reduced to at most 1,024 pixels on the longest side for the working canvas. GAN inference uses a square 256 x 256 input; predictions are resized back before composition. This can distort aspect ratios and blur detail. The bundled teaching run uses 64 x 64 training images for speed; this resolution gap is another reason not to infer restoration quality from it. Masks use conservative max-pooling for GAN resizing, and conditioning never reads hidden reference pixels.

**Telea is OpenCV's classical inpainting method. It is not GAN inference.** If the checkpoint or PyTorch is unavailable, GAN mode is disabled with an explanation; an explicitly requested GAN run never silently substitutes the baseline.

## Train the GAN

The repository includes a compact inference checkpoint and its actual training history in `checkpoints/`. The bundled run completed 300 steps and selected step 275 by validation masked MSE. Recreate the synthetic teaching experiment:

```bash
python train.py --steps 300 --seed 42
```

This trains both generator and discriminator with batch size 8 on newly generated facade illustrations. Eight fixed validation image/mask pairs use a separate seed. The checkpoint with lowest validation masked MSE among logged steps is selected. No held-out test-set performance is claimed. Training can vary slightly across hardware and library versions.

To train a new model on your own clean-image folder:

```bash
python train.py --data data/clean-images --size 256 --steps 3000 --output training-runs/photo/model.pt
```

Provide at least ten images. The script creates a seed-fixed 90/10 split and records file hashes and split manifests beside the checkpoint. It rejects exact decoded duplicates, but you must remove near duplicates and related crops yourself. Use only images you have permission to process. Training masks include rectangles and scratches; real archival damage can differ substantially. Each training command starts a fresh run; optimizer resume is not implemented.

To use your new, architecture-matched model, back up `checkpoints/demo.pt` and `demo.json`, copy the new `.pt` file to `checkpoints/demo.pt`, and restart the app. Update the training record alongside it. The server loads a fixed local checkpoint with `weights_only=True`, CPU mapping and strict architecture/state validation. There is no checkpoint-upload endpoint.

## Code map

```text
app.py                 Flask UI and image-processing API
inpainting.py          Image loading, masks, edges, composition, PSNR, sample
model.py               U-Net, PatchGAN, checkpoint loading and GAN inference
train.py               Actual adversarial training and validation selection
templates/index.html   Local web interface
static/app.js          Canvas brush, eraser, undo, presets and downloads
static/style.css       Responsive styling; no remote fonts or scripts
checkpoints/demo.pt    Trained synthetic teaching checkpoint
checkpoints/demo.json  Training provenance, settings and logged losses
tests/test_demo.py     Pipeline, leakage, preservation and API checks
start_windows.bat      First-run setup and launcher
```

## Verify

```bash
python -m pip install -r requirements-dev.txt
python -m pytest -q
```

Tests cover hidden-target invariance for edges/conditioning/GAN inference, exact preservation of visible pixels, an analytic PSNR fixture, mask validation, malformed uploads, image resizing, real GAN and baseline API calls, metadata, missing-checkpoint behavior and absence of scores when no clean reference is declared.

## Limits and provenance

- Synthetic training is a teaching fixture; this model is too small and too briefly trained for dependable photo restoration. It may blur, change colours or invent structures inside the hole.
- The demo implements one small edge-guided GAN and a classical comparison, not the report's three-model experiment. It does not claim the report's PSNR/SSIM, dataset split, 30-epoch training or archival accuracy. SSIM is not implemented.
- The report's conceptual flow guided the software. Its internal manual is source material, not an instruction to claim the original model was recovered. The original PDF is not redistributed in this repository.
- PNG exports contain the working-size image. JSON records the input and mask hashes, preprocessing, checkpoint training provenance, timestamp and review status. Original files and EXIF metadata are not overwritten or preserved in exports. Uploaded images are processed in memory and are not saved by the server.
- Any restored image is an unreviewed derivative. Inspect important faces, text and historical details against reliable evidence.

Implementation references: [PyTorch checkpoint loading](https://docs.pytorch.org/docs/stable/generated/torch.load.html), [PyTorch model saving](https://docs.pytorch.org/tutorials/beginner/saving_loading_models.html), [OpenCV inpainting](https://docs.opencv.org/4.x/df/d3d/tutorial_py_inpainting.html), [Flask file uploads](https://flask.palletsprojects.com/en/stable/patterns/fileuploads/).
