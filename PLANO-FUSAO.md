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

**O vocabulário, medido** (7 posições, por decisões — a ordem é a do `toState`: `spread depth flow tape inventory funding clock`):

| pos | bucket | palavras |
|---|---|---|
| 0 | spread | `tight` 3109 · `normal` 25 · `wide` 9 · `unfillable` 1 |
| 1 | depth | `deep` 3104 · `thin` 35 · `ok` 4 · `empty` 1 |
| 2 | flow | `dump` 1125 · `two_way` 903 · `lift` 477 · `bot_war` 467 · `quiet` 172 |
| 3 | tape | `flat` 3005 · `grinding` 133 · `dumping` 5 · `pumping` 1 |
| 4 | inventory | `flat` 3144 |
| 5 | funding | `extreme` 3144 |
| 6 | clock | `mid` 2844 · `funding_window` 150 · `open_liq` 150 |

*(Correcção de rótulos: uma versão anterior desta tabela chamava `tape-2`/`move`/`funding` às posições 4/5/6. Os
**valores** estavam certos; os nomes não. A posição 4 é `inventory` — por isso `flat` em 100 %, não há posição
aberta — a 5 é `funding` e a 6 é `clock`.)*

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

## 16. V4b-0 (parte 2b) — `typed-decisions`: export feito, **recusa declarada** (23 set 2026)

As três regras foram fixadas **antes** do `uv` (`provas/v4b-0/parte-2/PLANO.md`, commit `663f758`). O export
correu bem — o resultado é recusa, e é recusa **pelas regras**, não por opinião.

**O export funcionou.** `export/export_onnx.py` do `receptron/laya` com `uv venv -p 3.12`, torch **CPU** 2.14,
transformers 5.17, o checkpoint `convaiinnovations/laya-typed-decisions` (842 MB) e os `.py` de referência do
repo base. Fidelidade declarada pelo próprio export contra a referência PyTorch: **`max |dlogits| = 1,16e-06`**,
`max |dact| = 0,0`. Bundle de 1,6 GB produzido em **2 min 30 s**. Tudo fora do repositório.

**Censo no mesmo snapshot de 3144 decisões (44 estados):**

| | 2a — inglês publicado | **2b — `typed-decisions`** |
|---|---|---|
| `act` por ciclo | `buy` 2530 · `hold` 614 | **`buy` 3142 · `hold` 2** |
| `act` por estado | 37/44 `buy` | **43/44 `buy`** |
| `conf` min–max | 0,381 – 0,501 | **0,370 – 0,432** |
| `noul` min–max | 0,816 – 0,944 | **0,349 – 0,645** |
| `noul` ≥ 0,65 | **3144/3144** | **0/3144** |
| par neutro A/B | A 3144 | **A 2970 · B 174** |
| p95 por estado | 2119 ms | **2102 ms** |

**Regra 1 cumprida:** mesmo conjunto (as primeiras 3144 decisões válidas), 44 estados; o JSON da 2a não foi
tocado. **Regra 2 cumprida:** `conf` máximo **0,432** < 0,80 → a coluna da §9.4 continua **zero** e o θ **não**
foi baixado. **Regra 3 accionada — RECUSA:** p95 **2102 ms ≥ 2 s** neste host → **não nasce `laya.ts`**; a Laya
fica hipótese de paper, não caminho do motor.

**O que a 2b acrescenta ao diagnóstico — mais forte do que "checkpoint errado":**

- **O `noul` não lê o critério que lhe demos.** Medido por token do estado, nos **dois** checkpoints: o `noul`
  médio é **mais baixo** nos estados com `bot_war` do que sem ele (2a: 0,861 vs 0,881; 2b: 0,467 vs 0,504). O
  critério de `true` que escrevemos ("bot_war plus violent tape") não move a primitiva na direcção pedida —
  mexe-a ao contrário.
- **A saturação tem dois sentidos e nenhum serve:** a 2a prende no alto (travão dispararia em 100 %), a 2b
  prende em baixo (`< 0,65` em 3144/3144, o travão nunca dispara) — e o **par neutro da mesma pergunta** dá
  **94,5 % "A (=sim)"** na 2b, **contra** o próprio `noul`. As duas primitivas discordam entre si.
- **O `act` é um prior, e na 2b é mais extremo:** `buy` em 99,9 % dos ciclos, `conf` 0,37–0,43, e um único
  estado onde diz `hold` (`tight thin bot_war flat flat extreme mid`). Não lê o `tape` em checkpoint nenhum.

**Consequência:** deixa de existir "era o checkpoint errado" — passa a existir *este encoder + estas 7 palavras
não são oráculo neste livro*. **A alavanca volta aos buckets** (`tape` = `flat` em 95,6 %, com o livro a mexer
dezenas de bps), não a mais um modelo. A coluna Laya da tabela §9.4 **não se abre**, e não há wiring.

## 17. Decisões de 23 set 2026: V3 vivo recusado, Laya no motor recusada, **ensaio de buckets autorizado**

| passo | veredicto |
|---|---|
| V3 vivo, com estas políticas | **Recusado.** Nenhuma política tem ≥ 20 lados (`jev` 0, `dumb` 6). |
| Laya no motor | **Recusada** (regra 3 da 2b: p95 ≥ 2 s e `conf` < θ). Coluna §9.4 fechada; paper noutro sítio, nunca no caminho de ordem. |
| Ensaio de buckets | **Autorizado** — estreito, dry-run, **só no `tape`**. |
| Campo `gate` no `verdict` | Lateral; não é o experimento. |

**Correcção de leitura do §5 (do dono — e é a certa):** o §5 proíbe usar o `dumb` ou o θ para *inventar* 20
lados. Com `n_lados = 0` nas políticas e o V3-0 a mostrar fita a mexer, a correcção que o próprio documento
aponta é **buckets / policy file**, não o modelo. **Ensaio de buckets ≠ alargar o `dumb`.**

### 17.1 Os limiares actuais do encoder, publicados (nada alterado)

Fonte: `src/risk/buckets.ts`, único sítio com cortes (spec §3.2, "sem magia espalhada").

| bucket | limiares | janela que lê |
|---|---|---|
| spread | `TIGHT 2` · `NORMAL 6` · `WIDE 15` bps | instantâneo |
| depth | `THIN 2 000` · `DEEP 20 000` USD a 10 bps | livro actual |
| flow | `QUIET_PRINTS 8` · `BOT_WAR_PRINTS 60` · `ONE_SIDED 0,25` | impressões da janela do tick |
| **tape** | **`GRIND 4` · `MOVE 15` · `VIOLENT 40` bps** | **`returns.last5`** (5 ticks ≈ 10 s) e `volBps` |
| inventory | `FLAT_RATIO 0,005` · `HEAVY_RATIO 0,5` | notional / referência de capital |
| funding | `NEUTRAL 0,1` · `EXTREME 1` bps | hora corrente |
| clock | `SETTLE 5` · `FUNDING_FROM 55` · morto 2–5 h | minuto UTC |

### 17.2 O "antes": o adjectivo não nomeia o movimento que o outcome mede

Medido nos outcomes do ledger (`provas/buckets/antes-depois.py`), cruzando a palavra do estado com o
\|movimento a 15 min\| que o `outcome` **já** grava:

| `tape` | n | \|mov 15 min\| mediana | ≥ 10 bps |
|---|---|---|---|
| `dumping` | 5 | 26,7 bps | 100 % |
| **`flat`** | **429** | **15,4 bps** | **52,7 %** |
| `grinding` | 19 | 6,2 bps | 21,1 % |
| `pumping` | 1 | 4,8 bps | 0 % |

| `flow` | n | \|mov 15 min\| mediana | ≥ 10 bps |
|---|---|---|---|
| `two_way` | 30 | 45,7 bps | 100 % |
| `dump` | 187 | 24,3 bps | 94,1 % |
| `lift` | 27 | 4,4 bps | 0 % |
| `bot_war` | 210 | 4,1 bps | 13,8 % |

**O número que decide:** `|mov 15 min| ≥ 10 bps` em **235/454** ciclos (51,8 %) e, desses, **226 (96,2 %)
tinham `tape = flat`**. E `flat` (n = 429, 94,5 % da amostra) tem mediana de **15,4 bps** — **maior** que
`grinding` (6,2 bps). Na ordem semântica (`flat` → `grinding` → `pumping` → `dumping`) as medianas são
**15,4 → 6,2 → 4,8 → 26,7**: **não crescem**. O adjectivo não está a ordenar o movimento que o outcome mede.

### 17.3 Três leituras estruturais (só leitura — nada foi alterado)

1. **Mismatch de janela, lido no código:** o `tape` lê **`returns.last5`** e `lastN` conta **ticks** — a série
   `mids` é empilhada uma vez por tick (`trader.ts:89`). Com `TICK_MS=2000`, `last5` = **10 s** e `last20` =
   **40 s**, contra os **900 s** do `outcome`: 90× de diferença hoje, 22× com o patch. `flat` fala do instante,
   não do horizonte.
2. **O sinal de que se precisa já existe e não é usado:** o `Snapshot` traz `returns_bps { last1, last5, last20 }`
   e o encoder usa **só `last5`**. Um `tape` que leia `last20` **não inventa sinal nenhum** — passa a ler o que
   já está calculado. (Proposta para o passo seguinte; **não** aplicada aqui.)
3. **Dois buckets quase sem informação neste livro:** `funding` = `extreme` em **100 %** dos ciclos (o corte é
   1 bps e a testnet paga sempre acima) e `flow` = `bot_war` em **210/454 (46 %)** — e é justamente o `bot_war`
   que tem a **menor** mediana de movimento (4,1 bps). O critério de hostilidade que escrevemos no
   `jev_questions.json` cita precisamente esses dois.

### 17.4 Regras do ensaio, fixadas pelo dono antes de tocar no encoder

1. **Dry-run**, `HL_TESTNET=true`; sem signer se o caminho fundido o permitir, senão `hold` forçado no venue.
2. Não se mexe no `dumbHostile`, não se acrescenta `violent`, não se ensina o `dumb` a ler `dump` como `dumping`.
3. Não se mexe no `jev_questions.json` nem no θ.
4. **Critério de sucesso do encoder, não da tabela §9.4:** em janelas com `|mov 15 min| ≥ 10 bps`, o `tape` passa
   a `{pumping, dumping, grinding}` de forma **monótona** com `|mov|` — avaliada na **ordem semântica**
   (`flat` < `grinding` < `pumping`/`dumping`) por `provas/buckets/antes-depois.py`. Publicar `%flat` vs `|mov|`
   **antes/depois** com o mesmo comando. Sem isso, é cosmética. *(Nota de método: a primeira versão do script
   verificava a monotonia comparando a lista com ela própria ordenada — passava sempre. O alarme tem de olhar
   para a ordem semântica, não para a forma da lista.)*
