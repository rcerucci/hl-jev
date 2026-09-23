# PLANO-FUSAO.md — Jev (política) × Hyperliquid (execução)

Base: clone limpo de `aowang-ai/jev-trade`, `main` = `a3f2f834a1b97dd42fab1193814179ac2e96d7cd`.
Branch: `fusao/policy-risk-venue`. Publicado em `rcerucci/hl-jev` (remoto `origin`); `aowang-ai` fica como
`upstream`, com a tag `baseline-a3f2f83` a marcar a base exacta do PR. Mapa verificado: `INTEGRATION.md`. Alarme: `test/integration-map.test.ts`.
Estado: **Fase A+B implementada** (T003-T017) na branch `fusao/policy-risk-venue`. Nenhuma ordem foi
enviada, nenhum segredo foi lido, copiado ou registado. Decisoes D1-D8 fechadas pelo dono em 23 set 2026.

## Veredicto

A spec é **boa no essencial e executável**: o mapa do repo está certo (conferi função a função) e a fatia
"Fase A+B num PR" é realista. Não precisa de Spec Kit — o documento anexo **já é** a spec, e é uma spec
técnica com interfaces congeladas, que é exactamente o formato que o Spec Kit não serve para produzir.

Antes de escrever código, porém, há **nove achados** que ela própria manda tratar ("se alguma linha ficar
'não sei', parar e perguntar"). Três deles **travam o arranque** porque a spec assume como verdade algo que o
código desmente:

| # | Achado | Gravidade |
|---|---|---|
| A1 | `CYCLE_SECS=15` contradiz o não-negociável do repo: "Jev decides on **every** Hyperliquid tick" (`CLAUDE.md`, `README.md:6,28`) com `TICK_MS=2000` (`src/config.ts:44`) | **travante** — decide custo, texto do demo e schema do ledger |
| A2 | O "agent wallet" que a spec diz para preservar (§2.2.2) **não existe**: o executor assina com a chave EOA da sleeve (`src/market.ts:53,56`) | **travante** para o texto e para a Fase E |
| A3 | A spec manda "não duplicar nomes de env" e depois inventa `HL_ACCOUNT_ADDRESS`, `HL_AGENT_PRIVATE_KEY`, `LIVE`, `MAX_LIVE_EQUITY_USD`, `JEV_TIMEOUT_MS` — nenhum existe | alta (contrato de config) |
| A4 | O controle `POLICY=dumb` **não pode** reusar o `MockModel`: ele decide sobre números (`returnsBps`, `bookImbalance`, `cvd`), e a §9.4 exige decidir sobre os **mesmos adjectivos** do Jev | alta (invalida o experimento da §9.4) |
| A5 | Hoje uma falha do Jev **não** vira `hold`: vira bloco "late" que **não mexe na book** (`src/trader.ts:93-102`) | alta (o gate 4 da §2.2 não está satisfeito) |
| A6 | `jevQuestions()` é **dinâmica** (interpola `stance`, `tickMs`, `rungs`; ramifica flat vs não-flat) — um JSON estático perde isso (placeholders, decidir a forma) | média |
| A7 | O tipo `Intent` **já existe** em `src/types.ts` (= `open\|close\|hold`, importado em `src/plan.ts:1`) e a §3.5 usa o mesmo nome para outra coisa | média (colisão de nome) |
| A8 | A decisão flui até o desk: `ModelDecision` → `BlockEvent.decision` → SSE → `web/src/lib/bot-types.ts`, que o `CLAUDE.md` obriga a manter **idêntico** ao `src/types.ts` | média (contrato de fio que a spec não menciona) |
| A9 | A §8 propõe ficheiros Python (`risk/buckets.py`, `python -m night.propose`, `tests/test_*.py`) num repo Bun/TS que proíbe segundo runtime para trabalho novo | média (forma, não fundo) |

## 1. O que a spec acertou (conferido, não presumido)

| Afirmação da spec | Medido |
|---|---|
| `trader.ts` é o único que chama `market.send` | ✓ `grep -rn "this.market.send(" src/` → 1 linha (`src/trader.ts:121`) |
| Assinatura `market.send(side, size, book, cancel, reduceOnly, taker)` | ✓ `src/market.ts:181`, literal |
| `cancelResting` / `setLeverage` existem e não devem mudar | ✓ `src/market.ts:298` / `:166` |
| open = ALO, close = IOC reduce-only | ✓ `src/plan.ts:52-59` |
| `TICK_MS=2000`, `QUOTE_USD=40`, `MODEL=mock`, `HL_TESTNET=true` | ✓ `src/config.ts:44,53,58,38` |
| `PRIVATE_KEY` + `.wallets.json` / `WALLETS_JSON` por sleeve | ✓ `src/sleeves.ts:54,68-71` + `.wallets.example.json` (BTC pela env, 4 restantes no ficheiro) |
| Sleeves BTC ETH SOL DOGE BNB | ✓ `src/sleeves.ts:63` |
| `/history` não substitui o ledger de outcome | ✓ `src/server.ts:86`, em memória (`historySize: 1000`) |
| 3 choices no Jev, incluindo `leverage` | ✓ `src/model.ts:120-193` |
| deadline actual de 4000 ms | ✓ `src/model.ts:314` (`JEV_DEADLINE_MS`, constante) |
| `noul` não traz `confidence`; `too_hostile` é P(sim) ∈ [0,1] | ✓ SDK 0.6.0: `NoulResponse = { type:"noul", noul:number }` — "probability of a yes answer" |
| `act_conf` distinto das probabilidades (o exemplo da §3.4: hold com 0,82 e conf 0,74) | ✓ SDK: `ChoiceResponse = { choice, confidence, probabilities }` — **não é erro da spec**, são dois campos |
| `instructions` aceita texto **ou** objecto | ✓ SDK: `EntryType = string \| object \| array \| null` (o repo já manda objecto) |

A §3.4 estava certa e eu ia acusá-la de incoerente — o SDK confirma os dois campos. Registado.

## 2. Registro de decisões

Cada decisão tem dono. As marcadas **[dono]** mudam comportamento ou contrato público: não as tomo sozinho.

| ID | Decisão | Opções | Bloqueia | Dono |
|---|---|---|---|---|
| D1 | Cadência do ciclo | (a) 15 s como a spec pede — e o **texto do demo/CLAIM muda**; (b) manter 2 s | tudo (ledger, custo, painel) | **[dono]** |
| D2 | Nome do intent novo | `RiskIntent` (proposto) e o que fazer com `Intent`/`Bias`/`quoteAction` órfãos | `src/plan.ts`, `src/risk/*` | eu, com o teu ok |
| D3 | Falha/timeout → `hold` **cancela** a resting? | (a) sim, `hold` = stand-down (o que a §3.5 diz: "hold ⇒ urgency=none e o executor não chama exchange"); (b) não, mantém o comportamento actual | `src/trader.ts` gates, testes | **[dono]** (muda comportamento em produção) |
| D4 | Forma do policy file | (a) `instructions` objecto com placeholders `{{stance}}` (preserva o que existe); (b) texto simples (perde interpolação) | parser da noite, schema | eu, com o teu ok |
| D5 | Ledger por dia | (a) ficheiro do **dia da decisão** (o worker grava lá o outcome); (b) um ficheiro por sleeve | `src/ledger/jsonl.ts` | eu |
| D6 | Desk mostra o quê | (a) `{state 12 palavras, act, act_conf, too_hostile}`; (b) manter a forma actual e só acrescentar | `src/types.ts` + `web/src/lib/bot-types.ts` | **[dono]** (é o demo público) |
| D7 | Fase E (mainnet) | aceitar que exige agent wallet + cap de equity (o repo não tem nada disso) | Fase E apenas | **[dono]** |
| D8 | Os **5 commits locais fora do `origin/main`** (clone `~/Projects/jev-trade`, +7 ficheiros sujos) | (a) publicar antes e ramificar dali; (b) a fusão parte do `main` público e esse trabalho fica de fora | o baseline do PR | **[dono]** |

### O que cada travante custa, em número

**D1, custo derivado** (chamadas = `86400/cadência × 5 sleeves`, preço de vendor ~US$ 2e-5/resposta — **derivado,
não medido em produção**):

| Cadência | Ciclos/sleeve/dia | Chamadas Jev/dia | US$/dia | US$/mês |
|---|---|---|---|---|
| 2 s (hoje) | 43 200 | 216 000 | 4,32 | 129,60 |
| 15 s (spec) | 5 760 | 28 800 | 0,58 | 17,28 |

Ou seja: a spec propõe **7,5× menos chamadas** — o que é bom para o custo e mau para o único claim que o repo
classifica como não-negociável. Não é detalhe técnico: é escolher qual das duas frases fica verdadeira.

### A3 — mapa de nomes de env (resolve a contradição "não duplicar")

| Spec propõe | Existe? | Decisão |
|---|---|---|
| `HL_TESTNET=true` | sim (`src/config.ts:38`) | manter |
| `HL_ACCOUNT_ADDRESS` | não | **não criar** — o endereço deriva da chave (`src/market.ts:59-61`) |
| `HL_AGENT_PRIVATE_KEY` | não | **não criar na v1** — a chave por sleeve é `PRIVATE_KEY`/`WALLETS_JSON` |
| `LIVE=no` + `MAX_LIVE_EQUITY_USD` | não | criar só na Fase E, com o gate `HL_TESTNET=false` **e** `LIVE=yes` |
| `JEV_TIMEOUT_MS=800` | não (há a constante 4000) | criar; a constante passa a ler a env |
| `TYPESAFE_API_KEY`, `JEV_MODEL`, `NIGHT_*`, `POLICY_FILE`, `PROPOSAL_DIR`, `CYCLE_SECS`, `OUTCOME_HORIZON_SECS`, `STATE_MAX_WORDS` | não | criar conforme a spec; `JEV_MODEL` **colide** com `JEV_MODEL_ID` → usar o existente |
| `PRIVATE_KEY`, `DRY_RUN`, `TICK_MS`, `QUOTE_USD`, `MODEL`, `HL_COINS` | sim | manter |

## 3. Fases

**Fase 0 (feita)** — clone limpo, SHA gravado, `INTEGRATION.md`, alarme do mapa a correr no CI.
**Fase A (feita)** — solda seca: `snapshot → state → verdict mock → intent → planFromRisk → submit existente`. Sem chave Jev.
**Fase B (codigo pronto, prova com chave pendente)** — Jev vivo: `systemOne` + `noul` + `confidence`, timeout 800 ms, policy file versionado, ledger `decision`.
**Fase C/D/E** — outcome +15 min e tabela de atribuição · noite (`propose`/`show`/`accept`) · mainnet capado. PRs separados.

O PR desta ronda entrega **A+B**, como a §10 manda. C, D e E não entram.

## 4. Tarefas

Formato `tasks.md` do Spec Kit (validado com `validar_formato_tasks.py`). `[P]` = paralelizável.

- [x] T001 [P] [Setup] Clonar `main` da origem e gravar o SHA de baseline — `INTEGRATION.md`
- [x] T002 [P] [Setup] Alarme que confere os invariantes do mapa contra o código — `test/integration-map.test.ts`
- [x] T003 [Foundational] Carregador tipado do policy file com versionamento e validação de schema — `src/policy/load.ts`
- [x] T004 [Foundational] Cortes numéricos → adjectivos, constantes nomeadas, um só ficheiro — `src/risk/buckets.ts`
- [x] T005 [Foundational] Tipos do veredicto e do intent da fusão (sem colidir com `Intent`) — `src/risk/types.ts`
- [x] T006 [US1] Gates do RISK: timeout, `raw_ok`, `too_hostile`, `conf`, inventário, book velho — `src/risk/intent.ts`
- [x] T007 [US1] Gancho no tick: RISK entre a decisão e o `planQuote` — `src/trader.ts`
- [x] T008 [US1] Ponte intent → `QuotePlan` mantendo o contrato de `market.send` — `src/plan.ts`
- [x] T009 [US1] Alavancagem passa a vir do config e não do modelo — `src/config.ts`, `src/trader.ts`
- [x] T010 [US1] Ledger append-only com `kind: decision` por ciclo — `src/ledger/jsonl.ts`
- [x] T011 [US2] Cliente Jev com `state` de ≤12 palavras e perguntas `choice`+`noul` do policy file — `src/model.ts`
- [x] T012 [US2] Controle `POLICY=dumb` a decidir sobre os adjectivos, mesmo schema de ledger — `src/policy/dumb.ts`
- [x] T013 [US2] Contrato de fio do desk expõe `state`/`act`/`act_conf`/`too_hostile` sem chaves — `src/types.ts`, `web/src/lib/bot-types.ts`
- [x] T014 [P] Testes de buckets: sem dígitos, ≤12 tokens, determinístico — `test/buckets.test.ts`
- [x] T015 [P] Testes dos gates do intent (timeout, conf, noul, inventário) — `test/intent-gates.test.ts`
- [x] T016 [P] Testes do parser do policy file e da recusa de deriva de schema — `test/policy-schema.test.ts`
- [x] T017 [P] Testes do ledger (duas escritas, mesmo `cycle_id`, append-only) — `test/ledger.test.ts`
- [ ] T018 [US1] Prova em testnet: `hold` → nenhuma chamada de ordem; `buy` → ALO resting, nunca market — `INTEGRATION.md`
- [x] T019 [Polish] README: como correr em testnet, como ler a tabela de confiança, como **não** ir a mainnet — `README.md`

## 5. Matriz de aceitação (§12 da spec) → tarefa

| Critério §12 | Tarefa |
|---|---|
| Trabalho em clone fresco de `main`, SHA em `INTEGRATION.md` | T001 ✓ |
| `INTEGRATION.md` aponta `market.send`, `cancelResting`, `JevModel.decide`, `planQuote` | T001 ✓ |
| `snapshot_to_state` testado, sem dígitos | T004, T014 |
| `intent()` testado em timeout, confiança, noul, inventário | T006, T015 |
| Tick em testnet com Jev mock: Noop em hold, ALO em buy | T018 (é o critério que **exige chave** de testnet — dry-run não prova ALO) |
| Nenhuma chave no state, no ledger da noite, em fixtures | T002 (alarme), T010, T016 |
| Policy file versionado; parser rejeita deriva | T003, T016 |
| `POLICY=dumb` gera o mesmo schema de ledger | T012, T017 |
| README curto (testnet, tabela, como não ir a mainnet) | T019 |

Cobertura: 9 de 9 critérios com tarefa. Nenhum "requisito sem tarefa" (a classe de achado que o `analyze`
apanha). Nota deliberada: **não há tarefa para o outcome +15 min nem para a noite** — pertencem a C e D, e o
critério "PnL ausente não é falha do PR" da §12 autoriza isso.

## 6. Spec Kit: é necessário? Não.

**Facto**: `specify 1.0.8` já está instalado neste host (`~/.local/bin/specify`) e as skills `speckit-*` já
estão **neste** perfil (appbuilder) — não há nada a instalar, e Spec Kit já é convenção no teu
`~/Projects/Patrigestor` (`.specify/` existe lá).

**Veredicto**: não aplicar o fluxo completo aqui. Três razões:

1. **O pedido já chega como spec.** O Spec Kit existe para *produzir* spec a partir de um pedido em linguagem
   natural. Aqui o documento anexo já congelou interfaces (`market.send`, `QuotePlan`, os JSON da §3). O
   `specify` do toolkit gera uma `spec.md` *technology-agnostic* — correr isso obrigaria a tirar as interfaces
   para o `plan.md` e a manter **duas** descrições do mesmo contrato. A casa já sabe como isso acaba: a mesma
   regra escrita em três a cinco lugares, com as cópias a envelhecer em ritmos diferentes — e uma a dizer o
   oposto das outras.
2. **A ferramenta não responde ao que trava.** O que trava este trabalho são as decisões D1–D8, e nenhuma é
   questão de formato de spec: são contrato público (A1), segurança (A2/A5/D3) e baseline (D8).
3. **Custo real de adoptar a meio.** `specify init --here --integration hermes` grava skills no Hermes global
   (`~/.hermes/skills`, que pertence ao perfil `default`) e cria um branch pelo `setup-plan.sh` — duas coisas
   que não estão no meu âmbito sem pedido explícito. O destino correcto das skills é `<repo>/.hermes/skills`
   com `hermes skills trust`.

**O que eu aproveitaria do Spec Kit, sem a cerimónia** — e já está neste plano:

- a matriz §5 (a classe de achado "requisito escrito sem tarefa que o construa" é o que o `analyze` existe
  para apanhar) — feito por extracção, não por releitura;
- o formato `- [ ] T001 [P] [US1] descrição — caminho/arquivo` nas T001–T019, validável pelo script da casa;
- o rito do `clarify` reduzido a **uma** rodada fechada: D1–D8 respondidas por número.

**Se quiseres Spec Kit a sério neste repo**, o único uso que eu defenderia é a `constitution`: os invariantes
da §2.2 + os não-negociáveis do `CLAUDE.md` viram princípios `MUST` verificáveis, e o `analyze` seguinte passa
a reprovar quando uma tarefa contraria um deles. Isso são ~1 hora e um `.specify/` no repo. Não correria o
`specify` para este escopo.

## 7. Como se prova (o alarme, e a prova de que ele recusa)

`test/integration-map.test.ts` corre com `bun test` (logo, no CI do repo) e confere os **invariantes** que a
fusão não pode quebrar: assinaturas de `send`/`cancelResting`/`setLeverage`, sítio único de submit, regra
ALO/IOC, TIFs permitidos, defaults de testnet/mock, nenhuma credencial em log, `.wallets.json` fora do git,
exemplo só com marcadores, ausência de segundo cliente HL.

Ele **não** confere números de linha: isso fica no `INTEGRATION.md`, preso ao SHA (`git show <sha>:<arquivo>`).
Um teste que ficasse vermelho por o patch ter mudado uma linha legítima seria desligado à segunda semana — e
alarme desligado não é alarme.

Prova do negativo **executada** (não prometida) — 6 cópias da árvore, uma corrupção por cópia, correndo
`bun test` com `FUSAO_REPO` apontado a cada uma:

| Cópia | Corrupção | Resultado | Esperado |
|---|---|---|---|
| a | `src/plan.ts`: `open` deixou de ser ALO | REPROVOU | reprovar |
| b | `src/market.ts`: `cancelResting` renomeado | REPROVOU | reprovar |
| c | `src/config.ts`: `HL_TESTNET` deixou de ser default | REPROVOU | reprovar |
| d | `src/trader.ts`: `console.log(config.privateKey)` | REPROVOU | reprovar |
| e | `src/index.ts`: `${spec.privateKey}` interpolado no log | REPROVOU | reprovar |
| f | `src/index.ts`: chave usada como **booleano** (o caso legítimo que já existe) | passou | passar |

A linha (f) é o que impede o alarme de ser desligado: a regra dispara no **valor** registado, não na palavra.
Na primeira versão disparava na palavra e reprovou `src/index.ts` — que regista o *endereço* (público) e usa a
chave só como booleano de dry-run. Foi corrigida a regra, com dispensa vazia e impressa; nada foi afrouxado em
silêncio.

Estado medido da suíte no clone, `main` de `a3f2f83` + este ficheiro: **78 pass / 0 fail** (64 testes que já
existiam no repo + 14 do alarme). Ou seja: o baseline estava verde e o alarme não trouxe nenhum vermelho novo.

Formato das tarefas: `validar_formato_tasks.py` → **APROVADO** (19 tarefas, 6 `[P]`, rótulos e caminho de
arquivo em todas).

## 8. Risco fora da spec (D8)

O clone local `~/Projects/jev-trade` está **5 commits à frente do `origin/main`** (HEAD `f193169`, "Measure the
entry cost threshold and the entry spacing on the offline replay") com **7 ficheiros sujos**. A spec manda,
com razão, partir do `main` público e não abrir o tree sujo. Consequência a aceitar em voz alta: se a fusão
partir do `main` público, **esse trabalho fica fora do PR** — e é trabalho de medição de custo de entrada, ou
seja, do mesmo assunto. Não toco nele; a decisão (publicar antes ou deixar de fora) é tua.

## 9. Fechado em 23 set 2026 — decisões D1–D8 e o que foi implementado

O consultor fechou as oito decisões e autorizou T003–T013. Implementei T003–T017 (as quatro tarefas de teste
da bateria §9.1 entram porque o critério de aceite as exige: "existe `snapshot_to_state` **testado**").

| Decisão | Como ficou no código |
|---|---|
| D1 (b) manter 2 s | nada mudou: `TICK_MS` continua a cadência. **Não existe `CYCLE_SECS`.** |
| D2 `RiskIntent` | `src/risk/types.ts`; o alarme passou a reprovar se nascer um `Intent` novo no RISK |
| D3 timeout não cancela | `reason` separa os dois holds (`frozen_*` vs `jev_hold`/`low_conf`/`hostile`/`inventory_block`); `isFrozen`/`standsDown` decidem, e o teste prova as duas consequências |
| D4 placeholders não numéricos | só `{{asset}}` e `{{stance}}`; placeholder desconhecido (p. ex. `{{tickMs}}`) é recusado no load |
| D5 dia UTC da decisão | o `cycle_id` carrega o instante, e o outcome das 23:50 cai no ficheiro do dia da **decisão** (testado) |
| D6 só acrescentar ao desk | `state12`, `act`, `act_conf`, `too_hostile` opcionais nas duas cópias dos tipos |
| D7 sem agent wallet / sem `HL_AGENT_*` | nada disso foi criado |
| D8 só o `main` público | baseline `a3f2f83`; o tree local nem foi aberto |
| A4 `DumbPolicy` | `src/policy/dumb.ts`, lê `state.split` e mais nada; `MockModel` intacto |
| A9 TS/Bun | nada de Python: `src/**/*.ts` e `test/*.test.ts` |

### Interpretações que eu tive de tomar (não estavam escritas)

**I1 e I4 confirmadas pelo dono em 23 set 2026** (o consultor validou as duas: `POLICY` ausente = legado, e o
TIF da saída reduce-only continua no `plan.ts`). As restantes seguem como interpretação minha, reversíveis.

| # | Assunto | O que fiz | Por quê |
|---|---|---|---|
| I1 | `POLICY` ausente | o tick continua o **legado** (o `MODEL` decide); a fusão só liga com `POLICY=jev\|dumb` | A4/D6 mandam manter o `MODEL=mock` como default; assim o demo que corre hoje não muda de comportamento |
| I2 | Alavancagem | `enqueueQuote` recebe `leverage` por parâmetro: a fusão passa `config.leverage`, o legado continua a passar a do modelo | "o modelo não escolhe alavancagem na v1" sem quebrar o caminho antigo |
| I3 | Snapshot §3.1 | acrescentei os campos que a **própria** §3.2 exige (`tape`, `flow`) e corrigi dois nomes: `funding_bps` (a HL publica taxa **horária**, não 8h) e `depth_usd_10bps` (o livro só agrega bandas de 10/25/50 bps) | sem isso os buckets `pumping`/`bot_war` seriam ficção |
| I4 | TIF | o `RiskIntent` pede `maker` sempre (como a §3.6 escreve) e o `plan.ts` decide o Ioc da saída reduce-only | o TIF é detalhe de venue, decidido no `plan.ts`, e o Jev nunca o escolhe |
| I5 | Livro velho | `book_age_ms` vem de `feed.bookAt`, campo novo (aditivo) no venue; sem ele o gate da §3.6 seria decorativo | o gate tem de medir, não fingir |
| I6 | `Verdict` | dois campos opcionais de diagnóstico: `note` ("timeout"/"parse"/"transport") e `input_tokens` (mantém o contador `jevUsd` do desk a funcionar) | a decisão continua a ser só `act`/`act_conf`/`too_hostile` |
| I7 | `fill` na linha `decision` | escrevo `fill: null`; o fill chega assíncrono e a linha dele é da Fase C | o tick não bloqueia à espera do ack |

### Lacunas declaradas (não são surpresas)

- `outcome` +15 min, tabela confiança × acerto e o controle `dumb` existem desde a Fase C
  (`src/ledger/outcome.ts`, `src/ledger/marks_source.ts`, `src/ledger/attribution.ts`). O
  `select_disagreements` é **Fase D** e não existe.
- O turno da noite é **Fase D**: não existe, e o `accept` continua manual.
- T018 tem **duas metades**. A do Jev está provada acima (13/13 `raw_ok` com chave real e sem signer). A do
  venue foi provada depois, com signer real: `hold` não mexe na book e `buy` sai como **ALO resting** no
  venue (ver §11). O que continua a faltar é um **fill**, que exige saldo — e isso não bloqueia o PR.
- **O `main` público não passa `tsc --noEmit`**: 7 erros de tipo, todos pré-existentes (medido num worktree de
  `a3f2f83`). O CI só corre `bun test`, por isso passam despercebidos. O meu patch não acrescenta nenhum
  (comparado erro a erro). Consertar os 7 é PR próprio, não este.

### Evidência medida desta ronda

```
bun test test            → 135 pass / 0 fail  (64 do repo + 71 novos)
tsc --noEmit             → 7 erros, exactamente os 7 do baseline (nenhum novo)
alarme do mapa           → 5 corrupções reprovam; o caso legítimo passa
CI (GitHub, f828ae2)     → 135 pass / 0 fail nos dois runs (push e pull_request)
POLICY=dumb (dry-run)    → arranca, ticks a 2000 ms, ledger escrito por ciclo
POLICY=jev  (dry-run)    → 13 ciclos, 13/13 raw_ok, model jev-1.13.0
```

**Passo 2 do consultor (o Jev a falar, sem signer), medido** em 23 set 2026: uma sleeve (BTC),
`DRY_RUN=true` e `PRIVATE_KEY` vazio, livro real de testnet.

| Medida | Valor |
|---|---|
| ciclos / respostas válidas | 13 / **13** |
| latência do Jev (ms) | min 277 · mediana **316** · max 442 |
| `JEV_TIMEOUT_MS` | 800, cerca de 2,5× a mediana desta amostra |
| `act` | sempre `hold`; `act_conf` 0,31–0,45 |
| `too_hostile` | 0,45–0,50 (limiar 0,65) |
| veredicto típico | `model: jev-1.13.0`, `act_probs: {buy 0,28, sell 0,15, hold 0,57}` |
| estados distintos | **1** — o livro de testnet ficou parado: mede a canalização, não a política |
| custo pelo contador do repo | US$ 0,000319 em 13 chamadas (7 592 input tokens) |

O que isto **prova**: o parse de `choice` + `noul` contra a API real (a forma do SDK 0.6.0, com
`confidence` distinto de `probabilities`), o gate a recusar por `low_conf` (0,35 < 0,80) com stand-down, o
estado de 7 palavras sem dígitos a atravessar 13 ciclos, e a latência a caber no tick de 2 s.
O que **não** prova: que o venue assina. Essa metade do T018 exige chave de testnet da Hyperliquid.

**Defeito que os testes desta ronda apanharam** (corrigido em `58fe256`): `Number(null) === 0`, logo um `noul`
ausente ou nulo era lido como P(sim)=0, ou seja "livro não hostil". Era fail-open no campo que existe para
travar; passou a exigir número real em `noul`, em cada probabilidade e em `confidence`.

## 10. Sonda da Fase D (API DeepSeek) — 23 set 2026

A Fase D **não** está implementada. O dono configurou `NIGHT_API_KEY` e indicou a API
(`https://api.deepseek.com`, `deepseek-flash`, `reasoning_effort=high`, thinking enabled), por isso a sonda
descartável respondeu, com **uma** chamada real e o system prompt da §7.4, o que a Fase D precisa de saber
antes de ser escrita. A sonda viveu fora do repo (scratch) e não entra em nenhum commit.

| Pergunta | Resposta medida |
|---|---|
| `deepseek-flash` é model id válido neste endpoint? | **sim** (HTTP 200, `model` devolvido igual) |
| `reasoning_effort=high` + `thinking={type:enabled}` são aceites? | **sim**, sem erro |
| devolve JSON estrito? | **sim**, parseia direto (sem cerca de código) |
| mantém `hold` e as chaves? | **sim**: `act.criteria = [buy, hold, sell]`, `too_hostile` com true/false |
| mete números no texto? | **não**: zero dígitos nos criteria reescritos |
| latência | **38,1 s** |
| tokens | 547 in / **8 802 out** (8 309 deles de raciocínio) |
| custo | não calculado: não tenho a tarifa do vendor; ficam os tokens medidos |

Três consequências para a Fase D, todas accionáveis antes de escrever código:

1. **Timeout próprio, largo.** 38 s é aceitável numa cron das 01:00 e é proibido no tick — a spec já o diz.
   O cliente da noite não pode herdar o `JEV_TIMEOUT_MS=800` do path quente.
2. **O raciocínio domina o custo.** 94% dos tokens de saída são de raciocínio, e a resposta útil tem ~2 000
   caracteres. O orçamento da noite ("poucos mil tokens") vale para a **entrada**; a saída é quase 9 mil.
3. **O modelo desvia o schema nas versões.** Devolveu `"base_version": "v1"` e `"proposed_version": "v2"`
   — **texto**, onde a §7.3 mostra inteiros. É deriva real, apanhada pela sonda. Decisão a tomar no parser
   da noite: rejeitar (e ficar sem proposta aquela noite) ou coagir para inteiro **com nota registada** no
   ficheiro da proposta, visível ao humano. Recomendo coagir com nota: a cron é das 01:00 e não há ninguém
   para responder a um reject.

A proposta reescrita foi substantiva (moveu "Pumping flow means hold" para dentro do critério de `buy`), o que
está dentro do papel da editora e é precisamente por isso que o gate humano não é opcional.

## 11. Fase C e a metade de venue do T018 — 23 set 2026

### O que passou a existir

| Ficheiro | Caixa | Papel |
|---|---|---|
| `src/ledger/outcome.ts` | LEDGER | a linha `+15 min` e o worker, separado do tick |
| `src/ledger/marks_source.ts` | VENUE → LEDGER | marcas: candles de 1m públicos + funding, sem chave, injectáveis |
| `src/ledger/attribution.ts` | LEDGER | a tabela confiança × acerto e o veredicto da §9.4 |
| `src/tools/prova-venue.ts` | sonda | T018; fala com a testnet a sério e recusa correr fora dela |

```sh
bun run src/ledger/outcome.ts       # preenche o que já venceu (idempotente, reconstrói do ledger)
bun run src/ledger/attribution.ts   # a tabela
```

Três decisões que evitam modos clássicos de mentir no log: o tick não espera o futuro (worker separado); o
horizonte vai **gravado na linha** (`horizon_secs`), para que mudá-lo amanhã não reinterprete as linhas de
ontem; e **não se inventa marca** — sem vela para a hora pedida, o ciclo fica pendente para a passagem
seguinte.

### Ensaio 100+100 (mesmo livro, testnet, dry-run, uma sleeve, `TICK_MS=2000`)

Tabela crua, sem resumo:

```
limiar de confianca: 0.8
politica    ciclos  c/outcome decididos falhas  %hold   %conf>=limiar  acuerto  n    nulos  hits_altaconf  funding
jev         119     119       117       2       100.0%  0.0%             --     0    119    0              0.00e+0
dumb        105     105       105       0       100.0%  0.0%             --     0    105    0              0.00e+0

veredicto: amostra insuficiente (Jev n=0, controle n=0, minimo 20) — nao se conclui nada daqui.
```

Leitura, na ordem combinada com o consultor:

1. `c/outcome` = `ciclos` nas duas colunas (224/224) — o worker não salta velas.
2. `%hold` 100% nas duas políticas: **neste livro o Jev é travão, não oráculo**.
3. `n` em `conf ≥ 0,80` = **0** nas duas colunas. Nos 117 ciclos válidos, **deste ensaio**, o Jev ficou em
   0,12–0,78 (mediana 0,30) e não cruzou o limiar. Isso não é propriedade do modelo — no run de 30 minutos
   seguinte chegou a 0,90 (ver a correcção no fim desta secção).
4. Logo, sem acerto e sem veredicto §9.4: **amostra insuficiente**.

Hipótese registada e **não** accionada: o P(0,8) de fábrica do modelo não se transfere automaticamente para
este vocabulário de sete adjectivos. Baixar o `JEV_CONF_ACT` para a coluna deixar de estar vazia está proibido
por decisão do consultor, e é a decisão certa: afinar o instrumento até o número aparecer não é medir.

**Correcção medida (23 set 2026, mais tarde no mesmo dia).** A primeira versão desta secção dizia «um estado
distinto em 224 ciclos» e isso era **falso**: era a leitura dos 13 ciclos do ensaio da manhã (§9), colada ao
100+100 que ainda não tinha sido medido. Medido sobre a janela do ensaio: **13 estados distintos** na coluna
do Jev, 4 no controle, com um estado a dominar 63% (`tight deep dump flat flat extreme mid`); o run de 30
minutos seguinte (§12) deu **18 estados em 922 ciclos**. O livro mexe — mas só em `flow`/`tape`: `spread`,
`inventory` e `clock` ficaram constantes na amostra toda.

O que continua verdadeiro, e é o essencial: 100% `hold` e **zero lados de alta confiança**, logo nenhum
experimento de direcção. E a confiança não fica sempre abaixo do limiar — o máximo é que era da amostra
curta: 0,78 nos 117 ciclos do ensaio, **0,90** no run de 30 minutos (sete ciclos acima de 0,80, todos
`act=hold` com P(hold) 0,90–0,94). O raro é o **lado**, não a confiança — e é isso que o próximo ensaio tem
de produzir para haver o que graduar.

### Prova do venue (T018), com signer real

```
bun run src/tools/prova-venue.ts estado  → wallet 0xF871…5621, accountValue 0, withdrawable 0, 0 ordens
bun run src/tools/prova-venue.ts hold    → ordens abertas 0 → 0  (hold não mexe na book)
bun run src/tools/prova-venue.ts buy     → QUOTE buy 0.00046 @ 85560 status=placed taker=false oid=60855824109
                                           ordens abertas 1 (BTC#60855824109) → cancelada na limpeza
```

`taker=false` prova que o submit continua post-only: nada caiu para market. O intent é scriptado de
propósito — em prova está o **executor**, não a política, e nenhum limiar do RISK foi tocado. Da §9.3 fica
por exercitar apenas a recuperação de queda de WS (não se induz uma queda de rede sem mexer no host).

**Nota que muda a expectativa do bloqueio:** uma ALO **descansa sem margem**; o que exige saldo é o *fill*.
Com `withdrawable $0.00` a carteira aceita a ordem e não a enche. O faucet só paga quem já depositou na
mainnet ("Users who have deposited on mainnet may receive 1000 mock USDC for testnet use"), por isso o
caminho barato para ver um fill é reutilizar as carteiras de testnet já financiadas do clone antigo — cópia
à mão, como a spec manda. Não é bloqueio do PR.

### Dois defeitos que esta ronda apanhou

1. **Parser do Jev fail-open** (`58fe256`): `noul` ausente virava `Number(null) === 0` → "livro não
   hostil" → seguia. Agora exige número real em `noul`, em cada probabilidade e em `confidence`.
2. **Coluna falsa na tabela** (`02c5808`): as falhas do Jev saem com o id de configuração (`jev-latest`)
   no campo `model`, e o agrupamento pelo id cru abria uma **terceira coluna** no meio da comparação — como
   se fosse outra política. Passou a agrupar por família (`jev` | `dumb`), com coluna `falhas` própria; e um
   ciclo congelado deixou de contar como `hold` decidido no denominador das partilhas.

### Evidência medida desta ronda

```
bun test test    → 155 pass / 0 fail / 574 expect()   (64 do repo + 91 novos)
tsc --noEmit     → 7 erros, exactamente os 7 do baseline (nenhum novo)
alarme do mapa   → 5 corrupções reprovam; o caso legítimo passa
CI               → verde nos dois runs em 00fd5f3, 02c5808 e 634a3a4
ensaio           → 224/224 outcomes, `horizon_secs: 900` gravado em todas as linhas
T018 venue       → ALO resting real (oid 60855824109, `taker=false`), cancelada na limpeza
```

## 12. Run de 30 minutos em testnet e o desk — 23 set 2026

### O run (uma instância, tick de 2000 ms)

Configuração: `HL_TESTNET=true`, `POLICY=jev`, `MODEL=jev`, `HL_COINS=BTC`, `DRY_RUN=false`, chave da sleeve
BTC no clone (fora do git, fora do chat).

| Medida | Valor |
|---|---|
| ticks / ciclos no ledger | **922 / 922** (1:1 com as linhas do log) |
| respostas válidas / congeladas | **922 / 0** |
| `%hold` | **100%** (922/922) |
| ordens colocadas | **0** (`quotes: 0`, `openOrders: 0`, nenhum `oid`) |
| fills | **0** nesta sessão (o último fill da carteira é das 02:40Z, histórico) |
| `accountValue` / `withdrawable` | **0 / 0 antes e depois** |
| motivos do gate | `hostile` **433** · `low_conf` **489** |
| `act_conf` | 0,15 – **0,90** (mediana 0,64) |
| latência do Jev | 261 – 588 ms (mediana **324**) |
| estados distintos | **18** |
| custo | 539 426 tokens de entrada → **US$ 0,0227** |
| fim | 0 resting, processo parado, sem órfão |

Duas conferências cruzadas que valem mais que o total: o contador do próprio motor (`jevUsd 0,007923` aos 322
blocos) extrapola para 0,0227 aos 922, batendo com a conta feita pelos tokens; e `blocks == decisions` nos
dois momentos.

O que este run **não** é: prova de edge. É o encaixe a funcionar com signer vivo — o Jev fala, o gate trava, o
executor não envia ordem, o ledger escreve. Hold a 100% é o resultado **esperado** neste livro, não uma falha.

### O desk

O `web/` é um Next que corre **à parte** do motor (`bun run dev -p 3001`, API em `:3000`). Duas coisas ficaram
por fazer na primeira passagem da fusão e estão feitas agora:

- **render da fusão (D6)**: o painel mostra `act`, `act_conf`, `too_hostile`, o estado de ≤12 palavras e o
  motivo do gate (`reason`, campo aditivo no `ModelDecision`, no `Decidable` e nas duas cópias do tipo). Sem
  `act` na decisão, o desk renderiza o caminho legado como sempre.
- **tema claro/escuro com paleta de tinta electrónica**: o CSS só tinha paleta clara — o escuro que se via era
  o do navegador a forçar, e era ele que recolorava o canvas do gráfico. Agora há paleta própria nos dois
  temas, sem branco puro nem preto puro e com acentos dessaturados, botão de troca com escolha gravada e
  guião no `<head>` antes da primeira pintura. O gráfico pinta em canvas e não vê CSS vars: lê as **mesmas**
  variáveis do documento, com um observador em `data-theme` que reaplica na troca.

Contrastes medidos (WCAG, calculados a partir do ficheiro, não estimados):

| par | claro | escuro | mínimo |
|---|---|---|---|
| tinta / papel | 12,58:1 | 11,86:1 | 4,5 |
| tinta-2 / papel | 8,64:1 | 7,94:1 | 4,5 |
| muted / papel | 4,88:1 | 5,04:1 | 4,5 |
| muted / painel-2 | **4,63:1** | **4,67:1** | 4,5 |
| buy / sell / link | 4,90 / 5,43 / 6,97 | 5,67 / 5,34 / 6,83 | 3,0 (acento) |

A folga mais apertada é `muted` sobre painel (`#6a6961` no claro, `#8d8a81` no escuro), ajustada o mínimo
necessário para passar AA. **Qualquer cor nova entra em `web/src/app/globals.css`**; um hex fora de lá é uma
segunda paleta a divergir — foi exactamente esse o defeito que o gráfico tinha.

## 13. V3-0 — as duas fitas, medido (23 set 2026)

O V3 do `VALIDACAO-PNL.md` partia de uma suposição: o livro de testnet está parado, portanto as marcas do
`outcome` têm de vir de **mainnet** — e daí o desenho misto (estado de testnet, marcas de mainnet), que o
documento classifica como defeito grave se as fitas divergirem. A medição sobre o corpus que **já existia**
derruba a suposição, e com ela cai o motivo do desenho misto.

Sonda descartável, fora do código de produto: `provas/v3-0-duas-fitas/`. Lê o ledger (2903 ciclos em 101
minutos distintos, 15:12Z→17:43Z) e as velas públicas de 1m das duas fitas (uma chamada por fita, sem chave).

| Medida | Valor |
|---|---|
| Velas de 1m por fita / cobertura | 152 · 15:12Z→17:43Z |
| Minutos com as duas fitas e os dois marcos | 86 / 101 |
| Desacordo de **nível** (mesmo instante) | mediana **-165,2 bps** (p0 -187,5 · p100 -124,6) |
| Movimento a 15 min, testnet | mediana **-12,8 bps** (p0 -45,7 · p100 +25,9) |
| Movimento a 15 min, mainnet | mediana -8,7 bps (p0 -39,7 · p100 +43,8) |
| **Sinal concorda** — janelas independentes | **5 / 5** |
| Sinal concorda — todos os minutos (sobrepostos) | 66 / 83 = 79,5 % |
| Minutos com \|mov 15 min\| < 1 bps | testnet **3** · mainnet 5 (de 86) |
| Minutos com \|mov 15 min\| ≥ 10 bps | testnet **63** · mainnet 56 |
| Sonda contra o `mark_then` gravado | 224 outcomes, **diferença máxima 0,0 bps** |

E o que o **próprio ledger** já dizia, sem rede:

| Medida | Valor |
|---|---|
| `dir_after` nos 224 outcomes | **down em 224/224** |
| \|movimento a 15 min\| gravado | mediana **26,2 bps** · máximo 45,7 · **211/224 ≥ 10 bps** |
| `jev_side` nos 224 | `hold` em **224/224** → `directional_hit` `null` por construção |
| `act_conf` (decisões válidas) | mediana 0,50 · máximo 0,91 · **225** de 2923 ≥ 0,80 |
| `too_hostile` | mediana 0,52 · **1995** de 2923 ≥ 0,50 |
| Actos | `hold` em **2923/2923** |

**`dir_after` = `down` em 224/224 — e isso não são 224 confirmações.** As 224 observações cabem em **23,6
minutos** (15:12:53Z→15:36:32Z, tudo na hora 15Z) e cada uma gradua uma janela de 15 min: cabem lá **duas
janelas independentes**. O movimento gravado nessa hora: mediana **-26,2 bps**, mínimo -45,7, máximo -2,2 —
uma queda contínua, amostrada 224 vezes. É o mesmo defeito que a sonda tinha (janelas de 15 min que
partilham 14 min entre si), agora dentro do corpus. **No V4b-0 imprime-se `dir_after` por hora**; se
continuar 100 % `down` noutro dia, é o cálculo, não o mercado. Estados distintos hoje: **43** (15Z: 10 · 16Z:
27 · 17Z: 24).

**O que isto decide**

1. **"O testnet parado" está falsificado.** 211 dos 224 outcomes têm movimento ≥ 10 bps nos 15 min seguintes;
   na sonda, 63 de 86 minutos. Não é um livro morto — anda.
2. **Os 224 `directional_hit: null` vêm de `jev_side: hold`**, não da fita: um hold não tem lado para
   graduar. É um facto de **política**, não de venue. É a mesma conclusão do V1 (zero lados a qualquer
   confiança), agora sem a desculpa da fita.
3. **As fitas não são a mesma fita em nível** (~1,65 % de desvio sistemático, a testnet acima) — mas não
   divergiram em **sinal** nas 5 janelas independentes que cabem na janela. Amostra pequena: não demonstra
   equivalência, também não mostra inversão de rótulo.
4. Logo, **o desenho misto não é preciso**: era a resposta a uma premissa que a medição derrubou. Marcar no
   **mesmo livro** do estado evita o desvio de nível sem perder nada. O que trava a V3 viva não é a fita — é
   a política nunca escolher lado. **V4b-0 (Laya nos mesmos estados) é o experimento decisivo.**

**Decisão tomada (23 set 2026): marcas no mesmo livro do estado** — `MARKS_VENUE=testnet` por default. Mainnet
deixa de ser obrigatório para "haver movimento"; o livro misto continua proibido de mandar ordem (essa regra
**não** caiu) e as duas mids por ciclo passam a diagnóstico opcional. O 5/5 **não** é prova de que o rótulo
seria o mesmo em mainnet: é ausência de inversão nesta janela, não equivalência entre fitas.

**Achado de instrumentação (não corrigido aqui, é código de produto):** a linha de decisão do ledger **não
guarda o gate que disparou**. O motivo (`hostile` / `low_conf` / `hold` / `frozen_*`) só existe no SSE; o
ficheiro fica sem ele. Nos dados actuais ainda se reconstrói a partir de `too_hostile` e `act_conf`, mas um
corpus antigo não se explica sozinho. Candidato a PR pequeno: um campo `gate` no `verdict`.

## 14. V4b-0 (parte 1) — jev × dumb nos mesmos estados (23 set 2026)

Replay **offline**, sem rede e sem chave: `provas/v4b-0/replay-jev-dumb.ts`. Importa a heurística de
**produto** (`dumbAct` / `dumbHostile` de `src/policy/dumb.ts`) em vez de a recopiar — medir uma cópia
mediria a cópia. O `act` gravado no ledger é o verdict **cru** (o gate vive em `risk/intent.ts`), por isso o
replay aplica o gate na mesma ordem do produto: `hostile` (≥ 0,65) antes de `low_conf` (< 0,80).

| | jev (gravado) | dumb (recomputado) |
|---|---|---|
| decisões válidas | 3144 | 3144 |
| actos crus | `hold` 3144 | `hold` 3138 · `sell` 5 · `buy` 1 |
| lados crus | **0** | **6** |
| `n_lados` (conf ≥ 0,80) | **0** | **6** |
| bloqueados pelo gate | 2960 (hostile 613 · low_conf 2347) | 3139 (holds 3138 · **hostile 1**) |

Os seis estados onde a `dumb` escolhe lado — e o Jev fez `hold` nos seis:

```
"tight deep dump dumping flat extreme mid"          -> dumb sell | jev hold | 15:30:17Z (+3 ciclos iguais)
"unfillable empty bot_war dumping flat extreme mid" -> dumb sell | jev hold | 16:14:58Z   <- travado pelo proprio hostile
"tight deep bot_war pumping flat extreme mid"       -> dumb buy  | jev hold | 16:15:08Z
```

**O vocabulário, medido** (7 posições, por decisões):

| pos | bucket | palavras |
|---|---|---|
| 0 | spread | `tight` 3109 · `normal` 25 · `wide` 9 · `unfillable` 1 |
| 1 | depth | `deep` 3104 · `thin` 35 · `ok` 4 · `empty` 1 |
| 2 | flow | `dump` 1125 · `two_way` 903 · `lift` 477 · `bot_war` 467 · `quiet` 172 |
| 3 | tape | `flat` 3005 · `grinding` 133 · `dumping` 5 · `pumping` 1 |
| 4 | tape-2 | `flat` 3144 |
| 5 | move | `extreme` 3144 |
| 6 | funding | `mid` 2844 · `funding_window` 150 · `open_liq` 150 |

Três leituras que isto dá de graça:

1. **O `noul` não é o travão.** `noul ≥ 0,65` em **613** ciclos e `< 0,65` em **2531** — e a escolha é `hold`
   em **3144/3144**, nas duas bandas. O modelo não escolhe lado **mesmo quando o noul diz que o livro não é
   hostil**. Travar o `noul` não destrava nada: o que não aparece é o **lado**, não a permissão.
2. **A `dumb` escolhe lado onde o Jev recusa** — mas 6 em 3144 (0,19 %), abaixo do mínimo de 20. O controlo
   não empata: o controlo **não tem amostra**. O que já se pode dizer: o adjectivo (`dumping` / `pumping` na
   posição `tape`) **carrega lado** quando aparece — e o `tape` é `flat` em 3005 de 3144 (95,6 %).
3. **A metade hostil da `dumb` disparou 1 vez em 3144.** `dumbHostile` exige `violent` — que **nunca** aparece
   no vocabulário — ou `unfillable`, que aparece **1 vez**, na posição `spread` (onde significa outra coisa).
   O Jev teve **613** ciclos hostis. Não se corrige (§5 proíbe alargar o `dumb`): a tabela passa a declarar
   que a coluna do controlo não tem travão.

**`dir_after` por hora** (pedido do dono; worker de outcome relançado):

| hora | n | `dir_after` | movimento mediana | janela |
|---|---|---|---|---|
| 15Z | 224 | `down` 224 | -26,2 bps | 23,6 min → **2 janelas independentes** |
| 16Z | 230 | `down` 96 · **`up` 104** · **`flat` 30** | **-0,4 bps** | 8,3 min → 1 |
| global | 454 | `down` 320 · `up` 104 · `flat` 30 | — | — |

**Não é o cálculo preso — agora com prova melhor.** Na amostra de 16Z há **104 `up` e 30 `flat`** em 230
outcomes, com o movimento mediano a **-0,4 bps**: é uma janela quase parada, onde o `dir_after` vira com o
ruído — que é exactamente o que deve acontecer. O que existe é a **queda** da 15Z (mediana -26,2 bps),
amostrada 224 vezes em 23,6 min, ou seja duas janelas independentes. O worker de outcome correu outra
passagem (297 → **454** outcomes) e parou outra vez — mas **não** no mesmo sítio: desta vez foi um **erro de
CDN** (`x-cache: Error from cloudfront`, corpo de 4 bytes, no pedido `fundingHistory`), enquanto a primeira
paragem foi mesmo **429**. Duas causas diferentes na mesma ferramenta: o worker não sabe recuar de nenhuma
delas. É idempotente, outra passagem completa (17Z/18Z por graduar), e do lado da Laya isto não bloqueia: o
replay usa o **estado**, não o `dir_after`.

**O que falta para o V4b-0 fechar:** a coluna **Laya** (parte 2), que precisa dos pesos locais e do caminho
de execução. Sem ela, a pergunta do replay — *alguém escolhe lado onde o Jev recusa?* — tem hoje uma
resposta parcial: **o adjectivo escolhe (6×), o modelo não escolhe (0× em 3144, a qualquer `noul`)**.

## 15. V4b-0 (parte 2a) — a Laya nos mesmos estados (23 set 2026)

**Pré-ensaio noutro checkpoint, declarado.** O bundle ONNX publicado (`receptron/laya-onnx`, 1689 MB) é o
**inglês**, não o `laya-typed-decisions` que o doc manda para o vivo — o bundle diz "English checkpoint,
421M parameters" e o repo não tem subpastas. Plano fixado **antes** de baixar pesos em
`provas/v4b-0/parte-2/PLANO.md`. Caminho: ONNX in-process (`@receptron/laya` 0.1.2), nunca `laya-serve`,
nada de `src/`, nada do manifesto do repo (instalação em pasta de trabalho fora do repositório).

Censo: as **mesmas 3144 decisões** do §14 (regra determinística "as primeiras N"), 44 estados distintos
ponderados pela frequência, com as **mesmas perguntas** do `policy/jev_questions.json` e a tradução
`noul`→`choice` **no cliente**.

| medida | valor |
|---|---|
| carga do modelo | **4,6 s** |
| memória do processo (pico) | **1,81 GB** (RSS) |
| censo completo | **1 min 31 s** (wall clock) |
| latência por estado (3 perguntas) | p50 **1943 ms** · p95 **2119 ms** · máx 2210 ms |
| `act` (por ciclo) | **`buy` 2530** (80 %) · `hold` 614 |
| `act` (por estado) | `buy` **37/44** · `hold` 7/44 |
| confiança do acto escolhido | 0,381 – **0,501** |
| `noul` | **0,816 – 0,944 em 44/44** |
| par neutro (a mesma pergunta como `choice` A/B) | **A (=sim) em 44/44**, P(A) 0,67 – 0,97 |
| tokens por chamada | 372 – 387 |

**Quatro leituras**

1. **A Laya escolhe lado onde o Jev recusou** — `buy` em 80 % dos ciclos, contra `hold` em 3144/3144 do Jev.
   É a primeira política da tabela a produzir lado neste livro.
2. **Mas a confiança é 0,38 – 0,50 e o máximo da amostra é 0,501.** Com o θ = 0,80 da tabela,
   **`n_lados(laya) = 0`** — o mesmo zero do Jev, por outro motivo. "O mesmo θ não compara a mesma coisa"
   deixou de ser argumento e passou a número.
3. **O `noul` está pinado no ALTO:** 0,82 – 0,94 em **44/44** estados. Não é o #156 na forma descrita (colado
   ao *não*, P(true) = 0,0000) — é a mesma família, a primitiva presa num extremo. **E não é o par de
   rótulos:** a mesma pergunta feita como `choice` de 2 opções com rótulos neutros deu **A (=sim) em 44/44**.
   O travão de hostilidade da Laya dispararia em 100 % dos ciclos.
4. **A latência mata o argumento de velocidade neste host:** p95 **2,1 s** por estado, contra a mediana de
   324 ms do Jev. (P95 acima dos 800 ms: declarado, como combinado — o censo não abortou.)

**O que a Laya mostra de sensibilidade (e o que não mostra).** Os 7 estados onde ela diz `hold` são
exactamente os que têm `bot_war` ou `quiet` no `flow`, ou `thin` no `depth` (614 ciclos). Ela **lê** esses
buckets. Não lê o `tape`: diz `buy` nos estados `dump` e `dumping` — onde a `dumb` diz `sell` — com confiança
praticamente igual à dos outros. Isso não é leitura do livro, é um prior.

**Nota operacional.** O downloader do próprio cliente fez **47 MB em 55 s (~0,85 MB/s)** antes de ser
interrompido — aos 1689 MB seriam **~33 min**; com `curl` em 4 fatias paralelas (`accept-ranges` aceite)
foram **38 s**. O gargalo é o downloader, não a rede: **8,6 MB/s por stream** cru, ~10× mais rápido.

**O que falta (2b):** o checkpoint `typed-decisions`, que **não está publicado em ONNX** e exige export
próprio (`export/export_onnx.py`, `uv` + torch + onnxscript). Linha separada, sem misturar checkpoints.
Nada de wiring até lá.

**Regras da 2b, fixadas antes do `uv`** (decisão do dono): censo no **mesmo snapshot** de 3144 decisões;
reportar `act`/`conf`/`noul`/par A/B/lados/p95 **à parte** e **sem baixar o θ** (se `conf` ficar < 0,80, a
coluna §9.4 continua zero); e **recusa escrita** se o export falhar ou o p95 ficar ≥ 2 s — nesse caso **não
nasce `laya.ts`** e a Laya fica hipótese de paper. Detalhe em `provas/v4b-0/parte-2/PLANO.md`.
