import fs from "node:fs";

const root = new URL("../../src/design/", import.meta.url);
export const CANVAS_STYLES = ["tokens.css", "canvas/base.css"]
  .map((name) => fs.readFileSync(new URL(name, root), "utf8"))
  .join("\n");