5. O Jev no estado **novo** reporta-se à parte. Se continuar 100 % `hold` com `tape` a variar, o problema passou
   das buckets para as perguntas — **e pára-se**. Não se abre a Fase D.
6. `n_lados ≥ 20` **não** é meta deste ensaio; se aparecer como efeito, mede-se e não se caça.
7. **Offline só existe se o ledger tiver o `TradeState` numérico** — e não tem: a linha de decisão guarda as
   **7 palavras**, não o snapshot. Logo o "depois" é **vivo**, com o encoder novo e snapshot datado; o "antes"
   é o §17.2, tirado do ledger.
8. **Regra 8 (aceite em 23 set 2026) — a janela do `tape` não pode ser a do rótulo.** Alinhar o `tape` com os
   900 s tornaria a monotonia da regra 4 **tautológica** e daria ao Jev o futuro do teste. O patch usa
   **`last20` = 20 ticks ≈ 40 s** (correcção de unidades: `lastN` conta ticks, não segundos — `TICK_MS=2000`),
   que o processo **já calcula**: nenhuma série nova, e `mark_plus_15m` **nunca** entra no estado.

### 17.5 O patch (passo 3) — `tape` passa a ler `last20`

Um campo, uma linha de lógica em `src/risk/buckets.ts`: `returns.last5` → **`returns.last20`**. Limiares
`GRIND 4` / `MOVE 15` / `VIOLENT 40` **intocados**, `flow` e `funding` intocados, `dumb` intocado,
`jev_questions.json` e θ intocados. Teste novo que **pina a janela** (20 s diz `pumping`, 5 s diz `flat` → tem
de seguir os 20 s): sem ele, uma regressão para `last5` passaria despercebida, porque o teste antigo alimentava
os dois campos com o mesmo valor.

**Sucesso = monotonia semântica do `tape` E `%flat` entre os ciclos com `|mov 15 min| ≥ 10 bps` a descer de
96,2 %.** Medido pelo mesmo `provas/buckets/antes-depois.py`, agora com `--desde` no início da sessão nova para
não misturar encoder antigo e novo no mesmo número. `n_lados ≥ 20` continua a **não** ser meta. Se `last20`
ainda der ~95 % `flat`, **pára-se e publica-se** — sem mexer em `GRIND`/`MOVE` no mesmo PR.

**Filac de arranque (descartada na medição).** A janela `last20` precisa de 20 ticks para encher: nos primeiros
~40 s de sessão o valor é 0 por construção e o `tape` diz `flat` por fila vazia, não por leitura. O bloco do
"depois" usa `--desde` = **primeiro ciclo real + 60 s** (30 ticks, margem sobre os 20), medido — não o instante
em que o processo foi lançado. Sem isso, o "depois" mistura artefacto de arranque com leitura.

### 17.6 O "depois", primeira leitura (23 set 2026) — o vocabulário mudou; o veredicto ainda não é legível

Sessão em dry-run com o encoder `last20`, fronteira `20260923T183724Z`. O worker do produto **não tem filtro** e
morre no 429/CDN antes de chegar aos ciclos novos, por isso a janela foi graduada com
`provas/buckets/graduar-desde.ts`, que **importa as funções do produto** (`Ledger`, `outcomeFor`,
`HlMarkSource`) e só acrescenta o filtro por `cycle_id` e um espaçamento de 1,2 s entre pedidos. 80 ciclos
graduados.

| | antes (`last5`) | depois (`last20`) |
|---|---|---|
| amostra graduada | 454 outcomes | 80 |
| `\|mov 15 min\| ≥ 10 bps` | 51,8 % | 100 % |
| **desses, com `tape = flat`** | **96,2 %** | **51,2 %** |
| `tape` no total | `flat` 94,5 % · `grinding` 4,2 % · `dumping` 1,1 % · `pumping` 0,2 % · `violent` **0** | `flat` 51 % · `grinding` 26 % · **`violent` 22,5 %** |
| mediana de `\|mov\|` por palavra | `flat` 15,4 · `grinding` 6,2 · `dumping` 26,7 · `pumping` 4,8 | `flat` 26,5 · `grinding` 26,5 · `violent` 27,4 |

**O que isto já diz:** a janela mudou o vocabulário, e mudou-o muito — `%flat` entre os ciclos que se movem caiu
de **96,2 % para 51,2 %**, `grinding` passou de 4,2 % para 26 % e `violent`, que **nunca** aparecia, aparece em
22,5 %. **A primeira metade do critério da regra 4 passou.**

**O que isto ainda não diz:** se as palavras **ordenam** o movimento — e o número agregado esconde um problema
de amostra:

- os 80 ciclos graduados cobrem **2,6 minutos** (18:37:25Z→18:40:03Z) e há apenas **4 valores distintos** de
  `mark_then` e de `\|mov\|`: é **uma** direcção amostrada 80 vezes, não 80 observações. As medianas por palavra
  (`flat` 26,5 · `grinding` 26,5 · `violent` 27,4) são o mesmo movimento com três nomes;
- o lado "antes" tem o mesmo defeito (454 outcomes em 23,6 min = 2 janelas). Em **janelas independentes**
  (≥ 900 s entre amostras, `--independentes`), o corpus reduz-se a **3 janelas no antes e 1 no depois** — e
  nessa leitura o `%flat` é 1/1 dos dois lados.

**Veredicto: nem PASS nem FAIL.** O critério da regra 4 não é julgável com uma janela de cada lado. O que se
faz: **não se toca em `GRIND`/`MOVE`**, deixa-se a sessão correr e volta-se a ler quando houver **≥ 3–5 janelas
independentes** no "depois" (≈45–75 min de sessão). `n_lados ≥ 20` continua a não ser meta.

### 17.7 Conclusão do teste (23 set 2026, leitura das 19:46Z) — o critério **não** fica estabelecido

Sessão em curso: 68 min, 1192 ciclos, encoder `last20`, dry-run. Âncoras graduadas com `--independentes` — uma
por janela de 900 s, que é a única amostra em que a regra 4 pode ser lida sem repetir a mesma observação:

| âncora | `tape` | estado | \|mov 15 min\| |
|---|---|---|---|
| 18:37:25Z | `flat` | `tight deep two_way flat flat extreme mid` | **18,9 bps** |
| 18:55:03Z | `flat` | `tight deep dump flat flat extreme funding_window` | 3,8 bps |
| 19:10:03Z | **`grinding`** | `tight deep lift grinding flat extreme mid` | 9,7 bps |
| 19:25:03Z | `flat` | `tight deep two_way flat flat extreme mid` | 0,8 bps |
| *antes* (3 âncoras) | todas `flat` | — | mediana 4,4 bps |

1. **A única âncora com `|mov| ≥ 10 bps` foi `flat`** — exactamente a falha que o critério aponta. n=1 não
   decide, mas é o único ponto que existe, e aponta ao contrário do pretendido.
2. **A monotonia "cresce"** (`flat` 3,8 → `grinding` 9,7) **assenta em n=1** para a palavra positiva: um ponto
   favorável não é um resultado.
3. **O lado "antes" nem é julgável:** 3 âncoras, todas `flat` — sem variância para ordenar. A comparação
   antes/depois por janelas independentes é, com este corpus, impossível.
4. **O alargamento de janela é real e visível** (amostra densa: `%flat` 96,2 % → 51,2 %; as cinco palavras do
   `tape` passam a aparecer, `violent` 0 → 40, `pumping` 1 → 11). Mas *"o vocabulário ficou mais rico"* não é
   *"o vocabulário ordena o movimento"*.

**Quantas âncoras seriam precisas:** a 1 por 15 min, 20 âncoras são **5 h** de sessão, e a amostra só serve
com as palavras todas representadas. Em 68 min há 4. **O teste não fecha numa sessão.**

**Conclusão: nem PASS nem FAIL — e o único ponto que existe aponta ao contrário.** Nada se altera: `GRIND`/`MOVE`
intocados, nenhum segundo patch, `n_lados ≥ 20` fora de meta. Manter `last20` a acumular ou reverter é decisão
do dono. *(Recomendação: manter e acumular — a janela mais longa é a direcção certa e a amostra densa mostra
que o encoder responde; falta tempo de sessão, não outro ajuste.)*

**Nota de método para a próxima leitura:** a unidade certa é a **janela**, não o ciclo — agrupar os ciclos *de
dentro* de cada janela de 15 min pela palavra dominante e comparar o movimento **entre** janelas. Usa todos os
dados sem contar a mesma observação duas vezes, o que escolher um ciclo por janela (4 âncoras em 68 min) não faz.

### 17.8 Decisão do dono (23 set 2026): **manter `last20`**; a próxima medição muda de unidade

| | |
|---|---|
| `last20` no encoder | **Mantém-se.** Não se reverte. A janela de 40 s é a direcção certa (regra 8: longe dos 900 s do rótulo, longe dos 10 s que não nomeavam nada), e a amostra densa mostra o encoder a falar. Reverter voltaria a um adjectivo que, medido, não nomeava o movimento. |
| Regra 4 | **Amostra insuficiente.** n=1 a favor e n=1 contra não estabelecem nada; a única âncora com `≥ 10 bps` foi `flat`. |
| `GRIND` / `MOVE` / `dumb` / θ / JSON | **Intocados.** Nenhum segundo patch de limiar. |
| Jev 100 % `hold` e `n_lados` | Fora de meta. Laya e Fase D: fechadas. |

**Próxima medição — palavra dominante por janela de 15 min.** Não é encoder novo: é o mesmo
`antes-depois.py` com agrupamento por janela (`--janelas`). Por janela de 900 s ancorada no início da sessão:
a palavra do `tape` **dominante** (moda sobre todos os ciclos de dentro da janela) e o `|mov|` do outcome da
âncora dessa janela — movimento independente, palavra sem ruído de um só ciclo.

**Meta de sessão: horas, não mais um commit.** 20 janelas ≈ **5 h**; até lá o veredicto da regra 4 continua
"amostra insuficiente". O motor em dry-run pode acumular.

### 17.9 Primeira leitura por janelas (23 set 2026) — `flat` dominante em **100 %** das janelas, nos dois encoders

Método novo (`--janelas` no mesmo script): por janela de 900 s, a palavra do `tape` **dominante** (moda sobre
todos os ciclos de dentro da janela) e o `|mov|` da âncora da janela.

