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

// Scan, tag, and collect interactive elements for the LLM payload
function updateClickables() {
  clearHints();

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
