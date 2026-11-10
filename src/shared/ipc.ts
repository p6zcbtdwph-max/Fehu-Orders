// Gemeinsame Typen für Fenster und Hauptprozess
import type { LadderInput, LadderLevel, Side } from './ladder'

export interface PairDto {
  id: string
  name: string
  base: string
  quote: string
  priceDecimals: number
  volumeDecimals: number
  orderMin: number
  costMin: number
}

export interface SendRequest {
  pairId: string
  pairName: string
  side: Side
  input: LadderInput
  levels: LadderLevel[]
  validate: boolean
  postOnly: boolean
  /** Nur die ersten N gültigen Stufen (nah am Kurs) senden, der Rest kann später folgen */
  sendCount?: number
}

export interface SettingsDto {
  maxPlanEur: number
  watchlist: string[]
  currency: 'EUR' | 'USD'
}

export interface SendResult {
  userref: number
  validate: boolean
  orders: { index: number; price: number; volume: number; txid?: string; error?: string }[]
}

export interface OpenOrderDto {
  txid: string
  pair: string
  side: Side
  price: number
  volume: number
  filled: number
  cost: number
  fee: number
  userref: number
}

export interface PlanDto {
  userref: number
  createdAt: string
  pairId: string
  pairName: string
  side: Side
  input: LadderInput
  sent: number
  failed: number
  totalCost: number
  levels?: LadderLevel[]
  sentIndices?: number[]
  postOnly?: boolean
}

export interface TemplateDto {
  id: string
  name: string
  pairName: string
  input: LadderInput
  postOnly: boolean
}

export interface PlanStatusDto {
  userref: number
  open: number
  filled: number
  partial: number
  canceled: number
  filledVolume: number
  filledCost: number
  fees: number
  averagePrice: number
}

export interface Api {
  keyStatus(): Promise<{ hasKey: boolean; encryption: boolean }>
  saveKey(key: string, secret: string): Promise<void>
  clearKey(): Promise<void>
  pairs(): Promise<PairDto[]>
  price(pairId: string): Promise<number>
  balances(): Promise<Record<string, number>>
  openOrders(): Promise<OpenOrderDto[]>
  send(req: SendRequest): Promise<SendResult>
  cancelPlan(userref: number): Promise<number>
  cancelOrder(txid: string): Promise<void>
  plans(): Promise<PlanDto[]>
  settings(): Promise<SettingsDto>
  saveSettings(s: Partial<SettingsDto>): Promise<SettingsDto>
  usdRate(): Promise<number>
  sendRest(userref: number, validate: boolean): Promise<SendResult>
  ohlc(pairId: string, interval: number): Promise<[number, number][]>
  fees(pairId: string): Promise<{ maker: number; taker: number }>
  available(): Promise<Record<string, number>>
  templates(): Promise<TemplateDto[]>
  saveTemplate(t: TemplateDto): Promise<void>
  deleteTemplate(id: string): Promise<void>
  planStatus(): Promise<PlanStatusDto[]>
  onFills(cb: () => void): () => void
}
