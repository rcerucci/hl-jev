"use client";

import { useEffect, useState } from "react";
import { fmtSignedUsd, fmtUsd } from "@/lib/format";
import Logo from "@/components/Logo/Logo";
import { Bone } from "@/components/Skeleton/Skeleton";
import styles from "./Header.module.css";

export interface HeaderProps {
  connection: "connecting" | "live" | "reconnecting";
  balance: number | null;
  unrealized: number | null;
  realized: number | null;
  /** Sem conta para ler (dry run), o balanco nao existe: diz-se, em vez de carregar para sempre. */
  dryRun?: boolean;
}

/**
 * Conta: `balance` e a conta da venue quando ela responde. Em dry run nao ha conta para ler, e
 * entao diz-se isso em texto, em vez de deixar um esqueleto eterno a fingir que esta a carregar.
 */
function Score({
  label,
  value,
  signed = true,
  empty,
}: {
  label: string;
  value: number | null;
  signed?: boolean;
  empty?: string;
}) {
  const color = !signed || value == null ? undefined : value >= 0 ? "var(--pnl-pos)" : "var(--pnl-neg)";
  return (
    <span className={styles.score}>
      <span className={styles.scoreKey}>{label}</span>
      <span className={styles.scoreVal} style={color ? { color } : undefined}>
        {value != null ? (
          signed ? (
            fmtSignedUsd(value, 2)
          ) : (
            fmtUsd(value, 2)
          )
        ) : empty ? (
          <span className={styles.scoreEmpty}>{empty}</span>
        ) : (
          <Bone w={64} h={16} />
        )}
      </span>
    </span>
  );
}

function GitHubMark() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"
      />
    </svg>
  );
}

/**
 * Claro/escuro. O tema vive em `data-theme` no <html> (o guiao do <head> ja o
 * resolveu antes da pintura); aqui so se troca e se grava a escolha.
 */
function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const atual = document.documentElement.getAttribute("data-theme");
    setTheme(atual === "dark" ? "dark" : "light");
  }, []);

  const trocar = () => {
    const proximo = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", proximo);
    try {
      localStorage.setItem("theme", proximo);
    } catch {
      /* sem armazenamento: o tema vale so nesta sessao */
    }
    setTheme(proximo);
  };

  const alvo = theme === "dark" ? "claro" : "escuro";
  return (
    <button type="button" className={styles.themeBtn} onClick={trocar} title={`mudar para ${alvo}`} aria-label={`mudar para tema ${alvo}`}>
      {alvo}
    </button>
  );
}

export default function Header({ connection, balance, unrealized, realized, dryRun = false }: HeaderProps) {
  const live = connection === "live";

  return (
    <div className={styles.header}>
      <span className={styles.brandLockup}>
        <Logo size={20} />
        <h1 className={styles.brand}>Sigma × Hyperliquid</h1>
        <p className={styles.tagline}>s = sign(hl2 - EMA24) na H1</p>
        <span className={styles.links}>
          <a
            className={styles.link}
            href="https://github.com/rcerucci/hl-jev"
            target="_blank"
            rel="noreferrer"
            aria-label="hl-jev on GitHub"
          >
            <GitHubMark />
          </a>
        </span>
      </span>
      <ThemeToggle />
      <span className={styles.status} data-live={live ? "true" : "false"}>
        <span className={styles.dot} aria-hidden="true" />
        <span>{live ? "Live" : "Offline"}</span>
      </span>
      <span className={styles.scores}>
        <Score label="balance" value={balance} signed={false} empty={dryRun ? "-- dry run" : undefined} />
        <Score label="unrealized" value={unrealized} />
        <Score label="realized" value={realized} />
      </span>
    </div>
  );
}
