# Deploy Reframe to Vercel

The upgraded application is a **static Vite website**. Its image-processing code and both neural models run in the visitor's browser. Vercel serves the files; no Python server, GPU, environment variable, API key, paid inference service or backend is required.

1. In Vercel, select **Add New → Project**.
2. Import **`PRABHMANNAT/GAN-BASED-IMAGE-INPAINTING`** from GitHub.
3. Leave **Root Directory** at the repository root (`./`).
4. The committed `vercel.json` sets these options. If you need to enter them manually:

   | Setting | Value |
   | --- | --- |
   | Framework preset | Vite |
   | Node.js version | 22.12+ or 24.x |
   | Install command | `npm ci` |
   | Build command | `npm run build` |
   | Output directory | `web/dist` |
   | Environment variables | None |

5. Click **Deploy**. Open the generated URL.
6. Open **Test selections**, choose **Scratches**, then click **Repair selection**. The first MI-GAN run downloads its 28 MB model and the ONNX runtime from your own deployment. Later runs reuse the loaded session. Your photo is never uploaded.
7. Move the comparison slider, export the image, and test an uploaded image. Review automatically detected scratches before repairing them.

The original Flask/PyTorch demo remains in the repository for teaching. It is **not** the Vercel application. Do not choose Flask/Python as the framework or use `python app.py` as the Vercel build command. The root Vercel configuration explicitly selects Vite and the browser app's output directory.

## Build locally before deployment

```bash
npm ci
npm test
npm run build
npm run preview
```

Open the printed local URL. Build output is `web/dist`. The build copies the matching OpenCV/ONNX runtime assets from the locked npm dependencies and includes all models and samples. No remote model service is involved.

For local development:

```bash
npm ci
npm run dev
```

Or double-click `start_studio_windows.bat` after installing Node.js 22.12 or newer.

## Browser compatibility

Use a recent Chrome, Edge, Firefox or Safari with WebAssembly SIMD and Web Workers. All methods use the CPU/WebAssembly path, so WebGPU is not required. Neural inference consumes device memory and takes longer on phones or older laptops. **Context fill** uses the lightweight local JavaScript algorithm when you want a quicker result.

If an engine fails to download, the application shows an error; it never labels a classical fill as a GAN result. Retry after checking the connection or select Context fill. Repair small regions at a time for better visual results.

## Hosting notes

- The production build is approximately 55 MB, including self-hosted runtime binaries and models. No runtime secrets are used.
- Model, JavaScript and WebAssembly files must be served unchanged with normal static MIME types; Vercel does this automatically.
- No cross-origin isolation headers are required because inference uses one WebAssembly thread.
- Do not add an SPA fallback that rewrites missing `.wasm` or `.onnx` files to `index.html`.
- Vercel deployment itself is left to you, as requested. The repository is ready for import; no Vercel deployment is claimed as part of delivery.
