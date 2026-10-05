BEGIN;

CREATE OR REPLACE FUNCTION public.get_random_notes(p_workspace_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    result jsonb;
BEGIN
    IF p_workspace_id IS NULL THEN
        RAISE EXCEPTION 'Workspace ID is required.' USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.workspaces WHERE id = p_workspace_id) THEN
        RAISE EXCEPTION 'Workspace is unavailable.' USING ERRCODE = '42501';
    END IF;

    -- Count and sample the same visible candidate set within one statement.
    WITH eligible AS MATERIALIZED (
        SELECT note.id
        FROM public.notes AS note
        WHERE note.workspace_id = p_workspace_id
          AND note.deleted_at IS NULL
          AND note.archived_at IS NULL
    ), total AS (
        SELECT count(*) AS eligible_count FROM eligible
    ), sampled AS MATERIALIZED (
        SELECT eligible.id, random() AS draw_order
        FROM eligible
        WHERE (SELECT eligible_count FROM total) > 20
        ORDER BY draw_order
        LIMIT 5
    )
    SELECT jsonb_build_object(
        'eligible_count', total.eligible_count,
        'notes', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                'id', note.id,
                'content', note.content,
                'role', note.role,
                'field_id', note.field_id,
                'created_at', note.created_at,
                'updated_at', note.updated_at,
                'archived_at', note.archived_at,
                'tags', coalesce((
                    SELECT jsonb_agg(tag.path ORDER BY tag.path)
                    FROM public.note_tags AS relation
                    JOIN public.tags AS tag
                      ON tag.workspace_id = relation.workspace_id AND tag.id = relation.tag_id
                    WHERE relation.workspace_id = p_workspace_id AND relation.note_id = note.id
                ), '[]'::jsonb)
            ) ORDER BY sampled.draw_order)
            FROM sampled
            JOIN public.notes AS note ON note.id = sampled.id AND note.workspace_id = p_workspace_id
        ), '[]'::jsonb)
    ) INTO result FROM total;

    RETURN result;
END;
$$;

COMMENT ON FUNCTION public.get_random_notes(uuid) IS 'Returns five random active notes with tag paths when the visible workspace contains more than twenty active notes.';
REVOKE ALL ON FUNCTION public.get_random_notes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_random_notes(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
