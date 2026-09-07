import { useState, useRef, useEffect, useCallback } from 'react'
import type {
  AgentStatusValue, AgentState, PrivacyStatsData,
  ChatMessage, ProgressStep,
} from './types'

// ─────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────

const SUGGESTIONS = [
  { label: 'Find something on this page', query: 'Find something on this page' },
  { label: 'Fill out this form',           query: 'Fill out this form'           },
  { label: 'Summarize this page',          query: 'Summarize this page'          },
]

const MOCK_RESPONSES: [string, string][] = [
  ['find',     'I can search the page for you. What are you looking for?'],
  ['fill',     "I can see a form on this page. What information should I use to fill it in?"],
  ['summarize',"This page is a product landing page for a developer tool. Key points: self-hostable, starts at $12/mo, API access on all plans. Three pricing tiers. Privacy policy linked in the footer."],
]

// Maps each working status to the agent panel copy and step list
const AGENT_CONFIGS: Partial<Record<AgentStatusValue, Omit<AgentState, 'status'>>> = {
  connecting: {
    message: 'Connecting to PrivSight',
    detail: 'Establishing a secure connection to the agent...',
    progress: 8,
    steps: [
      { id: 'connect', label: 'Connecting',                        status: 'active'  },
      { id: 'page',    label: 'Page accessed',                     status: 'pending' },
      { id: 'protect', label: 'Sensitive information protected',   status: 'pending' },
      { id: 'identify',label: 'Identifying elements',              status: 'pending' },
    ],
  },
  reading_page: {
    message: 'Reading this page',
    detail: 'Accessing the current page content...',
    progress: 22,
    steps: [
      { id: 'connect', label: 'Connected',                         status: 'done'    },
      { id: 'page',    label: 'Page accessed',                     status: 'active'  },
      { id: 'protect', label: 'Sensitive information protected',   status: 'pending' },
      { id: 'identify',label: 'Identifying elements',              status: 'pending' },
    ],
  },
  protecting_data: {
    message: 'Protecting your data',
    detail: 'Sanitizing sensitive information before processing...',
    progress: 42,
    steps: [
      { id: 'page',    label: 'Page accessed',                     status: 'done'    },
      { id: 'protect', label: 'Sensitive information protected',   status: 'active'  },
      { id: 'identify',label: 'Identifying elements',              status: 'pending' },
    ],
  },
  understanding_page: {
    message: 'Working on this page',
    detail: 'Understanding the current webpage...',
    progress: 58,
    steps: [
      { id: 'page',    label: 'Page accessed',                     status: 'done'    },
      { id: 'protect', label: 'Sensitive information protected',   status: 'done'    },
      { id: 'identify',label: 'Identifying elements',              status: 'active'  },
    ],
  },
  planning_action: {
    message: 'Working on this page',
    detail: 'Planning the next action...',
    progress: 72,
    steps: [
      { id: 'page',    label: 'Page accessed',                     status: 'done'    },
      { id: 'protect', label: 'Sensitive information protected',   status: 'done'    },
      { id: 'identify',label: 'Identifying elements',              status: 'done'    },
      { id: 'plan',    label: 'Planning action',                   status: 'active'  },
    ],
  },
  executing: {
    message: 'Working on this page',
    detail: 'Executing the requested task...',
    progress: 88,
    steps: [
      { id: 'page',    label: 'Page accessed',                     status: 'done'    },
      { id: 'protect', label: 'Sensitive information protected',   status: 'done'    },
      { id: 'identify',label: 'Identifying elements',              status: 'done'    },
      { id: 'plan',    label: 'Planning action',                   status: 'done'    },
      { id: 'execute', label: 'Executing task',                    status: 'active'  },
    ],
  },
}

