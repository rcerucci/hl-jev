# Validação até PnL — `rcerucci/hl-jev` + Laya local

Documento seguinte à spec de fusão (`jev-hl-fusao-spec.md`).
A solda A+B+C está no `main` (`8422dcc`, 23 set 2026). Isto guia **aferir, corrigir e só depois reivindicar PnL**.

Não é autorização de mainnet. Não é Fase D. Não é "Laya mata o Jev".

- Repo de execução: <https://github.com/rcerucci/hl-jev>
- Base: `main` @ `8422dcc` — ou o `HEAD` da `main` na hora de abrir o branch. `7b3df4a` **não** se congela.
- Upstream intacto: `aowang-ai/jev-trade` @ `a3f2f83`

---

## 0. Estado medido (não reabrir)

| Facto | Número | Onde |
|---|---|---|
| Caminho fundido | `POLICY=jev` → ≤12 palavras → gates → `RiskIntent` → `market.send` | PLANO §9 |
| T018 venue | ALO real `oid 60855824109`, `taker=false`; `hold` não mexeu na book | PLANO §11 |
| Ensaio 100+100 | 224/224 outcomes; **100% hold**; `n` de alta-conf **de lado** = 0; 13 estados na coluna `jev` (14 na janela) | PLANO §11 |
| Run de 30 min (testnet, signer vivo) | 922 ticks = 922 ciclos (1:1 com o log); 922 válidos / **0 congelados**; 100% `hold`; gate `hostile` 433 / `low_conf` 489; `act_conf` 0,15–**0,90** (mediana 0,64); latência 261–588 ms (mediana 324); 18 estados; **0 ordens, 0 fills**; conta 0/0 antes e depois; US$ 0,0227 | PLANO §12 |
| Corpus no ledger (medido às 17:28Z) | **2434 decisões** (2329 `jev`, 105 `dumb`), **38 estados distintos**, dominante com 31%; 224 com outcome | `data/ledger/` |
| Conta testnet | `accountValue $0`. Uma ALO **descansa sem margem**; o que exige saldo é o *fill* | PLANO §11/§12 |
| Cadência | `TICK_MS=2000`, um oráculo por tick | `src/config.ts` |
| Noite / DeepSeek | chave viva; o código da D **não existe** | PLANO §10 |
| Tabela | falta `n_lados` (conf≥θ **e** `act≠hold`) | este documento, V1 |
| Desk | render da fusão + dois temas (paleta e-ink medida); **não** é instrumento de medição | PLANO §12 |

**Veredicto actual:** infraestrutura verde, oráculo sem experimento. PnL desta sessão = 0 por construção (hold + margem 0 + sem fill novo).

---

## 1. O que ainda falta aferir (por ordem)

Cada item tem um **sim/não** e um número. Sem o número, não se sobe de degrau.

### V1 — Tabela honesta

- Coluna `n_lados` = ciclos com `act_conf ≥ JEV_CONF_ACT` **e** `act ∈ {buy,sell}`.
- Coluna diagnóstica `n_lados@0,50` **só no relatório**. O gate vivo continua em 0,80.
- **A coluna `@0,50` nunca promove.** É diagnóstico. Agir a 0,50 é agir no meio não-calibrado do Jev; usá-la como critério de subida é trocar o instrumento de medida.
- Holds de alta confiança **não** entram no denominador de acerto. A coluna `n` (holds com conf≥θ) fica visível: é ela que mostra que o oráculo *decide*, em vez de estar mudo.
- A frase do PLANO §11 ("um estado em 224 ciclos") já está corrigida: 13 estados na coluna `jev`, 14 na janela do ensaio, 18 no run de 30 minutos.

**Pronto quando:** `bun test` cobre `n_lados`; uma tabela de `attribution.ts` impressa sobre o ledger mostra as duas colunas lado a lado.

### V2 — Fecho dos 30 min de testnet

**Fechado.** Bloco cru no PLANO §12 (922/922, 100% hold, 0 ordens, 0 fills, US$ 0,0227, sem órfão).

### V3 — Tape que mexe (sem mainnet de execução)

**Medido em 23 set 2026 — o testnet não estava parado.** O que faltava não era tape, era **lado**: 211/224 outcomes com ≥ 10 bps nos 15 min seguintes, e `hold` em 2923/2923 decisões. Duas fases, nesta ordem:

