"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import type { SigmaSide, SigmaVeto } from "@/lib/sigma";

export type EntryLine = {
  price: number;
  side: "long" | "short";
};

type Props = {
  candles: Candle[];
  marks: FillMark[];
  /** As marcas do sigma (o `s` e os vetos de pavio). Sai dos eventos, nao das velas. */
  sigma?: { sides: SigmaSide[]; vetoes: SigmaVeto[] };
  entry: EntryLine | null;
  rangeKey: string;
  visibleBars: number;
  secondsVisible: boolean;
  formatPrice: (n: number) => string;
  /**
   * As margens que o grafico ocupa com os seus proprios eixos (escala de preco a direita, eixo do
   * tempo em baixo). A legenda vive DENTRO da area de vela, por isso tem de saber onde ela acaba.
   */
  onInsets?: (i: { right: number; bottom: number }) => void;
};

/**
 * O grafico pinta em canvas e nao ve as CSS vars: le-as do documento para nao
 * manter uma segunda paleta a mao. Chamado so no cliente (dentro de efeitos).
 */
function palette() {
  const cs = getComputedStyle(document.documentElement);
  const v = (nome: string, alt: string) => cs.getPropertyValue(nome).trim() || alt;
  return {
    fundo: v("--bg", "#f1e9cf"),
    tinta: v("--ink", "#2b2b27"),
    /** As velas: no escuro um degrau abaixo da tinta do texto, para nao ofuscar. */
    vela: v("--candle", "#2b2b27"),
    /** O fill (ordem que encheu): a cor mais viva do ecra. O `s` fica no tom calmo. */
    fillBuy: v("--fill-buy", "#0b7a3b"),
    fillSell: v("--fill-sell", "#bf2a22"),
    texto: v("--muted", "#69665b"),
    grelha: v("--grid", "#d9d2ba"),
    borda: v("--border", "#2f2f2b"),
    buy: v("--buy", "#4d7150"),
    sell: v("--sell", "#9a4a3e"),
    late: v("--late", "#8a6a24"),
  };
}

type Palette = ReturnType<typeof palette>;

/** Velas monocromaticas: alta cheia, baixa oca, contorno sempre na tinta das velas. */
function seriesOptions(p: Palette) {
  return {
    upColor: p.vela,
    downColor: p.fundo,
    borderUpColor: p.vela,
    borderDownColor: p.vela,
    wickUpColor: p.vela,
    wickDownColor: p.vela,
    // A linha do ultimo preco vinha branca no escuro (a cor da serie): passa a discreta.
    priceLineColor: p.texto,
    priceLineStyle: LineStyle.Dashed,
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

/**
 * As marcas do grafico: os fills (setas), o `s` de cada H1 fechada (setas) e os vetos de pavio
 * (disco com `x`). O `lightweight-charts` v5 nao tem forma de cruz, por isso o veto e um disco
 * ambar com o `x` escrito ao lado: a cor `--late` e a que o tema ja usa para "bloqueado".
 *
 * A ordem TEM de ser crescente no tempo, senao a biblioteca recusa a lista.
 */
function toMarkers(
  rows: FillMark[],
  sigma: { sides: SigmaSide[]; vetoes: SigmaVeto[] } | undefined,
  p: Palette,
): SeriesMarker<Time>[] {
  const out: SeriesMarker<Time>[] = rows.map((m) => ({
    time: asTime(m.time),
    position: m.side === "buy" ? "belowBar" : "aboveBar",
    shape: m.side === "buy" ? "arrowUp" : "arrowDown",
    // O fill leva a cor viva e a seta maior: e a ordem que encheu, o unico marcador que e dinheiro.
    color: m.side === "buy" ? p.fillBuy : p.fillSell,
    size: 1.1,
  }));
  for (const m of sigma?.sides ?? []) {
    // O `s` e uma SETA FORA da barra, no tom calmo e mais pequena: e a leitura da hora, nao dinheiro.
    out.push({
      time: asTime(m.time),
      position: m.side === "buy" ? "belowBar" : "aboveBar",
      shape: m.side === "buy" ? "arrowUp" : "arrowDown",
      color: m.side === "buy" ? p.buy : p.sell,
      size: 0.7,
    });
  }
  for (const v of sigma?.vetoes ?? []) {
    out.push({
      time: asTime(v.time),
      position: "aboveBar",
      shape: "circle",
      color: p.late,
      size: 0.7,
      text: "x",
    });
  }
  out.sort((a, b) => Number(a.time) - Number(b.time));
  return out;
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
  sigma,
  entry,
  rangeKey,
  visibleBars,
  secondsVisible,
  formatPrice,
  onInsets,
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
  const onInsetsRef = useRef(onInsets);
  onInsetsRef.current = onInsets;

  /**
   * A area que os eixos do grafico ocupam (escala de preco a direita e eixo do tempo em baixo).
   * A legenda vive DENTRO da area das velas, por isso tem de saber onde ela acaba, em vez de ficar
   * sobre o eixo no canto do painel. Medido no grafico, nao escrito a mao: a largura da escala de
   * preco muda com os digitos dos precos.
   */
  const reportInsets = useCallback(() => {
    requestAnimationFrame(() => {
      const chart = chartRef.current;
      if (!chart) return;
      const right = Math.round(chart.priceScale("right").width()) + 10;
      const bottom = Math.round(chart.timeScale().height()) + 10;
      onInsetsRef.current?.({ right, bottom });
    });
  }, []);
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
      reportInsets();
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
    // Os digitos dos precos mudam a largura da escala a direita: a legenda tem de saber.
    reportInsets();
  }, [candles, rangeKey, visibleBars, reportInsets]);

  useEffect(() => {
    markersRef.current?.setMarkers(toMarkers(marks, sigma, palette()));
  }, [marks, sigma, tema]);

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
