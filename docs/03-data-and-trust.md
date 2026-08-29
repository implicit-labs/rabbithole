# Data and trust

Rabbithole is local-first. The web host stores documents in the browser. The local host stores them on the user's machine. Portability is explicit: a user exports a Rabbithole to move editable data, or a frozen snapshot to share a read-only experience.

Markdown is canonical document content. Rendered HTML is derived and sanitized. Assets are referenced by stable names, and one reference view governs deletion, undo, portability, and snapshots so those paths cannot disagree.

Credentials are host configuration, never document content. Provider keys and bridge pairing material are excluded from persistence and snapshot projections. The subscription bridge uses loopback binding, bearer authentication, and origin checks as separate controls.

Persistence is conservative. Known older data is migrated forward. Data from a newer schema is refused clearly instead of being reconstructed or truncated. Snapshot projection is default-deny for personal extension state.

Generated network-policy documentation records the current browser egress and fetch-proxy boundaries. The two lists serve different threats and are intentionally not interchangeable.
