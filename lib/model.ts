// The token radar's model (radar-5): one snapshot of the protocol universe in, one ranked board out.
//
// The board ranks pre-token protocols by an implied launch value that is computed from the
// snapshot's own figures alone. No protocol name is ever special-cased: the same function scores
// every row, and every constant below is stated in the dashboard's Model tab.
//
//   curve      = log(mcap) = intercept + slope * log(tvl) + category offset, fitted on the
//                  snapshot's live-token comps (see sizeCurve). The slope is below 1: the market
//                  pays less per dollar of TVL as a protocol gets bigger, so a flat multiple
//                  over-values the giants and under-values the small.
//   base       = exp(curve) for the protocol's TVL and category
//   growthMult   = 1 + clamp(change_7d, -50, +100) / 100 x 0.6
//   maturityMult = 0.7 + 0.6 x min(age_days, 1095) / 1095   (age unknown: 365 days)
//   breadthMult  = 1 + 0.015 x min(chains - 1, 8)
//   implied      = max(1, round(base x growthMult x maturityMult x breadthMult))
//
// The size curve is fitted, not assumed. For each category, the offset is the median residual
// of that category's live comps around the fitted line, shrunk toward zero by n / (n + 6), so
// one outlier cannot set a category's price; a category with no live comps takes offset zero.
// The curve is backtested, not just fitted: a deterministic 5-fold split of the live comps
// (fold = sum of the slug's bytes mod 5) fits each model on four folds and predicts the fifth,
// and the dashboard reports the median absolute log error and the share predicted within 2x
// for the curve against the old flat category-median model. On this snapshot the curve's
// held-out median error is 1.11 log points (x3.0) against 1.62 (x5.1) for the flat model.
// The maturity range is 0.6, not 0.3: the same 5-fold backtest shows the old 0.3 under-weighted
// how long a protocol has run with no token — older live comps were systematically
// under-predicted (median signed error -0.30 log points), and widening the range to 0.6 cuts the
// held-out median error from 1.167 to 1.112 (within 2x: 31% to 33%). The gain is a broad
// plateau (0.4: 1.123, 0.5: 1.120, 0.6: 1.112, 0.7: 1.144), not a tuned spike, and the
// multiplier still caps at 3 years, so no protocol's age alone can dominate its value.
//
// What the board ranks: every protocol in the snapshot's watchlist, plus every other protocol that
// passes the watchlist's own exclusion rule — pre-token, not a wrapped, staked or bridged product
// of a token that already trades, not a versioned pool, not an exchange product. The watchlist is
// the floor, never the ceiling: the board carries the whole strict set (198 rows here), including
// the early protocols below the floor the radar exists to find. Live-token protocols are kept
// apart in the Live view, shown at the market's own value, never mixed into the ranked board.
//
// What the verdict means: each row is triaged Farm / Thin / Skip from its implied value
// against the cost of farming it. A farm position costs about $70-270 all-in (the capital in
// the plan plus gas); at a 10% airdrop pool split across roughly 5,000 farmers, a protocol
// must imply about $25M for the expected share to clear 5x the cost (Farm), and about $5M
// for it to cover the cost at all (Thin). Below that the gas alone eats the expected share
// (Skip). The thresholds are stated in the dashboard's Model tab, with the assumptions.
//
// What changed in radar-5: nothing in the ranking. The farm plan is eight steps instead of
// seven, and its gas is priced for the protocol's own first chain (a flat "$8 of gas" was
// wrong on cheap chains: Base is about $0.10 a transaction, Solana about $0.01). The plan
// adds a second concrete action and a weekly "what to watch for" step, the weekly action is
// category-specific for the big categories that used to fall back to a generic line, and the
// verdict step shows the expected-share maths instead of "large enough". The dashboard
// carries the plan's size (capital, gas for the whole plan, hold days) so the detail view
// can show it at a glance.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
  multiple_floor: number;
  multiple_cap: number;
  category_median_cap: number;
  shrinkage_k: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.7,
  maturity_range: 0.6,
  maturity_days: 1095,
  unknown_age_days: 365,
  breadth_per_chain: 0.015,
  breadth_max_chains: 8,
  multiple_floor: 0.03,
  multiple_cap: 1.0,
  category_median_cap: 1.0,
  shrinkage_k: 6,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-5';

