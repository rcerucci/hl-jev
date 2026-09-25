# Jev Trade

[![Live desk](https://img.shields.io/badge/live-jev--trade.com-111)](https://www.jev-trade.com/)
[![License: MIT](https://img.shields.io/badge/license-MIT-111)](LICENSE)

I built a trading bot with Jev. Jev reads the Hyperliquid book every tick and answers buy, sell, or hold. The bot sends the order. Five coins, five wallets, real fills.

**[Watch the live desk](https://www.jev-trade.com/)**

[![Jev Trade live desk](assets/desk.png)](https://www.jev-trade.com/)

Jev makes the call. Hold is one of its answers, so a tick can end with no order. Position, balance, and PnL come from Hyperliquid.

Based on [jev-trader](https://github.com/jarrodwatts/jev-trader) by Jarrod Watts (MIT). Venue is Hyperliquid, not Monad / Kuru.

## What you are looking at

- Five isolated sleeves: BTC, ETH, SOL, DOGE, BNB. Each has its own wallet and its own Jev call.
- The left pane is the live book as candles. Green and red marks are fills. The entry line is the open position.
- The right pane is the latest Jev call and the tape of every tick.
- The table is Positions and Trades, the same split a futures desk uses.

A live key on testnet or mainnet sends real orders. Start with a dry run.

## How a tick works

1. The bot reads the book.
2. Jev picks long or short, then open, close, or hold.
3. An entry is a post-only Alo quote one tick inside the touch, so it sits on the maker side until a taker hits it.
4. An exit is an Ioc that crosses the touch and fills on the spot.
5. Hold sends no order and pulls any resting quote Jev no longer wants.

The bot is Bun on port 3000. The dashboard is Next in `web/` on port 3001. Keys, evaluate, and orders stay on the Bun process.

## Dry run

[Bun](https://bun.sh) 1.2 or newer. No `PRIVATE_KEY` means a dry run: real book, real decisions, simulated fills. Default `MODEL=mock` is a momentum stand-in and needs no API key.

```sh
cp .env.example .env
bun install
bun run start
```

Dashboard (second terminal):

```sh
cp web/.env.example web/.env.local
bun run dev:web
```

Open http://localhost:3001. The page reads `$NEXT_PUBLIC_API_URL/events` (default `http://localhost:3000`).

## Live Jev

Set `MODEL=jev` and pick an API. Official TypeSafe is the default.

```sh
MODEL=jev
JEV_PROVIDER=typesafe
TYPESAFE_API_KEY=
# JEV_MODEL_ID defaults to jev-latest
```

Get a key from [docs.typesafe.ai](https://docs.typesafe.ai/).

Vercel AI Gateway is still supported:

```sh
MODEL=jev
JEV_PROVIDER=gateway
AI_GATEWAY_API_KEY=
# JEV_MODEL_ID defaults to typesafe-ai/jev
```

If `JEV_PROVIDER` is unset, the bot uses TypeSafe when `TYPESAFE_API_KEY` is set, otherwise Gateway when `AI_GATEWAY_API_KEY` is set.

## Live testnet orders

1. Keep `HL_TESTNET=true`.
2. Set `PRIVATE_KEY` for the first coin (BTC).
3. Copy `.wallets.example.json` to `.wallets.json` and put a key on each other sleeve. Or set `WALLETS_JSON`.
4. Get mock USDC from https://app.hyperliquid-testnet.xyz/drip. The faucet only pays addresses that have deposited on mainnet.
5. Leave `DRY_RUN=false`. A missing key on a sleeve still dry-runs that sleeve.

`HL_TESTNET=false` is mainnet. Do not flip that until you mean it.

## Tests

```sh
bun test
```

CI runs the same command on push and pull request.

## Fused policy path (POLICY)

`POLICY` turns on the policy/risk layer. Without it the bot runs exactly as before and `MODEL` decides.

### `POLICY=sigma` — the engine of the 100 account

The account this repo trades runs **one** mode: **`POLICY=sigma`**. An H1 decision clock; a single state
`s = sign(hl2 − EMA24)` of the **already closed** H1 candle (EMA from the previous bar, no lookahead); a
**wick veto** (a turn where only the wick crossed the EMA and the close stayed on the old side is ignored);
and a **chop circuit breaker** (3 turns in 12 h → 6 h of `caixa`, then the standing `s` applies again).
Inventory: long while `s > 0`, short while `s < 0`, hold while `s` does not move. Execution posts at the
touch and sends the rest to market; 1×, BTC first, re-sized at the episode close.

It landed in slices (spec → plan → tasks → PR). **`POLICY=sigma` resolves and runs**: the `s` and the wick
veto are live and the chop breaker arms 6 h of `caixa` on 3 turns in 12 h. Under `POLICY=sigma` the tick
decides **only when a new H1 close is born** — between closes it holds and leaves the resting quote alone,
so the 5m block cannot re-quote. The account itself is not traded yet — nothing here sends an order for it.

### Laboratory modes — no edge claimed, no recipe

| Mode | What it is | Live key OK? |
| --- | --- | --- |
| no `POLICY` | the legacy path (`MODEL`) | **no** — the fusion's gates do not exist on that path |
| `POLICY=jev` | the fusion: typed policy + risk gates | testnet |
| `POLICY=dumb` | control over the same twelve words, no network | yes |
| `POLICY=numeric` | `sign(last20)` control (ensaio N1, closed: insuficiente) | yes |
| `POLICY=stance` | museum: buy / sell / hold / caixa over `s` and the L=130 channel `u` | dry-run |

These exist to compare policies in the ledger, not to trade this account. `stance` stays in the code while
the sigma CI is not green, and it is **not** the account path: its channel `u` was measured on the real book
and **eats trend**. The discarded families — 5m decisions, `trend5`, P+V, the extreme flips, the flip-in-band
rule, `hysteresis`/ATR, and Jev/`dumb`/Laya as the engine of this account — are closed and tombstoned in
`PLANO-FUSAO.md`.

`caixa` is not `hold`. `caixa` flattens an open position (IOC reduce-only) and pulls the quote. `hold` after a `buy`/`sell` stance leaves the resting quote alone. This path does not claim edge.

`HL_TESTNET=true` is mandatory for the fusion. The attribution ensaio of 23 Sep 2026 (100 cycles per
policy, same book, testnet) closed as **amostra insuficiente**: 100% `hold` on both sides and `n=0` at
`conf >= 0.80`. Nothing there is evidence of edge — it is evidence that this book produces no experiment.

```sh
POLICY=sigma  # the account engine (lands in slices; not runnable here yet)
POLICY=jev    # laboratory: the fusion with the typed Jev policy
POLICY=dumb   # laboratory: the control over the twelve words
POLICY=stance # museum: s plus the L=130 channel u. Not a PnL claim.
```

The tick becomes: snapshot (numbers, kept off the Jev) -> twelve-word state -> policy -> risk gates -> plan -> the same `market.send`. There is one submit path.

Hold is an answer, and there are two kinds of hold:

- the Jev answered hold, or the gates refused for low confidence, a hostile book or heavy inventory: the resting quote is pulled;
- no valid answer at all (timeout, bad JSON, stale book): nothing is sent and nothing is cancelled.

Thresholds are env: `JEV_CONF_ACT`, `NOUL_HOSTILE_TH`, `JEV_TIMEOUT_MS`, `BOOK_STALE_MS`. Leverage on this path comes from `LEVERAGE` (default 1) and never from the model. The Jev never sees a price, a size, a time in force or a leverage.

Every cycle appends a `decision` line to `LEDGER_DIR` (`./data/ledger/<YYYYMMDD>-<COIN>.jsonl`), one file per sleeve per UTC day **of the decision**; the outcome line lands in the same file 15 minutes later, joined by `cycle_id`. A separate process writes the outcome from public marks (1m candles and funding history, no key), and the attribution table compares policies:

```sh
bun run src/ledger/outcome.ts       # +15 min outcome for every due cycle. Idempotent and re-runnable: nothing is invented when a candle is missing
bun run src/ledger/attribution.ts   # confidence against hit, per policy, with the control column and the sample size
```

The table refuses to conclude below the declared sample size and says out loud when the control ties or wins. That is the spec gate before the night editor or mainnet.

Do not point this path at mainnet. `HL_TESTNET=false` is mainnet, and the fused path has no live equity cap yet.

## Env

See [`.env.example`](.env.example). The ones that change behavior:

| Variable | Default | Meaning |
| --- | --- | --- |
| `HL_COINS` | `BTC,ETH,SOL,DOGE,BNB` | Sleeves to run |
| `HL_TESTNET` | `true` | `false` is mainnet |
| `MODEL` | `mock` | Legacy path. `jev` needs a TypeSafe or Gateway key |
| `POLICY` | empty | Empty is the legacy path. `sigma` is the account engine (slices); `jev`, `dumb`, `numeric` and `stance` are laboratory modes |
| `JEV_PROVIDER` | `typesafe` | `typesafe` or `gateway` |
| `TYPESAFE_API_KEY` | empty | Official TypeSafe key |
| `AI_GATEWAY_API_KEY` | empty | Vercel AI Gateway key |
| `PRIVATE_KEY` | empty | First coin. Empty is a dry run |
| `DRY_RUN` | `false` | `true` simulates every sleeve |
| `TICK_MS` | `2000` | Decision + requote cadence |
| `JEV_TIMEOUT_MS` | `800` | Fused path only. A timeout is a frozen tick |
| `JEV_CONF_ACT` | `0.80` | Below this the tick holds |
| `NOUL_HOSTILE_TH` | `0.65` | Above this a non-reduce order is held |
| `BOOK_STALE_MS` | `5000` | Older than this freezes the tick |
| `LEVERAGE` | `1` | Fused path. The model never picks it |
| `LEDGER_DIR` | `./data/ledger` | JSONL, one file per sleeve per decision day |
| `POLICY_FILE` | `./policy/jev_questions.json` | Versioned questions |
| `PRICE_MS` | `200` | Chart and mid prints. Does not call Jev |
| `QUOTE_USD` | `40` | Quote notional per tick |
| `CLOSE_SLIPPAGE_BPS` | `5` | How far an exit crosses the touch |
| `PORT` | `3000` | Bot SSE |

## Endpoints

- `GET /` snapshot: model, sleeves, latestByCoin
- `GET /history` last 1000 ticks per coin
- `GET /tape` all-time mid series plus fill marks per coin
- `GET /events` SSE: `snapshot` on connect (`historyByCoin`, `tapeByCoin`), then `block`, `quote`, `fill` keyed by coin

## Layout

```
src/           Bun bot
test/          bun tests
web/           Next dashboard
assets/        README shots of the live desk
```

## License

MIT. Copyright 2026 aowang. Includes MIT code originally published as jev-trader by Jarrod Watts.
