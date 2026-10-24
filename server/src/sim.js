// Simulation engine: server-side sim clock (1x = 1 sim-minute / real-second),
// flight status lifecycle, per-screen decisions, impression/revenue accrual,
// incident generation, trigger + goodwill automation, SSE event bus.
import { EventEmitter } from 'node:events';
import { decide } from './engine/decision.js';
import { screenCatchment } from './engine/presence.js';
import { ZONES } from './seed/seed.js';

export const bus = new EventEmitter();
bus.setMaxListeners(200);
export function emit(type, data) { bus.emit('sse', { type, data }); }

const SIZE_PRICE = { '86"': 3.2, '55"': 2.2, '43"': 1.6, '32"': 1.1 };
export function pricePerPlay(screen, heat) { return (SIZE_PRICE[screen.size] || 2) * (0.5 + heat); }

export const sim = {
  t: 300, speed: 1, playing: true,
  counters: { plays: 0, impressions: 0, revenue: 0, decisions: 0 },
  outletMetrics: new Map(), screenPlays: new Map(), lastCategory: new Map(),
  pins: new Map(), nowPlaying: new Map(), firedGoodwill: new Set(), feedStats: new Map(), lastLogMin: new Map(),
};
export const clockOf = (t) => `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export function outletMetric(id) {
  if (!sim.outletMetrics.has(id)) sim.outletMetrics.set(id, { impressions: 0, scans: 0, redemptions: 0, revenue: 0 });
  return sim.outletMetrics.get(id);
}

function updateFlightStatuses(store) {
  for (const f of store.all('flights')) {
    const etd = f.std + (f.delayMin || 0);
    let s = 'SCHEDULED';
    if (sim.t >= etd + 5) s = 'DEPARTED';
    else if (sim.t >= f.std - 40) s = 'BOARDING';
    else if (f.delayMin > 0) s = 'DELAYED';
    if (s !== f.status) { const old = f.status; f.status = s; store.put('flights', f); emit('flight', { flight: pubFlight(f), from: old, to: s }); }
  }
}
export const pubFlight = (f) => ({ id: f.id, airline: f.airline, flightNo: f.flightNo, dest: f.dest, destName: f.destName, std: f.std, etd: f.std + (f.delayMin || 0), clock: clockOf(f.std), gate: f.gate, terminal: f.terminal, status: f.status, delayMin: f.delayMin || 0, pax: f.pax, loadFactor: +(f.pax / f.capacity).toFixed(2), aircraft: f.aircraft });

function checkGoodwill(store) {
  for (const rule of store.all('goodwill_rules')) {
    if (!rule.active) continue;
    for (const f of store.all('flights')) {
      if (f.airline !== rule.airline || (f.delayMin || 0) < rule.thresholdMin || f.status === 'DEPARTED') continue;
      const key = `${rule.id}:${f.id}`;
      if (sim.firedGoodwill.has(key)) continue;
      sim.firedGoodwill.add(key);
      const rec = { id: `GWF-${f.id}`, flightId: f.id, flightNo: f.flightNo, airline: f.airline, offer: rule.offer, coFundOutletId: rule.coFundOutletId, at: clockOf(sim.t), delayMin: f.delayMin };
      store.put('goodwill_fired', { id: rec.id, ...rec });
      store.put('messages', { id: `MSG-${f.id}`, airline: f.airline, gate: f.gate, text: `${f.airline === 'XY' ? 'Xylo Air' : 'Zafiro Air'}: we\'re sorry for the delay — ${rule.offer} on us at Gate ${f.gate}.`, kind: 'goodwill', window: 'delay', at: Math.round(sim.t) });
      emit('goodwill', rec);
    }
  }
}
export function fireTriggers(store, flight) {
  const effects = [];
  for (const tr of store.all('triggers')) {
    if (!tr.active || tr.stockPause) continue;
    if (tr.condition.dest && flight.dest !== tr.condition.dest) continue;
    if ((flight.delayMin || 0) < (tr.condition.delayMin || 0)) continue;
    tr.firedCount = (tr.firedCount || 0) + 1; store.put('triggers', tr);
    effects.push(`Trigger "${tr.name}" fired for ${flight.flightNo}`);
    emit('trigger', { trigger: tr, flight: pubFlight(flight) });
  }
  return effects;
}

