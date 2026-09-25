# Ensaio suporte/resistência com o `s` a favor

Fonte: hyperliquid-testnet BTC · 5030 barras de 5 min (pedidas 5760 — a fonte dá menos: ~17,5 dias)
Janela: 2026-09-07T13:45:00.000Z → 2026-09-25T00:50:00.000Z · série `1a6a1d833c434c63` · commit `ad5c58d`
L=130 · CHAO=0.25 · TECTO=0.75 · FLAT=10 bps · R1 12/36/72 barras · R2 até a condição acabar

Regra: **na faixa, seguir o `s`** — `u ≤ 0.25` (suporte) com `s = +1` → long; `u ≥ 0.75` (resistência) com `s = −1` → short. Fora disso não há evento.

| quanto dispara | |
|---|---|
| barras na condição long | 123 |
| barras na condição short | 105 |
| **períodos (eventos)** | **36** |
| períodos descartados no warmup | 1 |

| leitura | fechados | long/short | elegíveis | alinhou | inverteu | razão | med long (bps) | med short (bps) | abertos | mínimo k/n | veredicto |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **R1 holding 12 barras** | 34 | 10/17 | 27 | 18 | 9 | 0.667 | -17 | -17.8 | 2 | 19 | **FAIL** |
| **R1 holding 36 barras** | 32 | 10/17 | 27 | 17 | 10 | 0.63 | -29.2 | -21.2 | 4 | 19 | **FAIL** |
| **R1 holding 72 barras** | 31 | 11/18 | 29 | 16 | 13 | 0.552 | -68.7 | -50.2 | 5 | 20 | **FAIL** |
| **R2 ate a condicao acabar** | 36 | 7/11 | 18 | 6 | 12 | 0.333 | -20.5 | 10.7 | 0 | 13 | **FAIL** |

R1 e R2 **não** se somam. Nada aqui é PnL — sem fill, sem taxa, sem signer.
