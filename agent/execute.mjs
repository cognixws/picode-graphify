// picode-tools/1 executor: one JSON request on stdin, one answer on stdout.
// A build is queued for the long-lived process. Query, explain, path and
// hubs run here and must finish inside the tool limit.
import { handleTool } from "../lib/graph.mjs";

let text = "";
for await (const chunk of process.stdin) text += chunk;

function answer(body) {
  process.stdout.write(JSON.stringify(body));
}

let request;
try {
  request = text ? JSON.parse(text) : {};
} catch {
  answer({ content: [{ type: "text", text: "The request is not JSON." }], isError: true });
  process.exit(0);
}

try {
  answer(await handleTool(request));
} catch (err) {
  answer({ content: [{ type: "text", text: err && err.message ? err.message : String(err) }], isError: true });
}
