# Changelog

## 未发布

- 新增 Supabase 随机笔记 RPC：在当前 workspace 未删除、未归档的笔记超过 20 条时随机返回 5 条，并附带完整标签路径。
- 随机接口沿用现有 RLS 和认证用户权限，不修改业务表结构或统一业务 schema version。

## 0.6.0 - 2026-08-23

- Added Supabase Auth-backed `workspace_members` with the `manager` role.
- Added an in-place `0.5.0` upgrade path that preserves existing workspace-scoped data and requires manager backfill before RLS activation.
- Added workspace RLS policies for authenticated WebUI access, including read-only access to sync tables.

## 0.5.0 - 2026-06-19

- Added Postgres DDL and migration artifacts for the Supabase coordination schema.
- Added a SQLite version registration migration for the unified Postgres contract.
- Updated JSON Schema contracts for workspace-scoped entities and sync objects.
- Documented the shared SQLite/Postgres schema version policy and backend consumption boundary.

## 0.4.0 - 2026-05-31

- Added structured hierarchical tags with `parent_tag_id`, `path`, and `depth`.
- Added sibling and root-level tag uniqueness constraints.
- Added migration `004_add_hierarchical_tags.sql` to migrate flat tags into hierarchical tag nodes.
- Updated tag JSON Schema and export schema version to `0.4.0`.

## 0.3.0 - 2026-05-03

- Added workspace-scoped SQLite schema for bidirectional Supabase sync.
- Added `sync_changes`, `sync_state`, and `sync_conflicts` database tables.
- Updated SQLite business tables with `workspace_id`, sync metadata, and workspace-scoped uniqueness.
- Added migration `003_add_bidirectional_sync.sql`.

## 0.2.0 - 2026-04-26

- Added immutable note creation role with `Human` and `Agent` enum values.
- Added migration `002_add_note_role.sql` to backfill existing notes as `Human`.
- Updated note JSON Schema and export schema version to `0.2.0`.

## 0.1.0 - 2026-04-26

- Added initial note schema design for notes, fields, tags, note tag links, note links, attachments, note revisions, and devices.
- Added SQLite DDL in `migrations/sqlite/current_schema.sql`.
- Added initial migration script in `migrations/sqlite/001_initial_schema.sql`.
- Added JSON Schema contracts in `json/*.schema.json`.
