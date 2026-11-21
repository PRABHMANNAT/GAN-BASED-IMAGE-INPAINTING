/* Pure image operations shared by the worker and automated Node tests. */
(function (root) {
  "use strict";
  function maskCount(mask) {
    let count = 0;
    for (const value of mask) if (value) count++;
    return count;
  }
  function validateMask(mask, width, height) {
    if (mask.length !== width * height)
      throw new Error("Mask dimensions must match the image.");
    const count = maskCount(mask);
    if (!count)
      throw new Error(
        "Mark a damaged region first. Use the brush or add scratches.",
      );
    if (count > mask.length * 0.6)
      throw new Error(
        "Select less than 60% of the image so enough context remains.",
      );
    return count;
  }
  function distanceMap(mask, width, height) {
    const dist = new Float32Array(mask.length);
    const inf = width + height;
    for (let i = 0; i < dist.length; i++) dist[i] = mask[i] ? inf : 0;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (!mask[i]) continue;
        if (x) dist[i] = Math.min(dist[i], dist[i - 1] + 1);
        if (y) dist[i] = Math.min(dist[i], dist[i - width] + 1);
      }
    for (let y = height - 1; y >= 0; y--)
      for (let x = width - 1; x >= 0; x--) {
        const i = y * width + x;
        if (!mask[i]) continue;
        if (x < width - 1) dist[i] = Math.min(dist[i], dist[i + 1] + 1);
        if (y < height - 1) dist[i] = Math.min(dist[i], dist[i + width] + 1);
      }
    return dist;
  }
  function contextFill(rgba, mask, width, height, radius = 4) {
    // Original distance-ordered, weighted context propagation. Not OpenCV Telea.
    validateMask(mask, width, height);
    const result = new Uint8ClampedArray(rgba),
      known = new Uint8Array(mask.length);
    const dist = distanceMap(mask, width, height),
      holes = [];
    for (let i = 0; i < mask.length; i++) {
      known[i] = mask[i] ? 0 : 1;
      if (mask[i]) holes.push(i);
    }
    holes.sort((a, b) => dist[a] - dist[b]);
    const offsets = [];
    for (let dy = -radius; dy <= radius; dy++)
      for (let dx = -radius; dx <= radius; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 > 0 && d2 <= radius * radius)
          offsets.push([dx, dy, 1 / (d2 * Math.sqrt(d2))]);
      }
    for (const i of holes) {
      const x = i % width,
        y = Math.floor(i / width);
      let r = 0,
        g = 0,
        b = 0,
        total = 0;
      for (const [dx, dy, w] of offsets) {
        const nx = x + dx,
          ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const j = ny * width + nx;
        if (!known[j]) continue;
        r += result[j * 4] * w;
        g += result[j * 4 + 1] * w;
        b += result[j * 4 + 2] * w;
        total += w;
      }
      if (total) {
        result[i * 4] = r / total;
        result[i * 4 + 1] = g / total;
        result[i * 4 + 2] = b / total;
        known[i] = 1;
      }
    }
    return result;
  }
  function composite(
    original,
    prediction,
    mask,
    width,
    height,
    strength = 1,
    feather = 0,
  ) {
    const result = new Uint8ClampedArray(original);
    const distance = feather > 0 ? distanceMap(mask, width, height) : null;
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      const alpha =
        strength * (distance ? Math.min(1, distance[i] / (feather + 1)) : 1);
      for (let c = 0; c < 3; c++)
        result[i * 4 + c] =
          original[i * 4 + c] * (1 - alpha) + prediction[i * 4 + c] * alpha;
      result[i * 4 + 3] = 255;
    }
    return result;
  }
  function metrics(original, output, mask) {
    let total = 0,
      hole = 0,
      count = 0;
    for (let i = 0; i < mask.length; i++) {
      for (let c = 0; c < 3; c++) {
        const d = (original[i * 4 + c] - output[i * 4 + c]) / 255;
        total += d * d;
        if (mask[i]) hole += d * d;
      }
      if (mask[i]) count++;
    }
    const psnr = (mse) =>
      mse === 0 ? null : Math.round(10 * Math.log10(1 / mse) * 100) / 100;
    return {
      psnr_db: psnr(total / (mask.length * 3)),
      masked_psnr_db: count ? psnr(hole / (count * 3)) : null,
    };
  }
  function conservativeMask(mask, width, height, targetWidth, targetHeight) {
    const out = new Uint8Array(targetWidth * targetHeight);
    for (let y = 0; y < targetHeight; y++)
      for (let x = 0; x < targetWidth; x++) {
        const x0 = Math.floor((x * width) / targetWidth),
          x1 = Math.ceil(((x + 1) * width) / targetWidth);
        const y0 = Math.floor((y * height) / targetHeight),
          y1 = Math.ceil(((y + 1) * height) / targetHeight);
        outer: for (let sy = y0; sy < y1; sy++)
          for (let sx = x0; sx < x1; sx++)
            if (mask[sy * width + sx]) {
              out[y * targetWidth + x] = 255;
              break outer;
            }
      }
    return out;
  }
  function expandMask(mask, width, height, radius = 5) {
    const expanded = new Uint8Array(mask.length);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        if (mask[y * width + x]) {
          for (let dy = -radius; dy <= radius; dy++)
            for (let dx = -radius; dx <= radius; dx++) {
              const nx = x + dx,
                ny = y + dy;
              if (nx >= 0 && ny >= 0 && nx < width && ny < height)
                expanded[ny * width + nx] = 255;
            }
        }
    return expanded;
  }
  const api = {
    maskCount,
    validateMask,
    distanceMap,
    contextFill,
    composite,
    metrics,
    conservativeMask,
    expandMask,
  };
  root.RepairCore = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof self !== "undefined" ? self : globalThis);
