import type {
  GuardInput,
  GuardVerdict,
  Rule,
  ShellGuardPolicy,
} from "./guard-types.mjs";
import { normaliseCommand } from "./normalise.mjs";
import { hardlineRule } from "./rules-hardline.mjs";
import { buildGitRemotePolicyRule } from "./rules-policy.mjs";
import { dangerousRule } from "./rules-dangerous.mjs";
import { gogReadOnlyRule } from "./rules-trusted/gog.mjs";
import { ghReadOnlyRule } from "./rules-trusted/gh.mjs";
import { icalBuddyReadOnlyRule } from "./rules-trusted/ical-buddy.mjs";
import { safeAllowRule } from "./rules-safe-allow.mjs";

/** Everything after the hardline layer, in evaluation order. */
const RULES_AFTER_HARDLINE: readonly Rule[] = [
  dangerousRule,
  gogReadOnlyRule,
  ghReadOnlyRule,
  icalBuddyReadOnlyRule,
  safeAllowRule,
];

const DEFAULT_RULES: readonly Rule[] = [hardlineRule, ...RULES_AFTER_HARDLINE];

/**
 * Evaluate the default rule set. A `policy` (injected by the bootstrap,
 * absent in unit tests and embedders that have no config) adds the
 * operator-policy layer right after the hardline rules, so a policy
 * refusal can never be shadowed by a trusted or safe-allow match.
 */
export function checkShellCommandGuard(
  input: GuardInput,
  policy?: ShellGuardPolicy,
): GuardVerdict {
  const rules = policy
    ? [hardlineRule, buildGitRemotePolicyRule(policy), ...RULES_AFTER_HARDLINE]
    : DEFAULT_RULES;
  return checkShellCommandGuardWithRules(input, rules);
}

export function checkShellCommandGuardWithRules(
  input: GuardInput,
  rules: readonly Rule[],
): GuardVerdict {
  const normalised = normaliseSafely(input);
  if (normalised.status === "error") return normalised.verdict;

  for (const rule of rules) {
    try {
      const verdict = rule.match(normalised.command, input);
      if (verdict !== null) return verdict;
    } catch {
      return {
        action: "approval_required",
        rule: `${rule.id}.error`,
        reason: `rule ${rule.id} threw (fail-closed)`,
      };
    }
  }

  return {
    action: "approval_required",
    rule: "default",
    reason: "no shell guard rule matched; approval required",
  };
}

function normaliseSafely(
  input: GuardInput,
):
  | { status: "ok"; command: ReturnType<typeof normaliseCommand> }
  | { status: "error"; verdict: GuardVerdict } {
  try {
    return { status: "ok", command: normaliseCommand(input) };
  } catch {
    return {
      status: "error",
      verdict: {
        action: "approval_required",
        rule: "guard.normalise_failed",
        reason: "shell guard normalisation failed (fail-closed)",
      },
    };
  }
}
