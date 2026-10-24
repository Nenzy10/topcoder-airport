import { Router } from 'express';
import QRCode from 'qrcode';
import { store } from '../db.js';
import { sim, emit, inject, pubFlight, clockOf, outletMetric, pricePerPlay } from '../sim.js';
import { ZONES, gateZone } from '../seed/seed.js';
import { zonePresence, screenCatchment } from '../engine/presence.js';
import { decide, matchScore } from '../engine/decision.js';
import { genAi } from '../genai.js';
import { getFlightSource } from '../adapters/index.js';
import { hashCode } from '../rng.js';

export const config = {
  name: process.env.AIRPORT_NAME || 'Aurora International Airport',
  tagline: 'The payment-free retail media network in the sky hub',
  currency: process.env.CURRENCY || 'USD',
  claimBaseUrl: (process.env.CLAIM_BASE_URL || 'http://localhost:8080').replace(/\/$/, ''),
  languages: ['en', 'ar'],
  theme: { primary: '#0b5fff', accent: '#ffb300' },
  flightSource: process.env.FLIGHT_SOURCE || 'mock-aidx',
};
const r = Router();
const ok = (res, x) => res.json(x);
const zoneObj = (id) => ZONES.find(z => z.id === id) || { id, terminal: id.split('-')[0], kind: id.split('-')[1] || 'retail', gateFrom: 0, gateTo: 0 };

// ---- config / state / sim control ----
r.get('/config', (req, res) => ok(res, config));
r.get('/state', (req, res) => ok(res, { simMinutes: +sim.t.toFixed(1), clock: clockOf(sim.t), speed: sim.speed, playing: sim.playing }));
r.post('/sim/control', (req, res) => {
  const { action, speed, minutes } = req.body || {};
  if (action === 'play') sim.playing = true;
  if (action === 'pause') sim.playing = false;
  if (action === 'speed' && [1, 10, 60].includes(speed)) sim.speed = speed;
  if (action === 'jump' && minutes != null) { sim.t = Math.max(0, Math.min(1439, minutes)); sim.screenPlays.clear(); sim.lastCategory.clear(); sim.nowPlaying.clear(); } // jump = fresh planning window
  emit('tick', { t: sim.t, clock: clockOf(sim.t), speed: sim.speed });
  ok(res, { simMinutes: +sim.t.toFixed(1), clock: clockOf(sim.t), speed: sim.speed, playing: sim.playing });
});
r.post('/sim/inject', (req, res) => ok(res, inject(store, req.body || {})));
r.get('/events', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write(': connected\n\n');
  const on = (e) => res.write(`event: ${e.type}\ndata: ${JSON.stringify(e.data)}\n\n`);
  const { bus } = simBus(); bus.on('sse', on);
  const hb = setInterval(() => res.write(': hb\n\n'), 15000);
  req.on('close', () => { bus.off('sse', on); clearInterval(hb); });
});
import { bus as _bus } from '../sim.js';
function simBus() { return { bus: _bus }; }

