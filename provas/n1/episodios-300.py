#!/usr/bin/env python3
"""N1 — sonda dos episódios de 300 s (regras congeladas pelo dono, 23 set 2026).

**Ponto = janela de 300 s, se ALGUM tick lá dentro tiver |last20| ≥ 4 bps.**

Regras, todas escritas antes de a sessão correr:

1. `EPS = 4 bps` (= o `GRIND` do produto). Intocado.
2. O sinal do episódio é o do **primeiro** tick com |last20| ≥ EPS — não o máximo, não o que
   melhor alinha.
3. Se na mesma janela houver ticks acima de `+EPS` **e** abaixo de `−EPS`, o episódio é
   `sem_relacao` (sinal contraditório) e **não se escolhe lado**.
4. Rótulo primário a **300 s = 5 bps** (`flat` abaixo disso). `|mov|≥2` e `|mov|≥10` são
   colunas de **diagnóstico: nunca promovem**.
5. O rótulo corre a partir do **tick do sinal** (t_sig → t_sig + 300 s). Do início da janela
   seria *olhar para a frente*: com o sinal a meio da janela, o movimento medido já conteria a
   rajada que o sinal mede. Episódios não se sobrepõem: guarda-se uma âncora só se ela estiver
   ≥ 300 s depois da anterior guardada.
6. PASS/FAIL pelo binomial com n elegível, não por percentagem solta:
   n=16 → 12/16 (75 %) · n=24 → 17/24 (71 %) · n=36 → 24/36 (67 %). Abaixo de 16 elegíveis:
   **insuficiente**.
7. Sessão de um só sentido de preço = **amostra enviesada**, não PASS — mesmo com o mínimo.

Uso:
  python3 provas/n1/episodios-300.py <fronteira> [--json saida.json] [--lista-ciclos f.json]
"""
import argparse
import glob
import json
import statistics
import sys
from collections import Counter
from math import comb

EPS_BPS = 4.0          # N1.EPS_BPS
JANELA_MS = 300_000    # a janela do episódio
HORIZONTE_MS = 300_000 # o horizonte do rótulo
CORTE_BPS = 5.0        # rótulo primário
DIAG = (2.0, 10.0)     # diagnóstico: nunca promove
MIN_ELEGIVEIS = 16
# tabela do binomial unilateral p<0.05 com p0=0.5 (o dono escreveu-a: não se recalcula a gosto)
TABELA = {16: 12, 24: 17, 36: 24}


def ts_ms(cycle_id: str) -> int:
    import datetime
    return int(datetime.datetime.strptime(cycle_id.split("-")[0], "%Y%m%dT%H%M%SZ").timestamp() * 1000)


def mov_bps(then, plus):
    if not isinstance(then, (int, float)) or not isinstance(plus, (int, float)) or not then > 0:
        return None
    return ((plus - then) / then) * 10_000


def dir_of(bps, corte):
    if bps is None:
        return None
    if abs(bps) < corte:
        return "flat"
    return "up" if bps > 0 else "down"


