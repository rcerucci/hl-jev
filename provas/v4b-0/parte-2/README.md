# V4b-0 parte 2 — a Laya nos mesmos estados

| ficheiro | o que é |
|---|---|
| `PLANO.md` | o plano, fixado **antes** de baixar pesos (checkpoint, caminho, censo, limites) |
| `censo-laya.mjs` | o censo |
| `censo-laya.json` | o resultado (snapshot: as primeiras 3144 decisões válidas do ledger) |

Resultados no `PLANO-FUSAO.md` §15.

## Como se reproduz

```sh
# 1. Pasta de trabalho FORA do repo — nada do manifesto do projecto é tocado.
npm i @receptron/laya            # traz onnxruntime-node + tokenizer; ~552 MB

# 2. Pesos: o downloader do próprio cliente faz ~0,85 MB/s (47 MB em 55 s ⇒ ~33 min para 1689 MB).
#    Em 4 fatias paralelas (o servidor aceita accept-ranges) foram 38 s: ~10× mais rápido.
#    Destino: ~/.cache/receptron-laya/receptron--laya-onnx/main/ (laya.onnx, laya.onnx.data,
#    laya_config.json, tokenizer/*). O cliente confere o tamanho em bytes e salta o que já lá está.

# 3. Censo (corre da pasta de trabalho, que tem o node_modules):
node censo-laya.mjs <repo>/data/ledger censo-laya.json 3144
```

## Resultado (23 set 2026) — **pré-ensaio**, checkpoint inglês publicado

| medida | valor |
|---|---|
| carga do modelo | 4,6 s |
| memória do processo (pico) | **1,81 GB** (RSS) |
| censo completo | 1 min 31 s |
| latência por estado (3 perguntas) | p50 1943 ms · **p95 2119 ms** · máx 2210 ms |
| `act` por ciclo | **`buy` 2530** (80 %) · `hold` 614 |
| `act` por estado | `buy` 37/44 · `hold` 7/44 |
| confiança do acto | 0,381 – **0,501** |
| `noul` | **0,816 – 0,944 em 44/44** |
| par neutro (`choice` A/B) | **A (=sim) em 44/44** |

Três frases que resumem: a Laya **escolhe lado** (o Jev não escolhia), mas a **0,50** de confiança — com o
θ=0,80 da tabela dá `n_lados = 0`; o `noul` está **pinado no alto** e a tradução para `choice` com rótulos
neutros **não** o destrava (logo não é o par de rótulos); e a **latência (p95 2,1 s)** tira-lhe o argumento
de velocidade neste host.

## Dois limites que são parte do resultado

- É o checkpoint **inglês** — não é o `typed-decisions` que o doc manda para o vivo. A coluna Laya da tabela
  §9.4 só recebe a 2b (export próprio: `export/export_onnx.py`, `uv` + torch + onnxscript).
- O estado do corpus é homogéneo (`move` = `extreme` em 44/44, `tape-2` = `flat` em 44/44): parte da
  insensibilidade medida pode ser do corpus, não do modelo. O que é do modelo: `buy` em estados `dump` e
  `dumping`, com a mesma confiança dos restantes.