// Status label + color + whether the agent is currently working
const STATUS_META: Record<AgentStatusValue, { label: string; color: string; working: boolean }> = {
  idle:               { label: 'Ready',         color: 'var(--green)',  working: false },
  connecting:         { label: 'Connecting',     color: 'var(--amber)',  working: true  },
  reading_page:       { label: 'Reading page',   color: 'var(--accent)', working: true  },
  protecting_data:    { label: 'Protecting data',color: 'var(--accent)', working: true  },
  understanding_page: { label: 'Working',        color: 'var(--accent)', working: true  },
  planning_action:    { label: 'Planning',       color: 'var(--accent)', working: true  },
  executing:          { label: 'Executing',      color: 'var(--accent)', working: true  },
  completed:          { label: 'Completed',      color: 'var(--green)',  working: false },
  error:              { label: 'Error',          color: 'var(--red)',    working: false },
  page_unavailable:   { label: 'Unavailable',   color: 'var(--text-3)', working: false },
}

const WORKING_SEQUENCE: AgentStatusValue[] = [
  'connecting', 'reading_page', 'protecting_data',
  'understanding_page', 'planning_action', 'executing',
]

const WORKING_SET = new Set<AgentStatusValue>(WORKING_SEQUENCE)

// Default placeholder stats — replace with backend data
const DEFAULT_STATS: PrivacyStatsData = {
  dataProtected: 72,
  elementsProcessed: 1284,
  sensitiveItemsHidden: 47,
  facesProtected: 3,
}

// ─────────────────────────────────────────────────────────
// Icons
// ─────────────────────────────────────────────────────────

function LogoMark({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M7 1.25 2.25 3v4.25C2.25 10.25 4.5 12.25 7 13.25c2.5-1 4.75-3 4.75-6V3L7 1.25Z"
        stroke="var(--accent)" strokeWidth="1.15" strokeLinejoin="round"
      />
      <path
        d="M5 7.25 6.5 8.75 9.5 5.75"
        stroke="var(--accent)" strokeWidth="1.15" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  )
}

function SendIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
      <path d="M11.5 6.5 1 2l1.8 4.5L1 11l10.5-4.5Z"
        stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  )
}

function GearIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
      <circle cx="6.5" cy="6.5" r="2" stroke="currentColor" strokeWidth="1.1" />
      <path d="M6.5 1.5v1M6.5 10.5v1M1.5 6.5h1M10.5 6.5h1M3.1 3.1l.7.7M9.2 9.2l.7.7M9.2 3.8l-.7.7M3.8 9.2l-.7.7"
        stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  )
}

