#!/usr/bin/env python3
"""Ensaio das perguntas (v2): o que muda entre o texto v1 e o v2, no MESMO encoder.

Julga pelos critérios do PLANO §18.4 — e não por `n_lados`:
  PASS 1: `sidesAny > 0` (aparece buy/sell a QUALQUER confiança)
  PASS 2: o `noul` sobe com `spread=unfillable` / `tape=violent` e NÃO com `flow=bot_war` isolado
  FAIL  : 100 % hold E o `noul` continua a seguir `bot_war`/`funding`

Só lê o ledger (as decisões); não precisa de outcomes nem de rede.

Uso: python3 provas/perguntas/medir-v2.py <cycle_id_da_fronteira> [--json saida.json]
"""
import argparse
import glob
import json
import statistics
import sys
from collections import Counter

POS = {"spread": 0, "depth": 1, "flow": 2, "tape": 3, "inventory": 4, "funding": 5, "clock": 6}


def tok(state: str, i: int) -> str:
    t = state.split()
    return t[i] if i < len(t) else "?"


def lado(r) -> dict:
    v = r.get("verdict") or {}
    return {"act": str(v.get("act")), "conf": v.get("act_conf"), "noul": v.get("too_hostile"), "ok": v.get("raw_ok") is not False}


def resumo(rows: list, nome: str) -> dict:
    val = [r for r in rows if lado(r)["ok"]]
    atos = Counter(lado(r)["act"] for r in val)
    lados = [r for r in val if lado(r)["act"] in ("buy", "sell")]
    confs = sorted(lado(r)["conf"] for r in val if isinstance(lado(r)["conf"], (int, float)))
    nouls = sorted(lado(r)["noul"] for r in val if isinstance(lado(r)["noul"], (int, float)))

    # grupos de estado para o teste do noul (critério 2)
    grupos = {"unfillable": [], "tape=violent": [], "flow=bot_war": [], "resto": []}
    for r in val:
        s = r.get("state") or ""
        n = lado(r)["noul"]
        if not isinstance(n, (int, float)):
            continue
        if tok(s, POS["spread"]) == "unfillable":
            grupos["unfillable"].append(n)
        if tok(s, POS["tape"]) == "violent":
            grupos["tape=violent"].append(n)
        if tok(s, POS["flow"]) == "bot_war":
            grupos["flow=bot_war"].append(n)
        if tok(s, POS["spread"]) != "unfillable" and tok(s, POS["tape"]) != "violent" and tok(s, POS["flow"]) != "bot_war":
            grupos["resto"].append(n)

    def med(xs):
        return round(statistics.median(xs), 3) if xs else None

    med_grupos = {k: {"n": len(v), "mediana_noul": med(v)} for k, v in grupos.items()}

    print(f"\n  == {nome} ==")
    print(f"    decisoes {len(rows)} | validas {len(val)} | estados distintos {len({r.get('state') for r in val})}")
    print(f"    actos: {dict(atos)}")
    print(f"    sidesAny (buy|sell, qualquer confianca): {len(lados)}")
    if confs:
        print(f"    act_conf: min {confs[0]:.3f} mediana {med(confs):.3f} max {confs[-1]:.3f}")
    if nouls:
        print(f"    noul: min {nouls[0]:.3f} mediana {med(nouls):.3f} max {nouls[-1]:.3f}")
    print(f"    noul por grupo de estado: {med_grupos}")

    return {
        "nome": nome,
        "decisoes": len(rows),
        "validas": len(val),
        "actos": dict(atos),
        "sidesAny": len(lados),
        "conf": {"min": confs[0], "mediana": med(confs), "max": confs[-1]} if confs else None,
        "noul": {"min": nouls[0], "mediana": med(nouls), "max": nouls[-1]} if nouls else None,
        "noul_por_grupo": med_grupos,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("fronteira", help="cycle_id em que o v2 arrancou")
    ap.add_argument("--ledger", default="data/ledger")
    ap.add_argument("--json", default=None)
    args = ap.parse_args()

    rows = []
    for f in sorted(glob.glob(f"{args.ledger}/*.jsonl")):
        for l in open(f):
            if l.strip():
                r = json.loads(l)
                if r.get("kind") == "decision":
                    rows.append(r)
    if not rows:
        print("sem decisoes no ledger")
        return 1

    v1 = [r for r in rows if r["cycle_id"] < args.fronteira]
    v2 = [r for r in rows if r["cycle_id"] >= args.fronteira]
    a = resumo(v1, "v1 (texto antigo)")
    b = resumo(v2, f"v2 (texto novo, desde {args.fronteira})")

    # ---- veredicto, pelos criterios do §18.4
    noul_v2 = b["noul_por_grupo"]
    g_uf, g_vi = noul_v2.get("unfillable", {}), noul_v2.get("tape=violent", {})
    g_bw, g_rs = noul_v2.get("flow=bot_war", {}), noul_v2.get("resto", {})
    passa1 = b["sidesAny"] > 0
    # criterio 2: noul maior com unfillable/violent do que com bot_war isolado
    ref = max([x["mediana_noul"] for x in (g_uf, g_vi) if x.get("mediana_noul") is not None] or [0])
    bw = g_bw.get("mediana_noul")
    passa2 = (g_uf["n"] > 0 or g_vi["n"] > 0) and bw is not None and ref > bw
    print("\n  == VEREDICTO (§18.4) ==")
    print(f"    PASS 1  sidesAny > 0 .................. {'SIM' if passa1 else 'NAO'}  (sidesAny v2 = {b['sidesAny']})")
    print(f"    PASS 2  noul sobe com unfillable/violent e nao com bot_war ... {'SIM' if passa2 else 'NAO'}")
    print(f"            mediana noul: unfillable {g_uf.get('mediana_noul')} (n={g_uf['n']}) | tape=violent {g_vi.get('mediana_noul')} (n={g_vi['n']}) | flow=bot_war {bw} (n={g_bw['n']}) | resto {g_rs.get('mediana_noul')} (n={g_rs['n']})")
    if passa1 or passa2:
        print("    => PASS (um dos dois chega)")
    else:
        print("    => sem PASS: se tambem for 100% hold em v2, o texto nao era a alavanca (FAIL: para-se)")

    if args.json:
        with open(args.json, "w") as fh:
            json.dump({"fronteira": args.fronteira, "v1": a, "v2": b, "passa1": passa1, "passa2": passa2}, fh, indent=1)
        print(f"\n  json: {args.json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
