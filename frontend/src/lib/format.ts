/** Display rates relative to EUR. Placeholder values; a real FX feed can replace them. */
export const CURRENCY_RATES: Record<string, number> = {
  EUR: 1, GBP: 0.86, USD: 1.09, CHF: 0.94, SEK: 11.3, PLN: 4.28,
};
export const CURRENCY_NAMES: Record<string, string> = {
  EUR: 'Euro', GBP: 'British pound', USD: 'US dollar', CHF: 'Swiss franc', SEK: 'Swedish krona', PLN: 'Polish złoty',
};

export function formatMoney(amountEur: number, currency: string): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency', currency, currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0, minimumFractionDigits: 0,
  }).format(Math.round(amountEur * (CURRENCY_RATES[currency] ?? 1)));
}

export function currencySymbol(currency: string): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' })
    .formatToParts(0).find(part => part.type === 'currency')?.value ?? currency;
}

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return hours ? `${hours} h ${String(rest).padStart(2, '0')}` : `${rest} min`;
}

export function formatDay(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  });
}

export function formatMonth(yearMonth: string, style: 'long' | 'short' = 'long'): string {
  return new Date(`${yearMonth}-01T00:00:00Z`).toLocaleDateString('en-GB', {
    month: style, ...(style === 'long' ? { year: 'numeric' } : {}), timeZone: 'UTC',
  });
}

export function formatAge(hours: number | null): string {
  if (hours === null) return 'age unknown';
  if (hours < 1) return 'just now';
  if (hours < 48) return `${Math.round(hours)} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const km = (value: number) => `${Math.round(value).toLocaleString('en-GB')} km`;
