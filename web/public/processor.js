/* Dedicated worker: image data never leaves this browser. */
importScripts("/repair-core.js");
const Core = self.RepairCore;
let cvPromise, ortPromise, edgeSession, miganSession;
const progress = (text) => self.postMessage({ type: "progress", text });

function getCV() {
  if (!cvPromise)
    cvPromise = (async () => {
      progress("Loading image analysis engine…");
      importScripts("/runtime/opencv.js");
      let instance = self.cv;
      if (instance && typeof instance.then === "function")
        instance = await instance;
      if (!instance?.Mat)
        await new Promise((resolve, reject) => {
          const timer = setTimeout(
            () =>
              reject(
                new Error(
                  "Image analysis engine could not start. Reload and try again.",
                ),
              ),
            45000,
          );
          instance.onRuntimeInitialized = () => {
            clearTimeout(timer);
            resolve();
          };
        });
      return instance;
    })().catch((error) => {
      cvPromise = null;
      throw error;
    });
  return cvPromise;
}
function getORT() {
  if (!ortPromise)
    ortPromise = (async () => {
      importScripts("/runtime/ort.wasm.min.js");
      self.ort.env.wasm.wasmPaths = new URL(
        "/runtime/",
        self.location.origin,
      ).href;
      self.ort.env.wasm.numThreads = 1;
      self.ort.env.wasm.proxy = false;
      return self.ort;
    })().catch((error) => {
      ortPromise = null;
      throw error;
    });
  return ortPromise;
}
function matRGBA(cv, rgba, width, height) {
  return cv.matFromArray(height, width, cv.CV_8UC4, rgba);
}

async function detect(rgba, width, height, sensitivity) {
  const cv = await getCV(),
    mats = [];
  const make = () => {
    const m = new cv.Mat();
    mats.push(m);
    return m;
  };
  try {
    const source = matRGBA(cv, rgba, width, height);
    mats.push(source);
    const gray = make(),
      bright = make(),
      dark = make(),
      response = make(),
      binary = make(),
      cleaned = make();
    cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY);
    const kernel = cv.getStructuringElement(
      cv.MORPH_ELLIPSE,
      new cv.Size(7, 7),
    );
    mats.push(kernel);
    cv.morphologyEx(gray, bright, cv.MORPH_TOPHAT, kernel);
    cv.morphologyEx(gray, dark, cv.MORPH_BLACKHAT, kernel);
    cv.max(bright, dark, response);
    const threshold = 70 - sensitivity * 0.65;
    cv.threshold(response, binary, threshold, 255, cv.THRESH_BINARY);
    // Remove isolated specks; suggestions remain deliberately reviewable.
    const tidy = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(2, 2));
    mats.push(tidy);
    cv.morphologyEx(binary, cleaned, cv.MORPH_OPEN, tidy);
    return new Uint8Array(cleaned.data);
  } finally {
    mats.forEach((mat) => mat.delete());
  }
}

async function edgeGAN(rgba, mask, width, height) {
  const cv = await getCV(),
    ort = await getORT(),
    mats = [];
  const make = () => {
    const m = new cv.Mat();
    mats.push(m);
    return m;
  };
  try {
    progress("Loading the edge-guided teaching model…");
    if (!edgeSession)
      edgeSession = await ort.InferenceSession.create(
        "/models/edge-unet.onnx",
        { executionProviders: ["wasm"] },
      );
    const available = new Uint8ClampedArray(rgba);
    for (let i = 0; i < mask.length; i++)
      if (mask[i]) available.fill(0, i * 4, i * 4 + 3);
    const source = matRGBA(cv, available, width, height);
    mats.push(source);
    const resized = make(),
      rgb = make(),
      gray = make(),
      edges = make(),
      expanded = make();
    cv.resize(source, resized, new cv.Size(256, 256), 0, 0, cv.INTER_LINEAR);
    const smallMask = Core.conservativeMask(mask, width, height, 256, 256);
    for (let i = 0; i < smallMask.length; i++)
      if (smallMask[i]) resized.data.fill(0, i * 4, i * 4 + 3);
    cv.cvtColor(resized, rgb, cv.COLOR_RGBA2RGB);
    cv.cvtColor(rgb, gray, cv.COLOR_RGB2GRAY);
    cv.Canny(gray, edges, 70, 150);
    const maskMat = cv.matFromArray(256, 256, cv.CV_8UC1, smallMask);
    mats.push(maskMat);
    const kernel = cv.Mat.ones(7, 7, cv.CV_8U);
    mats.push(kernel);
    cv.dilate(maskMat, expanded, kernel);
    const pixels = 256 * 256,
      input = new Float32Array(pixels * 5);
    for (let i = 0; i < pixels; i++) {
      for (let c = 0; c < 3; c++)
        input[c * pixels + i] = rgb.data[i * 3 + c] / 255;
      input[pixels * 3 + i] = smallMask[i] ? 1 : 0;
      input[pixels * 4 + i] = expanded.data[i] ? 0 : edges.data[i] / 255;
    }
    progress("Running edge-guided GAN inference…");
    const out = await edgeSession.run({
      condition: new ort.Tensor("float32", input, [1, 5, 256, 256]),
    });
    const predicted = new Uint8Array(pixels * 4);
    for (let i = 0; i < pixels; i++) {
      for (let c = 0; c < 3; c++)
        predicted[i * 4 + c] = Math.round(
          Math.max(0, Math.min(1, out.prediction.data[c * pixels + i])) * 255,
        );
      predicted[i * 4 + 3] = 255;
    }
    const predMat = matRGBA(cv, predicted, 256, 256);
    mats.push(predMat);
    const full = make();
    cv.resize(predMat, full, new cv.Size(width, height), 0, 0, cv.INTER_LINEAR);
    const info = await (await fetch("/models/provenance.json")).json();
    return { prediction: new Uint8ClampedArray(full.data), model: info };
  } finally {
    mats.forEach((mat) => mat.delete());
  }
}

