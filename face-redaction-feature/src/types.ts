export type ImagePayload = ArrayBuffer | Blob | ImageData;

export interface RedactOptions {
  confidenceThreshold?: number;
  nmsThreshold?: number;
}

export interface RedactRequest {
  id: number;
  payload: ImagePayload;
  options?: RedactOptions;
}

export interface RedactResponse {
  id: number;
  payload?: ImagePayload;
  error?: string;
}

export interface Detection {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
}