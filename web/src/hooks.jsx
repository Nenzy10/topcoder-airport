import { useState, useEffect, useCallback } from 'react'
import { get } from './api'

export function useApi(path, deps = [], refreshKey = 0) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    if (!path) return
    try { const d = await get(path); setData(d); setErr('') } catch (e) { setErr(e.message) } finally { setLoading(false) }
  }, [path])
  useEffect(() => { load() }, [load, refreshKey, ...deps])
  useEffect(() => { const id = setInterval(load, 5000); return () => clearInterval(id) }, [load])
  return { data, err, loading, reload: load, setData }
}

export function AdCard({ creative, lang }) {
  if (!creative) return <div className="adPreview"><h2>Your brand here</h2><p>Select a creative to preview</p></div>
  const bg = creative.template === 'food' ? 'linear-gradient(135deg,#b45309,#dc2626)' : creative.template === 'luxury' ? 'linear-gradient(135deg,#111827,#7c3aed)' : creative.template === 'family' ? 'linear-gradient(135deg,#059669,#0ea5e9)' : 'linear-gradient(135deg,#0f4c81,#7c3aed)'
  return (
    <div className="adPreview" style={{ background: bg }}>
      <div className="badge" style={{ alignSelf: 'flex-start', background: 'rgba(255,255,255,.25)', color: '#fff' }}>{creative.template || 'promo'} • {creative.lang || lang || 'EN'}</div>
      <h2>{creative.headline}</h2>
      <p>{creative.sub}</p>
      <div><span className="btn" style={{ background: '#fff', color: '#111' }}>{creative.cta || 'Shop Now'}</span></div>
      {creative.name && <div className="small" style={{ marginTop: 8, opacity: .8 }}>{creative.name}</div>}
    </div>
  )
}
