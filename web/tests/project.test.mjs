import test from "node:test";
import assert from "node:assert/strict";
import {
  validateProject,
  changeSelection,
  exportTypes,
} from "../src/project.js";
const png = "data:image/png;base64,iVBORw0KGgo=";
function project() {
  return {
    format: "reframe-project",
    version: 1,
    width: 64,
    height: 64,
    sourceName: "photo.png",
    image: png,
    mask: png,
    candidate: null,
    metadata: null,
    settings: {
      method: "migan",
      radius: 4,
      feather: 0,
      strength: 100,
      brushSize: 24,
      maskOpacity: 55,
      sensitivity: 35,
      cleanReference: false,
    },
    history: [{ image: png, label: "Opened image" }],
    historyIndex: 0,
  };
}
test("project validation retains supported work and discards unknown settings", () => {
  const file = project();
  file.settings.remoteEndpoint = "https://example.com";
  const validated = validateProject(file);
  assert.equal(validated.sourceName, "photo.png");
  assert.equal(validated.settings.remoteEndpoint, undefined);
});
test("project rejects external image URLs, incompatible dimensions and corrupt settings", () => {
  for (const url of [
    "https://example.com/photo.png",
    "javascript:alert(1)",
    "data:image/svg+xml;base64,abc",
  ]) {
    const file = project();
    file.image = url;
    assert.throws(() => validateProject(file), /embedded PNG/);
  }
  const huge = project();
  huge.width = 5000;
  assert.throws(() => validateProject(huge), /dimensions/);
  const settings = project();
  settings.settings.radius = NaN;
  assert.throws(() => validateProject(settings), /setting/);
  const version = project();
  version.version = 999;
  assert.throws(() => validateProject(version), /supported/);
});
test("project rejects invalid history indices and oversized history", () => {
  const index = project();
  index.historyIndex = 8;
  assert.throws(() => validateProject(index), /active repair/);
  const history = project();
  history.history = Array(9).fill({ image: png });
  assert.throws(() => validateProject(history), /eight/);
});
test("expanding and contracting selection preserve the source array and respect edges", () => {
  const mask = new Uint8Array(81);
  mask[40] = 255;
  const expanded = changeSelection(mask, 9, 9, "expand", 2);
  assert.equal(expanded.filter(Boolean).length, 25);
  assert.equal(mask.filter(Boolean).length, 1);
  const contracted = changeSelection(expanded, 9, 9, "contract", 2);
  assert.deepEqual(contracted, mask);
  const edge = new Uint8Array(81);
  edge[0] = 255;
  assert.equal(
    changeSelection(edge, 9, 9, "expand", 2).filter(Boolean).length,
    9,
  );
});
test("export types pair actual MIME types with correct file extensions", () => {
  assert.equal(exportTypes.jpeg.mime, "image/jpeg");
  assert.equal(exportTypes.jpeg.extension, "jpg");
  assert.equal(exportTypes.webp.mime, "image/webp");
});
