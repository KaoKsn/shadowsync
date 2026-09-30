/**
 * NER backend for Node (eval harness). Mirrors the browser worker: same model files,
 * same local-only loading, same ner-core.js alignment/decoding.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AutoTokenizer, AutoModelForTokenClassification, env } from '@huggingface/transformers';
import { runNer } from '../js/redactor/ner-core.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export async function createNodeNer({ model = process.env.NER_MODEL || 'onnx-community/distilbert-NER-ONNX' } = {}) {
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = join(root, 'models') + '/';
  const tokenizer = await AutoTokenizer.from_pretrained(model);
  const net = await AutoModelForTokenClassification.from_pretrained(model, { dtype: 'q8' });
  return {
    model,
    async analyze(texts) {
      const out = [];
      for (const t of texts) out.push(await runNer(tokenizer, net, t));
      return out;
    },
  };
}