| janela | ciclos | dominante | % dominante | \|mov 15 min\| |
|---|---|---|---|---|
| 18:37 | 450 | `flat` | 77,3 % | **18,9 bps** |
| 18:52 | 450 | `flat` | 93,8 % | 3,8 bps |
| 19:07 | 450 | `flat` | 80,7 % | 9,7 bps |
| 19:22 | 450 | `flat` | 74,7 % | 0,8 bps |
| 19:37 | 450 | `flat` | 94,4 % | **31,0 bps** |
| 19:52 | 92 | `flat` | 71,7 % | *por graduar* |

O lado "antes" (`last5`, 11 janelas) é igual: **`flat` dominante em todas**, 90,4 %–100 %.

Com a âncora das 19:37 graduada, a amostra dobra e **vai contra**: **2 janelas com `|mov| ≥ 10 bps` — e as
duas com `flat` dominante**. Numa delas o livro andou **31,0 bps em 15 min** e o adjectivo do bucket foi
`flat` em 94,4 % dos ciclos dessa janela.

**As duas leituras que isto dá — e que a leitura por âncora não dava:**

1. **Não há variância nenhuma para ordenar.** Com `flat` dominante em **100 %** das janelas, do encoder de 10 s
   e do de 40 s, a regra 4 não é "amostra insuficiente": é **não aplicável nesta condição** — não existe par de
   janelas com palavras diferentes para comparar.
2. **E sabe-se porquê, medido:** o corte `MOVE 15 bps` dentro de 40 s é raro por construção. No corpus novo,
   `pumping` + `dumping` = **16 de 1192 ciclos (1,3 %)**; `violent`, 40 (3,4 %). Para uma janela de ~450 ciclos
   ter palavra dominante ≠ `flat` seria preciso que **mais de metade** dos seus ciclos passasse o corte.

**Consequência para a meta das 5 h:** acumular horas **não** muda a palavra dominante — com 1,3 % de ciclos
acima do corte, a probabilidade de uma janela virar é desprezável. As 20 janelas continuam a valer como amostra
de *movimentos*; o que elas não resolvem é a ausência de variância do adjectivo. Mudar isso exige mexer no
**corte** ou na **janela do bucket** — `GRIND`/`MOVE` estão fora do meu alcance por decisão do dono (§17.4.2) e
o ensaio não lhes toca sem autorização nova.

**Nada se altera neste passo:** `last20` fica, limiares ficam, `dumb`/θ/JSON intactos, `n_lados` fora de meta.

**Nota de método — uma reserva minha à estatística escolhida.** A palavra **dominante** é enviesada para `flat`
por construção: `flat` é o *default* do bucket, e basta o livro não andar 4 bps em 40 s para lá cair. Na janela
das 18:37, **23 % dos ciclos não eram `flat`** (`grinding` 51, `violent` 40, `pumping` 11) e a dominante é `flat`
à mesma. O complemento — a palavra **mais extrema** vista dentro da janela (ou o `max |last20|`) — responderia a
outra pergunta: *"o bucket chegou a captar o movimento?"* em vez de *"o que o estado diz na maior parte do
tempo?"*. Fica como proposta; não a implemento sem o dono pedir, para não multiplicar estatísticas a meio do ensaio.

### 17.10 O ensaio de buckets do `tape`, nesta letra, fica **encerrado** (23 set 2026)

**Decisão do dono.** `MOVE`/`GRIND` **não se abrem**: baixar o corte para a dominante deixar de ser `flat` seria
caçar variância — primo de alargar o `dumb`. `last20` **fica** (vocabulário mais rico, regra 8 respeitada). A
palavra **extrema** entra só como **diagnóstico** e **nunca promove**.

**O diagnóstico — primeiro e único uso autorizado** (`--janelas`, coluna `extrema`):

| janela | \|mov 15 min\| | dominante | extrema | % dos ciclos na extrema |
|---|---|---|---|---|
| 18:37 | 18,9 bps | `flat` | **`violent`** | 8,9 % |
| 18:52 | 3,8 bps | `flat` | `grinding` | 6,2 % |
| 19:07 | 9,7 bps | `flat` | **`dumping`** | 3,8 % |
| 19:22 | 0,8 bps | `flat` | `grinding` | 25,3 % |
| 19:37 | **31,0 bps** | `flat` | `grinding` | 5,6 % |

- **O bucket dispara onde o movimento é rápido:** na janela das 18:37 chegou a `violent` em 8,9 % dos ciclos, e
  na das 19:07 a `dumping`. No encoder antigo o máximo por janela nunca passava de `dumping` a 1,9 %. **O
  encoder novo fala mais, e mais alto.**
- **E a janela de 31,0 bps não teve um único disparo:** o movimento de 15 min foi **gradual** — nenhum intervalo
  de 40 s passou 15 bps. Nenhuma janela de 40 s veria isto, por construção.

**O que o ensaio passou a significar.** O `tape` a 40 s descreve **microestrutura**; o `outcome` descreve
**15 minutos**. Não se ordenam pela palavra que ocupa 75–94 % da janela, e a correcção não é o corte nem a
janela — é reconhecer que são **dois relógios**. **O ensaio de buckets do `tape`, nesta letra, está encerrado.**

**O que continua aberto, e não foi respondido por isto:** o Jev escolhe `hold` em 100 % dos ciclos também com o
estado novo. Essa é a pergunta das **perguntas/modelo**, não do `tape` — a mesma que já estava em cima da mesa
antes deste ensaio. Sem Laya, sem Fase D, sem segundo patch de limiar.

## 18. Ensaio das perguntas (v2) — 23 set 2026 *(FECHADO: estado sem poder preditivo — ver §20)*

O ensaio de buckets fechou com uma conclusão incómoda: **100 % `hold` mesmo com o estado novo**. Fica uma
hipótese que o `tape` não pode responder — o Jev pode estar a recusar **o livro** ou a recusar um **enunciado
incoerente** com o vocabulário que recebe. É isso que este ensaio separa.

### 18.1 As incoerências medidas entre o texto (v1) e o vocabulário real

| o v1 pedia | o encoder emite, neste livro |
|---|---|
| `too_hostile=true` se "funding extreme against the would-be add" | a posição do funding é **`extreme` em 100 %** dos ciclos — e o adjectivo **não diz a direcção**, logo "against the add" é impossível de avaliar |
| `too_hostile=true` se "bot_war plus violent tape" | `flow=bot_war` **sozinho** é 46 % dos ciclos — e é o fluxo com **menor** movimento (mediana 4,1 bps) |
| `buy` "without chasing a violent tape"; `sell` "without chasing a dump" | `violent` (tape) é **raro** (3,4 %) e pode estar a anular qualquer lado; e "dump" é palavra do **flow** enquanto a do **tape** é `dumping` — dois buckets citados com o mesmo nome |

*(A tabela do §17.2 tinha as posições 4/5/6 mal rotuladas — `tape-2`/`move`/`funding`; os valores estavam
certos, os nomes não. Corrigido: 4 = `inventory`, 5 = `funding`, 6 = `clock`.)*

### 18.2 O que muda — só o texto (`policy/jev_questions.json`, `version: 2`)

Mesmas duas perguntas, mesmo schema (`act` = choice com buy/sell/hold; `too_hostile` = noul com true/false).
O enunciado passa a citar **palavras que o encoder emite**, com o **bucket certo**:

- **`too_hostile=true`** = `spread` é **`unfillable`** ou `tape` é **`violent`**. **Caem** o `funding extreme` e o
  `bot_war plus violent tape`; `bot_war` sozinho **não** é hostil.
- **`act`**: `buy` pede **`flow=lift`** ou **`tape=pumping`**; `sell` pede **`flow=dump`** ou **`tape=dumping`**;
  `hold` = **`tape=flat`**, inventário já expressa a vista, ou livro hostil. **Sai** o "without chasing a violent
  tape". `grinding` fica declarado como **sem direcção** — não é sinal de lado sozinho.

### 18.3 O que **não** muda

`last20`, `GRIND`/`MOVE`/`VIOLENT`, `dumb`, `JEV_CONF_ACT=0,80`, `NOUL_HOSTILE_TH=0,65`, venue, Laya, Fase D,
mainnet. Dry-run, sem signer.

### 18.4 Como se julga (não é `n_lados ≥ 20`)

Sessão **datada** — fronteira no log no arranque do v2 —, **≥ 2 h ou ≥ 8 janelas de 15 min**, tabela v1 × v2 **no
mesmo encoder**. `n_lados ≥ 20` continua **fora** de meta; se aparecer, mede-se.

**PASS (um chega):**

1. `sidesAny > 0` — aparece `buy` ou `sell` a **qualquer** confiança; o gate pode continuar a cortar.
2. O `noul` **sobe** com `unfillable`/`tape=violent` e **não** com `bot_war` isolado — as perguntas passaram a ler
   o vocabulário.

**FAIL:** 100 % `hold` **e** o `noul` continua a seguir `bot_war`/`funding`. Então o texto também não era a
alavanca: **para-se**, sem abrir a Fase D e sem baixar θ.

### 18.5 Leitura interina (23 set 2026, ~20:09Z) — **PASS 1**, e vê-se a incoerência do v1

Fronteira `20260923T200827Z`, motor com o texto v2 em dry-run. Ao fim de ~30 ciclos:

| | v1 (7 059 ciclos válidos) | **v2 (30 ciclos)** |
|---|---|---|
| `act` | `hold` **7059 / 7059** | **`sell` 29 · `hold` 1** |
| `sidesAny` | 0 | **29** |
| `act_probs` médios | — | `sell` **0,814** · `hold` 0,158 · `buy` 0,028 |
| `act_conf` | mediana 0,420 | 0,73 – **0,80** |
| `noul` | mediana 0,520 | **0,28 – 0,31** |
| intents | `none` | `none` 28 · **`maker` 2** |
| ordens no ledger | nenhuma | nenhuma (`fill: null` — dry-run) |

**O estado destes ciclos é `tight deep dump flat flat extreme mid`** — contém **`flow=dump`**. É aqui que a
incoerência do v1 fica à vista: o critério de `sell` no v1 dizia *"hit or reduce a long **without chasing a
dump**"* — o texto **mandava não vender exactamente o adjectivo que o estado estava a mostrar**. O v2 diz o
contrário (*"flow is dump … or tape is dumping"*) e o modelo passou a `sell` com convicção média 0,81.

