# Changelog

## 0.1.4 — 2026-10-30

- Clicking a folder opens the files and folders inside it. Back returns to the previous map.
- Clicking the name does the same as clicking the circle.

## 0.1.3 — 2026-10-29

- The Graph page opens on the folders of the workspace, sized by how much code they hold, with calls and imports drawn between them.
- Choosing a folder says where most of its calls go. Choosing a symbol still shows that symbol's own links.

## 0.1.2 — 2026-10-29

- The Graph page draws the most connected symbols and a few of what each one touches.
- A graph too large to count no longer shows 0 symbols.

## 0.1.1 — 2026-10-29

- The icon is Graphify's official favicon.

## 0.1.0 — 2026-10-29

- Local code graph for a workspace, built with Graphify (`graphifyy`).
  Code is parsed on this machine; the graph is stored with the extension.
- Page **Graph**, tools `graph.status`, `graph.build`, `graph.query`,
  `graph.explain`, `graph.path` and `graph.hubs`, and the `graphify` skill.
- `graph.build` returns immediately. The extension process runs the build.
