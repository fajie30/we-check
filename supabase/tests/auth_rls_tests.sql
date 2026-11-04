-- Manual verification queries. Run in the SQL editor AFTER the migration is applied,
-- inside a transaction that is rolled back. Uses throwaway users; nothing persists.
-- "set local role" simulates the API roles; request.jwt.claims simulates auth.uid().

begin;

-- Fixtures (as postgres): two teachers + one admin. Trigger creates the profiles.
-- t1 is email-confirmed; t2 (tampered metadata) and t3 are NOT confirmed.
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local', now(),  '{"full_name":"Admin"}'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 't1@test.local',    now(),  '{"full_name":"Teacher One"}'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 't2@test.local',    null,   '{"full_name":"Teacher Two","role":"admin","approval_status":"approved"}'),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 't3@test.local',    null,   '{"full_name":"Teacher Three"}');

-- TEST 1: tampered metadata cannot create admin / approved. Expect both teachers instructor + pending_approval.
select email, role, approval_status from public.profiles order by email;

update public.profiles set role = 'admin', approval_status = 'approved'
where id = '00000000-0000-0000-0000-0000000000a1';   -- trusted bootstrap path

-- ---- act as teacher 1 ------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;

-- TEST 2: sees only own row. Expect 1 row (t1).
select email from public.profiles;

-- TEST 3: cannot change own status/role. Each must ERROR or affect 0 rows.
--   (run each separately; an error aborts the transaction)
-- update public.profiles set approval_status = 'approved' where id = auth.uid();  -- expect 0 rows (no update policy)
-- update public.profiles set role = 'admin' where id = auth.uid();                -- expect 0 rows

-- TEST 4: cannot call approve. Expect ERROR 'Operation not permitted'.
-- select public.review_instructor('00000000-0000-0000-0000-0000000000b2', 'approve');

-- TEST 5: cannot read audit log. Expect 0 rows.
select count(*) from public.approval_audit_log;

reset role;

-- ---- act as anon ----------------------------------------------------------
set local role anon;
-- TEST 6: expect ERROR permission denied for table profiles.
-- select * from public.profiles;
reset role;

-- ---- act as admin ---------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;

-- TEST 7: admin sees all rows. Expect 4.
select count(*) from public.profiles;

-- TEST 7b: approving an UNVERIFIED email must fail. Expect ERROR 'Invalid request'.
-- select public.review_instructor('00000000-0000-0000-0000-0000000000b3', 'approve');

-- TEST 8: approve verified t1, reject unverified t2 with reason (rejection allowed). Expect success.
select public.review_instructor('00000000-0000-0000-0000-0000000000b1', 'approve');
select public.review_instructor('00000000-0000-0000-0000-0000000000b2', 'reject', 'Not a known teacher');

-- TEST 9: decided rows cannot be decided again. Expect ERROR 'Invalid request'.
-- select public.review_instructor('00000000-0000-0000-0000-0000000000b1', 'reject');

-- TEST 10: admin cannot target themselves/admin. Expect ERROR 'Invalid request'.
-- select public.review_instructor('00000000-0000-0000-0000-0000000000a1', 'reject');

-- TEST 11: audit log has 2 rows, reviewed_by set.
select profile_id, decision, reason, decided_by from public.approval_audit_log;
select email, approval_status, reviewed_by, reviewed_at, rejection_reason from public.profiles order by email;

reset role;

-- TEST 12 (separate run): second admin must fail with unique violation.
-- update public.profiles set role = 'admin' where email = 't1@test.local';

rollback;
