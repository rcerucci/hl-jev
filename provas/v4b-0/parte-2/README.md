# V4b-0 parte 2 — a Laya nos mesmos estados

| ficheiro | o que é |
|---|---|
| `PLANO.md` | o plano, fixado **antes** de baixar pesos (checkpoint, caminho, censo, regras da 2b, limites) |
| `censo-laya.mjs` | o censo (aceita `LAYA_MODEL_DIR` para apontar a um bundle exportado) |
| `censo-laya.json` | censo **2a** — inglês publicado |
| `censo-2b.json` | censo **2b** — `typed-decisions` exportado, mesmo snapshot |
| `exportar-2b.sh` | o export da 2b (uv + torch CPU + `export/export_onnx.py`) |

Resultados no `PLANO-FUSAO.md` §15 (2a) e §16 (2b — recusa).

## 2b — `typed-decisions` (export próprio): **recusa declarada**

O export corre bem e é fiel: `max |dlogits| = 1,16e-06`, `max |dact| = 0,0` contra a referência PyTorch,
bundle de 1,6 GB em 2 min 30 s. O que recusa é o **uso**, pelas regras fixadas antes.

| | 2a inglês | **2b `typed-decisions`** |
|---|---|---|
| `act` por ciclo | `buy` 2530 · `hold` 614 | **`buy` 3142 · `hold` 2** |
| `conf` min–max | 0,381 – 0,501 | **0,370 – 0,432** |
| `noul` min–max | 0,816 – 0,944 | **0,349 – 0,645** |
| `noul` ≥ 0,65 | 3144/3144 | **0/3144** |
| par neutro A/B | A 3144 | **A 2970 · B 174** |
| p95 por estado | 2119 ms | **2102 ms** |

- **Regra 1** (mesmo snapshot de 3144 / 44 estados): cumprida — o JSON da 2a não foi tocado.
- **Regra 2** (sem baixar o θ): cumprida — `conf` máximo 0,432 < 0,80, a coluna §9.4 continua **zero**.
- **Regra 3** (recusa): **accionada** — p95 **2102 ms ≥ 2 s** → **não nasce `laya.ts`**; Laya fica hipótese de
  paper, não caminho do motor.

E o achado que sobrevive à recusa: nos **dois** checkpoints, o `noul` médio é **mais baixo** com `bot_war` do
que sem ele (2a 0,861 vs 0,881; 2b 0,467 vs 0,504) — a primitiva não lê o critério que lhe demos, mexe ao
contrário. A saturação tem dois sentidos (2a prende no alto, 2b em baixo) e nenhum serve.

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
