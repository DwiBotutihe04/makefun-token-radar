# Token Radar

A radar for pre-token DeFi protocols, ranked by what their token would be worth if the
protocol's record stayed as it is. Built for the make.fun `token-radar-01` competition. The
board holds all 40 watchlist protocols plus every other pre-token protocol the model can stand
behind as a launch candidate — never a wrapped, staked or bridged product of a token that
already trades.

## The value model (radar-2)

One function scores every row, from the sealed snapshot's own figures alone:

```
sector multiple  = median(mcap_usd / tvl_usd) across the live-token protocols
                   in the same category (three or more of them; fewer, or no
                   category, falls back to the global median), clamped
                   to [0.05, 1.50]
growth factor    = 1 + clamp(change_7d, -60, 150) / 100 × 0.5
maturity factor  = 0.6 + min(age_days, 1095) / 1095 × 0.4
                   (unknown age counts as 365 days)
breadth factor   = 1 + 0.04 × min(chains - 1, 5)
implied value    = max(1, round(tvl_usd × sector multiple
                   × growth factor × maturity factor × breadth factor))
```

The sector multiple is the whole idea: a dollar of TVL is not worth the same in every line of
business. In this snapshot the market pays about 13 cents per TVL dollar for a lending
protocol and about 34 cents for a DEX, and the snapshot's own live protocols say so. The
dashboard prints the full multiple table, so the claim can be checked against the snapshot.

A protocol "records no token" when its snapshot entry carries no market cap, no CoinGecko id
and no symbol. Bridges, wrapped and staked products are left out because their token already
trades elsewhere.

## Farm plans

Every row carries a six-step farm plan with a concrete action for its category — put money into
a lending market, swap and add liquidity, take a prediction-market position, and so on — plus
the capital to put in (scaled by TVL), what each step costs and how long it takes.

## How to run

```sh
# the grader's way: the snapshot is mounted at /input, output at /output
node main.ts

# locally, against the kit's snapshot
MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

`main.ts` (Node 22, standard library only) reads the sealed snapshot, writes `board.json` (the
ranked board), `data.js` (the dashboard's data), copies `dashboard/` and `screenshots/` into
the output, and writes `dossier.json` with the kit's `vendor/makefun-board.ts` (`buildDossier`,
copied byte for byte from the kit).

The dashboard is static HTML, CSS and JavaScript with no network calls. It has a search, a
category and a chain filter, a watchlist-only toggle, sortable columns, a Pre-token / Live
token switch, a detail view per protocol with the full factor breakdown and farm plan, and a
model sandbox: three sliders that recompute the ranks live in the page (the defaults match
`board.json`).

## Layout

```
main.ts                  entry point (Node 22, stdlib only)
lib/model.ts             the model, the board builder, the farm plans
vendor/makefun-board.ts  the kit's dossier builder, unchanged
dashboard/               index.html, app.css, app.js (no network)
screenshots/             rendered from the dashboard (see below)
```

The screenshots are rendered from the dashboard in a headless browser (Playwright Chromium)
at 1440×900: `1-board.png` (the ranked board), `2-detail.png` (the rank-1 detail view),
`3-filtered.png` (the board filtered to one category), `4-live.png` (the live-token view).
Rendered sizes: `1-board.png` 148 KB, `2-detail.png` 229 KB, `3-filtered.png` 133 KB,
`4-live.png` 129 KB — all under the 512 KiB cap.

## An implied value is a model, not a promise

Nothing here is investment advice. The implied values are estimates built from one snapshot; a
protocol can launch, delay, or never launch, and a token's market value can differ wildly from
any model.
