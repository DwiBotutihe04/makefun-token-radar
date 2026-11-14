// Radar-2, the token radar's scoring model: a sealed snapshot goes in, a ranked board comes out.
//
// What the board holds: every slug on the snapshot's watchlist — the floor, never the ceiling —
// plus every other pre-token protocol the radar can stand behind as a launch candidate. A protocol
// counts as pre-token when its record shows no token at all: no market cap, no CoinGecko id, no
// symbol. It counts as a launch candidate only when it is not a wrapped, staked or bridged version
// of a token that already trades, which is the watchlist's own exclusion rule, applied to the
// whole board rather than only to the watchlist.
//
// A row's implied value comes only from the snapshot's own numbers, through a sector multiple the
// snapshot calibrates for itself:
//
//   sector multiple = median(mcap_usd / tvl_usd) across the live-token protocols in the same
//                     category (three or more of them; fewer than that, or no category at all,
//                     falls back to the global median), clamped to [0.05, 1.50]
//   base            = tvl_usd x sector multiple
//   growth factor   = 1 + clamp(change_7d, -60, 150) / 100 x 0.5
//   maturity factor = 0.6 + min(age_days, 1095) / 1095 x 0.4   (unknown age counts as 365 days)
//   breadth factor  = 1 + 0.04 x min(chains - 1, 5)
//   implied value   = max(1, round(base x growth factor x maturity factor x breadth factor))
//
// The sector multiple is the whole idea: a dollar of TVL is not worth the same in every line of
// business. The market pays roughly 13 cents per TVL dollar for a lending protocol and roughly 34
// cents for a DEX, and those numbers come from the snapshot's own live protocols. No name is ever
// special-cased: one function scores every row, and the dashboard prints the full multiple table
// so the claim can be checked against the snapshot.

/** One protocol entry from the snapshot: exactly its ten fields, no more. */
export interface ProtocolEntry {
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

/** The snapshot document as a whole. */
export interface SnapshotDoc {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: ProtocolEntry[];
  watchlist: string[];
}

/** The model's settings, as the dashboard states them and its sandbox lets a reader change them. */
export interface ModelSettings {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  sector_floor: number;
  sector_cap: number;
  sector_min_comps: number;
  breadth_weight: number;
  breadth_max_chains: number;
}

export const RADAR_MODEL: ModelSettings = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 150,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  sector_floor: 0.05,
  sector_cap: 1.5,
  sector_min_comps: 3,
  breadth_weight: 0.04,
  breadth_max_chains: 5,
};

/** The version label the dashboard names and the rules quote. */
export const MODEL_LABEL = 'radar-2';

/** How many live-token protocols the dashboard's Live token view carries, by market cap. */
export const LIVE_COUNT = 24;

/** One step of a farm plan: the action, what it costs, and how long it takes. */
export interface PlanStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json. */
export interface BoardEntry {
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
  model: {
    sector_multiple: number;
    sector_comps: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact form of one row; the page builds the farm plan from it. */
export interface PageRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  watchlist: boolean;
  sector_multiple: number;
  sector_comps: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveEntry {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One calibrated sector multiple, for the dashboard's table. */
export interface SectorEntry {
  category: string;
  multiple: number;
  comps: number;
}

/** Everything the dashboard needs: the board, the live set, the sector table, the model. */
export interface PageData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelSettings;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  sectors: SectorEntry[];
  global_multiple: number;
  rows: PageRow[];
  live: LiveEntry[];
}

/** Thrown when a snapshot is not one this model can score. */
export class SnapshotShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotShapeError';
  }
}

const DAY_MS = 86_400_000;

