// Deterministic seed (mulberry32, seed 42). Fictional airport "Aurora International".
// Includes the worked-example anchors: XY501 (DXB, 240 pax, delayed 45m) and ZQ88
// (MLE beach, 180 pax) at Gate 42 + two domestic business flights at gates 44/45,
// so the Gate-42 / 14:10 decision reproduces the brief's example.
import { mulberry32, pick, range, int } from '../rng.js';

export const TERMINALS = [
  { id: 'T1', name: 'Terminal 1', x: 40, y: 60, w: 430, h: 440 },
  { id: 'T2', name: 'Terminal 2', x: 530, y: 60, w: 430, h: 440 },
];
export const ZONES = [];
for (const t of ['T1', 'T2']) {
  ZONES.push(
    { id: `${t}-checkin`, name: `${t} Check-in`, terminal: t, kind: 'checkin' },
    { id: `${t}-security`, name: `${t} Security`, terminal: t, kind: 'security' },
    { id: `${t}-retail`, name: `${t} Retail Core`, terminal: t, kind: 'retail' },
    { id: `${t}-gates-a`, name: `${t} Gates A`, terminal: t, kind: 'gates', gateFrom: t === 'T1' ? 1 : 31, gateTo: t === 'T1' ? 15 : 45 },
    { id: `${t}-gates-b`, name: `${t} Gates B`, terminal: t, kind: 'gates', gateFrom: t === 'T1' ? 16 : 46, gateTo: t === 'T1' ? 30 : 60 },
  );
}
export const gateZone = (terminal, gate) => gate <= (terminal === 'T1' ? 15 : 45) ? `${terminal}-gates-a` : `${terminal}-gates-b`;
export const gateTerminal = (gate) => (gate <= 30 ? 'T1' : 'T2');

const AIRLINES = [
  ['XY', 'Xylo Air', 'T2'], ['ZQ', 'Zafiro Air', 'T2'], ['AB', 'AeroBridge', 'T2'],
  ['KM', 'Karma Air', 'T1'], ['OR', 'Orbit Airways', 'T1'], ['PL', 'Pulse Air', 'T1'],
  ['TR', 'Terra Airlines', 'T2'], ['VN', 'Vela Air', 'T1'], ['WJ', 'WindJet', 'T2'], ['QD', 'Qamar Air', 'T1'],
];
const ROUTES = [
  // code, name, intl, kind
  ['DXB', 'Dubai', 1, 'hub'], ['MLE', 'Malé', 1, 'leisure'], ['LHR', 'London', 1, 'hub'],
  ['SIN', 'Singapore', 1, 'hub'], ['BKK', 'Bangkok', 1, 'leisure'], ['DOH', 'Doha', 1, 'hub'],
  ['SEY', 'Seychelles', 1, 'leisure'], ['DEL', 'Delhi', 1, 'regional'], ['FRA', 'Frankfurt', 1, 'hub'],
  ['CMB', 'Colombo', 1, 'leisure'], ['MCT', 'Muscat', 1, 'regional'], ['IST', 'Istanbul', 1, 'hub'],
  ['KCT', 'Karama City', 0, 'domestic'], ['NCT', 'North City', 0, 'domestic'], ['SCT', 'South City', 0, 'domestic'],
];
const NATS = {
  hub: [['United Arab Emirates', .22], ['India', .26], ['United Kingdom', .14], ['Pakistan', .12], ['Germany', .08], ['Philippines', .09]],
  leisure: [['United Kingdom', .28], ['Germany', .22], ['India', .16], ['France', .12], ['Italy', .1]],
  regional: [['India', .34], ['Pakistan', .22], ['Bangladesh', .16], ['United Arab Emirates', .12]],
  domestic: [['United Arab Emirates', .52], ['India', .2], ['Pakistan', .14], ['Egypt', .08]],
};
const AIRCRAFT = [ ['NB2', 'Narrowbody 200', 180], ['NB3', 'Narrowbody 300', 210], ['WB3', 'Widebody 300', 290], ['WB4', 'Widebody 400', 340] ];

