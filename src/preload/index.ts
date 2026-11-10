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
  ohlc: (pairId, interval) => call('ohlc', pairId, interval),
  fees: (pairId) => call('fees', pairId),
  available: () => call('available'),
  templates: () => call('templates'),
  saveTemplate: (t) => call('template:save', t),
  deleteTemplate: (id) => call('template:delete', id),
  planStatus: () => call('plans:status'),
  onFills: (cb) => {
    const h = () => cb()
    ipcRenderer.on('fills', h)
    return () => ipcRenderer.removeListener('fills', h)
  },
}

contextBridge.exposeInMainWorld('api', api)
