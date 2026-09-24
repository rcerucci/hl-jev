/**
 * A caixa LEDGER: JSONL append-only, uma linha por escrita, duas por ciclo.
 *
 * D5: o ficheiro e o do **dia UTC da decisao**, e nao o do dia em que a linha e
 * escrita. Um ciclo das 23:50 grava `decision` hoje e `outcome` quinze minutos
 * depois — no ficheiro de hoje, para a juncao por `cycle_id` nao partir a meia-noite.
 * Como o `cycle_id` carrega o instante UTC, o worker do outcome nao precisa de
 * guardar nada alem do id.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface DecisionLine {
  kind: "decision";
  cycle_id: string;
  ts: number;
  sleeve: string;
  state: string;
  /**
   * Numeros do `Snapshot` que a decisao consumiu (ensaio N1). Sem eles a regra nao e
   * reproduzivel a partir do ledger: as marcas publicas vem de velas de 1 min e uma janela
   * de 40 s cai dentro da mesma vela, logo o `last20` nao se reconstroi de fora.
   * Opcional: as linhas antigas nao o tem e nao passam a ter.
   */
  returns_bps?: { last1: number; last5: number; last20: number };
  verdict: unknown;
  intent: unknown;
  fill: unknown;
}

export interface OutcomeLine {
  kind: "outcome";
  cycle_id: string;
  mark_then: number | null;
  mark_plus_15m: number | null;
  funding_accrued: number | null;
  dir_after: "up" | "down" | "flat" | null;
  jev_side: string | null;
  directional_hit: boolean | null;
  conf_was: number | null;
  high_conf_miss: boolean;
  /** Horizonte que produziu esta linha: mudar o de hoje nao reescreve o passado. */
  horizon_secs: number;
}

export type LedgerLine = DecisionLine | OutcomeLine;

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** `20260923T123015Z-SOL` — o instante UTC viaja dentro do id. */
export function cycleId(at: Date, sleeve: string): string {
  const d = `${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}`;
  const t = `${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}`;
  return `${d}T${t}Z-${sleeve.toUpperCase()}`;
}

/** Dia UTC da decisao, lido do proprio `cycle_id`. */
export function dayOfCycle(id: string): string {
  const day = id.slice(0, 8);
  if (!/^\d{8}$/.test(day)) throw new Error(`cycle_id sem dia UTC: ${id}`);
  return day;
}

export function sleeveOfCycle(id: string): string {
  const at = id.indexOf("-");
  if (at < 0) throw new Error(`cycle_id sem sleeve: ${id}`);
  return id.slice(at + 1);
}

export class Ledger {
  constructor(private dir: string) {}

  file(sleeve: string, day: string): string {
    return join(this.dir, `${day}-${sleeve.toUpperCase()}.jsonl`);
  }

  /** Append sincrono: uma linha pequena nao justifica esperar I/O no tick. */
  private append(line: LedgerLine): string {
    const path = this.file(sleeveOfCycle(line.cycle_id), dayOfCycle(line.cycle_id));
    mkdirSync(this.dir, { recursive: true });
    appendFileSync(path, `${JSON.stringify(line)}\n`, "utf8");
    return path;
  }

  writeDecision(line: DecisionLine): string {
    return this.append(line);
  }

  /** O outcome vai para o ficheiro do dia da **decisao**, nunca o de hoje (D5). */
  writeOutcome(line: OutcomeLine): string {
    return this.append(line);
  }

  read(sleeve: string, day: string): LedgerLine[] {
    const path = this.file(sleeve, day);
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as LedgerLine);
  }

  /** Nomes `<dia>-<SLEEVE>.jsonl` presentes no diretorio, ordenados. */
  private names(): { day: string; sleeve: string }[] {
    if (!existsSync(this.dir)) return [];
    const out: { day: string; sleeve: string }[] = [];
    for (const name of readdirSync(this.dir)) {
      const m = /^(\d{8})-([A-Z0-9]+)\.jsonl$/.exec(name);
      if (m) out.push({ day: m[1]!, sleeve: m[2]! });
    }
    return out.sort((a, b) => (a.day === b.day ? a.sleeve.localeCompare(b.sleeve) : a.day.localeCompare(b.day)));
  }

  /** Dias com ficheiro no ledger. */
  days(): string[] {
    return [...new Set(this.names().map((n) => n.day))];
  }

  /** Sleeves com ficheiro num dia. */
  sleevesOf(day: string): string[] {
    return this.names().filter((n) => n.day === day).map((n) => n.sleeve);
  }

  /** Ciclos de todos os dias e sleeves, com a marca temporal da decisao. */
  all(): { day: string; sleeve: string; decision: DecisionLine; outcome: OutcomeLine | null }[] {
    const out: { day: string; sleeve: string; decision: DecisionLine; outcome: OutcomeLine | null }[] = [];
    for (const { day, sleeve } of this.names()) {
      for (const cycle of this.cycles(sleeve, day)) out.push({ day, sleeve, ...cycle });
    }
    return out;
  }

  /** Juncao por `cycle_id`: uma decisao com o seu outcome, se ja existir. */
  cycles(sleeve: string, day: string): { decision: DecisionLine; outcome: OutcomeLine | null }[] {
    const byId = new Map<string, { decision?: DecisionLine; outcome?: OutcomeLine }>();
    for (const line of this.read(sleeve, day)) {
      const slot = byId.get(line.cycle_id) ?? {};
      if (line.kind === "decision") slot.decision = line;
      else slot.outcome = line;
      byId.set(line.cycle_id, slot);
    }
    return [...byId.values()]
      .filter((s): s is { decision: DecisionLine; outcome?: OutcomeLine } => s.decision != null)
      .map((s) => ({ decision: s.decision, outcome: s.outcome ?? null }));
  }
}
