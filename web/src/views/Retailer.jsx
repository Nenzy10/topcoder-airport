import React, { useState, useEffect } from 'react'
import { useApi, AdCard } from '../hooks.jsx'
import { post, fmt, money, pct } from '../api'

export default function Retailer({ refreshKey, outletId, currency, lang, onUseCreative, externalCreative }) {
  const dash = useApi(outletId ? `/api/retailer/${outletId}/dashboard` : null, [outletId], refreshKey)
  const flow = useApi(outletId ? `/api/retailer/${outletId}/flow` : null, [outletId], refreshKey)
  const creatives = useApi('/api/creatives', [], refreshKey)
  const campaigns = useApi('/api/campaigns', [], refreshKey)
  const promos = useApi(outletId ? `/api/promos?outletId=${outletId}` : null, [outletId], refreshKey)
  const history = useApi('/api/history', [], refreshKey)
  const triggers = useApi('/api/triggers', [], refreshKey)
  const flights = useApi('/api/flights', [], refreshKey)

  const [form, setForm] = useState({ name: 'New Campaign — 15% Off', creativeId: '', zones: 'gates-high', destinations: 'DXB,LHR,SIN', domIntl: 'intl', dwellMin: 30, delayOnly: false, start: '14:00', end: '16:00', budget: 500 })
  const [preview, setPreview] = useState(null)
  const [createdId, setCreatedId] = useState(null)
  const [msg, setMsg] = useState('')
  const [promoForm, setPromoForm] = useState({ discount: 15, flightId: '' })
  const [lastPromo, setLastPromo] = useState(null)
  const [triggerForm, setTriggerForm] = useState({ dest: 'DXB', delayMin: 30, discount: 15, text: '15% off — delayed flight treat', zone: 'gates-high' })
  const [stockPause, setStockPause] = useState(false)
  const [recs, setRecs] = useState(null)
  const [genBrief, setGenBrief] = useState('')
  const [genLang, setGenLang] = useState('en')
  const [genCreative, setGenCreative] = useState(null)

  const selectedCreative = (creatives.data || []).find(c => String(c.id) === String(form.creativeId)) || (creatives.data || [])[0]
  const mockCreative = externalCreative || selectedCreative

  useEffect(() => { if (externalCreative) setGenCreative(externalCreative) }, [externalCreative])

  async function createCampaign(e) {
    e.preventDefault()
    try {
      const body = { name: form.name, outletId, creativeId: form.creativeId || selectedCreative?.id, zones: form.zones.split(',').map(s => s.trim()), audience: { destinations: form.destinations.split(',').map(s => s.trim()).filter(Boolean), domIntl: form.domIntl, dwellMin: Number(form.dwellMin), delayOnly: !!form.delayOnly }, schedule: { start: form.start, end: form.end }, budget: Number(form.budget), status: 'draft' }
      const c = await post('/api/campaigns', body)
      setCreatedId(c.id); setMsg(`Campaign created: ${c.name || form.name} (${c.status || 'draft'}) ✓`)
      campaigns.reload()
      // audience preview
      try {
        const zone = body.zones[0]
        const p = await fetch(`/api/campaigns/${c.id}/audience-preview?zone=${encodeURIComponent(zone)}&from=${form.start}&to=${form.end}`).then(r => r.json())
        setPreview(p)
      } catch {}
      // recommendations
      try { const r = await fetch(`/api/recommend/slots?campaignId=${c.id}`).then(x => x.json()); setRecs(r.slots || r) } catch {}
    } catch (err) { setMsg(err.message) }
  }

  async function createPromo() {
    try {
      const r = await post('/api/promos', { outletId, campaignId: createdId || campaigns.data?.[0]?.id, discount: Number(promoForm.discount), flightId: promoForm.flightId || flights.data?.[0]?.id })
      setLastPromo(r); promos.reload(); setMsg('Promo created ✓ — share code is the family second code')
    } catch (e) { setMsg(e.message) }
  }
  async function createTrigger() {
    try { await post('/api/triggers', { condition: { dest: triggerForm.dest, delayMin: Number(triggerForm.delayMin) }, action: { discount: Number(triggerForm.discount), text: triggerForm.text }, zone: triggerForm.zone }); triggers.reload(); setMsg('Trigger created ✓') } catch (e) { setMsg(e.message) }
  }
  async function genai() {
    try { const r = await post('/api/genai/brief', { brief: genBrief, lang: genLang }); setGenCreative(r.creative); setMsg(r.rationale || 'Generated ✓') } catch (e) { setMsg(e.message) }
  }

  const d = dash.data || {}
  const f = flow.data || {}
  const profile = f.profile || {}

  return (
    <div>
      <div className="row space"><h2>🛍️ Retailer Dashboard {outletId && <span className="muted">— Outlet {outletId}</span>}</h2><span className="badge green">● LIVE • ticking via SSE + 5s poll</span></div>
      {msg && <div className="card" style={{ background: '#ecfdf5', margin: '10px 0' }}>{msg}</div>}
      <div className="grid grid4" style={{ margin: '12px 0' }}>
        {[['Impressions', fmt(d.impressions ?? d.today?.impressions)], ['Scans', fmt(d.scans ?? d.today?.scans)], ['Redemptions', fmt(d.redemptions ?? d.today?.redemptions)], ['Conversion', pct(d.conversionPct)], ['Attributed Revenue', money(d.attributedRevenue ?? d.today?.attributedRevenue, currency)]].map(([l, v]) => <div key={l} className="card"><div className="kpiLabel">{l}</div><div className="kpi">{v}</div></div>)}
      </div>

      <div className="grid grid2">
        <div className="card">
          <h3>👥 Passenger Flow Near Store — Next 2 Hours</h3>
          <p style={{ fontSize: 16 }}><b>Next 60 min: {fmt(f.next60 ?? f.pax)} pax, {Math.round(f.intlPct || 0)}% international</b></p>
          <p className="muted">Next 120 min: {fmt(f.next120)} pax • Zone: {f.zone || '—'} • Dwell median: {profile.dwellMedianMin || '—'} min</p>
          <div className="row"><span>Top destinations:</span>{(f.topDestinations || []).map((x, i) => <span key={i} className="badge blue">{x.code} — {fmt(x.pax)}</span>)}</div>
          <div className="row" style={{ marginTop: 6 }}><span>Top nationalities:</span>{(f.topNationalities || []).map((x, i) => <span key={i} className="badge">{x.name} {x.pct}%</span>)}</div>
          <div style={{ marginTop: 10 }}>{[['Holiday', profile.holiday], ['Family', profile.family], ['Business', profile.business]].map(([l, v]) => <div key={l} style={{ margin: '6px 0' }}><div className="row space"><span>{l}</span><b>{v != null ? Math.round(v * (v <= 1 ? 100 : 1)) + '%' : '—'}</b></div><div className="bar"><i style={{ width: `${v != null ? (v <= 1 ? v * 100 : v) : 0}%` }} /></div></div>)}</div>
        </div>

        <div className="card">
          <h3>🎟️ Promo Codes — Flight-Linked QR</h3>
          <div className="formGrid">
            <div><label>Discount %</label><input type="number" value={promoForm.discount} onChange={e => setPromoForm({ ...promoForm, discount: e.target.value })} /></div>
            <div><label>Linked Flight</label><select value={promoForm.flightId} onChange={e => setPromoForm({ ...promoForm, flightId: e.target.value })}><option value="">Auto / first flight</option>{(flights.data || []).slice(0, 30).map(fl => <option key={fl.id} value={fl.id}>{fl.flightNo} → {fl.dest} {fl.std}</option>)}</select></div>
          </div>
          <button className="btn" style={{ marginTop: 10 }} onClick={createPromo}>Create Promo + QR</button>
          {lastPromo && <div style={{ marginTop: 12, textAlign: 'center' }}>{lastPromo.qrDataUrl && <img src={lastPromo.qrDataUrl} alt="QR" width="150" />}<div><b>{lastPromo.promo?.code || lastPromo.code}</b> • Expires {lastPromo.promo?.expiresAt} (boarding close)<br /><span className="small">{lastPromo.claimUrl}</span><br />Family share code: <b>{lastPromo.promo?.shareCode || '—'}</b></div></div>}
          <div style={{ marginTop: 10 }}>{(promos.data || []).map((p, i) => <div key={i} className="row space" style={{ borderBottom: '1px solid #eee', padding: '6px 0' }}><span><b>{p.code}</b> — {p.discount}% off • exp {p.expiresAt}</span><span className="badge">{p.redemptions}/{p.maxRedemptions} used • share: {p.shareCode}</span></div>)}</div>
        </div>
      </div>

      {/* Campaign Builder */}
      <div className="card" style={{ marginTop: 14 }}>
        <h3>🎯 Campaign Builder + Live Audience-Match Preview + Mock Screen</h3>
        <div className="grid grid2">
          <form onSubmit={createCampaign} className="formGrid">
            <div className="full"><label>Campaign name</label><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div><label>Creative</label><select value={form.creativeId} onChange={e => setForm({ ...form, creativeId: e.target.value })}><option value="">Select creative…</option>{(creatives.data || []).map(c => <option key={c.id} value={c.id}>{c.name} — {c.headline}</option>)}</select></div>
            <div><label>Zones (comma)</label><input value={form.zones} onChange={e => setForm({ ...form, zones: e.target.value })} /></div>
            <div><label>Destinations (comma)</label><input value={form.destinations} onChange={e => setForm({ ...form, destinations: e.target.value })} /></div>
            <div><label>Dom / Intl</label><select value={form.domIntl} onChange={e => setForm({ ...form, domIntl: e.target.value })}><option value="intl">International</option><option value="dom">Domestic</option><option value="all">All</option></select></div>
            <div><label>Min dwell (min)</label><input type="number" value={form.dwellMin} onChange={e => setForm({ ...form, dwellMin: e.target.value })} /></div>
            <div><label><input type="checkbox" checked={form.delayOnly} onChange={e => setForm({ ...form, delayOnly: e.target.checked })} /> Delay-only audience</label></div>
            <div><label>Start</label><input value={form.start} onChange={e => setForm({ ...form, start: e.target.value })} /></div>
            <div><label>End</label><input value={form.end} onChange={e => setForm({ ...form, end: e.target.value })} /></div>
            <div><label>Budget ({currency})</label><input type="number" value={form.budget} onChange={e => setForm({ ...form, budget: e.target.value })} /></div>
            <div className="full row"><button className="btn">Save Campaign & Preview Audience</button></div>
            {preview && <div className="full" style={{ background: '#eff6ff', padding: 10, borderRadius: 8 }}><b>Live match: {preview.matchPct}% of crowd</b> at {form.zones} {form.start}–{form.end} • Expected {fmt(preview.expectedImpressions)} impressions, {fmt(preview.expectedRedemptions)} redemptions • Crowd {fmt(preview.crowdSize)}</div>}
            {recs && <div className="full" style={{ background: '#fefce8', padding: 10, borderRadius: 8 }}><b>⭐ Best 3 slots tomorrow</b>{(Array.isArray(recs) ? recs : []).map((s, i) => <div key={i}>{i + 1}. {s.zone} • Screen {s.screenId} • {s.hour}:00 — {fmt(s.predictedImpressions)} predicted impressions (score {s.score})</div>)}</div>}
          </form>
          <div>
            <div className="kpiLabel">Mock Screen Preview</div>
            <AdCard creative={mockCreative} lang={lang} />
            <div className="card" style={{ marginTop: 12 }}>
              <h3>🤖 GenAI Creative Assistant</h3>
              <textarea rows="3" style={{ width: '100%' }} value={genBrief} onChange={e => setGenBrief(e.target.value)} placeholder="Brief: 15% off perfume for holiday travellers…" />
              <div className="row" style={{ marginTop: 8 }}><select value={genLang} onChange={e => setGenLang(e.target.value)}><option value="en">English</option><option value="ar">العربية</option></select><button type="button" className="btn" onClick={genai}>Generate Creative</button></div>
              {genCreative && <div style={{ marginTop: 10 }}><AdCard creative={genCreative} /><button className="btn secondary small" style={{ marginTop: 8 }} onClick={() => { setForm({ ...form, name: genCreative.headline }); if (onUseCreative) onUseCreative(genCreative) }}>Use this creative — fill form</button></div>}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid2" style={{ marginTop: 14 }}>
        <div className="card">
          <h3>🎨 Creative Library</h3>
          {(creatives.data || []).map(c => <div key={c.id} style={{ borderBottom: '1px solid #eee', padding: '8px 0' }}><b>{c.name}</b> — {c.headline}<div className="small muted">{c.sub} • {c.template} • {c.lang}</div><button className="btn small secondary" onClick={async () => { const camp = (campaigns.data || []).find(x => x.creativeId === c.id); if (camp) { await post(`/api/campaigns/${camp.id}/duplicate`); campaigns.reload(); setMsg('Campaign duplicated ✓') } else setMsg('No campaign for this creative yet — create one first') }}>Duplicate campaign 1-click</button></div>)}
          <h3 style={{ marginTop: 14 }}>📜 Campaign History + ROI</h3>
          <table><thead><tr><th>Campaign</th><th>Spend</th><th>Imp.</th><th>Red.</th><th>ROI</th><th></th></tr></thead><tbody>{(history.data || []).map((h, i) => <tr key={i}><td>{h.name}<br /><span className="small muted">{h.advertiserName}</span></td><td>{money(h.spend, currency)}</td><td>{fmt(h.impressions)}</td><td>{fmt(h.redemptions)}</td><td><b>{h.roi}x</b></td><td><button className="btn small" onClick={async () => { await post(`/api/campaigns/${h.campaignId}/run-again`, {}); setMsg('Run again created ✓'); campaigns.reload() }}>Run again</button></td></tr>)}</tbody></table>
        </div>
        <div className="card">
          <h3>⚡ Trigger Rules + Stock-Aware Pause</h3>
          <label className="row"><input type="checkbox" checked={stockPause} onChange={async e => { setStockPause(e.target.checked); try { await post('/api/triggers', { condition: { dest: 'STOCK', delayMin: 0 }, action: { discount: 0, text: e.target.checked ? 'stock-pause ON' : 'stock-pause OFF' }, zone: form.zones }) } catch {} }} /> Stock-aware pause — auto-pause campaigns when stock low</label>
          <p className="small muted">Stock toggle posts a stock-type trigger to /api/triggers (contract gap noted: no dedicated stock endpoint).</p>
          {(triggers.data || []).map((tr, i) => { const tdata = tr.trigger || tr; return <div key={tr.id || i} className="row space" style={{ padding: '7px 0', borderBottom: '1px solid #eee' }}><span>If <b>{tdata.condition?.dest || tr.condition?.dest}</b> delayed &gt;{tdata.condition?.delayMin || tr.condition?.delayMin}m → {tdata.action?.text || tr.action?.text} ({tr.zone})</span><button className="btn small secondary" onClick={async () => { await post(`/api/triggers/${tr.id}/toggle`, {}); triggers.reload() }}>{tr.active === false ? 'Enable' : 'Pause'}</button></div> })}
          <div className="formGrid" style={{ marginTop: 12 }}>
            <div><label>Dest</label><input value={triggerForm.dest} onChange={e => setTriggerForm({ ...triggerForm, dest: e.target.value })} /></div>
            <div><label>Delay &gt; min</label><input type="number" value={triggerForm.delayMin} onChange={e => setTriggerForm({ ...triggerForm, delayMin: e.target.value })} /></div>
            <div><label>Discount %</label><input type="number" value={triggerForm.discount} onChange={e => setTriggerForm({ ...triggerForm, discount: e.target.value })} /></div>
            <div><label>Zone</label><input value={triggerForm.zone} onChange={e => setTriggerForm({ ...triggerForm, zone: e.target.value })} /></div>
            <div className="full"><label>Action text</label><input value={triggerForm.text} onChange={e => setTriggerForm({ ...triggerForm, text: e.target.value })} /></div>
          </div>
          <button className="btn" style={{ marginTop: 8 }} onClick={createTrigger}>Create Trigger</button>
          <h3 style={{ marginTop: 16 }}>Active Campaigns</h3>
          {(campaigns.data || []).slice(0, 6).map(c => <div key={c.id} className="row space" style={{ padding: '5px 0' }}><span>{c.name} <span className="badge">{c.status}</span></span><span className="small">{money(c.spent, currency)} / {money(c.budget, currency)}</span></div>)}
        </div>
      </div>
    </div>
  )
}
