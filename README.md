# Airport Retail Media Platform

> **Playground deployment (for reviewers):** a hosted playground of this exact build is being deployed and its URL will be added in an updated submission before the deadline. The complete experience — simulation, decision engine, all five role dashboards, QR claim flow — runs identically from the one-command local start below (`docker compose up`, then http://localhost:8080). No accounts, API keys or cloud services are needed.



**Aurora International Airport — prototype**

A contextual retail-media platform for airports: digital screens around the
terminal show the *right* ad for the passengers actually standing in front of
them, at that moment. Every placement is driven by live (simulated) flight and
passenger-flow data — who is in the zone, where they are flying, how long they
will dwell, and whether their flight is delayed — and every placement is
logged, scored and explainable through a **"Why this ad?"** evidence trail.

All names in this project are fictional. The seed airport is **Aurora
International Airport**, the seed airlines include **XY — Xylo Air** and
**ZQ — Zafiro Air**, and the seed campaigns include
**"SkyScent Perfume — 15% off"**. No real airport, airline or brand marks are
used. The airport name, currency and branding are white-label configuration
(see [Configuration](#configuration)).

> **Authoritative API:** `docs/CONTRACT.md` is the build contract this code
> implements. The human-readable API reference generated from it is
> [`docs/api.md`](docs/api.md). Where the original challenge brief and the
> contract differ, the contract wins (differences are listed in
> [`docs/architecture.md`](docs/architecture.md#contract-vs-brief-differences)).

---

## Table of contents

- [Quickstart](#quickstart)
- [Demo walkthrough — the Gate 42 / 14:10 worked example](#demo-walkthrough--the-gate-42--1410-worked-example)
- [Architecture overview](#architecture-overview)
- [Stack and justification](#stack-and-justification)
- [Project layout](#project-layout)
- [Configuration](#configuration)
- [Roles and features](#roles-and-features)
- [Testing](#testing)
- [Deployment](#deployment)
- [Further documentation](#further-documentation)

---

## Quickstart

### Option A — Docker (one command, recommended)

```bash
docker compose up
```

Then open:

```
http://localhost:8080
```

`docker-compose.yml` defines a **single `app` service**. Its multi-stage
`Dockerfile`:

1. builds the web frontend (`web/` → `dist/`),
2. installs the server runtime,
3. starts the Node server on **port 8080**, which serves both the REST API
   (`/api/*`) and the built frontend as static files.

The database needs no setup: it is an **in-memory SQLite database created and
seeded at boot** (see [Architecture](#architecture-overview)). Restarting the
container returns the demo to the same deterministic seed state.

### Option B — Local development (`npm run dev`)

Prerequisite: **Node 20+** (the server uses the built-in `node:sqlite`
module).

```bash
npm install        # from the app/ root — installs server and web workspaces
npm run dev
```

This runs, concurrently:

| Process | Address | Purpose |
|---|---|---|
| Express server | `http://localhost:8080` | REST API, SSE stream, simulation engine |
| Vite dev server | Vite's dev address (printed on start) | React frontend with hot reload; proxies `/api` (including the SSE endpoint) to `:8080` |

In development you work against the Vite address; in production/Docker there
is only `:8080`, because the server serves the frontend build itself.

No login is required. Use the **role switcher in the header** to move between
Admin, Retailer, Media Manager, Airline Rep and the Passenger Screen
simulator. The **simulation control bar** (play / pause, speed
1x / 10x / 60x, jump-to-time, inject-event) is visible in every role.

### Simulation speeds

Simulated time is measured in **minutes since 00:00**; the UI clock renders it
as `HH:MM`.

| Speed | Meaning |
|---|---|
| `1x` | 1 simulated minute per real second |
| `10x` | 10 simulated minutes per real second |
| `60x` | 60 simulated minutes per real second |

---

## Demo walkthrough — the Gate 42 / 14:10 worked example

This script reproduces the challenge's worked example end-to-end. It is the
fastest way to see the whole cause-and-effect chain: flight data → zone
presence → decision engine → passenger screen → QR claim → retailer revenue.

**Seed anchors the script relies on** (deterministic seed, mulberry32, seed
`42`):

- **XY501 → DXB**, 240 passengers, STD **14:25**, **Gate 42** (Terminal 2,
  `gates-high` zone), international, holiday-heavy crowd profile, with a
  **seeded 45-minute delay**.
- **ZQ88 → MLE** (beach destination), 180 passengers, STD **14:50**, also
  Gate 42, leisure profile.
- Two domestic business flights at Gates 44/45 (~160 passengers each), which
  balance the catchment to roughly **57% international**.
- Campaign **"SkyScent Perfume — 15% off"** (duty-free retailer; segment
  weights on international / holiday / adults 25–54; a **delay boost rule of
  1.5x**).

### Steps

1. **Start the app** (`docker compose up`) and open `http://localhost:8080`.
2. **Jump the simulation clock to about 14:05.**
   Use the sim control bar's jump-to-time control (equivalently,
   `POST /api/sim/control` with `{"action":"jump","minutes":845}`), then let
   it play. 14:05 is five minutes before the decision moment, so you can watch
   the 14:10 state form rather than arriving after it.
3. **Inject / observe the XY501 delay.**
   - The seeded state already carries XY501's 45-minute delay. To demonstrate
     the live injection path instead, use the sim bar's **inject delay**
     action on XY501 (equivalently, `POST /api/sim/inject` with
     `{"type":"delay","flightId":"XY501","minutes":45}`).
   - Within ~2 seconds you should see the effect propagate over SSE: the
     Airline view updates XY501's status/ETD, Gate 42 zone presence rises
     (delayed passengers dwell longer), the retailer's delay trigger becomes
     relevant, and gate screens re-plan.
4. **Open the Passenger Screen simulator for a Gate 42 screen.**
   Pick the screen at Gate 42. You see the full-screen playlist in its frame,
   a FIDS-style context strip with the nearby flights (XY501 delayed, ZQ88),
   and — at ~14:10 — the winning ad.
5. **Read "Why this ad?".**
   Open the overlay on the passenger screen. At 14:10 the expected result is:

   | | Crowd profile (Gate 42 catchment, 14:10) | |
   |---|---|---|
   | Holiday | 58% | |
   | Family | 31% | |
   | Business | 22% | |
   | International | 57% | |
   | Median dwell | 52 min | |

   | Candidate | Match | Boost | Final | Outcome |
   |---|---|---|---|---|
   | **SkyScent Perfume — 15% off** | 0.71 | 1.5 (delay rule) | **≈ 0.86** | **Plays** |
   | ToyWorld — B2G1 | 0.49 | 1.0 | ≈ 0.52 | Next in queue |
   | BizLounge pass | 0.18 | 1.0 | ≈ 0.21 | Filtered to other gates |

   The overlay shows the crowd-profile bars, the top-3 candidate scores and
   the winning rule — the same record that is written to the decision log
   (searchable in Admin via `GET /api/decisions`).
6. **Claim the promo QR.**
   The passenger screen shows a promo QR with a live countdown (the promo
   expires at the linked flight's boarding close). Scan it — or open its claim
   URL directly — on the mobile-layout claim page and confirm the claim
   (`POST /api/claim/:code`).
7. **Watch the Retailer dashboard.**
   Switch to the Retailer role (the duty-free outlet behind SkyScent). The
   redemption appears immediately — pushed over SSE, no refresh — and the
   outlet's scans, redemptions, conversion % and attributed revenue tick up.

**Things to try next:** pause the sim and inject a **gate change** or take a
**screen offline** (an incident is raised in Admin); build a campaign in the
Retailer campaign builder and check its live audience-match preview; ask the
GenAI assistant for a creative from a one-line brief; ask for the **best 3
slots tomorrow** for a campaign from the recommendation endpoint.

---

## Architecture overview

One server process does everything: it ingests source data through adapters,
normalises it into a single canonical model, runs the simulation and decision
engines, and pushes every change to the browser over Server-Sent Events. The
frontend never talks to a data source directly — it only sees the canonical
model via the REST API and the SSE stream.

```text
  AODB snapshot        AIDX XML feed         ACRIS NGSI-LD        Platform DB
  (CSV / JSON)         (FlightLegNotifRQ)    (JSON entities)      (tables)
       │                     │                     │                    │
       ▼                     ▼                     ▼                    ▼
  ┌─────────┐          ┌─────────┐           ┌─────────┐          ┌──────────┐
  │ aodb.js │          │ aidx.js │           │acris.js │          │platform.js│
  └────┬────┘          └────┬────┘           └────┬────┘          └────┬─────┘
       └───────────┬────────┴─────────┬──────────┘                   │
                   ▼                  ▼                              │
            FlightSource.stream()  ──►  CANONICAL MODEL  ◄───────────┘
            AsyncIterable<FlightEvent>  Flight · GateAssignment ·
                                        AircraftType · Terminal · Zone ·
                                        Checkpoint · QueueMeasurement ·
                                        Screen · Campaign · …
                                              │
                        ┌─────────────────────┼──────────────────────┐
                        ▼                     ▼                      ▼
                 ┌────────────┐       ┌──────────────┐       ┌────────────┐
                 │ SQLite     │       │ ZonePresence │       │ Simulation │
                 │ (node:     │       │ per zone /   │       │ engine:    │
                 │  sqlite,   │       │ 5-min window │       │ tick loop, │
                 │  in-memory)│       └──────┬───────┘       │ sim clock  │
                 └────────────┘              │               └─────┬──────┘
                                             ▼                     │
                                    ┌────────────────┐             │
                                    │ Decision engine │◄───────────┘
                                    │ Profile → Filter│
                                    │ → Score → Rules │
                                    │ → Choose+Log    │
                                    │ → Learn         │
                                    └───────┬────────┘
                                            │ decisions, impressions,
                                            │ presence, incidents…
                                            ▼
                              Express REST API  +  SSE  (/api/events)
                                            │
                                            ▼
                              React app (Vite build, served
                              statically by the server in prod)
                              Admin · Retailer · Media · Airline ·
                              Passenger Screen · Claim page
```

The same diagram in Mermaid, plus the deep design (canonical model, adapter
pattern, decision pipeline, determinism and the full SSE catalogue), is in
[`docs/architecture.md`](docs/architecture.md). How to connect a real data
source is in [`docs/adapter-guide.md`](docs/adapter-guide.md).

Key architectural facts:

- **Canonical model only.** The application core only ever sees canonical
  entities. Adapters translate each source format into that model; nothing
  downstream knows what an AODB column or an AIDX element is called.
- **Simulation engine (server-side).** A tick loop advances the sim clock at
  the selected speed, recomputes `ZonePresence`, runs the decision engine per
  screen (recompute cadence: **every 1 sim-minute per screen**) and emits SSE
  events.
- **ZonePresence.** Per zone, per 5-minute window: passenger count,
  nationality/destination mix, domestic/international split and dwell —
  computed from flights at nearby gates (passengers × time-to-boarding) plus
  ACRIS queue measurements. Every decision and KPI is derived from it.
- **Decision engine.** Per screen, per slot: Profile → Filter → Score →
  Business rules → Choose + Log → Learn. Fully deterministic from logged
  inputs, with an evidence trail per decision (see
  [architecture.md](docs/architecture.md)).
- **GenAI is a local mock.** Creative generation sits behind a provider
  interface and ships with a local mock provider — no external API keys, no
  paid services.

---

## Stack and justification

| Layer | Choice | Why this | Alternatives considered |
|---|---|---|---|
| Runtime | **Node 20+** | One language across server and web tooling; the built-in `node:sqlite` removes the native-database dependency entirely. | Python/FastAPI (would split the stack and the team's JS tooling); Go (faster, but far slower to build this breadth of UI-facing API in). |
| HTTP framework | **Express** | The most widely used, best understood Node framework; trivial static-file serving for the production frontend build; middleware model fits a REST + SSE API with almost no ceremony. | Fastify (marginally faster, less universally familiar to reviewers); NestJS (structure this prototype doesn't need). |
| Live updates | **Server-Sent Events (SSE)** — *no WebSocket library* | The data flow is overwhelmingly one-way (server → browsers: ticks, decisions, impressions, incidents). SSE is plain HTTP, auto-reconnects, works through the Vite dev proxy and any standard reverse proxy, and needs **zero extra dependencies**. Client → server actions are ordinary REST POSTs. | WebSocket (`ws`) adds a dependency, a second protocol to proxy/keep alive, and bidirectional machinery this product never uses. |
| Database | **SQLite via built-in `node:sqlite`** | Embedded, zero-config, zero native builds — the classic risk with `better-sqlite3` in containers disappears. The DB is created **in memory at boot** and seeded deterministically, which makes `docker compose up` reproducible anywhere. The schema in `server/src/db.js` acts as the migrations: it is the single, versioned definition from which every boot builds the database. | `better-sqlite3` (native build risk, no benefit here); Postgres (a second service — breaks the one-command, single-service deployment); a hand-rolled JSON store (no SQL querying for logs/history). |
| Frontend | **React (JSX) + Vite** | React is the most widely used UI library and component model fits five role dashboards sharing one design system; plain JSX keeps the codebase small and build-step simple (no TypeScript compile surface for a prototype). Vite gives instant dev reloads, a dev proxy to the API, and a static `dist/` build the Express server serves in production. | TypeScript (better at scale; extra ceremony here); a framework with SSR (unnecessary — this is an authenticated-style dashboard SPA served by its own API server). |
| QR codes | **`qrcode` npm package** | Mature, tiny, server-side generation to a data URL returned in the API response — the passenger screen just renders an `<img>`, and the claim URL base is configurable for LAN use. | Client-side QR libraries (splits the claim-URL logic across tiers). |
| Containers | **Docker Compose, single service** | One-command start is a hard requirement; a multi-stage build keeps the final image to runtime + built assets. | Multi-service compose (DB/cache containers) — nothing in this design needs one. |

Design constraints honoured throughout: widely used open-source stack only,
**no paid or cloud services**, separate frontend/backend source trees,
responsive layouts for 1440/1920 dashboards plus a mobile claim page.

---

## Project layout

```text
app/
├── docker-compose.yml        # single `app` service, port 8080
├── Dockerfile                # multi-stage: build web → run server
├── package.json              # root scripts: dev, test
├── README.md                 # this file
├── docs/
│   ├── CONTRACT.md           # canonical API & data contract (source of truth)
│   ├── architecture.md       # deep design: model, engines, SSE catalogue
│   ├── adapter-guide.md      # writing/connecting a real data adapter
│   └── api.md                # full API reference (from CONTRACT.md)
├── server/                   # Node 20+ · Express · SSE · node:sqlite
│   ├── package.json
│   ├── src/
│   │   ├── db.js             # SQLite schema (= migrations) + boot/seed wiring
│   │   ├── adapters/
│   │   │   ├── aodb.js       # AODB CSV/JSON snapshot  → canonical
│   │   │   ├── aidx.js       # IATA AIDX-style XML     → FlightEvent stream
│   │   │   ├── acris.js      # ACRIS NGSI-LD JSON      → Terminal/Zone/Queue…
│   │   │   └── platform.js   # platform DB tables      → canonical
│   │   ├── engine/           # simulation tick loop, ZonePresence, decision engine
│   │   ├── seed/             # deterministic seed generator (mulberry32, seed 42)
│   │   └── routes/           # Express routers implementing docs/api.md
│   └── tests/                # node --test smoke tests
└── web/                      # Vite + React (JSX)
    ├── package.json
    ├── vite.config.*         # dev proxy → server :8080
    └── src/                  # role views, passenger screen, claim page
        └── (build output: web/dist/, served statically by the server)
```

Seed scale (deterministic): ~220 flights generated by default (the generator
is capable of ~900 rows for a full day), 180 screens, 40 outlets, 10 airlines,
25 campaigns and 30 days of campaign history. Gates 1–60 across two terminals
(T1: gates 1–30, T2: gates 31–60); zone groups per terminal: `checkin`,
`security`, `retail`, `gates-low`, `gates-high`. A screen at gate *G* covers
gates *G−2 … G+3*.

---

## Configuration

Configuration is by environment variable. All variables are optional; the
defaults run the seeded demo.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | Port the server listens on (API + static frontend). |
| `FLIGHT_SOURCE` | mock AIDX source | Selects the flight-data adapter implementation — mock vs. live stub per source (e.g. `mock-aidx`, `vendor-api`). This is the **single switch** between mock and live adapters; see [adapter-guide.md](docs/adapter-guide.md). |
| `CLAIM_BASE_URL` | same-origin base | Base URL encoded into promo QR codes. Set this to a LAN-reachable address (e.g. the host's LAN IP) when phones must open claim pages from the QR. |
| `AIRPORT_NAME` | `Aurora International Airport` | White-label airport name shown across the UI (also returned by `GET /api/config`). |
| `CURRENCY` | `USD` | Currency for revenue, pricing and yield figures (configurable per deployment; returned by `GET /api/config`). |

Example:

```bash
AIRPORT_NAME="Aurora International Airport" \
CURRENCY=USD \
CLAIM_BASE_URL=http://192.168.1.50:8080 \
FLIGHT_SOURCE=mock-aidx \
docker compose up
```

The effective configuration (name, tagline, currency, claim base URL,
languages `en` + `ar`, theme colours, active flight source) is exposed to the
frontend at `GET /api/config` — the UI never hard-codes it.

---

## Roles and features

No login; a header role switcher selects the role (retailer/airline views
also switch the sample company). Every role shares the sim control bar and
the live sim clock. Summary mapped to the brief's MUST list:

### Admin — dark control-room theme
- **Live network map:** T1/T2 stylised SVG floor plan; every screen a dot
  coloured online / degraded / offline, with a passenger-presence heat
  overlay (`GET /api/map`).
- **KPI strip:** screens online %, ad plays today, impressions, revenue today
  (in the configured currency), active campaigns, average screen latency
  (`GET /api/kpis`).
- **Incident tracker:** auto alerts (screen offline > 5 min, feed lag, failed
  creative) with severity / owner / status (`GET|POST /api/incidents`).
- **Master-data CRUD:** vendors, outlets/F&B, airlines, locations
  (terminal/zone/gate), screens (`GET|POST|PUT /api/master/:entity`).
- Feed health (AODB/AIDX/ACRIS status, msgs/min, adapter in use) and a
  performance panel (API p95, playlist build time, 7-day uptime) —
  `GET /api/feed-health`, `GET /api/perf`.

### Retailer — light theme
- **Live outlet dashboard:** impressions, scans, redemptions, conversion %,
  attributed revenue — ticking live over SSE.
- **Passenger flow near the store:** zone footfall for the next 2 hours from
  departures, top destinations/nationalities ("Next 60 min: 1,240 pax, 38%
  international, top: DXB, LHR, SIN" style).
- **Campaign builder:** creative, zones/screens, audience rules (destination,
  domestic/international, dwell, delay), schedule and budget — with a preview
  on a mock screen and a **live audience-match preview** ("matches 64% of
  crowd at Gates 40–45, 14:00–16:00; expected 3,100 impressions, 95
  redemptions").
- **Creative library** (templates, 1-click campaign duplication) and
  **promo codes**: time-boxed QR codes expiring at the linked flight's
  boarding close, plus a share-to-family second code.
- **Campaign history:** spend, impressions, redemptions, ROI, "run again".
- Trigger rules (e.g. delay > 30 min to DXB → 15% off at Gates 40–45),
  stock-aware pause and budget pacing / A/B are supported by the
  triggers/boost-rule model (see [`docs/api.md`](docs/api.md)).

### Media Manager — light theme
- **Inventory calendar:** screen × hour grid — booked / available / premium
  (premium = high predicted footfall).
- **Yield & pricing:** suggested price per slot from predicted presence,
  occupancy %, 7-day revenue forecast.
- **Approval queue:** approve/reject with a brand-safety checklist.
- **Advertiser overview:** top advertisers by spend, running campaigns,
  under-delivering campaigns flagged.
- Package builder and a one-click advertiser report (print/share view).

### Airline Rep
- **My flights today:** the airline's departures with gate, status, delay and
  load factor.
- **Gate-area messaging:** schedule sponsored content at its own gates for
  the boarding window (upgrades, lounge, destination partners).
- **Delay goodwill automation:** when a delay passes the configured
  threshold, a meal/lounge voucher — co-funded with an F&B retailer — is
  auto-pushed to the gate screens, and the firing is recorded.

### Passenger Screen simulator
- Full-screen view of a chosen screen (by gate/zone); playlist in a 16:9 (or
  9:16) frame matching the screen's orientation.
- FIDS-style context strip with nearby flights next to the ad.
- Ad selection changes dynamically as sim time moves and flights board,
  delay or depart.
- **Promo QR with live countdown**, encoding the claim URL (configurable
  base — see `CLAIM_BASE_URL`); the mobile claim page records the redemption,
  which is visible immediately in the Retailer dashboard.
- **"Why this ad?" overlay:** crowd-profile bars, top-3 candidate scores and
  the winning rule.

### Cross-cutting
- **Split-screen demo mode:** passenger screen on the left, any role
  dashboard on the right.
- **GenAI creative assistant (mock provider, pluggable):** a one-line brief
  becomes a ready ad in a template, in English + the second language
  (`POST /api/genai/brief`).
- **Smart recommendation:** "Best 3 slots for this campaign tomorrow" with
  predicted impressions (`GET /api/recommend/slots`).
- **Internationalisation scaffold:** English + one configurable second
  language (seeded: Arabic, `en` + `ar`) covering at least navigation and ad
  strings.
- **Decision log & overrides:** every decision is logged with its evidence
  trail (Admin search; Media conflict view — "why A beat B"); Media can
  pin/override a screen to a campaign with a reason
  (`POST /api/decisions/pin`).

---

## Testing

```bash
npm test
```

Runs the smoke-test suite with Node's built-in test runner (`node --test`) —
no extra test framework to install. The suite covers the two areas the brief
calls out:

- **Decision engine** — the Gate 42 / 14:10 worked example reproduces:
  SkyScent Perfume wins at a Gate 42 screen with a final score in the
  0.84–0.88 calibration band, ToyWorld is next, BizLounge is filtered/low.
- **Adapter parsing** — an AODB CSV row, an AIDX XML message and an ACRIS
  NGSI-LD entity each parse into the expected canonical entities.

---

## Deployment

The deployable unit is a **single web service**:

- `docker compose up` builds (multi-stage Dockerfile) and runs one `app`
  container on port **8080**.
- The **backend serves the frontend build**: Express serves `web/dist/`
  statically alongside `/api/*`, so there is no separate frontend host, no
  CORS configuration, and the SSE endpoint is same-origin.
- The database is in-memory and re-seeded at boot, so the service is
  stateless across restarts — any host that can run the container (or
  `node server` with the built frontend present) can serve the playground.
- For QR claims from real phones on a local network, set `CLAIM_BASE_URL` to
  the host's reachable address before starting.

---

## Further documentation

| Document | What it covers |
|---|---|
| [`docs/CONTRACT.md`](docs/CONTRACT.md) | The canonical API & data contract this implementation follows (source of truth). |
| [`docs/architecture.md`](docs/architecture.md) | Deep design: canonical model, adapter pattern, simulation engine, ZonePresence, decision pipeline, determinism & audit, SSE catalogue, data-flow diagram. |
| [`docs/adapter-guide.md`](docs/adapter-guide.md) | Writing and connecting a real adapter: canonical entities, the `FlightSource` contract, the three source formats, `FLIGHT_SOURCE` switching, validation/freshness, worked mapping tables. |
| [`docs/api.md`](docs/api.md) | Full API reference: every endpoint, parameters, request/response examples, SSE event types, error shape. |
