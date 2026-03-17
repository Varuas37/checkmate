import assert from "node:assert/strict";
import test from "node:test";

import {
  testApiConnection,
  testAnthropicApiConnection,
  testBedrockApiConnection,
  testLocalAgentConnection,
} from "./integrationConnection.ts";

test("testAnthropicApiConnection requires a non-empty API key", async () => {
  await assert.rejects(
    async () => testAnthropicApiConnection(" "),
    /Add an Anthropic API key before running a connection test\./,
  );
});

test("testLocalAgentConnection requires a non-empty CLI command", async () => {
  await assert.rejects(
    async () =>
      testLocalAgentConnection({
        id: "cli-agent",
        name: "CLI Agent",
        command: " ",
        promptArgs: [],
        acpCommand: "codex-acp",
        acpArgs: [],
      }, "cli"),
    /Set a CLI command before running a connection test\./,
  );
});

test("testLocalAgentConnection requires an ACP command for ACP transport", async () => {
  await assert.rejects(
    async () =>
      testLocalAgentConnection({
        id: "cli-agent",
        name: "CLI Agent",
        command: "claude",
        promptArgs: ["-p"],
        acpCommand: " ",
        acpArgs: [],
      }, "acp"),
    /Set an ACP command before running a connection test\./,
  );
});

test("testLocalAgentConnection requires the Tauri desktop runtime", async () => {
  await assert.rejects(
    async () =>
      testLocalAgentConnection({
        id: "cli-agent",
        name: "CLI Agent",
        command: "claude",
        promptArgs: ["-p"],
        acpCommand: "claude-agent-acp",
        acpArgs: [],
      }, "cli"),
    /Local-agent connection tests are available only in the desktop app\./,
  );
});

test("testBedrockApiConnection requires a model id", async () => {
  await assert.rejects(
    async () => testBedrockApiConnection({ modelId: " " }),
    /Add a Bedrock model ID before running a connection test\./,
  );
});

test("testBedrockApiConnection requires the Tauri desktop runtime", async () => {
  await assert.rejects(
    async () =>
      testBedrockApiConnection({
        region: "us-west-2",
        modelId: "anthropic.claude-3-haiku-20240307-v1:0",
      }),
    /AWS Bedrock is available only in the desktop app\./,
  );
});

test("testApiConnection routes to the selected backend", async () => {
  await assert.rejects(
    async () =>
      testApiConnection({
        backend: "anthropic",
        apiKey: " ",
        bedrockRegion: "us-west-2",
        bedrockModelId: "anthropic.claude-3-haiku-20240307-v1:0",
      }),
    /Add an Anthropic API key before running a connection test\./,
  );
});
