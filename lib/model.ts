// Token Radar model (radar-3): snapshot in, ranked board out.
//
// The board ranks every protocol the radar may rank: pre-token (no market
// cap, no CoinGecko id, no symbol), not a centralised exchange, not a
// versioned pool, and not a wrapped / staked / bridged product of a token
// that already trades. That is the watchlist's own rule, applied to the
// whole snapshot, so the board covers all 40 watchlist slugs and adds every
// other protocol that passes the same test — 203 rows on this snapshot.
// Protocols whose token already trades are never ranked here; they are
// listed apart, at their market's own value, in the Live token view.
//
// Implied value is the entry's own claim, built only from the snapshot's
// own figures, the same function for every row, no name ever special-cased:
//
//   base      = tvl_usd x 0.30
//   category  = weight for the protocol's category (see CATEGORY_WEIGHTS)
//   growth    = clamp(change_7d, -50, +150) per cent (unknown: 0)
//   growthMul = 1 + growth / 100 x 0.60
//   maturity  = 0.55 + min(age_days, 1460) / 1460 x 0.45 (age unknown: 180)
//   breadth   = 1 + 0.03 x min(chains - 1, 5)
//   implied   = max(1, round(base x category x growthMul x maturity x breadth))
//
// Why these terms: TVL is the protocol's size today; the category weight
// is what the market actually pays per dollar of TVL for that kind of
// protocol (see below); seven-day growth is its momentum; age with no
// token is how long it has built without one (older, still tokenless
// protocols have had longer to earn a launch, so maturity rises with age
// and flattens after four years); chain breadth is distribution — a
// protocol live on several chains reaches more wallets than a single-chain
// one. Growth is clamped so one wild week cannot crown a protocol, and
// maturity never drops below 0.55, so a young protocol with real TVL is
// not written off.
//
// Calibration of the category weights (from this snapshot, not guessed):
// 119 protocols in the snapshot already trade with a positive market cap,
// so each has a market cap and a TVL, and the ratio mcap_usd / tvl_usd
// is what the market pays per dollar of TVL. The overall median ratio is
// 0.246, close to the base multiple 0.30. (Tokens with mcap 0 — dead or
// unpriced — and the one mcap of -1, a missing-data sentinel, are left
// out: a ratio of 0 or below is not a valuation.) Per category, weight =
// median ratio / 0.246, shrunk toward 1.0 by n / (n + 3) for a category
// with n live samples, then clamped to [0.50, 1.50] so one wild sample
// cannot crown or bury a category. Categories with fewer than two live
// samples keep 1.0: a single sample is noise (the only live "Prediction
// Market" is a token worth 400x its protocol's TVL; the only live "Risk
// Curators" entry is an oracle miscategorised with $11.8M TVL). Two
// exceptions are grouped by economics, not by label: "Risk Curators" and
// "Onchain Capital Allocator" are both vault curators whose TVL is assets
// managed on top of other protocols, so both take the allocator weight
// 0.62 — the two genuine allocator samples (concrete 0.019, grove-finance
// 0.006) sit about 20x below the overall median. The fitted weights:
// Lending 0.61 (n=15, median 0.132), Dexs 1.31 (n=11, 0.342), Yield 0.83
// (n=9, 0.191), RWA 1.09 (n=9, 0.275), Basis Trading 1.50 (n=7, 0.654,
// capped), Yield Aggregator 0.78 (n=4, 0.151), CDP 0.84 (n=3, 0.169),
// Indexes 0.80 (n=3, 0.148), Derivatives 1.50 (n=2, 2.162, capped),
// Staking Pool 0.60 (n=2, 0.002), Restaking 0.64 (n=2, 0.025), Payments
// 0.89 (n=2, 0.181), Cross Chain Bridge 1.50 (n=4, 1.220, capped).

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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, printed on the dashboard next to the formula. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
  /** Per-category valuation weight; a category not listed here weighs 1.0. */
  category_weights: Record<string, number>;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.3,
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 150,
  maturity_floor: 0.55,
  maturity_range: 0.45,
  maturity_days: 1460,
  unknown_age_days: 180,
  breadth_per_chain: 0.03,
  breadth_max_chains: 5,
  category_weights: {
    'Risk Curators': 0.62,
    'Onchain Capital Allocator': 0.62,
    Dexs: 1.31,
    RWA: 1.09,
    Lending: 0.61,
    Yield: 0.83,
    Derivatives: 1.5,
    CDP: 0.84,
    'Yield Aggregator': 0.78,
    'Basis Trading': 1.5,
    'Staking Pool': 0.6,
    Restaking: 0.64,
    Payments: 0.89,
    Indexes: 0.8,
    'Cross Chain Bridge': 1.5,
  },
};

