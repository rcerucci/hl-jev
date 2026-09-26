import { expect, test } from "bun:test";
import { config } from "../src/config";
import { entryNotional } from "../src/size";

test("dry run: nocional e saldo x alavancagem, sem tecto", () => {
  expect(entryNotional(250, 1, { dryRun: true, capUsd: 100 })).toBe(250);
  expect(entryNotional(40, 1, { dryRun: true, capUsd: 100 })).toBe(40);
});

test("live: tecto em maxLiveEquityUsd x leverage", () => {
  const cap = config.maxLiveEquityUsd;
  expect(cap).toBe(100);
  expect(entryNotional(40, 1, { dryRun: false, capUsd: cap })).toBe(40);
  expect(entryNotional(100, 1, { dryRun: false, capUsd: cap })).toBe(100);
  expect(entryNotional(250, 1, { dryRun: false, capUsd: cap })).toBe(100);
  expect(entryNotional(80, 2, { dryRun: false, capUsd: cap })).toBe(160);
  expect(entryNotional(200, 2, { dryRun: false, capUsd: cap })).toBe(200);
});

test("saldo ou tecto invalido nao abre tamanho", () => {
  expect(entryNotional(0, 1, { dryRun: false, capUsd: 100 })).toBe(0);
  expect(entryNotional(-10, 1, { dryRun: false, capUsd: 100 })).toBe(0);
  expect(entryNotional(50, 1, { dryRun: false, capUsd: 0 })).toBe(0);
});
