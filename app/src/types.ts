// Shared data models.

export type Speaker = 'A' | 'C' | '?' // Alan, Customer, unknown

export interface Segment {
  t: number // ms since call start
  spk: Speaker
  text: string
  /** Raw diarization id from the STT provider, if any */
  dz?: number
  /** Loudness at the glasses mic (dBFS), used to tell Alan from the customer */
  db?: number | null
  /** Speaker set by hand; never overwritten by the auto-labeler */
  manual?: boolean
}

export interface CardRef { t: number; kind: string; title: string; body: string }

export interface FollowUp {
  owner: 'Alan' | 'Customer' | 'Both'
  text: string
  due?: string
  done?: boolean
}

export interface CallSummary {
  generatedBy: 'auto' | 'ai'
  headline: string
  topics: string[]
  followUps: FollowUp[]
  prices: string[]
  volumes: string[]
  customerNeeds: string[]
  talkingPointsNext: string[]
  aiText?: string
}

export interface Call {
  id: string
  startedAt: number
  endedAt?: number
  customerId?: string
  customerName?: string
  otherLabel?: string
  segments: Segment[]
  cards: CardRef[]
  summary?: CallSummary
  notes?: string
}

export interface CallIndexEntry {
  id: string
  startedAt: number
  durationSec: number
  customerName?: string
  headline?: string
  openFollowUps: number
}

export interface CustomerItem {
  name: string // what they call it, e.g. "180 strips" or "deli turkey"
  volume?: string // e.g. "2,000 lb/week"
  price?: string // their current price, free text
  notes?: string
  /** Any other columns from your report: % vs LY, margin, YTD lbs… */
  metrics?: Record<string, string>
}

export interface Customer {
  id: string
  name: string
  aliases: string[]
  contact?: string
  segment?: string // retail, foodservice, distributor...
  location?: string
  items: CustomerItem[]
  /** Account-level numbers from your report (YTD lbs, % change, margin…) */
  metrics?: Record<string, string>
  /** When the numbers were last updated (YYYY-MM-DD) */
  metricsAsOf?: string
  notes: string
  /** Free-form facts learned from calls ("prefers Tuesday deliveries") */
  learned: string[]
  updatedAt: number
}

export interface KnowledgeDoc {
  id: string
  title: string
  kind: 'numbers' | 'report' | 'news' | 'notes' | 'pricing' | 'other'
  /** For weekly reports: the week/date the report covers (YYYY-MM-DD) */
  asOf?: string
  text: string
  addedAt: number
  /** Parsed table, if the doc looked like CSV/TSV */
  table?: { headers: string[]; rows: string[][] }
}

export interface Settings {
  sttProvider: 'deepgram' | 'none'
  deepgramKey: string
  micSource: 'glasses' | 'phone'
  aiProvider: 'none' | 'openai-compatible' | 'anthropic'
  aiBaseUrl: string
  aiKey: string
  aiModel: string
  dataBaseUrl: string
  myName: string
  alanLevelDb: number | null // calibrated voice level at the glasses mic
  defaultGrade: 'Choice' | 'Select'
  caseWeights: Record<string, number> // imps -> lb per case
  liveAiTips: boolean
  claudeProjectUrl: string
  /** Keep customer numbers and prep out of AI requests (default on) */
  aiPrivate: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  sttProvider: 'deepgram',
  deepgramKey: '',
  micSource: 'glasses',
  aiProvider: 'none',
  aiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  aiKey: '',
  aiModel: 'gemini-2.5-flash',
  dataBaseUrl: '',
  myName: 'Alan',
  alanLevelDb: null,
  defaultGrade: 'Choice',
  caseWeights: {},
  liveAiTips: false,
  claudeProjectUrl: '',
  aiPrivate: true,
}

// ---- USDA data shapes (written by the pipeline) ----
export interface Cut {
  grade: 'Choice' | 'Select' | 'Ungraded' | 'Branded'
  imps: string
  fat: number | null
  desc: string
  trades: number | null
  lbs: number | null
  low: number | null
  high: number | null
  wavg: number | null
  prev?: number | null
  prevDate?: string | null
  avg5?: number | null
  avg20?: number | null
  days?: number
}

export interface BeefData {
  source: string
  reportDate: string | null
  fetchedAt?: string
  cutout: {
    choice?: number; select?: number; choiceChg?: number; selectChg?: number
    spread?: number; loads?: number; avg5Choice?: number | null; avg20Choice?: number | null
  }
  primals: { name: string; choice: number | null; select: number | null }[]
  cuts: Cut[]
  ground: (Omit<Cut, 'grade'> & { type: string })[]
  trim: Omit<Cut, 'grade'>[]
  cutoutSeries?: [string, number, number | null][]
}

export interface SlaughterRow {
  today: number; weekAgo: number; yearAgo: number; wtd: number; prevWtd: number
  lyWtd: number; ytd: number; lyYtd: number; ytdPct: number
}

export interface MarketData {
  updatedAt?: string
  slaughter?: { reportDate: string | null; status: string; cattle?: SlaughterRow; calves?: SlaughterRow; hogs?: SlaughterRow }
  retail?: {
    reportDate: string | null
    summary: Record<string, { cw: number | null; pw: number | null; py: number | null }>
    items: { section: string; item: string; env: string; cond: string; stores: number | null; price: number | null; pwStores: number | null; pwPrice: number | null; pyStores: number | null; pyPrice: number | null }[]
  }
  fedCattle?: { reportDate: string | null; rows: { cls: string; basis: string; grade: string; head: number | null; price: number; low: number | null; high: number | null; weight: number | null }[] }
}

export interface NewsItem { title: string; link: string; source: string; date: string; topics: string[] }
export interface NewsData { updatedAt: string | null; topics: { id: string; label: string }[]; items: NewsItem[] }
