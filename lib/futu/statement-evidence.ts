import type { EpsEvidence, StatementChecks, StatementMetric } from "../types";

type Row = Record<string, unknown>;
const object = (v: unknown): Row | null => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Row : null;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const TAGS = {
  revenue: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"],
  netIncome: ["NetIncomeLoss"],
  totalEquity: ["StockholdersEquity"],
  operatingCashFlow: ["NetCashProvidedByUsedInOperatingActivities"],
  capitalExpenditures: ["PaymentsToAcquirePropertyPlantAndEquipment"],
};
export interface StatementFacts {
  evidence: EpsEvidence;
  values: Record<keyof typeof TAGS, { value: number | null; metrics: string[]; reason: string }>;
}

// 使用與年度 EPS 相同公司的同一申報；USD 是該財務科目的原始單位，並非從 EPS 推測。
export function parseStatementFacts(payload: unknown, evidence: EpsEvidence): StatementFacts {
  const root = object(payload), gaap = object(object(root?.facts)?.["us-gaap"]);
  const values = {} as StatementFacts["values"];
  for (const key of Object.keys(TAGS) as (keyof typeof TAGS)[]) {
    const candidates: { value: unknown; tag: string }[] = [];
    if (root?.cik === Number(evidence.cik)) for (const tag of TAGS[key]) {
      const units = object(object(gaap?.[tag])?.units), rows = units?.USD;
      if (!Array.isArray(rows)) continue;
      for (const item of rows) {
        const r = object(item);
        if (!r || r.accn !== evidence.accession || r.filed !== evidence.filed || r.form !== evidence.form
          || r.end !== evidence.currentEnd || r.fp !== "FY") continue;
        if (key === "totalEquity" ? r.start !== undefined : r.start !== evidence.currentStart) continue;
        candidates.push({ value: r.val, tag });
      }
    }
    const metrics = [...new Set(candidates.map(r => r.tag))];
    const unique = new Set(candidates.map(r => r.value));
    const valid = candidates.length > 0 && candidates.every(r => finite(r.value)) && unique.size === 1;
    values[key] = { value: valid ? candidates[0].value as number : null, metrics,
      reason: !candidates.length ? "同一申報未取得符合期間的 USD 科目，不用其他幣種、季度或舊申報補缺。"
        : !valid ? "同申報科目／別名數值衝突或無效，不能挑選剛好相符的數字。" : "同申報、同期間 USD 科目。" };
  }
  return { evidence, values };
}

export function reconcileStatements(facts: StatementFacts, provider: Record<StatementMetric, number | null>): StatementChecks {
  const { evidence, values } = facts;
  const sec = {
    revenue: values.revenue, netIncome: values.netIncome, totalEquity: values.totalEquity,
    fcf: { value: values.operatingCashFlow.value !== null && values.capitalExpenditures.value !== null
      ? values.operatingCashFlow.value - Math.abs(values.capitalExpenditures.value) : null,
      metrics: [...values.operatingCashFlow.metrics, ...values.capitalExpenditures.metrics],
      reason: "簡化自由現金流＝同申報 USD 營運現金流−資本支出絕對值；缺任一科目時不計算。" },
  };
  return { source: "sec", cik: evidence.cik, accession: evidence.accession, filed: evidence.filed, periodEnd: evidence.currentEnd,
    url: evidence.url, unit: "USD", providerScale: 1000, scope: "selected_fields_same_filing",
    checks: (Object.keys(provider) as StatementMetric[]).map(key => {
      const raw = finite(provider[key]) ? provider[key] : null;
      const amount = finite(sec[key].value) ? sec[key].value : null;
      const difference = raw !== null && amount !== null ? raw * 1000 - amount : null;
      const usable = difference !== null && Number.isFinite(difference);
      // Nasdaq 金額以千元呈列；容許最多半個呈列單位的四捨五入差，沒有自動更改縮放或匯率。
      return { key, providerThousands: raw, secUSD: amount, differenceUSD: usable ? difference : null,
        status: !usable ? "unavailable" : Math.abs(difference) <= 500 ? "matched" : "mismatch", metrics: sec[key].metrics,
        note: `${sec[key].reason} Nasdaq 原值×1000 對照 SEC USD；容許差額 500 USD，只核對列出科目，不代表整份財報或股份口徑已驗證。` };
    }) };
}
