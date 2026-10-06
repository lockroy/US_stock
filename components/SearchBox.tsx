"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createSearchController, type SearchState } from "@/lib/search";
import { normalizeTicker } from "@/lib/futu/symbol";
import type { DataResponse, SearchResult } from "@/lib/types";

async function fetchSuggestions(query: string, signal: AbortSignal): Promise<DataResponse<SearchResult[]>> {
  const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal });
  const body: DataResponse<SearchResult[]> & { error?: string } = await res.json();
  if (!res.ok) throw new Error(body.error || "暫時無法搜尋，請稍後再試");
  if (!Array.isArray(body.data)) throw new Error("搜尋資料格式無效");
  return body;
}

export function SearchBox() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<SearchState>({ items: [], loading: false, error: null });
  const [search] = useState(() => createSearchController(fetchSuggestions, setState));
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        search.cancel();
        setOpen(false);
        setState({ items: [], loading: false, error: null });
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("mousedown", onClick);
      search.cancel();
    };
  }, [search]);

  function go(symbol: string) {
    const ticker = normalizeTicker(symbol);
    search.cancel();
    setOpen(false);
    if (!ticker) {
      setState({ items: [], loading: false, error: "請輸入有效股票代號或選擇搜尋結果" });
      return;
    }
    setState({ items: [], loading: false, error: null });
    router.push(`/stock/${encodeURIComponent(ticker)}`);
  }

  return (
    <div ref={boxRef} className="relative w-full max-w-xl">
      <input
        aria-label="美股代號"
        aria-controls="stock-suggestions"
        aria-expanded={open && state.items.length > 0}
        aria-busy={state.loading}
        role="combobox"
        aria-autocomplete="list"
        autoComplete="off"
        value={q}
        onFocus={() => { setOpen(true); search.search(q); }}
        onChange={(e) => { setQ(e.target.value); setOpen(true); search.search(e.target.value); }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && q.trim()) go(q);
          if (e.key === "Escape") {
            search.cancel(); setOpen(false); setState({ items: [], loading: false, error: null });
          }
        }}
        placeholder="輸入美股代號，例如 AAPL / TSLA / NVDA"
        className="w-full rounded-xl border border-line bg-card px-4 py-3 text-txt outline-none focus:border-accent"
      />
      {open && state.items.length > 0 && (
        <ul id="stock-suggestions" role="listbox" className="absolute z-10 mt-1 w-full rounded-xl border border-line bg-card overflow-hidden">
          {state.items.map(it => (
            <li key={it.symbol} role="option" aria-selected={false} className="border-b border-line last:border-0">
              <button type="button" onClick={() => go(it.symbol)} className="w-full text-left px-4 py-2 hover:bg-[#21262d]">
                <span className="font-semibold">{it.symbol}</span>
                <span className="ml-2 text-muted text-sm">{it.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {state.loading && <div className="absolute right-3 top-3 text-muted text-xs" role="status">搜尋中…</div>}
      {state.error && <div className="text-bad text-sm mt-2" role="alert">{state.error}</div>}
      {state.mode === "demo" && <div className="text-warn text-xs mt-2">搜尋結果為示範資料。</div>}
    </div>
  );
}
