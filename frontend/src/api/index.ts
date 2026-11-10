import { createHttpFareSource } from './httpFareSource';
import { createMockFareSource } from './mockFareSource';
import type { FareSource } from './types';

export * from './types';

const apiBase = (import.meta.env.VITE_API_BASE as string | undefined)?.trim();

/** The app's fare source: the real back end when VITE_API_BASE is set, otherwise the mock. */
export const fareSource: FareSource = apiBase ? createHttpFareSource(apiBase) : createMockFareSource();
export const usingMockData = !apiBase;
export { searchAcrossMonths } from './acrossMonths';
