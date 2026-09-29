# PII Redactor

A client-side PII/PHI redaction engine for plain text and HTML/DOM. Everything runs **locally in the browser**. The ML model and its runtime are bundled files, and nothing is fetched from a CDN or the Hugging Face Hub at runtime, so the engine can ship inside a browser extension.

## How it works: hybrid, span-based pipeline

```
normalize (NFKC, strip zero-width chars, keep an offset map)
  → detectors ─ regex + checksum/structure validators          (patterns.js, validators.js)
              ─ high-entropy secrets (unknown API keys / tokens)  (patterns.js)
              ─ "Label: value" fields in text                    (fields.js)
              ─ DOM structure: form hints (autocomplete / input type), tables,
                <dl>, <label for>, .label/.value, inputs          (dom.js)
              ─ column inference for HTML tables and CSV/TSV text (columns.js)
              ─ name gazetteer + cues (Mr/Dr/Smt, S/o, "husband,")  (names.js)
              ─ NER model (DistilBERT-NER, int8 ONNX, Web Worker)  (ner-*.js)
  → context scoring (keywords near a match raise or lower confidence)
  → allow list removes / deny list adds
  → resolve overlaps (same-type union, container wins, then score)
  → sensitivity threshold → propagate confirmed names → render once
```

Every entity carries `reasons` explaining its score, for example `Verhoeff checksum passed; context 'aadhaar' +0.15` or `column inference: 4/5 cells are NAME`. The test page shows them in the "Why" column and on hover.

### Structural signals besides the text
- **Form hints:** `autocomplete="email | tel | name | family-name | street-address | postal-code | bday | cc-number | cc-csc | one-time-code | …"` and `type="email | tel | password"` mark a field's value directly. These are the most precise signals available, and only a browser-side redactor can use them.
- **Column inference:** when 60% or more of a column's cells (at least 3) are confidently one type, the whole column is treated as that type. The rule catches a name the model missed or an oddly formatted phone number in the same column. It works for HTML tables and for pasted CSV/TSV/pipe text. For CSV, a header row like `name,phone` is used as a label.
- **Entropy secrets:** a 20+ character token with lower case, upper case and digits and ≥ 3.5 bits/char of Shannon entropy is flagged as a `SECRET`, as are shorter tokens next to *key / token / secret / password*. UUIDs, URL paths, and anything near *id / hash / sha / commit* are skipped.

### Allow and deny lists
```js
redactor.analyzeText(text, {
  allow: ['HDFC Bank', /INV-\d+/],                       // never redact (whole-word, case-insensitive)
  deny: ['Project Falcon', { value: /EMP-\d{5}/, type: 'EMPLOYEE_ID' }], // always redact
});
```
- An allow entry suppresses any detection that lies entirely inside a match.
- The deny list wins over the allow list.
- On the test page, both lists are under **Allow / deny lists**, one entry per line. Use `/regex/` for patterns and a `TYPE:` prefix for the deny list. They're saved in this browser only.

Every detector returns candidate spans `{start, end, type, score, source}`. Nothing edits the text until the final render, so the order detectors run in doesn't matter and one detector can't corrupt another's output.

### Why checksums matter
| Type | Validation |
|---|---|
| Aadhaar (12 digits) / VID (16) | Verhoeff check digit; Aadhaar can't start with 0/1 |
| Credit/debit cards (incl. RuPay) | Luhn + known IIN ranges |
| GSTIN | state code + embedded PAN + mod-36 check character |
| IMEI | Luhn (only near device/IMEI context) |
| PAN, IFSC, UPI, JWT, IPv4, dates | strict structure (PAN holder-type letter, known UPI handles, JWT header must decode, real calendar dates) |

"Weak" formats (bank account digits, PIN codes, passport, voter ID, DOB, generic phone) are redacted only when a context word appears nearby. Words like *order, invoice, version, SKU* push the score down. That is how `Order ID 234567812347` and `version 10.2.3.4` survive, while a real Aadhaar and a server IP are redacted.