**V3-0 (offline, antes de qualquer código novo).** Graduar os ciclos que **já existem** (2434 decisões, 38 estados distintos) contra as velas públicas das **duas** fitas e medir quanto elas discordam naqueles intervalos. Não produz `n_lados` (os `act` gravados são `hold`); produz a pergunta que decide se o V3 vivo é interpretável, e é a medição mais barata do plano.

  **Corrido em 23 set 2026 — resultado no `PLANO-FUSAO.md` §13 e em `provas/v3-0-duas-fitas/`.** A premissa
  "testnet parado" está **falsificada**: 211 dos 224 outcomes têm movimento ≥ 10 bps nos 15 min seguintes, e
  o livro mexe em 63 de 86 minutos na sonda. Os `directional_hit` nulos vêm de `jev_side: hold`, **não** da
  fita — é facto de política, não de venue. As fitas divergem em **nível** (~1,65 % de desvio sistemático) e
  concordaram em **sinal** nas 5 janelas independentes. O motivo do desenho misto caiu.

**V3 vivo — decisão das marcas tomada (23 set 2026): marcar no mesmo livro do estado.**

- `marks_source` com flag `MARKS_VENUE=mainnet|testnet`, **default `testnet`**. Mainnet deixa de ser
  obrigatório para "haver movimento".
- As **duas mids por ciclo** passam a **diagnóstico opcional** — já não são precisas para desenho misto nenhum.
- **Não** se muda o input de preço do estado para mainnet. O 5/5 é ausência de inversão **nesta** janela, não
  prova de equivalência entre fitas — não se lê como autorização para cruzar rótulos.
- **Nenhuma ordem sai de um livro misto.** Decisão de um venue, ordem no mesmo venue; em ensaio misto, sem signer. **Esta regra não caiu.**
- Alvo: `n_lados ≥ 20` **por** política (`jev` e `dumb`) **ou** declaração escrita de recusa.

**Pronto quando:** tabela com `c/outcome` ≈ ciclos, `n_lados ≥ 20` ou o veredicto de recusa, e a **concordância entre as duas fitas publicada** no mesmo bloco.

**Decisão de 23 set 2026 — V3 vivo recusado por escrito.** Com estas políticas **não existe** `n_lados ≥ 20`: o Jev dá 0 lados a qualquer confiança e a `dumb` dá 6. **A Laya no motor também fica recusada** (regra 3 da 2b: p95 2,1 s ≥ 2 s e `conf` máximo 0,432 < θ) — a coluna Laya da §9.4 **não se abre**. A alavanca autorizada passou a ser o **encoder: ensaio restrito ao `tape`**, dry-run, com regras e leituras publicadas no `PLANO-FUSAO.md` §17.

### V4 — Controlo no mesmo state

`dumb` decide sobre as **≤12 palavras**, não sobre `returnsBps` nem sobre o mid.
Se `n_lados(dumb)=0` porque o tape não tem `pumping`/`dumping`, isso é o controlo a funcionar — **não se alarga o `dumb` para "participar"**.

**Pronto quando:** as colunas `jev` / `dumb` / (mais tarde) `laya` saem do mesmo JSONL.

### V5 — Venue com fill (opcional, não bloqueia V3)

O bloqueio é **saldo, não signer**: uma ALO descansa sem margem, um *fill* exige-a.
Saldo mock: faucet se a morada já depositou em mainnet, ou carteira antiga à mão. Uma sleeve, `QUOTE_USD` actual.
Prova: ALO → fill, ou cancel limpo; o reduce-only IOC do close continua no `plan.ts`.
**PnL mock não é edge.**

**Pronto quando:** um fill com `cycle_id` no ledger.

### V6 — Queda de WS (T018-bis, opcional)

Induzir drop, confirmar que não há ordem duplicada. PR próprio.

---

## 2. Laya local — fontes, medições e o que o fornecedor diz de si

> **Fechado em 23 set 2026 — recusa.** O V4b-0 correu (partes 2a e 2b; `PLANO-FUSAO.md` §15/§16): nenhum dos
> dois checkpoints produz lado graduável (`conf` máximo **0,432** < θ = 0,80) e o p95 é **2,1 s ≥ 2 s** neste
> host. **A coluna Laya não entra na tabela e não nasce `laya.ts`.** O que fica abaixo é o registo do que foi
> medido sobre a Laya, não um plano aberto.

Laya **não** é a Layla do telemóvel. É o System One open-weight da Convai: encoder + cabeça de decisão, `choice` / `score` / `noul`, um forward pass, Apache 2.0.

### Repos (verificados: os quatro respondem 200)

