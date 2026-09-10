const DEBUG = false;
const api = typeof browser !== "undefined" ? browser : chrome;

// Initialize the DOMRedactor instance
const redactor = new DOMRedactor({
  redactTextNodes: true,
  redactInputs: true,
});

// Configuration for keyboard-based hints for clickable/interactive targets.
const CONFIG = {
  chars: "0123456789",
  selectors:
    "a, button, input, textarea, [role='button'], [tabindex]:not([tabindex='-1'])",
  badgeClass: "llm-hint-badge",
};

let activeHints = new Map();

// Generate Hint strings using base-N encoding.
function generateHintString(index, chars) {
  let hint = "";
  let len = chars.length;

  index += 1;

  while (index > 0) {
    index -= 1;
    hint = chars[index % len] + hint;
    index = Math.floor(index / len);
  }

  return hint;
}

async function createSanitizedIframe(sanitizedDoc) {
  const iframe = document.createElement("iframe");

  iframe.style.position = "fixed";
  iframe.style.left = "-100000px";
  iframe.style.top = "0";
  iframe.style.width = `${window.innerWidth}px`;
  iframe.style.height = `${window.innerHeight}px`;
  iframe.style.opacity = "0";
  iframe.style.pointerEvents = "none";
  iframe.style.border = "0";
  iframe.setAttribute("aria-hidden", "true");

  document.documentElement.appendChild(iframe);

  const iframeDoc = iframe.contentDocument;

  if (!iframeDoc) {
    iframe.remove();
    throw new Error("Could not access sanitized iframe document.");
  }

  // sanitizedDoc is already a clone of the live DOM.
  // We can safely remove scripts from this sanitized copy.
  sanitizedDoc.querySelectorAll("script").forEach((script) => script.remove());

  iframeDoc.replaceChild(
    iframeDoc.importNode(sanitizedDoc.documentElement, true),
    iframeDoc.documentElement,
  );

  await waitForIframeLoad(iframe);

  return iframe;
}
/*
async function createSanitizedIframe(sanitizedDoc) {
  const iframe = document.createElement("iframe");

  iframe.style.position = "fixed";
  iframe.style.left = "-100000px";
  iframe.style.top = "0";
  iframe.style.width = `${window.innerWidth}px`;
  iframe.style.height = `${window.innerHeight}px`;
  iframe.style.opacity = "0";
  iframe.style.pointerEvents = "none";
  iframe.style.border = "0";
  iframe.setAttribute("aria-hidden", "true");

  document.documentElement.appendChild(iframe);

  const iframeDoc = iframe.contentDocument;

  if (!iframeDoc) {
    iframe.remove();
    throw new Error("Could not access sanitized iframe document.");
  }

  // Clone the sanitized DOM again so we can safely remove scripts
  // without modifying sanitizedDoc itself.
  const sanitizedRoot = sanitizedDoc.documentElement.cloneNode(true);

  // Scripts must never execute in our rendering iframe.
  sanitizedRoot.querySelectorAll("script").forEach((script) => script.remove());

  // Build the iframe DOM directly instead of using document.write().
  iframeDoc.replaceChild(
    iframeDoc.importNode(sanitizedRoot, true),
    iframeDoc.documentElement,
  );

  await waitForIframeLoad(iframe);

  return iframe;
}
*/

function waitForIframeLoad(iframe) {
  return new Promise((resolve) => {
    const doc = iframe.contentDocument;

    if (!doc) {
      resolve();
      return;
    }

    if (doc.readyState === "complete") {
      resolve();
      return;
    }

    iframe.addEventListener("load", () => resolve(), {
      once: true,
    });
  });
}

function copyScrollPosition(iframe) {
  try {
    iframe.contentWindow.scrollTo(window.scrollX, window.scrollY);
  } catch (e) {
    // Ignore.
  }
}

