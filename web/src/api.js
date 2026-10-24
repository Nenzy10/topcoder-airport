export async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts })
  if (!res.ok) {
    let msg = res.statusText
    try { const j = await res.json(); msg = j.error || j.message || msg } catch {}
    throw new Error(msg)
  }
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('application/json')) return res.json()
  return res.text()
}
export const get = (p) => api(p)
export const post = (p, body) => api(p, { method: 'POST', body: JSON.stringify(body || {}) })
export const put = (p, body) => api(p, { method: 'PUT', body: JSON.stringify(body || {}) })

export function fmt(n) {
  if (n == null) return '—'
  if (typeof n === 'number') return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
  return String(n)
}
export function money(n, cur = 'USD') {
  if (n == null || isNaN(n)) return '—'
  return `${cur} ${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}
export function pct(n) { return n == null ? '—' : `${Number(n).toFixed(1)}%` }
