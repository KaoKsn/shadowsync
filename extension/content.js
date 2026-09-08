const api = typeof browser !== "undefined" ? browser : chrome;

// Configuration for keyboard-based hints for clickable/interactive targets.
const CONFIG = {
  chars: "0123456789",
  selectors:
    "a, button, input, textarea, [role='button'], [tabindex]:not([tabindex='-1'])",
  badgeClass: "llm-hint-badge",
};

let activeHints = new Map(); // Maps hint string -> DOM element

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

// Clear existing visual hint badges
function clearHints() {
  document
    .querySelectorAll(`.${CONFIG.badgeClass}`)
    .forEach((el) => el.remove());
  activeHints.clear();
}

// TODO: Alston: sanitize DOM and place $$REDACTED$$ instead of sensitive text info.
function getSanitizedDOM() {
  // NOTE: return in the form of string.
  return '<!doctype html><html lang="en"><head><title>Example Domain</title><link rel="icon" href="data:,"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{background:#eee;width:60vw;margin:15vh auto;font-family:system-ui,sans-serif}h1{font-size:1.5em}div{opacity:0.8}a:link,a:visited{color:#348}</style></head><body><div><h1>Example Domain</h1><p>This domain is for use in documentation examples without needing permission. Avoid use in operations.</p><p><a href="https://iana.org/domains/example">Learn more</a></p></div></body></html>';

  // NOTE: Perform sanitization on a 'clone' and return the redacted clone.
  // Retain the original values in some kind of map and we'll repopulate after screenshot (not to be handled by you)
}

// Scan, tag, and collect interactive elements for the LLM payload
function updateClickables() {
  clearHints();

  const sanitizedDOM = getSanitizedDOM();

  const elements = Array.from(
    document.querySelectorAll(CONFIG.selectors),
  ).filter((el) => {
    const rect = el.getBoundingClientRect();
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      window.getComputedStyle(el).visibility !== "hidden"
    );
  });

  const payloadElements = [];

  elements.forEach((element, index) => {
    const hint = generateHintString(index, CONFIG.chars);
    activeHints.set(hint, element);

    // Add the data-item tag to the element.
    element.setAttribute("data-hint", hint);
    // Create visual badge
    const badge = document.createElement("span");
    badge.className = CONFIG.badgeClass;
    badge.textContent = hint.toUpperCase();
    badge.style.cssText = `
      position: absolute;
      background: #ffeb3b;
      color: #000;
      font-size: 10px;
      font-weight: bold;
      padding: 1px 3px;
      z-index: 2147483647;
      border: 1px solid #fbc02d;
      border-radius: 2px;
      box-shadow: 0 1px 2px rgba(0,0,0,0.2);
      pointer-events: none;
    `;
    // Position badge relative to element
    const rect = element.getBoundingClientRect();
    badge.style.top = `${window.scrollY + rect.top}px`;
    badge.style.left = `${window.scrollX + rect.left}px`;
    document.body.appendChild(badge);

    // Collect metadata for LLM
    payloadElements.push({
      hint: hint,
      tag: element.tagName.toLowerCase(),
      text:
        element.innerText?.trim() ||
        element.value ||
        element.getAttribute("aria-label") ||
        "",
      type: element.type || null,
    });
  });
  // Wait for the hint badges to be painted before requesting the screenshot.
  requestAnimationFrame(() => {
    setTimeout(() => {
      sendToBackground({
        url: window.location.origin,
        dom: sanitizedDOM,
        elements: payloadElements,
      });
    }, 50); // TODO: test if a lesser number can be used.
  });
}

// Send the payload
function sendToBackground(data) {
  try {
    api.runtime.sendMessage({ action: "UPDATE_CLICKABLES", payload: data });
  } catch (error) {
    console.log("Couldn't process this page right now. Please try again.");
  }
}

// Listen for the hotkey trigger from background.js
api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Mark hints and send the payload on Alt+k
  if (message.action === "TRIGGER_CAPTURE") {
    const start = performance.now();

    try {
      updateClickables(); // Scan DOM, badges elements, and send to fastapi backend.
    } catch (e) {
      console.log("Extension failed to process DOM");
    } finally {
      const end = performance.now();
      console.log(`Processing complete. Took: ${(end - start).toFixed(2)} ms`);
    }
  }
  // Clear hints on Alt+c.
  if (message.action === "REMOVE_HINTS") {
    clearHints();
  }
});
