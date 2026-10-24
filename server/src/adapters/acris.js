// ACRIS adapter: NGSI-LD JSON entities -> canonical Terminal / Zone / QueueMeasurement.
export const SAMPLE_NGSI = [
  { id: 'urn:ngsi-ld:Terminal:T2', type: 'Terminal', name: { value: 'Terminal 2' }, code: { value: 'T2' } },
  { id: 'urn:ngsi-ld:Zone:T2-gates-a', type: 'Zone', name: { value: 'T2 Gates A' }, refTerminal: { object: 'urn:ngsi-ld:Terminal:T2' } },
  { id: 'urn:ngsi-ld:QueueMeasurement:SEC-T2-1', type: 'QueueMeasurement', refZone: { object: 'urn:ngsi-ld:Zone:T2-security' },
    queueLength: { value: 132 }, waitMinutes: { value: 9 }, observedAt: { value: '2026-10-25T10:04:00Z' } },
  { id: 'urn:ngsi-ld:Checkpoint:CHK-T2', type: 'Checkpoint', name: { value: 'T2 Check-in Hall' }, throughputPerHour: { value: 1450 } },
];
export function parseAcrisEntities(entities) {
  const out = { terminals: [], zones: [], checkpoints: [], queues: [] };
  for (const e of entities) {
    if (e.type === 'Terminal') out.terminals.push({ id: e.code?.value, name: e.name?.value, source: 'acris' });
    else if (e.type === 'Zone') out.zones.push({ id: e.id.split(':').pop(), name: e.name?.value, terminal: (e.refTerminal?.object || '').split(':').pop(), source: 'acris' });
    else if (e.type === 'Checkpoint') out.checkpoints.push({ id: e.id.split(':').pop(), name: e.name?.value, throughputPerHour: e.throughputPerHour?.value, source: 'acris' });
    else if (e.type === 'QueueMeasurement') out.queues.push({ id: e.id.split(':').pop(), zone: (e.refZone?.object || '').split(':').pop(), queueLength: e.queueLength?.value, waitMinutes: e.waitMinutes?.value, observedAt: e.observedAt?.value, source: 'acris' });
  }
  return out;
}
export class AcrisSource {
  constructor(entities = SAMPLE_NGSI) { this.name = 'mock-acris'; this.entities = entities; }
  async *stream() { yield { type: 'presence-entities', ...parseAcrisEntities(this.entities), at: Date.now(), source: this.name }; }
}
export class LiveAcrisSource {
  constructor() { this.name = 'live-acris'; }
  async *stream() { throw new Error('LiveAcrisSource not configured'); }
}
