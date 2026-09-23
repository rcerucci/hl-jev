/**
 * A caixa POLICY do ensaio N1: `sign(last20)` — **sem Jev**, sem rede, sem estado.
 *
 * Nao e uma politica de producao: e a regra de um ensaio, para separar "ha momentum curto
 * neste livro?" de "o modelo escolhe lado?". O Jev, o JSON das perguntas, o `dumb` e todo o
 * encoder do `tape` ficam intocados — esta caixa le um numero que o `Snapshot` **ja calcula**
 * (`returns_bps.last20`, a janela de 40 s = 20 ticks de 2 s).
 *
 * `EPS = 4 bps` e o `GRIND` do produto, escolhido **antes** de ver o rotulo e nao afinado
 * depois. Por isso a porta `Policy` ganhou um contexto opcional (`PolicyCtx`): a camada da
 * fusao recebe as palavras do estado, e o numero nao esta entre elas — so o adjectivo
 * (`grinding` cobre 4–15 bps **sem dizer o sentido**, logo o sinal nao se reconstroi do texto).
 *
 * Sem contexto, a resposta e `hold`: nunca inventa lado.
 */
import type { Act, Policy, PolicyCtx, Verdict } from "../risk/types";

/** Constantes do ensaio: fixas, publicadas, e nao calibradas contra a tabela. */
export const N1 = {
  EPS_BPS: 4,
  CONF_ON_SIDE: 0.9,
  CONF_ON_HOLD: 0.5,
  HOSTILE_FALSE: 0.1,
} as const;

/** A regra, isolada para o teste a poder exercer no limiar. */
export function numericAct(last20Bps: number, eps: number = N1.EPS_BPS): Act {
  if (last20Bps > eps) return "buy";
  if (last20Bps < -eps) return "sell";
  return "hold";
}

export class NumericPolicy implements Policy {
  readonly name = "numeric";

  async decide(_state: string, cycleId: string, ctx?: PolicyCtx): Promise<Verdict> {
    const last20 = ctx?.returns_bps.last20 ?? 0;
    const act = numericAct(last20);
    const side = act === "hold" ? N1.CONF_ON_HOLD : N1.CONF_ON_SIDE;
    const rest = (1 - side) / 2;
    return {
      cycle_id: cycleId,
      model: this.name,
      latency_ms: 0,
      act,
      act_probs: {
        buy: act === "buy" ? side : rest,
        sell: act === "sell" ? side : rest,
        hold: act === "hold" ? side : rest,
      },
      act_conf: side,
      // O N1 nao tem pergunta de hostilidade: o travao fica desligado, declarado.
      too_hostile: N1.HOSTILE_FALSE,
      raw_ok: true,
      note: `sign(last20) eps=${N1.EPS_BPS}bps`,
    };
  }
}
