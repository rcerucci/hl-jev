import { assertJevCredentials, config } from "../config";
import { JevPolicy } from "../model";
import type { Policy } from "../risk/types";
import { DumbPolicy } from "./dumb";
import { NumericPolicy } from "./numeric";
import { SigmaPolicy } from "./sigma";
import { StancePolicy } from "./stance";

/** Porta unica da fusao. POLICY=stance nao passa pelo Jev. */
export function createFusionPolicy(): Policy | null {
  if (config.policy === "dumb") return new DumbPolicy();
  if (config.policy === "numeric") return new NumericPolicy();
  if (config.policy === "stance") return new StancePolicy();
  if (config.policy === "sigma") return new SigmaPolicy();
  if (config.policy === "jev") {
    assertJevCredentials(
      "jev",
      config.lab.jevProvider,
      process.env as { TYPESAFE_API_KEY?: string; AI_GATEWAY_API_KEY?: string },
    );
    return new JevPolicy();
  }
  return null;
}
