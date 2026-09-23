#!/usr/bin/env python3
"""
Ensaio de buckets — o "antes" e o "depois" (regra 4 do ensaio, PLANO-FUSAO §17).

NÃO altera nada: lê o ledger e publica o cruzamento entre a palavra do estado e o
movimento que o `outcome` já mede. É o mesmo comando antes e depois do patch do
`tape`, para a comparação ser entre iguais.

Uso:
    python3 provas/buckets/antes-depois.py                       # imprime
    python3 provas/buckets/antes-depois.py --json antes.json      # grava o snapshot

Critério (regra 4): em janelas com |mov 15 min| >= 10 bps, o `tape` deve passar a
{pumping,dumping,grinding} de forma MONÓTONA com |mov|. Sem monotonia, é cosmética.
"""
import argparse
import datetime
import glob
import json
import os
import statistics
import sys
from collections import Counter, defaultdict

# ordem fixa do state: spread depth flow tape inventory funding clock
POS = {"spread": 0, "depth": 1, "flow": 2, "tape": 3, "inventory": 4, "funding": 5, "clock": 6}
LIMIAR_BPS = 10


def linha(pos: int, state: str) -> str:
    t = state.split()
    return t[pos] if pos < len(t) else "?"


def _ms(cid: str) -> int:
    """cycle_id `YYYYMMDDTHHMMSSZ-BTC` -> ms desde a epoch."""
    import datetime as _dt

    d = cid.split("-")[0]
    return int(_dt.datetime.strptime(d, "%Y%m%dT%H%M%SZ").replace(tzinfo=_dt.timezone.utc).timestamp() * 1000)


