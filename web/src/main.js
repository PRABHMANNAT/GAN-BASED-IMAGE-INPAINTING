import "./style.css";
import {
  createIcons,
  ScanLine,
  BookOpen,
  Github,
  ShieldCheck,
  Sparkles,
  Image as ImageIcon,
  UploadCloud,
  WandSparkles,
  ScanSearch,
  LockKeyhole,
  Paintbrush,
  Columns2,
  Eraser,
  SquareDashed,
  Hand,
  Undo2,
  Redo2,
  Trash2,
  MoveHorizontal,
  Minus,
  Plus,
  Maximize,
  SlidersHorizontal,
  Download,
  MousePointer2,
  CheckCheck,
  Cpu,
  Split,
  X,
} from "lucide";

createIcons({
  icons: {
    ScanLine,
    BookOpen,
    Github,
    ShieldCheck,
    Sparkles,
    Image: ImageIcon,
    UploadCloud,
    WandSparkles,
    ScanSearch,
    LockKeyhole,
    Paintbrush,
    Columns2,
    Eraser,
    SquareDashed,
    Hand,
    Undo2,
    Redo2,
    Trash2,
    MoveHorizontal,
    Minus,
    Plus,
    Maximize,
    SlidersHorizontal,
    Download,
    MousePointer2,
    CheckCheck,
    Cpu,
    Split,
    X,
  },
});
const $ = (id) => document.getElementById(id);
const source = $("image-canvas"),
  overlay = $("mask-canvas"),
  resultCanvas = $("result-canvas");
const sc = source.getContext("2d", { willReadFrequently: true }),
  oc = overlay.getContext("2d");
const maskCanvas = document.createElement("canvas"),
  mc = maskCanvas.getContext("2d", { willReadFrequently: true });
const state = {
  width: 0,
  height: 0,
  original: null,
  mask: null,
  filename: "",
  originalSize: null,
  tool: "brush",
  undo: [],
  redo: [],
  result: null,
  metadata: null,
  busy: false,
  view: "edit",
  zoom: 1,
  fitZoom: 1,
  x: 0,
  y: 0,
  space: false,
  pointer: null,
  strokeStart: null,
  lastPoint: null,
  rectBase: null,
};
let worker,
  sequence = 0,
  pending = new Map(),
  toastTimer;

