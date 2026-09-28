document.addEventListener('DOMContentLoaded', () => {

  // ============================================================
  // NER STATUS: Monitor Compromise.js loading from CDN
  // ============================================================
  const nerBadge = document.getElementById('ner-status');
  const nerInlineText = document.getElementById('ner-inline-text');
  const nerInlineHtml = document.getElementById('ner-inline-html');

  function setNerStatus(active) {
    if (active) {
      nerBadge.textContent = 'NER: Active';
      nerBadge.className = 'ner-badge ner-active';
      nerInlineText.textContent = '+ NER';
      nerInlineText.className = 'ner-inline ner-active';
      nerInlineHtml.textContent = '+ NER';
      nerInlineHtml.className = 'ner-inline ner-active';
    } else {
      nerBadge.textContent = 'NER: Offline';
      nerBadge.className = 'ner-badge ner-offline';
      nerInlineText.textContent = '';
      nerInlineHtml.textContent = '';
    }
  }

  // Compromise.js fires these events via the onload/onerror attributes in index.html
  document.addEventListener('compromise-ready', () => setNerStatus(true));
  document.addEventListener('compromise-failed', () => setNerStatus(false));
  // If it was already loaded before DOMContentLoaded (cached)
  if (window._compromiseLoaded === true) setNerStatus(true);
  else if (window._compromiseLoaded === false) setNerStatus(false);

  // ============================================================
  // SECTION 1: TEXT REDACTION
  // ============================================================
  const textInput = document.getElementById('text-input');
  const textOutput = document.getElementById('text-output');
  const textStyle = document.getElementById('text-style');
  const btnRedactText = document.getElementById('btn-redact-text');

  function runTextRedaction() {
    const raw = textInput.value;
    if (!raw) { textOutput.value = ''; return; }
    const redactor = new PIIRedactor({ style: textStyle.value });
    textOutput.value = redactor.redactText(raw);
  }

  btnRedactText.addEventListener('click', runTextRedaction);
  textStyle.addEventListener('change', runTextRedaction);

  // ============================================================
  // SECTION 2: HTML FILE REDACTION
  // ============================================================
  const htmlUpload = document.getElementById('html-upload');
  const htmlStyle = document.getElementById('html-style');
  const origIframe = document.getElementById('orig-iframe');
  const redactedIframe = document.getElementById('redacted-iframe');
  const origCode = document.getElementById('orig-code');
  const redactedCode = document.getElementById('redacted-code');
  const btnDownloadHtml = document.getElementById('btn-download-html');
  const toggleOrigCode = document.getElementById('toggle-orig-code');
  const toggleRedactedCode = document.getElementById('toggle-redacted-code');

  let currentRawHtml = '';
  let currentRedactedHtml = '';
  let uploadedFileName = 'redacted.html';

  function renderIframe(iframe, htmlContent) {
    const doc = iframe.contentDocument || iframe.contentWindow.document;
    doc.open();
    doc.write(htmlContent);
    doc.close();
  }

  function processHtmlFile() {
    if (!currentRawHtml) return;

    // Show original
    renderIframe(origIframe, currentRawHtml);
    origCode.value = currentRawHtml;

    // Run the 3-pass redaction pipeline
    const redactor = new PIIRedactor({ style: htmlStyle.value });
    currentRedactedHtml = redactor.redactHTML(currentRawHtml);

    // Display result
    renderIframe(redactedIframe, currentRedactedHtml);
    redactedCode.value = currentRedactedHtml;
    btnDownloadHtml.style.display = 'inline-block';
  }

  htmlUpload.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    uploadedFileName = file.name
      ? file.name.replace(/\.html?$/i, '') + '-redacted.html'
      : 'redacted.html';
    const reader = new FileReader();
    reader.onload = (event) => {
      currentRawHtml = event.target.result;
      processHtmlFile();
    };
    reader.readAsText(file);
  });

  htmlStyle.addEventListener('change', processHtmlFile);

  // Download redacted HTML
  btnDownloadHtml.addEventListener('click', () => {
    if (!currentRedactedHtml) return;
    const blob = new Blob([currentRedactedHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = uploadedFileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  // Toggle between preview and raw code view
  toggleOrigCode.addEventListener('click', () => {
    const showingCode = origCode.style.display !== 'none';
    origCode.style.display = showingCode ? 'none' : 'block';
    origIframe.style.display = showingCode ? 'block' : 'none';
    toggleOrigCode.textContent = showingCode ? 'View Code' : 'View Preview';
  });

  toggleRedactedCode.addEventListener('click', () => {
    const showingCode = redactedCode.style.display !== 'none';
    redactedCode.style.display = showingCode ? 'none' : 'block';
    redactedIframe.style.display = showingCode ? 'block' : 'none';
    toggleRedactedCode.textContent = showingCode ? 'View Code' : 'View Preview';
  });
});
