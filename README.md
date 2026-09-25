# Hyperliquid Sigma

Perp na **Hyperliquid**. Um modo de operação: `POLICY=sigma`.
(O repositório no git não se renomeia.)

## O que é

- Perp, relógio **H1**. A decisão de inventário só nasce no **fecho de uma H1 nova**:
  `s = sign(hl2 − EMA24)` da vela fechada, com a EMA calculada sobre as barras **anteriores** a essa.
  Entre fechos não há ordem nova nem re-cotação — o portão segura.
- **Veto de pavio**: se o `s` quer virar e só o wick cruzou a EMA, a vela é ignorada e o `s` mantém-se.
- **Circuit breaker de chop**: 3 viradas em 12 h armam 6 h de `caixa`; ao expirar, vale o `s` vigente.
- **Execução**: a entrada é um **ALO no touch** (compra no best bid, venda no best ask); o que não
  encher em **8 s** vai numa única Ioc a mercado. A saída (`caixa` / `cb_chop`) é Ioc taker
  reduce-only da posição inteira, sem espera.

**Tamanho**

O processo **não** abre posição no `start`. Espera o primeiro fecho H1 com `s ≠ 0`.

Nessa primeira abertura, e em **cada** fecho ou virada a seguir:

`notional = equity da sleeve × LEVERAGE` (hoje 1×).

Não há tamanho de arranque à parte. `QUOTE_USD` não dimensiona o sigma.

Se o venue ainda não deu equity (dry run), a régua é `BANKROLL_USD` do config. No live, é a equity real da sleeve. O notional da linha de comando não existe — não se passa tamanho no `bun run start`.

## Arrancar, parar, ler

```bash
# arrancar (dry run, sem signer) e guardar o PID para poder parar depois
POLICY=sigma DRY_RUN=true HL_COINS=BTC LEVERAGE=1 bun run start & echo $! > /tmp/sigma.pid

# parar: por PID, nunca por padrão (um pkill -f mata o próprio shell)
kill "$(cat /tmp/sigma.pid)"

# o relatório do fill, lido do ledger
bun run src/tools/relatorio-fill.ts
```

`bun run dev` é o mesmo motor com `--watch`. `bun test` corre a suíte.

## Laboratório

`POLICY=jev`, `dumb`, `numeric` e `stance` existem para comparar políticas no mesmo ledger — **não**
são o motor desta conta e não têm receita aqui.

## Painel

`web/` é o painel Next (desk) e **não** sobe com o `start`: use `bun run dev:web`.

Ensaios antigos: archive/. Não implementar.

## Licença

MIT. Copyright 2026 aowang. Inclui código MIT publicado originalmente como jev-trader por Jarrod Watts.
