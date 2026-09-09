const DEBUG = false;
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

// Clear existing visual hint badges.
function clearHints() {
  activeHints.clear(); // free the map.
}

// TODO: Alston: sanitize DOM and place $$REDACTED$$ instead of sensitive text info.
function getSanitizedDOM() {
  // NOTE: return in the form of string.
  return '<!doctype html><html lang="en"><head><title>Example Domain</title><link rel="icon" href="data:,"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{background:#eee;width:60vw;margin:15vh auto;font-family:system-ui,sans-serif}h1{font-size:1.5em}div{opacity:0.8}a:link,a:visited{color:#348}</style></head><body><div><h1>Example Domain</h1><p>This domain is for use in documentation examples without needing permission. Avoid use in operations.</p><p><a href="https://iana.org/domains/example">Learn more</a></p></div></body></html>';

  // NOTE: Perform sanitization on a 'clone' and return the redacted clone.
  // Retain the original values in some kind of map and we'll repopulate after screenshot (not to be handled by you)
}

// Scan, tag, and collect interactive elements for the LLM payload
async function updateClickables() {
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
  const badgeData = [];

  document.querySelectorAll("img").forEach((img) => {
    if (img.loading === "lazy") {
      img.loading = "eager"; // Force immediate load
    }
  });
  elements.forEach((element, index) => {
    const hint = generateHintString(index, CONFIG.chars);
    activeHints.set(hint, element);

    // Add the data-item tag to the element.
    element.setAttribute("data-hint", hint);

    // Position badge relative to element
    const rect = element.getBoundingClientRect();
    // Save the position of the hint in memory.
    badgeData.push({
      text: hint.toUpperCase(),
      top: window.scrollY + rect.top,
      left: window.scrollX + rect.left,
    });

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

  try {
    // Generate screenshot cleanly in memory without flashing DOM badges
    const canvas = await html2canvas(document.body, {
      x: window.scrollX,
      y: window.scrollY,
      width: window.innerWidth, // Just capture the view of the user. fullWidth, 0, 0 => innerWidth, scroll[XY]
      height: window.innerHeight,
      windowWidth: document.documentElement.clientWidth,
      windowHeight: document.documentElement.clientHeight,
      scale: 1, // enforce a strict 1:1 pixel ratio.
      useCORS: true, // solves image missing problems.
      logging: false,
    });

    const ctx = canvas.getContext("2d");

    // Programmatically paint visual badges directly onto the image buffer
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

    const screenshotData = canvas.toDataURL("image/png");

    // Send the screenshot to service worker.
    sendToBackground({
      url: window.location.origin,
      elements: payloadElements,
      screenshot: screenshotData,
    });
  } catch (error) {
    if (DEBUG) console.log("Canvas Screenshot generation Failed!", error);
  }
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
});
