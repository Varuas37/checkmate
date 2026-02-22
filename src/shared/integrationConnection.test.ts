import assert from "node:assert/strict";
import test from "node:test";

import { testAnthropicApiConnection, testCliAgentConnection } from "./integrationConnection.ts";

test("testAnthropicApiConnection requires a non-empty API key", async () => {
  await assert.rejects(
    async () => testAnthropicApiConnection(" "),
    /Add an Anthropic API key before running a connection test\./,
  );
});

test("testCliAgentConnection requires a non-empty command", async () => {
  await assert.rejects(
    async () =>
      testCliAgentConnection({
        id: "cli-agent",
        name: "CLI Agent",
        command: " ",
        promptArgs: [],
      }),
    /Set a CLI command before running a connection test\./,
  );
});

test("testCliAgentConnection requires the Tauri desktop runtime", async () => {
  await assert.rejects(
    async () =>
      testCliAgentConnection({
        id: "cli-agent",
        name: "CLI Agent",
        command: "claude",
        promptArgs: ["-p"],
      }),
    /CLI connection tests are available only in the desktop app\./,
  );
});
