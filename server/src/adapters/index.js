// Adapter registry: single config switch (FLIGHT_SOURCE env) selects the flight source.
// The app core only consumes canonical events from FlightSource.stream().
import { AodbFlightSource, LiveAodbSource } from './aodb.js';
import { AidxFlightSource, LiveAidxSource } from './aidx.js';
import { AcrisSource } from './acris.js';
import { PlatformSource } from './platform.js';

export function getFlightSource(env = process.env.FLIGHT_SOURCE || 'mock-aidx') {
  switch (env) {
    case 'mock-aodb': return new AodbFlightSource();
    case 'vendor-api': return new LiveAidxSource();
    case 'live-aodb': return new LiveAodbSource();
    default: return new AidxFlightSource();
  }
}
export function getSources(store) {
  return { flight: getFlightSource(), acris: new AcrisSource(), platform: new PlatformSource(store) };
}
