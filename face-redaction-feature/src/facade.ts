import type { ImagePayload, RedactOptions, RedactRequest, RedactResponse } from './types';
export type { ImagePayload, RedactOptions } from './types';

export class FaceRedactor {
  private readonly worker: Worker;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (payload: ImagePayload) => void; reject: (error: Error) => void }>();

  constructor() {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.addEventListener('message', (event: MessageEvent<RedactResponse>) => this.handleResponse(event.data));
  }

  redact(payload: ImagePayload, options?: RedactOptions): Promise<ImagePayload> {
    const id = this.nextId++;
    const request: RedactRequest = { id, payload, options };
    const transferables: Transferable[] = payload instanceof ArrayBuffer ? [payload] : [];
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage(request, transferables);
    });
  }

  dispose(): void {
    this.worker.terminate();
    for (const { reject } of this.pending.values()) reject(new Error('FaceRedactor was disposed.'));
    this.pending.clear();
  }

  private handleResponse(response: RedactResponse): void {
    const request = this.pending.get(response.id);
    if (!request) return;
    this.pending.delete(response.id);
    if (response.error) request.reject(new Error(response.error));
    else if (response.payload === undefined) request.reject(new Error('Worker returned no image payload.'));
    else request.resolve(response.payload);
  }
}