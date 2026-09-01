import { SearchBox } from "@/components/SearchBox";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4">
      <h1 className="text-3xl font-bold mb-2">即時美股分析助手</h1>
      <p className="text-muted mb-8 text-center max-w-xl">
        輸入一個美股代號，產出「評分 → 買入時機 → 買入理由（圖+新聞）→ 日線圖」的單股決策報告。
      </p>
      <SearchBox />
      <div className="mt-10 text-xs text-muted text-center max-w-lg">
        數據來源：富途 REST API（免閘道）× 圖表：TradingView lightweight-charts × 評分：專家 100 分 × Fable 分析增強。
        <br />
        目前為無憑證 demo 模式（mock 數據），填入富途憑證即切真實行情。
      </div>
    </main>
  );
}