// Scan, tag, and collect interactive elements for the LLM payload
async function updateClickables() {
  activeHints.clear();
  const start = performance.now();

  const orgElements = Array.from(
    document.querySelectorAll(CONFIG.selectors),
  ).filter((el) => {
    const rect = el.getBoundingClientRect();

    return (
      rect.width > 0 &&
      rect.height > 0 &&
      window.getComputedStyle(el).visibility !== "hidden"
    );
  });

  let sanitizedIframe = null;

  try {
    const {
      doc: sanitizedDoc,
      html: sanitizedHtml,
      stats,
    } = await redactor.sanitize(document);

    if (DEBUG) {
      console.log("DOM PII Scrubbing Stats:", stats);
    }

    sanitizedIframe = await createSanitizedIframe(sanitizedDoc);

    const sanitizedIframeDoc = sanitizedIframe.contentDocument;

    if (!sanitizedIframeDoc) {
      throw new Error("Sanitized iframe document unavailable.");
    }

    copyScrollPosition(sanitizedIframe);

    activeHints.clear();

    const elements = Array.from(
      sanitizedIframeDoc.querySelectorAll(CONFIG.selectors),
    ).filter((el) => {
      const rect = el.getBoundingClientRect();

      return (
        rect.width > 0 &&
        rect.height > 0 &&
        sanitizedIframe.contentWindow.getComputedStyle(el).visibility !==
          "hidden"
      );
    });

    const payloadElements = [];
    const badgeData = [];

    sanitizedIframeDoc.querySelectorAll("img").forEach((img) => {
      if (img.loading === "lazy") {
        img.loading = "eager";
      }
    });

    elements.forEach((element, index) => {
      const hint = generateHintString(index, CONFIG.chars);

      const orgElement = orgElements[index];

      activeHints.set(hint, orgElement);

      // Add data-hint ONLY to the sanitized clone.
      element.setAttribute("data-hint", hint);
      orgElement.setAttribute("data-hint", hint); // inject the same hint in the live DOM

      // Position relative to the sanitized iframe viewport.
      const rect = element.getBoundingClientRect();

      badgeData.push({
        text: hint.toUpperCase(),

        // Since the iframe represents the page viewport,
        // don't add the parent page's scroll position here.
        top: rect.top,
        left: rect.left,
      });

      payloadElements.push({
        "data-hint": hint,

        tag: element.tagName.toLowerCase(),

        text:
          element.innerText?.trim() ||
          element.value ||
          element.getAttribute("aria-label") ||
          "",

        type: element.type || null,
      });
    });

    const canvas = await html2canvas(sanitizedIframeDoc.body, {
      x: window.scrollX,
      y: window.scrollY,

      width: window.innerWidth,
      height: window.innerHeight,

      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      scale: 1,
      useCORS: true, // avoid losing images.
      logging: false,
    });

    const ctx = canvas.getContext("2d");

    if (ctx) {
      badgeData.forEach((badge) => {
        ctx.fillStyle = "#ffeb3b";
        ctx.strokeStyle = "#fbc02d";
        ctx.lineWidth = 1;

        ctx.fillRect(badge.left, badge.top, 20, 14);

        ctx.strokeRect(badge.left, badge.top, 20, 14);

        ctx.fillStyle = "#000000";
        ctx.font = "bold 10px sans-serif";

        ctx.fillText(badge.text, badge.left + 2, badge.top + 10);
      });
    }

    const screenshotData = canvas.toDataURL("image/png");

    sendToBackground({
      url: window.location.origin,
      elements: payloadElements,
      screenshot: screenshotData,
    });
  } catch (error) {
    if (DEBUG) {
      console.error("Sanitized DOM processing failed:", error);
    }
  } finally {
    // Remove the sanitized DOM.
    if (sanitizedIframe) {
      sanitizedIframe.remove();
    }

    const end = performance.now();

    if (DEBUG) {
      console.log(`Processing complete. Took: ${(end - start).toFixed(2)} ms`);
    }
  }
}

// Send the payload
function sendToBackground(data) {
  try {
    api.runtime.sendMessage({
      action: "UPDATE_CLICKABLES",
      payload: data,
    });
  } catch (error) {
    console.log("Couldn't process this page right now. Please try again.");
  }
}

// Listen for the hotkey trigger from background.js
api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "TRIGGER_CAPTURE") {
    updateClickables().catch((error) => {
      if (DEBUG) {
        console.error("Extension failed to process DOM:", error);
      }
    });
  }
});
