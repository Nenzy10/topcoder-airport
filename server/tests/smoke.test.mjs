// Smoke tests: adapter parsing (AODB CSV, AIDX XML, ACRIS JSON) + decision-engine
// worked example (Gate 42, 14:10 — perfume must win at ~0.86).
import { test } from 'node:test';
import assert from 'node:assert';
import { parseAodbCsv, SAMPLE_CSV } from '../src/adapters/aodb.js';
import { parseAidxMessage, SAMPLE_XML } from '../src/adapters/aidx.js';
import { parseAcrisEntities, SAMPLE_NGSI } from '../src/adapters/acris.js';
import { Store } from '../src/db.js';
import { seedAll } from '../src/seed/seed.js';
import { decide } from '../src/engine/decision.js';
import { screenCatchment } from '../src/engine/presence.js';

test('AODB CSV row parses to canonical Flight', () => {
  const flights = parseAodbCsv(SAMPLE_CSV);
  assert.equal(flights.length, 3);
  const xy = flights[0];
  assert.equal(xy.id, 'F-XY501'); assert.equal(xy.gate, 42); assert.equal(xy.std, 865);
  assert.equal(xy.pax, 240); assert.equal(xy.delayMin, 45); assert.equal(xy.tobt, 850);
});

test('AIDX XML message parses to canonical FlightEvent', () => {
  const ev = parseAidxMessage(SAMPLE_XML);
  assert.equal(ev.type, 'flight-update');
  assert.equal(ev.flight.flightNo, 'XY501'); assert.equal(ev.flight.gate, 42);
  assert.equal(ev.flight.delayMin, 45); assert.equal(ev.flight.std, 865);
});

test('ACRIS NGSI-LD entities parse to canonical zones/queues', () => {
  const out = parseAcrisEntities(SAMPLE_NGSI);
  assert.equal(out.terminals.length, 1); assert.equal(out.zones.length, 1);
  assert.equal(out.queues.length, 1); assert.equal(out.queues[0].waitMinutes, 9);
});

test('seed anchors exist: XY501 + ZQ88 at Gate 42', () => {
  const s = new Store(); seedAll(s);
  const xy = s.get('flights', 'F-XY501'); const zq = s.get('flights', 'F-ZQ88');
  assert.equal(xy.gate, 42); assert.equal(xy.pax, 240); assert.equal(xy.delayMin, 45);
  assert.equal(zq.gate, 42); assert.equal(zq.pax, 180);
  assert.equal(s.all('screens').length, 180);
});

test('worked example: Gate 42 @14:10 — perfume wins at ~0.86, toy next, lounge filtered', () => {
  const s = new Store(); seedAll(s);
  const screen = s.all('screens').find(x => x.gate === 42);
  assert.ok(screen, 'gate 42 screen exists');
  const catchment = screenCatchment(s, screen, 850);
  assert.ok(catchment.pax > 400, `catchment pax ${catchment.pax}`);
  assert.ok(Math.abs(catchment.intlPct - 0.57) < 0.06, `intl ${catchment.intlPct}`);
  const rec = decide(s, screen, 850, {});
  assert.equal(rec.winner.campaignId, 'C-PERF', `winner was ${rec.winner?.campaignId}`);
  assert.ok(rec.winner.score >= 0.82 && rec.winner.score <= 0.90, `perfume score ${rec.winner.score}`);
  const toy = rec.candidates.find(c => c.campaignId === 'C-TOY');
  assert.ok(toy.final >= 0.45 && toy.final <= 0.58, `toy score ${toy.final}`);
  const lounge = rec.candidates.find(c => c.campaignId === 'C-LOUNGE');
  assert.equal(lounge.status, 'filtered');
  assert.ok(Math.abs(lounge.final - 0.21) < 0.06, `lounge shown score ${lounge.final}`);
  assert.ok(rec.evidence.length >= 3, 'evidence trail present');
});