// ---- admin ----
r.get('/kpis', (req, res) => {
  const screens = store.all('screens');
  const online = screens.filter(s => s.status === 'online');
  ok(res, {
    screensOnlinePct: +(online.length / screens.length * 100).toFixed(1),
    playsToday: Math.round(sim.counters.plays), impressionsToday: Math.round(sim.counters.impressions),
    revenueToday: +sim.counters.revenue.toFixed(2), currency: config.currency,
    activeCampaigns: store.all('campaigns').filter(c => c.status === 'active').length,
    avgLatencyMs: Math.round(online.reduce((s, x) => s + x.latencyMs, 0) / Math.max(1, online.length)),
    decisionsLogged: store.decisionLog.length,
  });
});
r.get('/screens', (req, res) => ok(res, store.all('screens')));
r.get('/map', (req, res) => {
  const presence = ZONES.map(z => { const p = zonePresence(store, z, sim.t); return { zone: z.id, pax: p.pax, intlPct: p.intlPct, heat: p.heat }; });
  ok(res, { terminals: [{ id: 'T1', name: 'Terminal 1' }, { id: 'T2', name: 'Terminal 2' }], zones: ZONES, screens: store.all('screens'), presence });
});
r.get('/incidents', (req, res) => ok(res, store.all('incidents').map(i => ({ ...i, clock: clockOf(i.createdAt || sim.t), ageMin: Math.max(0, Math.round(sim.t - (i.createdAt || sim.t))) }))));
r.post('/incidents/:id', (req, res) => {
  const i = store.get('incidents', req.params.id); if (!i) return res.status(404).json({ error: 'not found' });
  Object.assign(i, req.body || {}); store.put('incidents', i); ok(res, i);
});
const MASTER = ['vendors', 'outlets', 'airlines', 'locations', 'screens'];
r.get('/master/:entity', (req, res) => { if (!MASTER.includes(req.params.entity)) return res.status(404).json({ error: 'unknown entity' }); ok(res, store.all(req.params.entity)); });
r.post('/master/:entity', (req, res) => {
  if (!MASTER.includes(req.params.entity)) return res.status(404).json({ error: 'unknown entity' });
  const row = { ...(req.body || {}) }; row.id = row.id || `${req.params.entity.slice(0, 3).toUpperCase()}-${Date.now().toString(36)}`;
  ok(res, store.put(req.params.entity, row));
});
r.put('/master/:entity/:id', (req, res) => {
  if (!MASTER.includes(req.params.entity)) return res.status(404).json({ error: 'unknown entity' });
  const cur = store.get(req.params.entity, req.params.id); if (!cur) return res.status(404).json({ error: 'not found' });
  ok(res, store.put(req.params.entity, { ...cur, ...(req.body || {}), id: cur.id }));
});
r.get('/feed-health', (req, res) => {
  const src = getFlightSource();
  const wob = (base) => Math.max(1, Math.round(base + Math.sin(sim.t / 7) * base * 0.15));
  ok(res, [
    { source: 'AIDX flight feed', kind: 'flight', status: 'ok', msgsPerMin: wob(46), lastMsg: clockOf(sim.t), adapter: src.name },
    { source: 'AODB snapshot', kind: 'flight', status: 'ok', msgsPerMin: 1, lastMsg: clockOf(sim.t), adapter: 'mock-aodb' },
    { source: 'ACRIS context broker', kind: 'presence', status: 'ok', msgsPerMin: wob(14), lastMsg: clockOf(sim.t), adapter: 'mock-acris' },
    { source: 'Platform DB', kind: 'platform', status: 'ok', msgsPerMin: wob(120), lastMsg: clockOf(sim.t), adapter: 'platform-db' },
  ]);
});
r.get('/perf', (req, res) => ok(res, {
  apiP95Ms: 84 + Math.round(Math.sin(sim.t / 11) * 9), playlistBuildMs: 12, decisionMs: 3,
  uptime7d: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, i) => ({ day, pct: +(99.2 + ((hashCode(day) % 70) / 100)).toFixed(2) })),
}));

// ---- flights / presence ----
r.get('/flights', (req, res) => {
  let f = store.all('flights');
  if (req.query.airline) f = f.filter(x => x.airline === req.query.airline);
  if (req.query.terminal) f = f.filter(x => x.terminal === req.query.terminal);
  ok(res, f.sort((a, b) => a.std - b.std).map(pubFlight));
});
r.get('/presence', (req, res) => ok(res, ZONES.map(z => zonePresence(store, z, sim.t))));

