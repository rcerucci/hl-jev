import { expect, test } from "bun:test";
import { config } from "../src/config";
import { entryNotional } from "../src/size";

const cap = () => config.maxLiveEquityUsd;

test("um par: nocional = saldo x alavancagem", () => {
  expect(entryNotional(1000, 1, { dryRun: true, capUsd: 100, pairs: 1 })).toBe(1000);
  expect(entryNotional(1000, 2, { dryRun: true, capUsd: 100, pairs: 1 })).toBe(2000);
});

test("HL_COINS com 2 pares: saldo a metade; 3 pares a um terco", () => {
  expect(entryNotional(1000, 1, { dryRun: true, capUsd: 100, pairs: 2 })).toBe(500);
  expect(entryNotional(1000, 2, { dryRun: true, capUsd: 100, pairs: 2 })).toBe(1000);
  expect(entryNotional(900, 1, { dryRun: true, capUsd: 100, pairs: 3 })).toBe(300);
});

test("live: tecto no saldo da conta, depois a divisao", () => {
  expect(cap()).toBe(100);
  expect(entryNotional(40, 1, { dryRun: false, capUsd: cap(), pairs: 1 })).toBe(40);
  expect(entryNotional(250, 1, { dryRun: false, capUsd: cap(), pairs: 1 })).toBe(100);
  expect(entryNotional(250, 1, { dryRun: false, capUsd: cap(), pairs: 2 })).toBe(50);
  expect(entryNotional(80, 1, { dryRun: false, capUsd: cap(), pairs: 2 })).toBe(40);
});

test("saldo invalido nao abre tamanho", () => {
  expect(entryNotional(0, 1, { dryRun: false, capUsd: 100 })).toBe(0);
  expect(entryNotional(-10, 1, { dryRun: true, capUsd: 100, pairs: 2 })).toBe(0);
});
