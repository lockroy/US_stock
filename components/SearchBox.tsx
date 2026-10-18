"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createSearchController, type SearchState } from "@/lib/search";
import { normalizeTicker, normalizeSearchQuery } from "@/lib/futu/symbol";
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
  const submission = useRef<AbortController | null>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        submission.current?.abort();
        search.cancel();
        setOpen(false);
        setState({ items: [], loading: false, error: null });
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("mousedown", onClick);
      search.cancel();
      submission.current?.abort();
    };
  }, [search]);

  function go(symbol: string) {
    submission.current?.abort();
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

  async function submit() {
    if (!q.trim()) return;
    submission.current?.abort();
    search.cancel();
    try { normalizeSearchQuery(q); }
    catch { setState({ items: [], loading: false, error: "搜尋內容無效，請輸入股票代號或公司名稱（最多 100 字）" }); return; }
    const controller = new AbortController();
    submission.current = controller;
    setState({ items: [], loading: true, error: null });
    setOpen(true);
    try {
      const response = await fetchSuggestions(q, controller.signal);
      if (controller.signal.aborted) return;
      const items = response.data ?? [];
      const ticker = normalizeTicker(q);
      const selected = items.find(item => normalizeTicker(item.symbol) === ticker)
        ?? (items.length === 1 ? items[0] : undefined);
      if (selected) { go(selected.symbol); return; }
      setState({ items, loading: false, error: null, mode: response.mode,
        message: items.length ? "請從搜尋結果選擇股票。" : response.message ?? "找不到符合範圍的股票。" });
    } catch (error) {
      if (controller.signal.aborted) return;
      setState({ items: [], loading: false, error: error instanceof Error ? error.message : "搜尋失敗，請稍後再試" });
    }
  }

  return (
    <div ref={boxRef} className="relative w-full max-w-xl">
      <input
        aria-label="美股代號或公司名稱"
        aria-controls="stock-suggestions"
        aria-expanded={open && state.items.length > 0}
        aria-busy={state.loading}
        role="combobox"
        aria-autocomplete="list"
        autoComplete="off"
        value={q}
        onFocus={() => { setOpen(true); search.search(q); }}
        onChange={(e) => { submission.current?.abort(); setQ(e.target.value); setOpen(true); search.search(e.target.value); }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && q.trim()) void submit();
          if (e.key === "Escape") {
            submission.current?.abort(); search.cancel(); setOpen(false); setState({ items: [], loading: false, error: null });
          }
        }}
        placeholder="輸入美股代號或英文公司名稱，例如 AAPL / Apple"
        className="w-full rounded-xl border border-line bg-card px-4 py-3 text-txt outline-none focus:border-accent"
      />
      {open && state.items.length > 0 && (
        <ul id="stock-suggestions" role="listbox" className="absolute z-10 mt-1 w-full rounded-xl border border-line bg-card overflow-hidden">
          {state.items.map(it => (
            <li key={it.symbol} role="option" aria-selected={false} className="border-b border-line last:border-0">
              <button type="button" onClick={() => go(it.symbol)} className="w-full text-left px-4 py-2 hover:bg-[#21262d]">
                <span className="font-semibold">{it.symbol}</span>
                <span className="ml-2 text-muted text-sm">{it.name}</span>
                {it.exchange && <span className="ml-2 text-muted text-xs">{it.exchange}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {state.loading && <div className="absolute right-3 top-3 text-muted text-xs" role="status">搜尋中…</div>}
      {state.error && <div className="text-bad text-sm mt-2" role="alert">{state.error}</div>}
      {state.message && <div className="text-muted text-xs mt-2" role="status">{state.message}</div>}
      {state.mode === "demo" && <div className="text-warn text-xs mt-2">搜尋結果為示範資料。</div>}
    </div>
  );
}
