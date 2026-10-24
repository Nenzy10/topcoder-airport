// AODB adapter: snapshot rows (CSV/JSON, ~33 columns incl. A-CDM times) -> canonical Flight.
// Canonical model is the ONLY shape the app core sees; adapters own translation.
export const AODB_HEADER = ['flight_id','airline_iata','flight_number','operating_carrier','codeshare','departure_airport','arrival_airport','route_type','schedule_date','std','etd','ttot','tobt','tsat','asat','aobt','aibt','eldt','stand','gate','gate_status','checkin_desk','baggage_belt','aircraft_type','aircraft_reg','terminal','pax_booked','pax_boarded','seats','load_factor','flight_status','delay_code','delay_minutes'];

export const SAMPLE_CSV = `${AODB_HEADER.join(',')}
F-XY501,XY,501,XY,,AUR,DXB,INTL,2026-10-25,14:25,15:10,15:20,14:10,14:05,,,,,,42,OPEN,C12,B4,WB3,REG-731,T2,240,0,290,0.83,DELAYED,DP,45
F-ZQ88,ZQ,88,ZQ,,AUR,MLE,INTL,2026-10-25,14:50,14:50,15:00,14:35,14:30,,,,,,42,OPEN,C20,B7,WB3,REG-204,T2,180,0,290,0.62,SCHEDULED,,0
F-AB210,AB,210,AB,,AUR,KCT,DOM,2026-10-25,14:35,14:35,14:42,14:20,14:15,,,,,,44,OPEN,C03,B1,NB2,REG-118,T2,160,0,180,0.89,SCHEDULED,,0`;

const hhmm = (s) => { if (!s) return null; const [h, m] = s.split(':').map(Number); return h * 60 + m; };
export function parseAodbRow(r) {
  return {
    id: r.flight_id, airline: r.airline_iata, flightNo: r.airline_iata + r.flight_number,
    dest: r.arrival_airport, destName: r.arrival_airport, terminal: r.terminal, gate: Number(r.gate) || null,
    std: hhmm(r.std), etd: hhmm(r.etd), tobt: hhmm(r.tobt), tsat: hhmm(r.tsat), aobt: hhmm(r.aobt), aibt: hhmm(r.aibt),
    stand: r.stand || null, checkinDesk: r.checkin_desk || null, belt: r.baggage_belt || null,
    aircraft: r.aircraft_type, capacity: Number(r.seats) || 0, pax: Number(r.pax_booked) || 0,
    delayMin: Number(r.delay_minutes) || 0, delayCode: r.delay_code || null,
    status: r.flight_status || 'SCHEDULED', intl: r.route_type === 'INTL' ? 1 : 0,
    source: 'aodb',
  };
}
export function parseAodbCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const head = lines[0].split(',');
  return lines.slice(1).filter(Boolean).map(line => {
    const cells = line.split(','); const row = {};
    head.forEach((h, i) => row[h] = cells[i]);
    return parseAodbRow(row);
  });
}
export class AodbFlightSource {
  constructor(csvText = SAMPLE_CSV) { this.name = 'mock-aodb'; this.csvText = csvText; }
  async *stream() { for (const f of parseAodbCsv(this.csvText)) yield { type: 'snapshot', flight: f, at: Date.now(), source: this.name }; }
}
export class LiveAodbSource { // stub: real impl would poll the AODB snapshot endpoint
  constructor() { this.name = 'live-aodb'; }
  async *stream() { throw new Error('LiveAodbSource not configured (set FLIGHT_SOURCE=mock-aidx for the demo)'); }
}
