// 共享給 API 與搜尋導向；只負責格式，存在性由真實資料供應商驗證。
export function normalizeTicker(raw: string): string | null {
  const ticker = raw.trim().toUpperCase().replace(/^US\./, "");
  return /^[A-Z]{1,6}(?:[.-][A-Z]{1,2})?$/.test(ticker) ? ticker : null;
}
