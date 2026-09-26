# `tv/` — o espelho do motor no TradingView

`sigma.pine` é o script que dá, no TV, **o mesmo `s` que o motor calcula**. Não é uma variante nem uma
aproximação: é para o número bater, e é isso que se verifica.

## O que ele calcula (a regra do motor)

- `s = sign(hl2 − EMA24(hl2))` da **H1 já fechada**, com a EMA sobre as barras **anteriores** a essa
  (`src/policy/sigma.ts:140-157`);
- **veto de pavio** (F2): se o `s` quer virar e só o `hl2` cruzou a EMA — o `close` ficou no lado velho — a
  barra é ignorada e o `s` mantém-se;
- **relógio** (F4): decide **uma vez por fecho de H1** e mantém o `s` no resto da hora;
- **caixa do CB de chop** (F3): N viradas em 12 h armam 6 h de `caixa` (a caixa **não** muda o `s`, muda o que
  o motor faz com ele).

## Como usar

1. TradingView → *Pine Editor* → colar `tv/sigma.pine` → *Add to chart*.
2. **H1** é o gráfico natural; funciona também em 5m/15m/30m (a decisão continua a nascer no fecho da H1).
3. Inputs: `EMA (barras H1)` = 24; a caixa do CB ligada, com `cbFlips = 4` (**valor da conta de teste**; o
   default do repo é 3 — issue #37); rótulos ligados.

O que aparece: o `s` vigente em degrau, triângulos **só** na barra em que uma H1 fechou, uma cruz laranja onde
houve veto de pavio, fundo cinza enquanto a caixa do CB está armada. Na janela de dados: a EMA, o delta, o
`hl2` e o `close` da H1 lida, o candidato (antes do veto/CB), o `s` do close e o contador do CB.

## Como conferir contra o motor (1 minuto)

No ledger, a linha do ciclo do fecho (a **primeira** linha depois da hora cheia, ex. `12:00:01Z`) traz `s` e
`ema_h1`. Compare com o que o script mostra. Vectores do dia 26 set 2026 (SOL, H1), já conferidos:

| H1 lida | `s` do motor | `ema_h1` |
|---|---|---|
| t = 10:00Z | −1 | 120,3230947784 |
| t = 11:00Z | +1 | 120,3216471962 |

O `s` compara-se **exacto**; a EMA até ~5 casas decimais (a semente impõe uma diferença medida de ~7e-8).
**Se a EMA mostrada for a do fecho anterior, há uma barra de atraso** — nesse caso o script precisa de um
deslocamento, e é isso que este teste existe para apanhar.

## Limites declarados

- **Semente da EMA** — o motor usa a SMA das primeiras 24 barras da janela de 7 dias que carrega ao arranque; o
  TV usa a semente dele, sobre um histórico muito maior. Medido nas velas H1 reais de 30 dias: a diferença entre
  as duas convenções é ≤ 1,6e-5 (SOL) e 4,0e-3 (BTC), enquanto o **menor** `|hl2 − EMA|` em 697 barras é 0,018
  (SOL) e 0,38 (BTC). A semente **não** pode virar um lado.
- **Arranque** — `sVigente` começa em 0, logo a primeira H1 fechada depois de carregar o script não tem veto.
  É o mesmo buraco que o motor tem ao arrancar (issue #51), reproduzido de propósito.
- **Não há compilador de Pine aqui** — a semântica do TV (quando a `request.security` entrega a última H1
  fechada) é assumida pela documentação; o teste dos vectores acima apanha uma eventual barra de atraso.

## Como a fidelidade foi provada

A lógica do script foi reimplementada numa segunda linguagem (Python) e confrontada **barra a barra** com o
módulo do motor — **2860 comparações, 0 divergências** — sobre 30 dias de velas H1 reais de SOL e BTC, mais uma
série sintética que força o CB, nas duas constantes (3 e 4). Se se mexer no `sigma.pine`, repetir esse confronto
antes de confiar nele.
