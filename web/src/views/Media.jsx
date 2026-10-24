import React, { useState } from 'react'
import { useApi } from '../hooks.jsx'
import { post, fmt, money } from '../api'

export default function Media({ refreshKey, currency }) {
  const cal = useApi('/api/media/calendar', [], refreshKey)
  const yld = useApi('/api/media/yield', [], refreshKey)
  const approvals = useApi('/api/media/approvals', [], refreshKey)
  const advertisers = useApi('/api/media/advertisers', [], refreshKey)
  const packages = useApi('/api/packages', [], refreshKey)
  const [checks, setChecks] = useState({})
  const [report, setReport] = useState(null)
  const [pkg, setPkg] = useState({ name: 'Gate High Impact Pack', screenIds: '', hours: '14,15,16', discountPct: 10 })
  const [msg, setMsg] = useState('')

  const screens = cal.data?.screens || []
  const hours = cal.data?.hours || [5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23]
  const cells = cal.data?.cells || {}
  const maxRev = Math.max(...(yld.data?.forecast7d || []).map(x => x.revenue || 0), 1)

  async function decide(id, decision) {
    await post(`/api/media/approvals/${id}`, { decision, checklist: checks[id] || {} }); approvals.reload(); setMsg(`${decision} submitted ✓`)
  }
  async function loadReport(id) {
    const r = await fetch(`/api/report/advertiser/${id}`).then(x => x.json()); setReport(r)
  }
  async function createPkg() {
    try { await post('/api/packages', { name: pkg.name, screenIds: pkg.screenIds.split(',').map(s => s.trim()).filter(Boolean), hours: pkg.hours.split(',').map(Number), discountPct: Number(pkg.discountPct) }); packages.reload(); setMsg('Package created ✓') } catch (e) { setMsg(e.message) }
  }

  return (
    <div>
      <div className="row space"><h2>📺 Media Manager</h2><span className="badge blue">Occupancy {yld.data?.occupancyPct ?? '—'}%</span></div>
      {msg && <div className="card" style={{ background: '#ecfdf5', margin: '10px 0' }}>{msg}</div>}

      <div className="card" style={{ marginTop: 12 }}>
        <h3>🗓️ Inventory Calendar — Screen × Hour (hover for price)</h3>
        <div className="calGrid"><table><thead><tr><th>Screen</th>{hours.map(h => <th key={h}>{h}:00</th>)}</tr></thead>
          <tbody>{screens.slice(0, 18).map(s => <tr key={s.id}><td><b>{s.name || s.id}</b></td>{hours.map(h => { const c = cells[`${s.id}|${h}`] || {}; return <td key={h} className={`calCell ${c.status || 'available'}`} title={`${c.campaignName || 'Available'} — ${c.price ? money(c.price, currency) : ''}`}>{c.price ? `$${c.price}` : '—'}<br /><span className="small">{c.status || 'avail'}</span></td> })}</tr>)}</tbody></table></div>
        <div className="row" style={{ marginTop: 8 }}><span className="badge" style={{ background: '#fecaca' }}>Booked</span><span className="badge" style={{ background: '#bbf7d0' }}>Available</span><span className="badge" style={{ background: '#fde68a' }}>Premium (high footfall)</span></div>
      </div>

      <div className="grid grid2" style={{ marginTop: 14 }}>
        <div className="card">
          <h3>📈 Yield & Pricing — 7-Day Forecast</h3>
          <div className="row" style={{ alignItems: 'flex-end', height: 140, gap: 10 }}>{(yld.data?.forecast7d || []).map((d, i) => <div key={i} style={{ flex: 1, textAlign: 'center' }}><div style={{ background: '#0f4c81', height: `${(d.revenue / maxRev) * 110}px`, borderRadius: '6px 6px 0 0' }} /><div className="small">{d.day}<br /><b>{money(d.revenue, currency)}</b></div></div>)}</div>
          <h4>Suggested prices</h4>
          {(yld.data?.suggestions || []).slice(0, 8).map((s, i) => <div key={i} className="row space" style={{ padding: '5px 0', borderBottom: '1px solid #eee' }}><span>Screen {s.screenId} • {s.hour}:00 • presence {fmt(s.presence)}</span><b>{money(s.price, currency)}</b></div>)}
        </div>
        <div className="card">
          <h3>✅ Approval Queue — Brand Safety Checklist</h3>
          {(approvals.data || []).map((a, i) => {
            const id = a.campaignId || a.id
            const cl = a.checklist || {}
            return <div key={i} style={{ border: '1px solid #eee', borderRadius: 8, padding: 10, marginBottom: 10 }}>
              <b>{a.name}</b> — {a.advertiserName} <span className="badge amber">{a.status}</span>
              <div className="small muted">{a.creative?.headline} • {a.creative?.sub}</div>
              <div className="row" style={{ margin: '8px 0' }}>{['logo', 'claims', 'language', 'noCompetitorConflict', 'imageRights'].map(k => <label key={k} className="small"><input type="checkbox" checked={checks[id]?.[k] ?? !!cl[k]} onChange={e => setChecks({ ...checks, [id]: { ...(checks[id] || {}), [k]: e.target.checked } })} /> {k}</label>)}</div>
              <div className="row"><button className="btn success small" onClick={() => decide(id, 'approve')}>Approve</button><button className="btn danger small" onClick={() => decide(id, 'reject')}>Reject</button></div>
            </div>
          })}
          {!approvals.data?.length && <p className="muted">Queue empty.</p>}
        </div>
      </div>

      <div className="grid grid2" style={{ marginTop: 14 }}>
        <div className="card">
          <h3>🏢 Advertiser Overview</h3>
          <table><thead><tr><th>Advertiser</th><th>Spend</th><th>Running</th><th>Flag</th><th></th></tr></thead><tbody>{(advertisers.data || []).map((a, i) => <tr key={i}><td><b>{a.name}</b></td><td>{money(a.spend, currency)}</td><td>{a.running}</td><td>{a.underDelivering ? <span className="badge red">Under-delivering</span> : <span className="badge green">On track</span>}</td><td><button className="btn small secondary" onClick={() => loadReport(a.id)}>Report</button></td></tr>)}</tbody></table>
          {report && <div className="printReport" style={{ marginTop: 12, border: '1px solid #ddd', padding: 14 }}><h3>Advertiser Report — {report.advertiserName || report.name || report.advertiserId}</h3><pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{JSON.stringify(report, null, 2)}</pre><button className="btn small" onClick={() => window.print()}>Print / Share</button></div>}
        </div>
        <div className="card">
          <h3>📦 Package Builder</h3>
          <div className="formGrid">
            <div className="full"><label>Package name</label><input value={pkg.name} onChange={e => setPkg({ ...pkg, name: e.target.value })} /></div>
            <div><label>Screen IDs (comma)</label><input value={pkg.screenIds} onChange={e => setPkg({ ...pkg, screenIds: e.target.value })} placeholder="from calendar, e.g. S-042" /></div>
            <div><label>Hours (comma)</label><input value={pkg.hours} onChange={e => setPkg({ ...pkg, hours: e.target.value })} /></div>
            <div><label>Discount %</label><input type="number" value={pkg.discountPct} onChange={e => setPkg({ ...pkg, discountPct: e.target.value })} /></div>
          </div>
          <button className="btn" style={{ marginTop: 10 }} onClick={createPkg}>Create Package</button>
          <div style={{ marginTop: 10 }}>{(packages.data || []).map((p, i) => <div key={i} className="row space" style={{ padding: '5px 0', borderBottom: '1px solid #eee' }}><span><b>{p.name}</b></span><span className="small">{(p.screenIds || []).length} screens • {p.discountPct}% off</span></div>)}</div>
        </div>
      </div>
    </div>
  )
}
