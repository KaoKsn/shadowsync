// ─────────────────────────────────────────────────────────
// PrivSight — shared types
// Wire these to the browser-agent backend when ready.
// ─────────────────────────────────────────────────────────

export type AgentStatusValue =
  | 'idle'
  | 'connecting'
  | 'reading_page'
  | 'protecting_data'
  | 'understanding_page'
  | 'planning_action'
  | 'executing'
  | 'completed'
  | 'error'
  | 'page_unavailable'

export type StepStatus = 'done' | 'active' | 'pending'

export interface ProgressStep {
  id: string
  label: string
  status: StepStatus
}

// Delivered by the agent backend on each status tick
export interface AgentState {
  status: AgentStatusValue
  message: string          // e.g. "Working on this page"
  detail: string           // e.g. "Understanding the current webpage..."
  progress: number         // 0–100
  steps: ProgressStep[]
  taskId?: string
  timestamp?: number
}

// Delivered by the DOM sanitization + screenshot pipeline
export interface PrivacyStatsData {
  dataProtected: number          // 0–100 (percentage)
  elementsProcessed: number
  sensitiveItemsHidden: number
  facesProtected: number
  domSize?: number               // bytes, raw
  sanitizedDomSize?: number      // bytes, after sanitization
  screenshotSize?: number        // bytes
}

export interface ChatMessage {
  id: string
  role: 'user' | 'agent'
  text: string
  isError?: boolean
  timestamp: number
}

// Reflects the current browser tab state
export interface PageContext {
  url?: string
  title?: string
  available: boolean
  unavailableReason?: 'system_page' | 'extension_page' | 'no_page' | 'permission_denied'
}