// ---- outlets / retailer ----
r.get('/outlets', (req, res) => ok(res, store.all('outlets')));
r.get('/retailer/:outletId/dashboard', (req, res) => {
  const o = store.get('outlets', req.params.outletId); if (!o) return res.status(404).json({ error: 'outlet not found' });
  const m = outletMetric(o.id);
  const scans = Math.max(0, Math.round(m.scans));
  ok(res, { outlet: o, impressions: Math.round(m.impressions), scans, redemptions: m.redemptions,
    conversionPct: scans ? +(m.redemptions / scans * 100).toFixed(1) : 0, attributedRevenue: +m.revenue.toFixed(2), currency: config.currency, live: true, clock: clockOf(sim.t) });
});
r.get('/retailer/:outletId/flow', (req, res) => {
  const o = store.get('outlets', req.params.outletId); if (!o) return res.status(404).json({ error: 'outlet not found' });
  ok(res, zonePresence(store, zoneObj(o.zone), sim.t));
});
r.get('/history', (req, res) => {
  const by = new Map();
  for (const h of store.all('history_daily')) {
    const a = by.get(h.campaignId) || { campaignId: h.campaignId, spend: 0, impressions: 0, redemptions: 0 };
    a.spend += h.spend; a.impressions += h.impressions; a.redemptions += h.redemptions; by.set(h.campaignId, a);
  }
  ok(res, [...by.values()].map(a => { const c = store.get('campaigns', a.campaignId); const adv = store.get('advertisers', c?.advertiserId);
    return { ...a, spend: +a.spend.toFixed(2), name: c?.name || a.campaignId, advertiserName: adv?.name || '', roi: a.spend ? +(((a.redemptions * 24) - a.spend) / a.spend).toFixed(2) : 0, days: 30 }; }));
});
r.get('/triggers', (req, res) => ok(res, store.all('triggers')));
r.post('/triggers', (req, res) => { const t = { id: `TR-${Date.now().toString(36)}`, firedCount: 0, active: true, stockPause: false, ...(req.body || {}) }; ok(res, store.put('triggers', t)); });
r.post('/triggers/:id/toggle', (req, res) => { const t = store.get('triggers', req.params.id); if (!t) return res.status(404).json({ error: 'not found' });
  if (req.body?.field === 'stockPause') t.stockPause = !t.stockPause; else t.active = !t.active; ok(res, store.put('triggers', t)); });

// ---- campaigns / creatives / promos ----
const pubCampaign = (c) => ({ ...c, advertiserName: store.get('advertisers', c.advertiserId)?.name || c.advertiserId });
r.get('/campaigns', (req, res) => { let cs = store.all('campaigns'); if (req.query.advertiser) cs = cs.filter(c => c.advertiserId === req.query.advertiser); ok(res, cs.map(pubCampaign)); });
r.post('/campaigns', (req, res) => {
  const b = req.body || {};
  const c = { id: b.id || `C-${Date.now().toString(36)}`, name: b.name || 'Untitled campaign', advertiserId: b.advertiserId || 'ADV-O1',
    outletId: b.outletId || null, creativeId: b.creativeId || 'CR-PERF', category: b.category || 'retail', status: b.status || 'pending',
    zones: b.zones || ['T2-retail'], screens: b.screens || [], audience: b.audience || { destinations: [], domIntl: 'any', dwellMin: 0, delayOnly: false },
    schedule: b.schedule || { start: 300, end: 1400 }, budget: b.budget || 1000, spent: 0,
    segmentWeights: b.segmentWeights || { holiday: 0.5, business: 0.5 }, boostRules: b.boostRules || [], conversionEst: 0.02 };
  ok(res, pubCampaign(store.put('campaigns', c)));
});
r.post('/campaigns/:id/duplicate', (req, res) => { const c = store.get('campaigns', req.params.id); if (!c) return res.status(404).json({ error: 'not found' });
  const copy = { ...c, id: `C-${Date.now().toString(36)}`, name: `${c.name} (copy)`, status: 'draft', spent: 0 }; ok(res, pubCampaign(store.put('campaigns', copy))); });
r.post('/campaigns/:id/run-again', (req, res) => { const c = store.get('campaigns', req.params.id); if (!c) return res.status(404).json({ error: 'not found' });
  const copy = { ...c, id: `C-${Date.now().toString(36)}`, name: `${c.name} (rerun)`, status: 'active', spent: 0, schedule: { start: Math.round(sim.t), end: 1400 } }; ok(res, pubCampaign(store.put('campaigns', copy))); });
