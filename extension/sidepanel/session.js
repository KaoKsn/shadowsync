/**
 * PrivSight - Agent Session Management Layer (session.js)
 *
 * Responsibilities:
 *  1. Create, read, update, delete agent sessions stored in browser localStorage.
 *  2. Provide a single source of truth under the "agentSessions" key.
 *  3. Persist session state, prompts, status, and generated actions in real time.
 *  4. Serve as the modular abstraction layer between the UI and backend execution.
 *  5. WebSocket backend client -- connects once per task to ws://localhost:8001/ws/task
 *     and exchanges JSON messages (start -> step -> screenshot -> stop) per WEBSOCKET_API.md.
 */

(function (global) {
  'use strict';
  const SESSIONS_STORAGE_KEY = 'agentSessions';
  const CURRENT_SESSION_ID_KEY = 'agentCurrentSessionId';

  const SessionStatus = Object.freeze({
    RUNNING:   'running',
    COMPLETED: 'completed',
    FAILED:    'failed',
    STOPPED:   'stopped',
  });

  function getStorageData(key, defaultValue = null) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return defaultValue;
      return JSON.parse(raw);
    } catch (err) {
      console.warn(`[PrivSight Session] Failed to parse localStorage for key "${key}":`, err);
      return defaultValue;
    }
  }

  function setStorageData(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      console.error(`[PrivSight Session] Failed to save to localStorage for key "${key}":`, err);
      return false;
    }
  }

  function getAllSessions() {
    const sessions = getStorageData(SESSIONS_STORAGE_KEY, []);
    return Array.isArray(sessions) ? sessions : [];
  }

  function getSession(id) {
    if (!id) return null;
    const sessions = getAllSessions();
    return sessions.find((s) => s.id === id) || null;
  }

  function createSession(task, metadata = {}) {
    const id = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    const now = new Date().toISOString();
    const newSession = {
      id,
      task: typeof task === 'string' ? task.trim() : '',
      status: SessionStatus.RUNNING,
      actions: [],
      metadata: { createdAt: now, updatedAt: now, ...metadata },
    };
    const sessions = getAllSessions();
    sessions.push(newSession);
    setStorageData(SESSIONS_STORAGE_KEY, sessions);
    setCurrentSessionId(id);
    AgentBackendClient.resetRequestTimer();
    console.debug(`[PrivSight Session] Created session "${id}" for task: "${newSession.task}"`);
    return newSession;
  }

  function updateSession(id, data) {
    if (!id || !data) return null;
    const sessions = getAllSessions();
    const index = sessions.findIndex((s) => s.id === id);
    if (index === -1) {
      console.warn(`[PrivSight Session] Cannot update: session "${id}" not found.`);
      return null;
    }
    const current = sessions[index];
    const now = new Date().toISOString();
    const updated = {
      ...current, ...data,
      metadata: { ...(current.metadata || {}), ...(data.metadata || {}), updatedAt: now },
    };
    if (data.status && data.status !== SessionStatus.RUNNING && !updated.metadata.finishedAt) {
      updated.metadata.finishedAt = now;
    }
    sessions[index] = updated;
    setStorageData(SESSIONS_STORAGE_KEY, sessions);
    return updated;
  }

  function appendActionToSession(id, action) {
    if (!id || !action) return null;
    const session = getSession(id);
    if (!session) return null;
    const actionWithMeta = {
      id: typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : 'act_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      timestamp: new Date().toISOString(),
      ...action,
    };
    return updateSession(id, { actions: [...(session.actions || []), actionWithMeta] });
  }

  function deleteSession(id) {
    if (!id) return false;
    const sessions = getAllSessions();
    const filtered = sessions.filter((s) => s.id !== id);
    if (filtered.length === sessions.length) return false;
    setStorageData(SESSIONS_STORAGE_KEY, filtered);
    if (getCurrentSessionId() === id) localStorage.removeItem(CURRENT_SESSION_ID_KEY);
    return true;
  }

  function getCurrentSessionId() {
    return localStorage.getItem(CURRENT_SESSION_ID_KEY) || null;
  }

  function setCurrentSessionId(id) {
    if (id) { localStorage.setItem(CURRENT_SESSION_ID_KEY, id); }
    else     { localStorage.removeItem(CURRENT_SESSION_ID_KEY); }
  }

  function getCurrentSession() {
    const currentId = getCurrentSessionId();
    return currentId ? getSession(currentId) : null;
  }

  function handlePageRefreshRecovery() {
    const sessions = getAllSessions();
    let hasChanges = false;
    const now = new Date().toISOString();
    const recovered = sessions.map((s) => {
      if (s.status === SessionStatus.RUNNING) {
        hasChanges = true;
        return { ...s, status: SessionStatus.STOPPED,
          metadata: { ...(s.metadata || {}), updatedAt: now, finishedAt: now, interruptedByReload: true } };
      }
      return s;
    });
    if (hasChanges) {
      setStorageData(SESSIONS_STORAGE_KEY, recovered);
      console.info('[PrivSight Session] Recovered from reload: marked interrupted sessions as stopped.');
    }
  }

  // ---------------------------------------------------------------------------
  // WebSocket Backend Client
  // Endpoint: ws://localhost:8001/ws/task  (per WEBSOCKET_API.md)
  //
  // Message flow:
  //   1. Open WS once per task.
  //   2. Send { type:"start", session_id, task, snapshot }   <- first turn
  //   3. Execute action returned by backend.
  //   4. Send { type:"step",  session_id, task, snapshot }   <- subsequent turns
  //   5. If backend returns request_screenshot:
  //      Send { type:"screenshot", session_id, task, snapshot } with screenshot_b64
  //   6. On cancel: send { type:"stop", session_id } and close WS.
  //
  // All public methods preserve the same signatures as the old HTTP client so
  // sidepanel.js requires zero changes.
  // ---------------------------------------------------------------------------

  const WS_URL = 'ws://localhost:8000/ws/task';

  /**
   * Normalise a raw WS response into the internal action shape sidepanel.js uses.
   */
  function normaliseBackendResponse(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('Backend returned an invalid response');
    const action = raw.action || {};
    const backendType = String(action.type || '').toLowerCase();
    const TYPE_MAP = {
      click:               'CLICK',
      type_text:           'TYPE',
      scroll:              'SCROLL',
      new_tab:             'NEW_TAB',
      open_url:            'NAVIGATE',
      go_back:             'GO_BACK',
      read_page:           'READ_PAGE',
      go_forward:          'GO_FORWARD',
      user:                'USER',
      request_screenshot:  'REQUEST_SCREENSHOT',
      request_user_input:  'USER',
      summarize_page:      'DONE',
      task_complete:       'DONE',
    };
    const internalType  = TYPE_MAP[backendType] || backendType.toUpperCase();
    const backendStatus = String(raw.status || '').toLowerCase();
    const isComplete    = backendStatus === 'done' || internalType === 'DONE';
    const isFailed      = backendStatus === 'failed';
    return {
      type:        internalType,
      data_hint:   action.target_id != null ? String(action.target_id) : null,
      element_id:  action.target_id != null ? String(action.target_id) : null,
      text:        action.text   || action.message || action.prompt || action.question || raw.summary || null,
      url:         action.url    || null,
      direction:   action.direction || null,
      submit:      Boolean(action.submit),
      reasoning:   action.reason || action.summary || action.reasoning || raw.summary || null,
      is_complete: isComplete,
      is_failed:   isFailed,
      summary:     raw.summary   || action.summary || null,
      _raw:        raw,
    };
  }

  /**
   * Downscale a (redacted) screenshot to max 1024px and re-encode as JPEG so
   * the payload is a fraction of the original PNG. Falls back to the input.
   */
  async function compressScreenshot(b64, maxSide = 1024, quality = 0.6) {
    const clean = String(b64 || '').replace(/^data:image\/[a-zA-Z+.-]+;base64,/, '');
    if (!clean) return '';
    try {
      const bytes = Uint8Array.from(atob(clean), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes]));
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
      const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
      const buf = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (let i = 0; i < buf.length; i += 0x8000) binary += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      return btoa(binary);
    } catch (err) {
      console.warn('[PrivSight] Screenshot compression failed, sending original:', err.message);
      return clean;
    }
  }

  /**
   * One persistent WebSocket per agent task.
   * Uses a send-and-receive promise pattern: one outstanding request at a time.
   */
  class AgentWebSocketSession {
    constructor(sessionId, task = '') {
      this.sessionId = sessionId;
      this.task      = task;
      this._ws      = null;
      this._pending = null;
      this._closed  = false;
    }

    connect() {
      return new Promise((resolve, reject) => {
        try { this._ws = new WebSocket(WS_URL); }
        catch (err) { return reject(new Error(`WebSocket connect failed: ${err.message}`)); }

        this._ws.onopen = () => {
          console.log(`[PrivSight WS] Connected (session: ${this.sessionId})`);
          resolve();
        };

        this._ws.onerror = () => {
          const err = new Error(`WebSocket error -- is the backend running at ${WS_URL}?`);
          if (this._pending) { const { reject: rej } = this._pending; this._pending = null; rej(err); }
          else { console.warn('[PrivSight WS] Error (no pending request)'); }
        };

        this._ws.onclose = (evt) => {
          this._closed = true;
          console.log(`[PrivSight WS] Closed (code=${evt.code})`);
          if (this._pending) {
            const { reject: rej } = this._pending;
            this._pending = null;
            rej(new Error(`WebSocket closed unexpectedly (code=${evt.code})`));
          }
        };

        this._ws.onmessage = (evt) => {
          if (!this._pending) { console.warn('[PrivSight WS] Unsolicited message ignored'); return; }
          const { resolve: res, reject: rej } = this._pending;
          this._pending = null;
          try { res(JSON.parse(evt.data)); }
          catch (e) { rej(new Error(`WS parse error: ${e.message}`)); }
        };
      });
    }

    sendAndReceive(payload) {
      return new Promise((resolve, reject) => {
        if (this._closed || !this._ws || this._ws.readyState !== WebSocket.OPEN) {
          return reject(new Error('WebSocket is not open'));
        }
        if (this._pending) return reject(new Error('A request is already in flight'));
        this._pending = { resolve, reject };
        // Do not dump task text, DOM contents, screenshots, or form metadata.
        console.log(`[PrivSight WS] Sending ${payload.type} (step ${payload.snapshot?.step ?? 'n/a'})`);
        this._ws.send(JSON.stringify(payload));
      });
    }

    stop() {
      if (this._closed) return;
      try {
        if (this._ws && this._ws.readyState === WebSocket.OPEN) {
          this._ws.send(JSON.stringify({ type: 'stop', session_id: this.sessionId }));
          this._ws.close(1000, 'task_stopped');
        }
      } catch (_) {}
      this._closed = true;
    }
  }

  let _activeWsSession = null;

  const AgentBackendClient = {
    WS_URL,
    MIN_REQUEST_GAP_MS: 0,

    resetRequestTimer() {
      if (_activeWsSession) { _activeWsSession.stop(); _activeWsSession = null; }
    },

    async checkHealth() {
      return new Promise((resolve, reject) => {
        try {
          const ws = new WebSocket(WS_URL);
          const t  = setTimeout(() => { ws.close(); reject(new Error('WS health check timed out')); }, 3000);
          ws.onopen  = () => { clearTimeout(t); ws.close(1000, 'health_check'); resolve({ status: 'ok' }); };
          ws.onerror = () => { clearTimeout(t); reject(new Error('WS health check failed')); };
        } catch (err) { reject(err); }
      });
    },

    buildSnapshot(sessionId, step, elements, changedSinceLastStep, screenshotAvailable, screenshotB64, page = {}) {
      const snapshot = {
        session_id:              String(sessionId),
        step,
        url:                     page.url || null,
        title:                   page.title || null,
        elements,
        changed_since_last_step: changedSinceLastStep || [],
        screenshot_available:    Boolean(screenshotAvailable),
      };
      // Images leave the extension only in response to request_screenshot.
      if (screenshotB64) snapshot.screenshot_b64 = screenshotB64;
      return snapshot;
    },

    async postTaskStart({ sessionId, task, elements, screenshotAvailable, page }) {
      if (!sessionId) throw new Error('postTaskStart: sessionId is required');
      if (_activeWsSession) { _activeWsSession.stop(); _activeWsSession = null; }
      const session = new AgentWebSocketSession(sessionId, task || '');
      await session.connect();
      _activeWsSession = session;
      const snapshot = this.buildSnapshot(sessionId, 0, elements || [], [], screenshotAvailable !== false, null, page);
      const raw = await session.sendAndReceive({ type: 'start', session_id: String(sessionId), task: String(task || ''), snapshot });
      return normaliseBackendResponse(raw);
    },

    async postTaskStep({ sessionId, task, step, elements, changedSinceLastStep, screenshotAvailable, page }) {
      if (!sessionId)        throw new Error('postTaskStep: sessionId is required');
      if (!_activeWsSession) throw new Error('postTaskStep: no active WebSocket -- call postTaskStart first');
      const effectiveTask = String(task || (_activeWsSession ? _activeWsSession.task : '') || '');
      if (effectiveTask && _activeWsSession) _activeWsSession.task = effectiveTask;
      const snapshot = this.buildSnapshot(sessionId, step, elements || [], changedSinceLastStep || [], screenshotAvailable !== false, null, page);
      const raw = await _activeWsSession.sendAndReceive({ type: 'step', session_id: String(sessionId), task: effectiveTask, snapshot });
      return normaliseBackendResponse(raw);
    },

    async postTaskScreenshot({ sessionId, task, step, elements, screenshotB64, page }) {
      if (!sessionId)        throw new Error('postTaskScreenshot: sessionId is required');
      if (!_activeWsSession) throw new Error('postTaskScreenshot: no active WebSocket session');
      const effectiveTask = String(task || (_activeWsSession ? _activeWsSession.task : '') || '');
      const compact = await compressScreenshot(screenshotB64);
      const snapshot = this.buildSnapshot(sessionId, step, this.toBackendElements(elements), [], true, compact, page);
      const raw = await _activeWsSession.sendAndReceive({ type: 'screenshot', session_id: String(sessionId), task: effectiveTask, snapshot });
      return normaliseBackendResponse(raw);
    },

    // Reply to a read_page action with the page's redacted visible text.
    async postTaskPageText({ sessionId, pageText }) {
      if (!sessionId)        throw new Error('postTaskPageText: sessionId is required');
      if (!_activeWsSession) throw new Error('postTaskPageText: no active WebSocket session');
      const raw = await _activeWsSession.sendAndReceive({ type: 'page_text', session_id: String(sessionId), page_text: String(pageText || '') });
      return normaliseBackendResponse(raw);
    },

    // Shared by /step and /screenshot so both send the same element schema.
    toBackendElements(sanitizedDom) {
      return (Array.isArray(sanitizedDom) ? sanitizedDom : []).map((el) => ({
        mark_id:          el.mark_id != null ? Number(el.mark_id) : Number(el.data_hint || 0),
        tag:              String(el.tag || 'div'),
        role:             el.role || null,
        input_type:       el.input_type || null,
        text:             el.text  != null ? el.text  : null,
        // Form values are intentionally excluded from backend snapshots.
        value:            null,
        name:             el.name || null,
        placeholder:      el.placeholder || null,
        aria_label:       el.aria_label || null,
        disabled:         Boolean(el.disabled),
        checked:          null,
        redacted:         Boolean(el.redacted),
        redaction_reason: el.redaction_reason || undefined,
      }));
    },

    async postTurn({ sessionId, taskGoal, sanitizedDom, sanitizedScreenshotB64, step, changedSinceLastStep, page }) {
      if (!sessionId) throw new Error('postTurn: sessionId is required');
      const elements = this.toBackendElements(sanitizedDom);
      const stepIndex = typeof step === 'number' ? step : 0;
      const screenshotAvailable = Boolean(sanitizedScreenshotB64);
      if (stepIndex === 0) {
        return this.postTaskStart({ sessionId, task: taskGoal || '', elements, screenshotAvailable, page });
      } else {
        return this.postTaskStep({ sessionId, task: taskGoal || '', step: stepIndex, elements, changedSinceLastStep: changedSinceLastStep || [], screenshotAvailable, page });
      }
    },

    async deleteSession(sessionId) {
      if (!sessionId) return { status: 'skipped' };
      try {
        if (_activeWsSession) { _activeWsSession.stop(); _activeWsSession = null; }
        return { status: 'stopped' };
      } catch (err) {
        console.warn(`[PrivSight WS] stop (${sessionId}) error:`, err.message);
        return { status: 'error', error: err.message };
      }
    },
  };

  async function fetchAgentAction(session, turnContext = {}) {
    return await AgentBackendClient.postTurn({
      sessionId:              session.id,
      taskGoal:               session.task,
      sanitizedDom:           turnContext.sanitized_dom || [],
      sanitizedScreenshotB64: turnContext.sanitized_screenshot_b64 || '',
    });
  }

  const AgentSessionManager = {
    SessionStatus,
    getAllSessions,
    getSession,
    createSession,
    updateSession,
    deleteSession,
    getCurrentSession,
    getCurrentSessionId,
    setCurrentSessionId,
    appendActionToSession,
    handlePageRefreshRecovery,
    fetchAgentAction,
    AgentBackendClient,
  };

  global.AgentBackendClient  = AgentBackendClient;
  global.AgentSessionManager = AgentSessionManager;
  global.createSession       = createSession;
  global.getSession          = getSession;
  global.updateSession       = updateSession;
  global.deleteSession       = deleteSession;
  global.getAllSessions       = getAllSessions;

})(typeof window !== 'undefined' ? window : this);
