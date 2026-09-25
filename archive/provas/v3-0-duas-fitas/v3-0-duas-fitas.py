#!/usr/bin/env python3
"""
V3-0 do VALIDACAO-PNL.md: as duas fitas, no corpus que ja existe.

Sonda descartavel, **nao e codigo de produto**: nao toca no motor, no gate, no
policy file nem no ledger. Le os ciclos gravados e as velas publicas de 1m das
duas fitas (testnet e mainnet) e mede quanto discordam.

A pergunta: se as marcas vierem de mainnet e o estado continuar a vir do livro de
testnet, o rotulo (`directional_hit`) significa o que diz?

Correccoes em relacao a primeira versao (defeitos meus):
- agregacao por MINUTO (a versao anterior agrupava por instante exacto e chamava-lhe
  "minutos distintos");
- a concordancia de sinal e calculada tambem em janelas de 15 min NAO sobrepostas:
  com passos de 1 min as janelas de 15 min partilham 14 min entre si e inflacionam
  a contagem;
- amostra de mids crus impressa, para o desacordo de nivel poder ser conferido a mao.

Uso: python3 v3-0-duas-fitas.py [--out v3-0.json]
"""
import argparse
import datetime
import glob
import json
import statistics
import sys
import urllib.request
from collections import defaultdict

INFO = {
    "testnet": "https://api.hyperliquid-testnet.xyz/info",
    "mainnet": "https://api.hyperliquid.xyz/info",
}
COIN = "BTC"
MIN_MS = 60_000
HORIZON_MS = 15 * MIN_MS


def post(url: str, payload: dict):
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def candles(venue: str, start_ms: int, end_ms: int) -> dict:
    data = post(
        INFO[venue],
        {"type": "candleSnapshot", "req": {"coin": COIN, "interval": "1m", "startTime": start_ms, "endTime": end_ms}},
    )
    out = {}
    for c in data:
        t = int(c["t"]) if isinstance(c, dict) else int(c[0])
        out[t] = c
    return out


def campo(c, nome: str, i: int) -> float:
    return float(c[nome] if isinstance(c, dict) else c[i])


def fecho(cs: dict, ms: int):
    base = ms - (ms % MIN_MS)
    c = cs.get(base)
    return None if c is None else campo(c, "c", 4)


def cid_ms(cid: str) -> int:
    d = cid.split("-")[0]
    dt = datetime.datetime.strptime(d, "%Y%m%dT%H%M%SZ").replace(tzinfo=datetime.timezone.utc)
    return int(dt.timestamp() * 1000)


def hhmm(ms: int) -> str:
    return datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).strftime("%H:%M")


def quantis(xs, qs=(0, 25, 50, 75, 90, 100)):
    if not xs:
        return {}
    s = sorted(xs)
    return {f"p{q}": s[min(len(s) - 1, max(0, round((q / 100) * (len(s) - 1))))] for q in qs}