async function migan(rgba, mask, width, height) {
  const ort = await getORT();
  progress("Loading pretrained MI-GAN (first run takes longer)…");
  if (!miganSession)
    miganSession = await ort.InferenceSession.create("/models/migan.onnx", {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });
  const pixels = width * height,
    image = new Uint8Array(pixels * 3),
    known = new Uint8Array(pixels);
  // The official pipeline internally feathers a narrow boundary band. Extend
  // its inference mask so that band stays outside our actual selected region.
  // The final composite still changes only the user's original binary mask.
  const inferenceMask = Core.expandMask(mask, width, height, 5);
  for (let i = 0; i < pixels; i++) {
    known[i] = inferenceMask[i] ? 0 : 255;
    // Explicitly remove hidden target values before calling the model pipeline.
    for (let c = 0; c < 3; c++)
      image[c * pixels + i] = mask[i] ? 0 : rgba[i * 4 + c];
  }
  progress("Reconstructing with pretrained MI-GAN…");
  const outputs = await miganSession.run({
    image: new ort.Tensor("uint8", image, [1, 3, height, width]),
    mask: new ort.Tensor("uint8", known, [1, 1, height, width]),
  });
  const output = outputs[miganSession.outputNames[0]],
    prediction = new Uint8ClampedArray(rgba);
  for (let i = 0; i < pixels; i++)
    for (let c = 0; c < 3; c++)
      prediction[i * 4 + c] = output.data[c * pixels + i];
  const info = await (await fetch("/models/migan-provenance.json")).json();
  return { prediction, model: { ...info, inference_mask_padding_px: 5 } };
}

self.onmessage = async (event) => {
  const {
    id,
    type,
    width,
    height,
    rgba: raw,
    mask: rawMask,
    method,
    settings = {},
  } = event.data;
  try {
    if (type === "init") {
      self.postMessage({ id, type: "ready" });
      return;
    }
    const rgba = new Uint8ClampedArray(raw);
    if (type === "detect") {
      progress("Finding thin high-contrast marks…");
      const found = await detect(rgba, width, height, settings.sensitivity);
      self.postMessage({ id, type: "detected", mask: found.buffer }, [
        found.buffer,
      ]);
      return;
    }
    if (type !== "restore") throw new Error("Unknown processing request.");
    const started = performance.now(),
      mask = new Uint8Array(rawMask);
    const count = Core.validateMask(mask, width, height);
    let prediction, model;
    if (method === "context") {
      progress("Filling from the surrounding image…");
      prediction = Core.contextFill(rgba, mask, width, height, settings.radius);
      model = {
        name: "Distance-ordered context fill",
        kind: "classical baseline; original JavaScript implementation",
      };
    } else if (method === "gan")
      ({ prediction, model } = await edgeGAN(rgba, mask, width, height));
    else if (method === "migan")
      ({ prediction, model } = await migan(rgba, mask, width, height));
    else throw new Error("Choose a supported repair method.");
    const result = Core.composite(
      rgba,
      prediction,
      mask,
      width,
      height,
      settings.strength / 100,
      settings.feather,
    );
    const scores = settings.cleanReference
      ? Core.metrics(rgba, result, mask)
      : null;
    let preserved = true;
    for (let i = 0; i < mask.length; i++)
      if (!mask[i])
        for (let c = 0; c < 4; c++)
          if (result[i * 4 + c] !== rgba[i * 4 + c]) preserved = false;
    const metadata = {
      app: "Reframe Studio 2.0",
      created_utc: new Date().toISOString(),
      method,
      model,
      settings,
      mask_convention: "255 = missing; 0 = visible",
      working_size: [width, height],
      coverage_percent: Math.round((count / mask.length) * 10000) / 100,
      visible_pixels_preserved: preserved,
      metrics: scores,
      elapsed_ms: Math.round(performance.now() - started),
      review_status: "unreviewed generated derivative",
      processing: "entirely in browser; no image upload",
    };
    self.postMessage({ id, type: "restored", rgba: result.buffer, metadata }, [
      result.buffer,
    ]);
  } catch (error) {
    self.postMessage({
      id,
      type: "error",
      error: error.message || String(error),
    });
  }
};
