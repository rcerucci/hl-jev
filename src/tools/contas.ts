/**
 * Lista as carteiras no env. Não imprime chaves.
 *
 *   bun run contas
 */
import { listedAccounts, processPrivateKey } from "../sleeves";
import { hexKey } from "../config";
import { privateKeyToAccount } from "viem/accounts";

function maskAddr(addr: string): string {
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function addrOf(key: string): string {
  try {
    return privateKeyToAccount(hexKey(key)).address;
  } catch {
    return "(chave inválida)";
  }
}

const rows = listedAccounts();
const current = processPrivateKey();

if (!rows.length) {
  console.log("nenhuma PRIVATE_KEY / PRIVATE_KEY_1…9 no env");
  process.exit(0);
}

console.log(`deste processo: ACCOUNT=${current.account} (${current.source})`);
for (const r of rows) {
  const mark = r.account === current.account && r.source === current.source ? " ← em uso" : "";
  console.log(`${r.account}  ${r.source}  ${maskAddr(addrOf(r.key))}${mark}`);
}
