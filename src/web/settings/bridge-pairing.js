export function takeBridgeTokenFromFragment(locationValue = globalThis.location, historyValue = globalThis.history) {
  const raw = String(locationValue?.hash || "").replace(/^#/, "");
  const params = new URLSearchParams(raw);
  if (!params.has("bridge")) return null;
  const token = params.get("bridge") || "";
  params.delete("bridge");
  const remainder = params.toString();
  const nextUrl = `${locationValue.pathname}${locationValue.search}${remainder ? `#${remainder}` : ""}`;
  historyValue.replaceState(historyValue.state, "", nextUrl);
  return token;
}
