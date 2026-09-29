/**
 * NER Web Worker (module worker). Loads a quantized token-classification model with
 * Transformers.js from local files only and answers analyze requests.
 *
 *   in : { type: 'init', modelId, device }            -> progress* then ready | error
 *   in : { type: 'analyze', id, texts: string[] }     -> result { id, results } | error { id }
 */
import { AutoTokenizer, AutoModelForTokenClassification, env } from '../../vendor/transformers/transformers.min.js';
import { runNer } from './ner-core.js';

let tokenizer = null;
let model = null;
let loading = null;

async function load({ modelId, device = 'wasm' }) {
  // Everything comes from the app/extension bundle: no Hugging Face Hub, no CDN.
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.useBrowserCache = false;
  env.localModelPath = new URL('../../models/', import.meta.url).href;
  env.backends.onnx.wasm.wasmPaths = new URL('../../vendor/transformers/', import.meta.url).href;
  env.backends.onnx.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;

  const progress_callback = (p) => {
    if (p.status === 'progress' || p.status === 'done' || p.status === 'initiate') {
      self.postMessage({ type: 'progress', status: p.status, file: p.file, loaded: p.loaded, total: p.total });
    }
  };
  tokenizer = await AutoTokenizer.from_pretrained(modelId, { progress_callback });

  let backend = 'wasm';
  if (device === 'webgpu' && self.navigator.gpu) {
    try {
      model = await AutoModelForTokenClassification.from_pretrained(modelId, { dtype: 'q8', device: 'webgpu', progress_callback });
      backend = 'webgpu';
    } catch (e) {
      model = null; // fall back to WASM below
    }
  }
  if (!model) model = await AutoModelForTokenClassification.from_pretrained(modelId, { dtype: 'q8', device: 'wasm', progress_callback });
  return backend;
}

self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    try {
      loading = loading || load(data);
      const backend = await loading;
      self.postMessage({ type: 'ready', backend });
    } catch (e) {
      loading = null;
      self.postMessage({ type: 'error', message: String(e && e.message || e) });
    }
    return;
  }
  if (data.type === 'analyze') {
    try {
      if (!loading) throw new Error('NER worker not initialised');
      await loading;
      const results = [];
      for (const text of data.texts) results.push(await runNer(tokenizer, model, text));
      self.postMessage({ type: 'result', id: data.id, results });
    } catch (e) {
      self.postMessage({ type: 'error', id: data.id, message: String(e && e.message || e) });
    }
  }
};