/** The category weight for one protocol; unlisted categories weigh 1.0. The
 * lookup is guarded with hasOwnProperty so a category named like an
 * Object.prototype property (e.g. "toString") cannot leak a function
 * through and turn the implied value into NaN. */
export function categoryWeight(category: string | null, model: ModelConstants = MODEL): number {
  if (category === null) return 1;
  return Object.prototype.hasOwnProperty.call(model.category_weights, category) ? model.category_weights[category]! : 1;
}

export const MODEL_VERSION = 'radar-3';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

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
  model: {
    base_usd: number;
    base_multiple: number;
    category_multiplier: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

export interface RadarRow {
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
  category_multiplier: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  base_usd: number;
  base_exact: number;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  watchlist: string[];
  board_size: number;
  early_size: number;
  early_below_floor: number;
  live_size: number;
  /** Median mcap_usd / tvl_usd across ALL live (token-trading) protocols in the snapshot, not just the 24 shown. */
  live_median_ratio: number;
  /** How many live protocols that median is computed over. */
  live_protocol_count: number;
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The four multipliers and the implied value one protocol gets. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { implied: number; base: number; baseExact: number; categoryMult: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const categoryMult = categoryWeight(protocol.category, model);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(protocol.change_7d, 0)));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const extraChains = Math.max(0, Math.min(protocol.chains.length - 1, model.breadth_max_chains));
  const breadthMult = 1 + extraChains * model.breadth_per_chain;
  const base = protocol.tvl_usd * model.base_multiple;
  const implied = Math.max(1, Math.round(base * categoryMult * growthMult * maturityMult * breadthMult));
  return {
    implied,
    base: Math.round(base),
    baseExact: base,
    categoryMult,
    growthPct,
    growthMult,
    maturityMult,
    breadthMult,
    age,
  };
}

