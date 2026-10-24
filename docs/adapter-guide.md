# Adapter Guide

How data gets into the Airport Retail Media Platform — and how to connect a
**real** source in place of a mock.

The rule that makes everything else possible:

> **The application core only ever sees the canonical model.** Adapters —
> and only adapters — know what an AODB column, an AIDX element or an
> NGSI-LD attribute is called. If a field name from a source format appears
> outside `server/src/adapters/`, that is a bug.

## Contents

- [The adapter pattern](#the-adapter-pattern)
- [The canonical entities](#the-canonical-entities)
- [The FlightSource interface contract](#the-flightsource-interface-contract)
- [The three source formats](#the-three-source-formats)
  - [AODB — snapshot (CSV / JSON)](#1-aodb--snapshot-csv--json)
  - [AIDX — message feed (XML)](#2-aidx--message-feed-xml)
  - [ACRIS — context entities (NGSI-LD JSON)](#3-acris--context-entities-ngsi-ld-json)
  - [Platform DB](#4-platform-db)
- [Switching sources with FLIGHT_SOURCE](#switching-sources-with-flight_source)
- [Validation & freshness rules](#validation--freshness-rules)
- [Writing a new live adapter — checklist](#writing-a-new-live-adapter--checklist)

---

## The adapter pattern

Every source has a module in `server/src/adapters/` containing **two
implementations of the same interface**:

| Implementation | Behaviour |
|---|---|
| **Mock** | Deterministic. Flight sources replay the seeded day (mulberry32, seed `42`); format adapters can also parse the bundled sample payloads. Used by the demo, the tests and CI. |
| **Live (stub)** | Same interface, same canonical output, wired to the real endpoint shape (URL/queue/file drop, credentials from environment) with the transport left as a stub to complete against the vendor system. |

| File | Source | Style |
|---|---|---|
| `server/src/adapters/aodb.js` | AODB operational database extract | Snapshot (poll / file) |
| `server/src/adapters/aidx.js` | IATA AIDX-style flight information feed | Push (message stream) |
| `server/src/adapters/acris.js` | ACRIS airport collaborative information | NGSI-LD entity query/subscription |
| `server/src/adapters/platform.js` | The platform's own database | Tables read directly (already canonical-shaped) |

The rest of the system never imports a source-specific type. The engine
consumes canonical entities and canonical `FlightEvent`s; the API serves
canonical entities; the decision log's evidence trail cites sources by name
(`aodb`, `aidx`, `acris`) without exposing their payloads.

---

## The canonical entities

These are the only shapes downstream code may depend on (fixed by
`docs/CONTRACT.md`).

**Flight domain** (from AODB / AIDX):

- `Flight` — one flight leg: `id, airline, flightNo, dest, destName, std,
  etd, gate, terminal, status, delayMin, pax, loadFactor, aircraft`.
  Times in the API surface are clock strings; internally the engine works in
  sim-minutes since 00:00.
- `GateAssignment` — flight ↔ gate/stand over a time interval.
- `AircraftType` — aircraft reference data.
- `FlightEvent` — something that happened to a flight (see interface below).

**Spatial / flow domain** (from ACRIS):

- `Terminal` — `id, name` (seed: T1, T2).
- `Zone` — belongs to a terminal. Seed zone groups per terminal: `checkin`,
  `security`, `retail`, `gates-low`, `gates-high` (Gate 42 ∈ T2 `gates-high`).
- `Checkpoint` — a measured point in a zone.
- `QueueMeasurement` — timestamped queue/wait observation at a checkpoint.

**Platform domain** (from the platform DB):

- `Screen` — `id, name, terminal, zone, gate, size, orientation, status,
  latencyMs, x, y`. Catchment rule: a screen at gate *G* covers gates
  *G−2 … G+3*.
- `Advertiser`, `Vendor`, `Outlet` — commercial master data.
- `Campaign` — `id, name, advertiserId, outletId, status, creativeId, zones,
  audience{destinations, domIntl, dwellMin, delayOnly}, schedule{start, end},
  budget, spent, segmentWeights{intl, holiday, family, business,
  adults25_54, premium}, boostRules`.
- `Creative` — `id, name, template, headline, sub, cta, lang, advertiserId`.
- `PromoCode` — `code, outletId, campaignId, discount, expiresAt, flightId,
  redemptions, maxRedemptions, shareCode`.
- `Impression`, `Redemption` — recorded plays and claims.

**Derived** (computed by the engine, never ingested):

- `ZonePresence` — per zone per 5-minute window: `zone, terminal, pax,
  next60, next120, intlPct, domPct, topDestinations[], topNationalities[],
  profile{holiday, family, business, adults25_54, premium, dwellMedianMin}`.
- `DecisionLog`, `Incident`.

---

## The FlightSource interface contract

Flight-bearing sources implement one interface:

```js
/**
 * A source of canonical flight events.
 *
 * @typedef {Object} FlightEvent
 * @property {"created"|"retimed"|"gateChange"|"delay"|"boarding"|
 *            "departed"|"cancelled"|"arrived"} type
 * @property {string} flightId        Canonical flight id (airline + number + date)
 * @property {string} source          Adapter name, e.g. "aidx" — used in evidence trails
 * @property {number} occurredAt      Source timestamp (sim-minutes since 00:00 in mock/sim mode)
 * @property {Object} [flight]        Full canonical Flight snapshot, when the event carries one
 * @property {Object} [changes]       Changed canonical fields, e.g. { etd, delayMin, gate }
 */

class FlightSource {
  /**
   * Stream canonical flight events as they occur.
   * Implementations must be async-iterable and long-lived: the engine
   * consumes the stream for the life of the process.
   *
   * @returns {AsyncIterable<FlightEvent>}
   */
  async *stream() { /* implemented per source */ }
}
```

Contract rules for implementers:

1. **Emit events, not documents.** Translate the source payload fully inside
   the adapter. A consumer must never need the raw XML/CSV/JSON.
2. **Canonical ids.** Build the flight id from airline + flight number +
   operational date so the *same* flight arriving from AODB and AIDX merges
   into one canonical `Flight`.
3. **Idempotent application.** Re-delivering an event must be harmless: the
   engine applies events by overwriting canonical fields with newer source
   timestamps, never by appending duplicates.
4. **Order tolerance.** Events for one flight may arrive out of order; carry
   the source timestamp on every event so the engine can discard stale
   updates (see freshness rules).
5. **Snapshot sources diff.** A snapshot adapter (AODB) synthesises events by
   diffing the new snapshot against the last one it emitted: new leg →
   `created`; changed ETD/milestones → `retimed`; changed gate → `gateChange`;
   new/changed delay → `delay`; status transitions → `boarding` / `departed`
   / `cancelled` / `arrived`.
6. **Never throw into the engine.** A malformed message is logged, counted
   in feed health, and skipped — the stream continues.

Consumption (engine side, illustrative):

```js
const source = createFlightSource(process.env.FLIGHT_SOURCE); // mock | live
for await (const event of source.stream()) {
  engine.applyFlightEvent(event);   // updates Flight, dirties zones, may emit SSE
}
```

---

## The three source formats

### 1. AODB — snapshot (CSV / JSON)

**Shape.** One row per flight leg, roughly **33 columns**: identifiers,
route, schedule, **A-CDM milestone times — TOBT, TSAT, AIBT, AOBT** (plus
STD/ETD and actual/off-block companions) — stand, gate, check-in, belt,
aircraft, passenger count, status and delay codes. Delivered as CSV or the
equivalent JSON array, as a periodic full snapshot.

**Adapter behaviour.** Parse the snapshot → canonical `Flight` +
`GateAssignment` + `AircraftType`; diff against the previous snapshot →
`FlightEvent`s (per contract rule 5 above).

**Worked mapping — AODB row → canonical**

| Source field (snapshot column) | Canonical field | Notes |
|---|---|---|
| Airline code + flight number + operational date | `Flight.id`, `Flight.airline`, `Flight.flightNo` | Composite id; the merge key across sources. |
| Destination airport code | `Flight.dest` | Plus reference-data lookup → `Flight.destName`. |
| STD (scheduled time of departure) | `Flight.std` | Converted to sim-minutes internally. |
| ETD (estimated time of departure) | `Flight.etd` | Falls back to STD when absent. |
| **TOBT** (Target Off-Block Time, A-CDM) | milestone on `Flight` | A-CDM turnaround target; an updated TOBT is a `retimed` event. |
| **TSAT** (Target Start-Up Approval Time, A-CDM) | milestone on `Flight` | Used with TOBT for departure-sequence plausibility. |
| **AOBT** (Actual Off-Block Time, A-CDM) | milestone on `Flight` + status → departed | Presence contribution ends at AOBT. |
| **AIBT** (Actual In-Block Time, A-CDM) | milestone on `Flight` (arrival legs) | Recorded for completeness of the leg record. |
| Gate | `GateAssignment.gate`, `Flight.gate` | A change between snapshots is a `gateChange` event. |
| Stand | `GateAssignment.stand` | Kept on the assignment, not the flight summary. |
| Terminal (derived from gate) | `Flight.terminal` | Seed layout: gates 1–30 → T1, 31–60 → T2. |
| Check-in counters / belt | `Flight` operational detail | Carried for display; not used by the decision engine. |
| Aircraft type code | `AircraftType`, `Flight.aircraft` | Resolves to the aircraft reference entity. |
| Passenger count / booked load | `Flight.pax`, `Flight.loadFactor` | The raw input to ZonePresence. |
| Flight status | `Flight.status` | Normalised to the canonical status vocabulary. |
| Delay minutes + delay codes | `Flight.delayMin`, event `delay` | Codes retained on the event for the evidence trail. |

> Column headers above name the *concepts* the snapshot carries; a vendor
> AODB extract may label them differently. The mapping is written against
> concepts inside `aodb.js` — renaming a source column touches exactly one
> file.

### 2. AIDX — message feed (XML)

**Shape.** Pushed IATA AIDX-style XML messages, `FlightLegNotifRQ` family:
each message notifies a change to one flight leg — creation, retiming,
gate change, delay, boarding, departure, cancellation — carrying the leg
identifiers, times and status in AIDX elements/attributes.

**Adapter behaviour.** Parse each message → exactly one canonical
`FlightEvent` (usually with a `changes` payload). This is the natural live
source: the demo's mock AIDX source replays the seeded day as a message
stream, and an injected delay in the UI travels the same path as a real
AIDX delay notification.

**Worked mapping — AIDX message → canonical `FlightEvent`**

| Source element / concept | Canonical field | Notes |
|---|---|---|
| Leg identifiers (airline, flight number, operational date, departure airport) | `FlightEvent.flightId` | Same composite id as the AODB mapping — this is what lets the two sources merge. |
| Message / notification kind | `FlightEvent.type` | Creation → `created`; time change → `retimed`; gate change → `gateChange`; delay notification → `delay`; status notifications → `boarding` / `departed` / `cancelled` / `arrived`. |
| Message timestamp | `FlightEvent.occurredAt` | Drives freshness and stale-event rejection. |
| Scheduled / estimated departure times | `changes.std` / `changes.etd` → `Flight.std` / `Flight.etd` | |
| A-CDM times carried in the message (TOBT/TSAT/AOBT/AIBT where present) | milestones on `Flight` | Same milestone semantics as the AODB mapping. |
| New gate / stand | `changes.gate` → `GateAssignment` + `Flight.gate` | Triggers catchment recomputation for both old and new gates. |
| Delay duration + reason codes | `changes.delayMin` → `Flight.delayMin` | Reason codes preserved on the event for evidence. |
| Passenger / load figures where present | `Flight.pax` / `Flight.loadFactor` | Snapshots (AODB) remain the usual authority for counts. |

### 3. ACRIS — context entities (NGSI-LD JSON)

**Shape.** NGSI-LD JSON entities: each entity has an `id`, a `type`, and
attributes expressed as Property/Relationship objects (with `@context` on the
payload). ACRIS supplies the *spatial and flow* picture rather than flights.

**Adapter behaviour.** Map entities → `Terminal`, `Zone`, `Checkpoint`,
`QueueMeasurement`. Queue measurements are timestamped observations; the
adapter forwards them in arrival order and the presence engine folds them
into zone dwell.

**Worked mapping — ACRIS NGSI-LD entity → canonical**

| Source entity / attribute | Canonical field | Notes |
|---|---|---|
| Entity `type: Terminal`, `id` | `Terminal.id`, `Terminal.name` | Seed terminals: T1, T2. |
| Entity `type: Zone`, relationship to terminal | `Zone.id`, `Zone.terminal`, `Zone.name` | Zone names align to the seed groups (`checkin`, `security`, `retail`, `gates-low`, `gates-high`). |
| Entity `type: Checkpoint`, relationship to zone | `Checkpoint.id`, `Checkpoint.zone` | e.g. a security lane group feeding a gates zone. |
| Entity `type: QueueMeasurement`, observed-at timestamp | `QueueMeasurement.at` | Stale measurements are dropped by the freshness rules. |
| Queue length / waiting-time Property | `QueueMeasurement` values → presence dwell adjustment | A long queue holds passengers out of downstream zones and lengthens dwell. |
| `location` / geometry attributes where present | Zone/checkpoint placement | Used for map rendering coordinates when supplied. |

Illustrative NGSI-LD fragment (fictional):

```json
{
  "id": "urn:ngsi-ld:QueueMeasurement:T2-SEC-01:1410",
  "type": "QueueMeasurement",
  "@context": ["https://uri.etsi.org/ngsi-ld/v1/ngsi-ld-core-context.jsonld"],
  "checkpoint": { "type": "Relationship", "object": "urn:ngsi-ld:Checkpoint:T2-SEC-01" },
  "waitingTimeMin": { "type": "Property", "value": 12 },
  "observedAt": { "type": "Property", "value": "14:10" }
}
```

### 4. Platform DB

Screens, advertisers, vendors, outlets, campaigns, creatives, promo codes,
impressions and redemptions live in the platform's own tables, which are
already canonical-shaped (see `server/src/db.js`). `platform.js` exists so
that even first-party data enters through the same boundary — e.g. master
data edited through the Admin CRUD endpoints is re-read through the adapter
rather than reaching into tables from the engine.

---

## Switching sources with FLIGHT_SOURCE

One environment variable selects the flight-source implementation:

```bash
FLIGHT_SOURCE=mock-aidx     # default for the demo: deterministic mock AIDX stream
FLIGHT_SOURCE=vendor-api    # live stub: point at the real vendor feed
```

Rules:

- The switch is read **once, at boot**, by the adapter factory
  (`createFlightSource`). No other module branches on it.
- The active source is observable: `GET /api/config` returns it as
  `flightSource`, and `GET /api/feed-health` reports each source's status,
  messages/minute, last message and **adapter in use** — so the Admin UI
  always shows which world the data is coming from.
- Mock and live implementations must be **interchangeable**: same canonical
  output for the same real-world fact. If a live adapter needs a field the
  mock doesn't produce, extend the canonical model and both adapters
  together.

---

## Validation & freshness rules

Adapters are the trust boundary. The core assumes everything an adapter
emits has passed these checks:

**Validation (per message/row, inside the adapter)**

1. Required identifiers present and well-formed (airline + flight number +
   date); rows/messages failing this are dropped and counted, never
   partially applied.
2. Times parse and are monotonic where the domain requires it (e.g. an ETD
   earlier than the STD without a delay/early flag is quarantined for that
   field, not silently trusted).
3. Enumerations normalised to the canonical vocabularies (flight status,
   zone names, entity types); unknown values map to the canonical "unknown"
   state, not to a guess.
4. Numeric ranges sane (passengers ≥ 0, load factor 0–1, delay within a
   plausible band); out-of-range values are rejected per-field.
5. Duplicates detected by (flight id, source timestamp, event type) and
   dropped — feeds are at-least-once in the real world.

**Freshness (engine-side, using adapter-supplied timestamps)**

1. Every `FlightEvent` and `QueueMeasurement` carries its source timestamp;
   the engine tracks the newest applied timestamp per flight/entity and
   **discards stale updates**.
2. Decisions cite freshness explicitly: each `DecisionLog.evidence[]` entry
   carries `freshnessSec`, the age of the fact at decision time.
3. **Deterministic-verification rule:** a scored suggestion is executed only
   if its inputs exist in trusted feeds **and are fresh**, hard rules pass,
   and the score reproduces from logged inputs. Otherwise the engine falls
   back to the rule-based default (see
   [architecture.md](architecture.md#determinism--audit)).
4. Feed health degrades honestly: if a source goes quiet, `GET
   /api/feed-health` shows its `lastMsg` ageing and status degrading, and an
   `Incident` (feed lag) is raised — the UI never presents stale data as
   live.

---

## Writing a new live adapter — checklist

1. **Start from the mock.** Copy the mock implementation of the closest
   existing source; keep the exported factory/interface identical.
2. **Translate at the boundary.** Parse the vendor payload inside the module;
   emit only canonical entities/events. No vendor field names may escape.
3. **Write the mapping table first.** One row per source field → canonical
   field, like the tables above. If a source field has no canonical home,
   decide explicitly: extend the canonical model (and every adapter) or
   drop the field.
4. **Timestamps everywhere.** Every emitted event/measurement carries the
   source timestamp; without it, freshness and stale-rejection cannot work.
5. **Prove it with the smoke tests.** The test suite parses a sample AODB
   CSV row, an AIDX XML message and an ACRIS NGSI-LD entity into canonical
   entities — add your source's sample payload to the same pattern
   (`npm test`).
6. **Wire the switch.** Register the new implementation under a
   `FLIGHT_SOURCE` value; verify `GET /api/config` and
   `GET /api/feed-health` report it.
7. **Fail soft.** Malformed input is logged + counted + skipped. An adapter
   that throws into the engine takes the demo down with it — don't.
