// Decision engine — auditable pipeline per screen per slot:
// 1 Profile → 2 Filter (hard rules) → 3 Score (segment match × boosts) →
// 4 Business rules (airline priority, competitor separation, frequency cap, pacing)
// → 5 Choose + LOG full evidence trail → 6 Learn (conversion updates from redemptions).
import { screenCatchment } from './presence.js';

export function matchScore(campaign, profile) {
  const w = campaign.segmentWeights || {};
  let num = 0, den = 0;
  for (const [seg, weight] of Object.entries(w)) {
    const fit = seg === 'intl' ? (profile.intl ?? profile.intlPct ?? 0) : (profile[seg] ?? 0);
    num += weight * fit; den += weight;
  }
  return den ? num / den : 0.3;
}
export function evaluateBoost(campaign, ctx) {
  let boost = 1; const reasons = [];
  for (const r of campaign.boostRules || []) {
    if (r.type === 'delay') {
      const maxDelay = Math.max(0, ...ctx.flights.map(f => f.delayMin || 0));
      if (maxDelay >= r.minDelay) { boost *= r.factor; reasons.push(`delay boost ${r.factor}× (max delay ${maxDelay}m ≥ ${r.minDelay}m)`); }
    }
    if (r.type === 'airlineBoarding' && campaign.airlineCode) {
      const own = ctx.flights.find(f => f.airline === campaign.airlineCode && ctx.screen.gate === f.gate && f.std - ctx.t <= 45 && f.std - ctx.t >= -10);
      if (own) { boost *= r.factor; reasons.push(`airline priority ${r.factor}× (own flight ${own.flightNo} boarding at this gate)`); }
    }
  }
  return { boost, reasons };
}
export function pacingFactor(campaign) {
  const ratio = campaign.budget ? campaign.spent / campaign.budget : 1;
  return 0.92 + 0.08 * (1 - Math.min(1, ratio));
}
export function scoreCandidate(campaign, profile, ctx) {
  const match = matchScore(campaign, profile);
  const { boost, reasons } = evaluateBoost(campaign, ctx);
  const pacing = pacingFactor(campaign);
  const final = Math.min(0.98, Math.pow(match, 0.7) * Math.pow(boost, 0.55) * pacing);
  return { match: +match.toFixed(3), boost, pacing: +pacing.toFixed(3), final: +final.toFixed(3), boostReasons: reasons };
}
export function filterReason(campaign, screen, profile, ctx, plays) {
  const t = ctx.t;
  if (campaign.status !== 'active') return `status=${campaign.status}`;
  if (t < campaign.schedule.start || t > campaign.schedule.end) return 'outside schedule window';
  if (campaign.screens?.length && !campaign.screens.includes(screen.id)) return 'not placed on this screen';
  if (!campaign.screens?.length && !(campaign.zones || []).includes(screen.zone)) return 'placement: zone not targeted';
  const a = campaign.audience || {};
  if (a.domIntl === 'intl' && (profile.intl ?? 1) < 0.4) return 'audience: international crowd too small';
  if (a.domIntl === 'dom' && (profile.intl ?? 0) > 0.6) return 'audience: domestic-only campaign';
  if (a.destinations?.length && !ctx.flights.some(f => a.destinations.includes(f.dest))) return 'audience: no flight to target destination in catchment';
  if (a.dwellMin && (profile.dwellMedianMin || 0) < a.dwellMin) return 'audience: dwell below minimum';
  if (a.delayOnly && !ctx.flights.some(f => (f.delayMin || 0) > 0)) return 'audience: delay-only, no delayed flight';
  if (campaign.spent >= campaign.budget) return 'budget exhausted';
  if (profile.pax < (a.minCrowd || 25)) return 'crowd below minimum';
  const recent = plays.filter(p => p.campaignId === campaign.id && t - p.at <= 10).length;
  if (recent >= 16) return 'frequency cap (16 plays / 10 min on this screen)';
  return null;
}
export function decide(store, screen, t, opts = {}) {
  const catchment = screenCatchment(store, screen, t);
  const profile = { ...catchment.profile, pax: catchment.pax, intl: catchment.intlPct };
  const ctx = { t, screen, flights: catchment.flights || [] };
  const plays = opts.plays || [];
  const candidates = [];
  let winner = null;
  const lastCat = opts.lastCategory;
  for (const c of store.all('campaigns')) {
    const s = scoreCandidate(c, profile, ctx);
    const fr = filterReason(c, screen, profile, ctx, plays);
    let status = fr ? 'filtered' : 'scored';
    let reason = fr || '';
    if (!fr && lastCat && c.category === lastCat && c.id !== opts.pinId) {
      const alt = candidates.some(x => x.status === 'scored' && x.final >= 0.3);
      if (alt) { status = 'filtered'; reason = 'competitor separation (same category as previous slot)'; }
    }
    const rec = { campaignId: c.id, name: c.name, category: c.category, ...s, final: fr ? s.match : s.final, status, reason };
    candidates.push(rec);
    if (!fr && (!winner || rec.final > winner.final || opts.pinId === c.id)) {
      if (!winner || rec.final > winner.final || opts.pinId === c.id) winner = rec;
    }
  }
  if (opts.pinId) { const p = candidates.find(x => x.campaignId === opts.pinId); if (p && p.status !== 'filtered') winner = p; }
  candidates.sort((a, b) => b.final - a.final);
  if (winner) winner.status = 'winner';
  const record = {
    id: `D-${screen.id}-${Math.round(t)}-${Math.floor(Math.random() * 1e4)}`,
    at: +t.toFixed(1), clock: `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`,
    screenId: screen.id, zone: screen.zone, gate: screen.gate,
    profile: { holiday: profile.holiday, family: profile.family, business: profile.business, premium: profile.premium, adults25_54: profile.adults25_54, intl: profile.intl, pax: profile.pax, dwellMedianMin: profile.dwellMedianMin },
    candidates, winner: winner ? { campaignId: winner.campaignId, name: winner.name, score: winner.final } : null,
    reason: winner ? `Highest final score ${winner.final} (match ${winner.match} × boost ${winner.boost}${winner.boostReasons?.length ? ': ' + winner.boostReasons.join('; ') : ''})` : 'No eligible campaign — house content',
    evidence: [
      { source: 'aidx-feed', detail: `${ctx.flights.length} flights in catchment`, freshnessSec: 4 },
      { source: 'zone-presence', detail: `${profile.pax} pax, intl ${(profile.intl * 100).toFixed(0)}%`, freshnessSec: 6 },
      { source: 'platform-db', detail: `${store.all('campaigns').length} campaigns evaluated`, freshnessSec: 1 },
    ],
  };
  return record;
}
