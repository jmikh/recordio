-- 1. workspace_get_default returns the pro user's personal workspace
select public.workspace_get_default();

-- 2. project_list returns the pro user's projects in their workspace
select public.project_list('eeeeeeee-0000-0000-0000-111111111111');

-- 3. project_get works with assert_project_editor (owner check)
select public.project_get('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- 4. workspace_list shows the workspace
select public.workspace_list();
