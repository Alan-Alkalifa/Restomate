-- B1-T12: atomic full-list saves for item variants and group modifiers.
-- Replaces the app's three separate statements (deactivate missing -> update -> insert) with one function call, so the
-- whole list is applied in a single transaction: any failure (duplicate name, bad value, foreign id) leaves nothing changed.
--  * security definer + search_path '' ; callable by authenticated only.
--  * requires menu.manage in the parent's org; an unknown parent and a missing permission look the same (FORBIDDEN, 42501).
--  * every id in the list must already belong to THAT parent (item / group) or the call fails with FORBIDDEN.
--  * rows missing from the list are deactivated, listed rows are updated (and reactivated), rows without an id are inserted.
--  * the parent row is locked FOR UPDATE, so concurrent saves of the same list serialise.
-- List shape: [{ "id"?: uuid, "name": text, "priceDelta": integer (number or numeric string) }], order = sort order.
-- Errors: FORBIDDEN (42501); INVALID_LIST (22023) for a malformed list; duplicate active names raise unique_violation (23505).

create or replace function private.parse_menu_list(p_list jsonb, p_max int, p_min_delta bigint)
returns table (ord int, id uuid, name text, price_delta bigint)
language plpgsql
immutable
set search_path = ''
as $$
declare
  e jsonb;
  i int := 0;
  v_id text;
  v_name text;
  v_delta text;
  v_big constant bigint := 1000000000000;
begin
  if p_list is null or jsonb_typeof(p_list) <> 'array' or jsonb_array_length(p_list) > p_max then
    raise exception 'INVALID_LIST' using errcode = '22023';
  end if;
  for e in select x from jsonb_array_elements(p_list) x loop
    if jsonb_typeof(e) <> 'object' then raise exception 'INVALID_LIST' using errcode = '22023'; end if;
    -- only these keys
    if exists (select 1 from jsonb_object_keys(e) k where k not in ('id', 'name', 'priceDelta')) then
      raise exception 'INVALID_LIST' using errcode = '22023';
    end if;
    v_id := e ->> 'id';
    v_name := btrim(e ->> 'name');
    v_delta := e ->> 'priceDelta';
    if jsonb_typeof(e -> 'name') <> 'string' or v_name is null or char_length(v_name) not between 1 and 40 then
      raise exception 'INVALID_LIST' using errcode = '22023';
    end if;
    if v_delta is null or v_delta !~ '^-?[0-9]{1,13}$' or abs(v_delta::bigint) > v_big or v_delta::bigint < p_min_delta then
      raise exception 'INVALID_LIST' using errcode = '22023';
    end if;
    if v_id is not null and v_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      raise exception 'INVALID_LIST' using errcode = '22023';
    end if;
    i := i + 1;
    ord := i - 1; id := v_id::uuid; name := v_name; price_delta := v_delta::bigint;
    return next;
  end loop;
end;
$$;

create or replace function public.save_item_variants(item_id uuid, variants jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_item uuid := save_item_variants.item_id;
  v_org  uuid;
begin
  select i.organization_id into v_org from public.menu_items i where i.id = v_item for update;
  if not found or not public.has_permission(v_org, 'menu.manage') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  -- validate the whole list before any write (raises INVALID_LIST)
  perform count(*) from private.parse_menu_list(save_item_variants.variants, 20, -1000000000000);

  -- every given id must be a variant of THIS item
  if exists (select 1 from private.parse_menu_list(save_item_variants.variants, 20, -1000000000000) r where r.id is not null
             and not exists (select 1 from public.item_variants v where v.id = r.id and v.item_id = v_item and v.organization_id = v_org)) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if exists (select 1 from private.parse_menu_list(save_item_variants.variants, 20, -1000000000000) r where r.id is not null group by r.id having count(*) > 1) then
    raise exception 'INVALID_LIST' using errcode = '22023';
  end if;

  update public.item_variants v set is_active = false
   where v.item_id = v_item and v.organization_id = v_org and v.is_active
     and not exists (select 1 from private.parse_menu_list(save_item_variants.variants, 20, -1000000000000) r where r.id = v.id);

  update public.item_variants v
     set name = r.name, price_delta = r.price_delta, sort_order = r.ord, is_active = true
    from private.parse_menu_list(save_item_variants.variants, 20, -1000000000000) r
   where r.id is not null and v.id = r.id and v.item_id = v_item and v.organization_id = v_org;

  insert into public.item_variants (organization_id, item_id, name, price_delta, sort_order)
  select v_org, v_item, r.name, r.price_delta, r.ord from private.parse_menu_list(save_item_variants.variants, 20, -1000000000000) r where r.id is null order by r.ord;

end;
$$;

create or replace function public.save_group_modifiers(group_id uuid, modifiers jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_group uuid := save_group_modifiers.group_id;
  v_org   uuid;
begin
  select g.organization_id into v_org from public.modifier_groups g where g.id = v_group for update;
  if not found or not public.has_permission(v_org, 'menu.manage') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  perform count(*) from private.parse_menu_list(save_group_modifiers.modifiers, 30, 0);

  if exists (select 1 from private.parse_menu_list(save_group_modifiers.modifiers, 30, 0) r where r.id is not null
             and not exists (select 1 from public.modifiers m where m.id = r.id and m.group_id = v_group and m.organization_id = v_org)) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if exists (select 1 from private.parse_menu_list(save_group_modifiers.modifiers, 30, 0) r where r.id is not null group by r.id having count(*) > 1) then
    raise exception 'INVALID_LIST' using errcode = '22023';
  end if;

  update public.modifiers m set is_active = false
   where m.group_id = v_group and m.organization_id = v_org and m.is_active
     and not exists (select 1 from private.parse_menu_list(save_group_modifiers.modifiers, 30, 0) r where r.id = m.id);

  update public.modifiers m
     set name = r.name, price_delta = r.price_delta, sort_order = r.ord, is_active = true
    from private.parse_menu_list(save_group_modifiers.modifiers, 30, 0) r
   where r.id is not null and m.id = r.id and m.group_id = v_group and m.organization_id = v_org;

  insert into public.modifiers (organization_id, group_id, name, price_delta, sort_order)
  select v_org, v_group, r.name, r.price_delta, r.ord from private.parse_menu_list(save_group_modifiers.modifiers, 30, 0) r where r.id is null order by r.ord;

end;
$$;

revoke execute on function public.save_item_variants(uuid, jsonb), public.save_group_modifiers(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_item_variants(uuid, jsonb), public.save_group_modifiers(uuid, jsonb) to authenticated;
