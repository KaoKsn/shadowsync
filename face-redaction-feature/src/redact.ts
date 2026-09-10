import type { Detection } from './types';

export function blackoutFaces(canvas: OffscreenCanvas, detections: Detection[]): void {
  if (detections.length === 0) return;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The browser does not provide a 2D OffscreenCanvas context.');
  context.fillStyle = '#000000';
  for (const detection of detections) {
    context.fillRect(detection.x, detection.y, detection.width, detection.height);
  }
}