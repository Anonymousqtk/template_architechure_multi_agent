---
name: database-migrations
description: Use for relational schema design, SQL changes, migration safety, indexing or database integrity.
---

# database-migrations

## Approved references
- `postgres` — https://www.postgresql.org/docs/ (version: version-matched)
- `nist-ssdf` — https://csrc.nist.gov/pubs/sp/800/218/final (version: 1.1)

## Procedure
1. Identify actual DB engine and migration framework before choosing commands.
2. Write forward migration with rollback/restore plan, locking and data-backfill impacts.
3. Avoid destructive production operations without approval.
4. Validate migration on an isolated test DB when available; do not invent pass results.

## Output contract
Give changed paths or findings, evidence, commands actually executed, result, risk and next action. Keep it short. No fabricated test results.