function feedback(text, error = false) {
  $("feedback").textContent = text;
  $("feedback").classList.toggle("error", error);
}
function toast(text) {
  clearTimeout(toastTimer);
  $("toast").textContent = text;
  $("toast").hidden = false;
  toastTimer = setTimeout(() => ($("toast").hidden = true), 3500);
}
function busy(value, label = "Processing image…") {
  state.busy = value;
  $("busy-overlay").hidden = !value;
  $("busy-label").textContent = label;
  document
    .querySelectorAll(
      ".library button,.library input,.inspector button,.inspector input,.inspector select,.tools button,#clear",
    )
    .forEach((el) => (el.disabled = value));
  overlay.style.pointerEvents = value ? "none" : "auto";
  if (!value) {
    updateHistory();
    $("download-result").disabled = !state.result;
    $("download-record").disabled = !state.result;
    $("radius").disabled = $("method").value !== "context";
  }
}
function startWorker() {
  worker = new Worker("/processor.js");
  worker.onmessage = (event) => {
    const message = event.data;
    if (message.type === "progress") {
      $("busy-label").textContent = message.text;
      return;
    }
    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(message.id);
    if (message.type === "error") request.reject(new Error(message.error));
    else request.resolve(message);
  };
  worker.onerror = () => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(
        new Error("The repair engine stopped. Reload the page and try again."),
      );
    }
    pending.clear();
    $("engine-state").className = "engine-state error";
    $("engine-state").textContent = "Engine error · reload to retry";
  };
  callWorker({ type: "init" })
    .then(() => {
      $("engine-state").className = "engine-state ready";
      $("engine-state").textContent = "On-device engine ready";
    })
    .catch((error) => feedback(error.message, true));
}
function callWorker(message) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const expired = pending.get(id);
      if (!expired) return;
      pending.delete(id);
      worker.terminate();
      reject(
        new Error(
          "Processing took too long. Try a smaller image or Fast repair.",
        ),
      );
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error("Processing was reset. Please try again."));
      }
      pending.clear();
      startWorker();
    }, 180000);
    pending.set(id, { resolve, reject, timer });
    worker.postMessage({ id, ...message });
  });
}
function updateHistory() {
  $("undo").disabled = state.busy || !state.undo.length;
  $("redo").disabled = state.busy || !state.redo.length;
}
function remember() {
  state.undo.push(state.mask.slice());
  if (state.undo.length > 25) state.undo.shift();
  state.redo = [];
  updateHistory();
}
function restoreMaskPixels() {
  const data = new ImageData(state.width, state.height);
  for (let i = 0; i < state.mask.length; i++) {
    data.data[i * 4] =
      data.data[i * 4 + 1] =
      data.data[i * 4 + 2] =
        state.mask[i];
    data.data[i * 4 + 3] = 255;
  }
  mc.putImageData(data, 0, 0);
}
function readMask() {
  const data = mc.getImageData(0, 0, state.width, state.height).data;
  for (let i = 0; i < state.mask.length; i++)
    state.mask[i] = data[i * 4] >= 128 ? 255 : 0;
  renderMask();
  invalidate();
}
function renderMask() {
  const tint = new ImageData(state.width, state.height);
  let count = 0;
  for (let i = 0; i < state.mask.length; i++)
    if (state.mask[i]) {
      count++;
      tint.data[i * 4] = 248;
      tint.data[i * 4 + 1] = 142;
      tint.data[i * 4 + 2] = 118;
      tint.data[i * 4 + 3] = 165;
    }
  oc.putImageData(tint, 0, 0);
  $("mask-coverage").textContent =
    `${((count / state.mask.length) * 100).toFixed(1)}% selected`;
  overlay.style.visibility =
    $("show-mask").checked && state.view === "edit" ? "visible" : "hidden";
}
function invalidate() {
  state.result = null;
  state.metadata = null;
  $("compare-view").disabled = true;
  $("download-result").disabled = true;
  $("download-record").disabled = true;
  $("result-stats").hidden = true;
  $("processing-time").textContent = "—";
  setView("edit");
}
function undo() {
  if (state.busy || !state.undo.length) return;
  state.redo.push(state.mask.slice());
  state.mask = state.undo.pop();
  restoreMaskPixels();
  renderMask();
  invalidate();
  updateHistory();
}
function redo() {
  if (state.busy || !state.redo.length) return;
  state.undo.push(state.mask.slice());
  state.mask = state.redo.pop();
  restoreMaskPixels();
  renderMask();
  invalidate();
  updateHistory();
}

