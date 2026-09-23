# INTEGRATION.md — mapa verificado do executor existente

Alvo: `https://github.com/aowang-ai/jev-trade`
Baseline: `main` = `a3f2f834a1b97dd42fab1193814179ac2e96d7cd` (21 set 2026 22:19 +0800, "feat: Show closed lots as a position history on the desk.")
Leitura: 23 set 2026, clone limpo (não o working tree local). Branch de trabalho: `fusao/policy-risk-venue`.
Alarme do mapa: `test/integration-map.test.ts` (corre no `bun test`, logo no CI de `.github/workflows/test.yml`).

Este ficheiro responde à checklist obrigatória da secção 2.1 da spec. **Nada aqui foi adivinhado:** cada linha
tem o comando que a sustenta. Factos presos a linha estão ancorados ao SHA acima e leem-se com
`git show a3f2f834a1b97dd42fab1193814179ac2e96d7cd:<arquivo>`.

## Como se coloca uma ordem — o caminho único

```
trader.onBlock(block)            src/trader.ts:56
  → model.decide(state)          src/trader.ts:80
  → planQuote({intent, bias, …}) src/trader.ts:83   src/plan.ts:45
  → enqueueQuote(...)            src/trader.ts:91 → :110
      → market.setLeverage(...)  src/trader.ts:117  src/market.ts:166   (só quando !plan.taker)
      → market.send(side, size, book, cancel, reduceOnly, taker)
                                 src/trader.ts:121  src/market.ts:181
          → sendTaker (Ioc)      src/market.ts:215   |  sendMaker (Alo)  src/market.ts:248
  → enqueueStandDown()           src/trader.ts:92 → :128 → market.cancelResting()  src/market.ts:298
```

`trader.ts` é o **único** sítio que chama `market.send` — confirmado por varredura de todo o `src/`
(`grep -rn "this.market.send(" src/` devolve uma linha) e pelo teste do alarme.

| Pergunta da spec | Onde está | Conferido com |
|---|---|---|
| Submit | `market.send` — `src/market.ts:181`, chamado em `src/trader.ts:121` | leitura + `grep -rn` |
| Assinatura de `send` | `send(side, sizeSz, book, cancel, reduceOnly=false, taker=false): Promise<Quote>` | leitura |
| Testnet vs mainnet | `HL_TESTNET` em `src/config.ts:38`; `HttpTransport({isTestnet})` em `src/market.ts:54` | leitura |
| Chave / signer | `privateKeyToAccount(sleeve.privateKey)` → `ExchangeClient({transport, wallet})` `src/market.ts:53,56` | leitura |
| Chaves por sleeve | `PRIVATE_KEY` (1.º coin) + `WALLETS_JSON` / `.wallets.json` — `src/sleeves.ts:54,68-71` | leitura |
| Tipos de ordem | open = Alo (`taker:false`, `src/plan.ts:52-55`); close = Ioc reduce-only (`taker:true`, `src/plan.ts:58-59`); TIF literais só `"Alo" \| "Ioc"` (`src/market.ts:204`) | leitura |
| Livro / mid / mark / funding | `src/book.ts`, `src/feed.ts` (WS l2Book, trades, candle, activeAssetCtx), `src/account.ts` | leitura |
| Cancelar / recover de WS | `market.cancelResting()`; `feed.onGone` → `forgetResting()` `src/market.ts:79-81`; `clearOpen()` no arranque `src/market.ts:98` | leitura |
| Dry-run | `DRY_RUN=true` **ou** sleeve sem chave → `wallet = null` (não constrói `ExchangeClient`) `src/market.ts:53`; `MODEL=mock` default `src/config.ts:58` | leitura |
| Multi-asset | `HL_COINS` default `BTC,ETH,SOL,DOGE,BNB`, uma carteira por coin `src/sleeves.ts:63` | leitura |
| Logger de fills | `src/trades.ts` + `GET /history` (`src/server.ts:86`, em memória, `historySize: 1000`) | leitura |

## Não verificado (declarado, não preenchido a palpite)

- **Nonce**: tratado *dentro* de `@nktkas/hyperliquid` (`ExchangeClient`). Não há nonce próprio no repo. A spec
  manda não reimplementar — verificado que não há o que reimplementar.
- **Agent wallet**: **não existe no repo.** Não há `approveAgent`, não há par (agent, conta). Ver achado A2 abaixo.
- **Fill live em testnet**: não corri nenhuma ordem. O repo declara testnet verde; isso é afirmação do README,
  não medição minha. A Fase A/B tem de o reproduzir antes de contar com ele.

## Invariantes do patch (secção 2.2) — cobertos pelo alarme

1. Nenhuma chave no state, no ledger, em log ou em fixture → teste *"nenhuma chave aparece em linha de log"*
   + *".wallets.json continua fora do git"*.
