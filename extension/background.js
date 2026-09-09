const DEBUG = false;

const api = typeof browser !== "undefined" ? browser : chrome;
const server_url = "http://localhost:3000/upload";

// Listen for the command and trigger capture in content.js
api.commands.onCommand.addListener(async (command) => {
  if (command !== "trigger-capture-and-hints") {
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
  uploadPayload(message.payload);
});

async function uploadPayload(payloadPackage) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000); // 15s timeout.

  try {
    const response = await fetch(server_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payloadPackage),
      signal: controller.signal,
    });
    const responseText = await response.text();
    if (!response.ok) return;

    const result = JSON.parse(responseText);
    if (DEBUG) console.log("LLM Next Action Received:", result);
  } catch (error) {
    if (DEBUG) {
      if (error.name !== "AbortError")
        console.log("Network Error: ", error, " .\nPayload send failed");
      else console.log("Timed out!");
    }
  } finally {
    clearTimeout(timeoutId);
  }
}