**PASS 1 cumprido** (`sidesAny > 0`). Efeito lateral medido e declarado: **`n_lados` deixou de ser zero** — dois
ciclos com `conf ≥ 0,80` geraram intent **`maker`** e o gate deixou passar. Continua **fora** de meta, como
combinado: mede-se, não se caça. Nada saiu para o venue — dry-run, sem signer, `fill: null` nos 30 ciclos.

**O que falta para fechar:** a sessão das 2 h (≥ 8 janelas), para ver se o lado se mantém noutros estados e se o
critério 2 se confirma. No v1, os grupos do `noul` eram: `tape=violent` **0,84** · `flow=bot_war` 0,79 · resto
0,51 — o violento já subia mais, mas por pouco.

### 18.6 Leitura completa (2 h, 13 janelas de 15 min, 22:09Z) — **PASS 1 estabelecido**

| | v1 | **v2 (3 501 válidos, 55 estados)** |
|---|---|---|
| `act` | `hold` 7 059 / 7 059 | **`sell` 1 803 · `hold` 918 · `buy` 780** |
| `sidesAny` | 0 | **2 583** |
| `act_conf` | mediana 0,420 | 0,27 – **0,96**, mediana 0,53 |
| `noul` | mediana 0,520 | 0,15 – 0,53, mediana **0,280** |
| `noul` por grupo | `violent` 0,84 · `bot_war` 0,79 · resto 0,51 | `bot_war` 0,25 (n=181) · resto 0,28 — **`unfillable`/`violent`: n = 0** |

Pelo **gate real** (`MIN_HIGH_CONF` 0,80 · `NOUL_HOSTILE_TH` 0,65), nas duas sessões:

| | válidas | `conf ≥ 0,80` | `noul ≥ 0,65` | **`n_lados`** | intents |
|---|---|---|---|---|---|
| v1 | 7 059 | 773 | 1 253 | **0** | `none` 7 240 |
| **v2** | 3 508 | **415** | **0** | **48** | `none` 3 592 · **`maker` 48** |

**`n_lados` deixou de ser zero: 48 intents `maker`, todos `sell`.** Zero `fill` não-nulo em toda a sessão — 48
ordens simuladas, nenhuma no venue (dry-run, sem signer). Continua **fora** de meta: medido, não caçado.

#### O modelo passou a ler o vocabulário (diagnóstico, `act` × `flow`)

| `flow` | n | resposta |
|---|---|---|
| `dump` | 1 810 | **`sell` 100,0 %** |
| `lift` | 761 | **`buy` 100,0 %** |
| `two_way` | 587 | **`hold` 100,0 %** |
| `bot_war` | 181 | `hold` 89,5 % · `buy` 10,5 % |
| `quiet` | 169 | **`hold` 100,0 %** |

E o `tape` quando é a única palavra com direcção: `tape=pumping` (n=19) → **`buy` 100,0 %**; `tape=grinding`
(n=269) → `hold` 53,9 % (a palavra declarada **sem direcção** no v2) — onde não há palavra de direcção no `flow`,
o modelo não inventa lado. **A leitura é literal e coerente com o enunciado.**

#### Veredicto

- **PASS 1 (estabelecido):** `sidesAny = 2 583` em 3 501 ciclos válidos e 13 janelas; 48 lados passaram o gate.
- **Critério 2 (não avaliável):** a sessão **não teve um único ciclo** com `spread=unfillable` ou `tape=violent`
  (n = 0 em ambos), logo o teste "o `noul` sobe com violento e não com `bot_war`" não se pode fazer. Não é FAIL do
  modelo — é ausência do caso. O que se viu em vez disso foi o `noul` a **descer** (mediana 0,52 → 0,28) e a
  **nunca** cruzar 0,65.
- **O que continua por medir:** a **regra 4** e o PnL. O ensaio das perguntas passou; o que ele conquistou foi
  tornar a regra 4 **medível** — passaram a existir lados. Não é PASS da política, nem de PnL.

***Linha para ele:** PR #16 merge. Ensaio v2 passou: `sidesAny` 2583 (v1: 0), 48 intents `maker` pelo gate, zero no
venue. Modelo lê o vocabulário 1:1 (`dump`→sell 100 %, `lift`→buy 100 %). Critério 2 não avaliável (n=0 de
violent/unfillable). `n_lados` saiu de zero — medido. Regra 4 e PnL continuam por medir: o ensaio tornou-os
medíveis.*

### 18.7 Graduação 15 min da sessão v2 — **medição, não ensaio novo** (especificação do dono, colada)

> **Graduação 15 min da sessão v2 (desde `20260923T200827Z`). Medição, não ensaio novo.**
>
> `sell` / `buy` / `hold` são **etiquetas do JSON**, não o movimento. A graduação **não** pergunta se "`sell` é
> sell". Pergunta: neste estado, o preço subiu ou desceu a seguir, e que etiqueta o Jev pôs.
>
> **Unidade.** Não é o ciclo. 400 ticks no mesmo estado = **1 caso**, não 400. (1) Agrupar pelas 7 palavras.
> (2) Partir em episódios cuja janela de 15 min **não se sobrepõe**. (3) Um ponto = (estado × episódio): `act`,
> `dir_after`, |mov|.
>
> **O que publicar.** Tabela por episódio:
> `estado` · `n_ticks` · `act` · `conf` · `noul` · `dir_after` · `|mov|` · `etiqueta_vs_preço`.
> `etiqueta_vs_preço` só descritivo, **três valores**: `alinhou` (`sell`+`down` ou `buy`+`up`) · `inverteu`
> (`sell`+`up` ou `buy`+`down`) · `sem_relacao` (hold, |mov| < 10 bps, ou o mesmo estado com os dois sentidos).
> **Não** chamar a isto acerto do modelo. É acerto da **convenção que nós escrevemos**. Se o mesmo estado umas
> vezes sobe e outras desce: o mapa estado→palavra pode ser estável e o estado **não prever** o preço. Escrever
> isso.
>
> **Separar.** `sidesAny` e `n_lados` em colunas distintas. `hold` não entra em alinhou/inverteu. Relatório:
> quantos **episódios**, não quantos ciclos. Não promover winrate de 1803 `sell`.
>
> **Proibido.** Segundo JSON, θ, `dumb`, Laya, D, mainnet, chamar PnL a dry-run, concluir "o Jev acerta" a partir
> de `alinhou`.
>
> **Leitura permitida no fecho.** Convenção alinhou nesta amostra · Convenção invertida (etiqueta estável,
> sentido económico errado) · Estado sem poder preditivo. **Uma destas. Não duas.**

Implementado em `provas/perguntas/graduar-episodios.py` (unidade = estado × episódio, episódios não sobrepostos
de 900 s, `|mov|` pela fórmula do produto em `src/ledger/outcome.ts`). Os pontos por graduar são exactamente o
**ciclo de início de cada episódio** — 93 na primeira contagem — e o graduador
(`provas/buckets/graduar-desde.ts --ciclos <ficheiro>`) grava só esses, não os 4 481 ciclos da janela.

#### Resultado (sessão de 2,5 h, leitura às 22:5xZ; o motor v2 continua a correr)

| | |
|---|---|
| **episódios** (a unidade) | **100** |
| ciclos na janela | 4 770 — **não** é o denominador |
| `alinhou` · `inverteu` · `sem_relacao` | **3 · 17 · 80** |
| `sem_relacao` por **mesmo estado com os dois sentidos** | **39 episódios em 13 estados** |
| `sem_relacao` por `|mov|` < 10 bps | 33 |
| `sem_relacao` por `act` hold | 44 |
| `sidesAny` (coluna própria) | **3 289** |
| `n_lados` (coluna própria, ≥ 0,80 e `noul` < 0,65) | **48** |
| pontos por graduar nesta leitura | 7 (pendentes para a passagem seguinte) |

**Leitura (uma das três):** **estado sem poder preditivo.**

O mapa estado→palavra é **estável** — a matriz `act` × `flow` do §18.6 dá uma resposta por palavra a 100 % — e
mesmo assim **13 estados que levaram `sell`/`buy` moveram-se nos dois sentidos**, em episódios que não se
sobrepõem. O exemplo mais claro:

| estado | episódios e sentidos |
|---|---|
| `tight deep dump flat flat extreme mid` (`sell`) | `up` em 2 episódios · `down` em 2 + 1 |
| `tight deep lift flat short_small extreme mid` (`buy`) | `up` · `down` · `flat` |
| `tight deep two_way flat flat extreme mid` (`hold`) | `up` · `down` |

Não é a etiqueta a oscilar: é o **preço** a não seguir a palavra. Por isso as 39 observações do mesmo estado com
os dois sentidos dominam (39 > 17), e a leitura é a de **ausência de poder preditivo**, não a de convenção
alinhada nem a de convenção invertida.

**Não é acerto do modelo.** É a convenção que **nós** escrevemos no JSON, comparada com o movimento. Nenhum
winrate dos 1 803 `sell` é promovido; `hold` (44 episódios) não entra em alinhou/inverteu.

Dois limites desta leitura, declarados: os **movimentos são pequenos** (33 episódios abaixo dos 10 bps, e o maior
é 13,5 bps), e **7 pontos estavam por graduar**. Com um livro mais movimentado — `tape=violent`, que nesta sessão
não apareceu uma única vez — a mesma tabela pode dizer outra coisa.

<details>
<summary><b>Tabela completa por episódio</b> (100 linhas: `estado` · `n_ticks` · `act` · `conf` · `noul` · `dir_after` · `|mov|` · `etiqueta_vs_preço`)</summary>

