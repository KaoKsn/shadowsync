# 🛡️ PrivSight — Privacy-Preserving Browser Agent
> Built for Smart India Hackathon (SIH '26)

**PrivSight** is a privacy-preserving browser extension that enables autonomous web agents to interact with web pages (summarizing, searching, filling forms) while ensuring that sensitive user data is sanitized and protected before reaching AI models.

---

## 📁 Repository Structure

- [Frontend/PrivSight/](file:///d:/SIH26/Frontend/PrivSight) — Chrome Extension (Manifest V3) source code.
  - [Frontend/PrivSight/README.md](file:///d:/SIH26/Frontend/PrivSight/README.md) — 📖 **Full beginner-friendly architecture guide & interview cheat sheet**.
  - `manifest.json` — Extension configuration.
  - `popup/` — Extension UI (HTML, CSS, JS).
  - `content/` — Webpage-injected agent script.
  - `background/` — Background Service Worker.
- `FigmaDesign/` — Original UI design prototype.

---

## 🚀 Quick Start (Load in Chrome)

1. Open `chrome://extensions` in Google Chrome.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select `Frontend/PrivSight`.
4. Pin **PrivSight** to your toolbar and click to open!
