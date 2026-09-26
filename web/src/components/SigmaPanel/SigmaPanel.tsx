"use client";

import type { BlockEvent } from "@/lib/types";
import { fmtCoin, fmtPrice, fmtUsd } from "@/lib/format";
import { fmtH1Closed, fmtLevel, fmtS, fmtSigned, isSigmaDecision, sideInk, sideWord } from "@/lib/sigma";
import { Bone } from "@/components/Skeleton/Skeleton";
import styles from "./SigmaPanel.module.css";

export default function SigmaPanel({
  latest,
  waiting = false,
  bootLine,
}: {
  latest: BlockEvent | null;
  waiting?: boolean;
  bootLine?: string | null;
}) {
  const decision = latest?.decision ?? null;
  const sigma = isSigmaDecision(decision) ? decision : null;

  if (!sigma) {
    return (
      <div className={styles.panel} aria-busy={waiting ? "true" : undefined} aria-label="Loading sigma">
        <section className={styles.section}>
          <div className={styles.railHead}>
            <span>SIGMA H1</span>
            <span className={styles.railNote}>{bootLine || "—"}</span>
          </div>
          <div className={styles.body}>
            {waiting ? (
              <>
                <div className={styles.headline}>
                  <Bone w={72} h={22} />
                </div>
                <div className={styles.grid}>
                  {["barra lida", "EMA24", "hl2 - EMA24", "s"].map((k) => (
                    <span key={k} className={styles.gridLabel}>
                      {k}
                    </span>
                  ))}
                  {["barra lida", "EMA24", "hl2 - EMA24", "s"].map((k) => (
                    <span key={k} className={styles.gridValue}>
                      <Bone w={96} h={10} />
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <div className={styles.empty}>no sigma reading yet</div>
            )}
          </div>
        </section>
      </div>
    );
  }

  const s = sigma.s ?? null;
  const delta =
    typeof sigma.delta === "number"
      ? sigma.delta
      : sigma.hl2 != null && sigma.ema_h1 != null
        ? sigma.hl2 - sigma.ema_h1
        : null;
  const pos = latest?.position ?? null;
  const lev = decision?.leverage ?? null;
  const venue = typeof latest?.accountValue === "number" ? latest.accountValue : null;
  const free = typeof latest?.withdrawable === "number" ? latest.withdrawable : null;
  const equity = sigma.equity ?? null;
  const notional = sigma.notional ?? null;
  const act = (sigma.act ?? "hold").toUpperCase();
  const reason = sigma.reason && sigma.reason !== "jev_act" ? sigma.reason : null;
  const positionLine =
    !pos || pos.side === "flat"
      ? "FLAT"
      : `${pos.side.toUpperCase()} ${fmtCoin(pos.size, latest?.coin, 4)}${
          pos.entryPrice != null ? ` @ ${fmtPrice(pos.entryPrice)}` : ""
        }`;

  return (
    <div className={styles.panel}>
      <section className={styles.section}>
        <div className={styles.railHead}>
          <span>SIGMA H1</span>
          <span className={styles.railNote}>{bootLine || "—"}</span>
        </div>
        <div className={styles.body}>
          <div className={styles.headline}>
            <span className={styles.headlineWord} style={{ color: sideInk(s) }}>
              {sideWord(s)}
            </span>
            <span className={styles.metaLine} title="a H1 FECHADA que decidiu, em UTC.">
              H1 {fmtH1Closed(sigma.bar_t)}
            </span>
          </div>

          <div className={styles.grid}>
            <span className={styles.gridLabel}>barra lida</span>
            <span className={styles.gridValue}>
              hl2 {fmtLevel(sigma.hl2)} close {fmtLevel(sigma.bar_close)}
            </span>
            <span className={styles.gridLabel}>EMA24</span>
            <span className={styles.gridValue}>{sigma.ema_h1 != null ? fmtLevel(sigma.ema_h1) : "-"}</span>
            <span className={styles.gridLabel}>hl2 - EMA24</span>
            <span className={styles.gridValue} style={{ color: sideInk(delta) }}>
              {fmtSigned(delta)}
            </span>
            <span className={styles.gridLabel}>s</span>
            <span className={styles.gridValue} style={{ color: sideInk(s) }}>
              {fmtS(s)}
            </span>
          </div>

          <div className={styles.flags}>
            <span className={`${styles.flag} ${sigma.wick_veto ? styles.flagOn : ""}`}>
              {sigma.wick_veto ? "wick veto" : "wick clear"}
            </span>
            <span className={`${styles.flag} ${sigma.clock_hold ? styles.flagOn : ""}`}>
              {sigma.clock_hold ? "clock hold" : "clock free"}
            </span>
            <span className={`${styles.flag} ${sigma.cb_active ? styles.flagOn : ""}`}>
              {sigma.cb_active ? `cb armed ${sigma.cb_flips_12h ?? 0}/12h` : "cb off"}
            </span>
          </div>

          <div className={styles.foot}>
            <span className={styles.gridLabel}>account</span>
            <span className={styles.gridValue}>
              {venue != null ? (
                <>
                  {fmtUsd(venue, 2)}
                  <span className={styles.off}> venue</span>
                  {free != null && free !== venue ? (
                    <span className={styles.off}>{` (${fmtUsd(free, 2)} free)`}</span>
                  ) : null}
                </>
              ) : (
                <span className={styles.off}>venue offline</span>
              )}
            </span>
            <span className={styles.gridLabel}>sizing</span>
            <span className={styles.gridValue}>
              {equity != null ? fmtUsd(equity, 2) : "-"} x {lev != null ? `${lev}x` : "-"}
              {notional != null ? ` = ${fmtUsd(notional, 2)}` : ""}
              {venue == null ? <span className={styles.off}> config</span> : null}
            </span>
            <span className={styles.gridLabel}>position</span>
            <span className={styles.gridValue}>{positionLine}</span>
            <span className={styles.gridLabel}>this tick</span>
            <span className={styles.gridValue}>
              {act}
              {reason ? ` (${reason})` : ""}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
