# V4b-0 — replay offline: jev × dumb (parte 1)

Sonda **descartável**, fora do código de produto: não toca no motor, no gate, no policy file nem no ledger.
Resultados no `PLANO-FUSAO.md` §14.

Parte 1 (aqui): `jev` (gravado no ledger) × `dumb` (recomputado) sobre os **mesmos** estados.
Parte 2 (falta): a coluna **Laya**, que precisa dos pesos locais e do caminho de execução.

## Como corre

```sh
bun run provas/v4b-0/replay-jev-dumb.ts --json provas/v4b-0/replay.json
```

Sem rede, sem chave. Lê `data/ledger/*.jsonl`.

## Duas regras de honestidade desta sonda

- **Importa a heurística de produto** (`dumbAct` / `dumbHostile` de `src/policy/dumb.ts`) em vez de a
  recopiar: uma cópia mediria a cópia, não o controlo que o motor corre com `POLICY=dumb`.
- **O `act` gravado é o verdict cru.** O gate vive depois, em `risk/intent.ts`; o replay aplica-o na mesma
  ordem do produto — `hostile` (`too_hostile ≥ NOUL_HOSTILE_TH`, default 0,65) antes de `low_conf`
  (`act_conf < JEV_CONF_ACT`, default 0,80). Os limiares vêm do ambiente, com os defaults do produto.

## Resultado (23 set 2026, 3144 decisões válidas, 44 estados distintos)

| | jev (gravado) | dumb (recomputado) |
|---|---|---|
| actos crus | `hold` 3144 | `hold` 3138 · `sell` 5 · `buy` 1 |
| lados crus | **0** | **6** |
| `n_lados` (conf ≥ 0,80) | **0** | **6** |
| bloqueados pelo gate | 2960 (hostile 613 · low_conf 2347) | 3139 (holds 3138 · hostile **1**) |

- **O `noul` não é o travão:** `hold` em 3144/3144 nas duas bandas (613 hostis e 2531 não hostis).
- **A metade hostil da `dumb` disparou 1 vez:** exige `violent` (nunca aparece) ou `unfillable` (1×, na
  posição `spread`, onde significa outra coisa).
- `dir_after` por hora: 15Z = 224 `down`; 16Z = 66 `down` · **7 `up`** — não é o cálculo preso.

## Limitações declaradas

- A coluna **Laya** não existe ainda (parte 2).
- O worker de outcome parou por **429 (rate limit)** da API pública aos 297 outcomes: as horas 17Z/18Z ficam
  por graduar (é idempotente — outra passagem completa).
- `n_lados(dumb) = 6` está **abaixo do mínimo de 20**: não se conclui comparação nenhuma daqui.
