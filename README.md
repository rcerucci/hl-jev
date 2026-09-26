# Hyperliquid Sigma

Perp na **Hyperliquid**. Motor **sigma**.
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

Nessa abertura, e em cada fecho ou virada: nocional = `(equity / n pares) × LEVERAGE`.
`n` é o número de moedas em `HL_COINS`. `QUOTE_USD` não dimensiona o sigma.

No live a equity é a da carteira. No dry run, sem venue, a régua é `BANKROLL_USD`.

## Arrancar, parar, ler

O motor é **sigma**. Não é preciso `POLICY`.

### Contas

No `.env`:

```
PRIVATE_KEY_1=0x…     # conta 1 (default)
PRIVATE_KEY_2=0x…     # conta 2
```

`PRIVATE_KEY` antigo ainda vale e vence a `_1`. A chave **não** se imprime:

```bash
bun run contas
```

### Um processo

Um par usa o **saldo inteiro** da carteira deste processo:

```bash
HL_COINS=BTC LEVERAGE=1 PORT=3000 bun run start
```

Dois pares no mesmo processo: o saldo **parte-se** (`/2`, `/3`, `/4`):

```bash
HL_COINS=BTC,SOL LEVERAGE=1 PORT=3000 bun run start
```

Nocional de cada par = `(saldo / n pares) × LEVERAGE`.

### Duas contas (dois depósitos)

Dois processos. Cada um lê a equity **daquela** carteira e, com um par, entra com o saldo todo.

```bash
HL_COINS=BTC LEVERAGE=1 PORT=3000 bun run start
ACCOUNT=2 HL_COINS=SOL LEVERAGE=1 PORT=3001 bun run start
```

### Dry run e parar

```bash
DRY_RUN=true HL_COINS=BTC bun run start & echo $! > /tmp/sigma.pid
kill "$(cat /tmp/sigma.pid)"
```

Por PID, nunca `pkill -f`. Relatório do fill: `bun run src/tools/relatorio-fill.ts`.

`bun run dev` é o mesmo motor com `--watch`. `bun test` corre a suíte.

### O que cada env faz

| Env | Efeito |
|---|---|
| `HL_COINS` | Pares deste processo. `BTC` = saldo inteiro; `BTC,SOL` = metade cada. |
| `ACCOUNT` | `1` (omisso) ou `2`… escolhe `PRIVATE_KEY_N`. |
| `LEVERAGE` | Multiplica a fatia. O alfa **live** ainda só aceita `1`. |
| `PORT` | HTTP de leitura. Segundo processo = outra porta. |
| `DRY_RUN=true` | Sem ordem real. Sem signer. |

O risco fino é o saldo na Hyperliquid: queres operar `$500` de `$1000`, tiras `$500` do perps.

## Laboratório

`POLICY=jev`, `dumb`, `numeric` e `stance` existem para comparar políticas no mesmo ledger — **não**
são o motor desta conta e não têm receita aqui.

## Painel

`web/` é o painel Next (desk) e **não** sobe com o `start`: use `bun run dev:web`.

## TradingView

O `s` do motor, em espelho, para acompanhar no TV: `tv/sigma.pine` — leia `tv/README.md` (o que confere, com
que vectores, e o que não pode divergir). Não é uma variante: é para dar o mesmo número.

Ensaios antigos: archive/. Não implementar.

## Motor na VPS (Tailscale)

O motor serve HTTP **de leitura** em `:3000` (`GET /`, `/snapshot`, `/history`, `/tape`, `/events`;
não há rota de escrita) e o desk na Vercel lê dali. Como a conta da VPS é mainnet e o `/snapshot`
mostra posição, equity e PnL, a porta **não** se abre na internet: o acesso é por Tailscale Serve,
que publica o serviço **só dentro da tailnet**, com certificado TLS automático (`*.ts.net`, sem
domínio e sem custo).

### Montagem na VPS (uma vez)

