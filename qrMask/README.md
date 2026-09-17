# QR Mask

`qrRedaction(payload, options)` detects QR codes in a screenshot, paints solid black rectangles over them, and returns `Promise<payload>`. A data URL returns a data URL; raw base64 returns raw base64.

The module first checks whether Chrome's `BarcodeDetector` supports `qr_code`. That path detects multiple codes in one pass and uses each result's corner points or bounding box. On Windows/Linux Chrome, `BarcodeDetector` support can be unavailable or can omit QR support, so the module falls back to the bundled `jsQR.min.js`. jsQR returns one code per call; the fallback repeatedly decodes, blacks out the detected region, and retries until no code remains or `maxCodes` is reached.

Options:

```js
{
  padding: 8,
  maxCodes: 10,
  outputMimeType: "image/png",
  outputQuality: 0.92,
  debug: false
}
```

The module never throws through `window.qrRedaction`; failures are logged with `console.warn` and return the original payload unchanged. It has no model, wasm, CDN, or runtime network dependency.

## File CLI

For a direct image-to-image check without the extension or a webpage:

1. Open a terminal in this folder:

  ```text
  Frontend/qrMask/
  ```

2. Install the one-time image dependency:

  ```bash
  npm install
  ```

3. Put one or more `.png`, `.jpg`, `.jpeg`, `.webp`, `.bmp`, or `.gif` files in `input/`.

4. Run:

  ```bash
  npm run mask
  ```

The masked PNG files are written to `output/` with names such as `masked-screenshot.png`.

The command scans up to 10 QR codes per image, expands each mask by 8 pixels, and leaves the original input files unchanged.

## Integration

Add these entries to the extension's `content_scripts[0].js` list, before `content/agent.js`:

```json
"qrMask/jsQR.min.js",
"qrMask/qrRedaction.js",
```

In `content/agent.js`, immediately after the existing face redaction block and before base64 stripping, chain the processed result:

```js
// 6. QR redaction pass on the face-sanitized screenshot
if (typeof window.qrRedaction === 'function') {
  try {
    processedDataUrl = await window.qrRedaction(processedDataUrl);
  } catch (e) {
    console.warn('[PrivSight] QR redaction pass warning:', e);
  }
}
```

The `test/` page is a standalone visual check. Open it from a local web server or extension context so the local scripts and image can load.
