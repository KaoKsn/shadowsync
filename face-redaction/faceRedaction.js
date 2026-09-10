/**
 * faceRedaction.js
 *
 * Detects faces in a base64-encoded image using OpenCV.js's built-in
 * YuNet detector (cv.FaceDetectorYN) and returns a new base64-encoded
 * image with all detected faces fully redacted (blacked out).
 *
 * Why OpenCV.js + YuNet instead of a hand-rolled ONNX decode:
 * YuNet's raw ONNX output (cls_8/16/32, obj_8/16/32, bbox_8/16/32,
 * kps_8/16/32) has no publicly documented decode formula outside of
 * OpenCV's own C++ source. OpenCV.js is OpenCV compiled to WASM, so
 * cv.FaceDetectorYN runs the *real*, verified decode/NMS logic
 * instead of a reimplementation that could silently produce wrong
 * boxes.
 *
 * Requires (see index.html / test.html for the CDN <script> tag and
 * model download):
 *   1. OpenCV.js loaded as `cv` on window, e.g.:
 *      <script async src="https://docs.opencv.org/4.x/opencv.js" onload="onOpenCvReady()"></script>
 *   2. The YuNet ONNX model file, downloaded locally into your
 *      extension/app and served from a URL you pass to init():
 *      https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx
 *
 * Usage:
 *   await faceRedaction.init("./models/face_detection_yunet_2023mar.onnx");
 *   const redactedBase64 = await faceRedaction.run(base64Image);
 *
 * `base64Image` may be a raw base64 string OR a full data URL
 * (e.g. "data:image/png;base64,....").
 * The returned string has the same format as the input (data URL in,
 * data URL out; raw base64 in, raw base64 out).
 */

