# ShadowSync face redaction

This package is a browser-native, DOM-free face redaction module. It accepts an `ArrayBuffer`, `Blob`, or `ImageData`, performs YuNet inference and permanent black pixel redaction in a worker, then resolves with the same payload type.

```ts
import { FaceRedactor } from './dist/face-redaction.js';

const redactor = new FaceRedactor();
const redacted = await redactor.redact(imagePayload, {
  confidenceThreshold: 0.6,
  nmsThreshold: 0.4
});
redactor.dispose();
```

Place the vendored `face_detection_yunet.onnx` file in `models/`. The Vite build emits the model as an extension-bundled asset and copies the ONNX Runtime Web WASM assets. The worker attempts WebGPU first and falls back to the SIMD/threaded WASM provider; no runtime network request is made.

An `ArrayBuffer` or `Blob` containing an encoded image is returned in the corresponding type. `ImageData` is returned as `ImageData`. When no faces are detected, the original payload is returned unchanged.# shadowsync
SIH'26
