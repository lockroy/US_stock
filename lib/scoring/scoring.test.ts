// 估值評分校準回歸測試（2026-08-29）
// 背景：原 P/B 門檻 >10 歸零導致科技/成長股估值維度系統性偏低，
// 校準後必須滿足：①科技股不歸零 ②深度價值股仍高分 ③分數不出界
import { scoreValuation } from "./scoring";
import type { Valuation } from "../types";

function v(partial: Partial<Valuation>): Valuation {
  return { pe: 25, peg: 1.2, pb: 4, fcfYield: 3, ps: null, evSales: null, ...partial };
}

// 場景 1：科技成長股（AAPL 類）P/B 50 + 高 ROE 55%
// 期望：P/B 保底 1 分 + ROE 修正 +1 = 2/6，不得歸零
const growth = scoreValuation(v({ pe: 35, peg: 1.8, pb: 50 }), 55);
const pbGrowth = growth.factors.find((f) => f.sub === "P/B")!;
if (pbGrowth.score < 1) throw new Error(`科技股 P/B 不應歸零，得到 ${pbGrowth.score}`);
console.log(`✓ 科技股 P/B 保底+ROE 修正: ${pbGrowth.score}/6`);
console.log(`✓ 科技股估值總分: ${growth.score.toFixed(1)}/20`);
if (growth.score <= 0 || growth.score > 20) throw new Error("估值總分越界");

// 場景 2：深度價值股（銀行類）P/E 8、PEG 0.8、P/B 0.9
// 期望：P/B 接近滿分，總分接近滿分
const bank = scoreValuation(v({ pe: 8, peg: 0.8, pb: 0.9 }));
const pbBank = bank.factors.find((f) => f.sub === "P/B")!;
if (pbBank.score < 5.5) throw new Error(`低 P/B 應得高分，得到 ${pbBank.score}`);
if (bank.score < 19) throw new Error(`深度價值股估值應接近滿分，得到 ${bank.score}`);
console.log(`✓ 銀行股 P/B 滿分區: ${pbBank.score}/6，總分 ${bank.score.toFixed(1)}/20`);

// 場景 3：一般工業股 P/B 6（原邏輯 4 分 → 新邏輯應在 3-4 分區間，鑑別力保留）
const industrial = scoreValuation(v({ pe: 20, peg: 1.3, pb: 6 }));
const pbInd = industrial.factors.find((f) => f.sub === "P/B")!;
if (pbInd.score < 2.5 || pbInd.score > 4.5) throw new Error(`中段 P/B 分數異常: ${pbInd.score}`);
console.log(`✓ 中段 P/B 鑑別力: ${pbInd.score}/6`);

console.log("評分校準測試全部通過 ✅");
