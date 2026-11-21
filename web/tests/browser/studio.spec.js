import { test, expect } from "@playwright/test";

test("real browser repair, export, canvas tools and responsive layout", async ({
  page,
}) => {
  const pageErrors = [],
    external = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    if (!/^(http:\/\/127\.0\.0\.1:4175|data:|blob:)/.test(request.url()))
      external.push(request.url());
  });
  await page.goto("/");
  await expect(page.locator("#feedback")).toContainText("Ready.");
  await page.locator("#restore").click();
  await expect(page.locator("#feedback")).toContainText(
    "Mark a damaged region",
  );
  await page.getByText("Test selections", { exact: true }).click();
  await page.locator("#preset-scratch").click();
  const coverage = await page.locator("#mask-coverage").textContent();
  await page.locator("#undo").click();
  await expect(page.locator("#mask-coverage")).toHaveText("0.0% selected");
  await page.locator("#redo").click();
  await expect(page.locator("#mask-coverage")).toHaveText(coverage);
  for (const method of ["context", "gan", "migan"]) {
    await page.locator("#method").selectOption(method);
    await page.locator("#restore").click();
    await expect(page.locator("#busy-overlay")).toBeHidden({ timeout: 150000 });
    await expect(page.locator("#feedback")).toContainText("Restoration ready.");
    await expect(page.locator("#result-stats")).toContainText("Preserved");
    const event = page.waitForEvent("download");
    await page.locator("#download-record").click();
    const download = await event,
      stream = await download.createReadStream(),
      chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const record = JSON.parse(Buffer.concat(chunks).toString());
    expect(record.method).toBe(method);
    expect(record.visible_pixels_preserved).toBe(true);
    expect(record.source_sha256).toHaveLength(64);
    await page.locator("#edit-view").click();
  }
  await page.locator("#zoom-in").click();
  await expect(page.locator("#zoom-value")).not.toHaveText("Fit");
  await page.locator("#fit").click();
  await expect(page.locator("#zoom-value")).toHaveText("Fit");
  await page.getByText("Scratch detection", { exact: true }).click();
  await page.locator("#detect").click();
  await expect(page.locator("#busy-overlay")).toBeHidden({ timeout: 60000 });
  await expect(page.locator("#feedback")).not.toContainText("failed");
  await page.locator("#guide-open").click();
  await expect(page.locator("#guide")).toBeVisible();
  await page.locator("#guide-done").click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(pageErrors).toEqual([]);
  expect(external).toEqual([]);
});

test("uploaded images default to no clean reference and settings invalidate stale results", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#feedback")).toContainText("Ready.");
  const response = await page.request.get("/samples/coast.jpg");
  await page.locator("#image-upload").setInputFiles({
    name: "my-photo.jpg",
    mimeType: "image/jpeg",
    buffer: await response.body(),
  });
  await expect(page.locator("#filename")).toHaveText("my-photo.jpg");
  await expect(page.locator("#clean-reference")).not.toBeChecked();
  await page.getByText("Test selections", { exact: true }).click();
  await page.locator("#preset-hole").click();
  await page.locator("#method").selectOption("context");
  await page.locator("#restore").click();
  await expect(page.locator("#busy-overlay")).toBeHidden({ timeout: 30000 });
  await expect(page.locator("#result-stats")).toContainText("No clean target");
  await page.locator("#feather").fill("3");
  await page.locator("#feather").dispatchEvent("input");
  await expect(page.locator("#download-result")).toBeDisabled();
  await expect(page.locator("#compare-view")).toBeDisabled();
});

test("neural inputs ignore inaccessible target pixels", async ({ page }) => {
  await page.goto("/");
  const equal = await page.evaluate(async () => {
    const worker = new Worker("/processor.js");
    let id = 0;
    const run = (message) =>
      new Promise((resolve, reject) => {
        const request = ++id;
        const listener = (event) => {
          if (event.data.id !== request) return;
          worker.removeEventListener("message", listener);
          event.data.type === "error"
            ? reject(new Error(event.data.error))
            : resolve(event.data);
        };
        worker.addEventListener("message", listener);
        worker.postMessage({ ...message, id: request });
      });
    try {
      const width = 64,
        height = 64,
        rgba = new Uint8ClampedArray(width * height * 4),
        mask = new Uint8Array(width * height);
      for (let i = 0; i < width * height; i++) {
        rgba[i * 4] = 140;
        rgba[i * 4 + 1] = 170;
        rgba[i * 4 + 2] = 120;
        rgba[i * 4 + 3] = 255;
      }
      for (let y = 24; y < 40; y++)
        for (let x = 24; x < 40; x++) mask[y * width + x] = 255;
      const alternate = rgba.slice();
      for (let i = 0; i < mask.length; i++)
        if (mask[i]) alternate.fill(255, i * 4, i * 4 + 3);
      for (const method of ["gan", "migan"]) {
        const common = {
          type: "restore",
          width,
          height,
          mask: mask.buffer,
          method,
          settings: {
            radius: 4,
            feather: 0,
            strength: 100,
            cleanReference: false,
          },
        };
        const first = new Uint8Array(
          (await run({ ...common, rgba: rgba.buffer })).rgba,
        );
        const second = new Uint8Array(
          (await run({ ...common, rgba: alternate.buffer })).rgba,
        );
        if (first.some((v, i) => v !== second[i])) return false;
      }
      return true;
    } finally {
      worker.terminate();
    }
  });
  expect(equal).toBe(true);
});