| estado | n_ticks | act | conf | noul | dir_after | \|mov\| bps | etiqueta_vs_preço |
|---|---|---|---|---|---|---|---|
| `tight deep dump flat flat extreme mid` | 152 | sell | 0.76 | 0.28 | up | 47.9 | **sem_relacao** |
| `normal deep dump grinding flat extreme mid` | 1 | sell | 0.76 | 0.3 | up | 37.0 | **inverteu** |
| `tight deep bot_war grinding flat extreme mid` | 45 | hold | 0.94 | 0.2 | up | 37.0 | **sem_relacao** |
| `normal thin dump flat flat extreme mid` | 2 | sell | 0.8 | 0.16 | up | 36.7 | **sem_relacao** |
| `wide thin dump flat flat extreme mid` | 2 | sell | 0.735 | 0.2 | up | 34.0 | **inverteu** |
| `tight deep dump grinding flat extreme mid` | 37 | sell | 0.77 | 0.3 | up | 34.0 | **sem_relacao** |
| `normal deep dump flat flat extreme mid` | 1 | sell | 0.77 | 0.33 | up | 30.5 | **sem_relacao** |
| `tight thin dump flat short_small extreme open_liq` | 2 | sell | 0.43 | 0.255 | up | 28.3 | **inverteu** |
| `tight deep lift flat short_small extreme open_liq` | 18 | buy | 0.425 | 0.29 | up | 27.5 | **alinhou** |
| `tight deep dump flat short_small extreme open_liq` | 130 | sell | 0.42 | 0.35 | up | 27.5 | **inverteu** |
| `tight deep lift flat short_small extreme funding_window` | 15 | buy | 0.44 | 0.25 | up | 23.6 | **alinhou** |
| `wide thin lift flat flat extreme mid` | 1 | buy | 0.53 | 0.21 | down | 23.6 | **inverteu** |
| `tight deep lift flat flat extreme mid` | 71 | buy | 0.52 | 0.23 | down | 23.6 | **sem_relacao** |
| `normal deep lift flat flat extreme mid` | 1 | buy | 0.39 | 0.33 | down | 23.6 | **sem_relacao** |
| `tight deep quiet flat flat extreme mid` | 47 | hold | 0.94 | 0.16 | down | 23.4 | **sem_relacao** |
| `tight deep quiet flat short_small extreme mid` | 64 | hold | 0.73 | 0.18 | up | 20.9 | **sem_relacao** |
| `normal deep bot_war grinding flat extreme mid` | 2 | hold | 0.86 | 0.19 | up | 20.8 | **sem_relacao** |
| `tight deep bot_war flat flat extreme mid` | 41 | hold | 0.8 | 0.26 | up | 20.8 | **sem_relacao** |
| `normal deep bot_war flat flat extreme mid` | 1 | hold | 0.69 | 0.24 | up | 20.8 | **sem_relacao** |
| `tight deep dump flat short_small extreme open_liq` | 139 | sell | 0.43 | 0.35 | up | 20.8 | **inverteu** |
| `tight deep quiet flat short_small extreme open_liq` | 5 | hold | 0.57 | 0.18 | up | 20.8 | **sem_relacao** |
| `normal deep quiet flat short_small extreme mid` | 1 | hold | 0.67 | 0.18 | up | 20.6 | **sem_relacao** |
| `tight deep lift flat short_small extreme mid` | 150 | buy | 0.4 | 0.24 | up | 20.6 | **sem_relacao** |
| `normal deep dump flat short_small extreme open_liq` | 1 | sell | 0.41 | 0.43 | up | 20.5 | **inverteu** |
| `tight deep bot_war pumping flat extreme mid` | 20 | buy | 0.71 | 0.24 | up | 18.6 | **alinhou** |
| `tight thin dump flat flat extreme mid` | 2 | sell | 0.76 | 0.205 | up | 18.3 | **inverteu** |
| `normal thin dump flat flat extreme mid` | 2 | hold | 0.41 | 0.09 | down | 18.1 | **sem_relacao** |
| `tight deep bot_war flat flat extreme mid` | 74 | hold | 0.8 | 0.26 | up | 17.6 | **sem_relacao** |
| `tight deep two_way flat short_small extreme funding_window` | 2 | hold | 0.58 | 0.235 | up | 16.6 | **sem_relacao** |
| `tight deep lift flat short_small extreme mid` | 106 | buy | 0.41 | 0.24 | up | 16.2 | **sem_relacao** |
| `tight deep quiet flat short_small extreme mid` | 33 | hold | 0.72 | 0.18 | up | 15.4 | **sem_relacao** |
| `normal deep dump grinding short_small extreme open_liq` | 1 | sell | 0.46 | 0.53 | up | 15.0 | **inverteu** |
| `tight deep dump grinding short_small extreme open_liq` | 4 | sell | 0.32 | 0.345 | up | 15.0 | **inverteu** |
| `tight deep lift grinding short_small extreme mid` | 44 | buy | 0.525 | 0.29 | up | 15.0 | **sem_relacao** |
| `tight deep dump grinding flat extreme funding_window` | 3 | sell | 0.74 | 0.3 | up | 14.3 | **inverteu** |
| `tight deep dump flat short_small extreme funding_window` | 50 | sell | 0.49 | 0.35 | up | 14.3 | **inverteu** |
| `tight deep dump grinding short_small extreme funding_window` | 1 | sell | 0.31 | 0.3 | up | 14.3 | **inverteu** |
| `normal deep two_way flat short_small extreme mid` | 1 | hold | 0.54 | 0.28 | up | 14.2 | **sem_relacao** |
| `tight deep two_way grinding short_small extreme mid` | 15 | hold | 0.5 | 0.3 | up | 14.2 | **sem_relacao** |
| `tight deep dump grinding short_small extreme mid` | 27 | sell | 0.39 | 0.34 | up | 14.2 | **sem_relacao** |
| `tight deep dump flat short_small extreme funding_window` | 131 | sell | 0.5 | 0.35 | up | 13.9 | **inverteu** |
| `tight deep quiet flat short_small extreme funding_window` | 17 | hold | 0.7 | 0.18 | up | 13.9 | **sem_relacao** |
| `tight deep dump flat flat extreme mid` | 320 | sell | 0.76 | 0.28 | down | 13.6 | **sem_relacao** |
| `tight thin dump flat short_small extreme mid` | 1 | sell | 0.46 | 0.24 | up | 13.5 | **inverteu** |
| `tight deep dump flat short_small extreme mid` | 94 | sell | 0.4 | 0.33 | up | 13.1 | **sem_relacao** |
| `tight ok dump flat short_small extreme mid` | 2 | sell | 0.355 | 0.235 | up | 13.1 | **inverteu** |
| `normal deep two_way flat flat extreme mid` | 1 | hold | 0.8 | 0.38 | down | 12.7 | **sem_relacao** |
| `tight deep two_way flat flat extreme mid` | 38 | hold | 0.88 | 0.26 | down | 12.7 | **sem_relacao** |
| `tight deep two_way grinding flat extreme mid` | 20 | hold | 0.89 | 0.27 | down | 12.7 | **sem_relacao** |
| `tight deep lift flat short_small extreme mid` | 207 | buy | 0.41 | 0.25 | up | 11.5 | **sem_relacao** |
| `normal thin bot_war flat flat extreme mid` | 1 | hold | 0.92 | 0.22 | up | 11.3 | **sem_relacao** |
| `tight deep two_way flat flat extreme funding_window` | 36 | hold | 0.89 | 0.26 | up | 10.5 | **sem_relacao** |
| `tight deep dump flat short_small extreme mid` | 14 | sell | 0.41 | 0.335 | up | 10.5 | **sem_relacao** |
| `tight deep two_way flat short_small extreme mid` | 144 | hold | 0.64 | 0.24 | up | 10.5 | **sem_relacao** |
| `tight deep two_way grinding short_small extreme mid` | 52 | hold | 0.47 | 0.3 | up | 10.5 | **sem_relacao** |
| `tight thin two_way flat short_small extreme mid` | 1 | hold | 0.69 | 0.21 | down | 10.4 | **sem_relacao** |
| `tight deep dump flat flat extreme funding_window` | 45 | sell | 0.79 | 0.33 | up | 10.2 | **inverteu** |
| `tight deep two_way flat short_small extreme mid` | 45 | hold | 0.64 | 0.24 | up | 10.2 | **sem_relacao** |
| `tight deep two_way grinding short_small extreme mid` | 8 | hold | 0.495 | 0.305 | up | 10.2 | **sem_relacao** |
| `tight deep dump flat short_small extreme mid` | 317 | sell | 0.41 | 0.33 | up | 10.2 | **sem_relacao** |
| `tight deep lift grinding short_small extreme mid` | 4 | buy | 0.53 | 0.31 | down | 8.6 | **sem_relacao** |
| `tight deep dump flat flat extreme mid` | 276 | sell | 0.75 | 0.28 | down | 8.3 | **sem_relacao** |
| `normal deep lift flat short_small extreme mid` | 4 | buy | 0.37 | 0.24 | up | 8.2 | **sem_relacao** |
| `tight deep lift flat flat extreme mid` | 84 | buy | 0.52 | 0.23 | up | 7.5 | **sem_relacao** |
| `normal deep lift flat flat extreme mid` | 2 | buy | 0.405 | 0.305 | up | 7.5 | **sem_relacao** |
| `tight deep two_way flat flat extreme mid` | 128 | hold | 0.88 | 0.25 | up | 7.5 | **sem_relacao** |
| `normal deep quiet flat flat extreme mid` | 2 | hold | 0.93 | 0.16 | down | 6.8 | **sem_relacao** |
| `normal thin quiet flat flat extreme mid` | 1 | hold | 0 | 0 | down | 6.8 | **sem_relacao** |
| `tight deep quiet grinding flat extreme mid` | 1 | hold | 0.9 | 0.24 | down | 6.8 | **sem_relacao** |
| `tight deep dump grinding flat extreme mid` | 3 | sell | 0.75 | 0.31 | down | 6.8 | **sem_relacao** |
| `normal deep dump flat flat extreme mid` | 1 | sell | 0.73 | 0.35 | down | 6.8 | **sem_relacao** |
| `tight deep dump flat flat extreme mid` | 4 | sell | 0.76 | 0.29 | down | 6.8 | **sem_relacao** |
| `wide deep lift grinding short_small extreme mid` | 1 | buy | 0.59 | 0.28 | up | 6.3 | **sem_relacao** |
| `tight deep dump grinding flat extreme mid` | 2 | sell | 0.75 | 0.295 | down | 6.2 | **sem_relacao** |
| `tight deep dump flat short_small extreme mid` | 78 | sell | 0.42 | 0.32 | down | 5.8 | **sem_relacao** |
| `tight deep lift flat short_small extreme mid` | 193 | buy | 0.41 | 0.24 | down | 5.2 | **sem_relacao** |
| `tight ok lift flat short_small extreme mid` | 1 | buy | 0.46 | 0.24 | up | 4.5 | **sem_relacao** |
| `tight deep two_way flat short_small extreme mid` | 94 | hold | 0.65 | 0.24 | down | 4.2 | **sem_relacao** |
| `tight deep dump flat short_small extreme mid` | 126 | sell | 0.405 | 0.33 | down | 4.2 | **sem_relacao** |
| `tight deep dump grinding short_small extreme mid` | 20 | sell | 0.38 | 0.335 | down | 4.2 | **sem_relacao** |
| `tight deep two_way grinding flat extreme mid` | 4 | hold | 0.885 | 0.285 | down | 3.5 | **sem_relacao** |
| `tight deep bot_war flat short_small extreme mid` | 9 | hold | 0.55 | 0.28 | down | 1.6 | **sem_relacao** |
| `tight ok two_way flat short_small extreme mid` | 1 | hold | 0.63 | 0.19 | down | 1.6 | **sem_relacao** |
| `tight deep two_way flat short_small extreme mid` | 173 | hold | 0.64 | 0.24 | down | 1.6 | **sem_relacao** |
| `tight thin two_way flat flat extreme mid` | 1 | hold | 0.93 | 0.26 | down | 1.3 | **sem_relacao** |
| `tight ok two_way flat short_small extreme mid` | 1 | hold | 0.56 | 0.19 | up | 0.9 | **sem_relacao** |
| `wide deep two_way flat short_small extreme mid` | 1 | hold | 0.53 | 0.28 | up | 0.9 | **sem_relacao** |
| `tight deep two_way flat short_small extreme mid` | 20 | hold | 0.65 | 0.24 | up | 0.6 | **sem_relacao** |
| `tight thin two_way grinding short_small extreme mid` | 1 | hold | 0.57 | 0.24 | flat | 0.1 | **sem_relacao** |
| `tight deep lift flat short_small extreme mid` | 302 | buy | 0.41 | 0.24 | flat | 0.0 | **sem_relacao** |
| `tight ok lift flat short_small extreme mid` | 1 | buy | 0.52 | 0.22 | flat | 0.0 | **sem_relacao** |
| `tight thin two_way flat short_small extreme mid` | 1 | hold | 0.67 | 0.23 | flat | 0.0 | **sem_relacao** |
| `tight deep two_way flat short_small extreme mid` | 135 | hold | 0.64 | 0.24 | flat | 0.0 | **sem_relacao** |
| `tight deep lift flat short_small extreme mid` | 134 | buy | 0.42 | 0.24 | — | — | **sem_relacao** |
| `tight deep two_way flat short_small extreme mid` | 83 | hold | 0.64 | 0.24 | — | — | **sem_relacao** |
| `tight deep two_way grinding short_small extreme mid` | 27 | hold | 0.47 | 0.31 | — | — | **sem_relacao** |
| `normal deep two_way grinding short_small extreme mid` | 1 | hold | 0.52 | 0.31 | — | — | **sem_relacao** |
| `tight deep dump flat short_small extreme mid` | 30 | sell | 0.405 | 0.325 | — | — | **sem_relacao** |
| `normal deep lift grinding short_small extreme mid` | 1 | buy | 0.47 | 0.27 | — | — | **sem_relacao** |
| `tight deep lift grinding short_small extreme mid` | 11 | buy | 0.54 | 0.28 | — | — | **sem_relacao** |

