// Configuration for Vimium-style keys and target selectors
const CONFIG = {
  chars: "asdfgqwertzxcvb",
  selectors:
    "a, button, input, textarea, [role='button'], [tabindex]:not([tabindex='-1'])",
  badgeClass: "llm-hint-badge",
};

let activeHints = new Map(); // Maps hint string -> DOM element

// Generate Vimium-style character hints (base-N encoding)
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

  // Send mapped elements to extension background/LLM pipeline
  sendToBackground(payloadElements);
}

function sendToBackground(data) {
  chrome.runtime.sendMessage({ action: "UPDATE_CLICKABLES", payload: data });
}

// Handle dynamic DOM changes automatically using MutationObserver
let debounceTimer;
const observer = new MutationObserver((mutations) => {
  // Ignore mutations caused by our own hint badges to avoid infinite loops
  const isSelfMutation = mutations.every(
    (m) =>
      Array.from(m.addedNodes).some((n) =>
        n.classList?.contains(CONFIG.badgeClass),
      ) ||
      Array.from(m.removedNodes).some((n) =>
        n.classList?.contains(CONFIG.badgeClass),
      ),
  );

  if (isSelfMutation) return;

  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    updateClickables();
  }, 300); // Debounce frequent layout/DOM updates
});

// Initialization
document.addEventListener("DOMContentLoaded", () => {
  updateClickables();
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style", "class", "disabled"],
  });
});
