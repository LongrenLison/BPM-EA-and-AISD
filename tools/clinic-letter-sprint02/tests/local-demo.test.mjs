import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "../local-demo.mjs";

test("portable runner requires exact opt-in and bounded worker time", () => {
  for (const args of [[], ["deploy"], ["test"], ["prepare", "--local-demo", "extra"],
    ["worker", "--local-demo"], ["worker", "--local-demo", "--minutes", "0"],
    ["worker", "--local-demo", "--minutes", "31"], ["worker", "--local-demo", "--minutes", "1.5"]]) assert.throws(() => parseArgs(args));
  assert.equal(parseArgs(["test", "--local-demo"]).command, "test");
  assert.equal(parseArgs(["worker", "--local-demo", "--minutes", "15"]).minutes, 15);
});

test("default runner stops before a topology request or an engine write", () => {
  const runner = fileURLToPath(new URL("../local-demo.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [runner], { encoding: "utf8", timeout: 3000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Safety stop/);
  assert.equal(result.stdout, "");
});
