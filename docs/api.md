# API Reference

Airport Retail Media Platform — REST + SSE API.

This reference is generated from **`docs/CONTRACT.md`**, the canonical build
contract. Every endpoint listed there appears here, and no endpoint appears
here that is not in the contract. All names are fictional: **Aurora
International Airport**, airlines **XY (Xylo Air)** and **ZQ (Zafiro Air)**,
flight **XY501**, **Gate 42**, and the **"SkyScent Perfume"** campaign are
seed data.

## Contents

- [Conventions](#conventions)
- [Error shape](#error-shape)
- [Configuration & simulation](#configuration--simulation)
- [Live events (SSE)](#live-events-sse)
- [Admin: KPIs, screens, map, incidents, master data, health](#admin-kpis-screens-map-incidents-master-data-health)
- [Flights, presence & outlets](#flights-presence--outlets)
- [Retailer](#retailer)
- [Campaigns, creatives, promos & claims](#campaigns-creatives-promos--claims)
- [Media Manager](#media-manager)
- [Airline Rep](#airline-rep)
- [Decisions & passenger screen](#decisions--passenger-screen)
- [GenAI, recommendations, packages & reports](#genai-recommendations-packages--reports)
- [Endpoint index](#endpoint-index)

---

## Conventions

- **Base:** same origin as the web app. All paths are under `/api`. All
  request and response bodies are **JSON**, except `GET /api/events`, which
  is a Server-Sent Events stream.
- **Simulated time** is minutes since 00:00 (float) internally; API responses
  render clock times as `"HH:MM"` strings in fields named `clock`,
  `expiresAt`, `createdAt`, `std`, `etd`, etc. Fields named `simMinutes`
  carry the numeric form.
- **Speeds:** `1x` = 1 sim-minute per real second; `10x`; `60x`.
- **Decision cadence:** the decision engine recomputes every 1 sim-minute
  per screen; changes are pushed over SSE.
- **No authentication** in this prototype: role selection is a client-side
  switcher, and retailer/airline scoping is by path parameter (`:outletId`,
  `:code`).
- **Identifiers** are strings. Path parameters are written `:name`.
- Query parameters are optional unless marked required.

## Error shape

All errors use one consistent JSON shape with an appropriate HTTP status
(400 for invalid input, 404 for an unknown id/code, 409 for a state conflict
such as claiming an expired promo):

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Screen not found: scr-999"
  }
}
```

| Field | Type | Meaning |
|---|---|---|
| `error.code` | string | Machine-readable error code (e.g. `NOT_FOUND`, `VALIDATION`, `CONFLICT`, `EXPIRED`). |
| `error.message` | string | Human-readable detail, safe to display. |

> Note: `CONTRACT.md` does not itself specify an error format; the shape
> above is the single convention this reference documents for all endpoints.

---

## Configuration & simulation

### GET /api/config

Effective white-label configuration for the deployment.

**Response `200`**

```json
{
  "name": "Aurora International Airport",
  "tagline": "Retail media for the journey",
  "currency": "USD",
  "claimBaseUrl": "http://localhost:8080",
  "languages": ["en", "ar"],
  "theme": { "primary": "#0B3C5D", "accent": "#E8A33D" },
  "flightSource": "mock-aidx"
}
```

| Field | Source |
|---|---|
| `name` | `AIRPORT_NAME` env var |
| `currency` | `CURRENCY` env var |
| `claimBaseUrl` | `CLAIM_BASE_URL` env var (base encoded into promo QRs) |
| `flightSource` | `FLIGHT_SOURCE` env var (adapter in use) |

### GET /api/state

Current simulation clock state.

```json
{ "simMinutes": 845.0, "clock": "14:05", "speed": 1, "playing": true }
```

### POST /api/sim/control

Control the sim clock.

**Request**

```json
{ "action": "jump", "minutes": 845 }
```

| Field | Values |
|---|---|
| `action` | `"play"` \| `"pause"` \| `"speed"` \| `"jump"` (required) |
| `speed` | `1` \| `10` \| `60` — required when `action` is `"speed"` |
| `minutes` | number (minutes since 00:00) — required when `action` is `"jump"` |

**Response `200`** — the new state, same shape as `GET /api/state`.

```json
{ "action": "speed", "speed": 10 }
```

### POST /api/sim/inject

Inject a simulation event. Injected events travel the same path as real feed
events (an injected delay is indistinguishable downstream from an AIDX delay
message).

**Request**

```json
{ "type": "delay", "flightId": "XY501", "minutes": 45 }
```

| Field | Values |
|---|---|
| `type` | `"delay"` \| `"gateChange"` \| `"screenOffline"` \| `"screenOnline"` (required) |
| `flightId` | for `delay` / `gateChange` |
| `minutes` | delay length, for `delay` |
| `gate` | new gate, for `gateChange` |
| `screenId` | for `screenOffline` / `screenOnline` |

**Response `200`**

```json
{
  "ok": true,
  "effects": [
    "flight XY501 delayed 45 min (ETD 15:10)",
    "presence recomputed for zone T2 gates-high",
    "decision re-planned for screens at Gate 42",
    "retailer trigger evaluated: delay > 30 min"
  ]
}
```

---

## Live events (SSE)

### GET /api/events

Server-Sent Events stream (`Content-Type: text/event-stream`). Each message
is a JSON object `{ "type": ..., "data": ... }`.

**Example frame**

```text
data: {"type":"decision","data":{"id":"dec-88112","at":"14:10","screenId":"scr-142","zone":"gates-high","winner":{"campaignId":"cmp-skyscent","name":"SkyScent Perfume — 15% off","score":0.86}}}
```

| `type` | Fires when | `data` |
|---|---|---|
| `tick` | Sim clock advances | Sim state (`simMinutes`, `clock`, `speed`, `playing`) |
| `flight` | A flight event is applied (feed or inject) | Updated flight / flight event |
| `decision` | Decision engine chooses for a screen | `DecisionLog` entry (see `GET /api/decisions`) |
| `impression` | A creative plays on a screen | Screen, campaign/creative, sim time |
| `redemption` | A promo claim succeeds | Redemption + promo/outlet references |
| `incident` | An incident is raised or changes | `Incident` row |
| `presence` | A zone's presence is recomputed | Updated `ZonePresence` row (see `GET /api/presence`) |

Clients should treat events as notifications of new state and re-fetch the
relevant REST resource on reconnect rather than replaying missed events.

---

## Admin: KPIs, screens, map, incidents, master data, health

### GET /api/kpis

Admin KPI strip.

```json
{
  "screensOnlinePct": 97.8,
  "playsToday": 18420,
  "impressionsToday": 612340,
  "revenueToday": 128450,
  "activeCampaigns": 21,
  "avgLatencyMs": 84,
  "decisionsLogged": 90312
}
```

`revenueToday` is in the configured currency (`GET /api/config`).

### GET /api/screens

All screens.

```json
[
  {
    "id": "scr-142", "name": "T2 Gate 42 — Pillar", "terminal": "T2",
    "zone": "gates-high", "gate": 42, "size": "55in",
    "orientation": "16:9", "status": "online", "latencyMs": 72,
    "x": 0.61, "y": 0.34
  }
]
```

`status` is `online` | `degraded` | `offline`. `x`/`y` are normalised map
coordinates.

### GET /api/map

Network map: terminals/zones, screens with status, and presence heat per
zone.

```json
{
  "terminals": [
    { "id": "T1", "name": "Terminal 1", "zones": ["checkin", "security", "retail", "gates-low", "gates-high"] },
    { "id": "T2", "name": "Terminal 2", "zones": ["checkin", "security", "retail", "gates-low", "gates-high"] }
  ],
  "screens": [ { "id": "scr-142", "status": "online", "x": 0.61, "y": 0.34 } ],
  "presence": [ { "zone": "gates-high", "pax": 1840, "intlPct": 57, "heat": 0.82 } ]
}
```

(`screens` entries carry the full screen fields of `GET /api/screens`.)

### GET /api/incidents

Incident tracker rows (auto alerts: screen offline > 5 min, feed lag, failed
creative, …).

```json
[
  {
    "id": "inc-1042", "type": "screen_offline", "severity": "high",
    "entity": "screen", "entityId": "scr-077",
    "message": "Screen offline for 6 min", "owner": "ops",
    "status": "open", "createdAt": "13:58", "ageMin": 12
  }
]
```

### POST /api/incidents/:id

Update an incident.

**Request** — `{ "status": "acknowledged", "owner": "ops-lead" }` (either
field optional).
**Response `200`** — the updated incident row.

### GET /api/master/:entity

List master-data rows. `:entity` is one of `vendors` | `outlets` |
`airlines` | `locations` | `screens`.

```json
[
  { "id": "al-xy", "code": "XY", "name": "Xylo Air" },
  { "id": "al-zq", "code": "ZQ", "name": "Zafiro Air" }
]
```

*(Example shown for `:entity = airlines`; other entities return their own
row shapes — outlets are the rows of `GET /api/outlets`, screens those of
`GET /api/screens`.)*

### POST /api/master/:entity

Create a master-data row. Body = the entity's fields.
**Response** — the created row.

### PUT /api/master/:entity/:id

Update a master-data row. Body = fields to change.
**Response** — the updated row.

### GET /api/feed-health

Per-source feed health (Admin feed-health panel).

```json
[
  { "source": "aidx", "kind": "flights", "status": "healthy", "msgsPerMin": 42, "lastMsg": "14:10", "adapter": "mock-aidx" },
  { "source": "aodb", "kind": "snapshot", "status": "healthy", "msgsPerMin": 1, "lastMsg": "14:05", "adapter": "mock-aodb" },
  { "source": "acris", "kind": "context", "status": "degraded", "msgsPerMin": 6, "lastMsg": "14:07", "adapter": "mock-acris" }
]
```

### GET /api/perf

Performance panel figures.

```json
{
  "apiP95Ms": 118,
  "playlistBuildMs": 9,
  "uptime7d": [
    { "day": "Mon", "pct": 99.9 }, { "day": "Tue", "pct": 100.0 }
  ],
  "decisionMs": 3
}
```

---

## Flights, presence & outlets

### GET /api/flights

Flights today.

**Query parameters**

| Param | Meaning |
|---|---|
| `airline` | Filter by airline code (e.g. `XY`) |
| `terminal` | Filter by terminal (`T1` \| `T2`) |

**Response `200`**

```json
[
  {
    "id": "XY501", "airline": "XY", "flightNo": "501",
    "dest": "DXB", "destName": "Dubai", "std": "14:25", "etd": "15:10",
    "gate": 42, "terminal": "T2", "status": "delayed", "delayMin": 45,
    "pax": 240, "loadFactor": 0.92, "aircraft": "A321"
  },
  {
    "id": "ZQ88", "airline": "ZQ", "flightNo": "88",
    "dest": "MLE", "destName": "Malé", "std": "14:50", "etd": "14:50",
    "gate": 42, "terminal": "T2", "status": "scheduled", "delayMin": 0,
    "pax": 180, "loadFactor": 0.88, "aircraft": "B737"
  }
]
```

### GET /api/presence

`ZonePresence` for every zone: passenger count, projections, mix and the
aggregated crowd profile.

```json
[
  {
    "zone": "gates-high", "terminal": "T2",
    "pax": 1840, "next60": 1240, "next120": 2310,
    "intlPct": 57, "domPct": 43,
    "topDestinations": [
      { "code": "DXB", "pax": 240 }, { "code": "MLE", "pax": 180 }
    ],
    "topNationalities": [
      { "name": "Emirati", "pct": 18 }, { "name": "Indian", "pct": 15 }
    ],
    "profile": {
      "holiday": 0.58, "family": 0.31, "business": 0.22,
      "adults25_54": 0.64, "premium": 0.19, "dwellMedianMin": 52
    }
  }
]
```

### GET /api/outlets

All retail/F&B outlets.

```json
[
  { "id": "out-skyscent", "name": "SkyScent Duty Free", "type": "duty-free", "terminal": "T2", "zone": "gates-high", "vendorId": "ven-aurora-retail" }
]
```

---

## Retailer

### GET /api/retailer/:outletId/dashboard

Live outlet dashboard. Figures tick live; new claims arrive as SSE
`redemption` events.

```json
{
  "impressions": 48210, "scans": 1930, "redemptions": 412,
  "conversionPct": 21.3, "attributedRevenue": 18940,
  "today": {
    "impressions": 5210, "scans": 210,
    "redemptions": 46, "conversionPct": 21.9, "attributedRevenue": 2140
  },
  "live": true
}
```

`attributedRevenue` is in the configured currency.

### GET /api/retailer/:outletId/flow

Passenger flow near the store: the `ZonePresence` row for the outlet's zone,
including `next60` / `next120` projections and top destination/nationality
lists (same shape as `GET /api/presence` entries).

---

## Campaigns, creatives, promos & claims

### GET /api/campaigns

Campaigns.

**Query parameters**

| Param | Meaning |
|---|---|
| `advertiser` | Filter by advertiser id |

**Response `200`**

```json
[
  {
    "id": "cmp-skyscent", "name": "SkyScent Perfume — 15% off",
    "advertiserId": "adv-skyscent", "advertiserName": "SkyScent Duty Free",
    "outletId": "out-skyscent", "status": "active",
    "creativeId": "cre-skyscent-1",
    "zones": ["gates-high"],
    "audience": {
      "destinations": [], "domIntl": "intl",
      "dwellMin": 30, "delayOnly": false
    },
    "schedule": { "start": "06:00", "end": "23:00" },
    "budget": 5000, "spent": 1830,
    "segmentWeights": {
      "intl": 0.9, "holiday": 0.8, "family": 0.2,
      "business": 0.1, "adults25_54": 0.7, "premium": 0.3
    },
    "boostRules": [ { "type": "delay", "minDelayMin": 30, "boost": 1.5 } ]
  }
]
```

### POST /api/campaigns

Create a campaign. Body = the campaign fields (same shape as above, minus
server-assigned `id`/`spent`).

**Response** — the created campaign. Its `status` is `"pending"` if approval
is needed, otherwise `"active"`. Pending campaigns enter the Media approval
queue (`GET /api/media/approvals`) and cannot win decisions until active —
the decision engine's approval filter requires `status = "active"`.

### POST /api/campaigns/:id/duplicate

Duplicate a campaign in one click.
**Response** — the copy, in `draft` status.

### POST /api/campaigns/:id/run-again

Re-run a historical campaign.
**Response** — a new `active` copy with a fresh budget window.

### GET /api/campaigns/:id/audience-preview

Live audience-match preview for the campaign builder.

**Query parameters**

| Param | Meaning |
|---|---|
| `zone` | Zone to preview against (e.g. `gates-high`) |
| `from` | Window start (clock or sim-minutes) |
| `to` | Window end |

**Response `200`**

```json
{
  "matchPct": 64, "expectedImpressions": 3100,
  "expectedRedemptions": 95, "crowdSize": 4860
}
```

### GET /api/creatives

Creative library.

```json
[
  {
    "id": "cre-skyscent-1", "name": "SkyScent — Delay Treat",
    "template": "offer-hero", "headline": "Flight delayed? Treat yourself.",
    "sub": "15% off all SkyScent perfume, today only",
    "cta": "Scan to claim 15% off", "lang": "en",
    "advertiserId": "adv-skyscent"
  }
]
```

### POST /api/creatives

Add a creative to the library. Body = creative fields.
**Response** — the created creative.

### GET /api/promos

Promo codes.

**Query parameters**

| Param | Meaning |
|---|---|
| `outletId` | Filter by outlet |

**Response `200`**

```json
[
  {
    "code": "SKY15-XY501", "outletId": "out-skyscent",
    "campaignId": "cmp-skyscent", "discount": 15,
    "expiresAt": "14:55", "flightId": "XY501",
    "redemptions": 46, "maxRedemptions": 300,
    "shareCode": "SKY15-FAM-7K2"
  }
]
```

`expiresAt` is the linked flight's boarding close when the promo is
flight-linked. `shareCode` is the share-to-family second code.

### POST /api/promos

Create a promo and its QR code.

**Request**

```json
{ "outletId": "out-skyscent", "campaignId": "cmp-skyscent", "discount": 15, "flightId": "XY501" }
```

**Response `200`**

```json
{
  "promo": {
    "code": "SKY15-XY501", "outletId": "out-skyscent",
    "campaignId": "cmp-skyscent", "discount": 15,
    "expiresAt": "14:55", "flightId": "XY501",
    "redemptions": 0, "maxRedemptions": 300, "shareCode": "SKY15-FAM-7K2"
  },
  "qrDataUrl": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA…",
  "claimUrl": "http://localhost:8080/claim/SKY15-XY501"
}
```

`qrDataUrl` is generated server-side with the `qrcode` package; `claimUrl`
is built on the configured claim base URL (`CLAIM_BASE_URL`).

### GET /api/claim/:code

Validate a promo code and describe what claiming it gives (claim page data).

```json
{
  "valid": true, "discount": 15, "outletName": "SkyScent Duty Free",
  "expiresAt": "14:55", "campaignName": "SkyScent Perfume — 15% off"
}
```

### POST /api/claim/:code

Record a redemption for a promo code.

**Response `200`**

```json
{ "redeemed": true, "redemptionId": "red-50213" }
```

Side effects: a `Redemption` is recorded, campaign conversion estimates are
updated (decision-engine *Learn* step), and an SSE `redemption` event pushes
the change to the Retailer dashboard immediately. Expired or exhausted codes
return the standard [error shape](#error-shape) with a conflict/expired code.

### GET /api/history

Campaign history (30 days).

```json
[
  {
    "campaignId": "cmp-skyscent", "name": "SkyScent Perfume — 15% off",
    "advertiserName": "SkyScent Duty Free",
    "spend": 4210, "impressions": 96400, "redemptions": 1930,
    "roi": 3.4, "days": 30
  }
]
```

### GET /api/triggers

Retailer trigger rules (e.g. "delay > 30 min to DXB → 15% off at Gates
40–45" — the campaign boost rules' operational view).

```json
[
  {
    "id": "trg-1", "condition": { "dest": "DXB", "delayMin": 30 },
    "action": { "discount": 15, "text": "15% off — your flight is delayed, treat yourself" },
    "zone": "gates-high", "active": true
  }
]
```

### POST /api/triggers

Create a trigger rule.

**Request** — `{ "condition": { "dest": "DXB", "delayMin": 30 },
"action": { "discount": 15, "text": "…" }, "zone": "gates-high" }`
**Response** — the created rule.

### POST /api/triggers/:id/toggle

Enable/disable a trigger rule.
**Response** — the updated rule.

---

## Media Manager

### GET /api/media/calendar

Inventory calendar: screens × hours, each cell booked / available / premium
(premium = high predicted footfall).

```json
{
  "screens": [ { "id": "scr-142", "name": "T2 Gate 42 — Pillar" } ],
  "hours": [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23],
  "cells": {
    "scr-142|14": { "status": "premium", "price": 220, "campaignName": "SkyScent Perfume — 15% off" },
    "scr-142|15": { "status": "booked", "price": 180, "campaignName": "SkyScent Perfume — 15% off" },
    "scr-142|16": { "status": "available", "price": 95, "campaignName": null }
  }
}
```

Cell keys are `"screenId|hour"`. Prices are in the configured currency.

### GET /api/media/yield

Yield & pricing: occupancy, per-slot price suggestions from predicted
presence, and the 7-day revenue forecast.

```json
{
  "occupancyPct": 68,
  "suggestions": [
    { "screenId": "scr-142", "hour": 14, "price": 220, "presence": 1840 }
  ],
  "forecast7d": [
    { "day": "Sat", "revenue": 14200 }, { "day": "Sun", "revenue": 13850 }
  ]
}
```

### GET /api/media/approvals

Approval queue: campaigns awaiting a decision, with their creative and the
brand-safety checklist.

```json
[
  {
    "campaignId": "cmp-new-1", "name": "ToyWorld — B2G1",
    "advertiserName": "ToyWorld",
    "creative": { "headline": "Buy 2, get 1 free", "sub": "All travel toys", "cta": "Find us at Gate 44", "template": "offer-hero", "lang": "en" },
    "checklist": { "logo": true, "claimsSubstantiated": true, "noCompetitorMarks": true, "languageOk": false },
    "status": "pending"
  }
]
```

(The checklist keys are those recorded for the campaign's review; the
contract fixes the container, `logo` being its example key.)

### POST /api/media/approvals/:id

Decide an approval. `:id` is the campaign id from the queue.

**Request**

```json
{ "decision": "approve", "checklist": { "logo": true, "claimsSubstantiated": true, "noCompetitorMarks": true, "languageOk": true } }
```

| Field | Values |
|---|---|
| `decision` | `"approve"` \| `"reject"` (required) |
| `checklist` | the completed brand-safety checklist |

**Response** — the updated approval entry. Approving sets the campaign
`active`, making it eligible for the decision engine.

### GET /api/media/advertisers

Advertiser overview: spend, running campaigns, under-delivery flags.

```json
[
  { "id": "adv-skyscent", "name": "SkyScent Duty Free", "spend": 4210, "running": 3, "underDelivering": false }
]
```

---

## Airline Rep

### GET /api/airline/:code/flights

The airline's flights today — same row shape as `GET /api/flights`,
filtered to `:code` (e.g. `XY`).

### GET /api/airline/messages

Gate-area messages scheduled by airlines.

```json
[
  {
    "id": "msg-31", "airline": "XY", "gate": 42,
    "text": "XY501 passengers: enjoy 15% off SkyScent while you wait",
    "kind": "partner", "scheduleWindow": { "start": "13:55", "end": "15:10" }
  }
]
```

### POST /api/airline/messages

Schedule sponsored content at the airline's own gates for a boarding window.

**Request**

```json
{ "airline": "XY", "gate": 42, "text": "Upgrade to Xylo Premium from $49 at the gate desk", "kind": "upgrade", "scheduleWindow": { "start": "13:55", "end": "14:25" } }
```

`kind` distinguishes e.g. upgrade / lounge / destination-partner content.
**Response** — the created message.

### GET /api/airline/goodwill

Delay goodwill automation: the rules, and the log of firings.

```json
{
  "rules": [
    { "airline": "XY", "thresholdMin": 60, "offer": "Meal voucher", "coFundOutletId": "out-cafe", "active": true }
  ],
  "fired": [
    { "flightId": "XY501", "offer": "Meal voucher", "at": "15:25" }
  ]
}
```

### POST /api/airline/goodwill

Create/update a goodwill rule. When a flight's delay passes `thresholdMin`,
the `offer` — co-funded with the F&B outlet `coFundOutletId` — is auto-pushed
to that flight's gate screens and recorded under `fired`.

**Request** — `{ "thresholdMin": 60, "offer": "Meal voucher",
"coFundOutletId": "out-cafe", "active": true }`
**Response** — the created rule.

### GET /api/airline/marketplace

Co-marketing marketplace: retailer offers an airline can attach to its gate
messaging.

```json
[
  { "id": "mkt-7", "outletName": "SkyScent Duty Free", "offer": "15% off for delayed passengers", "zone": "gates-high", "price": 120, "accepted": false }
]
```

### POST /api/airline/marketplace/:id/accept

Accept a marketplace offer (1-click).
**Response** — the updated offer, `accepted: true`.

---

## Decisions & passenger screen

### GET /api/decisions

Search the decision log — the audit trail behind every play and the data
behind "Why this ad?" and Media's conflict view.

**Query parameters**

| Param | Meaning |
|---|---|
| `screenId` | Only decisions for this screen |
| `q` | Free-text search (campaign name, reason, zone…) |
| `limit` | Max rows returned |

**Response `200`**

```json
[
  {
    "id": "dec-88112", "at": "14:10", "screenId": "scr-142", "zone": "gates-high",
    "profile": {
      "holiday": 0.58, "family": 0.31, "business": 0.22,
      "intlPct": 57, "dwellMedianMin": 52
    },
    "winner": { "campaignId": "cmp-skyscent", "name": "SkyScent Perfume — 15% off", "score": 0.86 },
    "candidates": [
      { "campaignId": "cmp-skyscent", "name": "SkyScent Perfume — 15% off", "match": 0.71, "boost": 1.5, "final": 0.86, "status": "winner" },
      { "campaignId": "cmp-toyworld", "name": "ToyWorld — B2G1", "match": 0.49, "boost": 1.0, "final": 0.52, "status": "next" },
      { "campaignId": "cmp-bizlounge", "name": "BizLounge pass", "match": 0.18, "boost": 1.0, "final": 0.21, "status": "filtered" }
    ],
    "reason": "Highest final score: intl/holiday match 0.71 × delay boost 1.5 (XY501 delayed 45 min)",
    "evidence": [
      { "source": "aidx", "detail": "XY501 delayed 45 min", "freshnessSec": 38 },
      { "source": "acris", "detail": "T2 security queue 12 min", "freshnessSec": 95 },
      { "source": "aodb", "detail": "XY501 240 pax, gate 42", "freshnessSec": 300 }
    ]
  }
]
```

Scoring (engine): `final = clamp01(match^0.7 · boost^0.55 · pacing)`, where
`match` is the weighted mean of segment fits. Filters run before scoring —
see [architecture.md](architecture.md#decision-engine).

### POST /api/decisions/pin

Manually pin a screen to a campaign (Media override), with a reason. The pin
is recorded in the decision log — it does not silently replace scored
decisions.

**Request**

```json
{ "screenId": "scr-142", "campaignId": "cmp-skyscent", "reason": "Airport authority announcement partner slot" }
```

**Response** — the recorded pin.

### GET /api/screen/:id/playlist

Everything the Passenger Screen simulator renders for one screen: what's
playing now, the queue, the FIDS-style context flights, the "Why this ad?"
payload, and the live promo (if any).

```json
{
  "screen": {
    "id": "scr-142", "name": "T2 Gate 42 — Pillar", "terminal": "T2",
    "zone": "gates-high", "gate": 42, "size": "55in",
    "orientation": "16:9", "status": "online", "latencyMs": 72, "x": 0.61, "y": 0.34
  },
  "now": {
    "campaign": { "id": "cmp-skyscent", "name": "SkyScent Perfume — 15% off" },
    "creative": {
      "id": "cre-skyscent-1", "template": "offer-hero",
      "headline": "Flight delayed? Treat yourself.",
      "sub": "15% off all SkyScent perfume, today only",
      "cta": "Scan to claim 15% off", "lang": "en"
    },
    "endsInSec": 24
  },
  "queue": [
    { "campaignId": "cmp-toyworld", "name": "ToyWorld — B2G1", "score": 0.52 }
  ],
  "contextFlights": [
    { "id": "XY501", "airline": "XY", "flightNo": "501", "dest": "DXB", "std": "14:25", "etd": "15:10", "gate": 42, "status": "delayed", "delayMin": 45 },
    { "id": "ZQ88", "airline": "ZQ", "flightNo": "88", "dest": "MLE", "std": "14:50", "etd": "14:50", "gate": 42, "status": "scheduled", "delayMin": 0 }
  ],
  "why": {
    "profile": { "holiday": 0.58, "family": 0.31, "business": 0.22, "intlPct": 57, "dwellMedianMin": 52 },
    "candidates": [
      { "campaignId": "cmp-skyscent", "name": "SkyScent Perfume — 15% off", "match": 0.71, "boost": 1.5, "final": 0.86, "status": "winner" },
      { "campaignId": "cmp-toyworld", "name": "ToyWorld — B2G1", "match": 0.49, "boost": 1.0, "final": 0.52, "status": "next" },
      { "campaignId": "cmp-bizlounge", "name": "BizLounge pass", "match": 0.18, "boost": 1.0, "final": 0.21, "status": "filtered" }
    ],
    "winner": { "campaignId": "cmp-skyscent", "name": "SkyScent Perfume — 15% off", "score": 0.86 }
  },
  "promo": {
    "code": "SKY15-XY501",
    "qrDataUrl": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA…",
    "claimUrl": "http://localhost:8080/claim/SKY15-XY501",
    "expiresInSec": 2700
  }
}
```

`promo` is `null` when no live promo is attached to the current play.
`expiresInSec` is the live countdown rendered next to the QR.

---

## GenAI, recommendations, packages & reports

### POST /api/genai/brief

GenAI creative assistant — **local mock provider** behind a provider
interface (no external keys). A one-line brief becomes a ready creative in a
template, in the requested language.

**Request**

```json
{ "brief": "15% off perfume for delayed holiday travellers to Dubai", "lang": "en" }
```

**Response `200`**

```json
{
  "creative": {
    "headline": "Flight delayed? Treat yourself.",
    "sub": "15% off SkyScent perfume for travellers to Dubai",
    "cta": "Scan to claim 15% off",
    "template": "offer-hero", "lang": "en"
  },
  "rationale": "Delay + holiday audience: lead with empathy, then the offer; offer-hero template keeps the QR CTA in the safe zone."
}
```

The returned creative can be saved via `POST /api/creatives`. A generated
suggestion never bypasses the decision engine's filters, scoring or logging.

### GET /api/recommend/slots

"Best 3 slots for this campaign tomorrow", ranked, with predicted
impressions.

**Query parameters**

| Param | Meaning |
|---|---|
| `campaignId` | Campaign to recommend for (required) |

**Response `200`**

```json
{
  "slots": [
    { "screenId": "scr-142", "zone": "gates-high", "day": "tomorrow", "hour": 14, "predictedImpressions": 3100, "score": 0.91 },
    { "screenId": "scr-087", "zone": "retail", "day": "tomorrow", "hour": 11, "predictedImpressions": 2650, "score": 0.84 },
    { "screenId": "scr-150", "zone": "gates-high", "day": "tomorrow", "hour": 18, "predictedImpressions": 2410, "score": 0.79 }
  ]
}
```

### GET /api/packages

Media package builder — saved packages.

```json
[
  { "id": "pkg-1", "name": "T2 Departures Peak", "screenIds": ["scr-142", "scr-150"], "hours": [7, 8, 17, 18], "discountPct": 10 }
]
```

### POST /api/packages

Create a package.

**Request** — `{ "name": "T2 Departures Peak", "screenIds": ["scr-142"],
"hours": [7, 8], "discountPct": 10 }`
**Response** — the created package.

### GET /api/report/advertiser/:id

One-click advertiser report: a printable summary object for the advertiser
(spend, delivery, redemptions and campaign breakdown, renderable as a
print/share view).

```json
{
  "advertiserId": "adv-skyscent", "advertiserName": "SkyScent Duty Free",
  "currency": "USD",
  "totals": { "spend": 4210, "impressions": 96400, "redemptions": 1930, "roi": 3.4 },
  "campaigns": [
    { "campaignId": "cmp-skyscent", "name": "SkyScent Perfume — 15% off", "spend": 4210, "impressions": 96400, "redemptions": 1930, "roi": 3.4, "status": "active" }
  ]
}
```

*(The contract fixes this endpoint as returning a "printable summary
object"; the field layout above is the summary's documented shape.)*

---

## Endpoint index

| Method | Path |
|---|---|
| GET | `/api/config` |
| GET | `/api/state` |
| POST | `/api/sim/control` |
| POST | `/api/sim/inject` |
| GET | `/api/events` (SSE) |
| GET | `/api/kpis` |
| GET | `/api/screens` |
| GET | `/api/map` |
| GET | `/api/incidents` |
| POST | `/api/incidents/:id` |
| GET | `/api/master/:entity` |
| POST | `/api/master/:entity` |
| PUT | `/api/master/:entity/:id` |
| GET | `/api/feed-health` |
| GET | `/api/perf` |
| GET | `/api/flights` |
| GET | `/api/presence` |
| GET | `/api/outlets` |
| GET | `/api/retailer/:outletId/dashboard` |
| GET | `/api/retailer/:outletId/flow` |
| GET | `/api/campaigns` |
| POST | `/api/campaigns` |
| POST | `/api/campaigns/:id/duplicate` |
| POST | `/api/campaigns/:id/run-again` |
| GET | `/api/campaigns/:id/audience-preview` |
| GET | `/api/creatives` |
| POST | `/api/creatives` |
| GET | `/api/promos` |
| POST | `/api/promos` |
| GET | `/api/claim/:code` |
| POST | `/api/claim/:code` |
| GET | `/api/history` |
| GET | `/api/triggers` |
| POST | `/api/triggers` |
| POST | `/api/triggers/:id/toggle` |
| GET | `/api/media/calendar` |
| GET | `/api/media/yield` |
| GET | `/api/media/approvals` |
| POST | `/api/media/approvals/:id` |
| GET | `/api/media/advertisers` |
| GET | `/api/airline/:code/flights` |
| GET | `/api/airline/messages` |
| POST | `/api/airline/messages` |
| GET | `/api/airline/goodwill` |
| POST | `/api/airline/goodwill` |
| GET | `/api/airline/marketplace` |
| POST | `/api/airline/marketplace/:id/accept` |
| GET | `/api/decisions` |
| POST | `/api/decisions/pin` |
| GET | `/api/screen/:id/playlist` |
| POST | `/api/genai/brief` |
| GET | `/api/recommend/slots` |
| GET | `/api/packages` |
| POST | `/api/packages` |
| GET | `/api/report/advertiser/:id` |
