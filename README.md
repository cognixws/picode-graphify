# Graphify

A COGNIX[WS] extension for [Graphify](https://github.com/Graphify-Labs/graphify) (`graphifyy` on PyPI). It builds a local graph of a workspace's code and lets a person, or an agent, ask what connects to what.

Code is parsed on this machine with tree-sitter. The graph is stored in the extension's data folder, not in the repository. Docs, papers and Graphify Cloud are out of this version: a build passes `--code-only` and `--no-cluster`, and the child process does not receive API keys.

This uses doors COGNIX[WS] already ships. It does not need a core change.

| Part | What it does |
|---|---|
| Page **Graph** (Apps) | Pick a workspace the extension is on in, build, see the most connected symbols, ask a question |
| Tools `graph.status`, `graph.build`, `graph.query`, `graph.explain`, `graph.path`, `graph.hubs` | The same graph, for every agent CLI. `build` returns immediately |
| Process | Runs `graphify`, including builds that take longer than a tool call allows |
| Skill `graphify` | When to query the graph. Injected for Pi, Omp and Claude Code; the tools themselves reach every CLI |

## Install Graphify

The extension does not vendor Graphify. On the machine:

```bash
uv tool install graphifyy
```

`pipx install graphifyy` works too. The command must be `graphify` on `PATH`. Python 3.10 or newer.

## Install the extension

In COGNIX[WS]: Extensions → Browse → Graphify. The review shows one permission, reading workspace names and folders, used so the page can list workspaces the extension is on in. Installing this folder directly works the same way.

A build of a large tree can take several minutes. The Graph page stays usable; leaving it does not stop the build.

## Develop

```bash
node --test test/*.test.mjs
```

Requires Node, which the executor already runs on.

## License

Apache-2.0. Graphify is Apache-2.0 and is not included in this package.
