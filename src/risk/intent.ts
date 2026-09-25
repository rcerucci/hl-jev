/**
 * A caixa RISK, segunda metade: veredicto do Jev -> RiskIntent minimo.
 *
 * Os gates sao os da spec 3.6, com a leitura da decisao D3 sobre os dois holds:
 * so um hold que o Jev **respondeu** desmonta a resting quote. Falha de API, JSON
 * invalido ou livro velho **congelam** o livro: nao mandam ordem nova e nao cancelam.
 */
import { config } from "../config";
import { inventoryBucket } from "./buckets";
import type { Act, IntentReason, RiskIntent, Snapshot, Verdict } from "./types";

export interface RiskGateInput {
  cycleId: string;
  sleeve: string;
  verdict: Verdict;
  snap: Snapshot;
  confAct?: number;
  hostileTh?: number;
  staleMs?: number;
}

const FROZEN: ReadonlySet<IntentReason> = new Set<IntentReason>(["frozen_timeout", "frozen_raw", "frozen_stale"]);

/** Sem resposta valida do Jev: nao enviar ordem nova **e** nao cancelar a resting. */
export function isFrozen(intent: RiskIntent): boolean {
  return FROZEN.has(intent.reason);
}

/** O Jev respondeu (ou o codigo recusou sobre uma resposta valida): cancela a resting. */
export function standsDown(intent: RiskIntent): boolean {
  if (intent.reason === "stance_hold") return false;
  return intent.side === "hold" && !isFrozen(intent);
}

/** Um act contra a posicao aberta reduz risco; a favor, adiciona. */
export function reducingExisting(posSide: Snapshot["pos_side"], act: Act): boolean {
  return (act === "sell" && posSide === "long") || (act === "buy" && posSide === "short");
}

export function wouldIncreaseRisk(snap: Pick<Snapshot, "pos_side">, act: Act, inventory: string): boolean {
  if (act === "buy") return snap.pos_side === "long" && inventory === "long_heavy";
  if (act === "sell") return snap.pos_side === "short" && inventory === "short_heavy";
  return false;
}

function hold(cycleId: string, sleeve: string, conf: number, reason: IntentReason): RiskIntent {
  return { cycle_id: cycleId, sleeve, side: "hold", urgency: "none", reduce_only: false, conf, reason };
}

export function riskIntent(input: RiskGateInput): RiskIntent {
  const { cycleId, sleeve, verdict, snap } = input;
  const confAct = input.confAct ?? config.confAct;
  const hostileTh = input.hostileTh ?? config.hostileTh;
  const staleMs = input.staleMs ?? config.bookStaleMs;
  const conf = Number.isFinite(verdict.act_conf) ? verdict.act_conf : 0;

  // 1. Sem resposta valida: congelar. Nunca "chuta lado" (spec 2.2.4).
  if (!verdict.raw_ok) {
    return hold(cycleId, sleeve, conf, verdict.note === "timeout" ? "frozen_timeout" : "frozen_raw");
  }

  // 2. Livro velho: o estado que o Jev viu ja nao descreve a book. Congelar.
  if (!(snap.book_age_ms <= staleMs)) {
    return hold(cycleId, sleeve, conf, "frozen_stale");
  }

  const reducing = reducingExisting(snap.pos_side, verdict.act);

  // Caixa = capital fora do mercado. Nao e hold de sinal.
  if (verdict.signal === "caixa" || verdict.raw === "caixa") {
    return hold(cycleId, sleeve, conf, "caixa");
  }

  // Hold de postura: raw nao mudou. Nao cancela a resting que ainda serve.
  if (verdict.signal === "hold" && (verdict.raw === "buy" || verdict.raw === "sell")) {
    return hold(cycleId, sleeve, conf, "stance_hold");
  }

  // 3. Livro hostil, salvo se a ordem reduz o que ja esta aberto.
  if (verdict.too_hostile >= hostileTh && !reducing) {
    return hold(cycleId, sleeve, conf, "hostile");
  }

  // 4. Confianca abaixo do limiar, e a confianca e o campo do SDK, nao a prob.
  if (!(conf >= confAct)) {
    return hold(cycleId, sleeve, conf, "low_conf");
  }

  if (verdict.act === "hold") return hold(cycleId, sleeve, conf, "jev_hold");

  // 5. Inventario extremo na direccao do act: v1 nunca adiciona (spec 3.6).
  if (wouldIncreaseRisk(snap, verdict.act, inventoryBucket(snap))) {
    return hold(cycleId, sleeve, conf, "inventory_block");
  }

  // 6. V1: o RISK pede maker; quem decide o TIF da saida e o plan.ts (venue).
  return {
    cycle_id: cycleId,
    sleeve,
    side: verdict.act,
    urgency: "maker",
    reduce_only: reducing,
    conf,
    reason: verdict.model === "stance" ? "stance_act" : "jev_act",
  };
}