export function runDecisions(store, dtMin) {
  const screens = store.all('screens');
  for (const screen of screens) {
    if (screen.status === 'offline') continue;
    const plays = sim.screenPlays.get(screen.id) || [];
    const rec = decide(store, screen, sim.t, { plays, lastCategory: sim.lastCategory.get(screen.id), pinId: sim.pins.get(screen.id) });
    const prev = sim.nowPlaying.get(screen.id);
    sim.nowPlaying.set(screen.id, rec);
    const winnerChanged = prev?.winner?.campaignId !== rec.winner?.campaignId;
    const newMinute = sim.lastLogMin.get(screen.id) !== Math.floor(sim.t);
    if (dtMin > 0 && (winnerChanged || newMinute)) { store.logDecision(rec); sim.lastLogMin.set(screen.id, Math.floor(sim.t)); }
    sim.counters.decisions++;
    if (rec.winner) {
      plays.push({ campaignId: rec.winner.campaignId, at: sim.t });
      while (plays.length && sim.t - plays[0].at > 15) plays.shift();
      sim.screenPlays.set(screen.id, plays);
      const cat = store.get('campaigns', rec.winner.campaignId)?.category;
      sim.lastCategory.set(screen.id, cat);
      const catchment = screenCatchment(store, screen, sim.t);
      const heat = Math.min(1, catchment.pax / 1600);
      const price = pricePerPlay(screen, heat);
      const playsNow = 4 * dtMin; // four 15-second slots per sim-minute
      const impressions = catchment.pax * 0.35 * dtMin;
      sim.counters.plays += playsNow;
      sim.counters.impressions += impressions;
      sim.counters.revenue += price * playsNow;
      const camp = store.get('campaigns', rec.winner.campaignId);
      if (camp) {
        camp.spent = +(camp.spent + price * playsNow).toFixed(2); store.put('campaigns', camp);
        if (camp.outletId) {
          const m = outletMetric(camp.outletId);
          m.impressions += impressions;
          m.scans += impressions * (camp.conversionEst || 0.02) * 0.55;
          m.revenue += impressions * (camp.conversionEst || 0.02) * 24;
        }
      }
      if (!prev || prev.winner?.campaignId !== rec.winner.campaignId) emit('decision', { screenId: screen.id, decision: rec });
    }
  }
}

function checkIncidents(store) {
  for (const s of store.all('screens')) {
    if (s.status !== 'offline') continue;
    if (s.offlineSince == null) { s.offlineSince = sim.t; store.put('screens', s); continue; }
    if (sim.t - s.offlineSince > 5) {
      const exists = store.all('incidents').some(i => i.entityId === s.id && i.status !== 'resolved');
      if (!exists) {
        const inc = { id: `INC-${s.id}-${Math.round(sim.t)}`, type: 'screen_offline', severity: 'high', entity: 'screen', entityId: s.id, message: `Screen offline > 5 min (${s.name})`, owner: 'Unassigned', status: 'open', createdAt: Math.round(sim.t) };
        store.put('incidents', inc); emit('incident', inc);
      }
    }
  }
}

let timer = null;
export function startSim(store) {
  if (timer) return;
  timer = setInterval(() => {
    if (!sim.playing) return;
    const dt = 0.25 * sim.speed; // sim-minutes per 250ms tick
    sim.t = (sim.t + dt) % 1440;
    updateFlightStatuses(store);
    runDecisions(store, dt);
    checkGoodwill(store);
    checkIncidents(store);
    for (const z of ZONES) emit('presence', { zone: z.id });
    emit('tick', { t: sim.t, clock: clockOf(sim.t), speed: sim.speed });
  }, 250);
}
export function inject(store, ev) {
  const effects = [];
  if (ev.type === 'delay') {
    const f = store.get('flights', ev.flightId); if (!f) return { ok: false, error: 'flight not found' };
    f.delayMin = (f.delayMin || 0) + (ev.minutes || 30); f.status = 'DELAYED'; store.put('flights', f);
    emit('flight', { flight: pubFlight(f), injected: true });
    effects.push(`${f.flightNo} delayed +${ev.minutes || 30}m (total ${f.delayMin}m)`);
    effects.push(...fireTriggers(store, f));
    checkGoodwill(store);
    runDecisions(store, 0);
    effects.push('Gate screens re-planned; zone presence raised');
  } else if (ev.type === 'gateChange') {
    const f = store.get('flights', ev.flightId); if (!f) return { ok: false, error: 'flight not found' };
    const old = f.gate; f.gate = ev.gate; store.put('flights', f);
    emit('flight', { flight: pubFlight(f), injected: true });
    runDecisions(store, 0);
    effects.push(`${f.flightNo} moved Gate ${old} → ${ev.gate}; screens re-planned`);
  } else if (ev.type === 'screenOffline' || ev.type === 'screenOnline') {
    const s = store.get('screens', ev.screenId); if (!s) return { ok: false, error: 'screen not found' };
    s.status = ev.type === 'screenOffline' ? 'offline' : 'online';
    if (s.status === 'offline') s.offlineSince = sim.t; else s.offlineSince = null;
    store.put('screens', s); emit('screen', { screen: s });
    effects.push(`${s.name} now ${s.status}`);
  }
  return { ok: true, effects };
}
