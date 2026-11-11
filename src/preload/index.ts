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
  verifyKey: () => call('key:verify'),
  clearKey: () => call('key:clear'),
  pairs: () => call('pairs'),
  price: (pairId) => call('price', pairId),
  prices: (pairIds) => call('prices', pairIds),
  balances: () => call('balances'),
  openOrders: () => call('orders:open'),
  send: (req) => call('send', req),
  cancelPlan: (userref) => call('plan:cancel', userref),
  cancelOrder: (txid) => call('order:cancel', txid),
  cancelAll: () => call('orders:cancelAll'),
  systemStatus: () => call('system:status'),
  log: () => call('log'),
  backupExport: () => call('backup:export'),
  backupPick: () => call('backup:pick'),
  backupRestore: () => call('backup:restore'),
  plans: () => call('plans'),
  settings: () => call('settings'),
  saveSettings: (s) => call('settings:save', s),
  usdRate: () => call('usdRate'),
  sendRest: (userref, validate) => call('plan:rest', userref, validate),
  ohlc: (pairId, interval) => call('ohlc', pairId, interval),
  fees: (pairId) => call('fees', pairId),
  available: () => call('available'),
  templates: () => call('templates'),
  saveTemplate: (t) => call('template:save', t),
  deleteTemplate: (id) => call('template:delete', id),
  planStatus: () => call('plans:status'),
  drafts: () => call('drafts'),
  saveDraft: (d) => call('draft:save', d),
  deleteDraft: (id) => call('draft:delete', id),
  onFills: (cb) => {
    const h = () => cb()
    ipcRenderer.on('fills', h)
    return () => ipcRenderer.removeListener('fills', h)
  },
  onOpenPage: (cb) => {
    const h = (_e: unknown, page: string) => cb(page)
    ipcRenderer.on('open-page', h)
    return () => ipcRenderer.removeListener('open-page', h)
  },
}

contextBridge.exposeInMainWorld('api', api)