function ArrowUpRight({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" fill="none" aria-hidden>
      <path d="M2 8 8 2M4 2h4v4"
        stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CheckIcon({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" fill="none" aria-hidden>
      <path d="M2 5.5 4.25 7.75 8.5 3"
        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function AlertIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M6 1 1 11h10L6 1Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M6 4.5v3M6 9h.01" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  )
}

function SlashIcon({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" fill="none" aria-hidden>
      <rect x="1.5" y="1.5" width="23" height="23" rx="5" stroke="var(--border)" strokeWidth="1.2" />
      <path d="M17 9 9 17" stroke="var(--text-3)" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

// ─────────────────────────────────────────────────────────
// Primitive components
// ─────────────────────────────────────────────────────────

function AgentAvatar({ size = 22 }: { size?: number }) {
  const r = Math.floor(size * 0.23)
  return (
    <div style={{
      width: size, height: size,
      borderRadius: r,
      background: 'var(--accent-dim)',
      border: '1px solid rgba(53,184,204,0.14)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
    }}>
      <LogoMark size={Math.floor(size * 0.56)} />
    </div>
  )
}

function StepRow({ step }: { step: ProgressStep }) {
  const done   = step.status === 'done'
  const active = step.status === 'active'

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 9,
      opacity: done ? 0.42 : 1,
      transition: 'opacity 0.4s ease',
    }}>
      {/* Indicator */}
      <div style={{ width: 14, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {done && (
          <span style={{ color: 'var(--green)', display: 'flex', lineHeight: 0 }}>
            <CheckIcon size={10} />
          </span>
        )}
        {active && (
          <span className="step-ring" style={{
            display: 'inline-block',
            width: 7, height: 7,
            borderRadius: '50%',
            border: '1.5px solid var(--accent)',
          }} />
        )}
        {step.status === 'pending' && (
          <span style={{
            display: 'inline-block',
            width: 3.5, height: 3.5,
            borderRadius: '50%',
            background: 'var(--text-3)',
          }} />
        )}
      </div>
      <span style={{
        fontSize: 11.5,
        lineHeight: 1.4,
        letterSpacing: '-0.005em',
        color: done ? 'var(--text-2)' : active ? 'var(--text-1)' : 'var(--text-3)',
        transition: 'color 0.25s ease',
      }}>
        {step.label}
      </span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────
// Section components — each maps to a backend data source
// ─────────────────────────────────────────────────────────

/* ── Header ─────────────────────────────────────────── */
function Header({
  status,
  onSettings,
}: {
  status: AgentStatusValue
  onSettings: () => void
}) {
  const meta = STATUS_META[status]
  return (
    <header style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '11px 15px',
      borderBottom: '1px solid var(--border-subtle)',
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <LogoMark size={14} />
        <span style={{
          fontSize: 13, fontWeight: 600,
          letterSpacing: '-0.018em',
          color: 'var(--text-1)',
        }}>
          PrivSight
        </span>
        <span style={{ width: 1, height: 11, background: 'var(--border)', display: 'block', flexShrink: 0 }} />
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span
            className={meta.working ? 'status-dot-working' : 'status-dot'}
            style={{
              width: 5, height: 5, borderRadius: '50%',
              background: meta.color,
              display: 'inline-block', flexShrink: 0,
              transition: 'background 0.3s ease',
            }}
          />
          <span style={{
            fontSize: 11, color: 'var(--text-3)',
            letterSpacing: '0.01em',
            transition: 'color 0.2s ease',
          }}>
            {meta.label}
          </span>
        </span>
      </div>
      <button className="icon-btn" aria-label="Settings" onClick={onSettings}>
        <GearIcon />
      </button>
    </header>
  )
}

/* ── Aurora line — thin sweep at the popup top ──────── */
function AuroraLine({ visible }: { visible: boolean }) {
  return (
    <div style={{
      height: visible ? 1.5 : 0,
      overflow: 'hidden',
      flexShrink: 0,
      position: 'relative',
      background: visible ? 'rgba(53,184,204,0.05)' : 'transparent',
      transition: 'height 0.4s ease',
    }}>
      {visible && <div className="aurora-sweep" />}
    </div>
  )
}

/* ── Active-on-page notice ──────────────────────────── */
function ActivePageNotice({ visible }: { visible: boolean }) {
  if (!visible) return null
  return (
    <div className="fade-in" style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      padding: '5px 15px',
      background: 'rgba(53,184,204,0.035)',
      borderBottom: '1px solid rgba(53,184,204,0.07)',
      flexShrink: 0,
    }}>
      <span className="status-dot-working" style={{
        width: 4, height: 4, borderRadius: '50%',
        background: 'var(--accent)', opacity: 0.7,
        display: 'inline-block', flexShrink: 0,
      }} />
      <span style={{
        fontSize: 10.5, color: 'rgba(53,184,204,0.6)',
        letterSpacing: '0.005em',
      }}>
        PrivSight is active on this page
      </span>
    </div>
  )
}

/* ── Agent status panel ─────────────────────────────── */
// Rendered inside the chat area while working.
// Wire agentState to the backend status-tick stream.
function AgentStatusPanel({ agentState }: { agentState: AgentState }) {
  return (
    <div className="rise" style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
      <AgentAvatar size={22} />
      <div style={{ flex: 1, paddingTop: 2 }}>
        <div style={{
          fontSize: 12.5, fontWeight: 500,
          color: 'var(--text-1)', letterSpacing: '-0.01em', marginBottom: 2,
        }}>
          {agentState.message}
        </div>
        <div style={{
          fontSize: 11.5, color: 'var(--text-2)',
          letterSpacing: '-0.005em', lineHeight: 1.55, marginBottom: 13,
        }}>
          {agentState.detail}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {agentState.steps.map(step => (
            <StepRow key={step.id} step={step} />
          ))}
        </div>
      </div>
    </div>
  )
}

/* ── Chat message bubble ────────────────────────────── */
function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  return (
    <div className="rise" style={{
      display: 'flex',
      flexDirection: isUser ? 'row-reverse' : 'row',
      alignItems: 'flex-end', gap: 7,
    }}>
      {!isUser && <AgentAvatar size={22} />}
      <div style={{
        maxWidth: '80%',
        padding: '8px 11px',
        borderRadius: isUser ? '10px 10px 2px 10px' : '2px 10px 10px 10px',
        background: isUser ? 'var(--surface-2)' : 'var(--surface)',
        border: `1px solid ${isUser ? 'var(--border)' : 'var(--border-subtle)'}`,
        fontSize: 12.5, lineHeight: 1.58,
        letterSpacing: '-0.006em',
        color: isUser ? 'var(--text-1)' : 'var(--text-2)',
      }}>
        {message.text}
      </div>
    </div>
  )
}

/* ── Completion indicator ───────────────────────────── */
// Shown after the last agent message when status is 'completed'
function CompletionRow() {
  return (
    <div className="fade-in" style={{
      display: 'flex', alignItems: 'center', gap: 5,
      paddingLeft: 29, // aligns with message text (avatar width + gap)
      marginTop: -4, marginBottom: 2,
    }}>
      <span style={{ color: 'var(--green)', display: 'flex', lineHeight: 0 }}>
        <CheckIcon size={10} />
      </span>
      <span style={{
        fontSize: 10.5, fontWeight: 500,
        color: 'var(--green)', letterSpacing: '0.01em',
      }}>
        Task completed
      </span>
    </div>
  )
}

/* ── Error state ────────────────────────────────────── */
// Inline in the chat flow. Wire message + retry to backend.
function ErrorState({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <div className="rise" style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
      <div style={{
        width: 22, height: 22, borderRadius: 5,
        background: 'var(--red-dim)',
        border: '1px solid rgba(217,80,80,0.14)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, color: 'var(--red)',
      }}>
        <AlertIcon size={11} />
      </div>
      <div style={{ paddingTop: 2 }}>
        <div style={{
          fontSize: 12, fontWeight: 500,
          color: 'var(--red)', marginBottom: 3,
          letterSpacing: '-0.005em',
        }}>
          Something went wrong
        </div>
        <div style={{
          fontSize: 12, color: 'var(--text-2)',
          lineHeight: 1.58, letterSpacing: '-0.005em',
          marginBottom: 9,
        }}>
          {message}
        </div>
        <button className="retry-btn" onClick={onRetry}>
          Try again
        </button>
      </div>
    </div>
  )
}

/* ── Page unavailable state ─────────────────────────── */
// Wire unavailableReason from PageContext backend type
function PageUnavailableState({ reason }: { reason?: string }) {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '0 36px 20px', textAlign: 'center',
    }}>
      <SlashIcon size={26} />
      <div style={{ height: 16 }} />
      <div style={{
        fontSize: 13.5, fontWeight: 500,
        color: 'var(--text-1)', letterSpacing: '-0.015em',
        lineHeight: 1.3, marginBottom: 7,
      }}>
        Can't access this page
      </div>
      <div style={{
        fontSize: 12, color: 'var(--text-2)',
        lineHeight: 1.65, maxWidth: 210, marginBottom: 18,
      }}>
        {reason ?? "PrivSight can't run on browser system pages. Open a regular webpage to get started."}
      </div>
      <button className="outline-btn" onClick={() => {}}>
        Open a new tab
      </button>
    </div>
  )
}

