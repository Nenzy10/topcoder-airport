import React, { useState } from 'react'
import { useApi } from '../hooks.jsx'
import { post, put, fmt, money, pct } from '../api'

export default function Admin({ refreshKey, currency }) {
  const kpis = useApi('/api/kpis', [], refreshKey)
  const map = useApi('/api/map', [], refreshKey)
  const incidents = useApi('/api/incidents', [], refreshKey)
  const feed = useApi('/api/feed-health', [], refreshKey)
  const perf = useApi('/api/perf', [], refreshKey)
  const decisions = useApi('/api/decisions?limit=10', [], refreshKey)
  const campaignsApi = useApi('/api/campaigns', [], refreshKey)
  const [pin, setPin] = useState({ screenId: '', campaignId: '', reason: '' })
  const [pinMsg, setPinMsg] = useState('')
  async function pinDecision(e) {
    e.preventDefault()
    try { await post('/api/decisions/pin', pin); setPinMsg('Pinned ✓ — the engine will favour this campaign on that screen.') }
    catch (err) { setPinMsg(err.message) }
  }
  const [entity, setEntity] = useState('vendors')
  const [selectedScreen, setSelectedScreen] = useState(null)
  const master = useApi(entity ? `/api/master/${entity}` : null, [entity], refreshKey)
  const [form, setForm] = useState({})
  const [editId, setEditId] = useState(null)
  const [msg, setMsg] = useState('')

  const screens = map.data?.screens || []
  const presence = map.data?.presence || []

  async function saveMaster(e) {
    e.preventDefault()
    try {
      if (editId) await put(`/api/master/${entity}/${editId}`, form)
      else await post(`/api/master/${entity}`, form)
      setMsg('Saved ✓'); setForm({}); setEditId(null); master.reload()
    } catch (err) { setMsg(err.message) }
  }
  async function updateIncident(id, patch) {
    await post(`/api/incidents/${id}`, patch); incidents.reload()
  }

  const rows = Array.isArray(master.data) ? master.data : (master.data?.rows || master.data?.items || [])
  const fields = rows[0] ? Object.keys(rows[0]).filter(k => typeof rows[0][k] !== 'object').slice(0, 8) : ['name', 'code', 'status']

  return (
    <div className="darkTheme">
      <div className="row space"><h2>✈️ Admin Control Room</h2><span className="badge green">● LIVE NETWORK</span></div>
      {/* KPI strip */}
      <div className="grid grid6" style={{ margin: '12px 0' }}>
        {[
          ['Screens Online', kpis.data ? pct(kpis.data.screensOnlinePct) : '—'],
          ['Ad Plays Today', fmt(kpis.data?.playsToday)],
          ['Impressions', fmt(kpis.data?.impressionsToday)],
          ['Revenue Today', money(kpis.data?.revenueToday, currency)],
          ['Active Campaigns', fmt(kpis.data?.activeCampaigns)],
          ['Avg Latency', kpis.data ? `${kpis.data.avgLatencyMs} ms` : '—'],
        ].map(([l, v]) => <div key={l} className="card"><div className="kpiLabel">{l}</div><div className="kpi">{v}</div><div className="small muted">Decisions logged: {fmt(kpis.data?.decisionsLogged)}</div></div>)}
      </div>

      <div className="grid grid2">
        <div className="card">
          <h3>🗺️ Live Network Map — T1 / T2</h3>
          <div className="heatLegend"><span>🟢 Online</span><span>🟡 Degraded</span><span>🔴 Offline</span><span>🔥 Heat = passenger presence</span></div>
          <svg viewBox="0 0 800 340" style={{ width: '100%', background: '#0f172a', borderRadius: 8, marginTop: 10 }}>
            <rect x="10" y="20" width="380" height="300" rx="12" fill="#1e3a5f" stroke="#38bdf8" />
            <rect x="410" y="20" width="380" height="300" rx="12" fill="#312e81" stroke="#a78bfa" />
            <text x="30" y="45" fill="#fff" fontWeight="800">Terminal 1 — Gates 1–30</text>
            <text x="430" y="45" fill="#fff" fontWeight="800">Terminal 2 — Gates 31–60</text>
            {presence.map((p, i) => <ellipse key={i} cx={p.terminal === 'T2' || String(p.zone).includes('T2') ? 600 : 200} cy={120 + i * 28} rx={Math.min(110, 30 + (p.heat || p.pax / 20 || 20))} ry="22" fill="#f59e0b" opacity="0.18" />)}
            {presence.slice(0, 6).map((p, i) => <text key={'t' + i} x={20} y={290 - i * 16} fill="#fbbf24" fontSize="10">{p.zone}: {fmt(p.pax)} pax • {Math.round(p.intlPct || 0)}% intl</text>)}
            {screens.map((s, i) => {
              const x = s.x != null ? (s.x / 100) * 780 + 10 : 30 + (i % 28) * 26
              const y = s.y != null ? (s.y / 100) * 300 + 20 : 70 + Math.floor(i / 28) * 36
              const col = s.status === 'offline' ? '#ef4444' : s.status === 'degraded' ? '#f59e0b' : '#22c55e'
              return <g key={s.id} onClick={() => setSelectedScreen(s)} style={{ cursor: 'pointer' }}><circle cx={x} cy={y} r="6" fill={col} stroke="#fff" strokeWidth="1" /><title>{s.name} — {s.status}</title></g>
            })}
          </svg>
          {selectedScreen && <div style={{ marginTop: 10, background: '#0f172a', padding: 10, borderRadius: 8 }}><strong>{selectedScreen.name}</strong> • {selectedScreen.terminal} / {selectedScreen.zone} • Gate {selectedScreen.gate || '—'} • {selectedScreen.size} {selectedScreen.orientation} • Status: <b>{selectedScreen.status}</b> • Latency {selectedScreen.latencyMs}ms <button className="btn small secondary" onClick={() => setSelectedScreen(null)}>Close</button></div>}
          {!screens.length && <p className="muted">Loading map from /api/map… {map.err}</p>}
        </div>

        <div className="card">
          <h3>🚨 Incident Tracker</h3>
          <div style={{ maxHeight: 380, overflow: 'auto' }}>
            <table><thead><tr><th>Severity</th><th>Incident</th><th>Owner</th><th>Status</th></tr></thead>
              <tbody>{(incidents.data || []).map(inc => <tr key={inc.id}><td><span className={`badge ${inc.severity === 'high' || inc.severity === 'critical' ? 'red' : inc.severity === 'medium' ? 'amber' : 'blue'}`}>{inc.severity}</span></td><td><b>{inc.type}</b><br /><span className="small">{inc.message} • {inc.entity} {inc.createdAt}</span></td><td><input defaultValue={inc.owner || ''} style={{ width: 90 }} onBlur={e => updateIncident(inc.id, { owner: e.target.value })} /></td><td><select defaultValue={inc.status} onChange={e => updateIncident(inc.id, { status: e.target.value })}><option>open</option><option>investigating</option><option>resolved</option><option>closed</option></select></td></tr>)}</tbody></table>
            {!incidents.data?.length && <p className="muted">No incidents — network healthy.</p>}
          </div>
          <h3 style={{ marginTop: 16 }}>📡 Feed Health</h3>
          {(feed.data || []).map((f, i) => <div key={i} className="row space" style={{ padding: '6px 0', borderBottom: '1px solid #334155' }}><span><b>{f.source}</b> <span className="muted">{f.kind} • {f.adapter}</span></span><span className={`badge ${f.status === 'ok' || f.status === 'healthy' ? 'green' : 'amber'}`}>{f.status}</span><span className="small">{f.msgsPerMin}/min • last {f.lastMsg}</span></div>)}
          <h3 style={{ marginTop: 16 }}>⚡ Performance</h3>
          {perf.data && <div className="grid grid3"><div><div className="kpiLabel">API p95</div><b>{perf.data.apiP95Ms} ms</b></div><div><div className="kpiLabel">Playlist Build</div><b>{perf.data.playlistBuildMs} ms</b></div><div><div className="kpiLabel">Decision</div><b>{perf.data.decisionMs} ms</b></div></div>}
          {perf.data?.uptime7d && <div className="row" style={{ marginTop: 8 }}>{perf.data.uptime7d.map((d, i) => <div key={i} style={{ textAlign: 'center', flex: 1 }}><div className="bar"><i style={{ width: `${d.pct}%`, background: '#22c55e' }} /></div><span className="small">{d.day}<br />{d.pct}%</span></div>)}</div>}
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h3>🗂️ Master Data CRUD</h3>
        <div className="tabs">{['vendors', 'outlets', 'airlines', 'locations', 'screens'].map(e => <button key={e} className={entity === e ? 'active' : ''} onClick={() => { setEntity(e); setForm({}); setEditId(null) }}>{e}</button>)}</div>
        <form onSubmit={saveMaster} className="formGrid" style={{ marginBottom: 12 }}>
          {fields.map(f => <div key={f}><label>{f}</label><input value={form[f] ?? ''} onChange={e => setForm({ ...form, [f]: e.target.value })} placeholder={f} /></div>)}
          <div className="row"><button className="btn">{editId ? 'Update' : 'Create'} {entity.slice(0, -1)}</button>{msg && <span>{msg}</span>}</div>
        </form>
        <div style={{ maxHeight: 300, overflow: 'auto' }}><table><thead><tr>{fields.map(f => <th key={f}>{f}</th>)}<th></th></tr></thead><tbody>{rows.slice(0, 30).map((r, i) => <tr key={r.id || i}>{fields.map(f => <td key={f}>{String(r[f] ?? '')}</td>)}<td><button className="btn small secondary" onClick={() => { setEditId(r.id); setForm(r) }}>Edit</button></td></tr>)}</tbody></table></div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h3>🧠 Decision Log (auditable)</h3>
        <form onSubmit={pinDecision} className="formGrid" style={{ marginBottom: 12 }}>
          <div><label>Pin override — screen</label><select value={pin.screenId} onChange={e => setPin({ ...pin, screenId: e.target.value })} required><option value="">Choose screen…</option>{screens.map(s => <option key={s.id} value={s.id}>{s.name} ({s.id})</option>)}</select></div>
          <div><label>Campaign to pin</label><select value={pin.campaignId} onChange={e => setPin({ ...pin, campaignId: e.target.value })} required><option value="">Choose campaign…</option>{(campaignsApi.data || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div><label>Reason (logged)</label><input value={pin.reason} onChange={e => setPin({ ...pin, reason: e.target.value })} placeholder="e.g. Paid priority for launch week" required /></div>
          <div className="row"><button className="btn small">📌 Pin campaign</button>{pinMsg && <span className="small">{pinMsg}</span>}</div>
        </form>
        {(decisions.data || []).slice(0, 5).map((d, i) => <div key={d.id || i} style={{ padding: '8px 0', borderBottom: '1px solid #334155' }}><b>{d.at}</b> • Screen {d.screenId} ({d.zone}) → Winner: <b>{d.winner?.name}</b> score {d.winner?.score} — {d.reason}<div className="small muted">Candidates: {(d.candidates || []).map(c => `${c.name} ${c.final}`).join(' • ')}</div></div>)}
      </div>
    </div>
  )
}
