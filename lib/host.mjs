// Host API reads. The daemon's certificate is PiCode's own (mkcert), which
// Node does not trust until the CA file is found. Without it, this loopback
// call skips verification; the extension token still authenticates it.
import { request as httpsRequest } from "node:https";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function tlsOptions() {
  const cands = [];
  if (process.env.MKCERT_CAROOT) cands.push(join(process.env.MKCERT_CAROOT, "rootCA.pem"));
  cands.push(join(homedir(), ".local", "share", "mkcert", "rootCA.pem"));
  cands.push(join(homedir(), ".mkcert", "rootCA.pem"));
  for (const f of cands) {
    try {
      return { ca: readFileSync(f) };
    } catch { /* next candidate */ }
  }
  return { rejectUnauthorized: false };
}

export function hostGet(path, env = process.env) {
  const base = env.PICODE_URL;
  const token = env.PICODE_EXT_TOKEN;
  if (!base || !token) return Promise.resolve(null);
  const url = new URL(path, base);
  if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    return Promise.reject(new Error("host calls stay on loopback"));
  }
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, {
      ...tlsOptions(),
      headers: { "X-PiCode-Extension-Token": token },
    }, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error("COGNIX[WS] answered " + res.statusCode));
          return;
        }
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

// Workspaces this extension is turned on in, with a folder we can graph.
export async function enabledWorkspaces(env = process.env) {
  const body = await hostGet("/api/ext/v1/workspaces", env);
  const rows = Array.isArray(body?.workspaces) ? body.workspaces : [];
  return rows.filter((w) => w && w.extensionOn && typeof w.path === "string" && w.path && typeof w.id === "string");
}
