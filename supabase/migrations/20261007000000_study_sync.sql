-- GRE Daily Study: per-account sync of word progress, practice responses (wrong-question
-- book), marked questions, essay drafts and plan settings.
-- Run once in the Supabase SQL Editor (or `supabase db push`). Safe to re-run.

create table if not exists public.study_items (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('word', 'response', 'mark', 'draft', 'setting')),
  item_id text not null check (char_length(item_id) between 1 and 200),
  data jsonb not null default '{}'::jsonb check (pg_column_size(data) <= 131072),
  deleted boolean not null default false,
  -- Time of the edit on the learner's device; decides last-write-wins between devices.
  client_updated_at timestamptz not null,
  -- Server write time; devices pull rows newer than their last cursor.
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, item_id)
);

create index if not exists study_items_user_updated_idx on public.study_items (user_id, updated_at);

alter table public.study_items enable row level security;

revoke all on table public.study_items from anon;
grant select, insert, update, delete on table public.study_items to authenticated;

drop policy if exists "study_items_select_own" on public.study_items;
create policy "study_items_select_own" on public.study_items
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "study_items_insert_own" on public.study_items;
create policy "study_items_insert_own" on public.study_items
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "study_items_update_own" on public.study_items;
create policy "study_items_update_own" on public.study_items
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "study_items_delete_own" on public.study_items;
create policy "study_items_delete_own" on public.study_items
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Upserts a batch of items for the signed-in user. An item only replaces the stored copy
-- when its client_updated_at is newer, so a slow or offline device cannot overwrite a
-- later edit made elsewhere. Runs as the caller, so the RLS policies above still apply.
create or replace function public.push_study_items(items jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  written integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) > 1000 then
    raise exception 'items must be an array of at most 1000 entries' using errcode = '22023';
  end if;

  insert into public.study_items as t (user_id, kind, item_id, data, deleted, client_updated_at, updated_at)
  select auth.uid(), x.kind, x.item_id, coalesce(x.data, '{}'::jsonb), coalesce(x.deleted, false),
         least(x.client_updated_at, now() + interval '5 minutes'), now()
  from jsonb_to_recordset(items) as x(kind text, item_id text, data jsonb, deleted boolean, client_updated_at timestamptz)
  on conflict (user_id, kind, item_id) do update
    set data = excluded.data,
        deleted = excluded.deleted,
        client_updated_at = excluded.client_updated_at,
        updated_at = now()
    where t.client_updated_at < excluded.client_updated_at;

  get diagnostics written = row_count;
  return written;
end;
$$;

revoke all on function public.push_study_items(jsonb) from public, anon;
grant execute on function public.push_study_items(jsonb) to authenticated;

-- Lets other open devices refresh immediately instead of waiting for the next poll.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'study_items'
     ) then
    execute 'alter publication supabase_realtime add table public.study_items';
  end if;
end;
$$;
