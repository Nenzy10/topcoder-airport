// AIDX adapter: IATA AIDX FlightLegNotifRQ-style XML push messages -> canonical FlightEvent.
// Minimal regex-based extraction (no XML dep); production would use a schema-validating parser.
export const SAMPLE_XML = `<?xml version="1.0"?>
<IATA_AIDX_FlightLegNotifRQ Version="21.1"><FlightLeg><FlightLegData>
<AirlineCode>XY</AirlineCode><FlightNumber>501</FlightNumber><OperationalSuffix/>
<FlightLegId>F-XY501</FlightLegId><DepartureAirport>AUR</DepartureAirport><ArrivalAirport>DXB</ArrivalAirport>
<ScheduledDeparture>2026-10-25T14:25</ScheduledDeparture><EstimatedDeparture>2026-10-25T15:10</EstimatedDeparture>
<GateNumber>42</GateNumber><Terminal>T2</Terminal><AircraftType>WB3</AircraftType>
<PassengerCount>240</PassengerCount><DelayMinutes>45</DelayMinutes><FlightStatus>DELAYED</FlightStatus>
<DelayCode>DP</DelayCode></FlightLegData></FlightLeg></IATA_AIDX_FlightLegNotifRQ>`;

const tag = (xml, t) => { const m = xml.match(new RegExp(`<${t}>([^<]*)</${t}>`)); return m ? m[1].trim() : null; };
const minutes = (iso) => { if (!iso) return null; const p = iso.split('T')[1]; if (!p) return null; const [h, m] = p.split(':').map(Number); return h * 60 + m; };
export function parseAidxMessage(xml) {
  const airline = tag(xml, 'AirlineCode'); const num = tag(xml, 'FlightNumber');
  return {
    type: 'flight-update',
    flight: {
      id: tag(xml, 'FlightLegId') || `F-${airline}${num}`, airline, flightNo: `${airline}${num}`,
      dest: tag(xml, 'ArrivalAirport'), terminal: tag(xml, 'Terminal'), gate: Number(tag(xml, 'GateNumber')) || null,
      std: minutes(tag(xml, 'ScheduledDeparture')), etd: minutes(tag(xml, 'EstimatedDeparture')),
      aircraft: tag(xml, 'AircraftType'), pax: Number(tag(xml, 'PassengerCount')) || 0,
      delayMin: Number(tag(xml, 'DelayMinutes')) || 0, status: tag(xml, 'FlightStatus') || 'SCHEDULED',
      delayCode: tag(xml, 'DelayCode'), source: 'aidx',
    },
    at: Date.now(), source: 'mock-aidx',
  };
}
export class AidxFlightSource {
  constructor(messages = [SAMPLE_XML]) { this.name = 'mock-aidx'; this.messages = messages; }
  async *stream() { for (const m of this.messages) yield parseAidxMessage(m); }
}
export class LiveAidxSource { // stub: real impl would subscribe to the AIDX message broker
  constructor() { this.name = 'live-aidx'; }
  async *stream() { throw new Error('LiveAidxSource not configured (set FLIGHT_SOURCE=mock-aidx for the demo)'); }
}
