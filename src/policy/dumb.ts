/**
 * A caixa POLICY, controle da spec 9.4: heuristica burra **sobre as mesmas doze
 * palavras** que o Jev ve.
 *
 * Isto nao e o `MockModel`. O `MockModel` (src/model.ts) decide sobre numeros
 * (returnsBps, bookImbalance, cvd) e continua a ser o `MODEL=mock` do repo para
 * correr sem chave. O controle da atribuicao tem de consumir o mesmo `state12`,
 * senao compara-se outra coisa. Ver decisao A4.
 *
 * Sem chamada de rede, sem estado, determinista.
 */
import type { Act, Policy, Verdict } from "../risk/types";

/** Valores fixos do controle: nao ha calibracao aqui, e so o lado burro. */
export const DUMB = {
  CONF_ON_SIDE: 0.9,
  CONF_ON_HOLD: 0.5,
  HOSTILE_TRUE: 0.9,
  HOSTILE_FALSE: 0.1,
} as const;

/** pumping -> buy, dumping -> sell, senao hold. Le so o bucket `tape`. */
export function dumbAct(state: string): Act {
  const tokens = state.split(/\s+/);
  if (tokens.includes("pumping")) return "buy";
  if (tokens.includes("dumping")) return "sell";
  return "hold";
}

/** Hostil quando o livro e uma briga com fita violenta — mesma leitura, sem numeros. */
export function dumbHostile(state: string): boolean {
  const tokens = state.split(/\s+/);
  return tokens.includes("bot_war") && (tokens.includes("violent") || tokens.includes("unfillable"));
}

export class DumbPolicy implements Policy {
  readonly name = "dumb";

  async decide(state: string, cycleId: string): Promise<Verdict> {
    const act = dumbAct(state);
    const hostile = dumbHostile(state);
    const conf = act === "hold" ? DUMB.CONF_ON_HOLD : DUMB.CONF_ON_SIDE;
    const side = conf;
    const rest = (1 - side) / 2;
    return {
      cycle_id: cycleId,
      model: "dumb",
      latency_ms: 0,
      act,
      act_probs: {
        buy: act === "buy" ? side : rest,
        sell: act === "sell" ? side : rest,
        hold: act === "hold" ? side : rest,
      },
      act_conf: conf,
      too_hostile: hostile ? DUMB.HOSTILE_TRUE : DUMB.HOSTILE_FALSE,
      raw_ok: true,
    };
  }
}