### NER layer
- The model is [`onnx-community/distilbert-NER-ONNX`](https://huggingface.co/onnx-community/distilbert-NER-ONNX), int8, **65.8 MB**, CoNLL labels PER/ORG/LOC/MISC.
- It runs through [Transformers.js](https://github.com/huggingface/transformers.js) in a module **Web Worker** (`js/redactor/ner-worker.js`) on the WASM backend by default. WebGPU is optional.
- Transformers.js does not return character offsets, so `ner-core.js` aligns sub-word tokens back to the text and decodes the BIO tags itself.
- **Fusion rules:**
  - A PER hit at score ≥ 0.80 becomes NAME.
  - A hit at 0.6–0.8 counts only if the gazetteer or a cue agrees.
  - Single words that are also common English words ("Bill", "Grace") need that agreement too.
  - Label words ("Aadhaar") and sign-offs ("Regards") are ignored.
- If the model is missing or fails, the pipeline keeps working with the rules alone and reports `nerUsed: false`.

## Setup & run

```bash
cd "Script Redaction"
npm install
npm run setup:ner          # vendors Transformers.js + ORT WASM, downloads the model (~66 MB, once)
python -m http.server 8080 # ES modules and workers need http://, not file://
# open http://localhost:8080
```

Without `setup:ner`, the page still works using regex, checksums and the gazetteer, and the badge shows **NER: Offline**.

## API

```js
import { PIIRedactor, NerClient } from './js/pii-redactor.js';

const redactor = new PIIRedactor({ style: 'token', sensitivity: 'balanced' });
redactor.setNerBackend(new NerClient());          // optional

redactor.redactText(text);                        // sync string, no ML
redactor.analyzeText(text);                       // sync { output, entities }
await redactor.redactTextAsync(text);             // { output, entities, nerUsed }
await redactor.redactHTMLAsync(htmlStringOrNode); // same for HTML / DOM (clone unless inPlace)
```

Options:
- `style`: `token | blackout | mask`
- `sensitivity`: `low | balanced | high`
- `types` / `exclude`: arrays of entity types to include or skip
- `allow` / `deny`: see above
- `names`: gazetteer name detection
- `propagate`: redact other mentions of confirmed names
- `ner: { enabled, labels: ['PER'], minScore: 0.8 }`
- `inPlace`: for DOM input

## Measuring quality

```bash
npm test                    # validator + feature tests (form hints, columns, allow/deny, entropy, explanations)
npm run eval                # tuning corpus: recall per type, keep rate, every leak
npm run eval:holdout        # held-out corpus: don't tune detectors against it
npm run eval:baseline       # the original regex + Compromise.js engine, for comparison
node test/eval.mjs --no-ner # rules only
NER_MODEL=Xenova/bert-base-NER node test/eval.mjs   # compare models
```

- **Recall** means a labeled value no longer appears in the output text, in the raw HTML, or in any attribute.
- **Keep rate** means hard negatives (order IDs, version numbers, SKUs, "Mr. Right", "Hope and Joy") survive.

### Current results (synthetic corpora, token style, balanced sensitivity)

| Engine | Tuning corpus (38 samples, 85 entities) | Held-out (18 samples, 51 entities) |
|---|---|---|
| Legacy regex + Compromise.js | 58.8% recall · 86.3% keep | 29.4% recall · 96.5% keep |
| New, rules only (`--no-ner`) | 100% · 100% | 92.2% · 100% |
| New + DistilBERT-NER (65.8 MB) | 100% · 100% | **98.0% · 100%** |
| New + BERT-base-NER (109 MB) | 100% · 100% | 96.1% · 98.2% (measured before the last NER fixes) |

Caveats:
- Both corpora are small and synthetic.
- The held-out set was used once to find three general fixes: parenthesized STD-code landlines, NER spans crossing line breaks, and email-handle corroboration. It is no longer fully blind, so add fresh held-out samples before trusting the numbers.
- Known misses: names the model scores low with no other signal (e.g. "Chen Wei" at 0.47), and short snippets where the model has little context.

## File structure

- `index.html`, `js/app.js`, `css/styles.css`: the test UI. Output is highlighted, and hovering a highlight shows its type, score and which detectors found it. Uploaded HTML is previewed in sandboxed iframes, so its scripts never run.
- `js/pii-redactor.js`: compatibility entry point that re-exports the engine.
- `js/redactor/`: the engine (`index.js` orchestrator, `patterns.js`, `validators.js`, `fields.js`, `names.js`, `columns.js`, `dom.js`, `resolve.js`, `render.js`, `normalize.js`, `ner-core.js`, `ner-worker.js`, `ner-client.js`, `data/names.js`).
- `scripts/fetch-model.mjs`: one-time model and runtime setup. `models/` and `vendor/` are gitignored.
- `test/`: corpora, eval harness, unit tests, and a frozen copy of the legacy engine.

## Browser-extension notes (for later integration)
- MV3 forbids remotely hosted code. Bundle `vendor/` and `models/` in the extension and keep `allowRemoteModels = false`, as the worker already does.
- The extension CSP must allow WASM: `"content_security_policy": { "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'" }`.
- Run the worker from an extension page or an offscreen document. Content scripts can't create extension-origin workers, and MV3 service workers have no `DOMParser`.

## Planned (not implemented): custom recognizers from config

> **Status:** design only. Build this when the script redactor is integrated into the main project, where users will define recognizers through the frontend. Nothing below exists in the code yet.

### Goal
Users (or an org admin) define their own PII types from the UI, such as employee IDs, customer numbers or internal project codes. Each type is **data** (a pattern, keywords, context words and a confidence), not code. This follows Presidio's "ad-hoc recognizers" and Grepture's "custom patterns".

The allow/deny lists we have today cover the simple case: exact strings or a regex that is always redacted. A custom recognizer adds context scoring, validation and sensitivity handling, like the built-in detectors.

### How it maps onto the current engine
The built-in detectors in `js/redactor/patterns.js` already have this shape: `type, re, group, score, validate, invalidScore, requires, boost, boostBy, penalize, window`. A custom recognizer is a JSON version of the same object. The plan:

1. Add a `recognizers: [...]` option to `PIIRedactor`, next to `allow` / `deny`.
2. Add `compileRecognizer(json)` (new file, e.g. `js/redactor/custom.js`). It turns JSON into a pattern object: builds the `RegExp` (or a whole-word regex from a keyword list), maps `validator` to a function from `validators.js`, and copies the context lists.
3. Have `runPatterns()` iterate over `[...PATTERNS, ...compiledCustom]`. Everything downstream already works unchanged: context scoring, the sensitivity threshold, overlap resolution, allow/deny, explanations, and rendering.
4. Explanations should say `custom recognizer 'Employee ID' (v3)` so users can tell their rules apart from built-in ones.

### Proposed JSON schema
```jsonc
{
  "id": "emp-id",                    // stable id, used for versioning and audit
  "name": "Employee ID",             // shown in the UI and in explanations
  "type": "EMPLOYEE_ID",             // tag used in output: [REDACTED_EMPLOYEE_ID]
  "enabled": true,
  "version": 3,

  // Exactly one of pattern / keywords:
  "pattern": "EMP-\\d{5}",           // regex source, no slashes or flags
  "flags": "i",                      // optional; 'g' is always added by the engine
  "keywords": ["Project Falcon", "Project Orion"],  // literal terms (whole-word, case-insensitive)

  "validator": "none",               // one of a fixed list, see below. Never user code
  "score": 0.8,                      // base confidence 0-1 (UI: Low 0.4 / Medium 0.6 / High 0.8 / Always 0.99)
  "context": {
    "requires": [],                  // must appear nearby, otherwise no match (for weak formats)
    "boost": ["employee", "emp", "staff"],  // +0.15 when nearby
    "penalize": ["order", "invoice"]        // -0.5 when nearby
  },
  "window": 40,                      // characters of context to look at before the match
  "examples": {                      // saved with the rule, run as tests on save
    "match": ["Employee EMP-00931 joined"],
    "noMatch": ["Order EMP-TEST"]
  }
}
```

### Validators users can pick (fixed list, no custom code)
`none`, `luhn`, `verhoeff`, `aadhaar`, `pan`, `gstin`, `ifsc`, `indianMobile`, `pincode`, `date`, `ipv4`, `email`, and `digitsBetween(min, max)`. They map to the existing functions in `validators.js`. **Never** accept JavaScript from users: it would be code execution inside the extension, and MV3 forbids `eval` anyway.

### Frontend (main project) — what the form needs
- **Name** and **type tag**. The tag must be uppercase with `_`, and must not clash with built-in types unless the rule deliberately extends one.
- **Match by**: a simple mode with a keyword list, or an advanced mode with a regex. Offer templates such as "letters + digits", "prefix + N digits" and "exact words" so most users never write regex.
- **Validator** dropdown, **confidence** (Low / Medium / High / Always), and **context words** as three tag inputs (must have / boosts / lowers).
- **Live test box**: paste sample text and see highlights with the same explanations the test page shows (`reasons`). Save the samples as `examples`.
- **Enable/disable toggle** and version history.

### Safety and validation (on save, and again in the engine)
- **Compile check**: reject invalid regexes with a readable error.
- **ReDoS protection**: a user regex can hang the page. Cap the pattern length at around 300 characters. Reject nested quantifiers such as `(a+)+` and `(.*)*` and backreferences. Run a quick timing test against a long sample string. Custom recognizers should run in the worker (or a dedicated worker) so a bad pattern can't freeze the page.
- **Over-matching guard**: reject patterns that match empty strings or common text (e.g. `.*`, `\w+`), and warn when a rule matches more than N% of a sample page.
- **Limits**: a maximum number of recognizers per user or org, and a maximum number of keywords per recognizer.
- **The examples must pass** (`match` matches, `noMatch` doesn't) before the rule can be enabled.

### Storage and sync
- Store rules per user or org in the main project's backend and sync them to the extension (e.g. `chrome.storage`). Detection still runs locally; only the rule definitions are synced.
- Version every change and record the rule `id@version` with each redaction for audits.
- Precedence: **deny list > custom recognizers > built-in detectors > allow list suppression**. Overlaps between custom and built-in results go through the normal resolver (score, then length).

### Testing when it's built
- Unit tests for `compileRecognizer` (valid and invalid JSON, a ReDoS pattern is rejected, the validator mapping works).
- Add a `recognizers` field to eval corpus samples so `test/eval.mjs` can score custom types the same way as built-in ones.
