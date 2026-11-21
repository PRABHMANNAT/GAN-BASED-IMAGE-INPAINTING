"""Local teaching application. Run python app.py and open localhost:5000."""
import hashlib
import io
import time
import warnings
from datetime import datetime, timezone

import numpy as np
from flask import Flask, jsonify, render_template, request, send_file
from PIL import Image, UnidentifiedImageError
from werkzeug.exceptions import RequestEntityTooLarge

from inpainting import (baseline, data_url, png_bytes, prepare_mask, read_image,
                        scores, synthetic_image, visible_edges)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024
warnings.simplefilter("error", Image.DecompressionBombWarning)


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/sample")
def sample():
    return send_file(io.BytesIO(png_bytes(synthetic_image(17, 512))), mimetype="image/png")


@app.get("/api/status")
def status():
    try:
        from model import load_generator
        _, provenance = load_generator()
        return jsonify(gan_available=True, provenance=provenance)
    except (ImportError, FileNotFoundError, ValueError, RuntimeError, OSError) as error:
        return jsonify(gan_available=False, reason=str(error))


@app.post("/api/prepare")
def prepare():
    if "image" not in request.files:
        return jsonify(error="Choose a PNG, JPEG or WebP image."), 400
    rgb = read_image(request.files["image"].stream)
    if min(rgb.shape[:2]) < 32:
        return jsonify(error="Image must be at least 32 x 32 pixels."), 400
    return jsonify(image=data_url(rgb), width=rgb.shape[1], height=rgb.shape[0])


@app.post("/api/inpaint")
def inpaint():
    started = time.perf_counter()
    if "image" not in request.files or "mask" not in request.files:
        return jsonify(error="An image and a matching mask are required."), 400
    rgb = read_image(request.files["image"].stream)
    if min(rgb.shape[:2]) < 32:
        return jsonify(error="Image must be at least 32 x 32 pixels."), 400
    mask = prepare_mask(read_image(request.files["mask"].stream, mask=True), rgb.shape)
    method = request.form.get("method", "telea")
    if method == "telea":
        result = baseline(rgb, mask)
        provenance = {"method": "OpenCV Telea", "kind": "classical baseline; not a GAN"}
    elif method == "gan":
        try:
            from model import restore_gan
            result, provenance = restore_gan(rgb, mask)
        except (ImportError, FileNotFoundError, ValueError, RuntimeError, OSError) as error:
            return jsonify(error=f"GAN unavailable: {error}"), 503
    else:
        return jsonify(error="Choose GAN or Telea."), 400
    masked = rgb.copy()
    masked[mask.astype(bool)] = (20, 27, 34)
    has_reference = request.form.get("clean_reference") == "true"
    metadata = {
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "source_sha256": hashlib.sha256(rgb.tobytes()).hexdigest(),
        "mask_sha256": hashlib.sha256(mask.tobytes()).hexdigest(),
        "source_hash_convention": "decoded, EXIF-oriented, working-size RGB uint8 bytes",
        "mask_convention": "1 = missing; 0 = visible", "coverage_percent": round(float(mask.mean() * 100), 2),
        "working_size": [rgb.shape[1], rgb.shape[0]], "gan_working_size": [256, 256] if method == "gan" else None,
        "resize_policy": "EXIF orientation; longest side <=1024; GAN predicts at 256 square; composite at working size",
        "visible_pixels_preserved": bool(np.array_equal(result[mask == 0], rgb[mask == 0])),
        "clean_reference_declared": has_reference, "model": provenance,
        "review_status": "unreviewed generated derivative",
        "metrics": scores(rgb, result, mask) if has_reference else None,
        "elapsed_ms": round((time.perf_counter() - started) * 1000),
    }
    return jsonify(restored=data_url(result), masked=data_url(masked), edges=data_url(visible_edges(rgb, mask)),
                   mask=data_url(mask * 255), metadata=metadata)


@app.errorhandler(RequestEntityTooLarge)
def too_large(_error):
    return jsonify(error="Upload limit is 16 MB. Choose a smaller image."), 413


@app.errorhandler(ValueError)
@app.errorhandler(UnidentifiedImageError)
@app.errorhandler(Image.DecompressionBombError)
@app.errorhandler(Image.DecompressionBombWarning)
@app.errorhandler(OSError)
def invalid_image(error):
    return jsonify(error=f"Cannot process this image: {error}"), 400


if __name__ == "__main__":
    import sys
    import threading
    import webbrowser
    if "--open" in sys.argv:
        threading.Timer(1.5, lambda: webbrowser.open("http://127.0.0.1:5000")).start()
    app.run(host="127.0.0.1", port=5000, debug=False)
