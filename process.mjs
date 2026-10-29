// Long-lived process. Builds run here, because an agent tool must return
// within 60 seconds and a repository graph takes longer. The page reaches
// this server only through COGNIX[WS], which adds X-PiCode-Proxy-Secret.
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { ask, drain, enqueue, graphKey, readState, recover, sameSecret, whichGraphify } from "./lib/graph.mjs";
import { enabledWorkspaces } from "./lib/host.mjs";
import { INSTALL } from "./lib/view.mjs";

const dataDir = process.env.PICODE_EXT_DATA || "";
const port = Number(process.env.PICODE_EXT_PORT || 0);
const secret = process.env.PICODE_EXT_PROXY_SECRET || "";

function send(res, status, body) {
  const raw = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(raw) });
  res.end(raw);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on("data", (c) => {
      n += c.length;
      if (n > 256 * 1024) {
        reject(new Error("body is too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text) return resolve({});
      try { resolve(JSON.parse(text)); }
      catch { reject(new Error("body is not JSON")); }
    });
    req.on("error", reject);
  });
}

async function workspace(id) {
  const rows = await enabledWorkspaces();
  return rows.find((w) => w.id === id) || null;
}

async function handle(req, res) {
  if (!sameSecret(req.headers["x-picode-proxy-secret"], secret)) {
    send(res, 401, { error: "This call did not come through COGNIX[WS]." });
    return;
  }
  const url = new URL(req.url || "/", "http://127.0.0.1");
  try {
    if (req.method === "GET" && url.pathname === "/health") {
      send(res, 200, { binary: !!whichGraphify(), install: INSTALL });
      return;
    }
    if (req.method === "GET" && url.pathname === "/workspaces") {
      const rows = await enabledWorkspaces();
      send(res, 200, {
        binary: !!whichGraphify(),
        install: INSTALL,
        workspaces: rows.map((w) => ({ id: w.id, name: w.name || w.id })),
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/status") {
      const ws = await workspace(url.searchParams.get("workspace") || "");
      if (!ws) {
        send(res, 404, { error: "That workspace does not have Graphify turned on." });
        return;
      }
      const key = graphKey(ws.id, ws.path);
      send(res, 200, {
        binary: !!whichGraphify(),
        install: INSTALL,
        ...(readState(dataDir, key) || { state: "empty", key, root: ws.path, workspaceId: ws.id, name: ws.name || "" }),
      });
      return;
    }
    if (req.method === "POST" && (url.pathname === "/build" || url.pathname === "/query" || url.pathname === "/explain" || url.pathname === "/path")) {
      const body = await readBody(req);
      const ws = await workspace(String(body.workspace || ""));
      if (!ws) {
        send(res, 404, { error: "That workspace does not have Graphify turned on." });
        return;
      }
      if (!existsSync(ws.path)) {
        send(res, 400, { error: "That workspace folder is not on this machine." });
        return;
      }
      const key = graphKey(ws.id, ws.path);
      if (url.pathname === "/build") {
        if (!whichGraphify()) {
          send(res, 409, { error: "graphify is not installed.", install: INSTALL });
          return;
        }
        const state = enqueue(dataDir, {
          key, root: ws.path, workspaceId: ws.id, name: ws.name || "", force: body.force === true,
        });
        send(res, 202, state);
        return;
      }
      const spec = { tool: url.pathname.slice(1) };
      if (spec.tool === "query") {
        spec.question = String(body.question || "").slice(0, 2000);
        spec.budget = body.budget;
        if (!spec.question.trim()) {
          send(res, 400, { error: "Write a question first." });
          return;
        }
      } else if (spec.tool === "explain") {
        spec.node = String(body.node || "").slice(0, 200);
        if (!spec.node.trim()) {
          send(res, 400, { error: "Name a symbol first." });
          return;
        }
      } else {
        spec.from = String(body.from || "").slice(0, 200);
        spec.to = String(body.to || "").slice(0, 200);
        if (!spec.from.trim() || !spec.to.trim()) {
          send(res, 400, { error: "Name both symbols first." });
          return;
        }
      }
      const answer = await ask(dataDir, key, spec);
      send(res, 200, answer);
      return;
    }
    send(res, 404, { error: "No such route." });
  } catch (e) {
    send(res, 500, { error: e.message || "The graph service failed." });
  }
}

if (!dataDir) {
  console.error("graphify: PICODE_EXT_DATA is not set");
  process.exit(1);
}

recover(dataDir);
const server = createServer((req, res) => { handle(req, res).catch((e) => send(res, 500, { error: e.message || "failed" })); });
server.listen(port, "127.0.0.1", () => {
  console.log("graphify: listening on 127.0.0.1:" + server.address().port + " data " + dataDir);
});
setInterval(() => { drain(dataDir).catch((e) => console.error("graphify: " + (e.message || e))); }, 1000).unref();
