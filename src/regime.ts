/**
 * Regime da sigma no disco: `s`, `prevRaw` e o circuit breaker por sleeve.
 *
 * Sem isto o processo a cair a meio da janela de 12 h recomeça o CB a zero e o
 * veto de pavio perde o `s` vigente. O `#44` (lado visto / inversão) vive no
 * trader e não entra aqui.
 *
 * Escrita síncrona, ficheiro pequeno, o mesmo critério do ledger. Sem `dir`
 * (testes, `new SigmaPolicy()`) não há I/O.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { StanceRaw } from "./risk/types";
import type { CbState } from "./policy/sigma";

export interface SleeveRegime {
  s: number;
  prevRaw?: StanceRaw;
  cb: CbState;
}

const sleeveFile = (dir: string, sleeve: string) =>
  join(dir, `${sleeve.replace(/[^A-Za-z0-9]/g, "").toUpperCase() || "X"}.json`);

function asCb(raw: unknown): CbState | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.flips) || o.flips.some((t) => typeof t !== "number")) return null;
  if (typeof o.until !== "number" || typeof o.lastClosedAt !== "number") return null;
  return { flips: o.flips as number[], until: o.until, lastClosedAt: o.lastClosedAt };
}

export function loadRegime(dir: string, sleeve: string): SleeveRegime | null {
  const path = sleeveFile(dir, sleeve);
  if (!existsSync(path)) return null;
  try {
    const o = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    if (typeof o.s !== "number") return null;
    const cb = asCb(o.cb);
    if (!cb) return null;
    const prev = o.prevRaw;
    const prevRaw = prev === "buy" || prev === "sell" || prev === "caixa" ? prev : undefined;
    return { s: o.s, prevRaw, cb };
  } catch {
    return null;
  }
}

export function saveRegime(dir: string, sleeve: string, regime: SleeveRegime): string {
  mkdirSync(dir, { recursive: true });
  const path = sleeveFile(dir, sleeve);
  const body: SleeveRegime = {
    s: regime.s,
    prevRaw: regime.prevRaw,
    cb: {
      flips: [...regime.cb.flips],
      until: regime.cb.until,
      lastClosedAt: regime.cb.lastClosedAt,
    },
  };
  writeFileSync(path, `${JSON.stringify(body)}\n`, "utf8");
  return path;
}

export function emptyRegime(): SleeveRegime {
  return { s: 0, cb: { flips: [], until: 0, lastClosedAt: 0 } };
}
