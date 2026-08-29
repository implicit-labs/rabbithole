# Architecture

Rabbithole is organized as a shared domain kernel surrounded by adapters.

The kernel owns documents, questions, anchors, tree relationships, persistence projections, rendering rules, and event reduction. It has no opinion about a terminal agent, a model endpoint, a filesystem, or a browser database.

The two hosts supply those opinions. The local host owns MCP listening, loopback transport, filesystem storage, and native PDF work. The web host owns provider generation, browser persistence, portable imports, and browser ingestion. A shared engine contains the mutation and asset-lifecycle behavior that must remain identical.

The interface is another projection of the same graph. Reader and canvas surfaces subscribe to one state owner; cards, marks, menus, and composers hold view state without redefining the document model.

The build has two obligations that shape everything else: installed source must execute without compilation, and every served or exported canvas must be self-contained. Build artifacts therefore package browser behavior while the shared and local-host source remains plain JavaScript.