2. O signer continua a ser a chave por sleeve que o executor já usa → não se toca em `src/market.ts:53`.
3. `HL_TESTNET=true` é default; mainnet exige dois flags → teste de defaults (`LIVE` ainda **não existe**, ver A3).
4. Falha do Jev → `hold` → teste dos gates do RISK na Fase A/B (ver A5 para o que existe hoje).
5. A noite escreve em `proposals/` e para → nenhum cron chama `accept`.
6. Log append-only com duas escritas por `cycle_id` (`decision` / `outcome`).

## Baseline congelado (o que a fusão altera de propósito)

Estes factos são verdadeiros **no SHA acima** e mudam com o patch; ficam aqui para a revisão poder comparar:

| Hoje | Onde | Vai virar |
|---|---|---|
| `jevQuestions()` devolve 3 choices (`bias` long/short, `intent` open/close/hold, `leverage` em rungs) | `src/model.ts:120-193` | 1 `choice` buy\|sell\|hold + 1 `noul` |
| Perguntas **dinâmicas**: interpolam `stance`, `tickMs`, `rungs` e ramificam flat vs não-flat | `src/model.ts:120-193` | policy file versionado — exige regra de placeholders (ver A6) |
| `MODEL=mock` decide sobre **números** (`returnsBps.last20`, `bookImbalance`, `cvd`) | `src/model.ts:376-377` | o controle `POLICY=dumb` decide sobre **adjectivos** (não é o mesmo objeto: A4) |
| Deadline do Jev = `JEV_DEADLINE_MS = 4000` (constante, não env) | `src/model.ts:314` | `JEV_TIMEOUT_MS=800` |
| `leverage` vem **do modelo** e é escrito na exchange | `src/trader.ts:117` | vem do config; o campo do modelo é ignorado na v1 |
| Falha/timeout do Jev → `markLate` (bloco sem decisão), **sem** `stand-down`; 402/créditos pausa 30 s | `src/trader.ts:14,93-102` | falha → `hold` (e decidir se cancela a resting — A5) |
| Não há `noul`, nem limiar de confiança, nem policy file | `src/model.ts` (o SDK 0.6.0 **tem** `noul`) | camada RISK nova |
| Não há ledger de outcome (+15 min); `/history` é memória | `src/server.ts:86`, `src/config.ts:64` | `src/ledger/jsonl.ts` + `src/night/*` |
| `TICK_MS=2000` — e o repo trata "Jev decide **a cada** tick" como não-negociável | `src/config.ts:44`, `CLAUDE.md`, `README.md:6,28` | a spec propõe `CYCLE_SECS=15` → contradição de contrato (A1) |

## Achados da leitura (numerados como no PLANO-FUSAO.md)

- **A1** Cadência: `TICK_MS=2000` hoje; a spec propõe 15 s, contra o não-negociável declarado no `CLAUDE.md`
  ("a Jev decision every tick, not every N ticks") e a linha 6 do `README.md`.
- **A2** "Agent wallet" da spec §2.2.2 **não existe**: o executor assina com a chave EOA da sleeve.
- **A3** `HL_ACCOUNT_ADDRESS`, `HL_AGENT_PRIVATE_KEY`, `LIVE`, `MAX_LIVE_EQUITY_USD`, `JEV_TIMEOUT_MS` não
  existem no repo; o endereço é derivado da chave. Mapa de nomes em A3 do plano.
- **A4** O controle `POLICY=dumb` não pode ser o `MockModel` (entrada numérica ≠ entrada em adjectivos).
- **A5** Hoje uma falha do Jev **não** produz `hold`: produz bloco "late" e não mexe na book.
- **A6** As perguntas de hoje são dinâmicas; um JSON estático perde `stance`/`tickMs`/`rungs`.
- **A7** O tipo `Intent` **já existe** (`src/types.ts`, importado em `src/plan.ts:1`) com outro significado.
- **A8** A decisão flui para o desk: `ModelDecision` → `BlockEvent.decision` (`src/trader.ts:295-306`) → SSE
  → `web/src/lib/bot-types.ts`, que o `CLAUDE.md` manda manter **idêntico** ao `src/types.ts`.
- **A9** §8 da spec está em Python (`risk/buckets.py`, `python -m night.propose`, `tests/test_*.py`) num repo
  Bun/TypeScript que proíbe segundo runtime para trabalho novo (`CLAUDE.md`).

## Comandos usados (reprodutíveis)

```bash
git clone https://github.com/aowang-ai/jev-trade.git jev-trade-fusao && cd jev-trade-fusao
git checkout main && git log -1 --oneline
grep -nE "async (send|cancelResting|setLeverage)" src/market.ts
grep -rn "this.market.send(" src/
grep -nE "planQuote|enqueueQuote|enqueueStandDown|setLeverage" src/trader.ts
grep -nE "HL_TESTNET|TICK_MS|QUOTE_USD|MODEL" src/config.ts
bun test test/integration-map.test.ts
FUSAO_REPO=/copia/corrompida bun test test/integration-map.test.ts   # tem de REPROVAR
```
