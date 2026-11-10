import { contextBridge, ipcRenderer } from 'electron'
import type { Api } from '../shared/ipc'

async function call(channel: string, ...args: unknown[]): Promise<any> {
  const r = await ipcRenderer.invoke(channel, ...args)
  if (!r.ok) throw new Error(r.error)
  return r.value
}

const api: Api = {
  keyStatus: () => call('key:status'),
  saveKey: (key, secret) => call('key:save', key, secret),
  clearKey: () => call('key:clear'),
  pairs: () => call('pairs'),
  price: (pairId) => call('price', pairId),
  balances: () => call('balances'),
  openOrders: () => call('orders:open'),
  send: (req) => call('send', req),
  cancelPlan: (userref) => call('plan:cancel', userref),
  cancelOrder: (txid) => call('order:cancel', txid),
  plans: () => call('plans'),
  settings: () => call('settings'),
  saveSettings: (s) => call('settings:save', s),
}

contextBridge.exposeInMainWorld('api', api)
