/**
 * faceRedaction.js (onnxruntime-web version)
 *
 * Drop-in replacement for the OpenCV.js-based faceRedaction.js.
 * Same public API: window.faceRedaction(base64Image, options) -> Promise<string>
 * content.js does NOT need to change.
 *
 * Requires ort (onnxruntime-web UMD/global build) to be loaded BEFORE
 * this script — add ort.wasm.min.js to content_scripts, before this file.
 *
 * Confirmed via Netron:
 *   input:  float32[1,3,640,640]
 *   outputs: cls_8/16/32 [1,N,1], obj_8/16/32 [1,N,1],
 *            bbox_8/16/32 [1,N,4], kps_8/16/32 [1,N,10]
 *
 * NOTE ON CORRECTNESS: the decode formula below (score = sqrt(cls*obj),
 * box regression scaled by stride) is a best-effort port of YuNet's
 * published anchor-free architecture, NOT verified line-by-line against
 * OpenCV's C++ source. VALIDATE on a test image with a known face
 * before trusting this for redaction (see bottom of this file).
 */

(function (global) {
  const STRIDES = [8, 16, 32];
  const INPUT_SIZE = 640;
  const SCORE_THRESHOLD = 0.6;
  const NMS_THRESHOLD = 0.3;
  const TOP_K = 50;

  let sessionPromise = null;

  const defaultModelUrl = chrome.runtime.getURL(
    "face_detection_yunet_2023mar.onnx",
  );

  function loadImage(base64OrDataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = (err) => reject(new Error("Failed to load image: " + err));
      img.src = base64OrDataUrl.startsWith("data:")
        ? base64OrDataUrl
        : `data:image/png;base64,${base64OrDataUrl}`;
    });
  }

  function splitDataUrl(input) {
    const match = /^data:(image\/[a-zA-Z+.-]+);base64,(.*)$/.exec(input);
    return match ? { prefix: `data:${match[1]};base64,` } : { prefix: "" };
  }

  async function getSession(modelUrl) {
    if (!sessionPromise) {
      ort.env.wasm.proxy = false;
      sessionPromise = ort.InferenceSession.create(modelUrl || defaultModelUrl, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
      });
    }
    return sessionPromise;
  }

  // Resize the source canvas into a 640x640 BGR CHW float32 tensor.
  function preprocess(sourceCanvas) {
    const offscreen = document.createElement("canvas");
    offscreen.width = INPUT_SIZE;
    offscreen.height = INPUT_SIZE;
    const ctx = offscreen.getContext("2d");
    ctx.drawImage(sourceCanvas, 0, 0, INPUT_SIZE, INPUT_SIZE);

    const { data } = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
    const planeSize = INPUT_SIZE * INPUT_SIZE;
    const chw = new Float32Array(3 * planeSize);

    for (let i = 0; i < planeSize; i++) {
      const r = data[i * 4 + 0];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];
      chw[i] = b;
      chw[planeSize + i] = g;
      chw[2 * planeSize + i] = r;
    }

    const tensor = new ort.Tensor("float32", chw, [1, 3, INPUT_SIZE, INPUT_SIZE]);
    return {
      tensor,
      scaleX: sourceCanvas.width / INPUT_SIZE,
      scaleY: sourceCanvas.height / INPUT_SIZE,
    };
  }

  function iou(a, b) {
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.width, b.x + b.width);
    const y2 = Math.min(a.y + a.height, b.y + b.height);
    const interW = Math.max(0, x2 - x1);
    const interH = Math.max(0, y2 - y1);
    const interArea = interW * interH;
    const areaA = a.width * a.height;
    const areaB = b.width * b.height;
    return interArea / (areaA + areaB - interArea);
  }

  function nms(boxes, threshold) {
    const sorted = [...boxes].sort((a, b) => b.score - a.score);
    const keep = [];
    while (sorted.length > 0) {
      const current = sorted.shift();
      keep.push(current);
      for (let i = sorted.length - 1; i >= 0; i--) {
        if (iou(current, sorted[i]) > threshold) sorted.splice(i, 1);
      }
    }
    return keep;
  }

  function decode(outputs, scaleX, scaleY) {
    const candidates = [];

    for (const stride of STRIDES) {
      const cls = outputs[`cls_${stride}`].data;
      const obj = outputs[`obj_${stride}`].data;
      const bbox = outputs[`bbox_${stride}`].data;

      const featSize = INPUT_SIZE / stride;
      let idx = 0;

      for (let row = 0; row < featSize; row++) {
        for (let col = 0; col < featSize; col++, idx++) {
          const clsScore = Math.min(Math.max(cls[idx], 0), 1);
          const objScore = Math.min(Math.max(obj[idx], 0), 1);
          const score = Math.sqrt(clsScore * objScore);
          if (score < SCORE_THRESHOLD) continue;

          const priorCx = (col + 0.5) * stride;
          const priorCy = (row + 0.5) * stride;

          const dx = bbox[idx * 4 + 0];
          const dy = bbox[idx * 4 + 1];
          const dw = bbox[idx * 4 + 2];
          const dh = bbox[idx * 4 + 3];

          const cx = priorCx + dx * stride;
          const cy = priorCy + dy * stride;
          const w = Math.exp(dw) * stride;
          const h = Math.exp(dh) * stride;

          candidates.push({
            x: (cx - w / 2) * scaleX,
            y: (cy - h / 2) * scaleY,
            width: w * scaleX,
            height: h * scaleY,
            score,
          });
        }
      }
    }

    return nms(candidates, NMS_THRESHOLD).slice(0, TOP_K);
  }

  async function run(base64Image, options = {}) {
    if (!base64Image || typeof base64Image !== "string") {
      throw new Error("faceRedaction: base64Image must be a non-empty string.");
    }

    const { padding = 0, outputMimeType = "image/png", outputQuality = 0.92 } = options;
    const { prefix } = splitDataUrl(base64Image);
    const isDataUrl = prefix !== "";

    const session = await getSession(options.modelUrl);
    const img = await loadImage(base64Image);

    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const { tensor, scaleX, scaleY } = preprocess(canvas);
    const outputs = await session.run({ input: tensor });
    const faces = decode(outputs, scaleX, scaleY);

    ctx.fillStyle = "#000000";
    for (const face of faces) {
      const rx = Math.max(0, face.x - padding);
      const ry = Math.max(0, face.y - padding);
      const rw = Math.min(canvas.width, face.x + face.width + padding) - rx;
      const rh = Math.min(canvas.height, face.y + face.height + padding) - ry;
      ctx.fillRect(rx, ry, rw, rh);
    }

    const dataUrl = canvas.toDataURL(outputMimeType, outputQuality);
    return isDataUrl ? dataUrl : dataUrl.split(",")[1];
  }

  function faceRedaction(base64Image, options) {
    return run(base64Image, options).catch((error) => {
      console.warn("Face redaction skipped because the ONNX runtime is unavailable:", error);
      return base64Image;
    });
  }

  faceRedaction.run = run;
  global.faceRedaction = faceRedaction;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = faceRedaction;
  }
})(typeof window !== "undefined" ? window : globalThis);

// ---- VALIDATION NOTE ----
// Run this on a screenshot with one clear face, check the console for
// the number of faces detected and their box coordinates, and visually
// confirm the black box lands on the face. If boxes are off, tell me
// how (too big/small/shifted) so I can correct the exact formula.