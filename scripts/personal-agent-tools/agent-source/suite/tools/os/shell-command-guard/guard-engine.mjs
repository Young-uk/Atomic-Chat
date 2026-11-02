import { normaliseCommand } from "./normalise.mjs";
import { hardlineRule } from "./rules-hardline.mjs";
import { buildGitRemotePolicyRule } from "./rules-policy.mjs";
import { dangerousRule } from "./rules-dangerous.mjs";
import { gogReadOnlyRule } from "./rules-trusted/gog.mjs";
import { ghReadOnlyRule } from "./rules-trusted/gh.mjs";
import { icalBuddyReadOnlyRule } from "./rules-trusted/ical-buddy.mjs";
import { safeAllowRule } from "./rules-safe-allow.mjs";
const RULES_AFTER_HARDLINE = [
  dangerousRule,
  gogReadOnlyRule,
  ghReadOnlyRule,
  icalBuddyReadOnlyRule,
  safeAllowRule
];
const DEFAULT_RULES = [hardlineRule, ...RULES_AFTER_HARDLINE];
function checkShellCommandGuard(input, policy) {
  const rules = policy ? [hardlineRule, buildGitRemotePolicyRule(policy), ...RULES_AFTER_HARDLINE] : DEFAULT_RULES;
  return checkShellCommandGuardWithRules(input, rules);
}
function checkShellCommandGuardWithRules(input, rules) {
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
        reason: `rule ${rule.id} threw (fail-closed)`
      };
    }
  }
  return {
    action: "approval_required",
    rule: "default",
    reason: "no shell guard rule matched; approval required"
  };
}
function normaliseSafely(input) {
  try {
    return { status: "ok", command: normaliseCommand(input) };
  } catch {
    return {
      status: "error",
      verdict: {
        action: "approval_required",
        rule: "guard.normalise_failed",
        reason: "shell guard normalisation failed (fail-closed)"
      }
    };
  }
}
export {
  checkShellCommandGuard,
  checkShellCommandGuardWithRules
};