/** Categories that are a wrapped, staked or bridged product of a token that trades. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether the board may rank a protocol: pre-token and not an excluded product. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !EXCLUDED_CATEGORIES.has(p.category ?? '') && !VERSIONED.test(p.name);
}

function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
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
    model: {
      base_usd: s.base,
      base_multiple: model.base_multiple,
      category_multiplier: round4(s.categoryMult),
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
      age_days: s.age,
    },
    base_exact: s.baseExact,
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** One step as a single string: action, then its cost and time. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position open and check the protocol's own page.`;
  return s;
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

function secondChain(p: SnapshotProtocol): string | null {
  return p.chains.length > 1 ? p.chains[1]! : null;
}

/** Capital for one farm position, from the protocol's own TVL tier. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 10_000_000) return 100;
  return 50;
}

/** Hold length, from age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 90;
  if (age < 365) return 60;
  if (age < 730) return 45;
  return 30;
}

/** The category's core action, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} as collateral and borrow $20 of stablecoins against it, then repay the borrow in the same week.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s deepest pool on ${chain} and keep the position in range for the full hold.`;
  if (c.includes('yield') || c.includes('yield aggregator')) return `Deposit $${capital} of USDC into ${name}'s highest-TVL vault on ${chain} and leave the shares untouched.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Deposit $${capital} of USDC as margin on ${name} on ${chain}, open a $25 hedge, and close it within 48 hours.`;
  if (c.includes('prediction')) return `Fund ${name} with $${capital} and place two small market positions on opposite outcomes, then settle both.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('onchain capital')) return `Deposit $${capital} into a ${name} curated vault on ${chain} and keep the vault shares for the full hold.`;
  if (c.includes('stable')) return `Mint $${capital} of the stable asset through ${name} on ${chain} and hold it in the protocol's own savings vault.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it until the hold period ends.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} for a protocol you already use, and keep the policy active.`;
  if (c.includes('basis')) return `Deposit $${capital} into ${name}'s basis vault on ${chain} and keep the position through one funding cycle.`;
  if (c.includes('farm')) return `Deposit $${capital} into ${name}'s main farm on ${chain} and harvest the rewards weekly without exiting.`;
  if (c.includes('staking')) return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open for the full hold.`;
}

/** A rough per-transaction gas cost for one farm action, by chain. */
function gasFor(chain: string): string {
  const c = chain.toLowerCase();
  if (c.includes('ethereum') || c.includes('bitcoin')) return 'about $8 of gas';
  if (
    c.includes('solana') ||
    c.includes('sui') ||
    c.includes('aptos') ||
    c.includes('base') ||
    c.includes('arbitrum') ||
    c.includes('optimism') ||
    c.includes('polygon') ||
    c.includes('binance') ||
    c.includes('monad') ||
    c.includes('hyperliquid')
  ) {
    return 'about $0.50 of gas';
  }
  return 'about $2 of gas';
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a
 * time. The plan is derived from the protocol's own record (category,
 * chains, TVL, age) — never from a hand-written list of names — so two
 * protocols in different categories genuinely farm differently. Gas is
 * priced from the protocol's own main chain, not a flat figure: a
 * transaction on Ethereum or Bitcoin costs far more than one on Solana,
 * Base or Arbitrum.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const second = secondChain(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const gas = gasFor(chain);
  const gas2 = second !== null ? gasFor(second) : gas;
  // Total capital actually at work: the main deposit plus the half-size
  // repeat on the second chain, when there is one. The hold step's cost
  // must name this total, not just the main deposit.
  const totalCapital = second !== null ? capital + Math.round(capital / 2) : capital;
  const steps: FarmStep[] = [
    {
      text: `Open a fresh wallet that holds only this farm's funds, write its seed phrase on paper, and fund it with $${capital + 10} of USDC on ${chain}.`,
      cost: `${gas} for the first transaction`,
      time: '10 minutes',
    },
    { text: action, cost: `$${capital} of capital and ${gas}`, time: '20 minutes to set up' },
  ];
  if (second !== null) {
    steps.push({
      text: `Repeat the same position with $${Math.round(capital / 2)} on ${second} so the activity shows on a second chain, not only on ${chain}.`,
      cost: `$${Math.round(capital / 2)} of capital and ${gas2}`,
      time: '15 minutes',
    });
  } else {
    steps.push({
      text: `Do one second qualifying action on ${chain} — a swap, a vote, or a second deposit of $25 — so the wallet shows more than a single deposit.`,
      cost: `$25 of capital and ${gas}`,
      time: '10 minutes',
    });
  }
  steps.push(
    {
      text: `Once a week, make one small on-chain action on ${chain}: a $10 deposit, a claim, or a governance vote if one is live.`,
      cost: `${gas} a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold every position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${totalCapital} stays in the position${second !== null ? 's' : ''}`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page from its official site and claim only from the link it publishes — never from a link in a chat or an email.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction hash in a farm log, then unwind in reverse order: claim first, withdraw second, and leave $1 of dust so the wallet stays readable.`,
      cost: 'nothing but the log',
      time: '15 minutes to unwind',
    },
  );
  return steps;
}

/** Median mcap / TVL across every live (token-trading, non-CEX) protocol in the snapshot. Tokens with a zero market cap (dead or unpriced) are left out: a ratio of 0 is not a valuation. */
export function liveMedianRatio(snapshot: Snapshot): { median: number; count: number } {
  const ratios = snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX' && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map((p) => p.mcap_usd! / p.tvl_usd)
    .sort((a, b) => a - b);
  if (ratios.length === 0) return { median: 0, count: 0 };
  const mid = Math.floor(ratios.length / 2);
  const median = ratios.length % 2 === 1 ? ratios[mid]! : (ratios[mid - 1]! + ratios[mid]!) / 2;
  return { median, count: ratios.length };
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

export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiplier: row.model.category_multiplier,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    base_usd: row.model.base_usd,
    base_exact: row.base_exact,
    farm_steps: row.farm_steps,
  };
}

export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug));
  const earlyBelowFloor = early.filter((r) => r.tvl_usd < snapshot.floor_usd).length;
  const liveMedian = liveMedianRatio(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    watchlist: snapshot.watchlist,
    board_size: board.length,
    early_size: early.length,
    early_below_floor: earlyBelowFloor,
    live_size: live.length,
    live_median_ratio: Math.round(liveMedian.median * 1000) / 1000,
    live_protocol_count: liveMedian.count,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

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
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd) || p.tvl_usd < 0) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null. */
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

/** The dashboard's dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
