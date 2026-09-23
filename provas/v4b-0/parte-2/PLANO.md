# V4b-0 parte 2 — plano fixado **antes** de baixar pesos

Pedido do dono, 23 set 2026: *«Antes de baixar pesos, fixa por escrito.»* Este ficheiro é isso.
Resultados: `PLANO-FUSAO.md` §15.

## Checkpoint — e uma surpresa medida

O `VALIDACAO-PNL.md` manda `laya-typed-decisions`. Medido hoje (HF API, `?blobs=true`):

| repo | conteúdo | tamanho |
|---|---|---|
| `convaiinnovations/laya-typed-decisions` | `model.safetensors` + `encoder/` + `tokenizer/` + `rl_agent_config.json` | **846 MB** |
| `convaiinnovations/laya-multilingual` | idem | 678 MB |
| `receptron/laya-onnx` | **um** bundle: `laya.onnx` (4 MB) + `laya.onnx.data` (1685 MB) + `laya_config.json` + `tokenizer/` | **1689 MB** |

**O bundle ONNX publicado é o checkpoint inglês, não o `typed-decisions`.** O README do bundle diz
literalmente "English checkpoint, 421M parameters" e o config traz `max_len: 512`. O cliente
`@receptron/laya` só consome bundle ONNX (`BUNDLE_FILES = laya.onnx, laya.onnx.data, laya_config.json,
tokenizer/*`) e o repo `receptron/laya-onnx` **não tem subpastas** — a variante `multilingual` que o README do
pacote documenta (`subfolder: "multilingual"`) também não está publicada.

**Consequência:** correr `typed-decisions` neste host exige **exportar** o bundle —
`export/export_onnx.py` do `github.com/receptron/laya`, com `uv venv -p 3.12` +
`torch transformers safetensors onnx onnxscript onnxruntime huggingface_hub` (~2 GB de wheels e a conversão).
O próprio README do pacote diz que o export serve "para uma variante que não está publicada".

## Caminho, decidido por medição

- **ONNX in-process**, não `laya-serve`: `@receptron/laya` 0.1.2 (MIT) corre em Node/Bun sobre
  `onnxruntime-node` e devolve **a mesma forma** do `system_one` da TypeSafe — o README promete igualdade com
  a implementação Python "to four decimal places". Sem Python em runtime e sem processo a mais.
- Runtimes neste host: `node v26.8.1`, `bun 1.4.2`, `npm 11.19.0`. Se o `bun` não carregar o addon nativo
  (`onnxruntime-node`), o censo corre com `node` — mede-se, não se presume.
- **Nada de `src/policy/laya.ts`** e **nada do manifesto do repo**: a instalação vive numa pasta de trabalho
  fora do repositório; do repo só saem a sonda e os resultados.
- `executionProviders: ["cpu"]`, `intraOpNumThreads: 4`.

## Duas fases, deliberadamente separadas

| fase | checkpoint | o que mede | estado |
|---|---|---|---|
| **2a** | inglês publicado (`receptron/laya-onnx`) | se o runtime arranca neste host; **se o #156 persiste no bundle publicado** (a #156 foi medida no inglês); `act` × `noul` × `confidence` nos estados gravados | pré-ensaio |
| **2b** | `laya-typed-decisions` (export próprio) | a linha que interessa ao vivo | pendente do export |

**Não se misturam.** A 2a é declarada como pré-ensaio **noutro** checkpoint: a coluna Laya da tabela §9.4 só
recebe a 2b — *"checkpoint do replay = o que for ao vivo"* (§3 do doc).

## Censo

- **Âmbito determinístico:** as **primeiras 3144 decisões válidas** do ledger (o conjunto do snapshot do
  §14, sem depender de hora) → **44 estados distintos**; o censo corre por estado e pondera pela frequência.
- **As mesmas perguntas** do `policy/jev_questions.json` (a Laya é drop-in): mesmas instruções e critérios,
  com a tradução `noul`→`choice` **no cliente** (assimetria declarada, §3 do doc).
- **Reportar:** `act` × `noul` × `confidence`; **noul nativo vs choice-neutro** no `too_hostile`; quantos
  lados contra os 6 do `dumb`; se o #156 persiste; tempo de carga; P95 por estado.
- Se a carga passar de uns minutos ou o P95 > 800 ms, isso **entra no relatório** — não aborta o censo.

## 2b — `typed-decisions`: as três regras, fixadas **antes** do `uv`

Decididas pelo dono (23 set 2026) e escritas antes de correr o export:

1. **Mesmo snapshot.** O censo da 2b usa o **mesmo conjunto de 3144 decisões** da 2a (a regra determinística
   "as primeiras N decisões válidas do ledger"), não o ledger que continua a crescer. Os dois censos ficam
   comparáveis linha a linha; o JSON da 2a não se toca.
2. **Reportar à parte, e sem baixar o θ.** `act`, `conf`, `noul`, noul vs o par A/B, lados contra os 6 do
   `dumb`, p95. Se `conf` continuar < 0,80, a coluna §9.4 continua **zero** — e **não** se baixa o θ para a
   encher. O `typed-decisions` é linha isolada na tabela, não substituto de nada.
3. **Recusa escrita.** Se o export falhar, ou se o p95 ficar ≥ 2 s, a 2b **declara recusa** e **não nasce
   `laya.ts`**. A Laya fica hipótese de paper, não caminho do motor.

E o que a 2b decide mesmo que corra bem: se o `typed-decisions` **também** pinar o `noul` e comprar `dumping`
como o inglês, deixa de existir "era o checkpoint errado" — passa a existir *"este encoder + estas 7 palavras
não são oráculo neste livro"*. Aí a alavanca volta aos **buckets** (`tape` = `flat` em 95,6 %), não a mais um
modelo.

## Custo aceite

`uv venv -p 3.12` + `torch transformers safetensors onnx onnxscript onnxruntime huggingface_hub` (torch do
índice **CPU**, para não puxar CUDA), o checkpoint `laya-typed-decisions` (846 MB) e o export
(`export/export_onnx.py` do repo `receptron/laya`). Tudo numa pasta de trabalho **fora** do repositório.

## Limites declarados

- A 2a **não** é o checkpoint do vivo: números provisórios, em linha separada.
- O export da 2b pode falhar (o repo `laya-typed-decisions` não traz os `.py` de referência). Se falhar, fica
  escrito com o erro exacto, em vez de se inventar um caminho.
- O censo mede **lado escolhido**, não PnL. Nada aqui autoriza wiring.