function setView(view) {
  if (view === "compare" && !state.result) return;
  state.view = view;
  const compare = view === "compare";
  $("edit-view").classList.toggle("active", !compare);
  $("compare-view").classList.toggle("active", compare);
  $("edit-view").setAttribute("aria-pressed", !compare);
  $("compare-view").setAttribute("aria-pressed", compare);
  resultCanvas.hidden = !compare;
  $("compare-line").hidden = !compare;
  $("compare-labels").hidden = !compare;
  $("compare-control").hidden = !compare;
  overlay.style.visibility =
    !compare && $("show-mask").checked ? "visible" : "hidden";
  $("canvas-label").lastChild.textContent = compare
    ? " RESTORATION COMPARISON"
    : " MASKING WORKSPACE";
  $("canvas-hint").textContent = compare
    ? "Move the slider to inspect the restoration"
    : "Paint over the regions you want to repair";
  updateCompare();
}
function updateCompare() {
  const value = Number($("compare-range").value);
  resultCanvas.style.clipPath = `inset(0 0 0 ${value}%)`;
  $("compare-line").style.left = `${value}%`;
}
function transform() {
  const stage = $("image-stage");
  stage.style.width = `${state.width}px`;
  stage.style.height = `${state.height}px`;
  stage.style.transform = `translate(${state.x}px,${state.y}px) scale(${state.zoom})`;
  $("zoom-value").textContent =
    Math.abs(state.zoom - state.fitZoom) < 0.001
      ? "Fit"
      : `${Math.round(state.zoom * 100)}%`;
}
function fit() {
  if (!state.width) return;
  const rect = $("viewport").getBoundingClientRect();
  state.fitZoom = Math.min(
    (rect.width - 60) / state.width,
    (rect.height - 105) / state.height,
    1,
  );
  state.zoom = Math.max(0.05, state.fitZoom);
  state.x = state.y = 0;
  transform();
}
function zoom(factor) {
  state.zoom = Math.min(6, Math.max(state.fitZoom * 0.5, state.zoom * factor));
  transform();
}
function setTool(tool) {
  state.tool = tool;
  document.querySelectorAll("[data-tool]").forEach((el) => {
    el.classList.toggle("active", el.dataset.tool === tool);
    el.setAttribute("aria-pressed", el.dataset.tool === tool);
  });
  overlay.style.cursor = tool === "pan" ? "grab" : "crosshair";
}
function point(event) {
  const rect = overlay.getBoundingClientRect();
  return [
    ((event.clientX - rect.left) / rect.width) * state.width,
    ((event.clientY - rect.top) / rect.height) * state.height,
  ];
}
function drawStroke(from, to) {
  mc.strokeStyle = state.tool === "eraser" ? "black" : "white";
  mc.fillStyle = mc.strokeStyle;
  mc.lineWidth = Number($("brush-size").value);
  mc.lineCap = "round";
  mc.lineJoin = "round";
  mc.beginPath();
  mc.moveTo(...from);
  mc.lineTo(...to);
  mc.stroke();
  mc.beginPath();
  mc.arc(to[0], to[1], mc.lineWidth / 2, 0, Math.PI * 2);
  mc.fill();
  readMask();
}
$("viewport").addEventListener("pointerdown", (event) => {
  if (
    event.target.closest(".zoom-controls") ||
    event.target.closest(".busy-overlay")
  )
    return;
  if (state.busy || !state.original || event.button !== 0) return;
  if (state.tool === "pan" || state.space || state.view === "compare") {
    state.pointer = {
      kind: "pan",
      id: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      x: state.x,
      y: state.y,
    };
  } else {
    remember();
    const p = point(event);
    state.strokeStart = p;
    state.lastPoint = p;
    state.pointer = { kind: "draw", id: event.pointerId };
    if (state.tool === "rectangle")
      state.rectBase = mc.getImageData(0, 0, state.width, state.height);
    else drawStroke(p, p);
  }
  $("viewport").setPointerCapture(event.pointerId);
  event.preventDefault();
});
$("viewport").addEventListener("pointermove", (event) => {
  const pointer = state.pointer;
  if (!pointer || pointer.id !== event.pointerId) return;
  if (pointer.kind === "pan") {
    state.x = pointer.x + event.clientX - pointer.clientX;
    state.y = pointer.y + event.clientY - pointer.clientY;
    transform();
    return;
  }
  const p = point(event);
  if (state.tool === "rectangle") {
    mc.putImageData(state.rectBase, 0, 0);
    mc.fillStyle = "white";
    mc.fillRect(
      Math.min(p[0], state.strokeStart[0]),
      Math.min(p[1], state.strokeStart[1]),
      Math.abs(p[0] - state.strokeStart[0]),
      Math.abs(p[1] - state.strokeStart[1]),
    );
    readMask();
  } else drawStroke(state.lastPoint, p);
  state.lastPoint = p;
});
for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
  $("viewport").addEventListener(type, () => {
    state.pointer = null;
    state.rectBase = null;
  });
$("viewport").addEventListener(
  "wheel",
  (event) => {
    if (!state.original) return;
    event.preventDefault();
    zoom(event.deltaY > 0 ? 0.9 : 1.1);
  },
  { passive: false },
);

