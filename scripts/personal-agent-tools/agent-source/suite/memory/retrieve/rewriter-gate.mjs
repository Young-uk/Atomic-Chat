import { isReferentialMessage } from "./referential-detector.mjs";
function createHeuristicGate() {
  return {
    name: "heuristic",
    async check({ message, historyTurnCount }) {
      return isReferentialMessage(message, historyTurnCount);
    }
  };
}
function createAlwaysGate() {
  return {
    name: "always",
    async check() {
      return true;
    }
  };
}
export {
  createAlwaysGate,
  createHeuristicGate
};
