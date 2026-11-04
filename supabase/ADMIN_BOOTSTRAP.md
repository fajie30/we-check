# Admin bootstrap (one-time, manual)

There is no public path to admin. Signup always creates `instructor` / `pending_approval`;
the protection trigger blocks API roles from changing `role`; a unique index allows only one admin.

## Create the admin
1. Supabase Dashboard -> Authentication -> Users -> **Add user** (create user, tick "Auto Confirm User").
   Use the owner's email and a strong, unique password. (The profile row is created by the signup trigger.)
2. Supabase Dashboard -> SQL Editor, run once (replace the placeholder; do not commit the real email):

```sql
update public.profiles
set role = 'admin', approval_status = 'approved', reviewed_at = now()
where email = lower('<OWNER_EMAIL>');
-- Expect: 1 row updated.
```

The SQL editor runs as `postgres`, which the protection trigger allows. API users cannot do this.

   (The admin's email must be confirmed: "Auto Confirm User" does this.)
3. Enable MFA (TOTP) on the admin account.

## Rotate / recover
- Lost access: reset the password from Dashboard -> Authentication -> Users.
- Move admin to another person: demote first, then promote (the unique index allows one admin at a time):

```sql
update public.profiles set role = 'instructor' where email = lower('<OLD_ADMIN_EMAIL>');
update public.profiles set role = 'admin', approval_status = 'approved'
where email = lower('<NEW_ADMIN_EMAIL>');
```
