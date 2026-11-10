# Whence (front end)

Pick where you want to go; see every airport you could fly *from*, priced on a map,
optionally including the cost of getting from your home city to each airport.

Stack: Vite, React 19, TypeScript, Leaflet. The basemap is a bundled vector layer of
country outlines (Natural Earth via `world-atlas`), so no tile server is needed.

## Run

```sh
npm install
npm run dev          # http://localhost:5173, uses the built-in mock fare source
```

To use the back end (see [`../backend/`](../backend/), serves `http://localhost:8787`):

```sh
VITE_API_BASE=http://localhost:8787 npm run dev
```

PowerShell:

```powershell
$env:VITE_API_BASE="http://localhost:8787"; npm run dev
```

Other scripts: `npm run build`, `npm test`, `npm run typecheck`.

Demo the edge states with the mock: `?mock=error`, `?mock=empty`, `?mock=slow`.

## Layout

| Path | What it is |
|------|------------|
| `src/api/types.ts` | The API contract (`/api/inbound`, `/api/places`), Travelpayouts-style field names |
| `src/api/mockFareSource.ts` | In-browser mock that returns the exact response shape |
| `src/api/httpFareSource.ts` | Real client; selected when `VITE_API_BASE` is set |
| `src/lib/results.ts` | Pure logic: filters, cheapest-per-origin, ground cost, price tiers |
| `src/data/geo.ts` | Distance, flight-time and ground-transport estimates |
| `src/components/` | Search panel, filter bar, results list, map panel, Leaflet controller |

The contract lives in [`docs/inbound-api.md`](../docs/inbound-api.md) (v0.2).

## Known estimates

Cabin and group prices are scaled from the 1-adult economy fare. Ground costs are rough
distance-based estimates. Currency conversion uses fixed placeholder rates.
