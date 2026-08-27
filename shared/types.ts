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

export interface RangeQuery {
  from: string
  to: string
  devices?: string[]
}

export interface DeviceSummary {
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
  device: string
  value: number
}

export interface BreakdownRow {
  device: string
  key: string
  value: number
}

export interface DeviceInfo {
  device: string
  firstSeen: string
  lastSeen: string
  sessions: number
}
