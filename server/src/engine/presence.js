// ZonePresence: per zone, per 5-min window — pax count, destination/nationality mix,
// dom/intl split, dwell, crowd profile — computed from flights at nearby gates
// (pax × time-to-boarding weighting) + ACRIS queue measurements for landside zones.
import { gateZone } from '../seed/seed.js';

export function catchmentGates(screen) {
  if (!screen.gate) return null;
  const from = Math.max(screen.terminal === 'T1' ? 1 : 31, screen.gate - 2);
  const to = Math.min(screen.terminal === 'T1' ? 30 : 60, screen.gate + 3);
  const gates = []; for (let g = from; g <= to; g++) gates.push(g);
  return gates;
}
// Weight of a flight's passengers "being present" at time t (minutes):
// they gather from STD-90 to boarding close (STD-10), then leave quickly.
export function presenceWeight(flight, t) {
  const close = flight.std - 10;
  const minsToClose = close - t;
  if (minsToClose < -15) return 0;
  if (minsToClose < 0) return Math.max(0, 1 + minsToClose / 15);
  return Math.max(0, 1 - Math.abs(minsToClose - 25) / 75);
}
export function activeFlights(flights, t, horizonMin = 0) {
  return flights.filter(f => f.status !== 'DEPARTED' && f.std + (f.delayMin || 0) > t - 15 && presenceWeight(f, t) > 0.01 || (horizonMin && f.std > t && f.std <= t + horizonMin));
}
function aggregate(flights, t) {
  let pax = 0; const prof = { holiday: 0, family: 0, business: 0, premium: 0, adults25_54: 0 };
  let intlPax = 0; const dests = new Map(); const nats = new Map();
  for (const f of flights) {
    const w = presenceWeight(f, t) * f.pax; if (w <= 0) continue;
    pax += w; if (f.profile.intl) intlPax += w;
    for (const k of Object.keys(prof)) prof[k] += (f.profile[k] || 0) * w;
    dests.set(f.dest, (dests.get(f.dest) || 0) + w);
    for (const [name, share] of f.nationalities || []) nats.set(name, (nats.get(name) || 0) + share * w);
  }
  if (pax > 0) for (const k of Object.keys(prof)) prof[k] = +(prof[k] / pax).toFixed(3);
  const top = (m, n = 3) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([k, v]) => ({ code: k, name: k, pax: Math.round(v), pct: pax ? +(v / pax).toFixed(2) : 0 }));
  return {
    pax: Math.round(pax), intlPct: pax ? +(intlPax / pax).toFixed(2) : 0, domPct: pax ? +(1 - intlPax / pax).toFixed(2) : 0,
    profile: { ...prof, intl: pax ? +(intlPax / pax).toFixed(3) : 0, dwellMedianMin: 52 },
    topDestinations: top(dests), topNationalities: top(nats).map(x => ({ name: x.code, pct: x.pct })),
  };
}
export function zonePresence(store, zone, t) {
  const flights = store.all('flights');
  let scoped;
  if (zone.kind === 'gates') {
    scoped = flights.filter(f => f.terminal === zone.terminal && f.gate >= zone.gateFrom && f.gate <= zone.gateTo);
  } else if (zone.kind === 'retail') {
    scoped = flights.filter(f => f.terminal === zone.terminal); // retail draws from whole terminal, weighted down
    const a = aggregate(scoped, t); a.pax = Math.round(a.pax * 0.35); return finish(zone, a, flights, t);
  } else { // checkin / security: passengers earlier in their journey
    scoped = flights.filter(f => f.terminal === zone.terminal);
    const a = aggregate(scoped, t + (zone.kind === 'checkin' ? 75 : 45)); a.pax = Math.round(a.pax * 0.5);
    return finish(zone, a, flights, t);
  }
  return finish(zone, aggregate(scoped, t), flights, t);
}
function finish(zone, a, flights, t) {
  const future = flights.filter(f => f.terminal === zone.terminal && f.std > t && f.std <= t + 120);
  const futPax = future.reduce((s, f) => s + f.pax, 0);
  const intlFut = future.filter(f => f.profile.intl).reduce((s, f) => s + f.pax, 0);
  return { zone: zone.id, terminal: zone.terminal, ...a,
    next60: Math.round(futPax * 0.45), next120: futPax,
    next60IntlPct: futPax ? +(intlFut / futPax).toFixed(2) : 0,
    heat: Math.min(1, a.pax / 1600) };
}
export function screenCatchment(store, screen, t) {
  const gates = catchmentGates(screen);
  if (!gates) { const z = store.get('locations', screen.zone); return zonePresence(store, { id: screen.zone, terminal: screen.terminal, kind: z?.type === 'zone' ? screen.zone.split('-')[1] : 'retail', gateFrom: 0, gateTo: 0 }, t); }
  const flights = store.all('flights').filter(f => f.terminal === screen.terminal && gates.includes(f.gate));
  const a = aggregate(flights, t);
  return { zone: screen.zone, terminal: screen.terminal, ...a, flights };
}