</details>

*(`|mov|` pela fórmula do produto, `src/ledger/outcome.ts`: `((plus - then) / then) * 10000`.)*

**Nota de auditoria.** A leitura foi re-corrida no fecho (o motor v2 continuava a acumular): **4 768 ciclos** em vez
de 4 770, com as **mesmas 100 contagens** — `alinhou` 3 · `inverteu` 17 · `sem_relacao` 80 · 13 estados com os dois
sentidos — e a mesma leitura. O total de ticks move-se com a partição dos episódios (uma fronteira a deslizar um
tick muda de que lado fica); os veredictos não. Os dois números ficam ditos, cada um com a sua hora.

## 19. Ensaio N1 — `sign(last20)` × rótulo de 300 s, **sem Jev** *(FECHADO: insuficiente — ver §20)*

**Hipótese (uma):** o sinal de `returns_bps.last20` (40 s = 20 ticks de 2 s) separa `up`/`down` num horizonte
de **300 s** melhor que o acaso, na unidade **episódio**. Não é JSON, Laya, θ, `dumb` de adjectivos, mainnet nem
signer; o Jev e o encoder do `tape` ficam intocados.

### 19.1 A conta que reprovou o desenho inicial — e as correcções aceites antes da sessão

Medido na sessão v2 (marcas públicas, 35 janelas de 300 s): `|mov|` a 300 s tem **mediana 4,2 bps** e só
**22,9 %** das janelas passam os 10 bps; na âncora do segundo zero só **5,7 %** têm `tape ≠ flat` (proxy de
`|last20| ≥ 4`). Como os dois cortes **se multiplicam**, o desenho com âncora dava **~0,2 pontos elegíveis por
hora** — 16 episódios pediriam **~80 h**, não 2–3. Correcções congeladas:

1. **Ponto = janela de 300 s se ALGUM tick lá dentro tiver `|last20| ≥ 4`.** A âncora no tick 0 descartava 99 %
   do sinal. Mesma hipótese ("rajada de 40 s continua 5 min"). Medido: **57,1 %** das janelas têm alguma palavra
   ≠ `flat` (contra 5,7 % das âncoras).
2. **Rótulo primário a 300 s = 5 bps** — não 10 (é o corte de 15 min) nem 2 (está na folga do ruído do mid).
   `|mov| ≥ 2` e `≥ 10` ficam como **diagnóstico, e nunca promovem**.
3. **`EPS = 4` bps intocado** — é o `GRIND` do produto, escolhido antes de ver o rótulo.

### 19.2 Regras, escritas antes de a sessão correr

- O `last20_bps` do episódio é o do **primeiro** tick com `|last20| ≥ EPS` — não o máximo, não o que melhor
  alinha.
- Janela com ticks `> +EPS` **e** `< −EPS` → episódio `sem_relacao` (sinal contraditório): não se escolhe lado.
- **O rótulo corre do tick do sinal** (`t_sig → t_sig + 300 s`). Do início da janela seria olhar para a frente —
  com o sinal a meio, o movimento medido já conteria a rajada que o sinal mede. (Interpretação minha da letra do
  desenho, declarada aqui.)
- Episódios não se sobrepõem: guarda-se uma âncora apenas se estiver ≥ 300 s depois da anterior guardada.
- **`OUTCOME_HORIZON_SECS=300`** no `.env` da sessão e na linha de fronteira do log. Worker a 900 s **proibido**
  neste ledger: a idempotência é por `cycle_id`, logo um desfecho a 900 s não é substituído por um a 300 s — os
  horizontes misturavam-se. (O campo do desfecho chama-se `mark_plus_15m` por legado; a 300 s é a marca a 300 s.)
- `POLICY=numeric`, `DRY_RUN=true`, sem signer, sem chamada TypeSafe.

### 19.3 PASS / FAIL / insuficiente — a tabela do binomial (não "65 %")

Mínimo de `alinhou` para p < 0,05 unilateral com p₀ = 0,5:

| n elegíveis | mínimo `alinhou` |
|---|---|
| 16 | **12/16 (75 %)** |
| 24 | **17/24 (71 %)** |
| 36 | **24/36 (67 %)** |

- **Elegível** = episódio com `|mov| ≥ 5 bps`, `act ≠ hold` e sem sinal contraditório.
- **Abaixo de 16 elegíveis → insuficiente**, e não se alonga a sessão para chegar lá.
- **Um só sentido de preço em toda a sessão → amostra enviesada**, não PASS, mesmo com o mínimo.
- **Proibido:** baixar `EPS`, voltar ao Jev neste PR, chamar PnL ao dry-run, misturar o rótulo de 15 min com o
  de 5, promover as colunas de diagnóstico.

### 19.4 O que o produto leva (diff mínimo)

- `src/policy/numeric.ts` — a regra, sem rede, sem estado, determinista.
- **`PolicyCtx`** na porta `Policy` (contexto **opcional**): a porta só recebia as palavras do estado, e o
  número não está entre elas — `grinding` cobre 4–15 bps **sem dizer o sentido**, logo o sinal não se reconstrói
  do texto. Jev e `dumb` ignoram o contexto: nada do que já decide mudou.
- **`DecisionLine.returns_bps`** (opcional, composto `{last1,last5,last20}`), gravado no tick da fusão: é o que
  torna a regra reproduzível. As marcas públicas vêm de velas de **1 min** e uma janela de 40 s cai dentro da
  mesma vela — de fora, o `last20` não se reconstrói.
- `POLICY=numeric` em `config`/`createPolicy`. RISK, portão, plano, JSON das perguntas, θ e encoder: intocados.

Artefactos: `provas/n1/pre-medicao.ts` (o censo que ditou as correcções, read-only) e
`provas/n1/episodios-300.py` (a tabela por episódio e a leitura, uma só).

### 19.5 Leitura do N1 (24 set, 04:13Z) — **INSUFICIENTE**, e a sessão fecha aqui

Sessão completa: **5,00 h**, fronteira `20260923T231226Z`, **8 998 ciclos**, motor fechado por PID pelo próprio
guião da leitura. Actos do motor: `hold` **8 026** · `sell` **573** · `buy` **399** — a regra disparou lado em
~11 % dos ticks. **Todos os 26 desfechos gravados têm `horizon_secs = 300`**: nenhum worker a 900 s tocou neste
ledger, e o único horizonte presente é o do ensaio.

| | |
|---|---|
| **episódios com sinal** (`\|last20\| ≥ 4` na janela) | **27** (26 graduados) |
| etiquetas | `sem_relacao` 21 · **`alinhou` 4** · `inverteu` 2 |
| **elegíveis** (`\|mov\| ≥ 5 bps`, lado, sem contradição) | **6** |
| sinais | `sell` 15 · `buy` 12 (os dois sentidos ✓) |
| `dir_after` a 300 s | `flat` **15** · `down` 7 · `up` 4 (os dois sentidos ✓) |

**Veredicto: INSUFICIENTE — 6 elegíveis < 16.** Não se alonga a sessão para chegar lá.

As duas guardas que exigiste **foram satisfeitas** (os dois sinais de `last20`, os dois sentidos de preço): a
amostra não está enviesada — está **curta**. O que a trava é o livro: `flat` em 15 dos 27 episódios, movimento de
300 s pequeno neste testnet.

**Colunas de diagnóstico — e o número que NÃO se cita:** com o corte frouxo de 2 bps, `alinhou` 4 de 13 = 31 %;
com 10 bps, **3 de 3 = 100 %**. O segundo é exactamente o número que não se promove (n=3 não é amostra, e o
desenho proíbe-o). Os dois ficam publicados como diagnóstico, fora do veredicto.

**Projecção minha, corrigida.** Eu disse 13–16 elegíveis; a leitura deu **6**. A razão está no que declarei no
§19.2: o rótulo corre do **tick do sinal**, e não do início da janela — medido a partir de um instante mais tarde,
a parte das janelas que passa os 5 bps é menor. E houve 27 âncoras, não as ~30 que projetei.

