# Supabase Platform Boundary

`migrations/supabase/` contains Supabase-specific migrations and bootstrap notes, including Auth-backed membership tables, RLS policies, Realtime settings, and storage policies.

Shared business schema belongs in `postgres/` and must use the same schema version as SQLite. Supabase platform configuration must not introduce business tables, fields, enum values, or version semantics that are independent from zembra-schema.

Version `0.6.0` defines `workspace_members` as the Supabase Auth relationship to `workspaces` and versions the RLS policies that depend on it. The only current role is `manager`.

## Upgrade an existing 0.5.0 database

Run only the SQL files in `migrations/supabase/` against Supabase. Files in `migrations/sqlite/` are SQLite migrations and use SQLite functions such as `unixepoch()`.

1. Apply `006_create_workspace_members.sql`. It immediately enables RLS on the membership table and reserves membership changes for the administrator.
2. Insert one or more manager rows for every existing workspace using the matching `auth.users.id` values.
3. Apply `007_enable_workspace_rls.sql`. Its preflight check stops the migration when a workspace has no manager.

Use an administrative SQL session for step 2:

```sql
SELECT id, email
FROM auth.users;

INSERT INTO public.workspace_members (workspace_id, user_id)
VALUES ('<existing-workspace-uuid>', '<manager-auth-user-uuid>');
```

Repeat the `INSERT` for every existing workspace. The `created_at` value and `manager` role use their schema defaults.

WebUI receives `SELECT` permission for the three sync tables and receives no write permission for them. Workspace creation and membership administration remain administrative operations outside WebUI.

## 随机笔记 RPC

在完成 `006_create_workspace_members.sql` 和 `007_enable_workspace_rls.sql` 后，使用数据库管理员权限执行 `008_add_random_notes_rpc.sql`。已有数据库无需重新执行初始化脚本。该迁移新增函数和执行权限，不修改业务表或统一业务 schema version；允许重复执行。脚本提交时通知 PostgREST 重新加载函数契约。

可在目标 Supabase 项目的 SQL Editor 中执行整个迁移文件，或由现有数据库迁移流程执行该文件。本仓库使用 `migrations/supabase/` 保存 SQL，不能直接假定 Supabase CLI 会自动发现此目录。Git 推送和前端发布均不会自动部署函数；每个独立 Supabase 项目需要分别应用迁移。

前端使用已登录用户的 Supabase client 调用：

```ts
const { data, error } = await supabase.rpc('get_random_notes', {
  p_workspace_id: currentWorkspaceId,
});
```

| 契约 | 行为 |
| --- | --- |
| 输入 `p_workspace_id` | 必填 workspace UUID |
| `eligible_count` | 当前调用者可见、指定 workspace 内未删除且未归档的笔记总数 |
| `notes` | 总数超过 20 时返回 5 条单批不重复的随机笔记；否则为 `[]` |
| 每条笔记字段 | `id`、`content`、`role`、`field_id`、`created_at`、`updated_at`、`archived_at`、`tags` |
| `tags` | 完整标签路径数组；没有标签时为 `[]` |
| 权限 | `authenticated` 可执行；使用 `SECURITY INVOKER`，由既有 RLS 限定数据访问 |
| 错误 | 空 workspace 参数为 `22023`；不可访问或不存在的 workspace 为 `42501`；匿名调用被拒绝 |

前端应在 `eligible_count <= 20` 时显示笔记数量不足的文字提醒；权限或网络错误应按错误处理，不能显示为数量不足。每次调用重新抽样，不保证不同批次互不重复。统计与抽样使用同一条 SQL 语句中的候选集，不受最近笔记列表或前端筛选条件限制。

函数使用 `ORDER BY random()` 在符合条件的笔记 ID 中抽样，仅为抽中的笔记组装正文和标签。数据库仍需扫描符合条件的候选 ID；返回 5 条不等同于数据库仅读取 5 条。函数不写入笔记、不创建缓存，也不改变删除或归档规则。

回滚时执行 `DROP FUNCTION IF EXISTS public.get_random_notes(uuid);`，随后执行 `NOTIFY pgrst, 'reload schema';`。回滚仅移除随机接口，不修改业务数据。

## 随机笔记数据库验证

`tests/random-notes.test.mjs` 在独立内存 PostgreSQL 环境中执行初始化 DDL、成员关系、RLS 和随机函数迁移。使用 Node.js 和临时安装的 `@electric-sql/pglite`；将 `PGLITE_MODULE` 环境变量设为该包的模块入口，再执行 `node --test tests/random-notes.test.mjs`。测试依赖不进入业务运行时，也不连接部署中的 Supabase 数据库。
