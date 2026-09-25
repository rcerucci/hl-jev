#!/usr/bin/env python3
"""Graduação 15 min da sessão v2 — unidade = (estado × episódio), NUNCA o ciclo.

400 ticks no mesmo estado são **1 caso**, não 400. Este script:

1. agrupa as decisões pelas 7 palavras do estado;
2. dentro de cada estado, parte em **episódios** de 15 min que **não se sobrepõem**
   (o episódio começa no primeiro tick ainda não atribuído e leva os ticks até +900 s);
3. publica um ponto por (estado × episódio): `act`, `dir_after`, `|mov|`.

`etiqueta_vs_preço` é **descritivo da convenção que nós escrevemos**, não acerto do modelo:

  alinhou     `sell`+`down` ou `buy`+`up`
  inverteu    `sell`+`up`   ou `buy`+`down`
  sem_relacao hold, |mov| < 10 bps, ou o MESMO estado com os dois sentidos

Uso:
  python3 provas/perguntas/graduar-episodios.py <fronteira> [--json saida.json] [--lista-ciclos f.json]
"""
import argparse
import glob
import json
import statistics
import sys
from collections import Counter, defaultdict

HORIZONTE_MS = 900_000  # 15 min: a janela do desfecho do produto
LIMIAR_BPS = 10.0       # limiar do dono para "houve movimento"
MIN_HIGH_CONF = 0.80    # lido do produto (confAct); NOUL_HOSTILE_TH = 0.65
NOUL_HOSTILE_TH = 0.65
POS = {"spread": 0, "depth": 1, "flow": 2, "tape": 3, "inventory": 4, "funding": 5, "clock": 6}


def ts_ms(cycle_id: str) -> int:
    import datetime
    return int(datetime.datetime.strptime(cycle_id.split("-")[0], "%Y%m%dT%H%M%SZ").timestamp() * 1000)


def mov_bps(then, plus):
    """A mesma fórmula do produto (`directionOf`): ((plus - then) / then) * 10000."""
    if not isinstance(then, (int, float)) or not isinstance(plus, (int, float)) or not then > 0:
        return None
    return abs((plus - then) / then * 10_000)