**A aritmética para quem quiser reabrir isto:** 27 âncoras em 5 h = **5,4/h**; elegíveis 6/27 = **22 %** →
16 elegíveis pediriam ~72 âncoras ≈ **13 h de sessão**. É por isso que "não alongar" é a decisão certa: a
extensão não seria de uma hora, seria de uma noite inteira.

**O que o ensaio estabeleceu, e o que não.** Estabeleceu: o campo composto gravado, a regra a decidir limpa
durante 5 h em dry-run (8 998 decisões, nada no venue, um só horizonte no ledger), e que as duas guardas são
satisfazíveis. **Não estabeleceu nada sobre a aresta da regra** — com 6 elegíveis não há leitura, e não se
inventa uma a partir das colunas de diagnóstico.

<details>
<summary><b>Tabela crua dos 27 episódios</b> (`ts do sinal` · `last20_bps` · `sign` · `act` · `dir_after` · `\|mov\|` · `etiqueta`)</summary>

| ts (t_sig) | last20 bps | sign | act | dir_after | \|mov\| bps | etiqueta |
|---|---|---|---|---|---|---|
| `20260923T231442Z-BTC` | -4.25 | sell | sell | flat | -1.4 | **sem_relacao** |
| `20260923T234049Z-BTC` | -4.19 | sell | sell | flat | -1.6 | **sem_relacao** |
| `20260923T234807Z-BTC` | -6.18 | sell | sell | flat | -3.5 | **sem_relacao** |
| `20260924T000005Z-BTC` | -4.55 | sell | sell | flat | 2.0 | **sem_relacao** |
| `20260924T000551Z-BTC` | 5.66 | buy | buy | down | -5.0 | **inverteu** |
| `20260924T001543Z-BTC` | 4.08 | buy | buy | flat | -0.5 | **sem_relacao** |
| `20260924T003954Z-BTC` | -4.20 | sell | sell | up | 6.8 | **inverteu** |
| `20260924T005104Z-BTC` | 5.89 | buy | buy | flat | 2.8 | **sem_relacao** |
| `20260924T005856Z-BTC` | 4.08 | buy | buy | flat | -0.5 | **sem_relacao** |
| `20260924T010438Z-BTC` | -4.48 | sell | sell | flat | -4.2 | **sem_relacao** |
| `20260924T011658Z-BTC` | -4.08 | sell | sell | flat | -2.9 | **sem_relacao** |
| `20260924T012426Z-BTC` | 5.13 | buy | buy | flat | -4.8 | **sem_relacao** |
| `20260924T013326Z-BTC` | 5.36 | buy | buy | flat | 3.0 | **sem_relacao** |
| `20260924T014241Z-BTC` | -14.84 | sell | sell | down | -10.7 | **alinhou** |
| `20260924T014745Z-BTC` | 5.31 | buy | buy | up | 7.4 | **sem_relacao** |
| `20260924T015845Z-BTC` | -7.58 | sell | sell | down | -10.6 | **alinhou** |
| `20260924T020845Z-BTC` | -4.15 | sell | sell | down | -9.6 | **alinhou** |
| `20260924T022101Z-BTC` | 4.91 | buy | buy | flat | -2.1 | **sem_relacao** |
| `20260924T022737Z-BTC` | -5.25 | sell | sell | up | 8.2 | **sem_relacao** |
| `20260924T024241Z-BTC` | 13.76 | buy | buy | flat | 3.8 | **sem_relacao** |
| `20260924T030428Z-BTC` | 6.40 | buy | buy | down | -6.5 | **sem_relacao** |
| `20260924T031356Z-BTC` | -7.86 | sell | sell | flat | -1.4 | **sem_relacao** |
| `20260924T032212Z-BTC` | -5.94 | sell | sell | down | -16.9 | **alinhou** |
| `20260924T032738Z-BTC` | -11.67 | sell | sell | up | 11.7 | **sem_relacao** |
| `20260924T033238Z-BTC` | 4.09 | buy | buy | flat | 2.2 | **sem_relacao** |
| `20260924T035925Z-BTC` | -8.16 | sell | sell | down | -9.7 | **sem_relacao** |
| `20260924T040925Z-BTC` | 4.85 | buy | buy | — | — | **sem_relacao** |

</details>

*(Saída crua do guião, com tudo o que ele imprimiu, em `provas/n1/leitura-n1.log`; os pontos em JSON em
`provas/n1/episodios-n1.json`.)*

## 20. Arquivo — dois ensaios fechados (24 set 2026)

| Ensaio | Veredicto | Não fazer |
|---|---|---|
| Jev + 7 palavras (v1/v2) | mapa estável, estado **sem** poder preditivo a 15 min | JSON v3, θ, Laya, Fase D |
| N1 `sign(last20)` × 300 s | **INSUFICIENTE** (6 elegíveis / 16) | 13 h no mesmo terno, promover 3/3 @ 10 bps, afinar EPS |

PR **#17** fundido (`a7e6a95`): o cano `numeric` / `returns_bps` / `PolicyCtx` **fica** na `main`. Motor N1
parado. `POLICY=jev` e `POLICY=numeric` (last20) **não** correm na sessão T-5m.

## 21. Ensaio T-5m — preço × volume (especificação do dono, colada)

> **Uma sessão, três leituras offline. Decisão a cada 5 min. Sem Jev. Sem chop.**
>
> **0. Arquivo (fazer primeiro).** Merge PR #17. Motor N1 parado. `POLICY=jev` e `POLICY=numeric` (last20) não
> correm nesta sessão.
>
> **1. Hipóteses (escritas antes).**
> **P.** `sig_p = sign(mid_5m − EMA24_H1_fechada)` separa o movimento **da estadia** melhor que o acaso.
> **P+V.** Só actuar quando o volume confirma esforço a favor: `sig_p` long (+1) × volume alto (+1) → **buy**;
> short (−1) × volume alto (+1) → **sell**; qualquer × volume baixo (−1) → **hold** (não promove); `sig_p` 0 → hold.
> **V.** `sig_v` **não** gera lado — pergunta se, em estadias com volume alto, `|mov|` é maior e/ou o P alinha
> mais. Se não, o bit de volume sai. Não são três estratégias no venue: é **um** gravador e três tesouras no
> mesmo banco.
>
> **2. Definições congeladas.** TF de decisão **5 min** (relógio de parede). `mid` = `hl2` da barra de 5 min
> **fechada**. `MA_H1` = EMA 24 de `hl2` no TF **60 min**, só barras H1 **já fechadas** (lookahead/H1 corrente
> proibidos — senão repinta). `sig_p ∈ {+1,−1,0}`. **Sem chop.** Volume: barra de 5 min do **mesmo** livro;
> `MA_vol` = EMA 24 do volume no TF 5 min; `sig_v = sign(vol − MA_vol)`; empate → 0 → volume baixo.
> **Unidade:** estadia **P**, do 5 min em que `sig_p` muda até ao que muda para o contrário (zeros transitórios
> não partem a estadia; se `sig_p=0`, hold e a estadia anterior fecha). Rótulo = mid no início → mid no fim.
> `alinhou` = long+`up` ou short+`down`; `inverteu` o contrário; `sem_relacao` se `|mov| < 20 bps` **ou**
> estadia < 2 barras. P+V sobre as **mesmas** estadias, com coluna própria para as cortadas pelo V.
> **Proibido** winrate de velas M5. **Duração:** 12 h mínimo, 24 h alvo; às 12 h com < 12 estadias elegíveis,
> fecha **insuficiente**.
> **PASS/FAIL:** n < 12 → insuficiente; com n ≥ 12, PASS fraco se `alinhou/(alinhou+inverteu)` ≥ tabela
> binomial unilateral p<0,05 (12→10/12, 16→12/16, 24→17/24); os **dois** sentidos de preço têm de aparecer.
> P+V vs P emparelhado. V: se o `|mov|` mediano com `sig_v=+1` ≈ com `sig_v=−1`, **volume não confirma**.
> Isto **não** é PnL: sem fill, sem taxa, sem signer.
>
> **3. Produto (diff mínimo).** `POLICY=trend5` (não chama Jev); a cada 5 min fechados escreve uma linha com
> `ts`, `mid`, `ma_h1`, `sig_p`, `vol`, `ma_vol`, `sig_v`; **dry-run**, sem ordem; o rótulo das estadias **não**
> usa o worker de 300 s do N1; encoder de 7 palavras, JSON, θ, `dumb`, Laya intocados; confirmar volume na API
> **antes** do commit de arranque.
>
> **5. Proibido.** Religar Jev · last20 como motor · chop · afinar 24/20 bps/EMA à tabela · três actos no venue ·
> chamar PnL ao dry-run · promover winrate de M5 · copiar Chop Zone SamX · esperar fecho H1 para o `sig_p`.

### 21.1 Prova de volume — **há fonte** (passo 2 da fila, feito antes do commit de arranque)

A vela de 5 min do cliente HL traz `t, T, s, i, o, c, h, l, v, n` — **`v` e `n` presentes e positivos**
(última barra: `v = 0,01091`, `n = 22`). A metade V corre. Ressalva do livro: é o **testnet**, com volume fino
(~0,01 BTC por 5 min, ~20 negócios) — a razão `vol/MA_vol` é utilizável porque compara o livro consigo mesmo,
mas o sentido de "esforço" é mais fraco do que num livro real.

### 21.2 Censo antes da sessão — a unidade é rara demais para 12–24 h

`provas/t5m/censo.ts` aplica as definições do §2 sobre o **histórico público** (o mesmo livro, mesmas barras
de 5 min, EMA24 H1 só fechada), sem gastar uma hora de sessão.

**Correcção de método (24 set, ao paginar a fonte):** a primeira versão pedia o histórico numa só chamada, e o
endpoint devolve janelas limitadas — as corridas rotuladas "7 d"/"14 d" vinham truncadas em ~2 000 barras
(~7 dias), pelo que a de "14 dias" era na prática uma segunda leitura de 7 dias. A sonda passou a **paginar** e a
**avisar quando recebe menos barras do que pediu** (foi o aviso que revelou o corte). Números da versão nova,
sobre **todo o histórico que a fonte entrega**:

| histórico | barras de 5 min | estadias P | estadias/24 h | **elegíveis** (\|mov\| ≥ 20 bps, ≥ 2 barras) | elegíveis/24 h |
|---|---|---|---|---|---|
| 7 dias (sem paginação, completo) | 2 017 | 29 | 4,1 | **12** | 1,7 |
| 14 dias (sem paginação) | ~2 000 (truncado) | 37 | ~5,3 | **13** | ~1,9 |
| **todo o disponível** (17,5 dias) | **5 038** | **103** | 5,9 | **23** | **1,3** |

