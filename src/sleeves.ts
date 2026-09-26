import { existsSync, readFileSync } from "node:fs";
import { hexKey } from "./config";

export function coinPair(coin: string): string {
  return `${coin}-USD`;
}

export function sameCoin(a: string | undefined, b: string): boolean {
  return !!a && a === b;
}

export interface SleeveConfig {
  coin: string;
  pair: string;
  label: string;
  privateKey?: string;
}

export interface ProcessKey {
  key?: string;
  account: number;
  source: string;
}

export interface ListedAccount {
  account: number;
  source: string;
  key: string;
}

type WalletFile = { sleeves?: { coin?: string; privateKey?: string }[] };

/** `ACCOUNT=2` escolhe a segunda carteira. Default 1. */
export function accountIndex(e: Record<string, string | undefined> = process.env): number {
  const raw = (e.ACCOUNT ?? "1").trim();
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`ACCOUNT=${raw}: usa 1, 2, 3…`);
  return n;
}

/**
 * Sem ACCOUNT (ou ACCOUNT=1): PRIVATE_KEY se existir, senão PRIVATE_KEY_1.
 * ACCOUNT=2 → PRIVATE_KEY_2. .wallets.json por moeda continua a sobrepor-se.
 */
export function processPrivateKey(
  e: Record<string, string | undefined> = process.env,
): ProcessKey {
  const account = accountIndex(e);
  const numbered = e[`PRIVATE_KEY_${account}`]?.trim();
  if (account === 1) {
    const legacy = e.PRIVATE_KEY?.trim();
    if (legacy) return { key: legacy, account, source: "PRIVATE_KEY" };
    if (numbered) return { key: numbered, account, source: "PRIVATE_KEY_1" };
    return { account, source: "none" };
  }
  if (numbered) return { key: numbered, account, source: `PRIVATE_KEY_${account}` };
  return { account, source: `PRIVATE_KEY_${account}` };
}

/** Contas no env. A chave não se imprime aqui — o comando `contas` só mostra endereço. */
export function listedAccounts(
  e: Record<string, string | undefined> = process.env,
): ListedAccount[] {
  const out: ListedAccount[] = [];
  const legacy = e.PRIVATE_KEY?.trim();
  if (legacy) out.push({ account: 1, source: "PRIVATE_KEY", key: legacy });
  for (let i = 1; i <= 9; i++) {
    const key = e[`PRIVATE_KEY_${i}`]?.trim();
    if (key) out.push({ account: i, source: `PRIVATE_KEY_${i}`, key });
  }
  return out;
}

export function parseWalletsJson(raw: string): Map<string, string> {
  const out = new Map<string, string>();
  try {
    const parsed = JSON.parse(raw) as WalletFile | Record<string, string>;
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as WalletFile).sleeves)) {
      for (const s of (parsed as WalletFile).sleeves ?? []) {
        if (s.coin && s.privateKey) out.set(s.coin, s.privateKey);
      }
      return out;
    }
    if (parsed && typeof parsed === "object") {
      for (const [coin, key] of Object.entries(parsed as Record<string, string>)) {
        if (coin && typeof key === "string" && key) out.set(coin, key);
      }
    }
  } catch {
    // ignore junk
  }
  return out;
}

function loadWalletKeys(): Map<string, string> {
  const out = new Map<string, string>();
  if (existsSync(".wallets.json")) {
    try {
      for (const [coin, key] of parseWalletsJson(readFileSync(".wallets.json", "utf8"))) {
        out.set(coin, key);
      }
    } catch {
      // ignore junk
    }
  }
  const fromEnv = process.env.WALLETS_JSON;
  if (fromEnv) {
    for (const [coin, key] of parseWalletsJson(fromEnv)) out.set(coin, key);
  }
  return out;
}

export function loadSleeves(): SleeveConfig[] {
  const listed = (process.env.HL_COINS ?? "BTC,ETH,SOL,DOGE,BNB")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const file = loadWalletKeys();
  const processKey = processPrivateKey().key;
  return listed.map((coin) => {
    const fromFile = file.get(coin);
    const privateKey = fromFile ?? processKey;
    return {
      coin,
      pair: coinPair(coin),
      label: coin,
      privateKey: privateKey ? hexKey(privateKey) : undefined,
    };
  });
}