async function loadFile(
  blob,
  { name = blob.name || "image.png", sample = null, clean = false } = {},
) {
  if (state.busy) return;
  if (blob.size > 20 * 1024 * 1024) {
    feedback("Choose an image smaller than 20 MB.", true);
    return;
  }
  if (!["image/png", "image/jpeg", "image/webp"].includes(blob.type)) {
    feedback("Please use a PNG, JPEG or WebP image.", true);
    return;
  }
  busy(true, "Opening your image…");
  try {
    // createImageBitmap honors EXIF orientation in modern browsers.
    const bitmap = await createImageBitmap(blob, {
      imageOrientation: "from-image",
    });
    if (bitmap.width * bitmap.height > 40_000_000) {
      bitmap.close();
      throw new Error("Please use an image smaller than 40 megapixels.");
    }
    if (Math.min(bitmap.width, bitmap.height) < 32) {
      bitmap.close();
      throw new Error("Choose an image at least 32 × 32 pixels.");
    }
    state.originalSize = [bitmap.width, bitmap.height];
    const scale = Math.min(1200 / bitmap.width, 1200 / bitmap.height, 1);
    state.width = Math.max(1, Math.round(bitmap.width * scale));
    state.height = Math.max(1, Math.round(bitmap.height * scale));
    for (const canvas of [source, overlay, resultCanvas, maskCanvas]) {
      canvas.width = state.width;
      canvas.height = state.height;
    }
    sc.fillStyle = "#fff";
    sc.fillRect(0, 0, state.width, state.height);
    sc.drawImage(bitmap, 0, 0, state.width, state.height);
    bitmap.close();
    state.original = sc.getImageData(0, 0, state.width, state.height);
    state.mask = new Uint8Array(state.width * state.height);
    state.filename = name;
    state.undo = [];
    state.redo = [];
    restoreMaskPixels();
    renderMask();
    invalidate();
    fit();
    $("filename").textContent = name;
    $("filename").title = name;
    $("file-size").textContent = sample
      ? "Sample illustration"
      : `${(blob.size / 1024 / 1024).toFixed(1)} MB · working copy`;
    $("file-thumb").src = source.toDataURL("image/jpeg", 0.5);
    $("canvas-size").textContent = `${state.width} × ${state.height} px`;
    $("clean-reference").checked = clean;
    document
      .querySelectorAll("[data-sample]")
      .forEach((el) =>
        el.classList.toggle("active", el.dataset.sample === sample),
      );
    feedback("Ready. Mark a region or add scratches, then restore.");
  } catch (error) {
    feedback(`Cannot open image. ${error.message}`, true);
  } finally {
    busy(false);
  }
}
async function loadSample(name) {
  try {
    const response = await fetch(`/samples/${name}.jpg`);
    if (!response.ok) throw new Error("Sample could not load.");
    await loadFile(await response.blob(), {
      name: name === "facade" ? "Heritage facade" : "Coastal study",
      sample: name,
      clean: true,
    });
  } catch (error) {
    feedback(error.message, true);
  }
}
function download(blob, name) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function baseName() {
  return (
    state.filename
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-z0-9_-]/gi, "-")
      .toLowerCase() || "image"
  );
}
function maskBlob() {
  restoreMaskPixels();
  return new Promise((resolve) => maskCanvas.toBlob(resolve, "image/png"));
}
async function sha256(bytes) {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
function stat(label, value) {
  const box = document.createElement("div");
  box.className = "result-stat";
  const strong = document.createElement("strong"),
    span = document.createElement("span");
  strong.textContent = value;
  span.textContent = label;
  box.append(strong, span);
  return box;
}

async function restore() {
  if (state.busy || !state.original) return;
  const count = state.mask.reduce((a, b) => a + (b ? 1 : 0), 0);
  if (!count) {
    feedback(
      "Mark a damaged region first. Use the brush or add scratches.",
      true,
    );
    return;
  }
  if (count > state.mask.length * 0.6) {
    feedback(
      "Select less than 60% of the image so enough context remains.",
      true,
    );
    return;
  }
  const method = $("method").value;
  busy(true, "Preparing restoration…");
  feedback("Restoring the selected regions on your device…");
  try {
    const settings = {
      radius: Number($("radius").value),
      feather: Number($("feather").value),
      strength: Number($("strength").value),
      cleanReference: $("clean-reference").checked,
    };
    const response = await callWorker({
      type: "restore",
      rgba: state.original.data.buffer,
      mask: state.mask.buffer,
      width: state.width,
      height: state.height,
      method,
      settings,
    });
    state.result = new ImageData(
      new Uint8ClampedArray(response.rgba),
      state.width,
      state.height,
    );
    resultCanvas.getContext("2d").putImageData(state.result, 0, 0);
    state.metadata = {
      ...response.metadata,
      source_name: state.filename,
      source_original_size: state.originalSize,
      resize_policy:
        "EXIF orientation; opaque white background; preserve aspect ratio; longest side at most 1200 px",
      source_hash_convention: "working-size RGBA uint8 bytes, row major",
      source_sha256: await sha256(state.original.data),
      mask_sha256: await sha256(state.mask),
    };
    $("compare-view").disabled = false;
    $("compare-range").value = "50";
    setView("compare");
    const info = state.metadata;
    $("processing-time").textContent =
      `${(info.elapsed_ms / 1000).toFixed(2)} s`;
    $("result-stats").replaceChildren(
      stat("Selected area", `${info.coverage_percent}%`),
      stat("Visible pixels", "Preserved"),
    );
    if (info.metrics) {
      const format = (value) => (value === null ? "∞ dB" : `${value} dB`);
      $("result-stats").append(
        stat("Full-image PSNR", format(info.metrics.psnr_db)),
        stat("Masked PSNR", format(info.metrics.masked_psnr_db)),
      );
    } else
      $("result-stats").append(stat("Reference scores", "No clean target"));
    $("result-stats").hidden = false;
    feedback(
      "Restoration ready. Move the comparison slider and review the details.",
    );
  } catch (error) {
    feedback(`Could not restore: ${error.message}`, true);
  } finally {
    busy(false);
  }
}

async function detect() {
  if (state.busy || !state.original) return;
  busy(true, "Looking for thin scratches…");
  try {
    const response = await callWorker({
      type: "detect",
      rgba: state.original.data.buffer,
      width: state.width,
      height: state.height,
      settings: { sensitivity: Number($("sensitivity").value) },
    });
    const found = new Uint8Array(response.mask);
    const count = found.reduce((a, b) => a + (b ? 1 : 0), 0);
    if (!count) {
      feedback(
        "No thin scratches found. Try higher sensitivity or mark the damage manually.",
      );
      return;
    }
    if (count > found.length * 0.6) {
      feedback(
        "Too many details detected. Lower sensitivity or use the brush.",
        true,
      );
      return;
    }
    const combined = state.mask.map((value, i) =>
      value || found[i] ? 255 : 0,
    );
    if (combined.reduce((a, b) => a + (b ? 1 : 0), 0) > combined.length * 0.6) {
      feedback(
        "Combined selection is too large. Clear some regions before detecting again.",
        true,
      );
      return;
    }
    remember();
    state.mask = combined;
    restoreMaskPixels();
    renderMask();
    invalidate();
    feedback(
      "Scratch suggestions added. Review the mask and erase any real image details.",
    );
  } catch (error) {
    feedback(`Detection failed: ${error.message}`, true);
  } finally {
    busy(false);
  }
}

document
  .querySelectorAll("[data-tool]")
  .forEach((el) => (el.onclick = () => setTool(el.dataset.tool)));
document.querySelectorAll("[data-sample]").forEach(
  (el) =>
    (el.onclick = () => {
      if (!state.busy) loadSample(el.dataset.sample);
    }),
);
$("image-upload").onchange = (event) => {
  if (event.target.files[0]) loadFile(event.target.files[0]);
  event.target.value = "";
};
for (const type of ["dragenter", "dragover"])
  $("dropzone").addEventListener(type, (event) => {
    event.preventDefault();
    $("dropzone").classList.add("dragging");
  });
for (const type of ["dragleave", "drop"])
  $("dropzone").addEventListener(type, (event) => {
    event.preventDefault();
    $("dropzone").classList.remove("dragging");
    if (type === "drop" && event.dataTransfer.files[0])
      loadFile(event.dataTransfer.files[0]);
  });
$("undo").onclick = undo;
$("redo").onclick = redo;
$("clear").onclick = () => {
  if (!state.mask || state.busy) return;
  remember();
  state.mask.fill(0);
  restoreMaskPixels();
  renderMask();
  invalidate();
};
$("edit-view").onclick = () => setView("edit");
$("compare-view").onclick = () => setView("compare");
$("compare-range").oninput = updateCompare;
$("show-mask").onchange = renderMask;
$("zoom-out").onclick = () => zoom(0.8);
$("zoom-in").onclick = () => zoom(1.25);
$("fit").onclick = fit;
$("restore").onclick = restore;
$("detect").onclick = detect;
$("preset-scratch").onclick = () => {
  if (!state.mask || state.busy) return;
  remember();
  mc.strokeStyle = "white";
  mc.lineWidth = Math.max(2, state.width * 0.007);
  mc.lineCap = "round";
  for (const x of [0.29, 0.71]) {
    mc.beginPath();
    mc.moveTo(state.width * x, state.height * 0.15);
    mc.lineTo(state.width * (x + 0.025), state.height * 0.44);
    mc.lineTo(state.width * (x - 0.03), state.height * 0.82);
    mc.stroke();
  }
  readMask();
  feedback("Scratch mask added. Choose a method and restore.");
};
$("preset-hole").onclick = () => {
  if (!state.mask || state.busy) return;
  remember();
  mc.fillStyle = "white";
  mc.fillRect(
    state.width * 0.4,
    state.height * 0.38,
    state.width * 0.14,
    state.height * 0.16,
  );
  readMask();
  feedback("Gap selected. Choose a method and restore.");
};
$("import-mask").onclick = () => $("mask-upload").click();
$("mask-upload").onchange = async (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file || state.busy) return;
  if (file.size > 20 * 1024 * 1024) {
    feedback("Choose a mask smaller than 20 MB.", true);
    return;
  }
  try {
    const bitmap = await createImageBitmap(file);
    if (bitmap.width !== state.width || bitmap.height !== state.height) {
      bitmap.close();
      throw new Error(
        `Mask must match the ${state.width} × ${state.height} working image. Use Save mask as a template.`,
      );
    }
    const temp = document.createElement("canvas");
    temp.width = state.width;
    temp.height = state.height;
    const context = temp.getContext("2d");
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pixels = context.getImageData(0, 0, state.width, state.height).data;
    remember();
    for (let i = 0; i < state.mask.length; i++)
      state.mask[i] =
        pixels[i * 4] >= 128 && pixels[i * 4 + 3] >= 128 ? 255 : 0;
    restoreMaskPixels();
    renderMask();
    invalidate();
    feedback("Mask imported. White regions will be repaired.");
  } catch (error) {
    feedback(`Cannot import mask. ${error.message}`, true);
  }
};
$("save-mask").onclick = async () => {
  if (!state.mask) return;
  download(await maskBlob(), `${baseName()}-mask.png`);
  toast("Binary mask saved.");
};
$("download-result").onclick = () => {
  if (!state.result) return;
  resultCanvas.toBlob((blob) => {
    download(blob, `${baseName()}-restored.png`);
    toast("Restored image saved.");
  }, "image/png");
};
$("download-record").onclick = () => {
  if (!state.metadata) return;
  download(
    new Blob([JSON.stringify(state.metadata, null, 2)], {
      type: "application/json",
    }),
    `${baseName()}-record.json`,
  );
  toast("Processing record saved.");
};
for (const [id, suffix] of [
  ["brush-size", " px"],
  ["radius", " px"],
  ["feather", " px"],
  ["strength", "%"],
  ["sensitivity", ""],
]) {
  $(id).addEventListener("input", () => {
    $(`${id}-value`).textContent = $(id).value + suffix;
    if (id === "brush-size")
      $("brush-preview-dot").style.width = $("brush-preview-dot").style.height =
        `${Math.min(28, Math.max(8, Number($(id).value) / 3))}px`;
    if (["radius", "feather", "strength"].includes(id) && state.result) {
      invalidate();
      feedback("Settings changed. Restore again to apply them.");
    }
  });
}
const methodDescriptions = {
  migan:
    "Pretrained on natural scenes. Reconstructs plausible detail for missing areas. First run loads a 28 MB model.",
  context:
    "Fast distance-ordered repair from nearby visible pixels. Best for thin scratches and smooth areas. No neural model download.",
  gan: "A five-channel edge-guided U-Net trained on synthetic illustrations. Educational comparison; limited photo quality.",
};
$("method").onchange = () => {
  $("method-description").textContent = methodDescriptions[$("method").value];
  $("radius").disabled = $("method").value !== "context";
  if (state.result) invalidate();
  feedback("Method changed. Select a region and restore.");
};
$("clean-reference").onchange = () => {
  if (state.result) {
    invalidate();
    feedback("Reference setting changed. Restore again to update the scores.");
  }
};
for (const id of ["guide-close", "guide-done"])
  $(id).onclick = () => $("guide").close();
