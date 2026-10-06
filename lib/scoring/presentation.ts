const TIER_COLORS: Record<string, string> = {
  "強烈建議買入": "#22c55e",
  "建議買入 / 逢低布局": "#22c55e",
  "觀望 / 持有": "#f59e0b",
  "避開 / 賣出": "#ef4444",
  "資料不足 / 暫不評級": "#8b949e",
};

export function tierColor(tier: string): string {
  return TIER_COLORS[tier] ?? "#8b949e";
}
