-- B1-T28: floor-plan positions live on a 0..999 canvas; the database now enforces it (REYKI found -1 and 1000
-- stored via the API on #69). NULL stays allowed (a table that has not been placed yet).
-- Existing rows are clamped first so the constraint can never fail on staging data.
update public.tables set pos_x = least(greatest(pos_x, 0), 999) where pos_x is not null and (pos_x < 0 or pos_x > 999);
update public.tables set pos_y = least(greatest(pos_y, 0), 999) where pos_y is not null and (pos_y < 0 or pos_y > 999);

alter table public.tables
  add constraint tables_pos_x_range check (pos_x is null or pos_x between 0 and 999),
  add constraint tables_pos_y_range check (pos_y is null or pos_y between 0 and 999);
