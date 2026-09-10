import * as ort from 'onnxruntime-web';
import type { Detection, RedactOptions } from './types';

const INPUT_SIZE = 640;
const MODEL_URL = new URL(/* @vite-ignore */ '../face_detection_yunet.onnx', import.meta.url).href;

let sessionPromise: Promise<ort.InferenceSession> | undefined;

function loadSession(): Promise<ort.InferenceSession> {
  if (!sessionPromise) {
  ort.env.wasm.numThreads = Math.max(1,Math.min(4, globalThis.navigator?.hardwareConcurrency ?? 1));
  ort.env.wasm.simd = true;
  ort.env.wasm.wasmPaths = new URL(/* @vite-ignore */ '../', import.meta.url).href;

  sessionPromise = ort.InferenceSession.create(MODEL_URL, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all'
  }).catch((error: unknown) => {
      sessionPromise = undefined;
      throw new Error(`Unable to load the YuNet model: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
  return sessionPromise;
}

export async function detectFaces(
  image: ImageData,
  options: RedactOptions = {}
): Promise<Detection[]> {
  const session = await loadSession();

  const input = preprocess(image);

  const feeds: Record<string, ort.Tensor> = {
    [session.inputNames[0]]: input
  };

  const outputs = await session.run(feeds);

  const detections = decodeYuNet(
    outputs,
    image.width,
    image.height,
    options.confidenceThreshold ?? 0.6
  );

  return nonMaximumSuppression(
    detections,
    options.nmsThreshold ?? 0.3
  );
}

function preprocess(image: ImageData): ort.Tensor {
  const pixels = image.data;

  const chw = new Float32Array(
    3 * INPUT_SIZE * INPUT_SIZE
  );

  const scaleX = image.width / INPUT_SIZE;
  const scaleY = image.height / INPUT_SIZE;

  const planeSize = INPUT_SIZE * INPUT_SIZE;

  for (let y = 0; y < INPUT_SIZE; y += 1) {
    const sourceY = Math.min(
      image.height - 1,
      Math.floor(y * scaleY)
    );

    for (let x = 0; x < INPUT_SIZE; x += 1) {
      const sourceX = Math.min(
        image.width - 1,
        Math.floor(x * scaleX)
      );

      const source =
        (sourceY * image.width + sourceX) * 4;

      const target =
        y * INPUT_SIZE + x;

      // YuNet expects BGR, NOT RGB.
      // Also: NO /255 normalization.

      chw[target] =
        pixels[source + 2]; // B

      chw[planeSize + target] =
        pixels[source + 1]; // G

      chw[2 * planeSize + target] =
        pixels[source]; // R
    }
  }

  return new ort.Tensor(
    'float32',
    chw,
    [1, 3, INPUT_SIZE, INPUT_SIZE]
  );
}

function decodeYuNet(
  outputs: Record<string, ort.Tensor>,
  width: number,
  height: number,
  threshold: number
): Detection[] {
  const detections: Detection[] = [];

  const strides = [8, 16, 32];

  const scaleX = width / INPUT_SIZE;
  const scaleY = height / INPUT_SIZE;

  for (const stride of strides) {
    const cls = outputs[`cls_${stride}`];
    const obj = outputs[`obj_${stride}`];
    const bbox = outputs[`bbox_${stride}`];

    if (!cls || !obj || !bbox) {
      throw new Error(
        `Missing YuNet outputs for stride ${stride}.`
      );
    }

    const clsData = cls.data as Float32Array;
    const objData = obj.data as Float32Array;
    const bboxData = bbox.data as Float32Array;

    const cols = INPUT_SIZE / stride;
    const rows = INPUT_SIZE / stride;

    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const index = r * cols + c;

        // YuNet clamps both scores to [0, 1]
        const clsScore = Math.max(
          0,
          Math.min(1, clsData[index])
        );

        const objScore = Math.max(
          0,
          Math.min(1, objData[index])
        );

        // Official YuNet confidence calculation
        const score = Math.sqrt(
          clsScore * objScore
        );

        if (score < threshold) {
          continue;
        }

        const offset = index * 4;

        // Official YuNet bounding-box decoding
        const cx =
          (c + bboxData[offset]) * stride;

        const cy =
          (r + bboxData[offset + 1]) * stride;

        const boxWidth =
          Math.exp(bboxData[offset + 2]) * stride;

        const boxHeight =
          Math.exp(bboxData[offset + 3]) * stride;

        const x =
          (cx - boxWidth / 2) * scaleX;

        const y =
          (cy - boxHeight / 2) * scaleY;

        const finalWidth =
          boxWidth * scaleX;

        const finalHeight =
          boxHeight * scaleY;

        detections.push({
          x: Math.max(0, x),
          y: Math.max(0, y),
          width: Math.min(
            finalWidth,
            width - Math.max(0, x)
          ),
          height: Math.min(
            finalHeight,
            height - Math.max(0, y)
          ),
          score
        });
      }
    }
  }

  return detections.filter(
    (box) =>
      box.width > 0 &&
      box.height > 0 &&
      box.score >= threshold
  );
}

function nonMaximumSuppression(detections: Detection[], threshold: number): Detection[] {
  const sorted = [...detections].sort((a, b) => b.score - a.score);
  const kept: Detection[] = [];
  while (sorted.length) {
    const current = sorted.shift()!;
    kept.push(current);
    for (let index = sorted.length - 1; index >= 0; index -= 1) {
      if (intersectionOverUnion(current, sorted[index]) > threshold) sorted.splice(index, 1);
    }
  }
  return kept;
}

function intersectionOverUnion(first: Detection, second: Detection): number {
  const left = Math.max(first.x, second.x);
  const top = Math.max(first.y, second.y);
  const right = Math.min(first.x + first.width, second.x + second.width);
  const bottom = Math.min(first.y + first.height, second.y + second.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = first.width * first.height + second.width * second.height - intersection;
  return union === 0 ? 0 : intersection / union;
}