r.get('/campaigns/:id/audience-preview', (req, res) => {
  const c = store.get('campaigns', req.params.id); if (!c) return res.status(404).json({ error: 'not found' });
  const zone = zoneObj(req.query.zone || c.zones[0]);
  const from = Number(req.query.from || c.schedule.start), to = Number(req.query.to || c.schedule.end);
  const p = zonePresence(store, zone, (from + to) / 2);
  const match = matchScore(c, { ...p.profile, intl: p.intlPct });
  const hours = Math.max(1, (to - from) / 60);
  const impressions = Math.round(p.pax * 0.35 * 60 * hours / 10);
  ok(res, { matchPct: Math.round(match * 100), crowdSize: p.pax, zone: zone.id, from: clockOf(from), to: clockOf(to), expectedImpressions: impressions, expectedRedemptions: Math.round(impressions * (c.conversionEst || 0.02)) });
});
r.get('/creatives', (req, res) => ok(res, store.all('creatives')));
r.post('/creatives', (req, res) => { const c = { id: `CR-${Date.now().toString(36)}`, ...(req.body || {}) }; ok(res, store.put('creatives', c)); });
r.get('/promos', (req, res) => { let ps = store.all('promos'); if (req.query.outletId) ps = ps.filter(p => p.outletId === req.query.outletId); ok(res, ps.map(p => ({ ...p, expiresClock: clockOf(p.expiresAt), live: p.active && sim.t < p.expiresAt }))); });
r.post('/promos', async (req, res) => {
  const b = req.body || {};
  const flight = b.flightId ? store.get('flights', b.flightId) : null;
  const code = b.code || `${(store.get('campaigns', b.campaignId)?.name || 'PROMO').replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase()}${int4()}`;
  const promo = { id: `P-${Date.now().toString(36)}`, code, shareCode: `${code}-FAM`, outletId: b.outletId, campaignId: b.campaignId,
    discount: b.discount || 10, flightId: b.flightId || null, expiresAt: flight ? flight.std - 10 : Math.round(sim.t) + 120,
    redemptions: 0, maxRedemptions: b.maxRedemptions || 300, active: true };
  store.put('promos', promo);
  const claimUrl = `${config.claimBaseUrl}/claim/${code}`;
  ok(res, { promo, claimUrl, qrDataUrl: await QRCode.toDataURL(claimUrl) });
});
function int4() { return Math.floor(1000 + Math.random() * 9000); }
r.get('/claim/:code', (req, res) => {
  const p = store.all('promos').find(x => x.code === req.params.code || x.shareCode === req.params.code);
  if (!p) return res.status(404).json({ valid: false, error: 'code not found' });
  const outlet = store.get('outlets', p.outletId); const camp = store.get('campaigns', p.campaignId);
  ok(res, { valid: p.active && sim.t < p.expiresAt, code: p.code, discount: p.discount, outletName: outlet?.name, campaignName: camp?.name, expiresAt: clockOf(p.expiresAt), expiresInSec: Math.max(0, Math.round((p.expiresAt - sim.t) * 60)) });
});
r.post('/claim/:code', (req, res) => {
  const p = store.all('promos').find(x => x.code === req.params.code || x.shareCode === req.params.code);
  if (!p || !p.active || sim.t >= p.expiresAt) return res.status(400).json({ redeemed: false, error: 'promo expired or invalid' });
  if (p.redemptions >= p.maxRedemptions) return res.status(400).json({ redeemed: false, error: 'promo fully redeemed' });
  p.redemptions++; store.put('promos', p);
  const redemption = { id: `R-${Date.now().toString(36)}`, code: p.code, at: sim.t };
  store.addRedemption(redemption);
  const m = outletMetric(p.outletId); m.redemptions++; m.scans++; m.revenue += 18;
  const camp = store.get('campaigns', p.campaignId);
  if (camp) { camp.conversionEst = +Math.min(0.2, (camp.conversionEst || 0.02) * 0.95 + 0.05 * 0.06).toFixed(4); store.put('campaigns', camp); }
  emit('redemption', { promo: p, redemption });
  ok(res, { redeemed: true, redemptionId: redemption.id, discount: p.discount, outletName: store.get('outlets', p.outletId)?.name });
});

