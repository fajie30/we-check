// LOCAL USE ONLY. Reads SUPABASE_SERVICE_ROLE_KEY from .env.local to create/delete throwaway test users.
// Never import this from app code. Run from the project root with the dev server running:
//   node scripts/verify/verify-dynamic-roles.cjs
// Verifies dynamic roles (create / copy / rename / assign / delete) and what a custom-role user can reach.
// Uses a uniquely named test role and restores the Teacher grants afterwards.
const fs = require("fs");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const { createServerClient } = require("@supabase/ssr");

const ROOT = process.cwd().split("\\").join("/");
const env = {};
for (const line of fs.readFileSync(`${ROOT}/.env.local`, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL, PUB = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SRK = env.SUPABASE_SERVICE_ROLE_KEY;
const APP = process.env.APP_URL || "http://localhost:3000";
const admin = createClient(URL_, SRK, { auth: { persistSession: false, autoRefreshToken: false } });

const results = [];
const check = (name, pass, detail = "") => {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
};
const tag = crypto.randomBytes(3).toString("hex");
const ROLE_LABEL = `Vhead ${tag}`;
const ROLE_KEY = `vhead_${tag}`;
const started = new Date().toISOString();
const users = {};
let snapshot = null;

async function mk(name, status) {
  const password = crypto.randomBytes(12).toString("base64url") + "aA1";
  const email = `verify-${name}-${tag}@wecheck-verify.invalid`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `Verify ${name}` } });
  if (error) throw new Error(error.message);
  users[name] = { id: data.user.id, email, password };
  if (status) await admin.from("profiles").update({ approval_status: status }).eq("id", data.user.id);
}
function jar() {
  const j = new Map();
  const sb = createServerClient(URL_, PUB, {
    cookies: { getAll: () => [...j].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach(({ name, value }) => j.set(name, value)) },
  });
  return { sb, cookie: () => [...j].map(([k, v]) => `${k}=${v}`).join("; ") };
}
async function session(name) {
  const c = jar();
  const { data, error } = await c.sb.auth.signInWithPassword({ email: users[name].email, password: users[name].password });
  if (error) throw new Error("login " + name + ": " + error.message);
  const api = createClient(URL_, PUB, { global: { headers: { Authorization: `Bearer ${data.session.access_token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  return { api, cookie: c.cookie() };
}
async function page(path, cookie) {
  const res = await fetch(APP + path, { headers: { cookie }, redirect: "manual" });
  const body = await res.text();
  let dest = res.headers.get("location");
  if (dest) dest = new URL(dest, APP).pathname;
  if (!dest) {
    const m = body.match(/NEXT_REDIRECT;(?:replace|push);([^;]+);/) || body.match(/http-equiv="refresh"[^>]*content="[^"]*url=([^"]+)"/);
    if (m) dest = decodeURIComponent(m[1]);
  }
  return { status: res.status, dest, body };
}
function actionId(name) {
  const m = JSON.parse(fs.readFileSync(`${ROOT}/.next/dev/server/server-reference-manifest.json`, "utf8"));
  const hit = Object.entries(m.node).find(([, v]) => v.exportedName === name && v.filename && v.filename.includes("roles"));
  if (!hit) throw new Error("action not found: " + name);
  return hit[0];
}
async function act(cookie, name, arg) {
  const res = await fetch(APP + "/admin/roles", {
    method: "POST", redirect: "manual",
    headers: { cookie, "Next-Action": actionId(name), "Content-Type": "text/plain;charset=UTF-8", Accept: "text/x-component" },
    body: JSON.stringify([arg]),
  });
  const text = await res.text();
  const ok = text.match(/"ok":(true|false)/);
  const msg = text.match(/"message":"([^"]*)"/);
  return { ok: ok ? ok[1] === "true" : null, message: msg && msg[1] };
}
const roleOf = async (id) => (await admin.from("profiles").select("role,approval_status").eq("id", id).single()).data;
const grantsOf = async (role) => ((await admin.from("role_permissions").select("permission_key").eq("role", role)).data || []).map((g) => g.permission_key).sort();
const roleExists = async (key) => ((await admin.from("roles").select("key").eq("key", key)).data || []).length === 1;

(async () => {
  try {
    // Known baseline: Teacher = dashboard only (original grants restored in finally).
    snapshot = (await admin.from("role_permissions").select("role,permission_key").eq("role", "instructor")).data;
    await admin.from("role_permissions").delete().eq("role", "instructor");
    await admin.from("role_permissions").insert({ role: "instructor", permission_key: "instructor_dashboard" });

    await mk("m1", "approved"); await mk("m2", "approved"); await mk("pend");
    const { data: adm } = await admin.from("profiles").select("id,email").eq("role", "admin").single();
    const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: adm.email });
    const A = jar();
    const { error: ve } = await A.sb.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
    if (ve) throw new Error(ve.message);
    const adminCookie = A.cookie();
    await page("/admin/roles", adminCookie); // make sure server actions are compiled

    console.log("== Seed data ==");
    const { data: roles } = await admin.from("roles").select("key,is_system").order("key");
    check("admin and instructor exist as system roles", roles.filter((r) => r.is_system).map((r) => r.key).sort().join() === "admin,instructor");
    const { data: hp } = await admin.from("permissions").select("key,roles,excluded_roles,admin_only").eq("key", "head_tools").single();
    check("head_tools placeholder exists and is grantable to any role", hp && hp.roles === null && !hp.admin_only);

    console.log("\n== Non-admins cannot manage roles (API) ==");
    const M1 = await session("m1");
    const anon = createClient(URL_, PUB, { auth: { persistSession: false } });
    for (const [who, c] of [["anonymous", anon], ["teacher", M1.api]]) {
      const calls = [
        ["admin_create_role", { p_key: "hacked", p_label: "Hacked", p_description: null, p_copy_from: null }],
        ["admin_update_role", { p_key: "instructor", p_label: "Hacked", p_description: null }],
        ["admin_delete_role", { p_key: "instructor" }],
        ["admin_set_user_role", { p_user: users.m2.id, p_role: "instructor" }],
        ["admin_list_users", {}],
      ];
      for (const [fn, args] of calls) {
        const r = await c.rpc(fn, args);
        check(`${who}: cannot call ${fn}`, !!r.error, r.error && r.error.code);
      }
    }
    const w1 = await M1.api.from("roles").insert({ key: "sneaky", label: "Sneaky" });
    check("teacher: cannot insert into roles directly", !!w1.error, w1.error && w1.error.code);
    const w2 = await M1.api.from("roles").update({ label: "Pwned" }).eq("key", "instructor").select();
    check("teacher: cannot rename a role directly", !!w2.error || (w2.data || []).length === 0);
    const rd = await M1.api.from("roles").select("key,label");
    check("teacher: can read role names (not sensitive)", !rd.error && rd.data.length >= 2);
    check("roles unchanged after attacks", !(await roleExists("hacked")) && (await admin.from("roles").select("label").eq("key", "instructor").single()).data.label !== "Hacked");
    const tc = await act(M1.cookie, "createRole", { label: "Teacher Made" });
    check("teacher cannot create a role via the server action", tc.ok !== true && !(await roleExists("teacher_made")));

    console.log("\n== Create a role by copying Teacher ==");
    const bad1 = await act(adminCookie, "createRole", { label: "x" });
    check("refused: name too short", bad1.ok === false);
    const bad2 = await act(adminCookie, "createRole", { label: "!!!!" });
    check("refused: name with no letters/numbers", bad2.ok === false);
    const bad3 = await act(adminCookie, "createRole", { label: ROLE_LABEL, copyFrom: "admin" });
    check("refused: copying from admin", bad3.ok === false && !(await roleExists(ROLE_KEY)));
    const c1 = await act(adminCookie, "createRole", { label: ROLE_LABEL, description: "Verification role", copyFrom: "instructor" });
    check("admin creates a role copied from Teacher", c1.ok === true && (await roleExists(ROLE_KEY)));
    check("  ...it received Teacher's modules (instructor_dashboard)", JSON.stringify(await grantsOf(ROLE_KEY)) === '["instructor_dashboard"]', JSON.stringify(await grantsOf(ROLE_KEY)));
    const dup = await act(adminCookie, "createRole", { label: ROLE_LABEL });
    check("duplicate role name is refused with a clear message", dup.ok === false && /already exists/.test(dup.message || ""), dup.message);

    console.log("\n== Permissions for the custom role ==");
    const ok1 = await act(adminCookie, "setRolePermission", { role: ROLE_KEY, key: "head_tools", granted: true });
    check("grant Head tools to the custom role", ok1.ok === true && (await grantsOf(ROLE_KEY)).includes("head_tools"));
    for (const key of ["teacher_approvals", "role_management"]) {
      const r = await act(adminCookie, "setRolePermission", { role: ROLE_KEY, key, granted: true });
      check(`refused: system permission ${key} for a custom role`, r.ok === false && !(await grantsOf(ROLE_KEY)).includes(key));
    }
    const ra = await act(adminCookie, "setRolePermission", { role: "admin", key: "instructor_dashboard", granted: true });
    check("refused: teacher dashboard for admin (excluded)", ra.ok === false);
    const ru = await act(adminCookie, "setRolePermission", { role: "no_such_role", key: "courses", granted: true });
    check("refused: unknown role", ru.ok === false);

    console.log("\n== Assigning the role to people ==");
    const s1 = await act(adminCookie, "setUserRole", { userId: users.m1.id, role: ROLE_KEY });
    check("admin assigns the custom role to an approved user", s1.ok === true && (await roleOf(users.m1.id)).role === ROLE_KEY);
    check("  ...approval status is unchanged (still approved)", (await roleOf(users.m1.id)).approval_status === "approved");
    const s2 = await act(adminCookie, "setUserRole", { userId: users.pend.id, role: ROLE_KEY });
    check("admin can assign it to a pending user too", s2.ok === true);
    check("  ...who stays pending", (await roleOf(users.pend.id)).approval_status === "pending_approval");
    const refuse = [
      [{ userId: users.m2.id, role: "admin" }, "assigning the admin role"],
      [{ userId: users.m2.id, role: "no_such_role" }, "assigning an unknown role"],
      [{ userId: adm.id, role: ROLE_KEY }, "changing the admin account's role"],
      [{ userId: "not-a-uuid", role: ROLE_KEY }, "an invalid user id"],
    ];
    for (const [arg, label] of refuse) {
      const r = await act(adminCookie, "setUserRole", arg);
      check(`refused: ${label}`, r.ok === false);
    }
    check("  ...admin is still the only admin", ((await admin.from("profiles").select("id").eq("role", "admin")).data || []).length === 1);

    console.log("\n== What a custom-role user can reach ==");
    const M = await session("m1");
    const perms = (await M.api.rpc("my_permissions")).data;
    check("effective permissions = copied + granted", JSON.stringify(perms) === '["head_tools","instructor_dashboard"]', JSON.stringify(perms));
    const mods = (await M.api.rpc("my_modules")).data || [];
    check("my_modules lists them with labels", mods.map((m) => m.key).sort().join() === "head_tools,instructor_dashboard");
    const root = await page("/", M.cookie);
    check("signing in lands on /instructor (has teacher dashboard)", root.dest === "/instructor", `-> ${root.dest}`);
    const inst = await page("/instructor", M.cookie);
    check("custom-role user can open the teacher dashboard", inst.body.includes("Instructor dashboard") && !inst.dest);
    for (const p of ["/admin", "/admin/teachers", "/admin/roles"]) {
      const r = await page(p, M.cookie);
      check(`custom-role user: ${p} -> /instructor`, r.dest === "/instructor", `-> ${r.dest}`);
    }
    const rm = await act(M.cookie, "setRolePermission", { role: ROLE_KEY, key: "courses", granted: true });
    check("custom-role user cannot edit the matrix", rm.ok !== true && !(await grantsOf(ROLE_KEY)).includes("courses"));
    const rd2 = await M.api.rpc("admin_set_role_permission", { p_role: ROLE_KEY, p_key: "courses", p_granted: true });
    check("  ...nor via the API", !!rd2.error, rd2.error && rd2.error.code);

    const pd = await session("pend");
    const pr = await page("/instructor", pd.cookie);
    check("pending custom-role user still -> /pending-approval", pr.dest === "/pending-approval", `-> ${pr.dest}`);

    console.log("\n== Turning off the dashboard sends them to /home ==");
    const off = await act(adminCookie, "setRolePermission", { role: ROLE_KEY, key: "instructor_dashboard", granted: false });
    check("admin revokes the dashboard from the custom role", off.ok === true);
    const h = await page("/home", M.cookie);
    check("/home shows the role name and Head tools", h.body.includes(ROLE_LABEL) && h.body.includes("Head tools") && !h.dest);
    check("  ...marked Coming soon (no page yet)", h.body.includes("Coming soon"));
    check("  ...and does not show the teacher dashboard or system modules", !h.body.includes("Teacher approvals") && !h.body.includes("Role management"));
    const i2 = await page("/instructor", M.cookie);
    check("/instructor -> /home when the dashboard is off", i2.dest === "/home", `-> ${i2.dest}`);
    const r2 = await page("/", M.cookie);
    check("home redirect -> /home", r2.dest === "/home", `-> ${r2.dest}`);

    console.log("\n== Rename and delete ==");
    const rn = await act(adminCookie, "updateRole", { key: ROLE_KEY, label: `${ROLE_LABEL} renamed` });
    check("admin renames the custom role", rn.ok === true && (await admin.from("roles").select("label").eq("key", ROLE_KEY).single()).data.label.endsWith("renamed"));
    const ra2 = await act(adminCookie, "updateRole", { key: "admin", label: "Boss" });
    check("refused: renaming the admin role", ra2.ok === false && (await admin.from("roles").select("label").eq("key", "admin").single()).data.label === "Admin");
    const dsys = await act(adminCookie, "deleteRole", { key: "instructor" });
    check("refused: deleting a system role", dsys.ok === false && (await roleExists("instructor")));
    const dadm = await act(adminCookie, "deleteRole", { key: "admin" });
    check("refused: deleting the admin role", dadm.ok === false && (await roleExists("admin")));
    const din = await act(adminCookie, "deleteRole", { key: ROLE_KEY });
    check("refused: deleting a role people still have", din.ok === false && /Reassign/.test(din.message || "") && (await roleExists(ROLE_KEY)), din.message);
    for (const id of [users.m1.id, users.pend.id]) {
      await act(adminCookie, "setUserRole", { userId: id, role: "instructor" });
    }
    check("people reassigned back to Teacher", (await roleOf(users.m1.id)).role === "instructor" && (await roleOf(users.pend.id)).role === "instructor");
    const del = await act(adminCookie, "deleteRole", { key: ROLE_KEY });
    check("admin deletes the unused role", del.ok === true && !(await roleExists(ROLE_KEY)));
    check("  ...its grants were removed too", (await grantsOf(ROLE_KEY)).length === 0);

    console.log("\n== Admin user list ==");
    const ul = await admin.auth.admin.generateLink({ type: "magiclink", email: adm.email });
    const { data: list } = await A.sb.rpc("admin_list_users");
    check("admin_list_users returns role + label and excludes the admin", Array.isArray(list) && list.every((u) => u.role !== "admin" && u.role_label) && list.some((u) => u.id === users.m1.id));
    void ul;

    const { data: log } = await admin.from("role_audit_log").select("action,changed_by").gte("changed_at", started);
    check("role changes are in the audit log, all by the admin", log.length >= 6 && log.every((l) => l.changed_by === adm.id), `rows=${log.length}`);
  } catch (e) {
    console.log("HARNESS ERROR:", e.message);
    results.push(false);
  } finally {
    console.log("\n== Cleanup ==");
    for (const u of Object.values(users)) await admin.auth.admin.deleteUser(u.id);
    await admin.from("roles").delete().like("key", `%${tag}`);
    if (snapshot) {
      await admin.from("role_permissions").delete().eq("role", "instructor");
      if (snapshot.length) await admin.from("role_permissions").insert(snapshot);
    }
    await admin.from("role_audit_log").delete().gte("changed_at", started);
    await admin.from("role_permission_changes").delete().gte("changed_at", started);
    const { data: rs } = await admin.from("roles").select("key").order("key");
    const { count } = await admin.from("profiles").select("*", { count: "exact", head: true });
    console.log(`roles: ${rs.map((r) => r.key).join(", ")}; profiles: ${count}`);
    const failed = results.filter((r) => !r).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed`);
    process.exit(failed ? 1 : 0);
  }
})();