def bps(a: float, b: float) -> float:
    return ((b - a) / a) * 1e4


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ledger", default="data/ledger")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    rows = []
    for f in sorted(glob.glob(f"{args.ledger}/*.jsonl")):
        with open(f) as fh:
            rows += [json.loads(l) for l in fh if l.strip()]
    dec = [r for r in rows if r.get("kind") == "decision"]
    outs = [r for r in rows if r.get("kind") == "outcome"]
    if not dec:
        print("sem decisoes no ledger")
        return 1

    # agregacao por MINUTO (nao por instante)
    ciclos_por_minuto: dict = defaultdict(int)
    estados_por_minuto: dict = {}
    for r in dec:
        t = cid_ms(r["cycle_id"]) - (cid_ms(r["cycle_id"]) % MIN_MS)
        ciclos_por_minuto[t] += 1
        estados_por_minuto.setdefault(t, r.get("state"))
    ms = sorted(ciclos_por_minuto)
    t0, t1 = ms[0], ms[-1]
    print(f"ciclos: {len(dec)} em {len(ms)} minutos distintos")
    print(f"janela: {hhmm(t0)}Z -> {hhmm(t1)}Z")

    cs = {v: candles(v, t0, t1 + HORIZON_MS + MIN_MS) for v in INFO}
    for v, d in cs.items():
        ks = sorted(d)
        print(f"  velas {v}: {len(d)} (1m) | de {hhmm(ks[0])}Z a {hhmm(ks[-1])}Z")

    pares = []
    for t in ms:
        tn, mn = fecho(cs["testnet"], t), fecho(cs["mainnet"], t)
        tn15, mn15 = fecho(cs["testnet"], t + HORIZON_MS), fecho(cs["mainnet"], t + HORIZON_MS)
        if None in (tn, mn, tn15, mn15):
            continue
        pares.append(
            {
                "t": t,
                "ciclos": ciclos_por_minuto[t],
                "estado": estados_por_minuto.get(t),
                "testnet": tn,
                "mainnet": mn,
                "desacordo_nivel_bps": bps(tn, mn),
                "mov15_testnet_bps": bps(tn, tn15),
                "mov15_mainnet_bps": bps(mn, mn15),
            }
        )
    print(f"minutos com as duas fitas e os dois marcos: {len(pares)}/{len(ms)}")

    print("\n  amostra crua (conferir a mao):")
    for p in pares[:: max(1, len(pares) // 5)][:5]:
        print(
            f"   {hhmm(p['t'])}Z  testnet {p['testnet']:.1f}  mainnet {p['mainnet']:.1f}"
            f"  delta {p['desacordo_nivel_bps']:+.1f} bps"
            f"  | mov15 tn {p['mov15_testnet_bps']:+.1f} mn {p['mov15_mainnet_bps']:+.1f} bps"
        )

    desv = [p["desacordo_nivel_bps"] for p in pares]
    r_tn = [p["mov15_testnet_bps"] for p in pares]
    r_mn = [p["mov15_mainnet_bps"] for p in pares]

    # concordancia de sinal: TODOS os minutos (sobrepostas) e so as janelas
    # nao sobrepostas (t multiplo de 15 min), que sao as independentes.
    def concordancia(ps):
        c = sum(1 for p in ps if p["mov15_testnet_bps"] * p["mov15_mainnet_bps"] > 0)
        n = sum(1 for p in ps if p["mov15_testnet_bps"] != 0 and p["mov15_mainnet_bps"] != 0)
        return c, n

    c_todos, n_todos = concordancia(pares)
    nao_sobrepostas = [p for p in pares if (p["t"] % HORIZON_MS) == 0]
    c_ind, n_ind = concordancia(nao_sobrepostas)

    mortas_tn = sum(1 for x in r_tn if abs(x) < 1)
    mortas_mn = sum(1 for x in r_mn if abs(x) < 1)
    grandes_mn = sum(1 for x in r_mn if abs(x) >= 10)
    grandes_tn = sum(1 for x in r_tn if abs(x) >= 10)

    # validacao da sonda contra o `mark_then` gravado (fita de testnet)
    por_min = {p["t"]: p for p in pares}
    difs = []
    for o in outs:
        t = cid_ms(o["cycle_id"]) - (cid_ms(o["cycle_id"]) % MIN_MS)
        p = por_min.get(t)
        if p and isinstance(o.get("mark_then"), (int, float)):
            difs.append(abs(p["testnet"] - o["mark_then"]))

    rel = {
        "ciclos": len(dec),
        "minutos": len(ms),
        "minutos_completos": len(pares),
        "janela": {"de": hhmm(t0) + "Z", "ate": hhmm(t1) + "Z"},
        "desacordo_nivel_bps": quantis(desv),
        "mov15_testnet_bps": quantis(r_tn),
        "mov15_mainnet_bps": quantis(r_mn),
        "sinal_concorda_todos_minutos": {"n": c_todos, "de": n_todos, "pct": round(100 * c_todos / n_todos, 1) if n_todos else None},
        "sinal_concorda_janelas_independentes": {
            "n": c_ind,
            "de": n_ind,
            "pct": round(100 * c_ind / n_ind, 1) if n_ind else None,
        },
        "movimento_abaixo_1bps": {"testnet": mortas_tn, "mainnet": mortas_mn, "total": len(pares)},
        "movimento_10bps_ou_mais": {"testnet": grandes_tn, "mainnet": grandes_mn},
        "validacao_mark_then": {"n": len(difs), "max_abs": max(difs) if difs else None},
        "pares": pares,
    }
    print(f"\n  desacordo de NIVEL (mesmo instante): {rel['desacordo_nivel_bps']}")
    print(f"  mov 15 min testnet: {rel['mov15_testnet_bps']}")
    print(f"  mov 15 min mainnet: {rel['mov15_mainnet_bps']}")
    print(f"  sinal concorda (todos os minutos, sobrepostas): {c_todos}/{n_todos} = {rel['sinal_concorda_todos_minutos']['pct']}%")
    print(f"  sinal concorda (janelas independentes de 15 min): {c_ind}/{n_ind} = {rel['sinal_concorda_janelas_independentes']['pct']}%")
    print(f"  |mov15| < 1 bps: testnet {mortas_tn}, mainnet {mortas_mn} (de {len(pares)})")
    print(f"  |mov15| >= 10 bps: testnet {grandes_tn}, mainnet {grandes_mn}")
    print(f"  validacao contra mark_then gravado: {len(difs)} outcomes, maior diferenca {rel['validacao_mark_then']['max_abs']}")
    if args.out:
        with open(args.out, "w") as fh:
            json.dump(rel, fh, indent=1)
        print(f"  json: {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