// ---- media manager ----
function cellFor(screen, hour) {
  const t = hour * 60 + 30;
  const p = zonePresence(store, zoneObj(screen.zone), t);
  const price = +(pricePerPlay(screen, Math.min(1, p.pax / 1600)) * 240).toFixed(0);
  const covering = store.all('campaigns').find(c => c.status === 'active' && (c.zones || []).includes(screen.zone) && c.schedule.start <= t && c.schedule.end >= t && hashCode(screen.id + hour + c.id) % 3 !== 0);
  const premium = p.pax > 650;
  return { status: covering ? 'booked' : premium ? 'premium' : 'available', price, campaignName: covering?.name || null };
}
r.get('/media/calendar', (req, res) => {
  const screens = store.all('screens').filter(s => s.gate || s.zone.endsWith('retail')).slice(0, 60);
  const hours = []; for (let h = 5; h <= 23; h++) hours.push(h);
  const cells = {};
  for (const s of screens) for (const h of hours) cells[`${s.id}|${h}`] = cellFor(s, h);
  ok(res, { screens: screens.map(s => ({ id: s.id, name: s.name, zone: s.zone })), hours, cells });
});
r.get('/media/yield', (req, res) => {
  const screens = store.all('screens').slice(0, 60); const hours = []; for (let h = 5; h <= 23; h++) hours.push(h);
  let booked = 0, total = 0; const suggestions = [];
  for (const s of screens) for (const h of hours) { const c = cellFor(s, h); total++; if (c.status === 'booked') booked++; if (c.status === 'premium') suggestions.push({ screenId: s.id, screenName: s.name, hour: h, price: c.price, presence: c.status }); }
  suggestions.sort((a, b) => b.price - a.price);
  const base = 38000;
  ok(res, { occupancyPct: +(booked / total * 100).toFixed(1), suggestions: suggestions.slice(0, 10),
    forecast7d: ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((day, i) => ({ day, revenue: Math.round(base * [1.08, 1.02, 0.92, 0.9, 0.94, 1.0, 1.15][i]) })) });
});
r.get('/media/approvals', (req, res) => ok(res, store.all('campaigns').filter(c => c.status === 'pending').map(c => ({
  campaignId: c.id, name: c.name, advertiserName: store.get('advertisers', c.advertiserId)?.name, creative: store.get('creatives', c.creativeId) || null,
  checklist: { logoClear: true, noCompetitorConflict: true, claimsSubstantiated: c.category !== 'fnb', languageOk: true }, status: c.status }))));
r.post('/media/approvals/:id', (req, res) => { const c = store.get('campaigns', req.params.id); if (!c) return res.status(404).json({ error: 'not found' });
  c.status = req.body?.decision === 'approve' ? 'active' : 'rejected'; c.approvalChecklist = req.body?.checklist || null; ok(res, pubCampaign(store.put('campaigns', c))); });
r.get('/media/advertisers', (req, res) => {
  const advs = store.all('advertisers').map(a => {
    const cs = store.all('campaigns').filter(c => c.advertiserId === a.id);
    const spend = cs.reduce((s, c) => s + c.spent, 0); const budget = cs.reduce((s, c) => s + c.budget, 0);
    return { id: a.id, name: a.name, type: a.type, spend: +spend.toFixed(2), budget, running: cs.filter(c => c.status === 'active').length, underDelivering: budget > 0 && spend / budget < 0.18 && cs.some(c => c.status === 'active') };
  }).filter(a => a.budget > 0).sort((a, b) => b.spend - a.spend);
  ok(res, advs);
});
r.get('/packages', (req, res) => ok(res, store.all('packages')));
r.post('/packages', (req, res) => { const p = { id: `PK-${Date.now().toString(36)}`, ...(req.body || {}) }; ok(res, store.put('packages', p)); });
r.get('/report/advertiser/:id', (req, res) => {
  const a = store.get('advertisers', req.params.id); if (!a) return res.status(404).json({ error: 'not found' });
  const cs = store.all('campaigns').filter(c => c.advertiserId === a.id);
  const hist = store.all('history_daily').filter(h => cs.some(c => c.id === h.campaignId));
  ok(res, { advertiser: a, generatedAt: clockOf(sim.t), campaigns: cs.map(pubCampaign),
    totals: { spend: +cs.reduce((s, c) => s + c.spent, 0).toFixed(2), impressions30d: hist.reduce((s, h) => s + h.impressions, 0), redemptions30d: hist.reduce((s, h) => s + h.redemptions, 0) } });
});

// ---- airline ----
r.get('/airline/:code/flights', (req, res) => ok(res, store.all('flights').filter(f => f.airline === req.params.code).sort((a, b) => a.std - b.std).map(pubFlight)));
r.get('/airline/messages', (req, res) => ok(res, store.all('messages')));
r.post('/airline/messages', (req, res) => { const m = { id: `MSG-${Date.now().toString(36)}`, at: Math.round(sim.t), ...(req.body || {}) }; ok(res, store.put('messages', m)); });
r.get('/airline/goodwill', (req, res) => ok(res, { rules: store.all('goodwill_rules'), fired: store.all('goodwill_fired') }));
r.post('/airline/goodwill', (req, res) => { const g = { id: `GW-${Date.now().toString(36)}`, ...(req.body || {}) }; ok(res, store.put('goodwill_rules', g)); });
r.get('/airline/marketplace', (req, res) => ok(res, store.all('marketplace')));
r.post('/airline/marketplace/:id/accept', (req, res) => { const m = store.get('marketplace', req.params.id); if (!m) return res.status(404).json({ error: 'not found' }); m.accepted = true; ok(res, store.put('marketplace', m)); });
r.get('/airline/:code/performance', (req, res) => {
  const cs = store.all('campaigns').filter(c => c.airlineCode === req.params.code);
  const decs = store.decisionLog.filter(d => d.winner && cs.some(c => c.id === d.winner.campaignId));
  ok(res, { airline: req.params.code, sponsoredPlays: decs.length, campaigns: cs.map(pubCampaign), note: 'Plays of sponsored content in front of own passengers (decision log).' });
});

