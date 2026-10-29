---
name: graphify
description: Query a local graph of this workspace's code (symbols and how they connect). Use when the person asks how the code fits together, what calls a symbol, or where a change would land, before reading files one by one.
---

# Graph of this workspace

Graphify builds a local graph of the code with tree-sitter. Nothing is sent to a model. The graph is stored with this extension, not in the repository.

## When

Call a tool when a name, a call path, or "what connects to this" would answer faster than searching files. Read the file itself when you need the current text.

## Tools

- `graph.status` — whether a graph of the working folder exists, and the counts.
- `graph.build` — start a build and return. It keeps running. Call `graph.status` again; do not poll in a tight loop. Tell the person it is building.
- `graph.query` — a question over the graph (`question`).
- `graph.explain` — what connects to one symbol (`node`).
- `graph.path` — a path between two symbols (`from`, `to`).
- `graph.hubs` — the most connected symbols.

`subdir` limits the graph to a folder inside the workspace. Leave it empty for the whole working folder.

If a name matches several symbols, the answer lists them. Call again with the exact one.

If the tool says graphify is not installed, tell the person to run `uv tool install graphifyy` (or `pipx install graphifyy`) and then ask you to build.

Code only. Do not ask for an API key, do not run `graphify install`, and do not use Graphify Cloud.
