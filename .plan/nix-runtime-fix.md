# Nix Runtime Fix Plan

## Problem
Nix couchdb package doesn't support `COUCHDB_PASSWORD` env var like docker.
It needs the admin password pre-hashed in local.ini.

## CouchDB Password Format
CouchDB uses PBKDF2 hashing with format:
```
-pbkdf2-<derived_key>,<salt>,<iterations>
```

Example:
```ini
[admins]
admin = -pbkdf2-3410d5c5442c99b15721481009b7e72e1c5b1265,58f1e6264a8f2036f531d913cc4c0de5,10
```

## Solution

1. **Generate PBKDF2 hash** for the password
   - Use openssl or a bun-native implementation
   - CouchDB uses: SHA1, 10 iterations, 16-byte salt

2. **Write proper local.ini** before starting:
   ```ini
   [couchdb]
   
   [httpd]
   port = 5984
   bind_address = 127.0.0.1
   
   [chttpd]
   port = 5984
   bind_address = 127.0.0.1
   
   [admins]
   admin = -pbkdf2-<hash>,<salt>,10
   ```

3. **Start couchdb** with nix-shell using the config

## Implementation

Modify `startNix()` in `src/lib/local-runtime.ts`:

```typescript
private async startNix(): Promise<string> {
  // 1. Ensure data dir exists
  // 2. Generate PBKDF2 hash of adminPass
  // 3. Write local.ini with hashed password
  // 4. Start couchdb with nix-shell -p couchdb3 --run "couchdb -a local.ini"
  // 5. Wait for ready
}
```

## PBKDF2 Hash Generation Options

Option A: Use openssl CLI (if available)
Option B: Use bun's crypto module
Option C: Use a nix-shell with nodejs to generate it

Recommended: Option B (bun crypto) - no external deps

## References (clean room)
- CouchDB admin setup requires PBKDF2-SHA1
- 10 iterations (couchdb default)
- 16 byte salt
- 20 byte derived key
