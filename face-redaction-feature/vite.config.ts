import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

function emitWasmRuntime(): Plugin {
  const runtimeDirectory = resolve('node_modules/onnxruntime-web/dist');
  const files = [
    'ort-wasm-simd-threaded.jsep.mjs',
    'ort-wasm-simd-threaded.jsep.wasm',
    'ort-wasm-simd-threaded.mjs',
    'ort-wasm-simd-threaded.wasm'
  ];
  return {
    name: 'emit-onnx-wasm-runtime',
    generateBundle() {
      for (const file of files) {
        this.emitFile({
          type: 'asset',
          fileName: file,
          source: readFileSync(resolve(runtimeDirectory, file))
        });
      }
      this.emitFile({
        type: 'asset',
        fileName: 'face_detection_yunet.onnx',
        source: readFileSync(resolve('models/face_detection_yunet.onnx'))
      });
    }
  };
}

export default defineConfig({
  base: './',
  plugins: [emitWasmRuntime()],
  resolve: {
    conditions: ['onnxruntime-web-use-extern-wasm', 'import', 'default']
  },
  build: {
    lib: {
      entry: 'src/facade.ts',
      formats: ['es'],
      fileName: 'face-redaction'
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: false
      }
    },
    target: 'es2022'
  }
});