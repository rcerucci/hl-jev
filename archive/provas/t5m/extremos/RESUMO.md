# Ensaio dos extremos — short no tecto, long no chão (horizonte fixo)

Fonte: hyperliquid-testnet BTC · 5030 barras de 5 min (pedidas 5760, TRUNCADA)
Janela: 2026-09-07T13:45:00.000Z → 2026-09-25T00:50:00.000Z
L=130 · CHAO=0.15 · TECTO=0.85 · FLAT=10 bps · horizontes 12/36/72 barras · serie `1a6a1d833c434c63` · commit `76a743b`

Visita = uma linha (t_in = primeira barra da visita). Zero produto, zero sessão, zero Pine.

## H12 (1 h)

| leitura | fechados | chao/tecto | elegíveis | alinhou | inverteu | razão | med chao (bps) | med tecto (bps) | abertos | mínimo k/n | veredicto |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **E0** (todos) | 166 | 65/101 | 126 | 59 | 67 | 0.468 | 17.7 | 16.1 | 1 | 73 | **FAIL** |
| **E1** (s a favor) | 15 | 7/8 | 10 | 5 | 5 | 0.500 | -13.9 | -14.7 | 1 | — | **insuficiente** |
| **E2** (s contra) | 151 | 58/93 | 116 | 54 | 62 | 0.466 | 18 | 16.3 | 0 | 68 | **FAIL** |

E1 vs E0: razão 0.500 vs 0.468 · n_E1=10 → não se declara melhor

## H36 (3 h)

| leitura | fechados | chao/tecto | elegíveis | alinhou | inverteu | razão | med chao (bps) | med tecto (bps) | abertos | mínimo k/n | veredicto |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **E0** (todos) | 165 | 65/100 | 136 | 68 | 68 | 0.500 | 17 | 17.1 | 2 | 79 | **FAIL** |
| **E1** (s a favor) | 14 | 7/7 | 12 | 8 | 4 | 0.667 | -15.1 | -55.2 | 2 | 10 | **FAIL** |
| **E2** (s contra) | 151 | 58/93 | 124 | 60 | 64 | 0.484 | 20.8 | 18.6 | 0 | 72 | **FAIL** |

E1 vs E0: razão 0.667 vs 0.500 · n_E1=12 → **E1 melhor que E0**

## H72 (6 h)

| leitura | fechados | chao/tecto | elegíveis | alinhou | inverteu | razão | med chao (bps) | med tecto (bps) | abertos | mínimo k/n | veredicto |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **E0** (todos) | 165 | 65/100 | 150 | 63 | 87 | 0.420 | -13.7 | 27.6 | 2 | 86 | **FAIL** |
| **E1** (s a favor) | 14 | 7/7 | 14 | 7 | 7 | 0.500 | -35.9 | -38.7 | 2 | 11 | **FAIL** |
| **E2** (s contra) | 151 | 58/93 | 136 | 56 | 80 | 0.412 | -10.7 | 32.9 | 0 | 79 | **FAIL** |

E1 vs E0: razão 0.500 vs 0.420 · n_E1=14 → **E1 melhor que E0**

Não se somam horizontes. `s=0` entra em E0 e em nenhum dos outros. Sem estadia flip→flip, sem piso de 6 h.
