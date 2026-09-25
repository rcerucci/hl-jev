/**
 * POLICY=stance: maquina de inventario buy / sell / hold / caixa.
 * Nao e oraculo de PnL. Sem rede. Sem Jev.
 *
 * raw  ∈ {buy, sell, caixa}
 * signal ∈ {buy, sell, hold, caixa}  — hold sse raw == raw anterior
 *
 * Constantes: ensaio dos extremos. Nao afinar.
 */
import type { Act, Policy, PolicyCtx, StanceRaw, StanceSignal, Verdict } from "../risk/types";
import { STANCE_L } from "./stance_features";

export const STANCE = {
  L: STANCE_L,
  CHAO: 0.15,
  TECTO: 0.85,
  CONF_ON_SIDE: 0.9,
  CONF_ON_HOLD: 0.5,
  HOSTILE_FALSE: 0.1,
} as const;

export function rawStance(s: number, u: number): StanceRaw {
  if (s === 0) return "caixa";
  if (s > 0 && u >= STANCE.TECTO) return "caixa";
  if (s < 0 && u <= STANCE.CHAO) return "caixa";
  return s > 0 ? "buy" : "sell";
}

export function signalFrom(raw: StanceRaw, prev: StanceRaw | undefined): StanceSignal {
  return prev !== undefined && raw === prev ? "hold" : raw;
}

function actOf(signal: StanceSignal): Act {
  if (signal === "buy" || signal === "sell") return signal;
  return "hold";
}

export class StancePolicy implements Policy {
  readonly name = "stance";
  private prev = new Map<string, StanceRaw>();

  async decide(_state: string, cycleId: string, ctx?: PolicyCtx): Promise<Verdict> {
    const sleeve = cycleId.includes("-") ? cycleId.slice(cycleId.indexOf("-") + 1) : cycleId;
    const prev = ctx?.raw_prev ?? this.prev.get(sleeve);
    let raw: StanceRaw;
    if (ctx?.s == null || ctx.u == null) {
      raw = "caixa";
    } else {
      raw = rawStance(ctx.s, ctx.u);
    }
    const signal = signalFrom(raw, prev);
    this.prev.set(sleeve, raw);
    const act = actOf(signal);
    const side = act === "hold" ? STANCE.CONF_ON_HOLD : STANCE.CONF_ON_SIDE;
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
      too_hostile: STANCE.HOSTILE_FALSE,
      raw_ok: true,
      raw,
      signal,
      note: `stance s=${ctx?.s ?? "na"} u=${ctx?.u ?? "na"}`,
    };
  }
}
