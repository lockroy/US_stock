// 共享給 API 與搜尋導向；只負責格式，存在性由真實資料供應商驗證。
export function normalizeTicker(raw: string): string | null {
  const ticker = raw.trim().toUpperCase().replace(/^US\./, "").replace(/^([A-Z]{1,6})\/([A-Z]{1,2})$/, "$1.$2");
  return /^[A-Z]{1,6}(?:[.-][A-Z]{1,2})?$/.test(ticker) ? ticker : null;
}

export function normalizeSearchQuery(raw: string) {
  const query = raw.trim().replace(/\s+/g, " ");
  if (!query || query.length > 100 || !/^[\p{L}\p{N} .,&'’()\/-]+$/u.test(query)) throw new Error("INVALID_QUERY");
  return query;
}
