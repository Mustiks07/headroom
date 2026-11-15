// Wrap the published synthetic case inputs in the existing restorable plan format.
// No calculated output is stored. The app recalculates after the user imports the file.
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../..");
const dir = path.join(root, "docs/artifacts/round6/ui");
fs.mkdirSync(dir, { recursive: true });
for (const id of [1, 2, 3]) {
  const input = JSON.parse(fs.readFileSync(path.join(root, `docs/artifacts/round6/scenarios/inputs/case-${id}.json`), "utf8"));
  const workspace = input.workspace;
  workspace.id = `round6-judge-case-${id}`;
  workspace.revision = 0;
  if (input.goal && input.space) workspace.dealPlanning = { version: "1.0", goals: [input.goal], termSpaces: [input.space], cashContext: null, packages: [] };
  fs.writeFileSync(path.join(dir, `case-${id}-importable.json`), JSON.stringify({ kind: "headroom.workspace", workspaceVersion: "2.0", exportedAt: "2026-11-15T00:00:00.000Z", workspace, legacySnapshot: null }, null, 2) + "\n");
}
process.stdout.write("Prepared three restorable synthetic input files; no computed outputs included.\n");
