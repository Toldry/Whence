# Inbound search API contract (v0.2, agreed)

Proposed by the front-end thread. The back-end thread owns the implementation;
change this file if something doesn't fit, and tell the front-end thread.
Field names follow the Travelpayouts / Aviasales Data API where they map cleanly
(`origin`, `destination`, `transfers`, `departure_at`, `return_at`, `link`, `found_at`).

## `GET /api/inbound`

"Every origin airport with a cached fare to one destination."

| param         | required | example      | notes                                              |
|---------------|----------|--------------|----------------------------------------------------|
| `destination` | yes      | `LIS`        | IATA airport or city code                          |
| `trip`        | no       | `round`      | `round` (default) or `oneway`                      |
| `date_mode`   | no       | `flex`       | `flex` (default) or `exact`                        |
| `month`       | flex     | `2027-03`    | YYYY-MM                                            |
| `flex_kind`   | flex     | `weekend`    | `weekend`, `week`, or `custom`                     |
| `length`      | custom   | `5`          | trip length in days, 1–31                          |
| `depart_from` | no, flex | `2027-03-12` | earliest departure, YYYY-MM-DD within `month`      |
| `depart_to`   | no, flex | `2027-03-23` | latest departure, YYYY-MM-DD within `month`        |
| `depart`      | exact    | `2027-03-12` | YYYY-MM-DD                                         |
| `return`      | exact    | `2027-03-15` | YYYY-MM-DD, round trips only                       |

Filtering by origin scope, stops, price, airlines, duration, cabin and passengers
is done client-side on the returned set. Prices are for **1 adult, economy**;
the client scales for cabin and passenger mix (an estimate, labelled as such).

### 200 response

```json
{
  "destination": "LIS",
  "currency": "EUR",
  "fares": [
    {
      "origin": "GVA",
      "destination": "LIS",
      "price": 60,
      "transfers": 0,
      "airlines": ["easyJet"],
      "departure_at": "2027-03-12",
      "return_at": "2027-03-14",
      "duration_minutes": 140,
      "found_at": "2026-11-09T17:02:00Z",
      "link": "https://www.aviasales.com/search/GVA1203LIS14031"
    }
  ],
  "airports": {
    "GVA": {
      "iata": "GVA", "name": "Geneva", "city": "Geneva",
      "country": "Switzerland", "country_code": "CH",
      "lat": 46.238, "lon": 6.109
    }
  }
}
```

- `fares`: zero or more per origin (e.g. a cheaper 1-stop plus a nonstop).
  The client keeps the cheapest per origin and shows a nonstop alternative if present.
- `price`: number, in `currency`, round trip if `trip=round`.
- `return_at`: `null` for one-way.
- `duration_minutes`: optional / nullable. Client estimates from distance if absent.
- `airlines`: display names (back end maps IATA carrier codes to names). **May be empty.**
- `found_at`: ISO 8601 UTC, **or `null`** when the upstream does not say (show "age unknown"). Expected to be 2–7 days old.
- `link`: absolute URL for "Check live price".
- `self_transfer`: optional, `null` or absent for ordinary fares. Set when the back end
  joined two separately cached nonstop tickets at a hub (one-way searches only, for
  origins with no cached fare of one stop or fewer). No airline protects the connection.
  `{ "via": "MAD", "layover_minutes": 190, "legs": [leg, leg] }`, where each leg is
  `{ "origin", "destination", "departure_at" (local time with offset), "duration_minutes",
  "price", "airlines", "link" }`. The fare's `price` is the sum of the legs, `transfers` is 1.
- `airports`: metadata for every `origin` that appears in `fares`, every `self_transfer.via`, plus the destination.

- `origin` may be a city code (e.g. `LON`) when the upstream only knows the city; its
  `airports` entry then has the city-centre coordinates and a name like "London (all airports)".
- `meta` (optional, additive): `{ "provider": "mock" | "travelpayouts", "cached": bool, "stale": bool, "generated_at": ISO }`.
  `stale: true` means the upstream failed and an older cached answer was served.

## `GET /api/places?q=lis`

Destination autocomplete, at most 10 results, best first:
`[{ "iata", "name", "city", "country", "country_code", "lat", "lon", "type": "airport" | "city" }]`.
Fewer than 2 characters returns `[]`.

## `GET /api/health`

`{ "ok": true, "provider": "mock" }`

### Errors

`4xx/5xx` with `{ "error": { "code": "...", "message": "..." } }`. Codes: `invalid_params` (400),
`not_found` (404), `upstream_unavailable` (502), `internal_error` (500).
The client shows a retry state on any non-2xx.