/** The number when it is finite, `fallback` otherwise. */
function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The middle value of a non-empty list of numbers. */
function middleValue(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/** Whole days from `listedAt` to `asOf`, never below zero; null when a date is missing or bad. */
export function daysSinceListed(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

/** Whether the record shows no token at all. */
export function hasNoToken(p: ProtocolEntry): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Categories that move somebody else's token instead of launching their own. */
const BLOCKED_CATEGORIES = new Set([
  'CEX',
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
]);

/** DefiLlama's version-marker pattern: a name ending in a release is a pool of another protocol. */
const VERSION_MARKER = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word wrapped, staked or staking in the name: a wrapped or staked product. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** A name opening with an exchange's name: that exchange's product, not a launch of its own. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/**
 * Whether the board may rank a protocol: it records no token, and it is not a wrapped, staked or
 * bridged product of a token that already trades. The watchlist's own exclusion rule, applied to
 * every row the board carries, so the top of the board is never a wrapped asset.
 */
export function isLaunchCandidate(p: ProtocolEntry): boolean {
  return (
    hasNoToken(p) &&
    !BLOCKED_CATEGORIES.has(p.category ?? '') &&
    !WRAPPED_WORD.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name) &&
    !VERSION_MARKER.test(p.name)
  );
}

/** The snapshot's protocols, keyed by slug. */
function indexBySlug(protocols: ProtocolEntry[]): Map<string, ProtocolEntry> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The calibrated sector multiples: one median per category, plus a global fallback. */
export interface CalibratedSectors {
  multiples: Map<string, number>;
  comps: Map<string, number>;
  global: number;
}

export function calibrateSectors(snapshot: SnapshotDoc, model: ModelSettings = RADAR_MODEL): CalibratedSectors {
  const perCategory = new Map<string, number[]>();
  const everyRatio: number[] = [];
  for (const p of snapshot.protocols) {
    if (hasNoToken(p) || p.category === 'CEX') continue;
    if (typeof p.mcap_usd !== 'number' || p.mcap_usd <= 0) continue;
    if (typeof p.tvl_usd !== 'number' || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    everyRatio.push(ratio);
    const key = p.category ?? 'Other';
    const bucket = perCategory.get(key);
    if (bucket) bucket.push(ratio);
    else perCategory.set(key, [ratio]);
  }
  const global = clampTo(everyRatio.length > 0 ? middleValue(everyRatio) : 0.25, model.sector_floor, model.sector_cap);
  const multiples = new Map<string, number>();
  const comps = new Map<string, number>();
  for (const [category, ratios] of perCategory) {
    comps.set(category, ratios.length);
    multiples.set(
      category,
      ratios.length >= model.sector_min_comps
        ? clampTo(middleValue(ratios), model.sector_floor, model.sector_cap)
        : global,
    );
  }
  return { multiples, comps, global };
}

/** The sector multiple one protocol gets: its own category's median, or the global median. */
export function multipleFor(p: ProtocolEntry, table: CalibratedSectors): { multiple: number; comps: number } {
  const key = p.category ?? 'Other';
  const multiple = table.multiples.get(key);
  if (multiple !== undefined) return { multiple, comps: table.comps.get(key) ?? 0 };
  return { multiple: table.global, comps: 0 };
}

function clampTo(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

const roundTo4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The four factors and the implied value one protocol scores under `model`. */
export function scoreProtocol(
  protocol: ProtocolEntry,
  asOf: string,
  table: CalibratedSectors,
  model: ModelSettings,
): {
  implied: number;
  sector: number;
  sectorComps: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  breadthMult: number;
  age: number | null;
} {
  const age = daysSinceListed(asOf, protocol.listed_at);
  const { multiple: sector, comps: sectorComps } = multipleFor(protocol, table);
  const rawGrowth = finiteOr(protocol.change_7d, 0);
  const growthPct = clampTo(rawGrowth, model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const breadthMult = 1 + model.breadth_weight * Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max_chains);
  const base = protocol.tvl_usd * sector;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * breadthMult));
  return { implied, sector, sectorComps, growthPct, growthMult, maturityMult, breadthMult, age };
}

/** How much capital a farm plan asks for, by the protocol's size. */
function depositSize(tvlUsd: number): string {
  if (tvlUsd >= 5_000_000_000) return '$250';
  if (tvlUsd >= 1_000_000_000) return '$150';
  if (tvlUsd >= 100_000_000) return '$100';
  return '$50';
}

/** How long a position should stay open: younger protocols need longer before it counts. */
function holdFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/**
 * What counts as using a protocol, by what it does. Each entry names the categories it fits,
 * the action itself, and the small weekly action that keeps the position alive. The category is
 * the protocol's own, so the action names the product it actually offers instead of telling the
 * farmer to "use the protocol".
 */
interface CategoryAction {
  kinds: string[];
  act: (name: string, cap: string) => string;
  weekly: string;
}

const CATEGORY_ACTIONS: CategoryAction[] = [
  {
    kinds: ['Lending', 'CDP', 'CDP Manager', 'Collateral Markets', 'Collateral Management'],
    act: (n, cap) => `Put ${cap} into a ${n} lending market and leave the position open`,
    weekly: 'add a small deposit or borrow a little against the collateral',
  },
  {
    kinds: ['Dexs', 'Derivatives', 'Perps', 'Options', 'Basis Trading'],
    act: (n, cap) => `Swap ${cap} through a ${n} pool and put the same amount in as liquidity`,
    weekly: 'make one swap or add a little liquidity',
  },
  {
    kinds: ['Yield', 'Yield Aggregator', 'Liquidity Manager'],
    act: (n, cap) => `Put ${cap} into a ${n} yield vault and hold on to the receipt tokens`,
    weekly: 'compound the yield or add a small deposit',
  },
  {
    kinds: ['Risk Curators', 'Onchain Capital Allocator', 'Onchain Capital Allocators'],
    act: (n, cap) => `Put ${cap} into a ${n} vault on its biggest chain and keep the shares`,
    weekly: 'check the vault allocation and rebalance if it has changed',
  },
  {
    kinds: ['RWA'],
    act: (n, cap) => `Buy ${cap} of ${n}\u2019s tokenised real-world asset offering and hold it`,
    weekly: 'check the asset\u2019s yield accrual and keep the position',
  },
  {
    kinds: ['Prediction Market'],
    act: (n, cap) => `Take a ${cap} position on a ${n} market and let it settle`,
    weekly: 'take one small position on a new market',
  },
  {
    kinds: ['Chain'],
    act: (n, cap) => `Bridge ${cap} onto the ${n} chain and use its native apps`,
    weekly: 'make one transaction on the chain',
  },
  {
    kinds: ['Staking Pool', 'Restaking', 'Liquid Restaking'],
    act: (n, cap) => `Stake ${cap} through ${n} and leave the position staked`,
    weekly: 'check the staking rewards and keep the stake in place',
  },
  {
    kinds: ['Launchpad', 'Token Locker'],
    act: (n, cap) => `Join one ${n} launch or lock ${cap} of tokens in its locker`,
    weekly: 'check for a new launch and join one if it fits',
  },
  {
    kinds: ['Indexes'],
    act: (n, cap) => `Buy ${cap} of a ${n} index and hold it`,
    weekly: 'check the index makeup and keep the position',
  },
  {
    kinds: ['Payments'],
    act: (n, cap) => `Pay ${cap} through ${n} to a real counterparty and keep the receipt`,
    weekly: 'make one real payment through the protocol',
  },
  {
    kinds: ['Privacy'],
    act: (n, cap) => `Route ${cap} through ${n}\u2019s private flow and keep the receipt`,
    weekly: 'make one private transfer through the protocol',
  },
  {
    kinds: ['NFT Marketplace'],
    act: (n, cap) => `List or buy one item on ${n} for about ${cap}`,
    weekly: 'make one trade on the marketplace',
  },
  {
    kinds: ['Insurance'],
    act: (n, cap) => `Buy ${cap} of cover on ${n} for a position you already hold`,
    weekly: 'check the cover terms and keep the policy active',
  },
  {
    kinds: ['Dual-Token Stablecoin'],
    act: (n, cap) => `Mint ${cap} of ${n}\u2019s stablecoin against collateral and hold it`,
    weekly: 'check the collateral ratio and top it up if it slips',
  },
  {
    kinds: ['Leveraged Farming', 'DOR'],
    act: (n, cap) => `Open a ${cap} leveraged position on ${n} and keep it collateralised`,
    weekly: 'check the position health and add collateral if needed',
  },
  {
    kinds: ['Decentralized AI', 'AI Agents'],
    act: (n, cap) => `Run one job on ${n} for about ${cap} and keep the output`,
    weekly: 'run one small job through the protocol',
  },
];

/** The action for a protocol's category, or the generic deposit when none of them fits. */
function actionFor(p: ProtocolEntry): { do: string; weekly: string } {
  const cap = depositSize(p.tvl_usd);
  const found = CATEGORY_ACTIONS.find((a) => a.kinds.includes(p.category ?? ''));
  if (found) return { do: found.act(p.name, cap), weekly: found.weekly };
  return {
    do: `Put ${cap} into ${p.name} and keep the position open`,
    weekly: 'make one small deposit or transaction',
  };
}

const firstChain = (p: ProtocolEntry): string => p.chains[0] ?? 'its main chain';

function withCost(text: string, cost: string, time: string): string {
  return `${text} Cost: ${cost}. Time: ${time}.`;
}

/** The farm plan: six steps, each naming the action, its cost, and its time. */
export function planSteps(p: ProtocolEntry, age: number | null): PlanStep[] {
  const action = actionFor(p);
  const hold = holdFor(age);
  const chain = firstChain(p);
  const cap = depositSize(p.tvl_usd);
  return [
    {
      text: withCost(
        'Start with a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline',
        'under $3 of gas for the first transaction',
        '5 minutes',
      ),
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: withCost(
        `${action.do} on ${chain}`,
        `${cap} of capital and about $8 of gas`,
        '15 minutes to set up',
      ),
      cost: `${cap} of capital and about $8 of gas`,
      time: '15 minutes to set up',
    },
    {
      text: withCost(
        `Do one qualifying action each week, such as ${action.weekly}`,
        'about $2 of gas a week',
        '10 minutes a week',
      ),
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: withCost(
        `Keep the position open for at least ${hold} days, so more than one snapshot sees the activity`,
        `the ${cap} stays in the position`,
        `${hold} days`,
      ),
      cost: `the ${cap} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: withCost(
        'Before withdrawing, open the protocol\u2019s own points or rewards page and claim only from the link it publishes',
        'no fee to check, and never pay to claim',
        '10 minutes to check',
      ),
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes to check',
    },
    {
      text: withCost(
        'After the claim, keep the wallet warm with one small transaction a month',
        'about $1 of gas a month',
        '5 minutes a month',
      ),
      cost: 'about $1 of gas a month',
      time: '5 minutes a month',
    },
  ];
}

/** One board row, fully scored: the model inputs and the farm plan travel with the row. */
export function makeBoardRow(rank: number, p: ProtocolEntry, scored: ReturnType<typeof scoreProtocol>): BoardEntry {
  const steps = planSteps(p, scored.age);
  return {
    rank,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    mcap_usd: p.mcap_usd,
    listed_at: p.listed_at,
    gecko_id: p.gecko_id,
    symbol: p.symbol,
    token_status: 'pre-token',
    age_days: scored.age,
    implied_value_usd: scored.implied,
    model: {
      sector_multiple: roundTo4(scored.sector),
      sector_comps: scored.sectorComps,
      growth_pct: roundTo4(scored.growthPct),
      growth_multiplier: roundTo4(scored.growthMult),
      maturity_multiplier: roundTo4(scored.maturityMult),
      breadth_multiplier: roundTo4(scored.breadthMult),
      age_days: scored.age,
    },
    farm_steps: steps.map((s) => s.text),
  };
}

/** The live set: the 24 biggest live-token protocols by market cap, ranked by the market itself. */
function pickLive(snapshot: SnapshotDoc): LiveEntry[] {
  return snapshot.protocols
    .filter((p) => !hasNoToken(p) && p.category !== 'CEX' && typeof p.mcap_usd === 'number' && p.mcap_usd > 0)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0))
    .slice(0, LIVE_COUNT)
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

/**
 * The board: every watchlist slug the snapshot carries, plus every other rankable pre-token
 * protocol, scored by the model and ranked by implied value. Watchlist rows are never filtered
 * out, and no rankable protocol is ever cut for being small.
 */
export function buildBoard(snapshot: SnapshotDoc): { board: BoardEntry[]; data: PageData } {
  const lookup = indexBySlug(snapshot.protocols);
  const table = calibrateSectors(snapshot);
  const chosen = new Map<string, ProtocolEntry>();
  for (const slug of snapshot.watchlist) {
    const p = lookup.get(slug);
    if (p) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isLaunchCandidate(p)) chosen.set(p.slug, p);
  }
  const ordered = [...chosen.values()].sort((a, b) => {
    const av = scoreProtocol(a, snapshot.as_of, table, RADAR_MODEL).implied;
    const bv = scoreProtocol(b, snapshot.as_of, table, RADAR_MODEL).implied;
    return bv - av || a.slug.localeCompare(b.slug);
  });
  const scored = ordered.map((p) => ({ p, scored: scoreProtocol(p, snapshot.as_of, table, RADAR_MODEL) }));
  const board = scored.map(({ p, scored: s }, i) => makeBoardRow(i + 1, p, s));
  const watchlistSize = snapshot.watchlist.length;
  const watchlistSet = new Set(snapshot.watchlist);
  const data: PageData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: RADAR_MODEL,
    model_version: MODEL_LABEL,
    watchlist_size: watchlistSize,
    board_size: board.length,
    early_size: board.length - watchlistSize,
    live_size: LIVE_COUNT,
    sectors: [...table.multiples.entries()]
      .filter(([category]) => board.some((r) => (r.category ?? 'Other') === category))
      .map(([category, multiple]) => ({
        category,
        multiple: roundTo4(multiple),
        comps: table.comps.get(category) ?? 0,
      }))
      .sort((a, b) => b.multiple - a.multiple),
    global_multiple: roundTo4(table.global),
    rows: scored.map(({ p, scored: s }, i) => ({
      rank: i + 1,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      age_days: s.age,
      implied_value_usd: s.implied,
      watchlist: watchlistSet.has(p.slug),
      sector_multiple: s.sector,
      sector_comps: s.sectorComps,
      growth_multiplier: s.growthMult,
      maturity_multiplier: s.maturityMult,
      breadth_multiplier: s.breadthMult,
    })),
    live: pickLive(snapshot),
  };
  return { board, data };
}

/** The dashboard's data file, with no newline at the end. */
export function dashboardScript(data: PageData): string {
  return `window.RADAR = ${JSON.stringify(data, null, 0)};`;
}

/** Whether `board` would pass the gate's board rules. */
export function checkBoard(board: BoardEntry[], watchlist: string[]): string | null {
  if (board.length < 100) return `board has ${board.length} rows, below the minimum of 100`;
  if (board.length > 4000) return `board has ${board.length} rows, above the maximum of 4000`;
  const seen = new Set<string>();
  const slugs = new Set(board.map((r) => r.slug));
  for (const slug of watchlist) {
    if (!slugs.has(slug)) return `watchlist slug ${slug} is missing from the board`;
  }
  const values = board.map((r) => r.implied_value_usd);
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (row.rank !== i + 1) return `row ${row.slug} has rank ${row.rank}, expected ${i + 1}`;
    if (seen.has(row.slug)) return `slug ${row.slug} appears more than once`;
    seen.add(row.slug);
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0) {
      return `row ${row.slug} has an implied value that is not a positive whole dollar amount`;
    }
    if (i > 0 && values[i]! > values[i - 1]!) {
      return `implied value rises from rank ${i} to ${i + 1}`;
    }
    if (!Array.isArray(row.farm_steps) || row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `row ${row.slug} has ${row.farm_steps.length} farm steps, expected 3 to 12`;
    }
    for (const stepText of row.farm_steps) {
      const text = stepText.trim();
      if (text.length < 20 || text.length > 600) {
        return `row ${row.slug} has a farm step of ${text.length} characters, expected 20 to 600`;
      }
    }
  }
  if (new Set(values).size === 1) return 'every row has the same implied value';
  const outside = board.filter((r) => !watchlist.includes(r.slug)).length;
  if (outside < 60) return `only ${outside} rows outside the watchlist, expected at least 60`;
  return null;
}

/** The snapshot's own metadata: the date, the floor, and the watchlist, in that order. */
export function summariseSnapshot(snapshot: SnapshotDoc): { asOf: string; floorUsd: number; watchlistSize: number } {
  return { asOf: snapshot.as_of, floorUsd: snapshot.floor_usd, watchlistSize: snapshot.watchlist.length };
}

/** Read a snapshot object and check it has the shape the model needs. */
export function readSnapshot(value: unknown): SnapshotDoc {
  if (typeof value !== 'object' || value === null) throw new SnapshotShapeError('snapshot must be a JSON object');
  const s = value as Record<string, unknown>;
  if (typeof s.as_of !== 'string') throw new SnapshotShapeError('snapshot.as_of must be a string');
  if (typeof s.floor_usd !== 'number') throw new SnapshotShapeError('snapshot.floor_usd must be a number');
  if (!Array.isArray(s.protocols)) throw new SnapshotShapeError('snapshot.protocols must be an array');
  if (!Array.isArray(s.watchlist)) throw new SnapshotShapeError('snapshot.watchlist must be an array');
  for (const p of s.protocols) {
    if (typeof p !== 'object' || p === null) throw new SnapshotShapeError('snapshot.protocols entries must be objects');
    const q = p as Record<string, unknown>;
    if (typeof q.slug !== 'string' || q.slug === '') throw new SnapshotShapeError('snapshot.protocols entries must have a slug');
    if (typeof q.name !== 'string' || q.name === '') throw new SnapshotShapeError('snapshot.protocols entries must have a name');
    if (typeof q.tvl_usd !== 'number' || q.tvl_usd <= 0) {
      throw new SnapshotShapeError(`protocol ${q.slug} must have a positive tvl_usd`);
    }
    if (!Array.isArray(q.chains)) throw new SnapshotShapeError(`protocol ${q.slug} must have a chains array`);
  }
  return value as SnapshotDoc;
}

/** A dollar amount shortened the way the dashboard prints it. */
export function moneyShort(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

/** A whole-dollar implied value with commas. */
export function valueFull(v: number): string {
  return `$${Math.round(v).toLocaleString('en-US')}`;
}

/** A percent change with its sign. */
export function changeSigned(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '—';
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return `${sign}${Math.abs(v).toFixed(2)}%`;
}

/** A day count as days, months or years. */
export function ageShort(age: number | null): string {
  if (age === null) return '—';
  if (age < 30) return `${age}d`;
  if (age < 365) return `${(age / 30.44).toFixed(1)}mo`;
  return `${(age / 365.25).toFixed(1)}y`;
}
