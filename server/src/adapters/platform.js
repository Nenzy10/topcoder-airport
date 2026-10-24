// Platform DB adapter: internal tables <-> canonical entities (identity mapping with validation).
const REQUIRED = { Screen: ['id', 'zone', 'status'], Campaign: ['id', 'status', 'zones'], PromoCode: ['code', 'outletId'] };
export function toCanonical(kind, row) {
  for (const f of REQUIRED[kind] || []) if (row[f] === undefined) throw new Error(`${kind} missing field ${f}`);
  return { ...row, source: 'platform-db' };
}
export class PlatformSource {
  constructor(store) { this.name = 'platform-db'; this.store = store; }
  async *stream() {
    for (const s of this.store.all('screens')) yield { type: 'entity', kind: 'Screen', entity: toCanonical('Screen', s), source: this.name };
    for (const c of this.store.all('campaigns')) yield { type: 'entity', kind: 'Campaign', entity: toCanonical('Campaign', c), source: this.name };
  }
}