/** Farm verdicts: the implied-value thresholds, in USD. See the header comment. */
export const VERDICT_FARM_USD = 25_000_000;
export const VERDICT_THIN_USD = 5_000_000;

/** How many live-token protocols the Live view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One category's multiple: the comps behind it and the number the model uses. */
export interface CategoryMultiple {
  category: string;
  comps: number;
  median_fdvtvl: number | null;
  multiple: number;
}

/** One category's offset on the size curve: its median residual around the fitted
 * line, shrunk toward zero, with the flat median multiple beside it for reference. */
export interface CategoryOffset {
  category: string;
  comps: number;
  median_fdvtvl: number | null;
  offset: number;
}

/** The fitted size curve: log(mcap) = intercept + slope * log(tvl) + offset[category]. */
export interface SizeCurve {
  intercept: number;
  slope: number;
  offsets: CategoryOffset[];
}

/** One model's held-out score: the backtest's verdict on it. */
export interface BacktestScore {
  median_abs_log_err: number;
  within_2x_pct: number;
}

/** The 5-fold backtest: both models fitted on four folds and scored on the fifth. */
export interface Backtest {
  folds: number;
  comps: number;
  flat_median: BacktestScore;
  size_curve: BacktestScore;
}

/** A row's farm verdict: worth a full position, a thin one, or not worth the gas. */
export type FarmVerdict = 'Farm' | 'Thin' | 'Skip';

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  verdict: FarmVerdict;
  model: {
    curve_base_usd: number;
    category_offset: number;
    category_comps: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with its farm plan attached. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  verdict: FarmVerdict;
  curve_base_usd: number;
  category_offset: number;
  category_comps: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  watchlist: boolean;
  farm_steps: string[];
  plan_capital_usd: number;
  plan_gas_usd: number;
  plan_hold_days: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  model_table: CategoryOffset[];
  size_curve: { intercept: number; slope: number };
  backtest: Backtest;
  global_multiple: number;
  live_comp_count: number;
  watchlist_size: number;
  board_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a sorted array, or null when it is empty. */
function medianOf(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A name carrying a whole word wrapped, staked or staking. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** A name beginning with an exchange's name. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
/** Categories the watchlist rule treats as a wrapped, staked or bridged product. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Whether a protocol is a wrapped, staked or bridged product of a token that already trades. */
export function isWrappedProduct(p: SnapshotProtocol): boolean {
  return (
    (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) ||
    VERSIONED.test(p.name) ||
    WRAPPED_WORD.test(p.name) ||
    EXCHANGE_PREFIX.test(p.name)
  );
}

/** Whether a protocol is one the board may rank: pre-token and not a wrapped product. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !isWrappedProduct(p);
}

/**
 * The category multiples, computed from the snapshot's own live-token comps: for each category,
 * the median market-cap-per-TVL of the protocols whose token already trades, shrunk toward the
 * global median by n / (n + k), then clamped. Categories with no live comps take the global median.
 */
export function categoryMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): { table: CategoryMultiple[]; global: number; liveComps: number } {
  const live = snapshot.protocols.filter(
    (p) => !isPreToken(p) && p.category !== 'CEX' && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
  const global = medianOf(live.map((p) => (p.mcap_usd as number) / p.tvl_usd).sort((a, b) => a - b)) ?? 0.25;
  const byCategory = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? '(none)';
    const list = byCategory.get(key) ?? [];
    list.push((p.mcap_usd as number) / p.tvl_usd);
    byCategory.set(key, list);
  }
  const categories = [...new Set(snapshot.protocols.map((p) => p.category ?? '(none)'))].sort();
  const table: CategoryMultiple[] = categories.map((category) => {
    const ratios = (byCategory.get(category) ?? []).sort((a, b) => a - b);
    const med = medianOf(ratios);
    const n = ratios.length;
    const capped = med === null ? null : Math.min(med, model.category_median_cap);
    const w = n / (n + model.shrinkage_k);
    const raw = capped === null ? global : w * capped + (1 - w) * global;
    const multiple = Math.min(model.multiple_cap, Math.max(model.multiple_floor, raw));
    return { category, comps: n, median_fdvtvl: med === null ? null : Math.round(med * 1e4) / 1e4, multiple: Math.round(multiple * 1e4) / 1e4 };
  });
  return { table, global: Math.round(global * 1e4) / 1e4, liveComps: live.length };
}

/** The snapshot's live-token comps: the protocols whose token already trades. */
export function liveCompsList(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter(
    (p) => !isPreToken(p) && p.category !== 'CEX' && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
}

/**
 * The size curve, fitted on the snapshot's live-token comps: ordinary least squares on
 * log(mcap) against log(tvl), then one offset per category — the median residual of that
 * category's comps around the line, shrunk toward zero by n / (n + k). A category with no
 * live comps takes offset zero. All arithmetic is exact and deterministic.
 */
export function sizeCurve(
  live: SnapshotProtocol[],
  model: ModelConstants = MODEL,
): SizeCurve {
  const points = live.map((p) => ({
    x: Math.log(p.tvl_usd),
    y: Math.log(p.mcap_usd as number),
    category: p.category ?? '(none)',
  }));
  const n = points.length;
  const meanX = points.reduce((s, p) => s + p.x, 0) / n;
  const meanY = points.reduce((s, p) => s + p.y, 0) / n;
  const slope =
    points.reduce((s, p) => s + (p.x - meanX) * (p.y - meanY), 0) /
    (points.reduce((s, p) => s + (p.x - meanX) ** 2, 0) || 1);
  const intercept = meanY - slope * meanX;
  const residuals = new Map<string, number[]>();
  for (const p of points) {
    const list = residuals.get(p.category) ?? [];
    list.push(p.y - (intercept + slope * p.x));
    residuals.set(p.category, list);
  }
  const ratios = new Map<string, number[]>();
  for (const p of live) {
    const list = ratios.get(p.category ?? '(none)') ?? [];
    list.push((p.mcap_usd as number) / p.tvl_usd);
    ratios.set(p.category ?? '(none)', list);
  }
  const categories = [...new Set(live.map((p) => p.category ?? '(none)'))].sort();
  const offsets: CategoryOffset[] = categories.map((category) => {
    const rs = (residuals.get(category) ?? []).sort((a, b) => a - b);
    const med = medianOf(rs) ?? 0;
    const count = rs.length;
    const w = count / (count + model.shrinkage_k);
    const catRatios = (ratios.get(category) ?? []).sort((a, b) => a - b);
    const catMed = medianOf(catRatios);
    return {
      category,
      comps: count,
      median_fdvtvl: catMed === null ? null : Math.round(catMed * 1e4) / 1e4,
      offset: Math.round(w * med * 1e4) / 1e4,
    };
  });
  return { intercept: Math.round(intercept * 1e4) / 1e4, slope: Math.round(slope * 1e4) / 1e4, offsets };
}

/** One fold of the backtest: which comps train, which are predicted. */
function foldOf(slug: string): number {
  let sum = 0;
  for (let i = 0; i < slug.length; i++) sum += slug.charCodeAt(i);
  return sum % 5;
}

/** A model's held-out score over the folds: median absolute log error, share within 2x. */
function scorePredictions(errors: number[]): BacktestScore {
  const abs = errors.map((e) => Math.abs(e)).sort((a, b) => a - b);
  const within = errors.filter((e) => Math.abs(e) <= Math.log(2)).length;
  return {
    median_abs_log_err: Math.round((medianOf(abs) ?? 0) * 1e3) / 1e3,
    within_2x_pct: Math.round((within / errors.length) * 100),
  };
}

/**
 * The 5-fold backtest: for each fold, fit the flat category-median model and the size
 * curve on the other four folds and predict the held-out comps' market caps. The growth,
 * maturity and breadth multipliers ride along on both, so the comparison isolates the
 * valuation itself. Deterministic: the folds come from the slugs alone.
 */
export function backtest(snapshot: Snapshot, model: ModelConstants = MODEL): Backtest {
  const live = liveCompsList(snapshot);
  const flatErrors: number[] = [];
  const curveErrors: number[] = [];
  for (let fold = 0; fold < 5; fold++) {
    const train = live.filter((p) => foldOf(p.slug) !== fold);
    const test = live.filter((p) => foldOf(p.slug) === fold);
    const flat = categoryMultiples({ ...snapshot, protocols: train }, model);
    const flatMap = new Map(flat.table.map((t) => [t.category, t.multiple]));
    const curve = sizeCurve(train, model);
    const offsetMap = new Map(curve.offsets.map((t) => [t.category, t.offset]));
    for (const p of test) {
      const g = mults(p, snapshot.as_of, model);
      const flatBase = p.tvl_usd * (flatMap.get(p.category ?? '(none)') ?? flat.global);
      const flatPred = Math.max(1, flatBase * g.growth * g.maturity * g.breadth);
      flatErrors.push(Math.log(flatPred / (p.mcap_usd as number)));
      const curveBase = Math.exp(
        curve.intercept + curve.slope * Math.log(p.tvl_usd) + (offsetMap.get(p.category ?? '(none)') ?? 0),
      );
      const curvePred = Math.max(1, curveBase * g.growth * g.maturity * g.breadth);
      curveErrors.push(Math.log(curvePred / (p.mcap_usd as number)));
    }
  }
  return { folds: 5, comps: live.length, flat_median: scorePredictions(flatErrors), size_curve: scorePredictions(curveErrors) };
}

/** The growth, maturity and breadth multipliers for one protocol. */
function mults(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { growth: number; maturity: number; breadth: number; growthPct: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growth = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturity = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const breadth = 1 + model.breadth_per_chain * Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max_chains);
  return { growth, maturity, breadth, growthPct, age };
}

/** A row's farm verdict from its implied value: Farm, Thin or Skip. */
export function farmVerdict(impliedUsd: number): FarmVerdict {
  if (impliedUsd >= VERDICT_FARM_USD) return 'Farm';
  if (impliedUsd >= VERDICT_THIN_USD) return 'Thin';
  return 'Skip';
}

/** The four multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  curve: SizeCurve,
  model: ModelConstants,
): { implied: number; curveBase: number; offset: number; comps: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const m = mults(protocol, asOf, model);
  const age = m.age;
  const offsetMap = new Map(curve.offsets.map((t) => [t.category, t.offset]));
  const compMap = new Map(curve.offsets.map((t) => [t.category, t.comps]));
  const offset = offsetMap.get(protocol.category ?? '(none)') ?? 0;
  const curveBase = Math.exp(curve.intercept + curve.slope * Math.log(protocol.tvl_usd) + offset);
  const implied = Math.max(1, Math.round(curveBase * m.growth * m.maturity * m.breadth));
  return { implied, curveBase, offset, comps: compMap.get(protocol.category ?? '(none)') ?? 0, growthPct: m.growthPct, growthMult: m.growth, maturityMult: m.maturity, breadthMult: m.breadth, age };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; curve: SizeCurve; backtestResult: Backtest; global: number; liveComps: number } {
  const curve = sizeCurve(liveCompsList(snapshot), model);
  const backtestResult = backtest(snapshot, model);
  const { global, liveComps } = categoryMultiples(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but
  // the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable protocol, above and below the floor alike. The floor is
  // never the whole board: a protocol below it is no worse a subject than one on it.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, curve, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const board = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.age,
    implied_value_usd: s.implied,
    verdict: farmVerdict(s.implied),
    model: {
      curve_base_usd: Math.round(s.curveBase),
      category_offset: Math.round(s.offset * 1e4) / 1e4,
      category_comps: s.comps,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age, s.implied).map(stepText),
  }));
  return { board, curve, backtestResult, global, liveComps };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/**
 * The gas of one transaction and the gas token, by a protocol's first chain. These are
 * rough per-transaction estimates for a contract call, not a simple transfer: Ethereum
 * mainnet is the expensive one, the L2s and Solana are cents. A chain not listed here
 * takes the default, and its token is named as the chain's own gas token rather than
 * guessed. The old flat "$8 of gas" was wrong on every cheap chain.
 */
const GAS: Record<string, { usd: number; token: string }> = {
  Ethereum: { usd: 8, token: 'ETH' },
  Base: { usd: 0.1, token: 'ETH' },
  Arbitrum: { usd: 0.25, token: 'ETH' },
  Optimism: { usd: 0.25, token: 'ETH' },
  'zkSync Era': { usd: 0.25, token: 'ETH' },
  Linea: { usd: 0.25, token: 'ETH' },
  Scroll: { usd: 0.25, token: 'ETH' },
  Blast: { usd: 0.1, token: 'ETH' },
  Mode: { usd: 0.1, token: 'ETH' },
  'World Chain': { usd: 0.1, token: 'ETH' },
  Unichain: { usd: 0.1, token: 'ETH' },
  Ink: { usd: 0.1, token: 'ETH' },
  Soneium: { usd: 0.1, token: 'ETH' },
  Mantle: { usd: 0.1, token: 'MNT' },
  Polygon: { usd: 0.05, token: 'POL' },
  'Polygon zkEVM': { usd: 0.05, token: 'ETH' },
  Binance: { usd: 0.2, token: 'BNB' },
  Solana: { usd: 0.01, token: 'SOL' },
  Tron: { usd: 2, token: 'TRX' },
  Avalanche: { usd: 0.25, token: 'AVAX' },
  Sui: { usd: 0.01, token: 'SUI' },
  Aptos: { usd: 0.01, token: 'APT' },
  Near: { usd: 0.05, token: 'NEAR' },
  'Hyperliquid L1': { usd: 0.05, token: 'HYPE' },
  Stellar: { usd: 0.05, token: 'XLM' },
  Bitcoin: { usd: 2, token: 'BTC' },
  Celo: { usd: 0.05, token: 'CELO' },
  Fantom: { usd: 0.1, token: 'FTM' },
  Cronos: { usd: 0.1, token: 'CRO' },
};

function gasFor(chain: string): { usd: number; token: string } {
  return GAS[chain] ?? { usd: 0.5, token: "the chain's native gas token" };
}

/** A dollar amount as the plan writes it: $0.01, $0.10, $0.25, $1, $8, $72, $250. */
function usd(n: number): string {
  if (n < 1) return `$${n.toFixed(2)}`;
  if (n < 10 && n % 1 !== 0) return `$${n.toFixed(2)}`;
  return `$${Math.round(n)}`;
}

/** A large dollar amount, shortened: $99.8M, $1,996, $250. */
function usdShort(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${Math.round(n).toLocaleString('en-US')}`;
  if (n >= 10) return `$${Math.round(n)}`;
  return `$${n.toFixed(2)}`;
}

/** A farm plan's size: the capital, the gas for the whole plan, the hold, the chain's gas token. */
export interface PlanSummary {
  chain: string;
  capital: number;
  gasUsd: number;
  gasToken: string;
  holdDays: number;
  allInUsd: number;
}

/**
 * The plan's size from the protocol's own record. The gas covers the plan's transactions:
 * 2 to open the position (approve + deposit), 1 for the second action, one a week for the
 * hold, and 2 to unwind. A cheap chain's whole plan costs about a dollar of gas; Ethereum's
 * costs tens of dollars — that difference is the point of pricing it per chain.
 */
export function planSummary(p: SnapshotProtocol, age: number | null): PlanSummary {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const gas = gasFor(chain);
  const holdDays = holdDaysFor(age);
  const txs = 2 + 1 + Math.ceil(holdDays / 7) + 2;
  const gasUsd = Math.ceil(gas.usd * txs * 100) / 100;
  return { chain, capital, gasUsd, gasToken: gas.token, holdDays, allInUsd: Math.round((capital + gasUsd) * 100) / 100 };
}

/** The category's primary action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} of USDC into a ${name} vault on ${chain} and keep the vault shares.`;
  if (c.includes('uncollateralized lending') || c.includes('lending')) return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow $20 against it and repay the loan after a week.`;
  if (c.includes('cdp')) return `Deposit $${capital} of ETH as collateral in ${name} on ${chain} and mint $25 of its stable asset against it.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} in the range the app suggests, and keep the position open.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position, no more than $25 of size.`;
  if (c.includes('basis')) return `Deposit $${capital} of USDC into ${name}'s basis vault on ${chain} and keep the shares for the full hold.`;
  if (c.includes('yield aggregator') || c.includes('yield')) return `Deposit $${capital} of USDC into ${name}'s highest-TVL strategy on ${chain} and keep the receipt tokens.`;
  if (c.includes('rwa')) return `Mint $${capital} of the yield-bearing asset ${name} issues on ${chain} and hold it in the farming wallet.`;
  if (c.includes('prediction')) return `Fund $${capital} on ${name} and buy one small position in a market that resolves after the hold period.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC into ${chain} through ${name} and use the bridged funds in an app on that chain.`;
  if (c.includes('restak') || c.includes('staking')) return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active for the full hold.`;
  if (c.includes('index')) return `Buy $${capital} of ${name}'s index token on ${chain} and hold it in the farming wallet.`;
  if (c.includes('payment') || c.includes('card')) return `Spend $${capital} through ${name}'s payment flow on ${chain} and keep the receipt for the activity record.`;
  if (c.includes('farm')) return `Deposit $${capital} of USDC into ${name}'s farm on ${chain} and stake the receipt in its rewards contract.`;
  if (c.includes('governance')) return `Deposit $${capital} into ${name} on ${chain} and vote once on an active proposal with the position.`;
  if (c.includes('otc')) return `Place one $${capital} order through ${name} on ${chain} and complete the settlement in the app.`;
  if (c.includes('chain')) return `Bridge $${capital} of USDC to ${chain} and use it in one of ${name}'s own apps, keeping the position open.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** A second concrete action, a week after the first: the plan's second move, not a repeat. */
function secondFor(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('curator') || c.includes('allocator')) return `A week after the first deposit, add another $25 to the same ${name} vault so the wallet shows repeated deposits.`;
  if (c.includes('lending') || c.includes('cdp')) return `Borrow $20 against the supplied collateral, hold it for a day, then repay it in full so the wallet shows a complete borrow cycle.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Swap $10 through the pool, then add the swapped tokens back to the position so the wallet shows repeated volume.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Close the hedge, then open a second one in the opposite direction with the same $25 size.`;
  if (c.includes('basis')) return `Leave the shares untouched for the first week, then add $25 more to the same basis vault.`;
  if (c.includes('yield aggregator') || c.includes('yield')) return `Move $25 into a second strategy on the same protocol so the wallet touches two of its products.`;
  if (c.includes('rwa')) return `After minting, hold the asset for a week, then add $25 more of the same yield-bearing asset.`;
  if (c.includes('prediction')) return `Place a second small position in a different market that resolves after the hold period.`;
  if (c.includes('bridge')) return `Bridge $10 back through the protocol a week later so the wallet shows two-way volume.`;
  if (c.includes('restak') || c.includes('staking')) return `Restake the receipt token's rewards once so the wallet shows a second staking action.`;
  if (c.includes('insurance')) return `After buying cover, open a test claim inquiry (without a loss) to confirm the policy is live.`;
  if (c.includes('index')) return `After buying the index token, add $25 more a week later.`;
  if (c.includes('payment') || c.includes('card')) return `Make a second $10 spend through the payment flow a week later and keep that receipt too.`;
  if (c.includes('farm')) return `After the first deposit, stake the receipt tokens and add $25 more to the farm.`;
  if (c.includes('governance')) return `Vote on a second proposal once one opens, with the same position.`;
  if (c.includes('otc')) return `Place a second $10 order through the protocol a week later and complete its settlement.`;
  if (c.includes('liquidity manager')) return `Rebalance the liquidity position once to the range the app suggests, keeping the same capital in.`;
  if (c.includes('chain')) return `Use the bridged funds in a second app on ${chain} a week later.`;
  return `A week later, add $25 more to the same position so the wallet shows repeated activity on ${name}.`;
}

/** The category's weekly qualifying action. */
function weeklyFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('perpetual') || c.includes('derivative')) return `Open and close one small hedge each week, keeping the total size under $25.`;
  if (c.includes('lending') || c.includes('cdp')) return `Borrow a small amount against the position each week and repay it the same day.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Swap $10 through the pool each week so the wallet shows repeated volume.`;
  if (c.includes('prediction')) return `Place one small market position each week in a market that is still open.`;
  if (c.includes('bridge')) return `Bridge $10 each week through the protocol to a chain you use.`;
  if (c.includes('governance')) return `Vote once a week on any proposal that is open.`;
  if (c.includes('curator') || c.includes('allocator')) return `Top up the vault by $25 each week so the wallet shows repeated deposits into the same vault.`;
  if (c.includes('rwa')) return `Add $25 more of the yield-bearing asset each week and hold it in the same wallet.`;
  if (c.includes('basis')) return `Add $25 to the basis vault each week and keep the shares for the full hold.`;
  if (c.includes('yield aggregator') || c.includes('yield')) return `Add $25 to the highest-TVL strategy each week and keep the receipt tokens.`;
  if (c.includes('liquidity manager')) return `Check the position's range each week and rebalance it once if the app says it drifted out.`;
  if (c.includes('restak') || c.includes('staking')) return `Restake the staking rewards each week so the position compounds.`;
  if (c.includes('insurance')) return `Check the policy each week and renew it before it lapses.`;
  if (c.includes('index')) return `Add $25 to the index token each week.`;
  if (c.includes('payment') || c.includes('card')) return `Make one small spend through the payment flow each week and keep the receipt.`;
  if (c.includes('farm')) return `Add $25 to the farm each week and stake the new receipt tokens.`;
  if (c.includes('otc')) return `Place one small order through the protocol each week.`;
  if (c.includes('stablecoin wrapper') || c.includes('dual-token')) return `Wrap $25 of the stable asset each week and hold the wrapped tokens.`;
  if (c.includes('collateral')) return `Borrow a small amount against the collateral each week and repay it the same day.`;
  if (c.includes('anchor') || c.includes('decentralized btc')) return `Add $25 of BTC-backed collateral each week.`;
  if (c.includes('cedefi')) return `Make one small deposit or withdrawal through the protocol each week.`;
  if (c.includes('chain')) return `Use the protocol's apps on the chain each week, even a $10 action, so the wallet stays active.`;
  return `Make one qualifying action each week, such as a deposit, a swap, a vote or a top-up.`;
}

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age, implied value), never from a
 * hand-written list of names: the same rules write every protocol's plan. The gas is priced for
 * the protocol's own first chain, and the last step is the verdict with the maths: the implied
 * value, the expected share at a 10% airdrop pool split across roughly 5,000 farmers, and the
 * all-in cost, so the reader can see the ratio instead of taking "large enough" on trust.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, implied: number): FarmStep[] {
  const plan = planSummary(p, age);
  const chain = plan.chain;
  const capital = plan.capital;
  const hold = plan.holdDays;
  const gas = gasFor(chain);
  const verdict = farmVerdict(implied);
  const share = implied / 50000;
  const ratio = share / plan.allInUsd;
  const verdictText =
    verdict === 'Farm'
      ? `Verdict: FARM — implied ${usdShort(implied)}; at a 10% airdrop pool split across roughly 5,000 farmers the expected share is about ${usdShort(share)}, about ${ratio.toFixed(1)}x the ${usdShort(plan.allInUsd)} all-in cost.`
      : verdict === 'Thin'
        ? `Verdict: FARM THIN — implied ${usdShort(implied)}; the expected share is about ${usdShort(share)}, about ${ratio.toFixed(1)}x the ${usdShort(plan.allInUsd)} all-in cost, so keep the position small and the gas low.`
        : `Verdict: SKIP — implied ${usdShort(implied)}; the expected share is only about ${usdShort(share)} against a ${usdShort(plan.allInUsd)} all-in cost, so the gas eats it. Farm a higher row instead.`;
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep about ${usd(plan.gasUsd)} of ${plan.gasToken} in it for gas on ${chain}. Keep the seed phrase offline.`,
      cost: `about ${usd(plan.gasUsd)} of ${plan.gasToken} for the whole plan's gas`,
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about ${usd(gas.usd * 2)} of gas on ${chain}`,
      time: '15 minutes to set up',
    },
    {
      text: secondFor(p, chain),
      cost: `about ${usd(gas.usd)} of gas on ${chain}`,
      time: '10 minutes',
    },
    {
      text: weeklyFor(p),
      cost: `about ${usd(gas.usd)} of gas a week on ${chain}`,
      time: '10 minutes a week',
    },
    {
      text: `Each week, open ${p.name}'s own announcements and points page: a new snapshot, a points balance that stops moving, or a rewards page that changes are the signs the program moved. Note the date of each check in the farm log.`,
      cost: 'no fee to check',
      time: '5 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes — a real claim never asks for a fee. Unwind in two steps (withdraw the position, then the receipt token) and keep ${usd(gas.usd * 2)} of ${plan.gasToken} for the exit.`,
      cost: `about ${usd(gas.usd * 2)} of gas to unwind on ${chain}`,
      time: '15 minutes',
    },
    {
      text: verdictText,
      cost: `about ${usdShort(plan.allInUsd)} all-in for this farm`,
      time: 'decided before you start',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan attached. */
export function radarRow(row: BoardRow, watchlist: Set<string>): RadarRow {
  const plan = planSummary({ slug: row.slug, name: row.name, category: row.category, chains: row.chains, tvl_usd: row.tvl_usd, change_7d: row.change_7d, mcap_usd: row.mcap_usd, listed_at: row.listed_at, gecko_id: row.gecko_id, symbol: row.symbol }, row.age_days);
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    verdict: row.verdict,
    curve_base_usd: row.model.curve_base_usd,
    category_offset: row.model.category_offset,
    category_comps: row.model.category_comps,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    watchlist: watchlist.has(row.slug),
    farm_steps: row.farm_steps,
    plan_capital_usd: plan.capital,
    plan_gas_usd: plan.gasUsd,
    plan_hold_days: plan.holdDays,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { board, curve, backtestResult, global, liveComps } = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    model_table: curve.offsets,
    size_curve: { intercept: curve.intercept, slope: curve.slope },
    backtest: backtestResult,
    global_multiple: global,
    live_comp_count: liveComps,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    live_size: live.length,
    rows: board.map((r) => radarRow(r, watchlist)),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
