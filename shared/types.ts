export const METRICS = {
  session: 'claude_code.session.count',
  cost: 'claude_code.cost.usage',
  tokens: 'claude_code.token.usage',
  linesOfCode: 'claude_code.lines_of_code.count',
  activeTime: 'claude_code.active_time.total',
  editDecision: 'claude_code.code_edit_tool.decision'
} as const

export type MetricKey = keyof typeof METRICS

export const EVENTS = {
  apiRequest: 'claude_code.api_request',
  apiError: 'claude_code.api_error',
  toolResult: 'claude_code.tool_result',
  toolDecision: 'claude_code.tool_decision',
  userPrompt: 'claude_code.user_prompt'
} as const

export type Bucket = 'hour' | 'day'

// Derived from first_seen and revoked_at rather than stored, so it cannot drift
// out of agreement with the timestamps it summarises.
export type DeviceStatus = 'pending' | 'reporting' | 'revoked'

/** The Claude Code account a machine's token is claimed by, from the first telemetry it sent. */
export interface DeviceAccount {
  uuid: string
  email: string | null
}

/** The last time telemetry arrived under a different account and was refused. */
export interface DeviceAccountConflict {
  uuid: string
  at: string
  count: number
}

export interface DeviceInfo {
  id: string
  name: string
  tokenPrefix: string
  status: DeviceStatus
  createdAt: string
  firstSeen: string | null
  lastSeen: string | null
  revokedAt: string | null
  sessions: number
  account: DeviceAccount | null
  conflict: DeviceAccountConflict | null
}

// What a delete destroyed, via the cascade from telemetry.device.
export interface DeviceCascade {
  sessions: number
  metricPoints: number
  events: number
}

// The plaintext token exists in exactly one response and is never stored or
// returned again. Only its sha256 and a display prefix are kept.
export interface DeviceSecret {
  device: DeviceInfo
  token: string
}

export interface DeviceSummary {
  deviceId: string
  device: string
  costUsd: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  sessions: number
  linesAdded: number
  linesRemoved: number
  activeSeconds: number
  toolCalls: number
  toolFailures: number
  apiRequests: number
  apiErrors: number
  p50ToolMs: number | null
  p95ToolMs: number | null
  p50ApiMs: number | null
  p95ApiMs: number | null
}

export interface SeriesPoint {
  bucket: string
  deviceId: string
  device: string
  value: number
}

export interface BreakdownRow {
  deviceId: string
  device: string
  key: string
  value: number
}
