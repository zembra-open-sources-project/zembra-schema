import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, test } from 'node:test';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
after(() => db.close());
const sql = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const workspace = '00000000-0000-0000-0000-000000000001';
const other = '00000000-0000-0000-0000-000000000002';
const empty = '00000000-0000-0000-0000-000000000003';
const user = '00000000-0000-0000-0000-000000000011';
await db.exec(`
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  GRANT USAGE ON SCHEMA auth TO authenticated;
`);
await db.exec(await sql('postgres/001_initial_schema.sql'));
await db.exec(await sql('migrations/supabase/006_create_workspace_members.sql'));
await db.exec(`
  INSERT INTO auth.users VALUES ('${user}'), ('00000000-0000-0000-0000-000000000012');
  INSERT INTO public.workspaces (id, created_at, updated_at) VALUES
    ('${workspace}', 1, 1), ('${other}', 1, 1), ('${empty}', 1, 1);
  INSERT INTO public.workspace_members (workspace_id, user_id) VALUES
    ('${workspace}', '${user}'), ('${empty}', '${user}'),
    ('${other}', '00000000-0000-0000-0000-000000000012');
`);
await db.exec(await sql('migrations/supabase/007_enable_workspace_rls.sql'));
const migration = await sql('migrations/supabase/008_add_random_notes_rpc.sql');
await db.exec(migration);
await db.exec(migration);
await db.exec(`
  INSERT INTO public.notes (id, workspace_id, content, created_at, updated_at)
    SELECT 'note-' || n, '${workspace}', 'Content ' || n, 1, 1 FROM generate_series(1, 21) n;
  INSERT INTO public.notes (id, workspace_id, content, created_at, updated_at)
    SELECT 'other-' || n, '${other}', 'Private', 1, 1 FROM generate_series(1, 30) n;
  INSERT INTO public.notes (id, workspace_id, content, created_at, updated_at, archived_at, deleted_at)
    VALUES ('archived', '${workspace}', 'Archived', 1, 1, 2, NULL),
           ('deleted', '${workspace}', 'Deleted', 1, 1, NULL, 2);
  INSERT INTO public.tags (id, workspace_id, name, path, depth, created_at)
    VALUES ('tag', '${workspace}', 'child', 'parent/child', 1, 1);
  INSERT INTO public.note_tags (workspace_id, note_id, tag_id, created_at)
    SELECT '${workspace}', 'note-' || n, 'tag', 1 FROM generate_series(1, 21) n;
  SET ROLE authenticated;
  SELECT set_config('request.jwt.claim.sub', '${user}', false);
`);
const draw = async (id = workspace) => (await db.query(
  'SELECT public.get_random_notes($1::uuid) AS result', [id],
)).rows[0].result;

test('21 active notes produce five unique scoped notes with full tag paths', async () => {
  const result = await draw();
  assert.equal(result.eligible_count, 21);
  assert.equal(result.notes.length, 5);
  assert.equal(new Set(result.notes.map((n) => n.id)).size, 5);
  for (const note of result.notes) {
    assert.match(note.id, /^note-\d+$/);
    assert.match(note.content, /^Content /);
    assert.equal(note.archived_at, null);
    assert.deepEqual(note.tags, ['parent/child']);
  }
});

test('20 active notes return a count and empty list despite excluded and foreign notes', async () => {
  await db.exec("UPDATE public.notes SET archived_at = 2 WHERE id = 'note-21'");
  try { assert.deepEqual(await draw(), { eligible_count: 20, notes: [] }); }
  finally { await db.exec("UPDATE public.notes SET archived_at = NULL WHERE id = 'note-21'"); }
});

test('empty authorized workspace returns an explicit empty result', async () => {
  assert.deepEqual(await draw(empty), { eligible_count: 0, notes: [] });
});

test('foreign and missing workspaces are denied without disclosing counts', async () => {
  for (const id of [other, '00000000-0000-0000-0000-000000000099']) {
    await assert.rejects(draw(id), (error) => error.code === '42501');
  }
});

test('null workspace is rejected', async () => {
  await assert.rejects(draw(null), (error) => error.code === '22023');
});

test('anonymous callers cannot execute the function', async () => {
  await db.exec('RESET ROLE; SET ROLE anon');
  try { await assert.rejects(draw(), (error) => error.code === '42501'); }
  finally { await db.exec('RESET ROLE; SET ROLE authenticated'); }
});

test('revoking membership immediately revokes RPC access', async () => {
  await db.exec(`RESET ROLE; DELETE FROM public.workspace_members WHERE workspace_id = '${workspace}'; SET ROLE authenticated`);
  try { await assert.rejects(draw(), (error) => error.code === '42501'); }
  finally {
    await db.exec(`RESET ROLE; INSERT INTO public.workspace_members (workspace_id, user_id) VALUES ('${workspace}', '${user}'); SET ROLE authenticated`);
  }
});

test('random draws can reach every candidate rather than a fixed recent subset', async () => {
  const seen = new Set();
  for (let seed = 0; seed < 30; seed++) {
    await db.query('SELECT setseed($1)', [seed / 30]);
    const result = await draw();
    result.notes.forEach((note) => seen.add(note.id));
  }
  assert.equal(seen.size, 21);
});
