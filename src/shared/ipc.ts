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
  settings(): Promise<{ maxPlanEur: number }>
  saveSettings(s: { maxPlanEur: number }): Promise<void>
}
