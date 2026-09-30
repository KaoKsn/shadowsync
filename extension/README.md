# 🛡️ PrivSight — Privacy-Preserving Browser Agent

> A complete, beginner-friendly explanation of what this project is, why it exists, how it was built, and how every single part of it works — written so you can explain it confidently in any interview.

---

## Table of Contents

1. [What is PrivSight?](#1-what-is-privsight)
2. [The Problem We Are Solving](#2-the-problem-we-are-solving)
3. [How PrivSight Solves It](#3-how-privsight-solves-it)
4. [What is a Chrome Extension?](#4-what-is-a-chrome-extension)
5. [Project File Structure](#5-project-file-structure)
6. [File-by-File Explanation](#6-file-by-file-explanation)
7. [The Aurora Overlay — Full Explanation](#7-the-aurora-overlay--full-explanation)
8. [How All the Files Talk to Each Other](#8-how-all-the-files-talk-to-each-other)
9. [The Full User Flow Step by Step](#9-the-full-user-flow-step-by-step)
10. [Interview Q&A — Every Question You May Be Asked](#10-interview-qa--every-question-you-may-be-asked)
11. [How to Load and Test the Extension](#11-how-to-load-and-test-the-extension)

---

## 1. What is PrivSight?

PrivSight is a **Google Chrome browser extension** that acts as a privacy-first AI assistant.

Think of it like this — imagine you hired a personal assistant to help you browse the web. You want them to:
- Fill out forms for you
- Summarize articles
- Find information on a page

But you do NOT want them to write down your credit card number, your email, your passwords, or your personal details and hand that over to someone else.

**That is exactly what PrivSight does.** It acts as a smart, privacy-respecting middleman between your browser and any AI model.

---

## 2. The Problem We Are Solving

Modern AI tools (like ChatGPT, Gemini, etc.) are being connected to browsers so they can "browse the web" on your behalf. The way most of them work today is:

```
Your Webpage (with ALL your private data)
         ↓
Sent directly to the AI server in the cloud
         ↓
AI reads everything — your emails, passwords, names, credit cards
```

This is a **massive privacy risk**. The AI sees everything on the page — not just what you want it to see.

---

## 3. How PrivSight Solves It

PrivSight sits in the middle and acts as a **filter**:

```
Your Webpage (with ALL your private data)
         ↓
PrivSight scans the page locally, inside your browser
         ↓
Sensitive items are detected (emails, names, passwords, card numbers)
         ↓
Sensitive items are masked/removed → replaced with safe placeholders
         ↓
Only the clean, safe version goes to the AI
         ↓
AI answers your question without ever seeing your private data
```

### The Privacy Pipeline (3 Numbers We Track)

| Step | What it means |
|------|--------------|
| **Data Found** | Total number of text items/elements found on the page |
| **Sensitive Recognized** | Items that were identified as personal or sensitive |
| **Sensitive Removed** | Items that were successfully masked before reaching AI |

If Sensitive Removed = Sensitive Recognized → **100% protection achieved.**

---

## 4. What is a Chrome Extension?

Before understanding the code, you need to understand what a Chrome Extension actually is.

A Chrome Extension is just a **folder of files** (HTML, CSS, JavaScript) that Chrome loads and runs with special superpowers that normal websites don't have.

Normal websites can only:
- Show content on their own page
- Make requests to their own server

A Chrome Extension can:
- See what tab you are on
- Read the content of any webpage
- Inject JavaScript into any webpage
- Show a popup when you click the icon
- Run code in the background silently

Chrome gives these superpowers through a set of special APIs — functions like `chrome.tabs`, `chrome.scripting`, `chrome.storage`, etc.

---

## 5. Project File Structure

```
PrivSight/
│
├── manifest.json               ← The ID card of the extension (Chrome reads this first)
│
├── popup/
│   ├── popup.html              ← The visual layout of the popup window
│   ├── popup.css               ← All the styles and visual design of the popup
│   └── popup.js                ← All the logic of the popup (buttons, state, messages)
│
├── content/
│   └── agent.js                ← The script injected INTO the webpage itself
│
└── background/
    └── service-worker.js       ← A background process that runs silently
```

Think of each folder as a different "zone" in the browser:

- **popup/** lives inside the small window that opens when you click the extension icon
- **content/** lives inside the actual webpage you are visiting
- **background/** lives silently behind the scenes, always listening

---

## 6. File-by-File Explanation

---

### 📄 `manifest.json` — The Extension's Identity Card

This is the very first file Chrome reads. It tells Chrome:

- What is this extension called?
- What version is it?
- What files should it use?
- What permissions does it need?

```json
{
  "manifest_version": 3,
  "name": "PrivSight",
  "version": "1.0.0",
  "description": "Privacy-preserving browser agent.",
  "permissions": ["activeTab", "scripting"],
  "action": {
    "default_popup": "popup/popup.html"
  },
  "background": {
    "service_worker": "background/service-worker.js"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content/agent.js"]
    }
  ]
}
```

**What each part means:**

| Key | What it does |
|-----|-------------|
| `manifest_version: 3` | We are using the latest Chrome extension standard (V3) |
| `permissions: ["activeTab", "scripting"]` | We need to see the active tab and inject scripts into it |
| `action.default_popup` | When the user clicks the icon, open `popup.html` |
| `background.service_worker` | Run `service-worker.js` silently in the background |
| `content_scripts` | Automatically inject `agent.js` into all webpages the user opens after the extension loads |

**Why Manifest V3 (not V2)?**
V3 is Google's modern, secure standard. It replaced the old V2. The biggest change is that background scripts are now "Service Workers" — they are lightweight, start only when needed, and stop when idle. This is better for performance and security.

---

### 📄 `popup/popup.html` — The Visual Layout

This is a standard HTML file, just like any webpage. The only difference is that it lives inside a tiny browser popup window (about 380px wide).

It contains:
- The PrivSight logo and title at the top
- A chat area where the AI's responses appear
- Quick action buttons (common tasks the user can click)
- A text input at the bottom where the user types their prompt
- A privacy stats footer showing the 3-number pipeline
- A theme toggle button (dark/light mode)

Nothing unusual here — it is just HTML. The popup is styled to look premium and feel like a professional tool.

---

### 📄 `popup/popup.css` — The Visual Design

This file contains all the CSS that makes the popup look the way it does.

Key design choices:
- **Dark mode by default** — uses a deep navy/black color palette
- **Light mode** — activated by toggling `data-theme="light"` on the root element
- **CSS Variables** — all colors are defined as variables (like `--color-primary`, `--bg-surface`) so switching themes just changes the variables
- **Animations** — subtle transitions, glows, and pulse effects make the UI feel alive
- **Google Fonts (Inter)** — a clean, modern typeface instead of the browser default

---

### 📄 `popup/popup.js` — The Brain of the Popup

This is the most complex file. It handles all the logic inside the popup.

**Key things it does:**

1. **Finds the active tab** — When the popup opens, it asks Chrome: "What tab is the user on right now?" It saves the tab's ID so it can send messages to it later.

2. **Listens for user input** — When the user types a prompt and presses Send, `handleSend()` is called.

3. **Runs the agent simulation** — It cycles through a sequence of status states:
   ```
   connecting → reading_page → protecting_data → understanding_page → planning → executing → completed
   ```
   Each state lasts about 1–1.2 seconds, giving the full sequence a duration of ~7 seconds.

4. **Sends messages to the webpage** — Using `chrome.scripting.executeScript` and `chrome.tabs.sendMessage`, it injects `agent.js` into the webpage and tells it when to start and stop.

5. **Updates privacy stats** — The three numbers (Data Found, Sensitive Recognized, Sensitive Removed) update live as the agent progresses through its stages.

6. **Manages theme** — Dark/light mode preference is saved to `localStorage` so it persists between sessions.

---

### 📄 `background/service-worker.js` — The Silent Listener

This file runs in the background of Chrome, completely invisible to the user. Think of it like a security guard who is always on duty even when you are not looking.

Right now it is simple — it just logs when the extension is installed. In future versions it will coordinate complex, long-running tasks between tabs.

---

### 📄 `content/agent.js` — The Script That Lives Inside the Webpage

This is the most interesting file. When PrivSight runs, this script gets injected directly INTO the webpage you are visiting. It runs alongside the page's own JavaScript.

It has two main jobs:
1. **Listen for messages** from the popup (`START_AGENT` and `STOP_AGENT`)
2. **Create and destroy the Aurora overlay** on the webpage

This is explained in full detail in the next section.

---

## 7. The Aurora Overlay — Full Explanation

This is the visual effect you see on the webpage when PrivSight is working — a thin, glowing electric-blue light flowing around the edges of the browser viewport, with a small shield logo pulsing in the center.

Let's go through how it was built step by step.

---

### Step 1 — Why We Need a Special Approach (The CSS Isolation Problem)

When `agent.js` runs inside a webpage, it has a problem: the webpage already has its own CSS styles. If PrivSight just adds a `<div>` to the page and tries to style it, two bad things can happen:

1. The webpage's own CSS accidentally breaks PrivSight's overlay (e.g., the page has `* { box-sizing: border-box }` or resets all font sizes)
2. PrivSight's CSS accidentally breaks the webpage's layout

**The solution: Shadow DOM**

Shadow DOM is a built-in browser feature that creates a completely private, isolated DOM tree inside an element. CSS inside a Shadow DOM cannot affect the outside page. CSS from the outside page cannot affect inside the Shadow DOM. They are hermetically sealed from each other.

This is the same technology that Chrome uses internally for things like the `<video>` player controls and `<input type="date">` calendar picker — those elements have their own internal styling that your CSS cannot accidentally break.

---

### Step 2 — Creating the Host Element with Inline Styles

```javascript
const host = document.createElement('div');
host.id = 'privsight-overlay';

Object.assign(host.style, {
  position:      'fixed',
  top:           '0',
  left:          '0',
  width:         '100vw',
  height:        '100vh',
  zIndex:        '2147483647',
  pointerEvents: 'all',
  overflow:      'hidden',
});
```

**Why inline styles and not CSS?**

This is critical. We set `position: fixed`, `width: 100vw`, `height: 100vh` as **inline styles** directly on the element.

Why not put these in our CSS file? Because some webpages apply a CSS reset that says something like:
```css
* { position: static !important; }
```
or create a "stacking context" with `transform` or `overflow: hidden` on `<body>`.

When a parent element has `transform` applied, all `position: fixed` children get trapped inside that parent instead of being fixed to the viewport. This breaks the overlay entirely.

**The fix:** Inline styles cannot be overridden by any external stylesheet — they have the highest CSS priority. And we attach the host to `<html>` (the root element) instead of `<body>`, which means even if `<body>` has a stacking context trap, we are above it.

**What `z-index: 2147483647` means:**
This is the maximum possible z-index value (it is the largest 32-bit signed integer). It guarantees our overlay sits on top of absolutely everything else on the page.

**What `pointer-events: all` does:**
This means our overlay element captures every click, tap, and scroll event. Nothing "falls through" to the page underneath. The page becomes non-interactive while the overlay exists.

---

### Step 3 — Attaching the Shadow DOM

```javascript
const shadow = host.attachShadow({ mode: 'open' });

const styleEl = document.createElement('style');
styleEl.textContent = OVERLAY_CSS; // our Aurora CSS
shadow.appendChild(styleEl);
```

We call `attachShadow()` on our host element. This creates a private DOM tree inside it. We inject our CSS styles into that shadow root. From this point on, all Aurora elements are built inside `shadow`, not in the main page DOM.

---

### Step 4 — The Veil (Page Locking Effect)

```css
.veil {
  position: absolute;
  inset: 0;
  background: rgba(4, 4, 10, 0.28);
  backdrop-filter: blur(0.5px);
  animation: veil-in 0.55s ease-out both;
}
```

This is the very subtle dark overlay. It covers the entire viewport with a dark tint at only 28% opacity — enough to signal that the page is "locked" but not so heavy that the user cannot see the page content underneath.

The `backdrop-filter: blur(0.5px)` adds a tiny amount of blur to the page content behind the veil — a premium detail that makes it feel like frosted glass rather than a flat colored layer.

The `veil-in` animation makes it fade in smoothly over 0.55 seconds instead of appearing suddenly.

---

### Step 5 — The Aurora Edge Bars (The Main Effect)

This is the most visually interesting part. We create 4 separate thin strips — one for each edge of the viewport.

**How a single edge works (the top one):**

```css
.aurora-top {
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 3px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(56, 189, 248, 0.0)   8%,
    rgba(56, 189, 248, 0.75) 30%,
    rgba(99, 210, 255, 0.95) 50%,
    rgba(56, 189, 248, 0.75) 70%,
    rgba(56, 189, 248, 0.0)  92%,
    transparent 100%
  );
  animation: aurora-h 3.2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@keyframes aurora-h {
  0%   { transform: translateX(-55%); }
  100% { transform: translateX(55%);  }
}
```

**Breaking this down:**

- The div is only **3px tall** and spans the full width of the top of the screen
- Its background is a `linear-gradient` — not a solid color but a gradient that goes: transparent → bright cyan-blue → bright cyan-blue → transparent. This means the blue is bright in the middle and fades to nothing at both ends, creating the illusion of a glowing "pulse" of light
- The `@keyframes aurora-h` animation slides this gradient from -55% to +55% of the width continuously. Because the gradient fades at the edges, it looks like a glow sweeping across the edge rather than a block moving
- We do the same thing for the bottom edge (in reverse direction), left edge, and right edge (both using `translateY` instead)

**Why do all 4 edges feel different?**
Each edge has a different `animation-duration` and `animation-delay`:

| Edge | Duration | Delay | Direction |
|------|----------|-------|-----------|
| Top | 3.2s | 0s | Forward |
| Bottom | 4.1s | -1.3s | Reverse |
| Left | 3.8s | -0.8s | Forward |
| Right | 4.6s | -2.1s | Reverse |

Different speeds + negative delays (which effectively start the animation mid-cycle) mean each edge is always at a different position in its cycle. This creates the organic, non-looping feel — it never looks mechanical or perfectly synchronized.

---

### Step 6 — Corner Glow Accents

```css
.aurora-corner {
  position: absolute;
  width: 120px;
  height: 120px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(56, 189, 248, 0.18) 0%, transparent 70%);
  animation: corner-breathe 3.6s ease-in-out infinite;
}

@keyframes corner-breathe {
  0%, 100% { opacity: 0.3; transform: scale(0.9); }
  50%       { opacity: 1;   transform: scale(1.1); }
}
```

There are 4 of these — one at each corner. They are circular glows (using `radial-gradient`) that breathe in and out using scale + opacity animations. Each corner has a different `animation-delay` so they breathe at different times, adding life to the corners where the edge bars would otherwise look "cut off".

---

### Step 7 — The Center Logo with Glow Halo

```css
.logo-halo::before {
  content: '';
  position: absolute;
  inset: -18px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(56, 189, 248, 0.22) 0%, transparent 72%);
  animation: halo-pulse 2.2s ease-in-out infinite;
}
```

The shield icon has two invisible pseudo-elements (`::before` and `::after`) that are larger circles behind it, filled with a soft radial blue glow. They pulse in scale and opacity, creating the effect of the icon radiating energy.

The icon itself has an animated `box-shadow` that alternates between dim and bright blue — like a heartbeat.

The "Working..." label underneath has staggered animated dots:
- Dot 1 blinks at 0s delay
- Dot 2 blinks at 0.2s delay
- Dot 3 blinks at 0.4s delay

This creates the classic `Working...` typing animation where each dot appears one by one.

---

### Step 8 — Removing the Overlay

When the agent finishes and `STOP_AGENT` is received:

```javascript
function removeOverlay() {
  shell.classList.add('leaving');  // triggers CSS fade-out animation

  setTimeout(() => {
    host.parentNode.removeChild(host);  // remove from DOM after animation
    isActive = false;
  }, 520);
}
```

```css
.privsight-shell.leaving {
  animation: overlay-out 0.5s ease-in both;
}

@keyframes overlay-out {
  from { opacity: 1; }
  to   { opacity: 0; }
}
```

We don't just delete the overlay instantly — that would feel jarring. We first add a `leaving` CSS class which triggers a 0.5-second fade-out animation. After the animation completes (520ms), we remove the element from the DOM entirely. The page then becomes fully interactive again.

---

## 8. How All the Files Talk to Each Other

Chrome extensions cannot directly import functions from each other like normal JavaScript modules. Instead they communicate using **message passing** — a system where one part sends a message, and another part listens and responds.

Here is the complete communication diagram:

```
┌──────────────────────────────────────────────────────────┐
│                    popup/popup.js                        │
│                                                          │
│  1. chrome.tabs.query() → finds the active tab ID       │
│                                                          │
│  2. User clicks Send                                     │
│     ↓                                                    │
│  3. chrome.scripting.executeScript({                     │
│       files: ['content/agent.js']                        │
│     })                                                   │
│     → Force-injects agent.js into the webpage            │
│     → Waits for injection to complete                    │
│     ↓                                                    │
│  4. chrome.tabs.sendMessage(tabId, {                     │
│       type: 'START_AGENT',                               │
│       prompt: 'user typed text'                          │
│     })                                                   │
│     → Sends message to the webpage                       │
└─────────────────────┬────────────────────────────────────┘
                      │ message travels over Chrome's
                      │ internal message bus
                      ↓
┌──────────────────────────────────────────────────────────┐
│                   content/agent.js                       │
│   (running inside the webpage)                           │
│                                                          │
│  chrome.runtime.onMessage.addListener((message) => {    │
│    if (message.type === 'START_AGENT') {                 │
│      createOverlay()  ← Aurora appears on the page      │
│    }                                                     │
│    if (message.type === 'STOP_AGENT') {                  │
│      removeOverlay()  ← Aurora fades out                 │
│    }                                                     │
│  })                                                      │
└──────────────────────────────────────────────────────────┘
                      ↑
                      │ after ~7 seconds, popup.js sends:
                      │ { type: 'STOP_AGENT' }
┌─────────────────────┴────────────────────────────────────┐
│                    popup/popup.js                        │
│  (simulation complete, sends STOP_AGENT)                 │
└──────────────────────────────────────────────────────────┘
```

---

### Why `executeScript` Instead of Just `sendMessage`?

This was the bug that initially made the Aurora not appear.

When you install or reload a Chrome extension, `content_scripts` in `manifest.json` automatically inject into **new tabs opened after the extension loads**. But any tab that was **already open** before the extension was loaded does not have the content script.

So when the popup tried to `sendMessage`, there was nobody on the other end to receive it. Chrome silently dropped the message with a `"Could not establish connection"` error that we were ignoring.

**The fix:** Use `chrome.scripting.executeScript` to **force-inject** `agent.js` into the tab every single time the user presses Send. This works regardless of whether the tab was open before or after the extension loaded. The IIFE wrapper (`(function() { ... })()`) in `agent.js` includes a stale-overlay check so re-injecting it multiple times is safe.

---

## 9. The Full User Flow Step by Step

Here is exactly what happens when a user uses PrivSight, in order:

```
1. User visits any webpage (e.g. https://github.com)

2. User clicks the PrivSight icon in the Chrome toolbar
   → Chrome opens popup/popup.html as a small window
   → popup.js runs immediately
   → popup.js calls chrome.tabs.query() to find the tab ID

3. User types: "Summarize this page"
   → User presses the → button

4. popup.js calls handleSend()
   → The message "Summarize this page" is added to the chat
   → runAgentSequence() is called

5. chrome.scripting.executeScript() is called
   → Chrome injects content/agent.js into the GitHub page

6. chrome.tabs.sendMessage({ type: 'START_AGENT' }) is called
   → The message arrives in agent.js running inside the GitHub page

7. agent.js calls createOverlay()
   → A new <div id="privsight-overlay"> is created with inline fixed styles
   → Shadow DOM is attached to it
   → The veil, 4 Aurora edge bars, 4 corner glows, and center logo are built inside
   → The host div is appended to <html> (the root element)
   → The page is now completely non-interactive
   → The Aurora animation begins

8. Back in popup.js, the status machine runs:
   0.0s → Status: "Connecting..."      (amber dot)
   1.2s → Status: "Reading page..."    (data found count increases)
   2.5s → Status: "Protecting data..." (sensitive items count increases)
   3.7s → Status: "Understanding..."   
   5.0s → Status: "Planning..."        
   6.2s → Status: "Executing..."       
   7.0s → Status: "Completed ✓"        (green dot, agent reply shown)

9. popup.js sends { type: 'STOP_AGENT' }
   → agent.js adds 'leaving' class to the shell
   → CSS fade-out animation plays over 0.5 seconds
   → Overlay div is removed from the DOM
   → The GitHub page is fully interactive again

10. Privacy stats show final numbers:
    Data Found: 2,061
    Sensitive Recognized: 53
    Sensitive Removed: 53
    → 100% Sensitive Data Protected
```

---

## 10. Interview Q&A — Every Question You May Be Asked

---

### Q: What is PrivSight and what problem does it solve?

**Answer:** PrivSight is a Chrome extension that acts as a privacy filter between the user's browser and AI models. Current AI web agents send the entire raw webpage content — including personal data like emails, passwords, and credit card numbers — to cloud AI servers. PrivSight intercepts that data locally in the browser, identifies sensitive items, masks them, and only sends the clean version to the AI. Zero private data leaves the user's machine.

---

### Q: What is a Chrome Extension and how does it work?

**Answer:** A Chrome extension is a folder of HTML, CSS, and JavaScript files that Chrome runs with special privileges not available to normal websites. It has three "zones" — the popup (visible UI when you click the icon), content scripts (JavaScript injected into webpages), and a background service worker (a silent coordinator). These zones communicate using Chrome's message-passing API.

---

### Q: What is Manifest V3 and why did you use it?

**Answer:** Manifest V3 is Google's latest Chrome extension standard. The key change from V2 is that background scripts are now Service Workers — lightweight processes that only start when needed and stop when idle, improving performance and security. V3 also bans remote code execution (you cannot load JavaScript from an external URL), making extensions safer. We used V3 because it is the current standard and Chrome has deprecated V2.

---

### Q: What is Shadow DOM and why did you use it for the overlay?

**Answer:** Shadow DOM is a browser feature that creates a completely isolated, private DOM tree inside an element. CSS inside the Shadow DOM cannot affect the outside page, and the page's CSS cannot affect inside it. We used it for the Aurora overlay because we inject our code into arbitrary webpages. Without Shadow DOM, the page's CSS resets could break our overlay styles, and our styles could accidentally break the page's layout. Shadow DOM gives us a guaranteed, clean environment regardless of what the page's CSS looks like. It is the same technology Chrome uses internally for `<video>` controls and `<input type="date">` pickers.

---

### Q: Why did the Aurora overlay not work initially?

**Answer:** The bug was that `manifest.json`'s `content_scripts` only auto-inject into tabs opened after the extension loads. Any tab already open before loading or reloading the extension has no content script. When popup.js called `chrome.tabs.sendMessage`, nobody was listening — Chrome silently dropped the message. The fix was to use `chrome.scripting.executeScript` to programmatically inject `agent.js` into the tab at the exact moment the user presses Send, guaranteeing the script is always present regardless of when the tab was opened.

---

### Q: Why did you use inline styles for the host overlay element?

**Answer:** Some webpages apply CSS transforms or `overflow: hidden` to their `<body>` element. In CSS, when a parent element has `transform` applied, it creates a new "stacking context," which traps `position: fixed` children inside it instead of fixing them to the viewport. This would have made our overlay appear in a wrong position or not at all. By using inline styles (which cannot be overridden by any stylesheet) and appending to `<html>` instead of `<body>`, we bypass all stacking context traps and guarantee the overlay covers the full viewport every time.

---

### Q: How does the Aurora animation work technically?

**Answer:** Each of the four viewport edges is a thin `position: absolute` div with a `linear-gradient` — transparent on both ends, bright electric blue in the middle. A CSS `@keyframes` animation continuously shifts this gradient using `translateX` (for horizontal edges) or `translateY` (for vertical edges), making the glow look like it is sliding along the edge. Each of the four edges has a different animation duration and a negative animation-delay (which starts the animation mid-cycle), so they are never synchronized. This makes the overall motion feel organic and alive rather than robotic and looping.

---

### Q: Why use Vanilla HTML/CSS/JS instead of React?

**Answer:** Extension popups must open in under 50 milliseconds. React would add a bundle size of 40–100KB and a JavaScript runtime that needs to initialize before anything renders. Vanilla JavaScript means zero overhead — the popup opens instantly. It also means no build step, no `node_modules`, and the extension folder can be loaded directly into Chrome without any compilation. This keeps the project simple, fast, and easy to understand.

---

### Q: How do the popup and the webpage communicate?

**Answer:** Through Chrome's message-passing system. The popup uses `chrome.tabs.sendMessage(tabId, payload)` to send a message to the content script. The content script registers a listener using `chrome.runtime.onMessage.addListener()` which fires when a message arrives. The content script can also call `sendResponse()` to send data back. This is an asynchronous, event-driven system — neither side blocks waiting for the other.

---

## 11. How to Load and Test the Extension

### Bundle the local PII engine + NER model (once, and before every Web Store upload)

The on-device NER model (DistilBERT-NER, ~66 MB) and the Script Redaction engine are copied into `lib/pii/`. That folder is generated and gitignored, so build it before loading or zipping the extension:

```bash
cd "../Script Redaction"
npm install
npm run setup:ner          # downloads the model + vendors Transformers.js (developer machine only)
npm run build:extension    # copies engine + runtime + model into extension/lib/pii/ (~86 MB)
```

End users download everything inside the extension package. Nothing is fetched at runtime.

How it runs:
- `offscreen/ner.html` loads the model once per browser session. It warms up at browser start and when an agent session starts.
- Before every screenshot, `content/agent.js` sends the visible text to it and redacts the entities it returns together with `content/redactor.js`'s patterns.
- If the engine doesn't answer within 3 s, capture falls back to regex-only redaction and logs a warning.

### Loading it into Chrome

1. Open Chrome and go to: `chrome://extensions`
2. Turn on **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the folder: `d:\SIH26\Frontend\PrivSight`
5. PrivSight will appear in your extensions list
6. Click the puzzle piece icon in the Chrome toolbar → Pin PrivSight

### Using it

1. Open any webpage (e.g. `https://example.com` or `https://github.com`)
2. Click the **PrivSight shield icon** in the toolbar
3. Type a prompt (e.g. "Summarize this page")
4. Click the → arrow or press Enter

### What you will see

| Location | What Happens |
|----------|-------------|
| **The webpage** | Subtle dark veil appears, page becomes non-clickable, thin electric-blue Aurora flows around all 4 viewport edges, PrivSight shield logo pulses in the center |
| **The popup** | Status steps through: Connecting → Reading → Protecting → Understanding → Planning → Executing |
| **Privacy stats** | The 3 numbers count up live as the agent progresses |
| **After ~7 seconds** | Aurora fades out, page returns to normal, popup shows the agent's reply, stats show 100% protected |

### Reloading after code changes

Every time you edit a file, go to `chrome://extensions` → find PrivSight → click the **↻ reload** button. Then test again on an open tab.

### Inspecting the overlay with DevTools

While the Aurora is visible on the webpage:
1. Press **F12** to open DevTools
2. Go to the **Elements** tab
3. Scroll to the bottom of `<html>` → find `<div id="privsight-overlay">`
4. Expand it → you will see the `#shadow-root` containing all the Aurora elements
5. Go to the **Console** tab → you will see:
   ```
   [PrivSight] Overlay active — page locked while agent works.
   [PrivSight] Overlay removed — page restored.
   ```

---

*Built with Vanilla HTML, CSS, and JavaScript. No frameworks. No build tools. Just the browser.*
