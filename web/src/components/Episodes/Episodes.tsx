"use client";

import type { BlockEvent, Meta } from "@/lib/types";
import { fmtCoin, fmtPrice, fmtUsd, shortTx, txUrl } from "@/lib/format";
import { fmtH1Closed, fmtLevel, fmtS, fmtUtcClock, groupEpisodes, sideInk, sideWord } from "@/lib/sigma";
import { Bone } from "@/components/Skeleton/Skeleton";
import styles from "./Episodes.module.css";

const MAX_EPISODES = 40;

/**
 * Porque e que nao saiu ordem, com nome. Uma entrada que existia e nao entrou nunca fica em
 * silencio: o `act` diz o que o tick queria, e a bandeira diz o que o travou.
 */
function noOrderWords(d: BlockEvent["decision"]): string {
  if (!d) return "no decision";
  const words = [(d.act ?? "hold").toLowerCase()];
  if (d.clock_hold) words.push("clock hold");
  if (d.wick_veto) words.push("wick veto");
  if (d.cb_active) words.push("cb armed");
  if (d.reason && d.reason !== "jev_act") words.push(d.reason);
  return words.join(", ");
}

/**
 * Uma linha por H1 FECHADA, e nao por tick.
 *
 * O motor decide 24 vezes por dia (o relogio e a H1) e ticka a cada 2 s; a tape tick a tick que
 * estava aqui antes mostrava 16 899 linhas de `clock_hold` num dia. O que interessa e o fecho: que
 * barra foi lida, que `s` saiu dela, e o que a operacao fez com isso (encheu, ficou, ou foi
 * recusada pelo venue).
 */
export default function Episodes({
  events,
  coin,
  meta,
  waiting = false,
}: {
  events: BlockEvent[];
  coin: string;
  meta?: Meta | null;
  waiting?: boolean;
}) {
  const episodes = groupEpisodes(events, MAX_EPISODES);

  return (
    <section className={styles.feed}>
      <div className={styles.railHead}>
        <span>EPISODES</span>
        <span className={styles.railNote}>one row per H1 close</span>
      </div>
      <div className={styles.list}>
        {waiting && episodes.length === 0 ? (
          <div aria-busy="true" aria-label="Loading episodes">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className={styles.ep}>
                <div className={styles.head}>
                  <span className={styles.time}>
                    <Bone w={48} h={8} />
                  </span>
                  <span className={styles.bar}>
                    <Bone w={i % 2 ? 120 : 96} h={8} />
                  </span>
                  <span className={styles.act}>
                    <Bone w={48} h={8} />
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : episodes.length === 0 ? (
          <div className={styles.empty}>no H1 closes yet</div>
        ) : (
          episodes.map((ep) => {
            const d = ep.read.decision;
            const s = d?.s ?? null;
            const ink = sideInk(s);
            const fill = ep.fills.at(-1) ?? null;
            const refused = ep.refused.at(-1) ?? null;
            const quote = fill ? null : (ep.quotes.at(-1) ?? null);

            return (
              <div key={ep.barT} className={styles.ep}>
                <div className={styles.head}>
                  <span className={styles.time}>{fmtH1Closed(ep.barT)}</span>
                  <span className={styles.bar}>
                    hl2 {fmtLevel(d?.hl2)} close {fmtLevel(d?.bar_close)}
                  </span>
                  <span className={styles.ema}>EMA {fmtLevel(d?.ema_h1 ?? null)}</span>
                  <span className={styles.s} style={{ color: ink }}>
                    s {fmtS(s)}
                  </span>
                  {d?.wick_veto ? <span className={styles.veto}>wick veto</span> : null}
                  <span className={styles.act} style={{ color: ink }}>
                    {`\u2192 ${sideWord(s).toLowerCase()}`}
                  </span>
                </div>

                {fill ? (
                  <div className={styles.sub}>
                    <span className={styles.subFill}>
                      filled {fmtCoin(fill.fill?.size, coin, 3)} @ {fmtPrice(fill.fill?.price)}
                      {fill.fill?.dir ? ` ${fill.fill.dir}` : ""}
                    </span>
                    {fill.fill?.role ? <span className={styles.subMuted}>{` ${fill.fill.role}`}</span> : null}
                    {fill.fill?.unfilled != null ? (
                      <span className={styles.subMuted}>{` unfilled ${fill.fill.unfilled.toFixed(3)}`}</span>
                    ) : null}
                    {fill.fill?.feeUsd != null ? (
                      <span className={styles.subMuted}>{` fee ${fmtUsd(fill.fill.feeUsd, 4)}`}</span>
                    ) : null}
                    {fill.ts !== ep.read.ts ? (
                      <span className={styles.subMuted}>{` at ${fmtUtcClock(fill.ts)}`}</span>
                    ) : null}
                    {fill.fill && !fill.fill.simulated && fill.fill.txHash ? (
                      <a
                        className={styles.tx}
                        href={txUrl(fill.fill.txHash, meta?.explorerTx)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {shortTx(fill.fill.txHash)}
                      </a>
                    ) : null}
                  </div>
                ) : refused ? (
                  <div className={`${styles.sub} ${styles.subMuted}`}>
                    {`refused: ${refused.quote?.reason ?? "venue said no"}`}
                    {refused.quote?.txHash ? (
                      <a
                        className={styles.tx}
                        href={txUrl(refused.quote.txHash, meta?.explorerTx)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {shortTx(refused.quote.txHash)}
                      </a>
                    ) : null}
                  </div>
                ) : quote ? (
                  <div className={`${styles.sub} ${styles.subMuted}`}>
                    {`posted ${quote.quote?.side ?? ""} ${fmtCoin(quote.quote?.size, coin, 3)} @ ${fmtPrice(
                      quote.quote?.price,
                    )}`}
                    {quote.quote?.taker ? " (taker, crossed the touch)" : ""}
                  </div>
                ) : (
                  <div className={`${styles.sub} ${styles.subMuted}`}>
                    {`no order: ${noOrderWords(d)}`}
                    <span className={styles.ticks}>{` ${ep.ticks} ${ep.ticks === 1 ? "tick" : "ticks"} on this H1`}</span>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
