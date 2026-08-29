export const AGENT_TURN_DEADLINE_MS = 300_000;

export function armAgentTurnDeadline(onDeadline) {
  const timer = setTimeout(onDeadline, AGENT_TURN_DEADLINE_MS);
  return function clearAgentTurnDeadline() {
    clearTimeout(timer);
  };
}
