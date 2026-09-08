const DEBUG = false;

const api = typeof browser !== "undefined" ? browser : chrome;

// Listen for the command and trigger capture in content.js
api.commands.onCommand.addListener(async (command) => {
  if (command !== "trigger-capture-and-hints" && command !== "remove-hints") {
    return;
  }

  try {
    // Get the active tab
    const [tab] = await api.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!tab?.id) {
      if (DEBUG) console.warn("Current tab query failed!");
      return;
    }

    // Tell content.js to scan clickables and send data back
    if (command === "trigger-capture-and-hints") {
      await api.tabs.sendMessage(tab.id, {
        action: "TRIGGER_CAPTURE",
      });
    }
    if (command === "remove-hints") {
      await api.tabs.sendMessage(tab.id, {
        action: "REMOVE_HINTS",
      });
    }
  } catch (error) {
    if (DEBUG) {
      console.error("Failed to handle command:", error);
    }
  }
});

api.runtime.onMessage.addListener((message, sender) => {
  if (message.action !== "UPDATE_CLICKABLES") {
    return;
  }

  handleClickableUpdate(message, sender).catch((error) => {
    if (DEBUG) {
      console.error("Error handling clickable update:", error);
    }
  });
});

async function handleClickableUpdate(message, sender) {
  let screenshotData = null;

  const tabId = sender.tab?.id; // sender info to clear hints immediately after screenshot.

  if (!tabId) {
    return;
  }

  // Capture the current tab's screenshot
  try {
    screenshotData = await new Promise((resolve, reject) => {
      api.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
        if (api.runtime.lastError) {
          reject(new Error(api.runtime.lastError.message));
          return;
        }
        resolve(dataUrl);
      });
    });
  } catch (error) {
    // TODO: Decide if Screenshot failure is non-fatal.
    // and if we can continue with a DOM-only payload.
    if (DEBUG) {
      console.warn(
        "Screenshot capture failed, proceeding with DOM-only payload:",
        error,
      );
    }
  } finally {
    // Clear hints immediately after screenshot.
    await api.tabs.sendMessage(tabId, {
      action: "REMOVE_HINTS",
    });
  }

  const payloadPackage = {
    url: message.payload.url,
    dom: message.payload.dom,
    elements: message.payload.elements,
    screenshot: screenshotData,
  };

  // Send DOM, screenshot to the orchestration server
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, 15_000); // 15s timeout

  try {
    const response = await fetch("http://localhost:3000/upload", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payloadPackage),
      signal: controller.signal,
    });

    // Read the response body only once.
    const responseText = await response.text();

    if (!response.ok) {
      if (DEBUG) {
        console.error(
          `Upload failed with status ${response.status}:`,
          responseText,
        );
      }
      return;
    }

    let result;

    try {
      result = JSON.parse(responseText);
    } catch (error) {
      if (DEBUG) {
        console.error(
          "Server returned a successful response, but it was not valid JSON:",
          responseText,
        );
      }
      return;
    }

    if (DEBUG) {
      console.log("LLM Next Action Received:", result);
    }

    // TODO: Send instructions back to content.js to perform the click/action using activeHints map.
  } catch (error) {
    if (error.name === "AbortError") {
      if (DEBUG) {
        console.error("Upload request timed out after 15 seconds.");
      }
    } else if (DEBUG) {
      console.error("Network Error:", error);
    }
  } finally {
    clearTimeout(timeoutId);
  }
}
