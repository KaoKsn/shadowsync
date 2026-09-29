/**
 * Main-thread client for the NER worker. Implements the backend interface
 * PIIRedactor.setNerBackend() expects: analyze(texts) -> Promise<entities[][]>.
 *
 *   const ner = new NerClient();
 *   ner.onStatus(s => console.log(s.status, s.progress));   // idle | loading | ready | error
 *   redactor.setNerBackend(ner);
 */
export const DEFAULT_NER_MODEL = 'onnx-community/distilbert-NER-ONNX';

export class NerClient {
  constructor(options = {}) {
    this.options = {
      modelId: DEFAULT_NER_MODEL,
      device: 'wasm',       // 'wasm' | 'webgpu' (falls back to wasm)
      timeoutMs: 30000,     // per batch of ~20 texts
      cacheSize: 500,
      workerUrl: new URL('./ner-worker.js', import.meta.url),
      ...options,
    };
    this.status = 'idle';
    this.backend = null;
    this.error = null;
    this.progress = 0;
    this._listeners = new Set();
    this._pending = new Map();
    this._files = new Map();
    this._cache = new Map();
    this._seq = 0;
    this._ready = null;
    this._worker = null;
  }

  onStatus(fn) {
    this._listeners.add(fn);
    fn(this._snapshot());
    return () => this._listeners.delete(fn);
  }

  get state() {
    return this._snapshot();
  }

  _snapshot() {
    return { status: this.status, backend: this.backend, error: this.error, progress: this.progress };
  }

  _emit() {
    const s = this._snapshot();
    for (const fn of this._listeners) {
      try { fn(s); } catch (e) { /* listener errors must not break the client */ }
    }
  }

  /** Start loading the model (idempotent). Resolves when the model is ready. */
  load() {
    if (this._ready) return this._ready;
    this.status = 'loading';
    this.error = null;
    this._emit();
    this._ready = new Promise((resolve, reject) => {
      this._resolveReady = resolve;
      this._rejectReady = reject;
    });
    try {
      this._worker = new Worker(this.options.workerUrl, { type: 'module' });
    } catch (e) {
      this._fail(e);
      return this._ready;
    }
    this._worker.onmessage = (e) => this._onMessage(e.data);
    this._worker.onerror = (e) => this._fail(new Error(e.message || 'NER worker crashed'));
    this._worker.postMessage({ type: 'init', modelId: this.options.modelId, device: this.options.device });
    return this._ready;
  }

  _fail(err) {
    this.status = 'error';
    this.error = String(err && err.message || err);
    this._emit();
    if (this._rejectReady) this._rejectReady(err);
    for (const { reject, timer } of this._pending.values()) { clearTimeout(timer); reject(err); }
    this._pending.clear();
    if (this._worker) this._worker.terminate();
    this._worker = null;
    this._ready = null; // allow a retry
  }

  _onMessage(msg) {
    if (msg.type === 'progress') {
      if (msg.file && msg.total) this._files.set(msg.file, { loaded: msg.loaded || 0, total: msg.total });
      if (msg.status === 'done' && this._files.has(msg.file)) {
        const f = this._files.get(msg.file);
        f.loaded = f.total;
      }
      let loaded = 0;
      let total = 0;
      for (const f of this._files.values()) { loaded += f.loaded; total += f.total; }
      this.progress = total ? Math.min(1, loaded / total) : 0;
      this._emit();
    } else if (msg.type === 'ready') {
      this.status = 'ready';
      this.backend = msg.backend;
      this.progress = 1;
      this._emit();
      this._resolveReady();
    } else if (msg.type === 'result' || (msg.type === 'error' && msg.id)) {
      const p = this._pending.get(msg.id);
      if (!p) return;
      clearTimeout(p.timer);
      this._pending.delete(msg.id);
      if (msg.type === 'result') p.resolve(msg.results);
      else p.reject(new Error(msg.message));
    } else if (msg.type === 'error') {
      this._fail(new Error(msg.message));
    }
  }

  _cacheSet(text, value) {
    this._cache.delete(text);
    this._cache.set(text, value);
    if (this._cache.size > this.options.cacheSize) this._cache.delete(this._cache.keys().next().value);
  }

  async analyze(texts) {
    await this.load();
    const results = new Array(texts.length);
    const missing = [];
    texts.forEach((t, i) => {
      if (this._cache.has(t)) results[i] = this._cache.get(t);
      else missing.push(i);
    });
    if (missing.length) {
      const id = ++this._seq;
      const timeout = this.options.timeoutMs * Math.max(1, Math.ceil(missing.length / 20));
      const fresh = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this._pending.delete(id);
          reject(new Error('NER request timed out'));
        }, timeout);
        this._pending.set(id, { resolve, reject, timer });
        this._worker.postMessage({ type: 'analyze', id, texts: missing.map(i => texts[i]) });
      });
      missing.forEach((i, k) => {
        results[i] = fresh[k];
        this._cacheSet(texts[i], fresh[k]);
      });
    }
    return results;
  }

  terminate() {
    this._fail(new Error('NER client terminated'));
    this.status = 'idle';
    this.error = null;
    this._emit();
  }
}
