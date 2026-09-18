const DEBUG = false;

const api = typeof browser !== "undefined" ? browser : chrome;

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
  return JSON.stringify(message.payload);
});
