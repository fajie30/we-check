// LOCAL USE ONLY. Reads SUPABASE_SERVICE_ROLE_KEY from .env.local to create/delete throwaway test users.
// Never import this from app code. Run from the project root with the dev server running:
//   node scripts/verify/verify-roles.cjs
// Verifies role/permission management. Temporarily edits the real matrix and restores defaults at the end.
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
async function teacher(name) {
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
function actionId() {
  const m = JSON.parse(fs.readFileSync(`${ROOT}/.next/dev/server/server-reference-manifest.json`, "utf8"));
  return Object.entries(m.node).find(([, v]) => v.exportedName === "setRolePermission")[0];
}
async function setPerm(cookie, arg) {
  const res = await fetch(APP + "/admin/roles", {
    method: "POST", redirect: "manual",
    headers: { cookie, "Next-Action": actionId(), "Content-Type": "text/plain;charset=UTF-8", Accept: "text/x-component" },
    body: JSON.stringify([arg]),
  });
  const text = await res.text();
  const m = text.match(/"ok":(true|false)/);
  return { ok: m ? m[1] === "true" : null, status: res.status };
}
const granted = async (role, key) =>
  ((await admin.from("role_permissions").select("*").eq("role", role).eq("permission_key", key)).data || []).length === 1;

(async () => {
  try {
    // Snapshot the real Teacher grants, then run from a known baseline (restored in finally).
    snapshot = (await admin.from("role_permissions").select("role,permission_key").eq("role", "instructor")).data;
    await admin.from("role_permissions").delete().eq("role", "instructor");
    await admin.from("role_permissions").insert({ role: "instructor", permission_key: "instructor_dashboard" });
    await mk("pend"); await mk("appr", "approved"); await mk("rej", "rejected");

    console.log("== Database: effective permissions ==");
    const P = await teacher("pend"), A = await teacher("appr"), R = await teacher("rej");
    const mp = async (t) => (await t.api.rpc("my_permissions")).data;
    check("pending teacher has no permissions", JSON.stringify(await mp(P)) === "[]");
    check("rejected teacher has no permissions", JSON.stringify(await mp(R)) === "[]");
    check("approved teacher has exactly instructor_dashboard", JSON.stringify(await mp(A)) === '["instructor_dashboard"]', JSON.stringify(await mp(A)));
    check("has_permission true/false works", (await A.api.rpc("has_permission", { p_key: "instructor_dashboard" })).data === true && (await A.api.rpc("has_permission", { p_key: "courses" })).data === false);
    const anon = createClient(URL_, PUB, { auth: { persistSession: false } });
    check("anonymous cannot call my_permissions", !!(await anon.rpc("my_permissions")).error);

    console.log("\n== Teacher cannot read or change the matrix ==");
    for (const [n, t] of [["approved", A], ["pending", P]]) {
      const r1 = await t.api.from("role_permissions").select("*");
      check(`${n}: cannot read role_permissions`, !!r1.error || (r1.data || []).length === 0, r1.error ? r1.error.code : "0 rows");
      const r2 = await t.api.from("permissions").select("*");
      check(`${n}: cannot read permissions catalog`, !!r2.error || (r2.data || []).length === 0, r2.error ? r2.error.code : "0 rows");
      const r3 = await t.api.rpc("admin_set_role_permission", { p_role: "instructor", p_key: "courses", p_granted: true });
      check(`${n}: cannot call admin_set_role_permission`, !!r3.error, r3.error && r3.error.code);
      const r4 = await t.api.from("role_permissions").insert({ role: "instructor", permission_key: "grading" });
      check(`${n}: cannot insert into role_permissions directly`, !!r4.error, r4.error && r4.error.code);
    }
    check("matrix unchanged after attacks", !(await granted("instructor", "courses")) && !(await granted("instructor", "grading")));

    console.log("\n== Admin session ==");
    const { data: adm } = await admin.from("profiles").select("id,email").eq("role", "admin").single();
    const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: adm.email });
    const ac = jar();
    const { error: ve } = await ac.sb.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
    if (ve) throw new Error(ve.message);
    const adminCookie = ac.cookie();

    const rp = await page("/admin/roles", adminCookie);
    check("admin sees /admin/roles with modules", rp.status === 200 && !rp.dest && rp.body.includes("Instructor dashboard") && rp.body.includes("Coming soon"), `status=${rp.status}`);
    const tr = await page("/admin/roles", A.cookie);
    check("approved teacher: /admin/roles -> /instructor", tr.dest === "/instructor", `-> ${tr.dest}`);
    const pr = await page("/admin/roles", P.cookie);
    check("pending teacher: /admin/roles -> /pending-approval", pr.dest === "/pending-approval", `-> ${pr.dest}`);

    console.log("\n== Server action: change the matrix ==");
    const baseline = await page("/instructor", A.cookie);
    check("approved teacher sees dashboard by default", baseline.body.includes("Instructor dashboard") && !baseline.dest);

    let r = await setPerm(adminCookie, { role: "instructor", key: "instructor_dashboard", granted: false });
    check("admin revokes Teacher -> Instructor dashboard", r.ok === true && !(await granted("instructor", "instructor_dashboard")));
    check("  ...teacher permissions now empty", JSON.stringify(await mp(A)) === "[]");
    const nd = await page("/instructor", A.cookie);
    check("  ...teacher /instructor -> /home", nd.dest === "/home", `-> ${nd.dest}`);
    const na = await page("/home", A.cookie);
    check("  ...teacher sees /home with the empty-modules message", na.body.includes("any module yet") && !na.dest);
    const pd = await page("/instructor", P.cookie);
    check("  ...pending teacher still -> /pending-approval", pd.dest === "/pending-approval");

    r = await setPerm(adminCookie, { role: "instructor", key: "instructor_dashboard", granted: true });
    check("admin restores Teacher -> Instructor dashboard", r.ok === true && (await granted("instructor", "instructor_dashboard")));
    const back = await page("/instructor", A.cookie);
    check("  ...teacher sees dashboard again", back.body.includes("Instructor dashboard") && !back.dest);
    const na2 = await page("/", A.cookie);
    check("  ...and the home redirect sends them to /instructor again", na2.dest === "/instructor", `-> ${na2.dest}`);

    r = await setPerm(adminCookie, { role: "instructor", key: "courses", granted: true });
    check("admin grants a placeholder module (Courses) to Teacher", r.ok === true && (await mp(A)).includes("courses"));
    r = await setPerm(adminCookie, { role: "instructor", key: "courses", granted: false });
    check("  ...and revokes it", r.ok === true && !(await mp(A)).includes("courses"));

    console.log("\n== Locked / invalid cells are refused ==");
    const bad = [
      [{ role: "admin", key: "role_management", granted: false }, "admin x role_management (locked)", () => granted("admin", "role_management")],
      [{ role: "admin", key: "teacher_approvals", granted: false }, "admin x teacher_approvals (locked)", () => granted("admin", "teacher_approvals")],
      [{ role: "instructor", key: "teacher_approvals", granted: true }, "teacher x teacher_approvals", async () => !(await granted("instructor", "teacher_approvals"))],
      [{ role: "instructor", key: "role_management", granted: true }, "teacher x role_management", async () => !(await granted("instructor", "role_management"))],
      [{ role: "admin", key: "instructor_dashboard", granted: true }, "admin x instructor_dashboard (n/a)", async () => !(await granted("admin", "instructor_dashboard"))],
      [{ role: "superadmin", key: "courses", granted: true }, "unknown role", async () => true],
      [{ role: "instructor", key: "not_a_module", granted: true }, "unknown module", async () => true],
      [{ role: "instructor", key: "courses", granted: "yes" }, "non-boolean value", async () => !(await granted("instructor", "courses"))],
    ];
    for (const [arg, label, stateOk] of bad) {
      const res = await setPerm(adminCookie, arg);
      check(`refused: ${label}`, res.ok === false && (await stateOk()), `ok=${res.ok}`);
    }

    console.log("\n== Teacher calling the action ==");
    const tr2 = await setPerm(A.cookie, { role: "instructor", key: "grading", granted: true });
    check("approved teacher cannot change the matrix via the action", tr2.ok !== true && !(await granted("instructor", "grading")), `ok=${tr2.ok}`);
    const so = await setPerm("", { role: "instructor", key: "grading", granted: true });
    check("signed-out caller cannot change the matrix", so.ok !== true && !(await granted("instructor", "grading")));

    const { data: log } = await admin.from("role_permission_changes").select("role,permission_key,granted,changed_by").gte("changed_at", started);
    check("every successful change was logged with changed_by = admin", log.length === 4 && log.every((l) => l.changed_by === adm.id), `rows=${log.length}`);
  } catch (e) {
    console.log("HARNESS ERROR:", e.message);
    results.push(false);
  } finally {
    console.log("\n== Cleanup: restore the original Teacher grants ==");
    if (snapshot) {
      await admin.from("role_permissions").delete().eq("role", "instructor");
      if (snapshot.length) await admin.from("role_permissions").insert(snapshot);
    }
    await admin.from("role_permission_changes").delete().gte("changed_at", started);
    for (const u of Object.values(users)) await admin.auth.admin.deleteUser(u.id);
    const { data: rp } = await admin.from("role_permissions").select("role,permission_key").order("role").order("permission_key");
    console.log("matrix:", rp.map((x) => `${x.role}:${x.permission_key}`).join(", "));
    const failed = results.filter((x) => !x).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed`);
    process.exit(failed ? 1 : 0);
  }
})();
