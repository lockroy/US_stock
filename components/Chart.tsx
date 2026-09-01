"use client";

import { useEffect, useRef } from "react";
import { createChart, ColorType, type IChartApi, type ISeriesApi, type CandlestickData, type UTCTimestamp, type SeriesMarker } from "lightweight-charts";
import type { Candle, BuyPoint } from "@/lib/types";

export function Chart({ candles, buyPoints, height = 360 }: { candles: Candle[]; buyPoints: BuyPoint[]; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, {
      height,
      width: ref.current.clientWidth,
      layout: { background: { type: ColorType.Solid, color: "#0d1117" }, textColor: "#8b949e" },
      grid: { vertLines: { color: "#21262d" }, horzLines: { color: "#21262d" } },
      timeScale: { borderColor: "#30363d" },
      rightPriceScale: { borderColor: "#30363d" },
    });
    const series = chart.addCandlestickSeries({
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });
    chartRef.current = chart;
    seriesRef.current = series;

    const onResize = () => {
      if (ref.current) chart.applyOptions({ width: ref.current.clientWidth });
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.remove();
    };
  }, [height]);

  useEffect(() => {
    if (!seriesRef.current) return;
    const data: CandlestickData[] = candles.map((c) => ({
      time: c.time as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    seriesRef.current.setData(data);
    chartRef.current?.timeScale().fitContent();

    const markers: SeriesMarker<UTCTimestamp>[] = buyPoints.map((b) => ({
      time: b.time as UTCTimestamp,
      position: "belowBar",
      color: "#f59e0b",
      shape: "arrowUp",
      text: "買",
    }));
    seriesRef.current.setMarkers(markers);
  }, [candles, buyPoints]);

  return <div ref={ref} className="w-full" />;
}
