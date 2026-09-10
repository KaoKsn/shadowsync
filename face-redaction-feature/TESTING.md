# Testing the Image Redaction Pipeline

Run these commands from the `face-redaction-feature/` directory.

## Install dependencies

```bash
npm install
npx playwright install chromium
```

The Playwright Chromium browser is required by the image-folder test runner.

## Run the test

Place supported source images (`.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`, or
`.bmp`) in `input/`. The `input/` folder is the source image folder.

Build the project before running the image test:

```bash
npm run build
npm run test-images
```

`npm run test-images` starts a local test server, launches headless
Playwright/Chromium, and processes each image in `input/`. Generated redacted
images are written to `output/` with their original filenames. The `output/`
folder is the generated redacted-image folder.

## Processing details

The test runner hosts the existing `FaceRedactor` pipeline in Chromium. Face
detection uses the YuNet model through ONNX Runtime WebAssembly, and image
processing runs through the Web Worker. Detected faces are blacked out in the
generated images.

The local test server sends these headers on the runner and served assets so
the worker and WebAssembly pipeline can run in the required cross-origin
isolated context:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```