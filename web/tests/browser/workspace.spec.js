import { test, expect } from "@playwright/test";

async function readDownload(download) {
  const stream = await download.createReadStream(),
    chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}
async function ready(page) {
  await page.goto("/");
  await expect(page.locator("#feedback")).toContainText("Ready.");
}
async function selectAndRepair(page) {
  await page.getByText("Test selections", { exact: true }).click();
  await page.locator("#preset-hole").click();
  await page.locator("#method").selectOption("context");
  await page.locator("#restore").click();
  await expect(page.locator("#busy-overlay")).toBeHidden({ timeout: 30000 });
  await expect(page.locator("#feedback")).toContainText("Restoration ready.");
}

test("saved projects restore selection, candidate, settings and applied repair history", async ({
  page,
}) => {
  await ready(page);
  await selectAndRepair(page);
  await page.locator("#apply-result").click();
  await expect(page.locator(".history-item")).toHaveCount(2);
  await expect(page.locator("#download-result")).not.toBeDisabled();
  const committedExport = page.waitForEvent("download");
  await page.locator("#download-result").click();
  expect(
    (await readDownload(await committedExport)).subarray(0, 8).toString("hex"),
  ).toBe("89504e470d0a1a0a");
  await expect(page.locator("#clean-reference")).not.toBeChecked();
  await page.locator("#preset-scratch").click();
  await page.locator("#restore").click();
  await expect(page.locator("#busy-overlay")).toBeHidden();
  const coverage = await page.locator("#mask-coverage").textContent();
  const saved = page.waitForEvent("download");
  await page.locator("#save-project").click();
  const bytes = await readDownload(await saved);
  const project = JSON.parse(bytes.toString());
  expect(project.format).toBe("reframe-project");
  expect(project.history).toHaveLength(2);
  expect(project.candidate).toContain("data:image/png;base64,");
  await page.getByText("Sample images", { exact: true }).click();
  await page.locator("[data-sample=coast]").click();
  await expect(page.locator("#filename")).toHaveText("Coastal study");
  await page
    .locator("#project-upload")
    .setInputFiles({
      name: "restoration.reframe",
      mimeType: "application/json",
      buffer: bytes,
    });
  await expect(page.locator("#feedback")).toContainText("Project opened.");
  await expect(page.locator("#filename")).toHaveText("Heritage facade");
  await expect(page.locator("#mask-coverage")).toHaveText(coverage);
  await expect(page.locator(".history-item")).toHaveCount(2);
  await expect(page.locator("#compare-view")).not.toBeDisabled();
  await page.locator(".history-item").first().click();
  await expect(page.locator("#apply-result")).toBeDisabled();
  await expect(page.locator("#mask-coverage")).toHaveText("0.0% selected");
});

test("selection tools, opacity, morphology and three export encodings work", async ({
  page,
}) => {
  await ready(page);
  const image = await page.locator("#image-stage").boundingBox();
  await page.locator("[data-tool=lasso]").click();
  await page.mouse.move(
    image.x + image.width * 0.35,
    image.y + image.height * 0.3,
  );
  await page.mouse.down();
  await page.mouse.move(
    image.x + image.width * 0.5,
    image.y + image.height * 0.32,
    { steps: 4 },
  );
  await page.mouse.move(
    image.x + image.width * 0.47,
    image.y + image.height * 0.46,
    { steps: 4 },
  );
  await page.mouse.move(
    image.x + image.width * 0.35,
    image.y + image.height * 0.3,
    { steps: 4 },
  );
  await page.mouse.up();
  const before = parseFloat(await page.locator("#mask-coverage").textContent());
  expect(before).toBeGreaterThan(0);
  await page.locator("#grow-mask").click();
  expect(
    parseFloat(await page.locator("#mask-coverage").textContent()),
  ).toBeGreaterThan(before);
  await page.locator("#undo").click();
  expect(parseFloat(await page.locator("#mask-coverage").textContent())).toBe(
    before,
  );
  await page.locator("#mask-opacity").fill("20");
  await page.locator("#mask-opacity").dispatchEvent("input");
  const alpha = await page
    .locator("#mask-canvas")
    .evaluate(
      (canvas) =>
        canvas
          .getContext("2d")
          .getImageData(
            Math.floor(canvas.width * 0.43),
            Math.floor(canvas.height * 0.38),
            1,
            1,
          ).data[3],
    );
  expect(alpha).toBe(51);
  await expect(page.locator("#mask-opacity-value")).toHaveText("20%");
  await page.locator("#method").selectOption("context");
  await page.locator("#restore").click();
  await expect(page.locator("#busy-overlay")).toBeHidden();
  for (const format of ["png", "jpeg", "webp"]) {
    await page.locator("#export-format").selectOption(format);
    const event = page.waitForEvent("download");
    await page.locator("#download-result").click();
    const download = await event,
      bytes = await readDownload(download);
    if (format === "png") {
      expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    }
    if (format === "jpeg") {
      expect(bytes.subarray(0, 2).toString("hex")).toBe("ffd8");
      expect(download.suggestedFilename()).toMatch(/\.jpg$/);
    }
    if (format === "webp") {
      expect(bytes.subarray(8, 12).toString()).toBe("WEBP");
    }
  }
});

test("cancel terminates a running model without changing the selection and recovers", async ({
  page,
}) => {
  await ready(page);
  await page.getByText("Test selections", { exact: true }).click();
  await page.locator("#preset-hole").click();
  const coverage = await page.locator("#mask-coverage").textContent();
  await page.route("**/models/migan.onnx", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    try {
      await route.continue();
    } catch {}
  });
  await page.locator("#restore").click();
  await expect(page.locator("#busy-overlay")).toBeVisible();
  await page.locator("#cancel-processing").click();
  await expect(page.locator("#busy-overlay")).toBeHidden();
  await expect(page.locator("#feedback")).toContainText("cancelled");
  await expect(page.locator("#mask-coverage")).toHaveText(coverage);
  await page.locator("#method").selectOption("context");
  await page.locator("#restore").click();
  await expect(page.locator("#busy-overlay")).toBeHidden();
  await expect(page.locator("#feedback")).toContainText("Restoration ready.");
});

test("malformed projects do not replace the open document and attribution is visible", async ({
  page,
}) => {
  await ready(page);
  await page
    .locator("#project-upload")
    .setInputFiles({
      name: "bad.reframe",
      mimeType: "application/json",
      buffer: Buffer.from('{"format":"not-a-project"}'),
    });
  await expect(page.locator("#feedback")).toContainText("Cannot open project.");
  await expect(page.locator("#filename")).toHaveText("Heritage facade");
  await page.locator("#about-open").click();
  await expect(page.locator("#about")).toContainText("PRABHMANNAT SINGH");
  await expect(page.locator("#about")).toContainText("MIT License");
});
