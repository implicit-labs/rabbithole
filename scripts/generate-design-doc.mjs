import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const docPath = path.join(root, "docs/design-system.md");
const tokensPath = path.join(root, "src/design/tokens.css");
const check = process.argv.includes("--check");
const [document, tokens] = await Promise.all([fs.readFile(docPath, "utf8"), fs.readFile(tokensPath, "utf8")]);
const start = document.indexOf("## 2. Token sheet");
const end = document.indexOf("### 2.1 Required interpretations");
if (start < 0 || end < 0 || end <= start) throw new Error("docs/design-system.md is missing its generated token section markers");
const generated = `## 2. Token sheet\n\nThis section is generated from \`src/design/tokens.css\`. Edit the stylesheet, then run \`npm run generate:design-doc\`.\n\n\`\`\`css\n${tokens.trimEnd()}\n\`\`\`\n\n`;
const next = document.slice(0, start) + generated + document.slice(end);
if (check) {
  if (next !== document) {
    process.stderr.write("docs/design-system.md token sheet is stale. Run npm run generate:design-doc.\n");
    process.exit(1);
  }
} else if (next !== document) {
  await fs.writeFile(docPath, next, "utf8");
}