(function (global) {
  let detector = null;
  let modelBytesPromise = null;
  let cvReadyPromise = null;

  /**
   * Resolves once OpenCV.js has finished loading its WASM runtime.
   * OpenCV.js exposes `cv.onRuntimeInitialized` for this; if `cv` is
   * already fully initialized (e.g. cv.Mat exists) it resolves immediately.
   */
  function waitForOpenCv() {
    if (!cvReadyPromise) {
      cvReadyPromise = new Promise((resolve, reject) => {
        if (typeof cv === "undefined") {
          reject(
            new Error(
              "OpenCV.js (`cv`) is not defined. Make sure the OpenCV.js " +
                "<script> tag is included and has finished loading before " +
                "calling faceRedaction.init()."
            )
          );
          return;
        }
        if (cv.Mat) {
          resolve();
        } else {
          cv["onRuntimeInitialized"] = () => resolve();
        }
      });
    }
    return cvReadyPromise;
  }

  /** Fetches the .onnx model file as a Uint8Array (cached after first call). */
  function fetchModelBytes(modelUrl) {
    if (!modelBytesPromise) {
      modelBytesPromise = fetch(modelUrl)
        .then((res) => {
          if (!res.ok) {
            throw new Error(
              `Failed to fetch YuNet model at ${modelUrl} (HTTP ${res.status})`
            );
          }
          return res.arrayBuffer();
        })
        .then((buf) => new Uint8Array(buf));
    }
    return modelBytesPromise;
  }

  /**
   * Initializes OpenCV.js and loads the YuNet model. Must be called
   * once (e.g. on extension/app startup) before run(). Safe to call
   * multiple times — subsequent calls reuse the cached detector.
   *
   * @param {string} modelUrl - URL/path to face_detection_yunet_2023mar.onnx
   *   (bundle this file locally; don't fetch it from GitHub at runtime).
   * @param {Object} [options]
   * @param {number} [options.scoreThreshold=0.9] - Min confidence to keep a detection.
   * @param {number} [options.nmsThreshold=0.3] - IoU threshold for non-max suppression.
   * @param {number} [options.topK=5000] - Max candidate boxes kept before NMS.
   */
  async function init(modelUrl, options = {}) {
    if (!modelUrl) {
      throw new Error("faceRedaction.init: modelUrl is required.");
    }
    const { scoreThreshold = 0.9, nmsThreshold = 0.3, topK = 5000 } = options;

    await waitForOpenCv();
    const modelBytes = await fetchModelBytes(modelUrl);

    // Write the model into OpenCV.js's virtual filesystem so
    // FaceDetectorYN.create() (which takes a path, not raw bytes) can read it.
    const fsPath = "/yunet_model.onnx";
    cv.FS_createDataFile("/", "yunet_model.onnx", modelBytes, true, false, false);

    if (detector) {
      detector.delete();
    }

    // inputSize is set per-image in run(); a placeholder here is fine.
    detector = new cv.FaceDetectorYN(
      fsPath,
      "",
      new cv.Size(320, 320),
      scoreThreshold,
      nmsThreshold,
      topK
    );

    return detector;
  }

  /**
   * Normalizes input into { prefix } where `prefix` is the
   * "data:image/...;base64," part (empty string if not present).
   */
  function splitDataUrl(input) {
    const match = /^data:(image\/[a-zA-Z+.-]+);base64,(.*)$/.exec(input);
    return match ? { prefix: `data:${match[1]};base64,` } : { prefix: "" };
  }

  /** Loads a base64 (or data URL) string into an HTMLImageElement. */
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

  /**
   * Redacts (fully blacks out) all detected faces in the given base64
   * image using OpenCV.js's YuNet detector. Call init() once before
   * using this.
   *
   * @param {string} base64Image - Raw base64 string or data URL of the image.
   * @param {Object} [options]
   * @param {number} [options.padding=0] - Extra pixels to expand each face box by.
   * @param {string} [options.outputMimeType="image/png"] - MIME type for the output image.
   * @param {number} [options.outputQuality=0.92] - Quality for lossy formats (e.g. image/jpeg).
   * @returns {Promise<string>} Base64 (or data URL, matching input format) of the redacted image.
   */
  async function run(base64Image, options = {}) {
    if (!base64Image || typeof base64Image !== "string") {
      throw new Error("faceRedaction.run: base64Image must be a non-empty string.");
    }
    if (!detector) {
      throw new Error(
        "faceRedaction.run: call faceRedaction.init(modelUrl) once before run()."
      );
    }

    const { padding = 0, outputMimeType = "image/png", outputQuality = 0.92 } = options;
    const { prefix } = splitDataUrl(base64Image);
    const isDataUrl = prefix !== "";

    const img = await loadImage(base64Image);

    // Draw onto a canvas so we can get pixel data for OpenCV and later
    // re-export the redacted result.
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const rgbaMat = cv.imread(canvas);
    const srcMat = new cv.Mat();
    cv.cvtColor(rgbaMat, srcMat, cv.COLOR_RGBA2RGB);
    rgbaMat.delete();
    let facesMat = null;
    try {
      detector.setInputSize(new cv.Size(canvas.width, canvas.height));

      facesMat = new cv.Mat();
      detector.detect(srcMat, facesMat);

      // facesMat: one row per detected face, columns:
      // [x, y, w, h, x_re, y_re, x_le, y_le, x_nt, y_nt, x_rcm, y_rcm, x_lcm, y_lcm, score]
      ctx.fillStyle = "#000000";
      for (let i = 0; i < facesMat.rows; i++) {
        const x = facesMat.data32F[i * 15 + 0];
        const y = facesMat.data32F[i * 15 + 1];
        const w = facesMat.data32F[i * 15 + 2];
        const h = facesMat.data32F[i * 15 + 3];

        const rx = Math.max(0, x - padding);
        const ry = Math.max(0, y - padding);
        const rw = Math.min(canvas.width, x + w + padding) - rx;
        const rh = Math.min(canvas.height, y + h + padding) - ry;

        ctx.fillRect(rx, ry, rw, rh);
      }
    } finally {
      srcMat.delete();
      if (facesMat) facesMat.delete();
    }

    const dataUrl = canvas.toDataURL(outputMimeType, outputQuality);
    return isDataUrl ? dataUrl : dataUrl.split(",")[1];
  }

  const faceRedaction = { init, run };

  // Expose globally (for plain <script> usage) and as a CommonJS export
  // (for bundlers), without assuming either environment.
  global.faceRedaction = faceRedaction;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = faceRedaction;
  }
})(typeof window !== "undefined" ? window : globalThis);