"""Train a small GAN on synthetic illustrations or a local image folder."""
import argparse
import hashlib
import json
import random
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageOps
import torch
from torch import nn
import torch.nn.functional as F

from inpainting import conditioning, synthetic_image
from model import ARCHITECTURE, CHECKPOINT, Discriminator, Generator


def random_mask(rng, size):
    mask = Image.new("L", (size, size))
    draw = ImageDraw.Draw(mask)
    x, y = rng.integers(size // 8, size // 2, 2)
    w, h = rng.integers(size // 10, size // 3, 2)
    draw.rectangle((int(x), int(y), int(x+w), int(y+h)), fill=1)
    for _ in range(2):
        points = [tuple(int(v) for v in rng.integers(0, size, 2)) for _ in range(3)]
        draw.line(points, fill=1, width=int(rng.integers(1, max(2, size // 24))))
    return np.asarray(mask).copy()


def load_folder(folder, seed):
    paths = sorted(p for p in folder.rglob("*") if p.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"})
    if len(paths) < 10:
        raise ValueError("Supply at least 10 clean images for a 90/10 train/validation split.")
    records, seen = [], set()
    for path in paths:
        with Image.open(path) as im:
            rgb = ImageOps.exif_transpose(im).convert("RGB")
            digest = hashlib.sha256(rgb.tobytes() + str(rgb.size).encode()).hexdigest()
        if digest in seen:
            raise ValueError(f"Duplicate decoded image: {path}. Remove duplicates before splitting.")
        seen.add(digest)
        records.append({"path": str(path.relative_to(folder)), "sha256": digest})
    random.Random(seed).shuffle(records)
    count = max(1, len(records) // 10)
    return records[count:], records[:count]


def batch(rng, count, size, folder=None, records=None):
    images, masks = [], []
    for _ in range(count):
        if folder is None:
            rgb = synthetic_image(int(rng.integers(0, 2**31)), size)
        else:
            record = records[int(rng.integers(len(records)))]
            with Image.open(folder / record["path"]) as image:
                rgb = np.array(ImageOps.exif_transpose(image).convert("RGB").resize((size, size), Image.Resampling.BILINEAR))
        images.append(rgb)
        masks.append(random_mask(rng, size))
    condition = torch.from_numpy(np.stack([conditioning(x, m) for x, m in zip(images, masks)]))
    target = torch.from_numpy(np.stack(images).transpose(0, 3, 1, 2).astype(np.float32) / 255)
    return condition, target, condition[:, 3:4]


def gradient_loss(a, b):
    return (F.l1_loss(a[:, :, 1:, :] - a[:, :, :-1, :], b[:, :, 1:, :] - b[:, :, :-1, :]) +
            F.l1_loss(a[:, :, :, 1:] - a[:, :, :, :-1], b[:, :, :, 1:] - b[:, :, :, :-1]))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--steps", type=int, default=300)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--size", type=int, default=64, help="Training size; inference uses 256. Must be divisible by 4.")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--data", type=Path, help="Optional folder of clean RGB training images")
    parser.add_argument("--output", type=Path, default=CHECKPOINT)
    args = parser.parse_args()
    if args.steps < 1 or args.batch_size < 1 or args.size < 32 or args.size % 4:
        parser.error("steps/batch-size must be positive; size must be >=32 and divisible by 4")
    torch.manual_seed(args.seed)
    rng = np.random.default_rng(args.seed)
    train_records, val_records = load_folder(args.data, args.seed) if args.data else (None, None)
    val = batch(np.random.default_rng(args.seed + 100_000), 8, args.size, args.data, val_records)
    generator, discriminator = Generator(), Discriminator()
    opt_g = torch.optim.Adam(generator.parameters(), lr=.0003, betas=(.5, .999))
    opt_d = torch.optim.Adam(discriminator.parameters(), lr=.0001, betas=(.5, .999))
    bce = nn.BCEWithLogitsLoss()
    best = float("inf")
    history = []
    args.output.parent.mkdir(parents=True, exist_ok=True)
    provenance = {
        "architecture": ARCHITECTURE, "kind": "educational GAN; not the report's trained model",
        "training_data": "local clean-image folder" if args.data else "procedural facade illustrations only",
        "seed": args.seed, "training_size": args.size, "batch_size": args.batch_size,
        "requested_steps": args.steps, "learning_rate_g": .0003, "learning_rate_d": .0001,
        "loss": "10*hole_L1 + valid_L1 + 2*gradient_L1 + 0.05*adversarial_BCE",
        "validation": "8 fixed synthetic image-mask pairs" if not args.data else "8 fixed pairs sampled from held-out 10%",
        "limitations": "Tiny teaching model. Not validated for historical photographs; may blur or invent details.",
    }
    for step in range(1, args.steps + 1):
        condition, target, mask = batch(rng, args.batch_size, args.size, args.data, train_records)
        prediction = generator(condition)
        composite = target * (1-mask) + prediction * mask
        opt_d.zero_grad(set_to_none=True)
        real = discriminator(condition, target)
        fake = discriminator(condition, composite.detach())
        loss_d = (bce(real, torch.ones_like(real)) + bce(fake, torch.zeros_like(fake))) / 2
        loss_d.backward()
        opt_d.step()
        opt_g.zero_grad(set_to_none=True)
        discriminator.requires_grad_(False)
        adversarial = discriminator(condition, composite)
        hole_l1 = ((prediction-target).abs()*mask).sum() / (mask.sum()*3)
        valid_l1 = ((prediction-target).abs()*(1-mask)).sum() / ((1-mask).sum()*3)
        loss_g = 10*hole_l1 + valid_l1 + 2*gradient_loss(composite, target) + .05*bce(adversarial, torch.ones_like(adversarial))
        loss_g.backward()
        opt_g.step()
        discriminator.requires_grad_(True)
        if not torch.isfinite(loss_g) or not torch.isfinite(loss_d):
            raise RuntimeError("Non-finite training loss; checkpoint not saved.")
        if step == 1 or step % 25 == 0 or step == args.steps:
            generator.eval()
            with torch.inference_mode():
                vc, vt, vm = val
                error = (((generator(vc)-vt)**2)*vm).sum() / (vm.sum()*3)
                mse = float(error)
            generator.train()
            entry = {"step": step, "g_loss": float(loss_g.detach()), "d_loss": float(loss_d.detach()),
                     "validation_masked_mse": mse}
            history.append(entry)
            print(json.dumps(entry), flush=True)
            if mse < best:
                best = mse
                torch.save({"architecture": ARCHITECTURE, "generator": generator.state_dict(),
                            "provenance": {**provenance, "selected_step": step, "validation_masked_mse": mse}}, args.output)
    manifest = {"provenance": provenance, "history": history, "train": train_records, "validation": val_records,
                "selection": "Lowest masked MSE on the fixed validation batch; no test-set claim",
                "torch_version": str(torch.__version__), "numpy_version": np.__version__}
    args.output.with_suffix(".json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"Saved selected inference checkpoint: {args.output}")


if __name__ == "__main__":
    main()
