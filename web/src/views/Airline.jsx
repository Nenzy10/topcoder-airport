import React, { useState } from 'react'
import { useApi } from '../hooks.jsx'
import { post, fmt } from '../api'

export default function Airline({ refreshKey, airlineCode }) {
  const flights = useApi(airlineCode ? `/api/airline/${airlineCode}/flights` : null, [airlineCode], refreshKey)
  const messages = useApi('/api/airline/messages', [], refreshKey)
  const goodwill = useApi('/api/airline/goodwill', [], refreshKey)
  const market = useApi('/api/airline/marketplace', [], refreshKey)
  const decisions = useApi('/api/decisions?limit=20', [], refreshKey)
  const [msgForm, setMsgForm] = useState({ gate: '42', text: 'Upgrade to Premium — lounge access included', kind: 'upgrade', scheduleWindow: 'boarding' })
  const [gw, setGw] = useState({ thresholdMin: 30, offer: 'Free meal voucher + lounge pass', coFundOutletId: '', active: true })
  const [note, setNote] = useState('')

  const list = flights.data || []
  const delayed = list.filter(f => (f.delayMin || 0) > 0)
  const avgDelay = list.length ? Math.round(list.reduce((a, f) => a + (f.delayMin || 0), 0) / list.length) : 0
  const totalPax = list.reduce((a, f) => a + (f.pax || 0), 0)

  async function sendMsg() {
    try { await post('/api/airline/messages', { airline: airlineCode, gate: msgForm.gate, text: msgForm.text, kind: msgForm.kind, scheduleWindow: msgForm.scheduleWindow }); messages.reload(); setNote('Gate message scheduled ✓') } catch (e) { setNote(e.message) }
  }
  async function saveGw() {
    try { await post('/api/airline/goodwill', { airline: airlineCode, thresholdMin: Number(gw.thresholdMin), offer: gw.offer, coFundOutletId: gw.coFundOutletId || undefined, active: gw.active }); goodwill.reload(); setNote('Goodwill rule saved ✓') } catch (e) { setNote(e.message) }
  }

  return (
    <div>
      <div className="row space"><h2>✈️ Airline — {airlineCode}</h2><span className="badge blue">{list.length} flights today • {fmt(totalPax)} pax • avg delay {avgDelay}m</span></div>
      {note && <div className="card" style={{ background: '#ecfdf5', margin: '10px 0' }}>{note}</div>}
      <div className="grid grid2" style={{ marginTop: 12 }}>
        <div className="card">
          <h3>My Flights Today</h3>
          <div style={{ maxHeight: 420, overflow: 'auto' }}><table><thead><tr><th>Flight</th><th>Dest</th><th>Gate</th><th>STD/ETD</th><th>Status</th><th>Load</th></tr></thead><tbody>{list.map((f, i) => <tr key={i}><td><b>{f.flightNo}</b></td><td>{f.dest} {f.destName}</td><td>{f.gate}</td><td>{f.std} / {f.etd}</td><td><span className={`badge ${f.delayMin > 15 ? 'red' : f.status === 'boarding' ? 'amber' : 'green'}`}>{f.status} {f.delayMin ? `+${f.delayMin}m` : ''}</span></td><td>{f.loadFactor != null ? `${Math.round(f.loadFactor * (f.loadFactor <= 1 ? 100 : 1))}%` : '—'}<br /><span className="small muted">{fmt(f.pax)} pax • {f.aircraft}</span></td></tr>)}</tbody></table></div>
        </div>
        <div>
          <div className="card">
            <h3>📣 Gate-Area Messaging</h3>
            <div className="formGrid">
              <div><label>Gate</label><input value={msgForm.gate} onChange={e => setMsgForm({ ...msgForm, gate: e.target.value })} /></div>
              <div><label>Kind</label><select value={msgForm.kind} onChange={e => setMsgForm({ ...msgForm, kind: e.target.value })}><option>upgrade</option><option>lounge</option><option>destination</option><option>partner</option></select></div>
              <div><label>Window</label><select value={msgForm.scheduleWindow} onChange={e => setMsgForm({ ...msgForm, scheduleWindow: e.target.value })}><option>boarding</option><option>pre-boarding</option><option>all-day</option></select></div>
              <div className="full"><label>Message</label><input value={msgForm.text} onChange={e => setMsgForm({ ...msgForm, text: e.target.value })} /></div>
            </div>
            <button className="btn" style={{ marginTop: 8 }} onClick={sendMsg}>Schedule at Gate</button>
            <div style={{ marginTop: 10 }}>{(messages.data || []).filter(m => !airlineCode || !m.airline || m.airline === airlineCode).slice(0, 6).map((m, i) => <div key={i} className="row space" style={{ padding: '5px 0', borderBottom: '1px solid #eee' }}><span>{m.text}</span><span className="badge">Gate {m.gate} • {m.kind}</span></div>)}</div>
          </div>
          <div className="card" style={{ marginTop: 14 }}>
            <h3>💛 Delay Goodwill Automation</h3>
            <div className="formGrid">
              <div><label>Threshold (min)</label><input type="number" value={gw.thresholdMin} onChange={e => setGw({ ...gw, thresholdMin: e.target.value })} /></div>
              <div><label>Co-fund Outlet ID</label><input value={gw.coFundOutletId} onChange={e => setGw({ ...gw, coFundOutletId: e.target.value })} placeholder="optional" /></div>
              <div className="full"><label>Offer</label><input value={gw.offer} onChange={e => setGw({ ...gw, offer: e.target.value })} /></div>
              <div><label><input type="checkbox" checked={gw.active} onChange={e => setGw({ ...gw, active: e.target.checked })} /> Active</label></div>
            </div>
            <button className="btn" style={{ marginTop: 8 }} onClick={saveGw}>Save Rule</button>
            <div style={{ marginTop: 10 }}><b>Rules:</b> {(goodwill.data?.rules || []).map((r, i) => <div key={i} className="small">• {r.airline} — delay &gt;{r.thresholdMin}m → {r.offer} {r.active ? '✅' : '⏸️'}</div>)}<b style={{ display: 'block', marginTop: 8 }}>Fired log:</b> {(goodwill.data?.fired || []).map((f, i) => <div key={i} className="small">• {f.flightId} — {f.offer} at {f.at}</div>)}{!goodwill.data?.fired?.length && <div className="small muted">No goodwill fired yet — inject a delay to trigger.</div>}</div>
          </div>
        </div>
      </div>
      <div className="grid grid2" style={{ marginTop: 14 }}>
        <div className="card">
          <h3>🤝 Co-Marketing Marketplace</h3>
          {(market.data || []).map((m, i) => <div key={i} className="row space" style={{ padding: '8px 0', borderBottom: '1px solid #eee' }}><span><b>{m.outletName}</b> — {m.offer}<br /><span className="small muted">{m.zone} • ${m.price}</span></span>{m.accepted ? <span className="badge green">Accepted ✓</span> : <button className="btn small" onClick={async () => { await post(`/api/airline/marketplace/${m.id}/accept`, {}); market.reload() }}>1-click Accept</button>}</div>)}
        </div>
        <div className="card">
          <h3>📊 Performance Among Own Passengers</h3>
          <div className="grid grid3"><div><div className="kpiLabel">Flights</div><div className="kpi">{list.length}</div></div><div><div className="kpiLabel">Delayed</div><div className="kpi">{delayed.length}</div></div><div><div className="kpiLabel">Passengers</div><div className="kpi">{fmt(totalPax)}</div></div></div>
          <p className="muted" style={{ marginTop: 10 }}>Derived from today's flights + decision log ({(decisions.data || []).length} recent decisions). Gate screens prioritise {airlineCode} content in its own boarding window (1.2× boost per contract).</p>
          <div>{list.slice(0, 4).map((f, i) => <div key={i} className="small" style={{ padding: '4px 0' }}>{f.flightNo} → {f.dest}: {fmt(f.pax)} pax exposed at Gate {f.gate}</div>)}</div>
        </div>
      </div>
    </div>
  )
}
