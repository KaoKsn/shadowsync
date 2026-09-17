const fs = require("fs");
const path = require("path");
const vm = require("vm");
const sharp = require("sharp");

const moduleDir = __dirname;
const inputDir = path.join(moduleDir, "input");
const outputDir = path.join(moduleDir, "output");
const maxCodes = 10;
const padding = 8;
const supportedExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"]);

function loadJsQr() {
  const source = fs.readFileSync(path.join(moduleDir, "jsQR.min.js"), "utf8");
  const context = {};
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "jsQR.min.js" });
  if (typeof context.jsQR !== "function") {
    throw new Error("The local jsQR library did not expose jsQR.");
  }
  return context.jsQR;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function getBox(location, width, height) {
  const points = [
    location.topLeftCorner,
    location.topRightCorner,
    location.bottomLeftCorner,
    location.bottomRightCorner,
  ];
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = clamp(Math.floor(Math.min(...xs) - padding), 0, width);
  const top = clamp(Math.floor(Math.min(...ys) - padding), 0, height);
  const right = clamp(Math.ceil(Math.max(...xs) + padding), 0, width);
  const bottom = clamp(Math.ceil(Math.max(...ys) + padding), 0, height);
  return { left, top, right, bottom };
}

function blackout(raw, width, box) {
  for (let y = box.top; y < box.bottom; y += 1) {
    for (let x = box.left; x < box.right; x += 1) {
      const offset = (y * width + x) * 4;
      raw[offset] = 0;
      raw[offset + 1] = 0;
      raw[offset + 2] = 0;
      raw[offset + 3] = 255;
    }
  }
}

async function maskImage(fileName, jsQR) {
  const sourcePath = path.join(inputDir, fileName);
  const outputPath = path.join(outputDir, `masked-${path.parse(fileName).name}.png`);
  const { data, info } = await sharp(sourcePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const raw = new Uint8ClampedArray(data);
  let codeCount = 0;

  for (; codeCount < maxCodes; codeCount += 1) {
    const result = jsQR(raw, info.width, info.height, {
      inversionAttempts: "attemptBoth",
    });
    if (!result || !result.location) break;
    blackout(raw, info.width, getBox(result.location, info.width, info.height));
  }

  await sharp(Buffer.from(raw), {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toFile(outputPath);

  console.log(`${fileName}: masked ${codeCount} QR code(s) -> ${path.basename(outputPath)}`);
}

async function main() {
  fs.mkdirSync(inputDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
  const files = fs.readdirSync(inputDir).filter((fileName) =>
    supportedExtensions.has(path.extname(fileName).toLowerCase()),
  );

  if (files.length === 0) {
    console.log(`Put an image in ${inputDir} and run this command again.`);
    return;
  }

  const jsQR = loadJsQr();
  for (const fileName of files) {
    await maskImage(fileName, jsQR);
  }
}

main().catch((error) => {
  console.error("QR masking failed:", error.message);
  process.exitCode = 1;
});