/* ── Empty state ────────────────────────────────────── */
function EmptyState() {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      justifyContent: 'center', paddingBottom: 10,
    }}>
      <h1 style={{
        fontSize: 15.5, fontWeight: 500,
        letterSpacing: '-0.025em', lineHeight: 1.25,
        color: 'var(--text-1)', marginBottom: 7,
      }}>
        How can I help on this page?
      </h1>
      <p style={{
        fontSize: 12, color: 'var(--text-2)',
        lineHeight: 1.68, maxWidth: 268,
      }}>
        PrivSight can interact with the current page while keeping sensitive information protected.
      </p>
    </div>
  )
}

/* ── Quick actions ──────────────────────────────────── */
function QuickActions({ onSelect }: { onSelect: (q: string) => void }) {
  return (
    <div style={{ padding: '0 15px 10px', flexShrink: 0 }}>
      <p style={{
        fontSize: 10, fontWeight: 500, color: 'var(--text-3)',
        textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 4,
      }}>
        Try asking
      </p>
      {SUGGESTIONS.map(({ label, query }) => (
        <button key={label} className="suggestion-btn" onClick={() => onSelect(query)}>
          <span style={{ fontSize: 12, color: 'var(--text-2)', letterSpacing: '-0.006em' }}>
            {label}
          </span>
          <span className="suggestion-arrow">
            <ArrowUpRight size={10} />
          </span>
        </button>
      ))}
    </div>
  )
}

