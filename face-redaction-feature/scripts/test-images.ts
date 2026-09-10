import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { extname, join, normalize, relative, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { access } from 'node:fs/promises';

const projectRoot = resolve(import.meta.dirname, '..');
const inputDirectory = join(projectRoot, 'input');
const outputDirectory = join(projectRoot, 'output');
const supportedExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);

const contentTypes: Record<string, string> = {
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
};

await access(join(projectRoot, 'dist', 'face-redaction.js')).catch(() => {
  throw new Error('The production bundle is missing. Run `npm run build` before `npm run test-images`.');
});

await mkdir(outputDirectory, { recursive: true });
const imageNames = (await readdir(inputDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && supportedExtensions.has(extname(entry.name).toLowerCase()))
  .map((entry) => entry.name)
  .sort();

if (imageNames.length === 0) {
  console.log(`No supported images found in ${inputDirectory}`);
  process.exit(0);
}

const server = createStaticServer();
await new Promise<void>((resolveServer) => server.listen(0, '127.0.0.1', resolveServer));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Unable to start the local test server.');

const browser = await chromium.launch({
  headless: true,
  args: ['--disable-gpu']
});
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${address.port}/runner`, { waitUntil: 'load' });

  for (const imageName of imageNames) {
    const extension = extname(imageName).toLowerCase();
    const input = Array.from(await readFile(join(inputDirectory, imageName)));
    console.log(`Processing: ${imageName}`);
    const start = performance.now();
    const output = await page.evaluate(async ({ bytes, type }) => {
      const modulePath = '/dist/face-redaction.js';
      const module = await import(modulePath);
      const redactor = new module.FaceRedactor();
      try {
        const result = await redactor.redact(new Blob([new Uint8Array(bytes)], { type }));
        return new Uint8Array(await result.arrayBuffer());
      } finally {
        redactor.dispose();
      }
    }, { bytes: input, type: contentTypes[extension] });
    const elapsed = performance.now() - start;

    await writeFile(join(outputDirectory, imageName), output);
    console.log(`Completed: ${imageName}`);
    console.log(`Time taken: ${elapsed.toFixed(2)} ms`);
  }
} finally {
  await browser.close();
  await new Promise<void>((resolveServer) => server.close(() => resolveServer()));
}

function createStaticServer() {
  return createServer(async (request: IncomingMessage, response: ServerResponse) => {
    try {
      if (request.url === '/runner') {
        response.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Embedder-Policy': 'require-corp'
        });
        response.end('<!doctype html><title>Face redaction test runner</title>');
        return;
      }

      const requestPath = decodeURIComponent((request.url ?? '/').split('?')[0]);
      const filePath = resolve(projectRoot, `.${normalize(requestPath)}`);
      const rootRelativePath = relative(projectRoot, filePath);
      if (rootRelativePath.startsWith(`..${sep}`) || rootRelativePath === '..') {
        response.writeHead(403);
        response.end();
        return;
      }

      const body = await readFile(filePath);
      response.writeHead(200, {
        'Content-Type': contentTypeFor(filePath),
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp'
      });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
}

function contentTypeFor(filePath: string): string {
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.mjs')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.wasm')) return 'application/wasm';
  if (filePath.endsWith('.onnx')) return 'application/octet-stream';
  return 'application/octet-stream';
}