def med(xs):
    return round(statistics.median(xs), 3) if xs else None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("fronteira")
    ap.add_argument("--ledger", default="data/ledger")
    ap.add_argument("--json", default=None)
    ap.add_argument("--lista-ciclos", default=None, help="grava o JSON com os cycle_ids dos pontos por graduar")
    a = ap.parse_args()

    dec, out = [], {}
    for f in sorted(glob.glob(f"{a.ledger}/*.jsonl")):
        for l in open(f):
            if not l.strip():
                continue
            r = json.loads(l)
            if r.get("kind") == "decision" and r["cycle_id"] >= a.fronteira:
                dec.append(r)
            elif r.get("kind") == "outcome":
                out[r["cycle_id"]] = r
    if not dec:
        print("sem decisoes na janela")
        return 1
    dec.sort(key=lambda r: ts_ms(r["cycle_id"]))

    # 1. agrupar pelas 7 palavras
    por_estado = defaultdict(list)
    for r in dec:
        por_estado[r.get("state") or "?"].append(r)

    # 2. episodios de 15 min que nao se sobrepoem
    pontos = []
    for estado, rs in por_estado.items():
        i = 0
        while i < len(rs):
            t0 = ts_ms(rs[i]["cycle_id"])
            j = i
            while j < len(rs) and ts_ms(rs[j]["cycle_id"]) < t0 + HORIZONTE_MS:
                j += 1
            ep = rs[i:j]
            atos = Counter(((r.get("verdict") or {}).get("act")) for r in ep)
            dom = atos.most_common(1)[0][0]
            confs = [c for c in ((r.get("verdict") or {}).get("act_conf") for r in ep) if isinstance(c, (int, float))]
            nouls = [c for c in ((r.get("verdict") or {}).get("too_hostile") for r in ep) if isinstance(c, (int, float))]
            ini = ep[0]
            o = out.get(ini["cycle_id"])
            pontos.append({
                "estado": estado,
                "de": ini["cycle_id"],
                "ate": ep[-1]["cycle_id"],
                "n_ticks": len(ep),
                "act": dom,
                "actos": dict(atos),
                "conf": med(confs),
                "noul": med(nouls),
                "sidesAny": sum(v for k, v in atos.items() if k in ("buy", "sell")),
                "n_lados": sum(
                    1 for r in ep
                    if ((r.get("verdict") or {}).get("act") in ("buy", "sell")
                        and isinstance((r.get("verdict") or {}).get("act_conf"), (int, float))
                        and (r.get("verdict") or {})["act_conf"] >= MIN_HIGH_CONF
                        and isinstance((r.get("verdict") or {}).get("too_hostile"), (int, float))
                        and (r.get("verdict") or {})["too_hostile"] < NOUL_HOSTILE_TH)
                ),
                "dir_after": (o or {}).get("dir_after"),
                "mov_bps": mov_bps((o or {}).get("mark_then"), (o or {}).get("mark_plus_15m")),
                "graduado": o is not None,
                "ciclo_ponto": ini["cycle_id"],
            })
            i = j

    # 3. o estado tem os dois sentidos? (a regra do dono manda tudo a `sem_relacao`)
    dois = {}
    for estado in por_estado:
        dirs = {p["dir_after"] for p in pontos if p["estado"] == estado and p["dir_after"] in ("up", "down")}
        dois[estado] = len(dirs) == 2

    for p in pontos:
        m = p["mov_bps"]
        if p["act"] not in ("buy", "sell") or m is None or m < LIMIAR_BPS or dois[p["estado"]]:
            p["etiqueta"] = "sem_relacao"
        elif (p["act"] == "sell" and p["dir_after"] == "down") or (p["act"] == "buy" and p["dir_after"] == "up"):
            p["etiqueta"] = "alinhou"
        elif (p["act"] == "sell" and p["dir_after"] == "up") or (p["act"] == "buy" and p["dir_after"] == "down"):
            p["etiqueta"] = "inverteu"
        else:
            p["etiqueta"] = "sem_relacao"

    pontos.sort(key=lambda p: (-(p["mov_bps"] or -1), p["de"]))

    print(f"  janela desde {a.fronteira} · {len(dec)} ciclos · {len(por_estado)} estados distintos · {len(pontos)} EPISODIOS")
    print(f"  graduados {sum(1 for p in pontos if p['graduado'])}/{len(pontos)} pontos (os restantes ficam pendentes para a passagem seguinte)")
    print()
    print(f"  {'estado':42s} {'n_ticks':>7s} {'act':5s} {'conf':>6s} {'noul':>6s} {'dir_after':9s} {'|mov| bps':>9s}  etiqueta_vs_preco")
    for p in pontos:
        m = f"{p['mov_bps']:8.1f}" if p["mov_bps"] is not None else "      --"
        print(f"  {p['estado']:42s} {p['n_ticks']:7d} {p['act']:5s} {str(p['conf']):>6s} {str(p['noul']):>6s} "
              f"{str(p['dir_after']):9s} {m}  {p['etiqueta']}")

    et = Counter(p["etiqueta"] for p in pontos)
    dois_ps = [p for p in pontos if dois[p["estado"]] and p["mov_bps"] is not None]
    print()
    print("  == CONTAGENS ==")
    print(f"    episodios: {len(pontos)} | alinhou {et['alinhou']} · inverteu {et['inverteu']} · sem_relacao {et['sem_relacao']}")
    print(f"    sem_relacao por MESMO estado com os dois sentidos: {len(dois_ps)} (estados: {sum(1 for e,d in dois.items() if d)})")
    print(f"    sem_relacao por |mov| < {LIMIAR_BPS:.0f} bps: {sum(1 for p in pontos if p['mov_bps'] is not None and p['mov_bps'] < LIMIAR_BPS)}")
    print(f"    sem_relacao por act hold: {sum(1 for p in pontos if p['act'] not in ('buy','sell'))}")
    print(f"    ticks totais {sum(p['n_ticks'] for p in pontos)} | sidesAny {sum(p['sidesAny'] for p in pontos)} | n_lados {sum(p['n_lados'] for p in pontos)}")
    print(f"    (ciclos = {len(dec)} nao e o denominador: {len(pontos)} episodios)")

    # 4. UMA leitura, das tres
    al, inv, sem = et["alinhou"], et["inverteu"], et["sem_relacao"]
    if len(dois_ps) > max(al, inv) or (al == 0 and inv == 0):
        leitura = "estado sem poder preditivo"
    elif al > inv:
        leitura = "convencao alinhou nesta amostra"
    elif inv > al:
        leitura = "convencao invertida (etiqueta estavel, sentido economico errado)"
    else:
        leitura = "estado sem poder preditivo (empate alinhou/inverteu: a amostra nao separa)"
    print()
    print("  == LEITURA (uma das tres) ==")
    print(f"    {leitura}")
    print("    nao e acerto do modelo: e a convencao que nos escrevemos no JSON.")

    if a.lista_ciclos:
        faltam = [p["ciclo_ponto"] for p in pontos if not p["graduado"]]
        json.dump(faltam, open(a.lista_ciclos, "w"))
        print(f"\n  por graduar: {len(faltam)} -> {a.lista_ciclos}")
    if a.json:
        json.dump({"fronteira": a.fronteira, "episodios": len(pontos), "contagens": dict(et),
                   "leitura": leitura, "pontos": pontos}, open(a.json, "w"), indent=1)
        print(f"  json: {a.json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
