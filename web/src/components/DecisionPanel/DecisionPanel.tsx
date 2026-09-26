"use client";

import type { BlockEvent, Meta } from "@/lib/types";
import { fmtCall, fmtPct } from "@/lib/format";
import { Bone } from "@/components/Skeleton/Skeleton";
import styles from "./DecisionPanel.module.css";

export interface DecisionPanelProps {
  latest: BlockEvent | null;
  meta?: Meta | null;
  waiting?: boolean;
}

interface BarRowProps {
  label: string;
  labelColor: string;
  active: boolean;
  value: number;
  fill: string;
  pct: string;
}

function BarRow({ label, labelColor, active, value, fill, pct }: BarRowProps) {
  return (
    <div className={styles.row}>
      <span className={styles.label} style={{ color: labelColor, opacity: active ? 1 : 0.38 }}>
        {label}
      </span>
      <div className={styles.track}>
        <div
          className={styles.fill}
          style={{
            width: `${Math.max(0, Math.min(1, value)) * 100}%`,
            background: fill,
          }}
        />
      </div>
      <span className={styles.pct}>{pct}</span>
    </div>
  );
}

export default function DecisionPanel({ latest, waiting = false }: DecisionPanelProps) {
  if (waiting && !latest) {
    return (
      <div className={styles.panel} aria-busy="true" aria-label="Loading call">
        <section className={styles.section}>
          <div className={styles.railHead}>CALL</div>
          <div className={styles.body}>
            <div className={styles.headline}>
              <Bone w={72} h={22} />
              <span className={styles.metaLine}>
                <Bone w={40} h={10} />
              </span>
            </div>
            <div className={styles.bars}>
              {["long", "short", "open", "close", "hold"].map((label) => (
                <div key={label} className={styles.row}>
                  <span className={styles.label} style={{ opacity: 0.38 }}>
                    {label}
                  </span>
                  <div className={styles.track} />
                  <span className={styles.pct}>
                    <Bone w={28} h={10} />
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    );
  }

  const decision = latest?.decision ?? null;
  // O caminho fundido marca-se com `act`: e o unico campo que a POLICY escreve.
  const fusion = decision?.act != null;
  const late = decision ? decision.late : true;
  const held = decision?.intent === "hold";
  const chosen =
    decision && !decision.late && !held && decision.action !== "hold"
      ? (decision.bias ?? decision.action)
      : null;

  const probs = decision?.probabilities ?? { buy: 0, sell: 0, hold: 0 };
  // A hold is a real answer, so its bars stay readable instead of greying out.
  const decided = decision !== null && !late && (fusion || chosen !== null || held);
  const pctOf = (p: number | undefined) => (decided ? fmtPct(p ?? 0) : "-");
  const num = (x: number | undefined) => (typeof x === "number" ? x.toFixed(2) : "-");

  const headline = !decided
    ? "LATE"
    : fusion
      ? (decision?.act ?? "hold").toUpperCase()
      : fmtCall(decision) || "HOLD";
  const headlineColor = !decided
    ? "var(--late-ink)"
    : fusion
      ? decision?.act === "sell"
        ? "var(--sell-ink)"
        : decision?.act === "buy"
          ? "var(--buy-ink)"
          : "var(--ink-2)"
      : held
        ? "var(--ink-2)"
        : chosen
          ? (decision?.bias ?? decision?.action) === "short" || decision?.action === "sell"
            ? "var(--sell-ink)"
            : "var(--buy-ink)"
          : "var(--late-ink)";

  // Na fusao as barras sao as tres opcoes do Jev mais a hostilidade do `noul`
  // (o limiar do noul e do codigo, nao do modelo: a barra acende quando o gate
  // travou por `hostile`, nao quando passa de um numero).
  const fusionBars = [
    {
      label: "buy",
      labelColor: "var(--buy-ink)",
      active: decision?.act === "buy",
      value: probs.buy ?? 0,
      fill: "var(--buy-bar)",
      dim: "var(--buy-bar-dim)",
    },
    {
      label: "sell",
      labelColor: "var(--sell-ink)",
      active: decision?.act === "sell",
      value: probs.sell ?? 0,
      fill: "var(--sell-bar)",
      dim: "var(--sell-bar-dim)",
    },
    {
      label: "hold",
      labelColor: "var(--ink)",
      active: decision?.act === "hold",
      value: probs.hold ?? 0,
      fill: "var(--ink-2)",
      dim: "var(--hold-cell)",
    },
    {
      label: "hostile",
      labelColor: "var(--late-ink)",
      active: decision?.reason === "hostile",
      value: decision?.too_hostile ?? 0,
      fill: "var(--late-ink)",
      dim: "var(--late-cell)",
    },
  ];

  return (
    <div className={styles.panel}>
      <section className={styles.section}>
        <div className={styles.railHead}>{fusion ? "POLICY" : "CALL"}</div>
        <div className={styles.body}>
          <div className={styles.headline}>
            <span className={styles.headlineWord} style={{ color: headlineColor }}>
              {headline}
            </span>
            {decided && decision ? (
              <span className={styles.metaLine}>
                {fusion
                  ? `conf ${num(decision.act_conf)}, hostile ${num(decision.too_hostile)}, ${decision.latencyMs} ms`
                  : `${decision.latencyMs} ms`}
              </span>
            ) : null}
          </div>

          <div className={styles.bars}>
            {fusion
              ? fusionBars.map((b) => (
                  <BarRow
                    key={b.label}
                    label={b.label}
                    labelColor={b.labelColor}
                    active={b.active}
                    value={b.value}
                    fill={b.active ? b.fill : b.dim}
                    pct={pctOf(b.value)}
                  />
                ))
              : (
                  <>
                    <BarRow
                      label="long"
                      labelColor="var(--buy-ink)"
                      active={!held && decision?.bias === "long"}
                      value={probs.long ?? probs.buy}
                      fill={!held && decision?.bias === "long" ? "var(--buy-bar)" : "var(--buy-bar-dim)"}
                      pct={pctOf(probs.long ?? probs.buy)}
                    />
                    <BarRow
                      label="short"
                      labelColor="var(--sell-ink)"
                      active={!held && decision?.bias === "short"}
                      value={probs.short ?? probs.sell}
                      fill={!held && decision?.bias === "short" ? "var(--sell-bar)" : "var(--sell-bar-dim)"}
                      pct={pctOf(probs.short ?? probs.sell)}
                    />
                    <BarRow
                      label="open"
                      labelColor="var(--ink)"
                      active={decision?.intent === "open"}
                      value={probs.open ?? 0}
                      fill={decision?.intent === "open" ? "var(--buy-bar)" : "var(--buy-bar-dim)"}
                      pct={pctOf(probs.open)}
                    />
                    <BarRow
                      label="close"
                      labelColor="var(--ink)"
                      active={decision?.intent === "close"}
                      value={probs.close ?? 0}
                      fill={decision?.intent === "close" ? "var(--sell-bar)" : "var(--sell-bar-dim)"}
                      pct={pctOf(probs.close)}
                    />
                    <BarRow
                      label="hold"
                      labelColor="var(--ink)"
                      active={held}
                      value={probs.hold ?? 0}
                      fill={held ? "var(--ink-2)" : "var(--hold-cell)"}
                      pct={pctOf(probs.hold)}
                    />
                  </>
                )}
          </div>

          {fusion && decided && decision?.state12 ? (
            <div className={styles.stateLine} title="as palavras que a POLICY viu (sem numeros)">
              {decision.state12}
            </div>
          ) : null}
          {fusion && decided && decision?.reason ? (
            <div className={styles.gateLine}>gate: {decision.reason}</div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
