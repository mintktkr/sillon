# Sillón - Modern CouchDB CLI

## Overview
A modern CouchDB CLI tool built with Bun, featuring interactive fuzzy finding, visual replication monitoring, and zero-config local development.

## Iteration Plan

### Iteration 1: Core Infrastructure ✅
- [x] Project scaffold with Bun
- [x] Basic CLI framework (Commander)
- [x] TypeScript configuration
- [x] Package.json with proper metadata

### Iteration 2: Local Development (PRIORITY)
- [ ] LocalRuntime class implementation
- [ ] Podman-based CouchDB startup
- [ ] Mise-based CouchDB startup
- [ ] Binary download fallback
- [ ] PID file management
- [ ] Health check / wait for ready
- [ ] `sillon local up` command
- [ ] `sillon local down` command
- [ ] `sillon local status` command

### Iteration 3: Connection Management
- [ ] ConfigManager persistence
- [ ] `sillon connect` command
- [ ] Connection validation
- [ ] Named connections
- [ ] Default connection handling
- [ ] COUCHDB_URL env var support

### Iteration 4: Database Operations
- [ ] CouchClient base class
- [ ] `sillon db list` with fuzzy finder
- [ ] `sillon db create` command
- [ ] `sillon db delete` command
- [ ] `sillon db info` command
- [ ] Pretty table output
- [ ] JSON output option

### Iteration 5: Document Operations
- [ ] `sillon doc list` command
- [ ] `sillon doc get` command
- [ ] `sillon doc put` command
- [ ] `sillon doc edit` ($EDITOR integration)
- [ ] `sillon doc delete` command
- [ ] Bulk operations support

### Iteration 6: Views & Queries
- [ ] `sillon view list` command
- [ ] `sillon view query` command
- [ ] Query parameter support
- [ ] Pagination handling
- [ ] View debugging helpers

### Iteration 7: Replication
- [ ] `sillon repl setup` command
- [ ] `sillon repl status` visual dashboard
- [ ] `sillon repl conflicts` command
- [ ] Progress bars for sync
- [ ] Conflict resolution helpers

### Iteration 8: CouchDB 3.x Features
- [ ] Partitioned database support
- [ ] Nouveau search integration
- [ ] Purge operations
- [ ] Compaction commands
- [ ] Cleanup commands
- [ ] Index management

### Iteration 9: Polish & Testing
- [ ] Full test suite with Bun test
- [ ] GitHub Actions CI/CD
- [ ] Gitea Actions CI/CD
- [ ] Linting with Biome
- [ ] Documentation
- [ ] npm publishing setup

## Acceptance Criteria
- All commands work with CouchDB 3.3+
- Tests pass in CI
- Linting is clean
- Works on Linux (primary), macOS (secondary)
