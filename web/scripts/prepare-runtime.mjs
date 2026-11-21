import { mkdir, copyFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, "public/runtime");
await mkdir(target, { recursive: true });
const licenses = path.join(target, "licenses");
await mkdir(licenses, { recursive: true });
await copyFile(
  path.join(root, "../LICENSE"),
  path.join(licenses, "reframe.txt"),
);
for (const [pkg, filename, label] of [
  ["@techstark/opencv-js", "LICENSE", "opencv"],
  ["lucide", "LICENSE", "lucide"],
  ["vite", "LICENSE.md", "vite"],
]) {
  await copyFile(
    path.join(root, "node_modules", pkg, filename),
    path.join(licenses, label + ".txt"),
  );
}
// npm omits the ONNX top-level license in this distribution; carry the
// upstream runtime's MIT license saved in the source repository.
await copyFile(
  path.join(root, "licenses/ONNX-RUNTIME-LICENSE.txt"),
  path.join(licenses, "onnxruntime.txt"),
);
await copyFile(
  path.join(root, "node_modules/@techstark/opencv-js/dist/opencv.js"),
  path.join(target, "opencv.js"),
);
const ort = path.join(root, "node_modules/onnxruntime-web/dist");
await copyFile(
  path.join(ort, "ort.wasm.min.js"),
  path.join(target, "ort.wasm.min.js"),
);
for (const file of await readdir(ort)) {
  if (/^ort-wasm-simd-threaded\.(wasm|mjs)$/.test(file))
    await copyFile(path.join(ort, file), path.join(target, file));
}
console.log("Prepared self-hosted OpenCV and ONNX WebAssembly runtime assets.");
