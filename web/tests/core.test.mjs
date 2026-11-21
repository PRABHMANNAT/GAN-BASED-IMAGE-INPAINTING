import test from "node:test";
import assert from "node:assert/strict";
await import("../public/repair-core.js");
const {
  validateMask,
  distanceMap,
  contextFill,
  composite,
  metrics,
  conservativeMask,
  expandMask,
} = globalThis.RepairCore;
const image = (w, h, value) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data.fill(value, i * 4, i * 4 + 3);
    data[i * 4 + 3] = 255;
  }
  return data;
};

test("mask must have valid context and match dimensions", () => {
  assert.throws(() => validateMask(new Uint8Array(9), 3, 3), /Mark/);
  assert.throws(() => validateMask(new Uint8Array(9).fill(255), 3, 3), /60%/);
  assert.throws(() => validateMask(new Uint8Array(5), 3, 3), /dimensions/);
});
test("context fill ignores hidden target pixels and fills a constant field", () => {
  const w = 15,
    h = 15,
    mask = new Uint8Array(w * h),
    a = image(w, h, 120),
    b = image(w, h, 120);
  for (let y = 5; y < 10; y++)
    for (let x = 5; x < 10; x++) {
      mask[y * w + x] = 255;
      a.fill(0, (y * w + x) * 4, (y * w + x) * 4 + 3);
      b.fill(255, (y * w + x) * 4, (y * w + x) * 4 + 3);
    }
  const first = contextFill(a, mask, w, h, 4),
    second = contextFill(b, mask, w, h, 4);
  assert.deepEqual(first, second);
  assert.deepEqual(first, image(w, h, 120));
});
test("compositing never changes visible pixels, including feathered boundaries", () => {
  const original = image(9, 9, 100),
    prediction = image(9, 9, 200),
    mask = new Uint8Array(81);
  mask[40] = 255;
  const result = composite(original, prediction, mask, 9, 9, 0.5, 3);
  for (let i = 0; i < 81; i++)
    if (!mask[i])
      assert.deepEqual(
        result.slice(i * 4, i * 4 + 4),
        original.slice(i * 4, i * 4 + 4),
      );
  assert(result[40 * 4] > 100 && result[40 * 4] < 200);
});
test("PSNR matches analytic error and encodes infinity as null", () => {
  const original = image(10, 10, 100),
    output = image(10, 10, 151),
    mask = new Uint8Array(100).fill(255);
  assert.equal(metrics(original, output, mask).masked_psnr_db, 13.98);
  assert.equal(metrics(original, original, mask).psnr_db, null);
});
test("conservative resizing does not discard single-pixel damage", () => {
  const mask = new Uint8Array(64);
  mask[2 * 8 + 3] = 255;
  const small = conservativeMask(mask, 8, 8, 2, 2);
  assert.equal(small[0], 255);
  assert.equal(
    small.reduce((a, b) => a + (b ? 1 : 0), 0),
    1,
  );
});
test("distance map measures inward from the known context", () => {
  const mask = new Uint8Array(25);
  for (let y = 1; y < 4; y++) for (let x = 1; x < 4; x++) mask[y * 5 + x] = 255;
  const distance = distanceMap(mask, 5, 5);
  assert.equal(distance[12], 2);
  assert.equal(distance[6], 1);
  assert.equal(distance[0], 0);
});
test("MI-GAN inference margin expands safely at image boundaries", () => {
  const mask = new Uint8Array(25);
  mask[0] = 255;
  const expanded = expandMask(mask, 5, 5, 2);
  assert.equal(
    expanded.reduce((a, b) => a + (b ? 1 : 0), 0),
    9,
  );
  assert.equal(expanded[12], 255);
  assert.equal(expanded[24], 0);
  assert.equal(
    mask.reduce((a, b) => a + (b ? 1 : 0), 0),
    1,
  );
});
