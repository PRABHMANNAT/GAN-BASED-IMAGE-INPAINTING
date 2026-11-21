/** The portable .reframe file format. Images are embedded, never fetched. */
export const PROJECT_VERSION = 1;
const PNG = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;
const MAX_IMAGE_LENGTH = 12 * 1024 * 1024;

function imageURL(value, label) {
  if (
    typeof value !== "string" ||
    value.length > MAX_IMAGE_LENGTH ||
    !PNG.test(value)
  ) {
    throw new Error(`${label} must be an embedded PNG image.`);
  }
  return value;
}

export function validateProject(project) {
  if (
    !project ||
    project.format !== "reframe-project" ||
    project.version !== PROJECT_VERSION
  ) {
    throw new Error("This is not a supported Reframe project.");
  }
  const { width, height } = project;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 32 ||
    height < 32 ||
    width > 1200 ||
    height > 1200
  ) {
    throw new Error("Project dimensions must be between 32 and 1,200 pixels.");
  }
  const settings = project.settings || {};
  if (!["migan", "context", "gan"].includes(settings.method))
    throw new Error("Unsupported repair method.");
  const ranges = {
    radius: [1, 15],
    feather: [0, 8],
    strength: [20, 100],
    brushSize: [2, 120],
    maskOpacity: [10, 90],
    sensitivity: [10, 80],
  };
  const normalized = {
    method: settings.method,
    cleanReference: settings.cleanReference === true,
  };
  for (const [key, [low, high]] of Object.entries(ranges)) {
    if (
      !Number.isFinite(settings[key]) ||
      settings[key] < low ||
      settings[key] > high
    )
      throw new Error(`Invalid project setting: ${key}.`);
    normalized[key] = settings[key];
  }
  const history = project.history || [];
  if (!Array.isArray(history) || history.length < 1 || history.length > 8)
    throw new Error("Project must contain between one and eight repair steps.");
  if (
    !Number.isInteger(project.historyIndex) ||
    project.historyIndex < 0 ||
    project.historyIndex >= history.length
  )
    throw new Error("Invalid active repair step.");
  const safeHistory = history.map((entry) => ({
    image: imageURL(entry.image, "Repair step"),
    label: String(entry.label || "Repair").slice(0, 100),
    metadata:
      entry.metadata &&
      typeof entry.metadata === "object" &&
      !Array.isArray(entry.metadata)
        ? entry.metadata
        : null,
  }));
  return {
    format: "reframe-project",
    version: PROJECT_VERSION,
    width,
    height,
    sourceName: String(project.sourceName || "image.png").slice(0, 200),
    image: imageURL(project.image, "Working image"),
    mask: imageURL(project.mask, "Selection"),
    candidate: project.candidate
      ? imageURL(project.candidate, "Candidate")
      : null,
    metadata:
      project.metadata &&
      typeof project.metadata === "object" &&
      !Array.isArray(project.metadata)
        ? project.metadata
        : null,
    settings: normalized,
    history: safeHistory,
    historyIndex: project.historyIndex,
  };
}

export function changeSelection(mask, width, height, operation, radius = 2) {
  if (
    mask.length !== width * height ||
    !["expand", "contract"].includes(operation)
  )
    throw new Error("Invalid selection operation.");
  const result = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let selected = operation === "contract";
      outer: for (let dy = -radius; dy <= radius; dy++)
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx,
            ny = y + dy;
          const on =
            nx >= 0 &&
            ny >= 0 &&
            nx < width &&
            ny < height &&
            mask[ny * width + nx] !== 0;
          if (operation === "expand" && on) {
            selected = true;
            break outer;
          }
          if (operation === "contract" && !on) {
            selected = false;
            break outer;
          }
        }
      result[y * width + x] = selected ? 255 : 0;
    }
  return result;
}

export const exportTypes = {
  png: { mime: "image/png", extension: "png" },
  jpeg: { mime: "image/jpeg", extension: "jpg" },
  webp: { mime: "image/webp", extension: "webp" },
};
