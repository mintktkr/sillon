# 🛋️ sillón

> Modern CouchDB CLI for 2026. Interactive, fuzzy-finding, visual replication monitoring.

```bash
# Quick start - spin up local CouchDB
$ sillon local up
🛋️ CouchDB 3.3.3 running on http://localhost:5984
   Admin: admin / password

# Connect and explore
$ sillon connect http://admin:password@localhost:5984
✓ Connected to CouchDB 3.3.3

# Fuzzy-find your databases
$ sillon db list
> ▌
  3/12 ─────────────────────────────────────────────────────
  my-app-users
  my-app-products
  my-app-orders

# Edit documents in your $EDITOR
$ sillon doc edit my-app-users user:123
📝 Opening nvim...
✓ Saved rev 4-2c3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c

# Monitor replication in real-time
$ sillon repl status
SOURCE                    TARGET                    PROGRESS    STATUS
prod-db                   backup-db                 ████████░░  82% synced
mobile-sync               cloud-db                  ██████████  ✓ caught up
```

## Features

- 🎯 **Fuzzy finder** for databases, documents, views (powered by fzf-style matching)
- 🔄 **Visual replication** dashboard with progress bars and conflict alerts
- 🏃 **Zero-config local dev** - `sillon local up` spins up CouchDB instantly
- ✏️ **Edit in $EDITOR** - seamless document editing workflow
- 📊 **Context-aware output** - pretty tables for humans, JSON for scripts
- 🔍 **Modern CouchDB 3.x** - partitioned DBs, nouveau search, persistent replications
- ⚡ **Bun-powered** - fast startup, native TypeScript

## Installation

```bash
# Via bun
bun install -g sillon

# Via npm (bun recommended)
npm install -g sillon
```

## Requirements

- [Bun](https://bun.sh) >= 1.0.0
- For local dev: Podman, Mise, or we'll download CouchDB binary directly

## Quick Start

```bash
# Start local CouchDB
sillon local up

# Connect to a remote server
sillon connect https://user:pass@my-couch.example.com

# List databases with fuzzy finding
sillon db list

# Create a database
sillon db create my-app

# Insert a document
sillon doc put my-app '{"_id": "user:1", "name": "Marco"}'

# Edit interactively
sillon doc edit my-app user:1
```

## Commands

| Command | Description |
|---------|-------------|
| `sillon local [up\|down\|status]` | Manage local CouchDB instance |
| `sillon connect <url>` | Connect to a CouchDB server |
| `sillon db list` | List databases (with fuzzy finder) |
| `sillon db create <name>` | Create a database |
| `sillon db delete <name>` | Delete a database |
| `sillon db info [name]` | Show database info |
| `sillon doc list <db>` | List documents |
| `sillon doc get <db> <id>` | Get a document |
| `sillon doc put <db> [id] [json]` | Insert/update a document |
| `sillon doc edit <db> <id>` | Edit in $EDITOR |
| `sillon doc delete <db> <id>` | Delete a document |
| `sillon view query <db> <ddoc/view>` | Query a view |
| `sillon repl setup <source> <target>` | Setup replication |
| `sillon repl status` | Monitor replications |
| `sillon repl conflicts <db>` | View and resolve conflicts |

## Configuration

Config stored in `~/.config/sillon/config.json`:

```json
{
  "defaultConnection": "http://localhost:5984",
  "connections": {
    "local": "http://admin:password@localhost:5984",
    "prod": "https://user:pass@prod.example.com"
  },
  "editor": "nvim",
  "output": "auto"
}
```

## Development

```bash
# Clone
git clone https://github.com/mintktkr/sillon.git
cd sillon

# Install dependencies
bun install

# Run in dev mode
bun run dev

# Run tests
bun test

# Build for release
bun run build
```

## License

MIT © Marco Torres