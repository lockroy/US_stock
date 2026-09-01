"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";

interface Suggestion {
  symbol: string;
  name: string;
  type: string;
}

export function SearchBox() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function fetchSuggest(value: string) {
    if (!value.trim()) {
      setItems([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(value)}`);
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
      setOpen(true);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  function go(symbol: string) {
    const sym = symbol.replace(/^US\./, "");
    router.push(`/stock/${sym}`);
  }

  return (
    <div ref={boxRef} className="relative w-full max-w-xl">
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          fetchSuggest(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && q.trim()) go(q);
        }}
        placeholder="輸入美股代號，例如 AAPL / TSLA / NVDA"
        className="w-full rounded-xl border border-line bg-card px-4 py-3 text-txt outline-none focus:border-accent"
      />
      {open && items.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full rounded-xl border border-line bg-card overflow-hidden">
          {items.map((it) => (
            <li
              key={it.symbol}
              onClick={() => go(it.symbol)}
              className="cursor-pointer px-4 py-2 hover:bg-[#21262d] border-b border-line last:border-0"
            >
              <span className="font-semibold">{it.symbol}</span>
              <span className="ml-2 text-muted text-sm">{it.name}</span>
            </li>
          ))}
        </ul>
      )}
      {loading && <div className="absolute right-3 top-3 text-muted text-xs">搜尋中…</div>}
    </div>
  );
}
