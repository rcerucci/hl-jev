"use client";

import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type CandlestickData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle, FillMark } from "@/lib/ohlc";

export type EntryLine = {
  price: number;
  side: "long" | "short";
};

type Props = {
  candles: Candle[];
  marks: FillMark[];
  entry: EntryLine | null;
  rangeKey: string;
  visibleBars: number;
  secondsVisible: boolean;
  formatPrice: (n: number) => string;
};

/**
 * O grafico pinta em canvas e nao ve as CSS vars: le-as do documento para nao
 * manter uma segunda paleta a mao. Chamado so no cliente (dentro de efeitos).
 */
function palette() {
  const cs = getComputedStyle(document.documentElement);
  const v = (nome: string, alt: string) => cs.getPropertyValue(nome).trim() || alt;
  return {
    fundo: v("--bg", "#ffffff"),
    tinta: v("--ink", "#000000"),
    texto: v("--muted", "#666666"),
    grelha: v("--grid", "#e5e5e5"),
    borda: v("--border", "#000000"),
    buy: v("--buy", "#00aa00"),
    sell: v("--sell", "#cc0000"),
  };
}

type Palette = ReturnType<typeof palette>;

/** Velas monocromaticas: alta cheia, baixa oca, contorno sempre na tinta. */
function seriesOptions(p: Palette) {
  return {
    upColor: p.tinta,
    downColor: p.fundo,
    borderUpColor: p.tinta,
    borderDownColor: p.tinta,
    wickUpColor: p.tinta,
    wickDownColor: p.tinta,
  };
}

function themeOptions(p: Palette, secondsVisible: boolean) {
  return {
    layout: {
      background: { type: ColorType.Solid, color: p.fundo },
      textColor: p.texto,
      fontFamily: "IBM Plex Mono, ui-monospace, monospace",
    },
    grid: { vertLines: { color: p.grelha }, horzLines: { color: p.grelha } },
    rightPriceScale: { borderColor: p.borda },
    timeScale: { borderColor: p.borda, timeVisible: true, secondsVisible },
  };
}

function asTime(sec: number): UTCTimestamp {
  return sec as UTCTimestamp;
}

function toBars(rows: Candle[]): CandlestickData<Time>[] {
  return rows.map((c) => ({
    time: asTime(c.time),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }));
}

function toMarkers(rows: FillMark[], p: Palette): SeriesMarker<Time>[] {
  return rows.map((m) => ({
    time: asTime(m.time),
    position: m.side === "buy" ? "belowBar" : "aboveBar",
    shape: m.side === "buy" ? "arrowUp" : "arrowDown",
    color: m.side === "buy" ? p.buy : p.sell,
    size: 0.8,
  }));
}

function stemOf(rows: Candle[]): string {
  if (!rows.length) return "empty";
  return `${rows[0]!.time}`;
}

function showLatest(chart: IChartApi | null, count: number, visibleBars: number) {
  if (!chart || count <= 0) return;
  const to = count + 1;
  const from = Math.max(-1, to - visibleBars);
  chart.timeScale().setVisibleLogicalRange({ from, to });
}

export default function CandlePane({
  candles,
  marks,
  entry,
  rangeKey,
  visibleBars,
  secondsVisible,
  formatPrice,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const entryLineRef = useRef<IPriceLine | null>(null);
  const stemRef = useRef("");
  const rangeRef = useRef("");
  const formatRef = useRef(formatPrice);
  formatRef.current = formatPrice;
  /** Gatilho: muda a cada troca de tema, para as cores do canvas serem relidas. */
  const [tema, setTema] = useState(0);

  useEffect(() => {
    const alvo = document.documentElement;
    const obs = new MutationObserver(() => setTema((n) => n + 1));
    obs.observe(alvo, { attributes: true, attributeFilter: ["data-theme"] });
    setTema((n) => n + 1);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const p = palette();
    const temaOpts = themeOptions(p, secondsVisible);
    const chart = createChart(el, {
      width: Math.max(1, el.clientWidth),
      height: Math.max(1, el.clientHeight),
      ...temaOpts,
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: p.borda, scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: { ...temaOpts.timeScale, shiftVisibleRangeOnNewBar: true },
      localization: { priceFormatter: (n: number) => formatRef.current(n) },
    });
    const series = chart.addSeries(CandlestickSeries, seriesOptions(p));
    const markers = createSeriesMarkers(series, []);
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (!r) return;
      chart.resize(Math.max(1, Math.round(r.width)), Math.max(1, Math.round(r.height)));
    });
    ro.observe(el);
    chartRef.current = chart;
    seriesRef.current = series;
    markersRef.current = markers;
    return () => {
      ro.disconnect();
      markers.detach();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      markersRef.current = null;
      entryLineRef.current = null;
      stemRef.current = "";
      rangeRef.current = "";
    };
  }, []);

  // Tema trocado: o canvas nao segue CSS, tem de ser reaplicado a mao.
  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;
    const p = palette();
    const temaOpts = themeOptions(p, secondsVisible);
    chart.applyOptions({
      ...temaOpts,
      rightPriceScale: { borderColor: p.borda, scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: { ...temaOpts.timeScale, shiftVisibleRangeOnNewBar: true },
    });
    series.applyOptions(seriesOptions(p));
  }, [tema, secondsVisible]);

  useEffect(() => {
    chartRef.current?.applyOptions({ timeScale: { secondsVisible, timeVisible: true } });
  }, [secondsVisible]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const bars = toBars(candles);
    const stem = stemOf(candles);
    if (!bars.length) {
      series.setData([]);
      stemRef.current = stem;
      return;
    }
    const stemChanged = stemRef.current !== stem;
    if (!stemChanged && stem) {
      series.update(bars[bars.length - 1]!);
    } else {
      series.setData(bars);
      stemRef.current = stem;
    }
    if (rangeRef.current !== rangeKey || stemChanged) {
      rangeRef.current = rangeKey;
      showLatest(chartRef.current, bars.length, visibleBars);
    }
  }, [candles, rangeKey, visibleBars]);

  useEffect(() => {
    markersRef.current?.setMarkers(toMarkers(marks, palette()));
  }, [marks, tema]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    if (!entry || !(entry.price > 0)) {
      if (entryLineRef.current) {
        series.removePriceLine(entryLineRef.current);
        entryLineRef.current = null;
      }
      return;
    }
    const next = {
      price: entry.price,
      color: entry.side === "long" ? palette().buy : palette().sell,
      lineWidth: 1 as const,
      lineStyle: LineStyle.Solid,
      axisLabelVisible: true,
      title: "entry",
    };
    if (entryLineRef.current) {
      entryLineRef.current.applyOptions(next);
      return;
    }
    entryLineRef.current = series.createPriceLine(next);
  }, [entry, tema]);

  return <div ref={hostRef} className="lwc-host" style={{ position: "absolute", inset: 0 }} />;
}