def relatorio_janelas(dec: dict, outs: list, args) -> int:
    """Palavra DOMINANTE do `tape` por janela de 900 s x |mov| da ancora da janela.

    Porque assim e nao por ciclo: dentro de uma janela de 15 min o movemento do outcome
    e UM so (as janelas dos ciclos vizinhos sobrepoem-se); a palavra, essa, varia de ciclo
    para ciclo e a moda resume-a sem ruido de um unico tick. Uma linha por janela = uma
    observacao por janela, sem contar nada duas vezes.
    """
    ciclos = sorted(((cid, d) for cid, d in dec.items() if d.get("state")), key=lambda kv: kv[0])
    if not ciclos:
        print("sem ciclos com estado")
        return 1
    omap = {o["cycle_id"]: o for o in outs}
    t0 = _ms(ciclos[0][0])
    janelas: dict = {}
    for cid, d in ciclos:
        w = (_ms(cid) - t0) // 900_000
        janelas.setdefault(w, []).append((cid, d))

    linhas = []
    for w in sorted(janelas):
        membros = janelas[w]
        palavras = Counter(linha(POS["tape"], d["state"]) for _, d in membros)
        dom, n_dom = palavras.most_common(1)[0]
        cand = [(abs(_ms(cid) - (t0 + w * 900_000)), cid) for cid, _ in membros if cid in omap]
        mov = None
        ancora = None
        if cand:
            ancora = min(cand)[1]
            o = omap[ancora]
            mov = abs((o["mark_plus_15m"] - o["mark_then"]) / o["mark_then"]) * 1e4
        linhas.append(
            {
                "janela": w,
                "de": datetime.datetime.fromtimestamp((t0 + w * 900_000) / 1000, datetime.timezone.utc).strftime("%H:%M"),
                "ciclos": len(membros),
                "dominante": dom,
                "pct_dominante": round(100 * n_dom / len(membros), 1),
                "composicao": dict(palavras.most_common()),
                "mov_bps": round(mov, 1) if mov is not None else None,
                "ancora": ancora,
            }
        )

    com = [l for l in linhas if l["mov_bps"] is not None]
    if args.json:
        with open(args.json, "w") as fh:
            json.dump({"janelas": linhas, "n_com_movimento": len(com)}, fh, indent=1)
        print(f"  json: {args.json}")
    print(f"  JANELAS de 900 s: {len(linhas)} | com movimento graduado: {len(com)}")
    print(f"  {'inicio':7s} {'ciclos':6s} {'dominante':10s} {'%dom':6s} {'|mov|':8s} composicao")
    for l in linhas:
        mov = f"{l['mov_bps']:7.1f}" if l["mov_bps"] is not None else "   --  "
        print(f"  {l['de']:7s} {l['ciclos']:6d} {l['dominante']:10s} {l['pct_dominante']:5.1f}% {mov} {l['composicao']}")
    if not com:
        print("\n  sem janela com movimento graduado: nao ha o que ordenar")
        return 0

    por_palavra: dict = {}
    for l in com:
        por_palavra.setdefault(l["dominante"], []).append(l["mov_bps"])
    ordem = ["flat", "grinding", "pumping", "dumping", "violent"]
    seq = [(w, sorted(v)[len(v) // 2], len(v)) for w in ordem if (v := por_palavra.get(w))]
    print("\n  POR PALAVRA DOMINANTE (mediana de |mov| entre JANELAS)")
    for w, med, n in seq:
        print(f"    {w:10s} janelas={n:2d} | mediana {med:6.1f} bps")
    cresce = len(seq) >= 2 and all(b[1] > a[1] for a, b in zip(seq, seq[1:]))
    print(f"\n  monotonia na ordem semantica {ordem}: {[(w, m) for w, m, _ in seq]}")
    print(f"  as medianas crescem? {'SIM' if cresce else 'NAO'}"
          + ("" if len(seq) >= 2 else "  (amostra insuficiente: falta variar a palavra entre janelas)"))
    grandes = [l for l in com if l["mov_bps"] >= LIMIAR_BPS]
    flat_grandes = [l for l in grandes if l["dominante"] == "flat"]
    if grandes:
        print(f"  janelas com |mov| >= {LIMIAR_BPS} bps: {len(grandes)} | dominante `flat`: {len(flat_grandes)}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ledger", default="data/ledger")
    ap.add_argument("--desde", default=None, help="cycle_id minimo (ex. 20260923T1830) — o 'depois' comeca aqui")
    ap.add_argument("--ate", default=None, help="cycle_id maximo")
    ap.add_argument("--independentes", action="store_true",
                    help="guarda so ciclos espacados >= 900 s entre si: as janelas de 15 min deixam de ser "
                         "a MESMA observacao repetida (os primeiros 224 outcomes cabiam em 23,6 min = 2 janelas)")
    ap.add_argument("--janelas", action="store_true",
                    help="agrega por JANELA de 900 s: palavra do tape DOMINANTE dentro da janela x |mov| da "
                         "ancora da janela — uma observacao por janela, sem ruido de um so ciclo (regra 4)")
    ap.add_argument("--json", default=None)
    args = ap.parse_args()

    dec, outs = {}, []
    for f in sorted(glob.glob(f"{args.ledger}/*.jsonl")):
        for l in open(f):
            if not l.strip():
                continue
            r = json.loads(l)
            cid = r.get("cycle_id", "")
            if args.desde and cid < args.desde:
                continue
            if args.ate and cid > args.ate:
                continue
            if r.get("kind") == "decision":
                dec[cid] = r
            elif r.get("kind") == "outcome":
                outs.append(r)

    descartados_sobrepostos = 0
    if args.independentes:
        ordem = sorted(outs, key=lambda o: o["cycle_id"])
        kept, ultimo = [], None
        for o in ordem:
            t = _ms(o["cycle_id"])
            if ultimo is None or t - ultimo >= 900_000:
                kept.append(o)
                ultimo = t
            else:
                descartados_sobrepostos += 1
        outs = kept

    if args.janelas:
        return relatorio_janelas(dec, outs, args)
    if not outs:
        print("sem outcomes no ledger")
        return 1

    # cruza: palavra do estado (no ciclo) x |movimento a 15 min| (no outcome)
    por_bucket: dict = {b: defaultdict(list) for b in POS}
    completos = 0
    for o in outs:
        d = dec.get(o["cycle_id"])
        if not d or not d.get("state"):
            continue
        mov = abs((o["mark_plus_15m"] - o["mark_then"]) / o["mark_then"]) * 1e4
        completos += 1
        for b, i in POS.items():
            por_bucket[b][linha(i, d["state"])].append(mov)

    resumo = {}
    print(f"outcomes: {len(outs)} | cruzados com estado: {completos}")
    for b in ("tape", "flow", "spread", "depth", "funding", "clock", "inventory"):
        print(f"\n  -- `{b}` vs |movimento a 15 min|")
        tab = []
        for w, v in sorted(por_bucket[b].items(), key=lambda kv: -statistics.median(kv[1])):
            v2 = sorted(v)
            tab.append(
                {
                    "palavra": w,
                    "n": len(v),
                    "mediana_bps": round(statistics.median(v), 1),
                    "p90_bps": round(v2[int(0.9 * (len(v) - 1))], 1),
                    "pct_ge_10bps": round(100 * sum(1 for x in v if x >= LIMIAR_BPS) / len(v), 1),
                }
            )
            t = tab[-1]
            print(f"     {w:12s} n={t['n']:4d} | |mov| mediana {t['mediana_bps']:6.1f} bps | p90 {t['p90_bps']:6.1f} | >=10 bps: {t['pct_ge_10bps']:5.1f}%")
        resumo[b] = tab

    # o número que decide (regra 4)
    todos = [abs((o["mark_plus_15m"] - o["mark_then"]) / o["mark_then"]) * 1e4 for o in outs if dec.get(o["cycle_id"], {}).get("state")]
    grandes = [o for o in outs if abs((o["mark_plus_15m"] - o["mark_then"]) / o["mark_then"]) * 1e4 >= LIMIAR_BPS and dec.get(o["cycle_id"], {}).get("state")]
    flat_grandes = [o for o in grandes if linha(POS["tape"], dec[o["cycle_id"]]["state"]) == "flat"]
    flat_todos = [o for o in outs if dec.get(o["cycle_id"], {}).get("state") and linha(POS["tape"], dec[o["cycle_id"]]["state"]) == "flat"]
    cru = {
        "n_outcomes": len(outs),
        "n_cruzados": completos,
        "n_ge_10bps": len(grandes),
        "pct_ge_10bps": round(100 * len(grandes) / len(todos), 1) if todos else None,
        "ge_10bps_com_tape_flat": len(flat_grandes),
        "pct_dos_grandes_com_tape_flat": round(100 * len(flat_grandes) / len(grandes), 1) if grandes else None,
        "flat_n": len(flat_todos),
        "flat_mediana_bps": round(statistics.median([abs((o["mark_plus_15m"] - o["mark_then"]) / o["mark_then"]) * 1e4 for o in flat_todos]), 1) if flat_todos else None,
    }
    print("\n  == O NÚMERO QUE DECIDE ==")
    print(f"     |mov 15 min| >= {LIMIAR_BPS} bps em {cru['n_ge_10bps']}/{len(todos)} ciclos ({cru['pct_ge_10bps']}%)")
    print(f"     desses, com `tape = flat`: {cru['ge_10bps_com_tape_flat']}/{cru['n_ge_10bps']} = {cru['pct_dos_grandes_com_tape_flat']}%")
    print(f"     `flat` no total: n={cru['flat_n']} com mediana {cru['flat_mediana_bps']} bps")
    # A ordem SEMÂNTICA que a regra 4 exige: o adjectivo tem de ORDENAR o movimento.
    # (A primeira versão comparava a lista com ela própria ordenada — passava sempre ✗.)
    ordem = ["flat", "grinding", "pumping", "dumping"]
    med = {t["palavra"]: t["mediana_bps"] for t in resumo["tape"]}
    seq = [(w, med[w]) for w in ordem if w in med]
    cresce = len(seq) >= 2 and all(b[1] > a[1] for a, b in zip(seq, seq[1:]))
    print(f"\n     monotonia do `tape` na ordem semantica {ordem}: {seq}")
    print(f"     as medianas crescem nessa ordem? {'SIM' if cresce else 'NAO'}"
          + ("" if len(seq) >= 2 else "  (amostra insuficiente para julgar)"))
    print("     (regra 4 exige que cresçam: sem isso, o adjectivo nao ordena o movimento)")

    if args.json:
        saida = {"cru": cru, "por_bucket": resumo, "ledger": args.ledger}
        with open(args.json, "w") as fh:
            json.dump(saida, fh, indent=1)
        print(f"\n  json: {args.json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
