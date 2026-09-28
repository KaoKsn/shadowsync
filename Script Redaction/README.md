# PII Redactor

A client-side, browser-based tool for redacting Personally Identifiable Information (PII) and Protected Health Information (PHI) from both plain text and HTML documents. 

## Features & Architecture

This tool uses a highly accurate **3-pass redaction pipeline** designed for maximum recall (zero leaks) while maintaining high precision (preserving boilerplate text).

### The 3-Pass Pipeline

1. **Pass 1: Structured Label-Value Redaction (HTML Only)**
   - Parses the DOM/HTML to find structured fields (e.g., <span class="label">SSN:</span> <span class="value">...</span>).
   - Maps labels to specific semantic types (Name, DOB, SSN, Address, etc.) to apply targeted redaction.
   - Ensures zero false positives for structured data.

2. **Pass 2: Syntactic Regex Patterns**
   - Applies robust regex patterns against unstructured text.
   - Detects standard formats: Emails, IPv4/IPv6, Phone Numbers (US & International), Credit Cards (with Luhn validation), API Keys, Password Hashes, etc.

3. **Pass 3: Named Entity Recognition (NER) via Compromise.js**
   - A lightweight, in-browser NLP pass using compromise.js.
   - Catches standalone Person Names, Organizations, and Contextual entities that regex patterns miss (e.g., maiden names, hospital names, unstructured prose).
   - Fails gracefully: If the CDN fails to load, Passes 1 & 2 still function perfectly.

## Recent Updates

- **Integrated Compromise.js NER**: Added as Pass 3 to significantly boost recall on unstructured prose, capturing implicit identity references and standalone names.
- **Enhanced Regex Coverage**: Expanded patterns to catch international phone numbers, passport numbers, various API key formats, password hashes (e.g., Argon2), and policy numbers.
- **Fixed 9xx SSN Bug**: Corrected an issue where SSNs starting with 9xx were excluded.
- **Double-Redaction Prevention**: Implemented a placeholder system to ensure tokens redacted in an earlier pass are not inadvertently corrupted by subsequent passes.
- **Minimalist UI**: Cleaned up the user interface for a straightforward, 2-section view (Text vs. HTML file).
- **NER Status Indicator**: Added a real-time badge in the UI header to show if the Compromise.js NER engine is actively loaded and running.

## How to Run

1. Open index.html in any modern web browser.
2. Or run a simple local dev server: python -m http.server 8080 and navigate to http://localhost:8080.

## File Structure

- index.html: The main UI view.
- css/styles.css: Minimalist, clean styling.
- js/pii-redactor.js: The core redaction engine containing the 3-pass logic.
- js/app.js: UI logic, event listeners, and file processing.
