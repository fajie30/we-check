-- Activity scoring + file link.
-- An activity is scored either by a single total (total_score) or by a rubric (rubric JSON), never both.
-- file_url is an optional Google Drive/Docs link (validated in the app).
-- ADDITIVE: new columns + one check constraint. Existing rows (if any) get total_score = 100.

alter table public.activities
  add column total_score numeric(7,2) default 100 check (total_score > 0 and total_score <= 1000),
  add column rubric      jsonb check (rubric is null or (jsonb_typeof(rubric) = 'object' and pg_column_size(rubric) < 100000)),
  add column file_url    text check (file_url is null or char_length(file_url) <= 500);

-- The default only backfills existing rows; the app always sends exactly one of the two.
alter table public.activities alter column total_score drop default;

alter table public.activities
  add constraint activities_one_scoring check ((total_score is not null) <> (rubric is not null));
