// Spawns the consumer-path MCP server (npx from github master) and asks it for
// its tool list over the MCP stdio protocol — verifies the write tools are exposed.
import { spawn } from "node:child_process";

const SRC = process.env.MCP_SPEC || "github:Rikuto-des/yasuda-figma-mcp";
const env = {
  ...process.env,
  BRIDGE_TOKEN: "testtoken-" + Date.now(),
  BRIDGE_EMBED: "1",
  BRIDGE_PORT: "3199",
  BRIDGE_URL: "ws://127.0.0.1:3199",
  BRIDGE_CHANNEL: "default",
};

console.log("spawning: npx -y " + SRC + " mcp  (first run builds from source — may take ~1 min)");
const child = spawn("npx", ["-y", SRC, "mcp"], { env, stdio: ["pipe", "pipe", "pipe"] });

let buf = "";
const pending = new Map();
let ready = false;

child.stdout.on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id != null && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  }
});
child.stderr.on("data", (d) => {
  const s = d.toString();
  if (/ready \(stdio\)/.test(s) && !ready) { ready = true; run().catch(fail); }
});

function send(obj) { child.stdin.write(JSON.stringify(obj) + "\n"); }
function req(id, method, params) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("timeout waiting for " + method)), 20000);
    pending.set(id, (m) => { clearTimeout(t); res(m); });
    send({ jsonrpc: "2.0", id, method, params });
  });
}
function fail(e) { console.error("FAIL:", e.message); child.kill(); process.exit(1); }

const bootTimeout = setTimeout(() => fail(new Error("server never became ready (build/boot timeout)")), 150000);

async function run() {
  clearTimeout(bootTimeout);
  await req(1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  const res = await req(2, "tools/list", {});
  const tools = (res.result && res.result.tools || []).map((t) => t.name).sort();
  console.log("\ntools exposed (" + tools.length + "):");
  for (const t of tools) console.log("  - " + t);
  const need = ["yfigma_apply_ui_spec", "yfigma_list_component_sets"];
  const missing = need.filter((n) => !tools.includes(n));
  console.log("");
  if (missing.length) { fail(new Error("missing write tools: " + missing.join(", "))); }
  console.log("PASS — consumer npx path exposes the write tools: " + need.join(", "));
  child.kill();
  process.exit(0);
}
