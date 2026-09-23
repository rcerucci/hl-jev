# V3-0 — as duas fitas no corpus (sonda descartável)

Não é código de produto: não toca no motor, no gate, no policy file nem no ledger.
É a prova do **V3-0** do `VALIDACAO-PNL.md`. Resultados publicados no `PLANO-FUSAO.md` §13.

## A pergunta

Se as marcas vierem de **mainnet** e o estado continuar a vir do **livro de testnet**, o rótulo
(`directional_hit`) significa o que diz? E — a premissa que o `VALIDACAO-PNL.md` assumia — o livro de
testnet está parado, ao ponto de não gerar rótulo nenhum?

## Como corre

```sh
python3 provas/v3-0-duas-fitas/v3-0-duas-fitas.py --out provas/v3-0-duas-fitas/v3-0.json
```

Lê `data/ledger/*.jsonl` (ciclos gravados) e as velas públicas de 1m das duas fitas
(`api.hyperliquid-testnet.xyz/info` e `api.hyperliquid.xyz/info`, `candleSnapshot`). Uma chamada por fita,
o resto é local. Não precisa de chave.

## Medido (23 set 2026, 17:5xZ; ledger com 2903 ciclos em 101 minutos distintos, 15:12Z→17:43Z)

| Medida | Valor |
|---|---|
| Velas de 1m por fita | 152, cobrindo 15:12Z→17:43Z |
| Minutos com as duas fitas e os dois marcos | 86 / 101 |
| **Desacordo de nível** (mesmo instante) | mediana **-165,2 bps** (p0 -187,5 · p100 -124,6): a testnet negoceia ~1,65 % **acima** da mainnet |
| Movimento a 15 min, testnet | mediana -12,8 bps (p0 -45,7 · p100 +25,9) |
| Movimento a 15 min, mainnet | mediana -8,7 bps (p0 -39,7 · p100 +43,8) |
| **Sinal concorda, janelas independentes** (15 min) | **5 / 5** |
| Sinal concorda, todos os minutos (sobrepostos) | 66 / 83 = 79,5 % |
| Minutos com \|mov 15 min\| < 1 bps | testnet **3**, mainnet 5 (de 86) |
| Minutos com \|mov 15 min\| ≥ 10 bps | testnet **63**, mainnet 56 |
| Validação da sonda contra o `mark_then` gravado | 224 outcomes, **diferença máxima 0,0 bps** |

E o que o **próprio ledger** já dizia, sem rede nenhuma (`data/ledger`):

| Medida | Valor |
|---|---|
| `dir_after` nos 224 outcomes | **down em 224/224** (a série de marcas mexeu) |
| \|movimento a 15 min\| gravado | mediana **26,2 bps**, máximo 45,7, **211/224 ≥ 10 bps** |
| `jev_side` nos 224 | `hold` em **224/224** → `directional_hit` `null` por construção |
| `act_conf` nas decisões válidas | mediana 0,50 · máximo 0,91 · **225** de 2923 ≥ 0,80 |
| `too_hostile` | mediana 0,52 · **1995** de 2923 ≥ 0,50 |
| Actos | `hold` em **2923/2923** |

## O que isto decide

1. **"O testnet parado" está falsificado.** 211 dos 224 outcomes têm movimento ≥ 10 bps nos 15 min
   seguintes; na sonda, 63 de 86 minutos. Não é um livro morto — é um livro que anda.
2. **Os 224 `directional_hit: null` vêm do `jev_side: hold`**, não da fita: um hold não tem lado para
   graduar. É um facto de **política**, não de venue.
3. **As fitas não são a mesma fita em nível** (~1,65 % de desvio sistemático) — mas **não divergiram em
   sinal** nas 5 janelas independentes que cabem na janela (amostra pequena: não demonstra equivalência,
   também não mostra inversão de rótulo).
4. Logo, o desenho misto (marcas de mainnet + execução/estado de testnet) **não é preciso** — era a
   resposta a uma premissa que a medição derrubou. Marcar no **mesmo livro** do estado evita o desvio de
   nível sem perder nada. O que trava a V3 viva não é a fita: é a política nunca escolher lado.

## Notas de método (defeitos meus, corrigidos)

- A primeira versão agrupava por **instante exacto** e chamava-lhe "minutos distintos" (dizia 2866 minutos
  onde havia 101).
- A concordância de sinal estava calculada só sobre janelas de 15 min **sobrepostas**: com passos de 1 min,
  janelas vizinhas partilham 14 min e inflacionam a contagem. Passou a haver as duas leituras.
- `direction` e `gate` não existem nas linhas do ledger: os campos são `dir_after` e — no `verdict` — **não
  há campo de gate nenhum** (o gate que disparou só vive no SSE, não no ficheiro). Lido no sítio certo; a
  ausência do gate no ledger é um achado à parte, não um erro de leitura.
- A validação contra o `mark_then` gravado (0,0 bps de diferença em 224/224) mostra que a sonda reconstrói
  exactamente as marcas que o `marks_source` usou.