def med(xs):
    return round(statistics.median(xs), 2) if xs else None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("fronteira")
    ap.add_argument("--ledger", default="data/ledger")
    ap.add_argument("--json", default=None)
    ap.add_argument("--lista-ciclos", default=None, help="grava os cycle_ids das ancoras por graduar (horizonte 300 s)")
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
    sem_numero = [r for r in dec if not isinstance((r.get("returns_bps") or {}).get("last20"), (int, float))]
    dec = [r for r in dec if isinstance((r.get("returns_bps") or {}).get("last20"), (int, float))]
    dec.sort(key=lambda r: ts_ms(r["cycle_id"]))
    if not dec:
        print("sem decisoes com `returns_bps` na janela (o campo e novo: a sessao tem de ser posterior)")
        return 1

    # 1+2: janelas de 300 s que nao se sobrepoem; o sinal e o primeiro tick >= EPS
    pontos, ultima_ancora = [], None
    i = 0
    while i < len(dec):
        t0 = ts_ms(dec[i]["cycle_id"])
        j = i
        while j < len(dec) and ts_ms(dec[j]["cycle_id"]) < t0 + JANELA_MS:
            j += 1
        bloco = dec[i:j]
        i = j
        acima = [r for r in bloco if r["returns_bps"]["last20"] > EPS_BPS]
        abaixo = [r for r in bloco if r["returns_bps"]["last20"] < -EPS_BPS]
        if not acima and not abaixo:
            continue  # sem sinal na janela: nao e episodio
        cand = (acima + abaixo)
        cand.sort(key=lambda r: ts_ms(r["cycle_id"]))
        sig = cand[0]  # o PRIMEIRO tick que passa o EPS, seja de que lado for
        # 5: nao sobrepor rotulos
        if ultima_ancora is not None and ts_ms(sig["cycle_id"]) < ultima_ancora + HORIZONTE_MS:
            continue
        ultima_ancora = ts_ms(sig["cycle_id"])
        contraditorio = bool(acima) and bool(abaixo)
        o = out.get(sig["cycle_id"])
        bps = mov_bps((o or {}).get("mark_then"), (o or {}).get("mark_plus_15m"))
        pontos.append({
            "de": sig["cycle_id"],
            "janela": f"{t0}",
            "n_ticks_janela": len(bloco),
            "last20_bps": sig["returns_bps"]["last20"],
            "sign": "buy" if sig["returns_bps"]["last20"] > 0 else "sell",
            "act": ((sig.get("verdict") or {}).get("act")),
            "conf": ((sig.get("verdict") or {}).get("act_conf")),
            "contraditorio": contraditorio,
            "mov_bps": bps,
            "dir_after": dir_of(bps, CORTE_BPS),
            "graduado": o is not None,
            "horizon_secs": (o or {}).get("horizon_secs"),
        })

    for p in pontos:
        bps = p["mov_bps"]
        if p["contraditorio"] or p["act"] not in ("buy", "sell") or bps is None or abs(bps) < CORTE_BPS:
            p["etiqueta"] = "sem_relacao"
        elif (p["act"] == "sell" and p["dir_after"] == "down") or (p["act"] == "buy" and p["dir_after"] == "up"):
            p["etiqueta"] = "alinhou"
        else:
            p["etiqueta"] = "inverteu"

    print(f"  janela desde {a.fronteira} · {len(dec)} ciclos com `returns_bps`"
          f"{f' (+{len(sem_numero)} sem o campo)' if sem_numero else ''}")
    print(f"  EPISODIOS com sinal (|last20| >= {EPS_BPS:.0f} bps): {len(pontos)}")
    print(f"  graduados {sum(1 for p in pontos if p['graduado'])}/{len(pontos)}"
          f" | horizonte do desfecho: {dict(Counter(p['horizon_secs'] for p in pontos if p['graduado']))}")
    print()
    print(f"  {'ts (t_sig)':22s} {'last20':>8s} {'sign':5s} {'act':5s} {'conf':>5s} {'dir300':7s} {'|mov|':>7s}  {'etiqueta':11s} contraditorio")
    for p in sorted(pontos, key=lambda p: p["de"]):
        mv = f"{p['mov_bps']:.1f}" if p["mov_bps"] is not None else "--"
        print(f"  {p['de']:22s} {p['last20_bps']:8.2f} {p['sign']:5s} {str(p['act']):5s} {str(p['conf']):>5s} "
              f"{str(p['dir_after']):7s} {mv:>7s}  {p['etiqueta']:11s} {p['contraditorio']}")

    et = Counter(p["etiqueta"] for p in pontos)
    eleg = [p for p in pontos if p["etiqueta"] in ("alinhou", "inverteu")]
    sinais = Counter(p["sign"] for p in pontos)
    dirs = Counter(p["dir_after"] for p in pontos if p["graduado"])
    print()
    print("  == CONTAGENS ==")
    print(f"    episodios {len(pontos)} | etiquetas: {dict(et)}")
    print(f"    elegiveis (lado, |mov| >= {CORTE_BPS:.0f} bps, sem contradicao): {len(eleg)}")
    print(f"    sinais: {dict(sinais)}   (os dois sentidos de last20 pedidos: {len([k for k,v in sinais.items() if v>0]) == 2})")
    print(f"    dir_after a 300 s (corte {CORTE_BPS:.0f} bps): {dict(dirs)}")
    for c in DIAG:
        n = sum(1 for p in pontos if p["mov_bps"] is not None and abs(p["mov_bps"]) >= c and not p["contraditorio"] and p["act"] in ("buy", "sell"))
        al = sum(1 for p in pontos if p["mov_bps"] is not None and abs(p["mov_bps"]) >= c and not p["contraditorio"]
                 and ((p["act"] == "sell" and p["dir_after"] == "down") or (p["act"] == "buy" and p["dir_after"] == "up")))
        print(f"    DIAGNOSTICO (nunca promove) corte |mov|>={c:.0f} bps: n={n} alinhou={al}"
              f"{f' = {100*al/n:.0f}%' if n else ''}")

    n, k = len(eleg), sum(1 for p in eleg if p["etiqueta"] == "alinhou")
    print()
    print("  == VEREDICTO (uma leitura) ==")
    if n < MIN_ELEGIVEIS:
        print(f"    INSUFICIENTE: {n} elegiveis < {MIN_ELEGIVEIS} (nao se alonga a sessao para chegar la)")
    else:
        chave = min(TABELA, key=lambda x: abs(x - n))
        minimo = TABELA[chave]
        tempos_sentido = [k for k, v in dirs.items() if k in ("up", "down") and v > 0]
        if len(tempos_sentido) < 2:
            print(f"    AMOSTRA ENVIESADA: um so sentido de preco em toda a sessao ({dict(dirs)}) — nao e PASS")
        elif k >= minimo:
            print(f"    PASS: alinhou {k}/{n} = {100*k/n:.0f}% (minimo para p<0,05 unilateral perto de n={chave}: {minimo})")
        else:
            print(f"    FAIL: alinhou {k}/{n} = {100*k/n:.0f}% — abaixo do minimo {minimo} para n~{chave}")
    print("    (o teste e da REGRA que escrevemos, nao de um modelo; nada aqui e PnL)")

    if a.lista_ciclos:
        faltam = [p["de"] for p in pontos if not p["graduado"]]
        json.dump(faltam, open(a.lista_ciclos, "w"))
        print(f"\n  ancoras por graduar (horizonte 300 s): {len(faltam)} -> {a.lista_ciclos}")
    if a.json:
        json.dump({"fronteira": a.fronteira, "eps_bps": EPS_BPS, "corte_bps": CORTE_BPS,
                   "episodios": len(pontos), "contagens": dict(et), "elegiveis": n, "alinhou": k,
                   "pontos": pontos}, open(a.json, "w"), indent=1)
        print(f"  json: {a.json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
