/**
 * H4 — o porteiro do alfa. No arranque recusa (**exit**, nao warn) qualquer corrida que nao seja
 * o motor desta conta nas condicoes declaradas: `POLICY=sigma`, BTC/SOL, 1x, sem meia-live.
 *
 * Cada regra tem teste em `test/gate.test.ts`. A nona condicao do pedido — o tamanho do sigma nao
 * vir de `QUOTE_USD` — nao e observavel em runtime: e estrutural, e vive num teste que le o
 * caminho do tamanho.
 */
import { cbKnobs, config } from "./config";

export interface ResolvedRun {
  policy: string;
  coins: string[];
  dryRun: boolean;
  hlTestnet: boolean;
  hasSigner: boolean;
  leverage: number;
  bankrollUsd: number;
  maxLiveEquityUsd: number;
}

/** As moedas do alfa. */
export const ALFA_COINS = ["BTC", "SOL"];

/** A primeira razao de recusa, ou `null` se a corrida e a do alfa. */
export function alphaRefusal(r: ResolvedRun): string | null {
  if (r.policy !== "sigma") {
    return `policy=${r.policy || "(vazio)"}: o motor desta conta e POLICY=sigma`;
  }
  if (r.dryRun && !r.hlTestnet && r.hasSigner) {
    return "DRY_RUN=true em mainnet com signer: meia-live, com chave e sem rede de seguranca";
  }
  if (!r.dryRun && r.hlTestnet) {
    return "DRY_RUN=false em testnet: dinheiro real so em mainnet";
  }
  if (r.leverage !== 1) {
    return `leverage=${r.leverage}: o alfa corre a 1x`;
  }
  // O tecto e do dinheiro real: no dry run a regua e o BANKROLL_USD do exemplo, que e maior.
  if (!r.dryRun && r.bankrollUsd > r.maxLiveEquityUsd) {
    return `bankroll=$${r.bankrollUsd} acima do tecto do alfa ($${r.maxLiveEquityUsd})`;
  }
  const fora = r.coins.filter((c) => !ALFA_COINS.includes(c.toUpperCase()));
  if (fora.length) {
    return `moeda fora do alfa: ${fora.join(", ")} (so ${ALFA_COINS.join(" ou ")})`;
  }
  if (!r.dryRun && !r.hasSigner) {
    return "DRY_RUN=false sem signer: sem chave nao ha ordem real";
  }
  if (r.dryRun && r.hasSigner) {
    return "DRY_RUN=true com signer: a chave nao entra numa corrida simulada";
  }
  if (config.sigma.quoteInsideTicks !== 0) {
    return `sigma.quoteInsideTicks=${config.sigma.quoteInsideTicks}: o alfa entra no touch (0)`;
  }
  return null;
}

/** Levanta com a razao. Quem chama escolhe morrer (o `start` morre). */
export function assertAlphaRun(r: ResolvedRun): void {
  const why = alphaRefusal(r);
  if (why) throw new Error(`porteiro do alfa: ${why}`);
}

/**
 * A linha de arranque com o objecto **resolvido**. Sem ela o arranque nao conta.
 *
 * Os tres botoes do CB saem com a **origem** entre parenteses (issue #37): `(config)` = o default do
 * `src/config.ts`, `(env)` = veio do ambiente. Sem isso, uma VPS a correr `CB_FLIPS=4` e uma `main`
 * com default 4 davam a mesma linha — a divergencia era invisivel.
 */
export function bootLine(r: ResolvedRun, coin: string): string {
  return [
    "sigma",
    `policy=${r.policy}`,
    `coin=${coin}`,
    `net=${r.hlTestnet ? "testnet" : "mainnet"}`,
    `dry=${r.dryRun}`,
    `lev=${r.leverage}`,
    `cap=$${r.maxLiveEquityUsd}`,
    `cbFlips=${config.sigma.cbFlips} (${cbKnobs.flips.source})`,
    `cbWindow=${cbKnobs.windowH.value}h (${cbKnobs.windowH.source})`,
    `cbCaixa=${cbKnobs.caixaH.value}h (${cbKnobs.caixaH.source})`,
    `quoteInside=${config.sigma.quoteInsideTicks}`,
    `aloWait=${config.sigma.aloWaitMs}ms`,
  ].join(" · ");
}
