"""Image conventions shared by the web demo and GAN training."""
import base64
import io

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageOps

MAX_PIXELS = 16_000_000
MAX_SIDE = 1024


def read_image(stream, *, mask=False):
    with Image.open(stream) as image:
        if image.width * image.height > MAX_PIXELS:
            raise ValueError("Please use an image smaller than 16 megapixels.")
        image = ImageOps.exif_transpose(image)
        image.load()
        image = image.convert("L" if mask else "RGB")
        if not mask:
            image.thumbnail((MAX_SIDE, MAX_SIDE), Image.Resampling.LANCZOS)
        return np.asarray(image).copy()


def prepare_mask(mask, shape):
    if mask.shape != shape[:2]:
        raise ValueError("Mask dimensions must match the working image dimensions.")
    binary = (mask >= 128).astype(np.uint8)
    coverage = float(binary.mean())
    if coverage == 0:
        raise ValueError("Mark a damaged region first.")
    if coverage > 0.6:
        raise ValueError("Mask at most 60% of the image so visible context remains.")
    return binary


def visible_edges(rgb, mask):
    """Never access hidden pixels; suppress the artificial hole boundary."""
    available = rgb.copy()
    available[mask.astype(bool)] = 0
    gray = cv2.cvtColor(available, cv2.COLOR_RGB2GRAY)
    edges = cv2.Canny(gray, 70, 150)
    band = cv2.dilate(mask.astype(np.uint8), np.ones((7, 7), np.uint8))
    edges[band != 0] = 0
    return edges


def conditioning(rgb, mask):
    masked = rgb.astype(np.float32) / 255.0
    masked[mask.astype(bool)] = 0
    edges = visible_edges(rgb, mask).astype(np.float32) / 255.0
    return np.concatenate((masked, mask[..., None], edges[..., None]), axis=2).transpose(2, 0, 1)


def compose(original, prediction, mask):
    return np.where(mask[..., None].astype(bool), prediction, original).astype(np.uint8)


def baseline(rgb, mask):
    available = rgb.copy()
    available[mask.astype(bool)] = 0
    prediction = cv2.inpaint(available, mask * 255, 3, cv2.INPAINT_TELEA)
    return compose(rgb, prediction, mask)


def scores(reference, restored, mask):
    error = ((reference.astype(np.float64) - restored.astype(np.float64)) / 255.0) ** 2

    def psnr(values):
        mse = float(values.mean())
        return None if mse == 0 else round(float(10 * np.log10(1 / mse)), 2)

    return {"psnr_db": psnr(error), "masked_psnr_db": psnr(error[mask.astype(bool)]),
            "note": "null PSNR means a perfect match (infinite dB). Scores require a clean reference."}


def png_bytes(array):
    stream = io.BytesIO()
    Image.fromarray(array).save(stream, format="PNG")
    return stream.getvalue()


def data_url(array):
    return "data:image/png;base64," + base64.b64encode(png_bytes(array)).decode("ascii")


def synthetic_image(seed=0, size=256):
    """Original procedural facade illustration, not an archival photograph."""
    rng = np.random.default_rng(seed)
    palette = np.array([rng.integers(120, 205), rng.integers(105, 180), rng.integers(80, 145)])
    noise = rng.normal(0, 3, (size, size, 1))
    background = np.clip(palette + noise, 0, 255).astype(np.uint8)
    image = Image.fromarray(background)
    d = ImageDraw.Draw(image)
    def box(coords, fill):
        d.rectangle(tuple(int(x * size) for x in coords), fill=fill)
    box((0, 0, 1, .19), (175, 191, 190))
    box((.08, .18, .92, .24), (93, 76, 58))
    box((.12, .24, .88, .87), tuple(int(v) for v in palette))
    for row in [.33, .55]:
        for col in [.22, .43, .64]:
            box((col-.025, row-.025, col+.145, row+.145), (214, 195, 157))
            box((col, row, col+.12, row+.12), (47, 65, 65))
            box((col+.055, row, col+.065, row+.12), (161, 141, 107))
    box((.43, .74, .57, .94), (66, 56, 42))
    box((.07, .88, .93, .92), (111, 102, 84))
    box((0, .94, 1, 1), (104, 104, 92))
    return np.asarray(image).copy()