/* ── Chat input ─────────────────────────────────────── */
// Wire onSend to the browser-agent task dispatch endpoint
function ChatInput({
  value,
  onChange,
  onSend,
  disabled,
}: {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  disabled?: boolean
}) {
  const [focused, setFocused] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const canSend = value.trim().length > 0 && !disabled

  function autosize(el: HTMLTextAreaElement | null) {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 80) + 'px'
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-end', gap: 8,
      background: 'var(--surface)',
      border: `1px solid ${focused && !disabled ? 'var(--accent)' : 'var(--border)'}`,
      borderRadius: 8,
      padding: '8px 8px 8px 12px',
      transition: 'border-color 0.15s',
      opacity: disabled ? 0.6 : 1,
    }}>
      <textarea
        ref={taRef}
        rows={1}
        value={value}
        onChange={e => { onChange(e.target.value); autosize(e.target) }}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend() } }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        disabled={disabled}
        placeholder="Ask PrivSight to do something..."
        style={{
          flex: 1, background: 'none', border: 'none', outline: 'none',
          resize: 'none', overflow: 'hidden',
          fontSize: 12.5, lineHeight: 1.5,
          letterSpacing: '-0.006em',
          color: 'var(--text-1)',
          paddingTop: 1, maxHeight: 80,
          cursor: disabled ? 'not-allowed' : 'text',
        }}
      />
      <button
        onClick={onSend}
        disabled={!canSend}
        aria-label="Send"
        style={{
          width: 27, height: 27, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: 5, border: 'none',
          cursor: canSend ? 'pointer' : 'default',
          background: canSend ? 'var(--accent)' : 'var(--surface-3)',
          color: canSend ? '#06060a' : 'var(--text-3)',
          transition: 'background 0.14s, color 0.14s',
        }}
      >
        <SendIcon />
      </button>
    </div>
  )
}