**O que a fonte não dá:** pedidos de 30 e de 60 dias devolvem **as mesmas 5 038 barras** — o histórico público de
5 min deste venue **acaba em ~17,5 dias**. A passagem a 30/60 dias que o §21.3 previa **não é possível neste
TF nesta fonte** (a série horária vai mais atrás, mas isso é outro TF e outro ensaio).

**Uma sessão de 12–24 h produziria ~1 a 2 estadias elegíveis** — contra o mínimo de **12** que o próprio desenho
exige. Fecharia **insuficiente por construção**; 12 elegíveis pediriam **~9 dias** de gravação.

**A causa é estrutural, não é azar de janela.** `sign(hl2_5m − EMA24_H1)` é um sinal lento: só ~6 mudanças de
sinal por dia, e as estadias estão dominadas por corridas de horas — 579 barras (48 h), 494 (41 h), 287 (24 h),
137 (11 h). A unidade "estadia" é um **regime**, e regimes não se repetem 12 vezes numa noite.

### 21.3 As hipóteses no histórico completo (n = 23 elegíveis, acima do mínimo de 12)

| hipótese | medido | critério do §2 | veredicto |
|---|---|---|---|
| **P** | **10/23** alinhou (43,5 %) | ≥ 17/23 (binomial) | **FAIL** |
| **P+V** | 4/7 alinhou · **16 das 23 cortadas pelo V** | n ≥ 12 e ≥ tabela | **insuficiente** (n=7) |
| **V** | `\|mov\|` mediano **150,2 bps** com `sig_v=+1` (n=7) vs **35,4 bps** com `sig_v≠+1` (n=16) | "≈ ⇒ não confirma" | **lê-se, mas não é estável** |

Os dois sentidos de preço aparecem (guarda satisfeita). **O V é o ponto instável:** nesta janela o volume separa
(150 vs 35 bps), mas na janela curta media **32,8 vs 31,8 bps** — praticamente iguais. Com n=7 de um lado, o
mesmo par de números já deu "não confirma" e "confirma": **o bit de volume não tem leitura estável** neste livro.

**Recomendação, e é dela que peço decisão:** **não gastar a noite.** O gravador `trend5` do §3 fica por escrever
enquanto a sessão não tiver potência — e pelo censo não tem: 1–2 elegíveis numa noite, contra um mínimo de 12,
com o mesmo desfecho do N1 e o dobro do custo.

### 21.4 Passagem diagnóstica pedida pelo dono — piso de 6 h (declarado antes de correr)

Regra escrita antes de medir: separar as elegíveis em **longas** (≥ 72 barras = 6 h, a estadia-regime) e
**curtas** (2–71 barras, o cruzamento curto), para responder a uma pergunta só — *"o FAIL é o cruzamento curto
ou a regra inteira?"*. A coluna **não promove** nada.

| subconjunto | n | alinhou | inverteu | % |
|---|---|---|---|---|
| todas as elegíveis | 23 | 10 | 13 | 43,5 % |
| **LONGAS (≥ 6 h)** | **10** | **10** | **0** | **100 %** |
| **CURTAS (2–71 barras)** | **13** | **0** | **13** | **0 %** |

A separação é total, e é por isso que **não se promove**: com n=10 (abaixo do piso de 12 que o dono fixou) isto é
**diagnóstico**, não resultado. E há uma circularidade a declarar antes de qualquer ensaio novo — a estadia
**acaba num cruzamento**, logo a curta é, quase por construção, um rompimento rejeitado (movimento invertido) e a
longa uma tendência (movimento na direcção). Um "corte de duração" corre o risco de ser **reafirmação da mesma
regra**, não hipótese nova.

**Fica dito o que se pode e o que não se pode concluir daqui:** pode-se concluir que o FAIL do P **não é
uniforme** — as curtas carregam-no inteiro e as longas não o têm. Não se pode concluir que "estadias longas
alinham": n=10, num livro que só oferece 17,5 dias de história, e com o mecanismo do parágrafo acima por
controlar. Se o dono quiser levar isto adiante, é **outro ensaio declarado** — e tem de nascer com a duração
definida **ex ante** (não pelo fim da estadia), senão mede a regra de novo.

## 22. Ensaio dos extremos — short no tecto, long no chão, horizonte **fixo**

Especificação do consultor, com as definições pinadas: `mid = (h+l)/2`; `hi/lo` dos últimos **L = 130**;
`u = clip((mid−lo)/(hi−lo))`; **CHAO = 0,15** e **TECTO = 0,85**; `s` = sinal do mid contra a **EMA 24 do H1
fechado (seed SMA 24)**; visita = primeiro `u ≤ CHAO` depois de `u > CHAO` (e o simétrico no tecto), uma visita
= uma linha, `t_in` na primeira barra; horizontes **12 / 36 / 72 barras** (1/3/6 h), **FLAT = 10 bps**.
Nada disto se afina depois de ver a tabela, e nada de `src/`: a sonda é `provas/t5m/extremos/medir.ts`, com os
testes do consultor a correr **antes** da leitura (6/6 verdes — e um deles apanhou um defeito meu na função do
binomial, que devolvia sempre `n`).

### 22.1 Resultado — 5 030 barras de 5 min, 2026-09-07 → 2026-09-25 (~17,5 dias), 167 visitas

| horizonte | leitura | elegíveis | alinhou | inverteu | razão | mínimo k/n | veredicto |
|---|---|---|---|---|---|---|---|
| H12 (1 h) | E0 todos | 126 | 59 | 67 | 0,468 | 73 | **FAIL** |
| H12 | E1 `s` a favor | 10 | 5 | 5 | 0,500 | — | insuficiente |
| H12 | E2 `s` contra | 116 | 54 | 62 | 0,466 | 68 | **FAIL** |
| H36 (3 h) | E0 todos | 136 | 68 | 68 | 0,500 | 79 | **FAIL** |
| H36 | E1 `s` a favor | **12** | 8 | 4 | **0,667** | 10 | **FAIL** |
| H36 | E2 `s` contra | 124 | 60 | 64 | 0,484 | 72 | **FAIL** |
| H72 (6 h) | E0 todos | 150 | 63 | 87 | 0,420 | 86 | **FAIL** |
| H72 | E1 `s` a favor | 14 | 7 | 7 | 0,500 | 11 | **FAIL** |
| H72 | E2 `s` contra | 136 | 56 | 80 | 0,412 | 79 | **FAIL** |

### 22.2 Leitura

- **Todos os quadrantes com n ≥ 12 reprovam.** Os extremos sozinhos (E0) ficam entre 0,420 e 0,500 — moeda ao
  ar, e a pior ponta é o horizonte mais longo. **Short no tecto e long no chão não pagam mais do que o acaso
  neste livro, nestas três janelas.**
- O corner `s` a favor (E1) é o melhor, com **8/12 = 0,667 no H36** — e mesmo aí fica abaixo do mínimo 10/12. A
  regra pré-registada ("E1 melhor que E0 só se a razão subir **e** n_E1 ≥ 12") declara E1 melhor que E0 no H36 e
  no H72, mas **melhor que E0 não é PASS**: nos dois casos o binomial ainda diz FAIL.
- **91 % das visitas são "s contra"** (151 de 166): neste livro, chegar ao extremo acontece quase sempre com o
  preço do lado de baixo da média — o chão é visitado em queda, não em dip de alta.
- `s = 0` nunca ocorreu; os abertos são 1–2 por horizonte (os últimos toques, sem horizonte cumprido).

**Limites, declarados:** um livro (testnet BTC), uma janela de 17,5 dias (a fonte não dá mais a 5 min), 167
visitas, e o subconjunto E1 é fino (10–14 elegíveis). Nada aqui é PnL: sem fill, sem taxa, sem signer — e sem
`trend5`, que continua por escrever.

## 23. Ensaio flip-na-faixa — entrada só no flip dentro da faixa do extremo (25 set 2026)

Especificação do consultor: o gatilho é o **flip na faixa**, não o toque. Evento = `s` muda de sinal **e**, na
mesma barra, o mid está no extremo — `u ≤ 0,25` com flip para `+1` → **long**; `u ≥ 0,75` com flip para `−1` →
**short**. Toque no extremo **sem** flip não é evento (foi o #20, não se repete) e flip no meio do canal também
não. Dois rótulos sobre os **mesmos** eventos: **R1** holding fixo em 12/36/72 barras e **R2** até o próximo flip
de `s` (qualquer flip, mesmo no meio). `FLAT = 10 bps`, binomial igual ao N1.

### 23.1 A regra quase não dispara

| contagem | |
|---|---|
| flips de `s` no período | **101** |
| **flips na faixa** (eventos) | **7** |
| flips no meio do canal (descartados) | **94** |
| **% na faixa** | **6,9 %** |

### 23.2 As quatro leituras — todas insuficientes

| leitura | fechados | long/short | elegíveis | alinhou | inverteu | razão | veredicto |
|---|---|---|---|---|---|---|---|
| R1 holding 12 barras | 5 | 2/2 | 4 | 2 | 2 | 0,500 | **insuficiente** |
| R1 holding 36 barras | 5 | 2/2 | 4 | 2 | 2 | 0,500 | **insuficiente** |
| R1 holding 72 barras | 5 | 2/3 | 5 | 2 | 3 | 0,400 | **insuficiente** |
| R2 até o próximo flip | 7 | 1/3 | 4 | 0 | 4 | 0,000 | **insuficiente** |

### 23.3 Leitura

**Insuficiente por construção** — e agora sabe-se porquê, com número: em 17,5 dias a regra disparou **7 vezes**;
chegar às 12 elegíveis pediria **~30 dias**, e a fonte pública de 5 min deste venue só oferece 17,5. Não é a
amostra que falta — é o **gatilho** que é raro: **93 % dos flips de `s` acontecem no meio do canal**, não na
faixa.

O único número que aponta para algum lado é o de R2 (0 alinhou em 4 elegíveis), e com n=4 **não se lê** — como
não se leu o 3/3 do §22. Nada aqui é PnL: sem fill, sem taxa, sem signer.

**Testes do consultor (§G): 7/7 verdes.** O primeiro, na sua primeira versão, reprovava comportamento
**correcto**: um flip-na-faixa dentro do warmup é descartado e contado, não é falha — a asserção passou a ser
sobre os **eventos** (nenhum com `t_in` no warmup), e o descarte ficou impresso.
