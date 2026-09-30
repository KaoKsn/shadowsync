/**
 * Compatibility entry point. The engine now lives in ./redactor/ as ES modules:
 *
 *   import { PIIRedactor } from './pii-redactor.js';
 *   const r = new PIIRedactor({ style: 'token' });
 *   r.redactText(text);                 // sync: regex + checksum + name gazetteer
 *   await r.redactTextAsync(text);      // + NER model when a backend is attached
 *
 * Loading this file with <script type="module"> also exposes window.PIIRedactor.
 */
import { PIIRedactor } from './redactor/index.js';

export { PIIRedactor };
export { NerClient } from './redactor/ner-client.js';
export default PIIRedactor;

if (typeof window !== 'undefined') window.PIIRedactor = PIIRedactor;
