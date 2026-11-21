import "./style.css";
import { validateProject, changeSelection, exportTypes } from "./project.js";
import {
  createIcons,
  Check,
  CircleHelp,
  Download,
  Eraser,
  FolderOpen,
  Hand,
  ImagePlus,
  Lasso,
  Maximize,
  Minus,
  Paintbrush,
  Plus,
  Redo2,
  Save,
  ScanSearch,
  SquareDashed,
  Undo2,
  X,
} from "lucide";
createIcons({
  icons: {
    Check,
    CircleHelp,
    Download,
    Eraser,
    FolderOpen,
    Hand,
    ImagePlus,
    Lasso,
    Maximize,
    Minus,
    Paintbrush,
    Plus,
    Redo2,
    Save,
    ScanSearch,
    SquareDashed,
    Undo2,
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
  lassoPoints: [],
  lastBrushPoint: null,
  steps: [],
  stepIndex: 0,
  dirty: false,
  operation: 0,
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
  $("cancel-processing").hidden = !value || label.startsWith("Opening");
  document
    .querySelectorAll(
      ".library button,.library input,.inspector button,.inspector input,.inspector select,.tools button,#clear,#save-project,#open-project,#export-open",
    )
    .forEach((el) => (el.disabled = value));
  overlay.style.pointerEvents = value ? "none" : "auto";
  if (!value) {
    updateHistory();
    $("download-result").disabled = !exportableImage();
    $("download-record").disabled = !exportableRecord();
    $("radius").disabled = $("method").value !== "context";
    $("export-quality").disabled = $("export-format").value === "png";
    $("apply-result").disabled = !state.result;
    $("export-open").disabled = !exportableImage();
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
      tint.data[i * 4] = 235;
      tint.data[i * 4 + 1] = 147;
      tint.data[i * 4 + 2] = 100;
      tint.data[i * 4 + 3] = Math.round(Number($("mask-opacity").value) * 2.55);
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
  $("download-result").disabled = !exportableImage();
  $("download-record").disabled = !exportableRecord();
  $("result-stats").hidden = true;
  $("processing-time").textContent = "—";
  $("apply-result").disabled = true;
  $("export-open").disabled = !exportableImage();
  markDirty();
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
    ? " Comparison"
    : " Selection";
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
  $("viewport").focus({ preventScroll: true });
  if (state.view === "compare" && !state.space && state.tool !== "pan") {
    state.pointer = { kind: "compare", id: event.pointerId };
    compareAt(event);
  } else if (state.tool === "pan" || state.space) {
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
    if (state.tool === "rectangle" || state.tool === "lasso") {
      state.rectBase = mc.getImageData(0, 0, state.width, state.height);
      if (state.tool === "lasso") state.lassoPoints = [p];
    } else
      drawStroke(
        event.shiftKey && state.lastBrushPoint ? state.lastBrushPoint : p,
        p,
      );
  }
  $("viewport").setPointerCapture(event.pointerId);
  event.preventDefault();
});
$("viewport").addEventListener("pointermove", (event) => {
  const pointer = state.pointer;
  if (!pointer || pointer.id !== event.pointerId) return;
  if (pointer.kind === "compare") {
    compareAt(event);
    return;
  }
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
  } else if (state.tool === "lasso") {
    state.lassoPoints.push(p);
    mc.putImageData(state.rectBase, 0, 0);
    mc.strokeStyle = "white";
    mc.lineWidth = 1;
    mc.beginPath();
    state.lassoPoints.forEach(([x, y], index) =>
      index ? mc.lineTo(x, y) : mc.moveTo(x, y),
    );
    mc.stroke();
    const preview = oc.createImageData(state.width, state.height),
      pixels = mc.getImageData(0, 0, state.width, state.height).data;
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i] >= 128) {
        preview.data[i] = 235;
        preview.data[i + 1] = 147;
        preview.data[i + 2] = 100;
        preview.data[i + 3] = 190;
      }
    oc.putImageData(preview, 0, 0);
  } else drawStroke(state.lastPoint, p);
  state.lastPoint = p;
});
for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
  $("viewport").addEventListener(type, () => {
    if (
      state.pointer?.kind === "draw" &&
      state.tool === "lasso" &&
      state.rectBase
    ) {
      mc.putImageData(state.rectBase, 0, 0);
      if (type === "pointerup" && state.lassoPoints.length > 2) {
        mc.fillStyle = "white";
        mc.beginPath();
        state.lassoPoints.forEach(([x, y], index) =>
          index ? mc.lineTo(x, y) : mc.moveTo(x, y),
        );
        mc.closePath();
        mc.fill();
        readMask();
      } else renderMask();
    }
    if (
      state.pointer?.kind === "draw" &&
      ["brush", "eraser"].includes(state.tool)
    )
      state.lastBrushPoint = state.lastPoint?.slice();
    state.pointer = null;
    state.rectBase = null;
    state.lassoPoints = [];
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
    const scale = Math.min(1200 / bitmap.width, 1200 / bitmap.height, 1);
    const workingWidth = Math.max(1, Math.round(bitmap.width * scale));
    const workingHeight = Math.max(1, Math.round(bitmap.height * scale));
    if (Math.min(workingWidth, workingHeight) < 32) {
      bitmap.close();
      throw new Error(
        "This image is too narrow. The resized working copy must be at least 32 pixels on each side.",
      );
    }
    state.originalSize = [bitmap.width, bitmap.height];
    state.width = workingWidth;
    state.height = workingHeight;
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
    state.lastBrushPoint = null;
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
    $("document-title").textContent = name;
    state.steps = [
      {
        image: cloneImage(state.original),
        label: "Opened image",
        metadata: null,
      },
    ];
    state.stepIndex = 0;
    renderRepairHistory();
    markSaved();
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

function markDirty() {
  state.dirty = true;
  $("dirty-state").hidden = false;
}
function markSaved() {
  state.dirty = false;
  $("dirty-state").hidden = true;
}
function cloneImage(image) {
  return new ImageData(
    new Uint8ClampedArray(image.data),
    image.width,
    image.height,
  );
}
function exportableImage() {
  return (
    state.result ||
    ((state.stepIndex > 0 || state.steps[state.stepIndex]?.metadata) &&
      state.original) ||
    null
  );
}
function exportableRecord() {
  return state.metadata || state.steps[state.stepIndex]?.metadata || null;
}
function imageURL(image) {
  const c = document.createElement("canvas");
  c.width = image.width;
  c.height = image.height;
  c.getContext("2d").putImageData(image, 0, 0);
  return c.toDataURL("image/png");
}
function compareAt(event) {
  const rect = $("image-stage").getBoundingClientRect();
  $("compare-range").value = Math.max(
    0,
    Math.min(100, ((event.clientX - rect.left) / rect.width) * 100),
  );
  updateCompare();
}
function renderRepairHistory() {
  $("history-count").textContent = String(state.steps.length);
  $("repair-history").replaceChildren(
    ...state.steps.map((step, index) => {
      const button = document.createElement("button");
      button.className =
        "history-item" + (index === state.stepIndex ? " active" : "");
      button.setAttribute("aria-pressed", String(index === state.stepIndex));
      button.disabled = state.busy;
      const thumb = document.createElement("canvas");
      thumb.width = 80;
      thumb.height = 60;
      const full = document.createElement("canvas");
      full.width = state.width;
      full.height = state.height;
      full.getContext("2d").putImageData(step.image, 0, 0);
      thumb.getContext("2d").drawImage(full, 0, 0, 80, 60);
      const img = document.createElement("img");
      img.src = thumb.toDataURL("image/jpeg", 0.65);
      img.alt = "";
      const text = document.createElement("span"),
        title = document.createElement("strong"),
        note = document.createElement("small");
      title.textContent = step.label;
      note.textContent =
        index === state.stepIndex
          ? "Current working image"
          : `Step ${index + 1}`;
      text.append(title, note);
      button.append(img, text);
      button.onclick = () => selectRepairStep(index);
      return button;
    }),
  );
}
function selectRepairStep(index) {
  if (state.busy || !state.steps[index]) return;
  state.stepIndex = index;
  state.original = cloneImage(state.steps[index].image);
  sc.putImageData(state.original, 0, 0);
  state.mask.fill(0);
  state.undo = [];
  state.redo = [];
  state.lastBrushPoint = null;
  restoreMaskPixels();
  renderMask();
  invalidate();
  updateHistory();
  renderRepairHistory();
  $("file-thumb").src = source.toDataURL("image/jpeg", 0.6);
  $("clean-reference").checked = false;
  feedback("Working image changed. Select the next region to repair.");
}
function applyRepair() {
  if (!state.result || state.busy) return;
  const names = {
    migan: "MI-GAN",
    context: "Context fill",
    gan: "Edge-guided GAN",
  };
  state.steps = state.steps.slice(0, state.stepIndex + 1);
  state.steps.push({
    image: cloneImage(state.result),
    label: `${names[state.metadata?.method] || "Imported"} repair`,
    metadata: state.metadata,
  });
  if (state.steps.length > 8) state.steps.shift();
  selectRepairStep(state.steps.length - 1);
  feedback(
    "Repair applied. Select another region, or return to an earlier step in history.",
  );
}
function cancelProcessing() {
  if (!state.busy || !pending.size) return;
  state.operation++;
  worker.terminate();
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    const error = new Error("Processing cancelled.");
    error.name = "AbortError";
    request.reject(error);
  }
  pending.clear();
  busy(false);
  startWorker();
  feedback("Processing cancelled. Your image and selection are unchanged.");
}
function projectSettings() {
  return {
    method: $("method").value,
    radius: Number($("radius").value),
    feather: Number($("feather").value),
    strength: Number($("strength").value),
    brushSize: Number($("brush-size").value),
    maskOpacity: Number($("mask-opacity").value),
    sensitivity: Number($("sensitivity").value),
    cleanReference: $("clean-reference").checked,
  };
}
async function saveProject() {
  if (state.busy || !state.original) return;
  restoreMaskPixels();
  const project = {
    format: "reframe-project",
    version: 1,
    width: state.width,
    height: state.height,
    sourceName: state.filename,
    image: imageURL(state.original),
    mask: maskCanvas.toDataURL("image/png"),
    candidate: state.result ? imageURL(state.result) : null,
    metadata: state.metadata,
    settings: projectSettings(),
    history: state.steps.map((step) => ({
      image: imageURL(step.image),
      label: step.label,
      metadata: step.metadata,
    })),
    historyIndex: state.stepIndex,
  };
  let blob = new Blob([JSON.stringify(project)], { type: "application/json" });
  while (blob.size > 40 * 1024 * 1024 && project.history.length > 1) {
    if (project.historyIndex > 0) {
      project.history.shift();
      project.historyIndex--;
    } else project.history.pop();
    blob = new Blob([JSON.stringify(project)], { type: "application/json" });
  }
  if (blob.size > 40 * 1024 * 1024) {
    feedback(
      "Project exceeds 40 MB. Export the image and start a smaller project.",
      true,
    );
    return;
  }
  download(blob, `${baseName()}.reframe`);
  markSaved();
  toast(
    project.history.length < state.steps.length
      ? `Project saved with ${project.history.length} repair steps to stay below 40 MB.`
      : "Project saved.",
  );
}
async function decodeProjectImage(url, width, height) {
  const bitmap = await createImageBitmap(await (await fetch(url)).blob());
  if (bitmap.width !== width || bitmap.height !== height) {
    bitmap.close();
    throw new Error("An embedded image does not match the project dimensions.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return context.getImageData(0, 0, width, height);
}
async function openProject(file) {
  if (state.busy || !file) return;
  if (file.size > 40 * 1024 * 1024) {
    feedback("Project files must be smaller than 40 MB.", true);
    return;
  }
  busy(true, "Opening project…");
  try {
    const p = validateProject(JSON.parse(await file.text()));
    const [image, mask, candidate, ...steps] = await Promise.all([
      decodeProjectImage(p.image, p.width, p.height),
      decodeProjectImage(p.mask, p.width, p.height),
      p.candidate
        ? decodeProjectImage(p.candidate, p.width, p.height)
        : Promise.resolve(null),
      ...p.history.map((step) =>
        decodeProjectImage(step.image, p.width, p.height),
      ),
    ]);
    state.width = p.width;
    state.height = p.height;
    state.original = image;
    state.originalSize = [p.width, p.height];
    state.filename = p.sourceName;
    state.mask = new Uint8Array(p.width * p.height);
    for (let i = 0; i < state.mask.length; i++)
      state.mask[i] = mask.data[i * 4] >= 128 ? 255 : 0;
    state.undo = [];
    state.redo = [];
    state.lastBrushPoint = null;
    state.steps = p.history.map((step, index) => ({
      ...step,
      image: steps[index],
    }));
    state.stepIndex = p.historyIndex;
    for (const canvas of [source, overlay, resultCanvas, maskCanvas]) {
      canvas.width = p.width;
      canvas.height = p.height;
    }
    sc.putImageData(image, 0, 0);
    restoreMaskPixels();
    renderMask();
    invalidate();
    const ids = {
      radius: "radius",
      feather: "feather",
      strength: "strength",
      brushSize: "brush-size",
      maskOpacity: "mask-opacity",
      sensitivity: "sensitivity",
    };
    $("method").value = p.settings.method;
    $("method").dispatchEvent(new Event("change"));
    for (const [key, id] of Object.entries(ids)) {
      $(id).value = p.settings[key];
      $(id).dispatchEvent(new Event("input"));
    }
    $("clean-reference").checked = p.settings.cleanReference;
    $("filename").textContent = p.sourceName;
    $("document-title").textContent = p.sourceName;
    $("file-size").textContent = "Saved project";
    $("file-thumb").src = source.toDataURL("image/jpeg", 0.6);
    $("canvas-size").textContent = `${p.width} × ${p.height} px`;
    document
      .querySelectorAll("[data-sample]")
      .forEach((el) => el.classList.remove("active"));
    if (candidate) {
      state.result = candidate;
      state.metadata = p.metadata;
      resultCanvas.getContext("2d").putImageData(candidate, 0, 0);
      $("compare-view").disabled = false;
      setView("compare");
    }
    renderRepairHistory();
    renderMask();
    updateHistory();
    fit();
    markSaved();
    feedback(
      "Project opened. Your image, selection, settings and repair history are restored.",
    );
  } catch (error) {
    feedback(`Cannot open project. ${error.message}`, true);
  } finally {
    busy(false);
  }
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
  const operation = ++state.operation;
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
    if (operation !== state.operation) return;
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
    markDirty();
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
    if (error.name !== "AbortError")
      feedback(`Could not restore: ${error.message}`, true);
  } finally {
    busy(false);
  }
}

async function detect() {
  if (state.busy || !state.original) return;
  busy(true, "Looking for thin scratches…");
  const operation = ++state.operation;
  try {
    const response = await callWorker({
      type: "detect",
      rgba: state.original.data.buffer,
      width: state.width,
      height: state.height,
      settings: { sensitivity: Number($("sensitivity").value) },
    });
    if (operation !== state.operation) return;
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
    if (error.name !== "AbortError")
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
  if (!exportableImage()) return;
  const type = exportTypes[$("export-format").value] || exportTypes.png;
  const exportCanvas = state.result ? resultCanvas : source;
  exportCanvas.toBlob(
    (blob) => {
      if (!blob) {
        feedback("The browser could not encode this image.", true);
        return;
      }
      if (blob.type !== type.mime) {
        feedback(
          "This browser does not support the selected export format. Choose PNG instead.",
          true,
        );
        return;
      }
      download(blob, `${baseName()}-restored.${type.extension}`);
      toast("Image exported.");
    },
    type.mime,
    Number($("export-quality").value) / 100,
  );
};
$("download-record").onclick = () => {
  const record = exportableRecord();
  if (!record) return;
  download(
    new Blob([JSON.stringify(record, null, 2)], {
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
    markDirty();
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
  migan: "For missing areas and objects. First use loads a 28 MB model.",
  context:
    "Fills from nearby pixels. Use for narrow scratches and smooth areas. Context radius controls the neighbourhood.",
  gan: "Experimental model trained on sample illustrations. Limited results on photographs.",
};
$("method").onchange = () => {
  markDirty();
  $("method-description").textContent = methodDescriptions[$("method").value];
  $("radius").disabled = $("method").value !== "context";
  if (state.result) invalidate();
  feedback("Method changed. Select a region and restore.");
};
$("clean-reference").onchange = () => {
  markDirty();
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
  if (event.key === "Escape" && state.busy) {
    cancelProcessing();
    return;
  }
  if (
    ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName) ||
    $("guide").open ||
    $("about").open
  )
    return;
  if (event.code === "Space") {
    state.space = true;
    event.preventDefault();
    return;
  }
  if (state.busy) return;
  if (
    event.key === "Enter" &&
    document.activeElement.closest('button,a,summary,[role="button"]')
  )
    return;
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
  const tools = {
    b: "brush",
    e: "eraser",
    r: "rectangle",
    l: "lasso",
    h: "pan",
  };
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

$("mask-opacity").oninput = () => {
  $("mask-opacity-value").textContent = $("mask-opacity").value + "%";
  if (state.mask) renderMask();
  markDirty();
};
for (const [id, operation] of [
  ["grow-mask", "expand"],
  ["shrink-mask", "contract"],
])
  $(id).onclick = () => {
    if (!state.mask || state.busy) return;
    remember();
    state.mask = changeSelection(
      state.mask,
      state.width,
      state.height,
      operation,
      2,
    );
    restoreMaskPixels();
    renderMask();
    invalidate();
    feedback(
      operation === "expand"
        ? "Selection expanded by 2 pixels."
        : "Selection contracted by 2 pixels.",
    );
  };
$("apply-result").onclick = applyRepair;
$("save-project").onclick = saveProject;
$("open-project").onclick = () => $("project-upload").click();
$("project-upload").onchange = (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  openProject(file);
};
$("cancel-processing").onclick = cancelProcessing;
$("export-format").onchange = () => {
  $("export-quality").disabled = $("export-format").value === "png";
};
$("export-quality").oninput = () => {
  $("export-quality-value").textContent = $("export-quality").value + "%";
};
$("export-open").onclick = () => {
  $("export-section").scrollIntoView({ behavior: "smooth", block: "center" });
  $("export-format").focus();
};
$("about-open").onclick = () => $("about").showModal();
$("about-close").onclick = () => $("about").close();
$("dropzone").addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.code === "Space") {
    event.preventDefault();
    if (!state.busy) $("image-upload").click();
  }
});
