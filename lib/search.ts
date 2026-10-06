import type { DataResponse, SearchResult } from "./types";

export interface SearchState {
  items: SearchResult[];
  loading: boolean;
  error: string | null;
  mode?: "real" | "demo";
}

// 同時取消請求與檢查代次：即使 fetch／供應商忽略 abort，舊回應也不能改寫畫面。
export function createSearchController(
  request: (query: string, signal: AbortSignal) => Promise<DataResponse<SearchResult[]>>,
  update: (state: SearchState) => void,
  delay = 250,
) {
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: AbortController | undefined;
  function cancel() {
    generation++;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    abort?.abort();
    abort = undefined;
  }
  function search(value: string) {
    cancel();
    const query = value.trim();
    update({ items: [], loading: !!query, error: null });
    if (!query) return;
    const current = generation;
    timer = setTimeout(async () => {
      timer = undefined;
      const controller = new AbortController();
      abort = controller;
      try {
        const response = await request(query, controller.signal);
        if (generation !== current || controller.signal.aborted) return;
        update({ items: response.data ?? [], loading: false, error: null, mode: response.mode });
      } catch (error) {
        if (generation !== current || controller.signal.aborted) return;
        update({ items: [], loading: false, error: error instanceof Error ? error.message : "暫時無法搜尋" });
      }
    }, delay);
  }
  return { search, cancel };
}
