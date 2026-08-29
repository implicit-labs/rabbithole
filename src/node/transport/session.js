// Stable public adapter entrypoint. The MCP-only listener/runtime is split from
// the shared HoleEngine so callers never import transport internals by depth.
export { RabbitholeSession } from "../mcp/hole-session/session.js";
