/**
 * One-time setup for the local NER layer (nothing is fetched at runtime):
 *   1. copies Transformers.js (web build) + ONNX Runtime WASM files into ./vendor/transformers/
 *   2. downloads the quantized NER model into ./models/<repo-id>/
 *
 *   node scripts/fetch-model.mjs                                  # default model
 *   node scripts/fetch-model.mjs --model=Xenova/bert-base-NER     # another model
 */
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_MODEL = 'onnx-community/distilbert-NER-ONNX';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
const model = args.model || DEFAULT_MODEL;

// 1. Vendor the browser runtime
const dist = join(root, 'node_modules', '@huggingface', 'transformers', 'dist');
if (!existsSync(dist)) {
  console.error('Run `npm install` first (needs @huggingface/transformers).');
  process.exit(1);
}
const vendorDir = join(root, 'vendor', 'transformers');
mkdirSync(vendorDir, { recursive: true });
// transformers.min.js bundles onnxruntime-web; the *.web.* builds import it as a bare module (bundlers only)
for (const f of ['transformers.min.js', 'ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm']) {
  copyFileSync(join(dist, f), join(vendorDir, f));
  console.log(`vendored ${f}`);
}

// 2. Download the model files
const FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'onnx/model_quantized.onnx'];
const OPTIONAL = new Set(['special_tokens_map.json']);
const modelDir = join(root, 'models', ...model.split('/'));
for (const file of FILES) {
  const dest = join(modelDir, file);
  if (existsSync(dest) && statSync(dest).size > 0) { console.log(`have ${model}/${file}`); continue; }
  const url = `https://huggingface.co/${model}/resolve/main/${file}`;
  const res = await fetch(url);
  if (!res.ok) {
    if (OPTIONAL.has(file)) { console.log(`skip ${file} (${res.status})`); continue; }
    console.error(`Failed to download ${url}: ${res.status}`);
    process.exit(1);
  }
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  console.log(`downloaded ${model}/${file} (${(statSync(dest).size / 1e6).toFixed(1)} MB)`);
}
console.log(`\nNER ready: models/${model}`);