```bash
sudo tailscale up --accept-dns=false --hostname=<nome-da-vps>   # abre o URL, entra na conta, aprova
sudo tailscale serve --bg 3000                                  # serve a :3000 só dentro da tailnet
```

O `--accept-dns=false` é deliberado na VPS: um servidor não deve passar o DNS pela tailnet. E é
`serve`, **nunca** `funnel`: o Funnel publicaria na internet, que é exactamente o que não queremos.

### Clientes (desktop e telemóvel)

Instalar o Tailscale e entrar com a **mesma conta** que aprovou a VPS. Nos clientes, ao contrário da
VPS, o MagicDNS fica **ligado**: é ele que faz o nome resolver, e sem ele o desk fica `Offline`. O
MagicDNS não substitui o DNS normal, só responde aos nomes da tailnet.

No telemóvel é só isto: app Tailscale, entrar com a mesma conta, ligar, e abrir o desk no browser.

### Verificação

Dentro da tailnet, em qualquer dispositivo ligado:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<nome-da-vps>.<tailnet>.ts.net/snapshot   # 200
tailscale status            # a VPS tem de aparecer na lista
tailscale serve status      # mostra a :3000
tailscale funnel status     # tem de sair VAZIO: é a prova de que nada está público
```

Fora da tailnet o nome não resolve e o `curl` devolve `000`. Isso é o comportamento correcto, não
uma avaria: é o que impede que a posição da conta fique à vista de quem tiver o endereço.

### O desk

`NEXT_PUBLIC_API_URL` aponta para `https://<nome-da-vps>.<tailnet>.ts.net`. Como as variáveis
`NEXT_PUBLIC_*` são embutidas no build, **mudar o valor exige um redeploy**. O valor aparece no
bundle público, mas sem a tailnet o endereço é inalcançável, por isso não é uma porta aberta.

### Actualizar o motor da VPS

O `git pull` não afecta o processo em curso (o código já está carregado), portanto a janela de
paragem é apenas o parar e subir. Nunca mudar configuração e código no mesmo passo.

```bash
cd ~/hl-jev
git log -1 --format='%h %s'                                    # de onde vens
git fetch origin && git checkout main && git pull --ff-only
git log -1 --format='%h %s'                                    # tem de ser o commit que se quer
```

Ao subir, a primeira linha do log tem de continuar a bater certo (é o `bootLine` do `src/gate.ts`):

```
sigma · policy=sigma · coin=SOL · net=mainnet · dry=false · lev=1 · cap=$100 · pares=1 · cbFlips=4 (config) · ...
```

O `cbFlips` traz a **origem** entre parênteses: `(config)` quando é o default do `config.ts`, `(env)`
quando o `CB_FLIPS` venceu. Assim a divergência entre o repo e o que corre nunca é silenciosa. O
`CB_FLIPS`, o `CB_WINDOW_H` e o `CB_CAIXA_H` são os únicos ajustes por ambiente do circuito, e um
valor fora de banda (0, negativo, absurdo) faz o porteiro recusar o arranque.

**Com posição aberta**: o motor não guarda posição em disco, lê-a do venue (`clearinghouseState`,
subscrito no `feed` e aplicado no `market.init`), por isso não há nada a reconciliar: ele retoma a
posição que o venue reporta. Se o `s` tiver virado enquanto esteve parado, ele fecha na primeira
leitura, e isso é a regra a funcionar. Reverter é voltar ao commit anterior e subir outra vez.

### Segredos

O `.env` (chaves, carteiras, API keys) está no `.gitignore` e nunca entra no repo, em cartões, em
issues ou nesta documentação. O `docs/` também está ignorado: é o lugar de notas que não devem ser
versionadas, incluindo os valores reais do Tailscale deste projecto.

## Licença

MIT. Copyright 2026 aowang. Inclui código MIT publicado originalmente como jev-trader por Jarrod Watts.
