import { expect, test } from "bun:test";
import { resolvePolicy } from "../src/config";
import { accountIndex, listedAccounts, processPrivateKey } from "../src/sleeves";

const k1 = `0x${"11".repeat(32)}`;
const k2 = `0x${"22".repeat(32)}`;
const k3 = `0x${"33".repeat(32)}`;

test("sem POLICY o motor e sigma", () => {
  expect(resolvePolicy({})).toBe("sigma");
  expect(resolvePolicy({ POLICY: "  " })).toBe("sigma");
});

test("ACCOUNT default 1; rejeita lixo", () => {
  expect(accountIndex({})).toBe(1);
  expect(accountIndex({ ACCOUNT: "2" })).toBe(2);
  expect(() => accountIndex({ ACCOUNT: "0" })).toThrow(/1, 2/);
  expect(() => accountIndex({ ACCOUNT: "x" })).toThrow(/1, 2/);
});

test("sem PRIVATE_KEY o default e PRIVATE_KEY_1", () => {
  expect(processPrivateKey({ PRIVATE_KEY_1: k1 })).toEqual({
    key: k1,
    account: 1,
    source: "PRIVATE_KEY_1",
  });
});

test("PRIVATE_KEY vence PRIVATE_KEY_1 no ACCOUNT=1", () => {
  const got = processPrivateKey({ PRIVATE_KEY: k3, PRIVATE_KEY_1: k1 });
  expect(got.source).toBe("PRIVATE_KEY");
  expect(got.key).toBe(k3);
});

test("ACCOUNT=2 usa PRIVATE_KEY_2", () => {
  expect(processPrivateKey({
    ACCOUNT: "2",
    PRIVATE_KEY_1: k1,
    PRIVATE_KEY_2: k2,
  })).toEqual({ key: k2, account: 2, source: "PRIVATE_KEY_2" });
});

test("listedAccounts nao inventa contas vazias", () => {
  const rows = listedAccounts({
    PRIVATE_KEY: k3,
    PRIVATE_KEY_1: k1,
    PRIVATE_KEY_2: k2,
  });
  expect(rows.map((r) => r.source)).toEqual(["PRIVATE_KEY", "PRIVATE_KEY_1", "PRIVATE_KEY_2"]);
  expect(listedAccounts({}).length).toBe(0);
});
