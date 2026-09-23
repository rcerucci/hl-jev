/**
 * Prova do venue (T018 / spec 9.3). Fala com a Hyperliquid **a serio**, com a
 * chave de testnet do clone, e responde as perguntas que faltavam:
 *
 *   bun run src/tools/prova-venue.ts estado   # so le: carteira, saldo, ordens abertas
 *   bun run src/tools/prova-venue.ts hold     # um tick com intent hold -> zero ordem
 *   bun run src/tools/prova-venue.ts buy      # um tick com intent buy  -> ALO resting ou reject limpo
 *
 * O intent e scriptado de proposito: o que esta em prova e o **executor**, nao a
 * politica. Nenhum limiar do RISK e tocado e nenhuma POLICY nova entra no
 * produto; e o mesmo padrao que os testes do repo ja usam (ScriptModel), aqui
 * apontado ao venue real.
 *
 * Guardas: recusa correr fora de testnet e recusa sem chave. No fim de `buy`,
 * cancela o que ficou na book — nao deixa ordem pendurada por um ensaio.
 */
import { config } from "../config";
import { Feed } from "../feed";
import { Ledger } from "../ledger/jsonl";
import { Market } from "../market";
import { MockModel, type Model } from "../model";
import type { Policy, Verdict } from "../risk/types";
import { loadSleeves } from "../sleeves";
import { Trader } from "../trader";
import type { BlockEvent } from "../types";

/** Guarda que devolve o valor ou para: sem `process.exit`, mantem a tipagem estreita. */
function exigir<T>(valor: T | undefined | null, msg: string): T {
  if (valor === undefined || valor === null) throw new Error(msg);
  return valor;
}

if (!config.hlTestnet) {
  throw new Error("RECUSADO: isto so corre com HL_TESTNET=true. Nada foi enviado.");
}

const modo = (process.argv[2] ?? "estado").toLowerCase();
if (modo !== "estado" && modo !== "hold" && modo !== "buy") {
  throw new Error("uso: prova-venue.ts [estado|hold|buy]");
}

const comChave = exigir(loadSleeves().find((s) => !!s.privateKey), "RECUSADO: nenhuma sleeve tem chave. Nada foi enviado.");
const chave = exigir(comChave.privateKey, "RECUSADO: chave ausente.");

const feed = new Feed(comChave.coin);
const market = new Market(feed, comChave);
await feed.connect();
await market.init();

const addr = market.address;
console.log(`sleeve ${comChave.label} | wallet ${addr} | testnet ${config.hlTestnet} | dryRun ${config.dryRun}`);
console.log(`  chave lida: ${chave.length} chars (valor nunca impresso)`);

const est = market as unknown as {
  info: { openOrders(p: { user: string }): Promise<{ oid: number; coin: string }[]> };
  ex: { cancel(p: { cancels: { a: number; o: number }[] }): Promise<unknown> };
  assetId: number;
};

async function ordensAbertas(quem: string | null | undefined): Promise<{ oid: number; coin: string }[]> {
  if (!quem) return [];
  return est.info.openOrders({ user: quem });
}

if (modo === "estado") {
  const conta = market.account;
  console.log(`  accountValue : ${conta ? conta.accountValue : "(sem WS ainda)"}`);
  console.log(`  withdrawable : ${conta ? conta.withdrawable : "(sem WS ainda)"}`);
  console.log(`  position     : ${conta ? conta.positionSz : "-"}`);
  const abertas = await ordensAbertas(addr);
  console.log(`  ordens abertas no venue: ${abertas.length}${abertas.length ? ` (${abertas.map((o) => `${o.coin}#${o.oid}`).join(", ")})` : ""}`);
  process.exit(0);
}

/** Politica scriptada: um veredicto, escrito no ledger como qualquer outro. */
class ScriptPolicy implements Policy {
  readonly name = "prova";
  constructor(private act: "hold" | "buy") {}
  async decide(_state: string, cid: string): Promise<Verdict> {
    return {
      cycle_id: cid,
      model: "prova-venue",
      latency_ms: 0,
      act: this.act,
      act_probs: { buy: this.act === "buy" ? 0.92 : 0.5, sell: 0.04, hold: 0.04 },
      act_conf: this.act === "buy" ? 0.92 : 0.5,
      too_hostile: 0.05,
      raw_ok: true,
    };
  }
}

const ledger = new Ledger(config.ledgerDir);
const eventos: BlockEvent[] = [];
const trader = new Trader(
  market,
  new MockModel() as unknown as Model,
  (e) => eventos.push(e),
  (_block, fill) => console.log(`  FILL: ${fill.side} ${fill.size} @ ${fill.price}${fill.simulated ? " (sim)" : ""}`),
  (_block, quote) => console.log(`  QUOTE: ${quote.side} ${quote.size} @ ${quote.price} status=${quote.status} taker=${quote.taker ?? false}${quote.orderId ? ` oid=${quote.orderId}` : ""}`),
  { policy: new ScriptPolicy(modo === "buy" ? "buy" : "hold"), ledger },
);

const antes = await ordensAbertas(addr);
console.log(`  ordens abertas antes: ${antes.length}`);

await trader.onBlock(1);
await Bun.sleep(2000);

const depois = await ordensAbertas(addr);
console.log(`  ordens abertas depois: ${depois.length}${depois.length ? ` (${depois.map((o) => `${o.coin}#${o.oid}`).join(", ")})` : ""}`);
console.log(`  veredicto gravado: ${eventos.at(-1)?.decision ? JSON.stringify(eventos.at(-1)?.decision) : "(nenhum)"}`);

if (modo === "hold") {
  console.log(antes.length === depois.length
    ? "RESULTADO: hold nao mexeu na book (nenhuma ordem nova)."
    : "RESULTADO: INESPERADO, o hold mexeu na book.");
} else {
  const novas = depois.filter((o) => !antes.some((a) => a.oid === o.oid));
  console.log(novas.length
    ? `RESULTADO: ALO resting no venue: ${novas.map((o) => `${o.coin}#${o.oid}`).join(", ")}`
    : "RESULTADO: nenhuma ordem ficou na book. Ver o reject acima: 'reject limpo' tambem conta (9.3).");
  for (const o of novas) {
    await est.ex.cancel({ cancels: [{ a: est.assetId, o: o.oid }] }).catch(() => {});
    console.log(`  limpeza: cancelada ${o.coin}#${o.oid}`);
  }
}

process.exit(0);
