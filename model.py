"""Small educational edge-conditioned U-Net and conditional PatchGAN."""
from functools import lru_cache
import hashlib
from pathlib import Path

import numpy as np
from PIL import Image
import torch
from torch import nn
import torch.nn.functional as F

from inpainting import conditioning, compose

ARCHITECTURE = "edge-unet-v1"
CHECKPOINT = Path(__file__).parent / "checkpoints" / "demo.pt"
torch.set_num_threads(min(4, torch.get_num_threads()))


def block(inputs, outputs):
    return nn.Sequential(nn.Conv2d(inputs, outputs, 3, padding=1), nn.LeakyReLU(.2),
                         nn.Conv2d(outputs, outputs, 3, padding=1), nn.LeakyReLU(.2))


class Generator(nn.Module):
    def __init__(self):
        super().__init__()
        self.enc1 = block(5, 16)
        self.enc2 = block(16, 32)
        self.middle = block(32, 64)
        self.dec2 = block(96, 32)
        self.dec1 = block(48, 16)
        self.output = nn.Conv2d(16, 3, 1)

    def forward(self, x):
        a = self.enc1(x)
        b = self.enc2(F.avg_pool2d(a, 2))
        c = self.middle(F.avg_pool2d(b, 2))
        d = self.dec2(torch.cat((F.interpolate(c, size=b.shape[-2:], mode="bilinear", align_corners=False), b), 1))
        e = self.dec1(torch.cat((F.interpolate(d, size=a.shape[-2:], mode="bilinear", align_corners=False), a), 1))
        return torch.sigmoid(self.output(e))


class Discriminator(nn.Module):
    def __init__(self):
        super().__init__()
        self.net = nn.Sequential(nn.Conv2d(8, 16, 4, 2, 1), nn.LeakyReLU(.2),
                                 nn.Conv2d(16, 32, 4, 2, 1), nn.LeakyReLU(.2),
                                 nn.Conv2d(32, 64, 4, 2, 1), nn.LeakyReLU(.2),
                                 nn.Conv2d(64, 1, 3, padding=1))

    def forward(self, condition, image):
        return self.net(torch.cat((condition, image), 1))


@lru_cache(maxsize=1)
def load_generator():
    if not CHECKPOINT.exists():
        raise FileNotFoundError("GAN checkpoint missing. Run: python train.py --steps 300")
    checkpoint = torch.load(CHECKPOINT, map_location="cpu", weights_only=True)
    if checkpoint.get("architecture") != ARCHITECTURE:
        raise ValueError("Checkpoint architecture does not match edge-unet-v1.")
    model = Generator()
    model.load_state_dict(checkpoint["generator"], strict=True)
    model.eval()
    provenance = {**checkpoint["provenance"], "checkpoint_sha256": hashlib.sha256(CHECKPOINT.read_bytes()).hexdigest()}
    return model, provenance


def restore_gan(rgb, mask):
    model, provenance = load_generator()
    # All GAN inputs use the report's 256 x 256 working resolution.
    size = (256, 256)
    available = rgb.copy()
    available[mask.astype(bool)] = 0
    small_rgb = np.array(Image.fromarray(available).resize(size, Image.Resampling.BILINEAR))
    # Include every original missing pixel when reducing the mask.
    small_mask = F.adaptive_max_pool2d(torch.from_numpy(mask.astype(np.float32))[None, None], size)[0, 0].numpy().astype(np.uint8)
    condition = torch.from_numpy(conditioning(small_rgb, small_mask))[None]
    with torch.inference_mode():
        prediction = model(condition)[0].permute(1, 2, 0).numpy()
    prediction = np.clip(prediction * 255, 0, 255).round().astype(np.uint8)
    prediction = np.array(Image.fromarray(prediction).resize((rgb.shape[1], rgb.shape[0]), Image.Resampling.BILINEAR))
    return compose(rgb, prediction, mask), provenance