| Repo | O que é | Uso nesta validação |
|---|---|---|
| <https://github.com/NandhaKishorM/laya> | Referência Python, pesos, router, treino | Ler README + checkpoints. Não meter Python no tick do `hl-jev`. |
| <https://huggingface.co/convaiinnovations/laya> | Pesos: `laya` (421M, 512 tok, ~808 MB), `laya-multilingual` (322M, ~647 MB), `laya-typed-decisions` (421M, 1024 tok) | Checkpoint **typed-decisions** para o A/B. |
| <https://github.com/receptron/laya> · `@receptron/laya` (npm **0.1.2**, MIT, 305★) | ONNX no Node/TS; bundle fp32 baixado e cacheado | Alternativa **sem Python**, in-process. |
| <https://github.com/virajbhartiya/laya-vs-jev> | Demo Snake / T-Rex, latência | Não copiar jogo para o bot. Só referência de ms. |

Pesos ~1–2 GB em disco; o host tem folga (20 GiB de RAM livre, 399 GB de disco, 16 CPUs). CPU serve; GPU opcional; sem rede depois do primeiro download.

### O que o fornecedor mede, e que muda o desenho

1. **Sai sobre-confiante.** O *model card* declara ECE **0,466** no checkpoint inglês de fábrica, e **0,081** depois de reajustar uma temperatura por (tipo de pergunta, número de opções). O nosso gate é `act_conf ≥ 0,80` **porque o Jev é calibrado** — logo o mesmo θ **não** compara a mesma coisa. Ou a linha da tabela declara **"Laya sem refit"**, ou há temperature scaling no *nosso* set (calibração ≠ fine-tune). Sem uma das duas, a linha não é "Laya": é "Laya + o nosso limiar".
2. **`noul` pode colar-se ao rótulo.** `render_options` crava os rótulos de **qualquer** `noul` em `false:` / `true:` — portanto os *criteria* nem são o que decide. Medido (issue **#156**, `laya` 0.3.4, checkpoint inglês): P(true)=**0,0000** com confiança **1,0000**, **com e sem** criteria; `A/B`, `positive/negative` e `1/2` acertam. O cartão fala em 0.3.7 — **confirmar no replay** se persiste na versão que usarmos.
   **Consequência para este repo:** o nosso `too_hostile` **é** um `noul` (chaves `true`/`false`). Com a Laya, o travão de hostilidade fica **cego e confiante** — devolve "não hostil" a 1,0 para todo o estado. O Jev, sobre o mesmo ficheiro, varia 0,45–0,81: **não se toca no JSON**.
3. **`act_probability` está saturado.** Issue **#185** (medida em 0.3.5): `act_probability` é **1,0** para todo o input — a cabeça recebe `|CLS|` 35,6 do encoder e devolve 10 838 (≈300×), com logits de gap ~8 000 sobre um sinal de ~470; `confidence` mexe-se como esperado (0,7308 / 0,0082 / 0,0437). O "**AUROC 0,30**" é do *cartão* (396 decisões rotuladas) — **alegação do fornecedor, não medição da issue**. O desenho não muda: **gatear por `confidence`**, nunca por `act_probability` (é o que o nosso parser já exige).
4. **Latência.** *Cartão*: 32,8 ms em **GPU**, **193–464 ms em CPU** com preload. Não é argumento de velocidade neste tick — é comparável ao Jev medido (mediana 324 ms). O argumento da Laya é ser **offline, com pesos teus e calibrável**; o "20×" contra API continua a ser RTT.
5. **Servidor compatível.** `laya-serve` expõe `POST /v1/systemone` com o mesmo request/response do TypeSafe ("existing TypeSafe clients work by changing their base URL").

### Wiring: o que está medido e o que ainda não

- O SDK que usamos lê `TYPESAFE_BASE_URL`: no fonte do pacote (mapa de fontes do `dist`), `ENV.baseURL = "TYPESAFE_BASE_URL"` e o construtor faz `stripTrailingSlashes(fromCodeOrEnv(config.baseURL, ENV.baseURL) ?? DEFAULT_BASE_URL)`, com `fromCodeOrEnv = fromCode ?? readEnv(envVar)`.
- O nosso código **não** passa `baseURL` e **não** menciona a variável ⇒ redireccionar para o `laya-serve` seria **zero linhas de TypeScript**.
- **Isto é fonte do SDK, não execução.** A prova é um `POST` real ao `laya-serve` no replay. **Sem o POST, não se declara "já funciona".**
- Se o `laya-serve` não arrancar no host, cai-se para o ONNX in-process (`@receptron/laya`). **Não se inventa um terceiro cliente.**

---

## 3. Desenho `POLICY=laya`

> **Não se aplica (recusa do V4b-0, 23 set 2026).** Este desenho fica como registo: não houve `laya.ts`, não
> houve `TYPESAFE_BASE_URL` apontado a sidecar, não houve terceiro cliente. Ver `PLANO-FUSAO.md` §15/§16.

Branch: `validacao/laya-local`, a partir de `8422dcc` ou do `HEAD` da `main` na hora.

```
src/policy/laya.ts     # só se o replay offline justificar wiring
test/laya-policy.test.ts
.env.example           # POLICY=laya
```

Regras:

1. Mesmo `policy/jev_questions.json`. **Sem schema paralelo.**
2. Estado = as ≤12 palavras. Zero dígitos. Nada de `TradeState` numérico.
3. **A tradução `noul` → `choice` de 2 opções com rótulos neutros vive só no cliente Laya** (compensação da #156) e é declarada como **assimetria** na linha da tabela. O path `POLICY=jev` continua a mandar o `noul` do JSON, sem alteração.
4. **O checkpoint do replay é o checkpoint que vai ao vivo.** A #156 foi medida no inglês; se o V4b usar `typed-decisions`, o replay é nesse. Não misturar.
5. Falha de load / ONNX / shape → `raw_ok=false` → **freeze**, nunca chute.
6. Não chamar TypeSafe neste path.
7. `DumbPolicy` intacto.
8. O primeiro passo **não é ao vivo**: é o V4b-0 (replay offline sobre os estados gravados).
9. `model` = `laya-typed-decisions` (ou o id do checkpoint) no ledger, para a tabela agrupar por família.
10. Timeout: o load inicial é arranque, não tick. No tick, P95 acima de `JEV_TIMEOUT_MS` → `frozen_timeout`, igual ao Jev.

Wiring: `TYPESAFE_BASE_URL` **se** o `laya-serve` estiver no ar e o POST bater; caso contrário ONNX in-process. A escolha decide o número de processos no host, **não** os números a comparar — e decide-se **depois** do replay.

---

## 4. Escada até "há PnL?"

PnL só existe com **fill** + **mark** + **funding** no mesmo `cycle_id`. Testnet mock não conta como edge. Mainnet sem V3+V4 é roleta.

```
V1  tabela honesta (n_lados + @0,50 diagnóstico)
      ↓
V2  fecho dos 30 min                                    [FECHADO — PLANO §12]
      ↓
V3-0 offline:  discordância testnet ↔ mainnet no corpus que já existe
      ↓
V4b-0 offline: jev vs dumb vs laya nos mesmos estados (inclui a distribuição do noul)
      ↓
V3  vivo:      marcas de mainnet (e estado de mainnet se o V3-0 divergir), dry-run
      ↓
V4  vivo:      jev vs dumb no mesmo state
      ↓
V4b vivo:      laya como terceira linha
      ↓
V5  fill testnet (saldo mock)
      ↓
Critério de promoção a paper / mainnet capado
```

Os dois passos **offline** correm antes dos vivos: são baratos, não podem ser invalidados por nada e decidem os caros.

### Critério de promoção (escrito, não "parece bom")

Só se discute mainnet capado (`HL_TESTNET=false` + size mínimo + uma sleeve) quando **todos** forem verdade:

1. `n_lados ≥ 50` na política candidata (não 20).
2. Winrate de alta-conf **acima** do `dumb` no mesmo período e no mesmo state — com o **MDE escrito antes** de correr e o **intervalo publicado**. Com `n=50` o IC de uma proporção tem ±~14 pp: "acima" sem intervalo promove ruído em metade das vezes.
3. **Um** critério primário, não dois. "A **ou** B" com um só PASS dobra a chance de passar por acaso; o secundário reporta-se sem valor de decisão.
4. `high_conf_miss` listado, não escondido. Funding do intervalo na linha de outcome.
5. **`%hold` alto não é PASS.** É amostra seleccionada: o oráculo só fala quando tem opinião. Declarar quantos estados/sessões ficaram de fora e repetir ou estender a janela — nunca contar a abstenção como PASS.
6. Fill testnet pelo menos uma vez (V5), para o signer não ser teórico. `POLICY` explícito no processo vivo (caminho legado **proibido** com chave). Equity cap e kill switch no código — **ainda não existem**; sem eles não há Fase E.

Se o `dumb` empatar ou ganhar: **não há PnL a reivindicar.** Há um executor que funciona e um classificador que não bate um adjectivo.

Se `n_lados=0` nas três políticas: o estado de ≤12 palavras + policy actual **não expressa lado**. A correcção é buckets / policy file, não Laya, não limiar, não noite — **e só depois de o V3-0 mostrar que as duas fitas não divergiam**. Sem essa leitura, "o vocabulário não serve" pode ser só o input de outro venue.

### Como ler PnL quando existir

Três números, sempre juntos:

| Número | O que é | O que não é |
|---|---|---|
| PnL realizado da conta HL | fills + funding + fees | "o Jev ganhou" |
| Soma de `directional_hit` ponderada por conf | qualidade do oráculo | dinheiro |
| PnL **atribuído** a ciclos `jev_act` vs `dumb` vs `laya` | a pergunta | desk no `init()` a reler histórico |

O `pnl -$0,63` que o desk mostrou na sessão viva era **histórico**. Qualquer relatório futuro filtra `cycle_id` desta sessão.

Paper PnL (dry-run + marcas mainnet) pode existir **antes** do V5 — é o número do V3/V4. Declarar como **paper**, não como testnet filled.

---

## 5. Correcções permitidas vs proibidas

### Permitidas

- `n_lados` + a coluna `@0,50` (só relatório) + a frase do §11 do PLANO (feito).
- `marks_source` com `MARKS_VENUE=mainnet|testnet` (default testnet) e as duas mids na linha.
- `POLICY=laya` drop-in, com a tradução do `noul` **no cliente**.
- README: Laya ≠ legado; `HL_TESTNET=true` obrigatório na fusão.
- Kill-switch / cap — só quando se abrir a Fase E, em PR separado.

### Proibidas

- Baixar `JEV_CONF_ACT` ou `NOUL_HOSTILE_TH` para encher a tabela.
- Alargar o `dumb` até disparar.
- Fase D (`propose`/`accept`) sem `high_conf_miss` **de lado**.
- `HL_TESTNET=false`.
- Ligar Laya e desligar o Jev no mesmo PR.
- Treinar Laya no ledger de holds.
- Publicar rewrite da noite.
- Tratar PnL de testnet mock, ou PnL histórico do `userFills`, como resultado da fusão.
- **Declarar o env `TYPESAFE_BASE_URL` como "já funciona" sem o POST que o prova.**
- **Misturar checkpoints entre o replay e o vivo.**
- **Tocar no `noul` do `policy/jev_questions.json` para agradar à Laya** (a tradução vive no cliente).
- **Correr um passo vivo antes do passo offline que o decide.**
- **Julgar "o vocabulário não expressa lado" sem o V3-0** (fitas).

---

## 6. Fila do construtor (copiar)

```
A partir do main (8422dcc ou o HEAD actual). Nada de congelar 7b3df4a.

PR-V1  — n_lados + coluna @0.50 (só no relatório) + a regra "nunca promove".
         Testes cobrem n_lados. Sem tocar no gate. Sem tocar no limiar.

V3-0   — offline, script descartável (não é PR de produto):
         corpus do ledger (medido às 17:28Z: 2434 decisões, 38 estados, dominante 31%)
         x velas públicas das DUAS fitas. Publicar a discordância.
         Não produz n_lados (os act gravados são hold). Decide se o V3 vivo serve.

V4b-0  — offline: jev vs dumb vs laya sobre os MESMOS estados gravados (43 distintos hoje).
         Inclui: ler o cliente (baseURL), confirmar o shape (confidence),
         medir a distribuição do noul, e o par noul vs choice-neutro.
         Imprime dir_after POR HORA: o corpus actual tem 224/224 down em 23,6 min
         (= 2 janelas independentes). Se persistir noutro dia, é o cálculo, não o mercado.
         Checkpoint do replay = o que for ao vivo. Decide se há wiring.

PR-V3  — marcas no MESMO livro: default MARKS_VENUE=testnet (decidido 23 set 2026).
         Sem mainnet no worker de outcome; as duas mids por ciclo = diagnóstico opcional.
         Ensaio: POLICY=jev e POLICY=dumb, uma sleeve, dry-run.
         Parar com n_lados>=20 por coluna OU 4-6 h de sessão viva.
         Não mexer no gate. Nenhuma ordem sai de livro misto.

PR-V4b — POLICY=laya: env TYPESAFE_BASE_URL com o laya-serve no ar, ou ONNX
         in-process se o serve não arrancar no host.
         Mesmo policy file. Tradução do noul só no cliente. model=laya-typed-decisions.
         Terceira linha na tabela.

Não abrir D. Não mainnet de execução. Não fine-tune.
```

---

## 7. Prompt curto para o agente de código

```
You are extending https://github.com/rcerucci/hl-jev from the current main HEAD.
Do not rewrite market.send, plan.ts TIF, or the legacy path.

First PR: add n_lados to attribution (conf >= threshold AND act in buy|sell), plus a
diagnostic n_lados@0.50 column in the report only. Do not change JEV_CONF_ACT.
The @0.50 column never promotes. Do not start Phase D.

Offline before live: (a) grade the ledger's existing cycles against BOTH venues'
public candles and publish the disagreement; (b) replay jev vs dumb vs laya over the
recorded states, including the noul distribution. No laya.ts before the replay.

Laya is POLICY=laya only, same jev_questions.json, same Verdict shape, gating on
`confidence` (act_probability is saturated, issue #185). Its rendering of the
hostile noul must be translated to a 2-option choice with neutral labels, in the
Laya client only (issue #156). The replay checkpoint is the checkpoint that goes live.
Reference weights: convaiinnovations/laya-typed-decisions. Laya is not Layla the
Android chat app.

Marks from mainnet public candles belong only in the outcome worker, behind
MARKS_VENUE, and never in a mixed-book order. Execution stays HL_TESTNET=true.

Do not declare TYPESAFE_BASE_URL working without a real POST proving it.

Stop and ask if n_lados stays 0 after a live-tape marks run — do not tune
thresholds or the dumb policy to invent sides.
```

---

## 8. Critério de "documento cumprido"

- [x] V1 no `main` ou PR aberto (`n_lados` + `@0,50` + a regra "nunca promove") — **no `main` (`c2603b5`)**
- [ ] PLANO §12 com os 30 min crus — **feito**
- [ ] Frase do PLANO §11 corrigida com medição — **feito**
- [x] V3-0 corrido e publicado (discordância entre fitas), ou recusa escrita
- [x] Decisão das marcas escrita: **mesmo livro**, `MARKS_VENUE=testnet` (23 set 2026)
- [ ] V4b-0 corrido (jev / dumb / laya nos mesmos estados + distribuição do noul)
- [ ] V3 corrido com `n_lados ≥ 20` por coluna, ou recusado por escrito
- [x] Laya: **V4b-0 fechado com recusa** (p95 2102 ms ≥ 2 s e `conf` máx 0,432 < θ) — ver PLANO §15/§16. A coluna Laya **não entra** na tabela e não nasce `laya.ts`.
- [ ] Nenhum commit com `HL_TESTNET=false`
- [ ] Nenhum claim de PnL sem `n_lados` e sem filtro de `cycle_id` da sessão
- [ ] Nenhuma ordem de livro misto em nenhum ensaio

---

## 9. Procedência dos números citados

| Número | Fonte | Natureza |
|---|---|---|
| `8422dcc`, `a3f2f83` | `git` + API do GitHub | medido |
| `oid 60855824109`, `taker=false` | sonda do venue (PLANO §11) | medido |
| 224/224, 922/922, 100% hold, 0 ordens, 0 fills, US$ 0,0227 | ledger + log do motor (PLANO §12) | medido |
| 2434 decisões, 38 estados, dominante 31% | `data/ledger/`, 23 set 17:28Z | medido |
| 13 / 14 / 18 estados | ledger, três janelas distintas | medido |
| ECE 0,466 → 0,081 | *model card* do checkpoint | alegação do fornecedor |
| `noul` P(true)=0,0000 com conf 1,0000 | issue **#156** (`laya` 0.3.4, inglês) | medição de terceiro |
| `act_probability` = 1,0; `\|CLS\|` 35,6 → 10 838 | issue **#185** (`laya` 0.3.5) | medição de terceiro |
| AUROC 0,30 em 396 decisões | *model card* | alegação do fornecedor |
| 193–464 ms CPU / 32,8 ms GPU | *model card* | alegação do fornecedor |
| `TYPESAFE_BASE_URL` no construtor do SDK | fonte do pacote (`@typesafe-ai/sdk`, mapa de fontes) | leitura de código |
| 2434, 38, 0,0227, 0,466, 1,0 — todos | este documento | conferidos contra o arquivo, não digitados de memória |

Fim.
