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

### Interpretações que eu tive de tomar (não estavam escritas; discorda se quiseres)

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

- `outcome` +15 min, tabela confiança × acerto e `select_disagreements` são **Fase C**: não existem.
- O turno da noite é **Fase D**: não existe, e o `accept` continua manual.
- A prova de testnet com chave (T018: "hold produz Noop e buy produz uma ALO") **exige chave de testnet** e
  ainda não foi feita — o que correu foi dry-run (`wallet null`), que prova o caminho todo menos o ack do venue.
- **O `main` público não passa `tsc --noEmit`**: 7 erros de tipo, todos pré-existentes (medido num worktree de
  `a3f2f83`). O CI só corre `bun test`, por isso passam despercebidos. O meu patch não acrescenta nenhum
  (comparado erro a erro). Consertar os 7 é PR próprio, não este.

### Evidência medida desta ronda

```
bun test test          → 124 pass / 0 fail  (64 do repo + 60 novos)
tsc --noEmit           → 7 erros, exactamente os 7 do baseline
POLICY=dumb (dry-run)  → arranca, ticks a 2000 ms, ledger 20260923-BTC.jsonl,
                         state real: "tight deep dump flat flat extreme mid"
alarme do mapa         → 5 corrupções reprovam; o caso legítimo passa
```
