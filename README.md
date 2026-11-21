# Token Radar (radar-5)

A token launch radar: it reads a sealed DefiLlama snapshot of 758 protocols, ranks the 198 pre-token ones by an implied launch value from a size curve fitted on the snapshot's own live-token comps and backtested out of sample, triages each row Farm / Thin / Skip against the cost of farming it, and hands in a static dashboard with a farm plan for each one.

## The model (radar-5 — unchanged from radar-4)

`implied = round(exp(intercept + slope × ln(TVL) + category offset) × growth × maturity × breadth)`

- The size curve `log(mcap) = 7.7881 + 0.4721 × log(tvl)` is fitted on the snapshot's own 119 live-token comps; each category takes a shrunk median-residual offset (weight n / (n + 6)).
- Growth: `1 + clamp(change_7d, -50, +100) / 100 × 0.6`.
- Maturity: `0.7 + 0.6 × min(age_days, 1095) / 1095` (age unknown: 365 days).
- Breadth: `1 + 0.015 × min(chains − 1, 8)`.
- Backtest (deterministic 5-fold split of the 119 live comps, fold = sum of slug bytes mod 5): median absolute log error **1.112** (typical factor ×3.04, 33% predicted within 2×) against **1.621** (×5.06, 25%) for the flat category-median model.

The ranking model is untouched: the same curve, the same multipliers, the same 198 rows in the same order, the same 1.112 backtest.

## What changed from radar-4 (dashboard and farm plans only)

1. **Farm plans are now eight steps and chain-aware.** The gas in every step is priced for the protocol's own first chain (Ethereum ~$8 a transaction, Base ~$0.10, Solana ~$0.01, BSC ~$0.20, Tron ~$2, the rest from a small table, $0.50 by default) instead of a flat "$8 of gas" that was wrong for cheap chains. Each plan adds a second concrete action and a weekly "what to watch for" step, and the weekly action is now category-specific for the big categories that used to fall back to a generic line (Risk Curators, Onchain Capital Allocator, RWA, Yield, Basis Trading, Yield Aggregator, Liquidity Manager, Staking Pool and more).
2. **The verdict step shows the maths.** Each plan ends with the implied value, the expected share at a 10% airdrop pool split across roughly 5,000 farmers, and the all-in cost, so the reader can see the ratio instead of taking "large enough" on trust.
3. **The board opens with the top 5 Farm rows** ("Start here"), and the filters gain one-click chips for Farm only, Watchlist and Growing.
4. **The detail view explains why the row ranks where it does** (its TVL on the size curve, its category offset, its age and its growth) and shows the plan at a glance: capital, gas for the whole plan, hold days.
5. **Readability:** a sticky table header, zebra rows, and a slightly larger implied-value column.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Node 22, standard library only, no network.
