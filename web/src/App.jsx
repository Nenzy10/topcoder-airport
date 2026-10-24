import React, { useState, useEffect, useRef } from 'react'
import { get, post } from './api'
import { dict, t as tr } from './i18n'
import Admin from './views/Admin'
import Retailer from './views/Retailer'
import Media from './views/Media'
import Airline from './views/Airline'
import Passenger from './views/Passenger'
import Claim from './views/Claim'

const ROLES = [
  { id: 'admin', label: 'Admin' },
  { id: 'retailer', label: 'Retailer' },
  { id: 'media', label: 'Media Manager' },
  { id: 'airline', label: 'Airline' },
  { id: 'passenger', label: 'Passenger Screen' },
]
const AIRLINES_FALLBACK = ['XY', 'ZQ', 'AB', 'KM', 'OR', 'PL', 'TR', 'VN', 'WJ', 'QD']

export default function App() {
  const claimMatch = window.location.pathname.match(/^\/claim\/(.+)/)
  if (claimMatch) return <Claim code={decodeURIComponent(claimMatch[1])} />

  const [config, setConfig] = useState({ name: 'Aurora International Airport', tagline: 'Retail Media Platform', currency: 'USD', theme: {} })
  const [state, setState] = useState({ simMinutes: 840, clock: '14:00', speed: 1, playing: true })
  const [role, setRole] = useState('admin')
  const [lang, setLang] = useState('en')
  const [outlets, setOutlets] = useState([])
  const [outletId, setOutletId] = useState('')
  const [airlines, setAirlines] = useState(AIRLINES_FALLBACK)
  const [airlineCode, setAirlineCode] = useState('XY')
  const [screens, setScreens] = useState([])
  const [flights, setFlights] = useState([])
  const [refreshKey, setRefreshKey] = useState(0)
  const [split, setSplit] = useState(false)
  const [splitRole, setSplitRole] = useState('retailer')
  const [jump, setJump] = useState('14:10')
  const [injectFlight, setInjectFlight] = useState('')
  const [injectScreen, setInjectScreen] = useState('')
  const [injectGate, setInjectGate] = useState('43')
  const [lastEffect, setLastEffect] = useState('')
  const [externalCreative, setExternalCreative] = useState(null)
  const esRef = useRef(null)

  useEffect(() => {
    get('/api/config').then(c => setConfig(c)).catch(() => {})
    get('/api/state').then(setState).catch(() => {})
    get('/api/outlets').then(o => { setOutlets(o); if (o[0]) setOutletId(o[0].id) }).catch(() => {})
    get('/api/screens').then(s => { setScreens(s); const g42 = s.find(x => String(x.gate) === '42') || s[0]; if (g42) setInjectScreen(g42.id) }).catch(() => {})
    get('/api/flights').then(f => { setFlights(f); const xy = f.find(x => x.flightNo === 'XY501'); if (xy) setInjectFlight(xy.id) }).catch(() => {})
    get('/api/master/airlines').then(rows => {
      const list = (Array.isArray(rows) ? rows : rows?.rows || []).map(r => r.code || r.id).filter(Boolean)
      if (list.length) setAirlines(list)
    }).catch(() => {})
  }, [])

  // SSE + poll fallback
  useEffect(() => {
    const poll = setInterval(() => { get('/api/state').then(setState).catch(() => {}) }, 5000)
    try {
      const es = new EventSource('/api/events')
      esRef.current = es
      es.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data)
          if (msg.type === 'tick' && msg.data) setState(prev => ({ ...prev, simMinutes: msg.data.simMinutes ?? prev.simMinutes, clock: msg.data.clock ?? prev.clock, speed: msg.data.speed ?? prev.speed, playing: msg.data.playing ?? prev.playing }))
          if (['decision', 'redemption', 'flight', 'incident', 'presence', 'impression'].includes(msg.type)) setRefreshKey(k => k + 1)
        } catch {}
      }
      es.onerror = () => {}
    } catch {}
    return () => { clearInterval(poll); if (esRef.current) esRef.current.close() }
  }, [])

  async function simControl(body) { try { const s = await post('/api/sim/control', body); setState(s); setRefreshKey(k => k + 1) } catch {} }
  async function inject(type) {
    try {
      let body = { type }
      if (type === 'delay') body = { type, flightId: injectFlight || flights.find(f => f.flightNo === 'XY501')?.id, minutes: 30 }
      if (type === 'gateChange') body = { type, flightId: injectFlight || flights[0]?.id, gate: injectGate }
      if (type === 'screenOffline') body = { type, screenId: injectScreen || screens[0]?.id }
      const r = await post('/api/sim/inject', body)
      setLastEffect(`Injected ${type} ✓ ${(r.effects || []).join(' • ')}`)
      setRefreshKey(k => k + 1)
    } catch (e) { setLastEffect(e.message) }
  }
  function doJump() {
    const [h, m] = jump.split(':').map(Number)
    if (!isNaN(h)) simControl({ action: 'jump', minutes: h * 60 + (m || 0) })
  }

  const currency = config.currency || 'USD'
  const renderRole = (r) => {
    if (r === 'admin') return <Admin refreshKey={refreshKey} currency={currency} />
    if (r === 'retailer') return <Retailer refreshKey={refreshKey} outletId={outletId} currency={currency} lang={lang} externalCreative={externalCreative} onUseCreative={setExternalCreative} />
    if (r === 'media') return <Media refreshKey={refreshKey} currency={currency} />
    if (r === 'airline') return <Airline refreshKey={refreshKey} airlineCode={airlineCode} />
    return <Passenger refreshKey={refreshKey} />
  }

  return (
    <div dir={dict[lang]?.dir || 'ltr'}>
      <header className="topbar">
        <div className="logo"><div className="logoMark">✈️</div><div>{config.name}<div className="tagline">{config.tagline} • {config.flightSource || 'mock-aidx'} • {currency}</div></div></div>
        <nav className="roleTabs">{ROLES.map(r => <button key={r.id} className={role === r.id && !split ? 'active' : ''} onClick={() => { setRole(r.id); setSplit(false) }}>{tr(lang, r.id === 'media' ? 'media' : r.id)}</button>)}</nav>
        {role === 'retailer' && <select value={outletId} onChange={e => setOutletId(e.target.value)} title="Outlet / company switcher">{outlets.map(o => <option key={o.id} value={o.id}>{o.name} — {o.type} ({o.zone})</option>)}</select>}
        {role === 'airline' && <select value={airlineCode} onChange={e => setAirlineCode(e.target.value)} title="Airline switcher">{airlines.map(a => <option key={a} value={a}>{a}</option>)}</select>}
        <button className="btn ghost" style={{ color: '#fff', borderColor: 'rgba(255,255,255,.4)' }} onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}>{lang === 'en' ? 'العربية' : 'EN'}</button>
        <button className="btn" style={{ background: split ? '#f5a623' : 'rgba(255,255,255,.15)' }} onClick={() => setSplit(!split)}>{split ? tr(lang, 'splitOff') : tr(lang, 'split')}</button>
        <div className="clockBox"><div className="clock">{state.clock} <small>SIM</small></div><div className="small" style={{ opacity: .75 }}>{state.playing ? '▶ Running' : '⏸ Paused'} • {state.speed}× • Day 1</div></div>
      </header>

      <div className="simbar">
        <label>🎛️ SIM CONTROL</label>
        <button className="btn small" onClick={() => simControl({ action: state.playing ? 'pause' : 'play' })}>{state.playing ? '⏸ Pause' : '▶ Play'}</button>
        {[1, 10, 60].map(s => <button key={s} className={`btn small ${state.speed === s ? '' : 'secondary'}`} onClick={() => simControl({ action: 'speed', speed: s })}>{s}×</button>)}
        <span className="row"><input value={jump} onChange={e => setJump(e.target.value)} style={{ width: 70 }} placeholder="14:10" /><button className="btn small secondary" onClick={doJump}>Jump</button></span>
        <span style={{ borderLeft: '1px solid #d9b73c', paddingLeft: 10 }} className="row">
          <select value={injectFlight} onChange={e => setInjectFlight(e.target.value)} style={{ maxWidth: 170 }}><option value="">XY501 (default)</option>{flights.slice(0, 40).map(f => <option key={f.id} value={f.id}>{f.flightNo} → {f.dest} Gate {f.gate}</option>)}</select>
          <button className="btn small danger" onClick={() => inject('delay')}>⚡ Delay +30m</button>
          <input value={injectGate} onChange={e => setInjectGate(e.target.value)} style={{ width: 52 }} title="New gate" />
          <button className="btn small secondary" onClick={() => inject('gateChange')}>Gate change</button>
          <select value={injectScreen} onChange={e => setInjectScreen(e.target.value)} style={{ maxWidth: 170 }}><option value="">Select screen…</option>{screens.slice(0, 60).map(s => <option key={s.id} value={s.id}>{s.name} Gate {s.gate}</option>)}</select>
          <button className="btn small secondary" onClick={() => inject('screenOffline')}>Screen offline</button>
        </span>
        {lastEffect && <span className="small"><b>{lastEffect}</b></span>}
      </div>

      <main className="layout">
        {split ? (
          <div>
            <div className="row" style={{ marginBottom: 10 }}><b>Split Demo Mode:</b><span>Passenger Screen (left) +</span><select value={splitRole} onChange={e => setSplitRole(e.target.value)}>{ROLES.filter(r => r.id !== 'passenger').map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select>{splitRole === 'retailer' && <select value={outletId} onChange={e => setOutletId(e.target.value)}>{outlets.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select>}{splitRole === 'airline' && <select value={airlineCode} onChange={e => setAirlineCode(e.target.value)}>{airlines.map(a => <option key={a} value={a}>{a}</option>)}</select>}</div>
            <div className="splitWrap"><div><Passenger refreshKey={refreshKey} /></div><div>{renderRole(splitRole)}</div></div>
          </div>
        ) : (
          <div className={role === 'admin' ? '' : ''}>{renderRole(role)}</div>
        )}
        <footer className="muted small" style={{ marginTop: 24, textAlign: 'center' }}>{config.name} — fictional airport, fictional airlines & brands only • Live via SSE /api/events (&lt;2s) + 5s poll fallback • EN/AR i18n • Claim base: {config.claimBaseUrl || '/claim/:code'}</footer>
      </main>
    </div>
  )
}
