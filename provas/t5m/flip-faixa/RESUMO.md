# Ensaio flip-na-faixa — entrada só no flip dentro da faixa do extremo

Fonte: hyperliquid-testnet BTC · 5030 barras de 5 min (pedidas 5760 — a fonte dá menos: ~17,5 dias)
Janela: 2026-09-07T13:45:00.000Z → 2026-09-25T00:50:00.000Z · série `1a6a1d833c434c63` · commit `ad6e719`
L=130 · CHAO=0.25 · TECTO=0.75 · FLAT=10 bps · R1 12/36/72 barras · R2 até o próximo flip

Regra de entrada: **flip de `s` na faixa** — `u ≤ 0.25` e flip para `+1` → long; `u ≥ 0.75` e flip para `−1` → short. Toque no extremo **sem** flip não é evento; flip no meio do canal não é evento.

| contagem | |
|---|---|
| flips totais de `s` | 101 |
| flips **na faixa** (eventos) | 7 |
| flips no meio (descartados) | 94 |
| % na faixa | **6.9 %** |

| leitura | fechados | long/short | elegíveis | alinhou | inverteu | razão | med long (bps) | med short (bps) | abertos | mínimo k/n | veredicto |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **R1 holding 12 barras** | 5 | 2/2 | 4 | 2 | 2 | 0.5 | -50.6 | -18.9 | 2 | — | **insuficiente** |
| **R1 holding 36 barras** | 5 | 2/2 | 4 | 2 | 2 | 0.5 | -29.2 | -21.2 | 2 | — | **insuficiente** |
| **R1 holding 72 barras** | 5 | 2/3 | 5 | 2 | 3 | 0.4 | -53.1 | -16.1 | 2 | — | **insuficiente** |
| **R2 ate ao proximo flip de s** | 7 | 1/3 | 4 | 0 | 4 | 0 | -28.9 | 11.3 | 0 | — | **insuficiente** |

R1 e R2 **não** se somam: são dois rótulos sobre os mesmos eventos. Nada aqui é PnL — sem fill, sem taxa, sem signer.
