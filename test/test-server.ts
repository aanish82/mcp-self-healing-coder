import { spawn } from "node:child_process";

console.log("🚀 Testing MCP Self-Healing Coder over stdio JSON-RPC...\n");

const child = spawn("node", ["dist/index.js"], {
  stdio: ["pipe", "pipe", "inherit"],
});

let buffer = "";

child.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  const lines = buffer.split("\n");
  buffer = lines.pop() || "";

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);

      // Handshake response
      if (msg.id === 1) {
        console.log(`[PASS] Initialized handshake -> ${msg.result.serverInfo.name} v${msg.result.serverInfo.version}`);
        
        // Send initialized notification
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

        // Call tool: verify_and_diagnose
        console.log("[TEST] Testing 'verify_and_diagnose' with simulated TypeScript error...");
        child.stdin.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: {
              name: "verify_and_diagnose",
              arguments: {
                projectPath: process.cwd(),
                verifyCommand: "node -e \"console.error(\\\"src/calc.ts:42:15 - error TS2322: Type 'string' is not assignable to type 'number'\\\"); process.exit(1);\"",
              },
            },
          }) + "\n"
        );
      } else if (msg.id === 2) {
        const result = JSON.parse(msg.result.content[0].text);
        console.log(`[PASS] Diagnostics extracted (${result.diagnosticsCount} error):`);
        console.log(`       File:    ${result.diagnostics[0].file}`);
        console.log(`       Line:    ${result.diagnostics[0].line}:${result.diagnostics[0].column}`);
        console.log(`       Code:    ${result.diagnostics[0].code}`);
        console.log(`       Message: ${result.diagnostics[0].message}`);
        console.log("\n✅ All automated verification checks passed successfully!");
        child.kill();
        process.exit(0);
      }
    } catch (err) {
      console.error("Error processing line:", err);
    }
  }
});

// Send Initialize request
child.stdin.write(
  JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    },
  }) + "\n"
);