// ---- decisions / screens / playlist ----
r.get('/decisions', (req, res) => {
  let ds = [...store.decisionLog].reverse();
  if (req.query.screenId) ds = ds.filter(d => d.screenId === req.query.screenId);
  if (req.query.q) { const q = req.query.q.toLowerCase(); ds = ds.filter(d => JSON.stringify(d).toLowerCase().includes(q)); }
  ok(res, ds.slice(0, Number(req.query.limit || 100)));
});
r.post('/decisions/pin', (req, res) => { const { screenId, campaignId, reason } = req.body || {}; sim.pins.set(screenId, campaignId); emit('decision', { screenId, pinned: campaignId, reason }); ok(res, { pinned: true, screenId, campaignId, reason }); });
r.get('/screen/:id/playlist', async (req, res) => {
  const screen = store.get('screens', req.params.id); if (!screen) return res.status(404).json({ error: 'screen not found' });
  const rec = sim.nowPlaying.get(screen.id) || decide(store, screen, sim.t, {});
  const winner = rec.winner ? store.get('campaigns', rec.winner.campaignId) : null;
  const creative = winner ? store.get('creatives', winner.creativeId) : null;
  const catchment = screenCatchment(store, screen, sim.t);
  const queue = rec.candidates.filter(c => c.status !== 'filtered' && c.campaignId !== rec.winner?.campaignId).slice(0, 3)
    .map(c => ({ campaign: pubCampaign(store.get('campaigns', c.campaignId)), creative: store.get('creatives', store.get('campaigns', c.campaignId)?.creativeId), score: c.final }));
  let promo = null;
  const p = store.all('promos').find(x => x.active && sim.t < x.expiresAt && (x.campaignId === rec.winner?.campaignId || (winner && x.outletId === winner.outletId)));
  if (p) { const claimUrl = `${config.claimBaseUrl}/claim/${p.code}`; promo = { code: p.code, discount: p.discount, claimUrl, qrDataUrl: await QRCode.toDataURL(claimUrl), expiresInSec: Math.max(0, Math.round((p.expiresAt - sim.t) * 60)) }; }
  ok(res, { screen, clock: clockOf(sim.t),
    now: { campaign: winner ? pubCampaign(winner) : null, creative, score: rec.winner?.score, endsInSec: 15 },
    queue, contextFlights: (catchment.flights || []).filter(f => f.status !== 'DEPARTED').sort((a, b) => a.std - b.std).slice(0, 6).map(pubFlight),
    why: rec, promo });
});

// ---- genai / recommendations ----
r.post('/genai/brief', async (req, res) => { const { brief, lang } = req.body || {}; ok(res, await genAi.generate(brief || '', lang || 'en')); });
r.get('/recommend/slots', (req, res) => {
  const c = store.get('campaigns', req.query.campaignId); if (!c) return res.status(404).json({ error: 'campaign not found' });
  const out = [];
  for (const zid of c.zones) {
    const z = zoneObj(zid);
    for (let h = 6; h <= 22; h += 2) {
      const p = zonePresence(store, z, h * 60 + 30);
      const match = matchScore(c, { ...p.profile, intl: p.intlPct });
      const screen = store.all('screens').find(s => s.zone === zid);
      out.push({ screenId: screen?.id, screenName: screen?.name, zone: zid, day: 'tomorrow', hour: h, predictedImpressions: Math.round(p.pax * 0.35 * 60 * match), score: +(match * Math.min(1, p.pax / 1200)).toFixed(3) });
    }
  }
  out.sort((a, b) => b.score - a.score);
  ok(res, { campaignId: c.id, slots: out.slice(0, 3) });
});
export default r;
