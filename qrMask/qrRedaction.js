/**
 * qrRedaction.js
 *
 * Drop-in QR code masking for sanitized screenshots.
 * Public API: window.qrRedaction(base64Image, options) -> Promise<string>
 *
 * BarcodeDetector is preferred when available. jsQR is used as an offline
 * fallback and is loaded before this file by the extension manifest.
 */

(function (global) {
  const DEFAULT_PADDING = 8;
  const DEFAULT_MAX_CODES = 10;
  const DEFAULT_OUTPUT_MIME_TYPE = "image/png";
  const DEFAULT_OUTPUT_QUALITY = 0.92;

  function loadImage(base64OrDataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = (error) => {
        reject(new Error("Failed to load image: " + error));
      };
      img.src = base64OrDataUrl.startsWith("data:")
        ? base64OrDataUrl
        : `data:image/png;base64,${base64OrDataUrl}`;
    });
  }

  function splitDataUrl(input) {
    const match = /^data:(image\/[a-zA-Z+.-]+);base64,/.exec(input);
    return match ? { prefix: match[0] } : { prefix: "" };
  }

  function pointFrom(value) {
    if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y)) {
      return null;
    }
    return { x: value.x, y: value.y };
  }

  function pointsFromDetection(detection) {
    const points = Array.isArray(detection.cornerPoints)
      ? detection.cornerPoints.map(pointFrom).filter(Boolean)
      : [];
    if (points.length >= 4) return points;

    const box = detection.boundingBox;
    if (!box) return [];
    return [
      { x: box.x, y: box.y },
      { x: box.x + box.width, y: box.y },
      { x: box.x, y: box.y + box.height },
      { x: box.x + box.width, y: box.y + box.height },
    ];
  }

  function boundingBoxFromPoints(points, padding, width, height) {
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const left = Math.max(0, Math.floor(Math.min(...xs) - padding));
    const top = Math.max(0, Math.floor(Math.min(...ys) - padding));
    const right = Math.min(width, Math.ceil(Math.max(...xs) + padding));
    const bottom = Math.min(height, Math.ceil(Math.max(...ys) + padding));
    return {
      x: left,
      y: top,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    };
  }

  function logPath(path, debug) {
    if (debug) console.debug(`[PrivSight] QR detection path: ${path}`);
  }

  async function detectWithBarcodeDetector(canvas, debug) {
    if (!("BarcodeDetector" in global)) return null;
    if (typeof global.BarcodeDetector.getSupportedFormats !== "function") {
      return null;
    }

    const formats = await global.BarcodeDetector.getSupportedFormats();
    if (!formats.includes("qr_code")) return null;

    const detector = new global.BarcodeDetector({ formats: ["qr_code"] });
    const detections = await detector.detect(canvas);
    logPath("BarcodeDetector", debug);
    return detections
      .map((detection) => pointsFromDetection(detection))
      .filter((points) => points.length >= 4);
  }

  function detectWithJsQr(canvas, ctx, maxCodes, debug) {
    if (typeof global.jsQR !== "function") {
      throw new Error("jsQR is unavailable.");
    }

    logPath("jsQR", debug);
    const detections = [];
    for (let count = 0; count < maxCodes; count += 1) {
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const result = global.jsQR(
        imageData.data,
        imageData.width,
        imageData.height,
        { inversionAttempts: "attemptBoth" },
      );
      if (!result || !result.location) break;

      const points = [
        result.location.topLeftCorner,
        result.location.topRightCorner,
        result.location.bottomLeftCorner,
        result.location.bottomRightCorner,
      ]
        .map(pointFrom)
        .filter(Boolean);
      if (points.length < 4) break;

      detections.push(points);
      const box = boundingBoxFromPoints(points, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#000000";
      ctx.fillRect(box.x, box.y, box.width, box.height);
    }
    return detections;
  }

  async function run(base64Image, options = {}) {
    // Load the image and preserve whether the caller supplied a data URL.
    if (!base64Image || typeof base64Image !== "string") {
      throw new Error("qrRedaction: base64Image must be a non-empty string.");
    }
    const {
      padding = DEFAULT_PADDING,
      maxCodes = DEFAULT_MAX_CODES,
      outputMimeType = DEFAULT_OUTPUT_MIME_TYPE,
      outputQuality = DEFAULT_OUTPUT_QUALITY,
      debug = false,
    } = options;
    const { prefix } = splitDataUrl(base64Image);
    const isDataUrl = prefix !== "";
    const img = await loadImage(base64Image);

    // Draw the source image onto a mutable canvas.
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx || !canvas.width || !canvas.height) {
      throw new Error("Could not create a usable QR canvas.");
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // Detect QR codes, preferring native multi-code detection.
    const nativeDetections = await detectWithBarcodeDetector(canvas, debug);
    const detections = nativeDetections || detectWithJsQr(
      canvas,
      ctx,
      Math.max(0, maxCodes),
      debug,
    );

    // Black out every detected bounding box on the permanent canvas.
    ctx.fillStyle = "#000000";
    for (const points of detections) {
      const box = boundingBoxFromPoints(
        points,
        Math.max(0, padding),
        canvas.width,
        canvas.height,
      );
      ctx.fillRect(box.x, box.y, box.width, box.height);
    }

    // Export in the caller's original data URL or raw-base64 convention.
    const dataUrl = canvas.toDataURL(outputMimeType, outputQuality);
    return isDataUrl ? dataUrl : dataUrl.split(",")[1];
  }

  function qrRedaction(base64Image, options) {
    return run(base64Image, options).catch((error) => {
      console.warn("QR redaction skipped; returning the original image:", error);
      return base64Image;
    });
  }

  qrRedaction.run = run;
  global.qrRedaction = qrRedaction;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = qrRedaction;
  }
})(typeof window !== "undefined" ? window : globalThis);