$("guide-open").onclick = () => $("guide").showModal();
$("guide").addEventListener("click", (event) => {
  if (event.target === $("guide")) {
    const r = $("guide").getBoundingClientRect();
    if (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    )
      $("guide").close();
  }
});
document.addEventListener("keydown", (event) => {
  if (
    ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName) ||
    $("guide").open
  )
    return;
  if (event.code === "Space") {
    state.space = true;
    event.preventDefault();
    return;
  }
  if (state.busy) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    event.shiftKey ? redo() : undo();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
    event.preventDefault();
    redo();
    return;
  }
  const tools = { b: "brush", e: "eraser", r: "rectangle", h: "pan" };
  if (tools[event.key.toLowerCase()]) setTool(tools[event.key.toLowerCase()]);
  if (event.key === "[" || event.key === "]") {
    $("brush-size").value = Math.max(
      2,
      Math.min(
        120,
        Number($("brush-size").value) + (event.key === "]" ? 4 : -4),
      ),
    );
    $("brush-size").dispatchEvent(new Event("input"));
  }
  if (event.key === "Enter") {
    event.preventDefault();
    restore();
  }
});
document.addEventListener("keyup", (event) => {
  if (event.code === "Space") state.space = false;
});
window.addEventListener("blur", () => {
  state.space = false;
  state.pointer = null;
});
let resizeTimer;
new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(fit, 100);
}).observe($("viewport"));
startWorker();
loadSample("facade");
$("radius").disabled = true;
