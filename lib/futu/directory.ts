import type { SearchResult } from "../types";
import { normalizeTicker, normalizeSearchQuery } from "./symbol";

const EXCHANGES = ["nasdaq", "nyse", "amex"] as const;
const EXCLUDED = /\b(?:ETF|ETN|fund|warrants?|rights|units?|preferred|preference|notes?|bonds?|debentures?|beneficial interest)\b/i;
// 優先採用證券名稱而非代號尾字母，避免誤刪例如 W 結尾的普通股。
export function eligibleSecurity(name: string) {
  return !EXCLUDED.test(name);
}

export function parseDirectory(payload: unknown, exchange: string): SearchResult[] {
  const data = (payload as { data?: { totalrecords?: unknown; table?: { rows?: unknown } } })?.data;
  const rows = data?.table?.rows;
  const total = Number(data?.totalrecords);
  if (!Array.isArray(rows) || !rows.length || !Number.isInteger(total) || total <= 0 || total !== rows.length) {
    throw new Error("Incomplete stock directory");
  }
  const result: SearchResult[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") throw new Error("Invalid directory row");
    const row = raw as { symbol?: unknown; name?: unknown };
    if (typeof row.symbol !== "string" || typeof row.name !== "string" || !row.name.trim()) throw new Error("Invalid directory row");
    const ticker = normalizeTicker(row.symbol.replace(/\//g, "."));
    if (!ticker || !eligibleSecurity(row.name)) continue;
    result.push({ symbol: `US.${ticker}`, name: row.name.trim(), type: "STOCK", exchange: exchange.toUpperCase() });
  }
  return result;
}

export function matchDirectory(rows: SearchResult[], rawQuery: string): SearchResult[] {
  const query = normalizeSearchQuery(rawQuery);
  const exact = normalizeTicker(query);
  const words = query.toLowerCase().split(" ");
  const rank = (row: SearchResult) => {
    const ticker = row.symbol.slice(3);
    if (exact && ticker === exact) return 0;
    if (exact && ticker.startsWith(exact)) return 1;
    const name = row.name.toLowerCase();
    if (name === query.toLowerCase()) return 2;
    if (words.every(word => name.includes(word))) return name.startsWith(words[0]) ? 3 : 4;
    return 99;
  };
  return rows.map(row => ({ row, rank: rank(row) })).filter(x => x.rank < 99)
    .sort((a, b) => a.rank - b.rank || a.row.symbol.localeCompare(b.row.symbol)).slice(0, 10).map(x => x.row);
}

export function createDirectorySearch(fetcher: typeof fetch = fetch, clock = Date.now) {
  let cached: SearchResult[] | undefined;
  let expires = 0;
  let pending: Promise<SearchResult[]> | undefined;
  async function load() {
    const groups = await Promise.all(EXCHANGES.map(async exchange => {
      const url = new URL("https://api.nasdaq.com/api/screener/stocks");
      url.search = new URLSearchParams({ tableonly: "true", limit: "10000", offset: "0", exchange }).toString();
      const response = await fetcher(url, {
        headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(8000), next: { revalidate: 3600 },
      });
      if (!response.ok) throw new Error("Stock directory unavailable");
      return parseDirectory(await response.json(), exchange);
    }));
    const unique = new Map(groups.flat().map(row => [row.symbol, row]));
    cached = [...unique.values()];
    expires = clock() + 3600000;
    return cached;
  }
  return async (query: string) => {
    normalizeSearchQuery(query);
    if (!cached || clock() >= expires) {
      if (!pending) pending = load().finally(() => { pending = undefined; });
      return matchDirectory(await pending, query);
    }
    return matchDirectory(cached, query);
  };
}

export const searchDirectory = createDirectorySearch();
