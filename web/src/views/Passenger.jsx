import React, { useState, useEffect } from 'react'
import { useApi, AdCard } from '../hooks.jsx'
import { get } from '../api'

export default function Passenger({ refreshKey }) {
  const screens = useApi('/api/screens', [], 0)
  const [screenId, setScreenId] = useState('')
  const [playlist, setPlaylist] = useState(null)
  const [showWhy, setShowWhy] = useState(false)
  const [countdown, setCountdown] = useState(null)

  useEffect(() => {
    if (!screenId && screens.data?.length) {
      const gate42 = screens.data.find(s => String(s.gate) === '42' || String(s.name).includes('42')) || screens.data[0]
      setScreenId(gate42.id)
    }
  }, [screens.data])

  async function load() { if (!screenId) return; try { setPlaylist(await get(`/api/screen/${screenId}/playlist`)) } catch {} }
  useEffect(() => { load() }, [screenId, refreshKey])
  useEffect(() => { const id = setInterval(load, 5000); return () => clearInterval(id) }, [screenId])
  useEffect(() => {
    if (!playlist?.promo?.expiresInSec) return
    setCountdown(playlist.promo.expiresInSec)
    const id = setInterval(() => setCountdown(c => (c > 0 ? c - 1 : 0)), 1000)
    return () => clearInterval(id)
  }, [playlist?.promo?.expiresInSec])

  const now = playlist?.now || {}
  const creative = now.creative || now.campaign?.creative || playlist?.now?.campaign
  const creativeObj = creative && creative.headline ? creative : { headline: now.campaign?.name || now.name || 'Welcome to Aurora International', sub: now.campaign?.headline || 'Duty-free, dining & lounges — right at your gate', cta: 'Explore Offers', template: 'promo' }
  const why = playlist?.why || {}
  const profile = why.profile || {}

  return (
    <div>
      <div className="row space" style={{ marginBottom: 12 }}>
        <h2>📺 Passenger Screen Simulator</h2>
        <div className="row"><label className="small"><b>Screen (by gate/zone):</b></label>
          <select value={screenId} onChange={e => setScreenId(e.target.value)}>{(screens.data || []).map(s => <option key={s.id} value={s.id}>{s.name} — {s.terminal}/{s.zone} Gate {s.gate} [{s.status}]</option>)}</select>
          <button className="btn secondary" onClick={() => setShowWhy(true)}>❓ Why this ad?</button>
        </div>
      </div>

      <div className="screenFrame">
        <div className="screen16" style={{ background: '#0b2239' }}>
          <div style={{ flex: 1, padding: 14 }}>
            <AdCard creative={creativeObj} />
            <div className="row space" style={{ color: '#fff', marginTop: 8 }}>
              <span className="small">Now playing: <b>{now.campaign?.name || creativeObj.headline}</b> • ends in {now.endsInSec ?? '—'}s</span>
              <span className="small">Up next: {(playlist?.queue || []).slice(0, 3).map(q => q.campaign?.name || q.name || q.campaignId).join(' → ')}</span>
            </div>
            {playlist?.promo && <div className="row" style={{ background: '#fff', color: '#111', borderRadius: 10, padding: 10, marginTop: 10 }}>
              {playlist.promo.qrDataUrl && <img src={playlist.promo.qrDataUrl} alt="Promo QR" width="110" />}
              <div><b style={{ fontSize: 18 }}>Scan to claim: {playlist.promo.code}</b><br />Claim: {playlist.promo.claimUrl}<br /><span className="badge amber">⏳ Expires in {countdown != null ? `${Math.floor(countdown / 60)}:${String(countdown % 60).padStart(2, '0')}` : '—'}</span></div>
            </div>}
          </div>
          <div className="fids"><b>✈️ DEPARTURES</b>{(playlist?.contextFlights || []).map((f, i) => <span key={i} style={{ borderLeft: '1px solid #334155', paddingLeft: 10 }}>{f.flightNo} → {f.dest} • Gate {f.gate} • {f.std} • <b>{f.status}</b>{f.delayMin ? ` +${f.delayMin}m` : ''}</span>)}{!playlist?.contextFlights?.length && <span>No nearby flights in this window</span>}</div>
        </div>
      </div>

      {showWhy && (
        <div className="modalOverlay" onClick={() => setShowWhy(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="row space"><h3>❓ Why this ad?</h3><button className="btn ghost" onClick={() => setShowWhy(false)}>✕</button></div>
            <h4>Crowd profile at this screen</h4>
            {Object.entries(profile).map(([k, v]) => { const val = typeof v === 'number' ? (v <= 1 ? v * 100 : v) : 0; return <div key={k} style={{ margin: '7px 0' }}><div className="row space"><span>{k}</span><b>{typeof v === 'number' ? Math.round(val) + (k.includes('dwell') ? ' min' : '%') : String(v)}</b></div>{typeof v === 'number' && <div className="bar"><i style={{ width: `${Math.min(100, val)}%` }} /></div>}</div> })}
            <h4>Top-3 candidates</h4>
            {(why.candidates || []).slice(0, 3).map((c, i) => <div key={i} className="row space" style={{ padding: '6px 0', borderBottom: '1px solid #eee' }}><span>#{i + 1} {c.name || c.campaignName} — match {c.match} × boost {c.boost}</span><b>final {c.final ?? c.score}</b></div>)}
            <p style={{ background: '#eff6ff', padding: 10, borderRadius: 8 }}><b>Winning rule:</b> {why.winner?.name || why.winner?.campaignName || playlist?.why?.reason || 'Highest final score after hard filters (schedule, zones, approval, budget, frequency cap) + delay boost where applicable.'}</p>
          </div>
        </div>
      )}
      <p className="muted small" style={{ marginTop: 10 }}>Playlist refreshes on SSE decision events + 5s poll. Worked example: jump sim to 14:10, Gate 42 screen — SkyScent Perfume should win (~0.86) with XY501 delayed.</p>
    </div>
  )
}
