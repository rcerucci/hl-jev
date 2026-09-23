# PLANO-FUSAO.md — Jev (política) × Hyperliquid (execução)

Base: clone limpo de `aowang-ai/jev-trade`, `main` = `a3f2f834a1b97dd42fab1193814179ac2e96d7cd`.
Branch: `fusao/policy-risk-venue`. Mapa verificado: `INTEGRATION.md`. Alarme: `test/integration-map.test.ts`.
Estado: **planeamento**. Nenhuma ordem foi enviada, nenhum segredo foi lido, copiado ou registado.

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

**Fase 0 (feita nesta rodada)** — clone limpo, SHA gravado, `INTEGRATION.md`, alarme do mapa a correr no CI.
**Fase A** — solda seca: `snapshot → state → verdict mock → intent → planFromRisk → submit existente`. Sem chave Jev.
**Fase B** — Jev vivo: `systemOne` + `noul` + `confidence`, timeout 800 ms, policy file versionado, ledger `decision`.
**Fase C/D/E** — outcome +15 min e tabela de atribuição · noite (`propose`/`show`/`accept`) · mainnet capado. PRs separados.

O PR desta ronda entrega **A+B**, como a §10 manda. C, D e E não entram.

## 4. Tarefas

Formato `tasks.md` do Spec Kit (validado com `validar_formato_tasks.py`). `[P]` = paralelizável.

- [ ] T001 [P] [Setup] Clonar `main` da origem e gravar o SHA de baseline — `INTEGRATION.md`
- [ ] T002 [P] [Setup] Alarme que confere os invariantes do mapa contra o código — `test/integration-map.test.ts`
- [ ] T003 [Foundational] Carregador tipado do policy file com versionamento e validação de schema — `src/policy/load.ts`
- [ ] T004 [Foundational] Cortes numéricos → adjectivos, constantes nomeadas, um só ficheiro — `src/risk/buckets.ts`
- [ ] T005 [Foundational] Tipos do veredicto e do intent da fusão (sem colidir com `Intent`) — `src/risk/types.ts`
- [ ] T006 [US1] Gates do RISK: timeout, `raw_ok`, `too_hostile`, `conf`, inventário, book velho — `src/risk/intent.ts`
- [ ] T007 [US1] Gancho no tick: RISK entre a decisão e o `planQuote` — `src/trader.ts`
- [ ] T008 [US1] Ponte intent → `QuotePlan` mantendo o contrato de `market.send` — `src/plan.ts`
- [ ] T009 [US1] Alavancagem passa a vir do config e não do modelo — `src/config.ts`, `src/trader.ts`
- [ ] T010 [US1] Ledger append-only com `kind: decision` por ciclo — `src/ledger/jsonl.ts`
- [ ] T011 [US2] Cliente Jev com `state` de ≤12 palavras e perguntas `choice`+`noul` do policy file — `src/model.ts`
- [ ] T012 [US2] Controle `POLICY=dumb` a decidir sobre os adjectivos, mesmo schema de ledger — `src/policy/dumb.ts`
- [ ] T013 [US2] Contrato de fio do desk expõe `state`/`act`/`act_conf`/`too_hostile` sem chaves — `src/types.ts`, `web/src/lib/bot-types.ts`
- [ ] T014 [P] Testes de buckets: sem dígitos, ≤12 tokens, determinístico — `test/buckets.test.ts`
- [ ] T015 [P] Testes dos gates do intent (timeout, conf, noul, inventário) — `test/intent-gates.test.ts`
- [ ] T016 [P] Testes do parser do policy file e da recusa de deriva de schema — `test/policy-schema.test.ts`
- [ ] T017 [P] Testes do ledger (duas escritas, mesmo `cycle_id`, append-only) — `test/ledger.test.ts`
- [ ] T018 [US1] Prova em testnet: `hold` → nenhuma chamada de ordem; `buy` → ALO resting, nunca market — `INTEGRATION.md`
- [ ] T019 [Polish] README: como correr em testnet, como ler a tabela de confiança, como **não** ir a mainnet — `README.md`

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
