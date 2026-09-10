import { detectFaces } from './detector';
import { blackoutFaces } from './redact';
import type { ImagePayload, RedactRequest, RedactResponse } from './types';

const workerScope = self as DedicatedWorkerGlobalScope;

workerScope.addEventListener('message', async (event: MessageEvent<RedactRequest>) => {
  try {
    const { id, payload, options } = event.data;
    const normalized = await normalizePayload(payload);
    const detections = await detectFaces(normalized.imageData, options);
    const output = detections.length === 0
      ? payload
      : await renderPayload(normalized.canvas, payload, detections);
    const response: RedactResponse = { id, payload: output };
    const transfers = output instanceof ArrayBuffer ? [output] : [];
    workerScope.postMessage(response, transfers);
  } catch (error) {
    const response: RedactResponse = {
      id: event.data.id,
      error: error instanceof Error ? error.message : `Face redaction failed: ${String(error)}`
    };
    workerScope.postMessage(response);
  }
});

async function normalizePayload(payload: ImagePayload): Promise<{ canvas: OffscreenCanvas; imageData: ImageData }> {
  let source: ImageBitmap | ImageData;
  if (payload instanceof ImageData) {
    source = payload;
  } else {
    const blob = payload instanceof Blob ? payload : new Blob([payload]);
    try {
      source = await createImageBitmap(blob);
    } catch (error) {
      throw new Error(`Unsupported or corrupt image payload: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const width = source instanceof ImageData ? source.width : source.width;
  const height = source instanceof ImageData ? source.height : source.height;
  if (width === 0 || height === 0) throw new Error('Image payload has no pixels.');
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The browser does not provide a 2D OffscreenCanvas context.');
  if (source instanceof ImageData) context.putImageData(source, 0, 0);
  else context.drawImage(source, 0, 0);
  if (source instanceof ImageBitmap) source.close();
  return { canvas, imageData: context.getImageData(0, 0, width, height) };
}

async function renderPayload(canvas: OffscreenCanvas, original: ImagePayload, detections: Parameters<typeof blackoutFaces>[1]): Promise<ImagePayload> {
  blackoutFaces(canvas, detections);
  if (original instanceof ImageData) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The browser does not provide a 2D OffscreenCanvas context.');
    return context.getImageData(0, 0, canvas.width, canvas.height);
  }

  const type = original instanceof Blob && original.type ? original.type : 'image/png';
  const blob = await canvas.convertToBlob({ type });
  return original instanceof Blob ? blob : await blob.arrayBuffer();
}