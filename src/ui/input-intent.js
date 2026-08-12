export function isComposingText(event) {
  return !!event?.isComposing || event?.keyCode === 229;
}

export function isCommandEnter(event) {
  return event?.key === "Enter" && !isComposingText(event);
}

export function isSubmitEnter(event) {
  return isCommandEnter(event) && !event.shiftKey;
}

export function followupCommitFromEnter(event) {
  if (!isSubmitEnter(event) || event.altKey) return null;
  return event.metaKey || event.ctrlKey ? "ask" : "note";
}
