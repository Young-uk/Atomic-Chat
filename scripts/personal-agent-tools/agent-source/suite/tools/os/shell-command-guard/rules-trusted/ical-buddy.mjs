const icalBuddyReadOnlyRule = {
  id: "ical_buddy.read_only",
  layer: "trusted",
  match(input) {
    if (input.cmd !== "icalbuddy") return null;
    return {
      action: "allow",
      rule: "ical_buddy.read_only",
      reason: "icalBuddy read-only calendar reader"
    };
  }
};
export {
  icalBuddyReadOnlyRule
};