/* ── Privacy statistics ─────────────────────────────── */
// Wire stats prop to PrivacyStatsData from the sanitization pipeline
function PrivacyStats({
  stats,
  isWorking,
  unavailable,
}: {
  stats: PrivacyStatsData
  isWorking: boolean
  unavailable?: boolean
}) {
  const display = [
    { value: unavailable ? '—' : `${stats.dataProtected}%`,      label: 'Data protected'        },
    { value: unavailable ? '—' : stats.elementsProcessed.toLocaleString(), label: 'Elements processed' },
    { value: unavailable ? '—' : String(stats.sensitiveItemsHidden),       label: 'Sensitive items hidden' },
  ]

  return (
    <div style={{
      padding: '11px 15px 14px',
      borderTop: '1px solid var(--border-subtle)',
      flexShrink: 0,
    }}>
      {/* Row 1 — section label + status badge */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 9,
      }}>
        <span style={{
          fontSize: 10, fontWeight: 500, color: 'var(--text-3)',
          textTransform: 'uppercase', letterSpacing: '0.09em',
        }}>
          Privacy protection
        </span>
        <span style={{
          display: 'flex', alignItems: 'center', gap: 4,
          fontSize: 10.5, fontWeight: 500, letterSpacing: '0.01em',
          color: unavailable ? 'var(--text-3)' : 'var(--green)',
          transition: 'color 0.3s',
        }}>
          <span style={{
            width: 4.5, height: 4.5, borderRadius: '50%',
            background: unavailable ? 'var(--text-3)' : 'var(--green)',
            display: 'inline-block',
            transition: 'background 0.3s',
          }} />
          {unavailable ? 'Inactive' : 'Protected'}
        </span>
      </div>

      {/* Progress bar — wire width to dataProtected */}
      <div style={{
        height: 2, borderRadius: 1,
        background: 'var(--surface-3)',
        overflow: 'hidden', position: 'relative',
        marginBottom: 11,
      }}>
        {!unavailable && (
          <div style={{
            width: `${stats.dataProtected}%`, height: '100%',
            borderRadius: 1, background: 'var(--accent)', opacity: 0.62,
            transition: 'width 1.2s ease',
          }} />
        )}
        {isWorking && !unavailable && <div className="progress-scan" />}
      </div>

      {/* Stat columns — wire each value to PrivacyStatsData fields */}
      <div style={{ display: 'flex' }}>
        {display.map(({ value, label }, i) => (
          <div key={label} style={{
            flex: 1,
            paddingLeft: i > 0 ? 13 : 0,
            borderLeft: i > 0 ? '1px solid var(--border-subtle)' : 'none',
          }}>
            <div style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 13.5, fontWeight: 500,
              letterSpacing: '-0.02em', lineHeight: 1.1,
              color: unavailable ? 'var(--text-3)' : 'var(--text-1)',
              transition: 'color 0.3s',
            }}>
              {value}
            </div>
            <div style={{
              fontSize: 10, color: 'var(--text-3)',
              marginTop: 3, lineHeight: 1.3, letterSpacing: '0.005em',
            }}>
              {label}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Demo controls — shown below the popup in the preview ── */
const DEMO_STATES: { status: AgentStatusValue; label: string }[] = [
  { status: 'idle',               label: 'Idle'        },
  { status: 'connecting',         label: 'Connecting'  },
  { status: 'understanding_page', label: 'Working'     },
  { status: 'completed',          label: 'Completed'   },
  { status: 'error',              label: 'Error'       },
  { status: 'page_unavailable',   label: 'Page N/A'    },
]

function DemoControls({
  current,
  onSelect,
}: {
  current: AgentStatusValue
  onSelect: (s: AgentStatusValue) => void
}) {
  return (
    <div style={{
      marginTop: 22,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9,
    }}>
      <span style={{
        fontSize: 9.5, color: 'rgba(255,255,255,0.18)',
        textTransform: 'uppercase', letterSpacing: '0.1em',
      }}>
        Preview state
      </span>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'center' }}>
        {DEMO_STATES.map(({ status, label }) => (
          <button
            key={status}
            className={`demo-state-btn${current === status ? ' active' : ''}`}
            onClick={() => onSelect(status)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────
// Main App
// ─────────────────────────────────────────────────────────

export default function App() {
  const [agentStatus, setAgentStatus] = useState<AgentStatusValue>('idle')
  const [messages, setMessages]       = useState<ChatMessage[]>([])
  const [input, setInput]             = useState('')
  const [stats, setStats]             = useState<PrivacyStatsData>(DEFAULT_STATS)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const endRef  = useRef<HTMLDivElement>(null)

  const isWorking      = WORKING_SET.has(agentStatus)
  const isUnavailable  = agentStatus === 'page_unavailable'
  const isError        = agentStatus === 'error'
  const isCompleted    = agentStatus === 'completed'
  const hasMessages    = messages.length > 0

  const currentAgentState: AgentState | null = isWorking
    ? { status: agentStatus, ...(AGENT_CONFIGS[agentStatus] ?? { message: '', detail: '', progress: 0, steps: [] }) }
    : null

  // Find the last agent message, used for the completion row
  const lastAgentMsg = [...messages].reverse().find(m => m.role === 'agent')

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, agentStatus])

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }, [])

  // Simulated agent sequence — replace with backend websocket/SSE stream
  function runSequence(userText: string) {
    clearTimers()
    const delays = [0, 550, 1100, 1750, 2400, 3050]

    WORKING_SEQUENCE.forEach((status, i) => {
      const t = setTimeout(() => {
        setAgentStatus(status)
        // Simulate stats updating mid-run
        if (status === 'protecting_data') {
          setStats(prev => ({
            ...prev,
            elementsProcessed: prev.elementsProcessed + 287,
            sensitiveItemsHidden: prev.sensitiveItemsHidden + 6,
          }))
        }
        if (status === 'understanding_page') {
          setStats(prev => ({
            ...prev,
            elementsProcessed: prev.elementsProcessed + 490,
            dataProtected: Math.min(prev.dataProtected + 11, 100),
          }))
        }
      }, delays[i])
      timers.current.push(t)
    })

    // Completion — add agent response
    const doneDelay = delays[delays.length - 1] + 750
    timers.current.push(setTimeout(() => {
      const lower = userText.toLowerCase()
      const match = MOCK_RESPONSES.find(([k]) => lower.includes(k))
      const text  = match?.[1] ?? "I can help with that. Could you tell me more about what you need on this page?"
      setMessages(prev => [...prev, { id: `a${Date.now()}`, role: 'agent', text, timestamp: Date.now() }])
      setStats(prev => ({ ...prev, dataProtected: Math.min(prev.dataProtected + 5, 100), facesProtected: prev.facesProtected + 2 }))
      setAgentStatus('completed')
    }, doneDelay))

    // Return to idle
    timers.current.push(setTimeout(() => setAgentStatus('idle'), doneDelay + 3200))
  }

  function handleSend() {
    const text = input.trim()
    if (!text || isWorking) return
    setMessages(prev => [...prev, { id: `u${Date.now()}`, role: 'user', text, timestamp: Date.now() }])
    setInput('')
    runSequence(text)
  }

  function handleRetry() {
    const lastUser = [...messages].reverse().find(m => m.role === 'user')
    if (!lastUser) return
    setMessages(prev => prev.filter(m => !m.isError))
    setAgentStatus('idle')
    setTimeout(() => runSequence(lastUser.text), 50)
  }

  // Demo control handler — sets up each state with realistic context
  function handleDemo(status: AgentStatusValue) {
    clearTimers()
    setInput('')

    if (status === 'idle') {
      setMessages([])
      setStats(DEFAULT_STATS)
      setAgentStatus('idle')
      return
    }

    if (status === 'page_unavailable') {
      setMessages([])
      setStats(DEFAULT_STATS)
      setAgentStatus('page_unavailable')
      return
    }

    // Seed a user message if none exist
    const seededMessages: ChatMessage[] = hasMessages
      ? messages
      : [{ id: 'demo-u', role: 'user', text: 'Summarize this page', timestamp: Date.now() }]

    if (status === 'connecting' || WORKING_SET.has(status)) {
      setMessages(seededMessages)
      setStats(DEFAULT_STATS)
      setAgentStatus(status)
      return
    }

    if (status === 'completed') {
      const withResponse: ChatMessage[] = [
        seededMessages[0],
        {
          id: 'demo-a',
          role: 'agent',
          text: "This page is a product landing page for a developer tool. Key points: self-hostable, starts at $12/mo, API access on all plans. Three pricing tiers. Privacy policy linked in the footer.",
          timestamp: Date.now(),
        },
      ]
      setMessages(withResponse)
      setStats({ dataProtected: 89, elementsProcessed: 2156, sensitiveItemsHidden: 63, facesProtected: 7 })
      setAgentStatus('completed')
      return
    }

    if (status === 'error') {
      const withError: ChatMessage[] = [
        seededMessages[0],
        {
          id: 'demo-err',
          role: 'agent',
          text: '',
          isError: true,
          timestamp: Date.now(),
        },
      ]
      setMessages(withError)
      setStats(DEFAULT_STATS)
      setAgentStatus('error')
      return
    }
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '36px 20px 40px',
      minHeight: '100%',
      background: 'var(--bg-outer)',
    }}>

      {/* ── Popup shell ───────────────────────────────── */}
      <div style={{
        width: 360, height: 560,
        background: 'var(--bg)',
        color: 'var(--text-1)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        borderRadius: 12,
        border: '1px solid var(--border)',
        boxShadow: '0 0 0 1px #02020a, 0 24px 64px rgba(0,0,0,0.72)',
        position: 'relative',
      }}>

        {/* Aurora edge */}
        <AuroraLine visible={isWorking} />

        {/* Header */}
        <Header status={agentStatus} onSettings={() => {}} />

        {/* Active page notice */}
        <ActivePageNotice visible={isWorking} />

        {/* ── Scrollable chat area ─────────────────────── */}
        <div style={{
          flex: 1, overflowY: 'auto',
          padding: '0 15px',
          display: 'flex', flexDirection: 'column',
        }}>

          {/* Empty state */}
          {!hasMessages && !isWorking && !isUnavailable && <EmptyState />}

          {/* Page unavailable */}
          {isUnavailable && <PageUnavailableState />}

          {/* Message list */}
          {hasMessages && <div style={{ height: 14 }} />}
          {messages.map((msg, i) => {
            const isLast = i === messages.length - 1
            const isLastAgent = isLast && msg.role === 'agent'
            return (
              <div key={msg.id} style={{ marginBottom: isLast ? 0 : 10 }}>
                {msg.isError ? (
                  <ErrorState
                    message="The page changed during the task. Please try again."
                    onRetry={handleRetry}
                  />
                ) : (
                  <MessageBubble message={msg} />
                )}
                {/* Completion row directly after last agent message */}
                {isCompleted && isLastAgent && !msg.isError && (
                  <div style={{ marginTop: 7 }}>
                    <CompletionRow />
                  </div>
                )}
              </div>
            )
          })}

          {/* Agent working panel */}
          {isWorking && currentAgentState && (
            <div style={{ marginTop: hasMessages ? 10 : 0 }}>
              <AgentStatusPanel agentState={currentAgentState} />
            </div>
          )}

          <div ref={endRef} style={{ height: 14 }} />
        </div>

        {/* Quick actions — idle, no messages */}
        {!hasMessages && !isWorking && !isUnavailable && (
          <QuickActions onSelect={q => setInput(q)} />
        )}

        {/* Input */}
        {!isUnavailable && (
          <div style={{
            padding: '0 15px 13px',
            flexShrink: 0,
            borderTop: hasMessages || isWorking ? '1px solid var(--border-subtle)' : 'none',
            paddingTop: hasMessages || isWorking ? 12 : 0,
          }}>
            <ChatInput
              value={input}
              onChange={setInput}
              onSend={handleSend}
              disabled={isWorking}
            />
          </div>
        )}

        {/* Privacy stats */}
        <PrivacyStats
          stats={stats}
          isWorking={isWorking}
          unavailable={isUnavailable}
        />

      </div>

      {/* Demo state selector */}
      <DemoControls current={agentStatus} onSelect={handleDemo} />

    </div>
  )
}