function profileFor(rng, kind, intl) {
  const base = {
    hub: { holiday: .34, family: .18, business: .38, premium: .3, adults25_54: .68 },
    leisure: { holiday: .88, family: .4, business: .07, premium: .16, adults25_54: .6 },
    regional: { holiday: .3, family: .24, business: .34, premium: .12, adults25_54: .64 },
    domestic: { holiday: .14, family: .1, business: .52, premium: .2, adults25_54: .7 },
  }[kind];
  const j = () => range(rng, -0.05, 0.05);
  return {
    holiday: +(base.holiday + j()).toFixed(2), family: +(base.family + j()).toFixed(2),
    business: +(base.business + j()).toFixed(2), premium: +(base.premium + j()).toFixed(2),
    adults25_54: +(base.adults25_54 + j()).toFixed(2), intl,
  };
}

export function seedAll(store) {
  const rng = mulberry32(42);
  const put = (t, row) => store.put(t, row);

  // ---- vendors / advertisers / outlets ----
  const vendorNames = ['SkyRetail Group', 'DineAir Hospitality', 'LoungeWorks', 'GateGoods', 'Terra Duty Free', 'AromaFoods', 'CloudNine Services', 'Nomad Stores', 'Vista Concessions', 'Orbital Retail', 'PixelPlay Media', 'TravelMart Co'];
  vendorNames.forEach((name, i) => put('vendors', { id: `V${i + 1}`, name, contact: `ops@${name.toLowerCase().replace(/[^a-z]+/g, '')}.example`, category: ['Retail', 'F&B', 'Services'][i % 3] }));

  const outletDefs = [
    ['SkyScent Perfume', 'Duty Free Retail', 'T2', 'T2-retail', 'V5'],
    ['ToyWorld', 'Retail', 'T2', 'T2-retail', 'V1'],
    ['BizLounge', 'Lounge', 'T2', 'T2-gates-b', 'V3'],
    ['CloudBean Coffee', 'F&B', 'T2', 'T2-checkin', 'V6'],
    ['VoltEdge Electronics', 'Retail', 'T2', 'T2-retail', 'V1'],
    ['PageTurner Books', 'Retail', 'T1', 'T1-retail', 'V8'],
  ];
  const shopA = ['Amber', 'Coral', 'Juniper', 'Saffron', 'Velvet', 'Harbour', 'Meadow', 'Onyx', 'Pearl', 'Sierra'];
  const shopB = ['Bakery', 'Grill', 'Sushi Bar', 'Pharmacy', 'Sunglasses', 'Watches', 'Kids Store', 'Newsstand', 'Spa Express', 'Tech Corner', 'Flower Shop', 'Candy House', 'Sports Shop', 'Luggage Point', 'Juice Bar', 'Burger Joint', 'Pasta House', 'Tea Room'];
  outletDefs.forEach(([name, type, terminal, zone, vendorId], i) =>
    put('outlets', { id: `O${i + 1}`, name, type, terminal, zone, vendorId }));
  let oi = outletDefs.length;
  for (let i = 0; i < 34; i++) {
    const t = i % 2 ? 'T2' : 'T1';
    const zoneKind = pick(rng, ['retail', 'checkin', 'gates-a', 'gates-b']);
    put('outlets', { id: `O${++oi}`, name: `${pick(rng, shopA)} ${pick(rng, shopB)}`, type: pick(rng, ['Retail', 'F&B', 'Services', 'Lounge']), terminal: t, zone: `${t}-${zoneKind}`, vendorId: `V${int(rng, 1, 12)}` });
  }
  // advertisers = outlet brands + airlines + external brands
  store.all('outlets').forEach(o => put('advertisers', { id: `ADV-${o.id}`, name: o.name, type: 'retailer', outletId: o.id, spend: 0 }));
  AIRLINES.forEach(([code, name]) => put('advertisers', { id: `ADV-${code}`, name, type: 'airline', airlineCode: code, spend: 0 }));
  [['Hotel Aurelia', 'Hotels'], ['Orbit Car Rental', 'Transport'], ['GlobeSIM', 'Telecom'], ['CityTours Co', 'Leisure'], ['SafeTrip Insurance', 'Insurance']]
    .forEach(([name], i) => put('advertisers', { id: `ADV-X${i + 1}`, name, type: 'external', spend: 0 }));

  // ---- airlines / locations ----
  AIRLINES.forEach(([code, name, terminal]) => put('airlines', { id: code, code, name, terminal, alliance: pick(rng, ['SkyUnion', 'StarBridge', 'None']) }));
  TERMINALS.forEach(t => put('locations', { id: t.id, name: t.name, type: 'terminal', terminal: t.id }));
  ZONES.forEach(z => put('locations', { id: z.id, name: z.name, type: 'zone', terminal: z.terminal }));
  for (let g = 1; g <= 60; g++) put('locations', { id: `G${g}`, name: `Gate ${g}`, type: 'gate', terminal: gateTerminal(g), zone: gateZone(gateTerminal(g), g), gate: g });

  // ---- screens (180) ----
  let sn = 0;
  const addScreen = (name, terminal, zone, gate, size, orientation) => {
    const t = TERMINALS.find(x => x.id === terminal);
    const zx = zone.endsWith('gates-a') ? 0.06 : zone.endsWith('gates-b') ? 0.52 : zone.endsWith('retail') ? 0.3 : zone.endsWith('security') ? 0.3 : 0.06;
    const x = t.x + zx * t.w + (gate ? ((gate % 15) / 15) * t.w * 0.4 : rng() * 60);
    const y = zone.includes('gates') ? 130 + (gate % 3) * 26 : zone.endsWith('retail') ? 300 : zone.endsWith('security') ? 385 : 465;
    const r = rng();
    const row = { id: `SCR-${String(++sn).padStart(3, '0')}`, name, terminal, zone, gate: gate || null, size, orientation,
      status: r < 0.93 ? 'online' : r < 0.97 ? 'degraded' : 'offline', latencyMs: int(rng, 28, 210),
      x: Math.round(x), y: Math.round(y), offlineSince: null };
    put('screens', row); return row;
  };
  for (let g = 1; g <= 60; g++) {
    const t = gateTerminal(g);
    addScreen(`Gate ${g} Screen A`, t, gateZone(t, g), g, '55"', 'landscape');
    addScreen(`Gate ${g} Screen B`, t, gateZone(t, g), g, '43"', g % 4 === 0 ? 'portrait' : 'landscape');
  }
  for (const t of ['T1', 'T2']) {
    for (let i = 0; i < 8; i++) addScreen(`${t} Check-in Totem ${i + 1}`, t, `${t}-checkin`, null, '32"', 'portrait');
    for (let i = 0; i < 6; i++) addScreen(`${t} Security Screen ${i + 1}`, t, `${t}-security`, null, '43"', 'landscape');
    for (let i = 0; i < 16; i++) addScreen(`${t} Retail Screen ${i + 1}`, t, `${t}-retail`, null, i % 5 === 0 ? '86"' : '55"', 'landscape');
  }

  // ---- flights ----
  const flights = [];
  const addFlight = (f) => { put('flights', f); flights.push(f); };
  const mkProfile = (p, intl) => ({ ...p, intl });
  addFlight({ id: 'F-XY501', airline: 'XY', flightNo: 'XY501', dest: 'DXB', destName: 'Dubai', terminal: 'T2', gate: 42, std: 865, delayMin: 45, status: 'DELAYED', aircraft: 'WB3', capacity: 290, pax: 240, profile: mkProfile({ holiday: .84, family: .36, business: .15, premium: .18, adults25_54: .68 }, 1), nationalities: [['United Arab Emirates', .34], ['India', .28], ['United Kingdom', .18]] });
  addFlight({ id: 'F-ZQ88', airline: 'ZQ', flightNo: 'ZQ88', dest: 'MLE', destName: 'Malé', terminal: 'T2', gate: 42, std: 890, delayMin: 0, status: 'SCHEDULED', aircraft: 'WB3', capacity: 290, pax: 180, profile: mkProfile({ holiday: .97, family: .48, business: .04, premium: .12, adults25_54: .6 }, 1), nationalities: [['United Kingdom', .3], ['Germany', .25], ['India', .2]] });
  addFlight({ id: 'F-AB210', airline: 'AB', flightNo: 'AB210', dest: 'KCT', destName: 'Karama City', terminal: 'T2', gate: 44, std: 875, delayMin: 0, status: 'SCHEDULED', aircraft: 'NB2', capacity: 180, pax: 160, profile: mkProfile({ holiday: .12, family: .1, business: .45, premium: .18, adults25_54: .66 }, 0), nationalities: [['United Arab Emirates', .55], ['India', .2], ['Pakistan', .15]] });
  addFlight({ id: 'F-AB214', airline: 'AB', flightNo: 'AB214', dest: 'KCT', destName: 'Karama City', terminal: 'T2', gate: 45, std: 905, delayMin: 0, status: 'SCHEDULED', aircraft: 'NB2', capacity: 180, pax: 160, profile: mkProfile({ holiday: .12, family: .1, business: .45, premium: .18, adults25_54: .7 }, 0), nationalities: [['United Arab Emirates', .55], ['India', .2], ['Pakistan', .15]] });

  const totalFlights = Number(process.env.FLIGHT_COUNT || 220); // generator can produce ~900 (set FLIGHT_COUNT=900)
  const busyGates = new Set(['42|840', '42|900', '44|870', '45|900']);
  let fi = 0;
  while (flights.length < totalFlights) {
    const [code, , terminal] = pick(rng, AIRLINES);
    const route = pick(rng, ROUTES);
    const std = int(rng, 300, 1410);
    let gate = terminal === 'T1' ? int(rng, 1, 30) : int(rng, 31, 60);
    if (gate >= 40 && gate <= 45 && std > 760 && std < 960) gate = 38; // protect worked-example catchment
    const [ac, acName, cap] = pick(rng, AIRCRAFT);
    const load = range(rng, .62, .97);
    const delay = rng() < .18 ? int(rng, 15, 120) : 0;
    const no = `${code}${int(rng, 100, 899)}`;
    addFlight({ id: `F-${no}-${fi++}`, airline: code, flightNo: no, dest: route[0], destName: route[1],
      terminal, gate, std, delayMin: delay, status: delay ? 'DELAYED' : 'SCHEDULED', aircraft: ac,
      capacity: cap, pax: Math.round(cap * load), profile: profileFor(rng, route[3], route[2]),
      nationalities: NATS[route[3]] });
    void busyGates;
  }

  // ---- creatives ----
  const creativeDefs = [
    ['CR-PERF', 'SkyScent Hero', 'promo', 'SkyScent — 15% Off Today', 'Fragrances travellers love, now at Gate prices', 'Shop now', 'ADV-O1'],
    ['CR-TOY', 'ToyWorld B2G1', 'promo', 'Buy 2 Get 1 Free', 'Toys for happy little travellers', 'Grab the offer', 'ADV-O2'],
    ['CR-LOUNGE', 'BizLounge Pass', 'brand', 'BizLounge Day Pass', 'Quiet space, fast Wi-Fi, showers', 'Relax from $39', 'ADV-O3'],
    ['CR-COFFEE', 'CloudBean Morning', 'food', 'Fresh Coffee, Zero Queue', 'Order ahead, pick up at the counter', 'Order now', 'ADV-O4'],
    ['CR-VOLT', 'VoltEdge Tech', 'tech', 'Noise-Cancelling, Travel-Ready', 'Headphones & chargers up to 20% off', 'See deals', 'ADV-O5'],
    ['CR-BOOK', 'PageTurner Reads', 'brand', 'Your Next Great Read', 'Bestsellers in 12 languages', 'Browse', 'ADV-O6'],
    ['CR-XYUP', 'Xylo Upgrade', 'travel', 'Upgrade to Xylo Comfort+', 'Extra legroom on today\'s flights', 'Upgrade', 'ADV-XY'],
    ['CR-ZQMAL', 'Zafiro Maldives', 'travel', 'Malé Is Calling', 'Zafiro Air — daily to the Maldives', 'Book', 'ADV-ZQ'],
    ['CR-HOTEL', 'Hotel Aurelia', 'travel', 'Arrive Rested', 'Hotel Aurelia — airport partner rates', 'Reserve', 'ADV-X1'],
    ['CR-SIM', 'GlobeSIM Data', 'tech', 'Data From Touchdown', 'eSIM in 2 minutes, 190 countries', 'Get eSIM', 'ADV-X3'],
  ];
  creativeDefs.forEach(([id, name, template, headline, sub, cta, advertiserId]) =>
    put('creatives', { id, name, template, headline, sub, cta, advertiserId, lang: 'en' }));
  for (let i = 0; i < 8; i++)
    put('creatives', { id: `CR-G${i}`, name: `Template Creative ${i + 1}`, template: pick(rng, ['promo', 'brand', 'food', 'travel', 'tech']), headline: `Great Offer ${i + 1}`, sub: 'Selected partners at Aurora International', cta: 'Learn more', advertiserId: `ADV-O${int(rng, 7, 40)}`, lang: 'en' });

  // ---- campaigns ----
  const camps = [
    { id: 'C-PERF', name: 'SkyScent Perfume — 15% off', advertiserId: 'ADV-O1', outletId: 'O1', creativeId: 'CR-PERF', category: 'fragrance',
      status: 'active', zones: ['T2-gates-a', 'T2-retail'], screens: [], audience: { destinations: [], domIntl: 'intl', dwellMin: 20, delayOnly: false },
      schedule: { start: 360, end: 1380 }, budget: 5000, spent: 500, segmentWeights: { intl: 1.0, holiday: 0.9, adults25_54: 0.8 },
      boostRules: [{ type: 'delay', minDelay: 30, factor: 1.5 }], conversionEst: 0.031 },
    { id: 'C-TOY', name: 'ToyWorld B2G1', advertiserId: 'ADV-O2', outletId: 'O2', creativeId: 'CR-TOY', category: 'toys',
      status: 'active', zones: ['T2-gates-a', 'T1-gates-a', 'T2-retail'], screens: [], audience: { destinations: [], domIntl: 'any', dwellMin: 0, delayOnly: false },
      schedule: { start: 360, end: 1380 }, budget: 2600, spent: 900, segmentWeights: { family: 1.0, holiday: 0.6 }, boostRules: [], conversionEst: 0.027 },
    { id: 'C-LOUNGE', name: 'BizLounge Day Pass', advertiserId: 'ADV-O3', outletId: 'O3', creativeId: 'CR-LOUNGE', category: 'lounge',
      status: 'active', zones: ['T1-gates-b', 'T2-gates-b'], screens: [], audience: { destinations: [], domIntl: 'any', dwellMin: 30, delayOnly: false },
      schedule: { start: 300, end: 1400 }, budget: 3200, spent: 1400, segmentWeights: { business: 1.0, premium: 0.9 }, boostRules: [], conversionEst: 0.019 },
    { id: 'C-COFFEE', name: 'CloudBean Zero Queue', advertiserId: 'ADV-O4', outletId: 'O4', creativeId: 'CR-COFFEE', category: 'fnb',
      status: 'active', zones: ['T2-checkin', 'T1-checkin', 'T2-security', 'T1-security'], screens: [], audience: { destinations: [], domIntl: 'any', dwellMin: 0, delayOnly: false },
      schedule: { start: 300, end: 900 }, budget: 1500, spent: 620, segmentWeights: { business: 0.6, adults25_54: 0.6 }, boostRules: [], conversionEst: 0.052 },
    { id: 'C-VOLT', name: 'VoltEdge Travel Tech', advertiserId: 'ADV-O5', outletId: 'O5', creativeId: 'CR-VOLT', category: 'electronics',
      status: 'active', zones: ['T2-retail', 'T1-retail'], screens: [], audience: { destinations: [], domIntl: 'any', dwellMin: 15, delayOnly: false },
      schedule: { start: 360, end: 1380 }, budget: 2800, spent: 1100, segmentWeights: { intl: 0.7, premium: 0.8, adults25_54: 0.6 }, boostRules: [], conversionEst: 0.022 },
    { id: 'C-XYUP', name: 'Xylo Comfort+ Upgrade', advertiserId: 'ADV-XY', outletId: null, creativeId: 'CR-XYUP', category: 'airline',
      status: 'active', zones: ['T2-gates-a', 'T2-gates-b', 'T1-gates-a', 'T1-gates-b'], screens: [], audience: { destinations: [], domIntl: 'any', dwellMin: 0, delayOnly: false },
      schedule: { start: 300, end: 1400 }, budget: 3600, spent: 1500, segmentWeights: { business: 0.8, premium: 1.0 }, boostRules: [{ type: 'airlineBoarding', factor: 1.2 }], conversionEst: 0.014, airlineCode: 'XY' },
    { id: 'C-ZQMAL', name: 'Zafiro Maldives Partner', advertiserId: 'ADV-ZQ', outletId: null, creativeId: 'CR-ZQMAL', category: 'airline',
      status: 'active', zones: ['T2-gates-a', 'T1-gates-a'], screens: [], audience: { destinations: ['MLE'], domIntl: 'intl', dwellMin: 0, delayOnly: false },
      schedule: { start: 420, end: 780 }, budget: 1200, spent: 700, segmentWeights: { holiday: 1.0, family: 0.5 }, boostRules: [], conversionEst: 0.011, airlineCode: 'ZQ' },
    { id: 'C-HOTEL', name: 'Hotel Aurelia Partner', advertiserId: 'ADV-X1', outletId: null, creativeId: 'CR-HOTEL', category: 'travel',
      status: 'active', zones: ['T1-retail', 'T2-retail', 'T1-checkin', 'T2-checkin'], screens: [], audience: { destinations: [], domIntl: 'intl', dwellMin: 0, delayOnly: false },
      schedule: { start: 300, end: 1400 }, budget: 2000, spent: 800, segmentWeights: { intl: 0.8, premium: 0.6, business: 0.5 }, boostRules: [], conversionEst: 0.009 },
  ];
  camps.forEach(c => put('campaigns', c));
  const genCats = ['fnb', 'retail', 'services', 'travel', 'tech'];
  for (let i = 0; i < 17; i++) {
    const adv = `ADV-O${int(rng, 7, 40)}`;
    const zonesPool = ['T1-retail', 'T2-retail', 'T1-gates-b', 'T2-gates-b', 'T1-checkin', 'T2-security', 'T1-gates-a'];
    put('campaigns', { id: `C-G${i}`, name: `Partner Campaign ${i + 1}`, advertiserId: adv, outletId: adv.replace('ADV-', ''), creativeId: `CR-G${i % 8}`,
      category: genCats[i % genCats.length], status: i < 12 ? 'active' : i < 15 ? 'pending' : 'draft',
      zones: [pick(rng, zonesPool)], screens: [], audience: { destinations: [], domIntl: 'any', dwellMin: 0, delayOnly: false },
      schedule: { start: int(rng, 300, 600), end: int(rng, 1100, 1400) }, budget: int(rng, 800, 4000), spent: int(rng, 0, 900),
      segmentWeights: { holiday: range(rng, .2, .8), business: range(rng, .2, .8) }, boostRules: [], conversionEst: range(rng, .008, .05) });
  }

  // ---- 30 days of campaign history ----
  const histCampaigns = store.all('campaigns').filter(c => c.status === 'active').slice(0, 12);
  for (const c of histCampaigns) {
    for (let d = 30; d >= 1; d--) {
      const impressions = int(rng, 4000, 26000);
      const redemptions = Math.round(impressions * c.conversionEst * range(rng, .7, 1.3));
      put('history_daily', { id: `${c.id}-D${d}`, campaignId: c.id, daysAgo: d, spend: +(impressions * 0.012 * range(rng, .8, 1.2)).toFixed(2), impressions, redemptions });
    }
  }

  // ---- promos / triggers / goodwill / marketplace / packages / messages / incidents ----
  put('promos', { id: 'P1', code: 'SKY15-XY501', shareCode: 'SKY15-FAM', outletId: 'O1', campaignId: 'C-PERF', discount: 15, flightId: 'F-XY501', expiresAt: 855, redemptions: 0, maxRedemptions: 300, active: true });
  put('promos', { id: 'P2', code: 'BEAN10', shareCode: 'BEAN10-FAM', outletId: 'O4', campaignId: 'C-COFFEE', discount: 10, flightId: null, expiresAt: 900, redemptions: 0, maxRedemptions: 500, active: true });
  put('triggers', { id: 'TR1', name: 'Delay >30m to DXB → SkyScent 15%', condition: { dest: 'DXB', delayMin: 30 }, action: { discount: 15, text: 'Delayed to Dubai? 15% off at SkyScent, Gates 40–45', campaignId: 'C-PERF' }, zone: 'T2-gates-a', active: true, stockPause: false, firedCount: 0 });
  put('goodwill_rules', { id: 'GW-XY', airline: 'XY', thresholdMin: 45, offer: 'Free meal voucher (co-funded with CloudBean Coffee)', coFundOutletId: 'O4', active: true });
  put('goodwill_rules', { id: 'GW-ZQ', airline: 'ZQ', thresholdMin: 60, offer: 'Lounge pass discount (co-funded with BizLounge)', coFundOutletId: 'O3', active: true });
  put('marketplace', { id: 'M1', outletId: 'O4', outletName: 'CloudBean Coffee', offer: '15% off for XY passengers during delays', zone: 'T2-gates-a', price: 0, accepted: false });
  put('marketplace', { id: 'M2', outletId: 'O2', outletName: 'ToyWorld', offer: 'Free gift-wrap for ZQ88 families', zone: 'T2-gates-a', price: 0, accepted: false });
  put('marketplace', { id: 'M3', outletId: 'O3', outletName: 'BizLounge', offer: 'Lounge bundle for premium XY passengers', zone: 'T2-gates-b', price: 25, accepted: false });
  put('packages', { id: 'PK1', name: 'Morning Departures Bundle', screenIds: [], zone: 'T2-retail', hours: [7, 8, 9], discountPct: 10, price: 4200 });
  put('messages', { id: 'MSG1', airline: 'XY', gate: 42, text: 'Xylo Air: boarding for XY501 starts soon — upgrade at the gate desk.', kind: 'boarding', window: 'boarding', at: 800 });
  put('incidents', { id: 'INC1', type: 'screen_offline', severity: 'high', entity: 'screen', entityId: 'SCR-007', message: 'Screen offline > 5 min (Gate 4 Screen A)', owner: 'Ops — R. Haddad', status: 'open', createdAt: 512 });
  put('incidents', { id: 'INC2', type: 'feed_lag', severity: 'medium', entity: 'feed', entityId: 'AIDX', message: 'AIDX feed lag 42s above threshold', owner: 'Integrations', status: 'acknowledged', createdAt: 498 });
  put('incidents', { id: 'INC3', type: 'creative_failed', severity: 'low', entity: 'creative', entityId: 'CR-G3', message: 'Creative render failed validation (aspect ratio)', owner: 'Content QA', status: 'open', createdAt: 505 });

  store.kvSet('seeded', true);
}
