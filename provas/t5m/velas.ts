/**
 * Fonte única das velas públicas para as sondas do T-5m (READ-ONLY, nenhum `src/`).
 *
 * Porque existe: o endpoint devolve **janelas limitadas** e uma primeira versão do censo pedia
 * o histórico numa só chamada — as corridas saíam truncadas em ~2 000 barras (~7 dias) sem que
 * nada o dissesse. Aqui pagina-se para a frente a partir do último `t` recebido e **avisa-se
 * quando chegam menos barras do que as pedidas**: é o aviso que denuncia o corte da fonte
 * (neste venue, o histórico público de 5 min acaba em ~5 038 barras ≈ 17,5 dias).
 */
import { InfoClient } from "@nktkas/hyperliquid";
import { transportFor } from "../../src/ledger/marks_source";

export type Vela = { t: number; T: number; o: string; h: string; l: string; c: string; v: string; n: number };

export interface Serie {
  velas: Vela[];
  pedidas: number;
  barrasPorDia: number;
}

/**
 * Candles paginados. `passoMs` é o intervalo do TF (5 min = 300_000), usado para avançar a
 * janela sem repetir a última barra.
 */
export async function velas(
  coin: string,
  interval: "5m" | "1h",
  de: number,
  ate: number,
  passoMs: number,
  info?: InfoClient,
): Promise<Vela[]> {
  const cli = info ?? new InfoClient({ transport: transportFor() });
  const out: Vela[] = [];
  let from = de;
  for (let i = 0; i < 300; i++) {
    const chunk = (await cli.candleSnapshot({ coin, interval, startTime: from, endTime: ate })) as unknown as Vela[];
    if (!chunk.length) break;
    out.push(...chunk);
    const ultimo = chunk[chunk.length - 1].t;
    if (ultimo + passoMs > ate) break;
    from = ultimo + passoMs;
    await Bun.sleep(120); // cortesia com o endpoint público
  }
  return out;
}

/** Busca com o AVISO de truncagem: nunca deixar uma janela curta passar por uma longa. */
export async function serie(
  coin: string,
  horas: number,
  passoMs: number,
  info?: InfoClient,
): Promise<Serie> {
  const cli = info ?? new InfoClient({ transport: transportFor() });
  const agora = Date.now();
  const barrasPorDia = 86_400_000 / passoMs;
  const pedidas = Math.round((horas * 3_600_000) / passoMs);
  const vs = await velas(coin, "5m", agora - horas * 3_600_000, agora, passoMs, cli);
  return { velas: vs, pedidas, barrasPorDia };
}

/** Imprime a prova de volume e o aviso, se a fonte entregou menos do que se pediu. */
export function provarFonte(vs: Vela[], pedidas: number): { truncada: boolean; ultima: Vela } {
  const ultima = vs[vs.length - 1];
  console.log("== FONTE (vela de 5 min crua do cliente) ==");
  console.log("  campos:", Object.keys(ultima as unknown as Record<string, unknown>).join(", "));
  console.log(
    `  ultima vela: t=${ultima.t} o=${ultima.o} h=${ultima.h} l=${ultima.l} c=${ultima.c} v=${ultima.v} n=${ultima.n}`,
  );
  console.log(`  barras recebidas: ${vs.length} · pedidas: ${pedidas}`);
  const truncada = vs.length < pedidas * 0.9;
  if (truncada) {
    console.log(
      `  AVISO: pediram-se ${pedidas} barras e vieram ${vs.length} — a fonte nao tem esse historico.` +
        ` Nao se chama a isto a janela pedida.`,
    );
  }
  return { truncada, ultima };
}
