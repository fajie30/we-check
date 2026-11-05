// LOCAL USE ONLY. Reads SUPABASE_SERVICE_ROLE_KEY from .env.local to create/delete throwaway test users.
// Never import this from app code. Run from the project root with the dev server running:
//   node scripts/verify/verify-sidebar.cjs
// Verifies the shared sidebar: who sees which items, and that nobody sees items they can't use.
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
async function cookieFor(name) {
  const c = jar();
  const { error } = await c.sb.auth.signInWithPassword({ email: users[name].email, password: users[name].password });
  if (error) throw new Error(error.message);
  return c.cookie();
}
async function body(path, cookie) {
  const res = await fetch(APP + path, { headers: { cookie }, redirect: "manual" });
  return { status: res.status, text: await res.text(), loc: res.headers.get("location") };
}
// Sidebar links are <a href="..."> inside the sidebar; check by href.
const hasLink = (html, href) => new RegExp(`href="${href}"`).test(html);

(async () => {
  try {
    snapshot = (await admin.from("role_permissions").select("role,permission_key").eq("role", "instructor")).data;
    await admin.from("role_permissions").delete().eq("role", "instructor");
    await admin.from("role_permissions").insert([{ role: "instructor", permission_key: "instructor_dashboard" }]);

    await mk("t", "approved"); await mk("pend");
    const { data: adm } = await admin.from("profiles").select("email").eq("role", "admin").single();
    const { data: lk } = await admin.auth.admin.generateLink({ type: "magiclink", email: adm.email });
    const A = jar();
    const { error: ve } = await A.sb.auth.verifyOtp({ token_hash: lk.properties.hashed_token, type: "magiclink" });
    if (ve) throw new Error(ve.message);
    const adCookie = A.cookie();
    const tCookie = await cookieFor("t");
    const pCookie = await cookieFor("pend");

    console.log("== Admin ==");
    for (const path of ["/admin", "/admin/teachers", "/admin/roles"]) {
      const r = await body(path, adCookie);
      const ok = hasLink(r.text, "/admin") && hasLink(r.text, "/admin/teachers") && hasLink(r.text, "/admin/roles") && hasLink(r.text, "/courses") && r.text.includes("Sign out");
      check(`admin sidebar on ${path}: Overview, Users, Courses, Roles, Sign out`, r.status === 200 && ok, `status=${r.status}`);
    }

    console.log("\n== Teacher (dashboard only) ==");
    let r = await body("/instructor", tCookie);
    check("teacher sidebar: Home + Dashboard", r.status === 200 && hasLink(r.text, "/home") && hasLink(r.text, "/instructor"));
    check("  ...no Courses (role lacks it), no admin items", !hasLink(r.text, "/courses") && !hasLink(r.text, "/admin") && !hasLink(r.text, "/admin/roles") && !hasLink(r.text, "/admin/teachers"));
    check("  ...shows their name, role and Sign out", r.text.includes("Verify t") && r.text.includes("Teacher") && r.text.includes("Sign out"));

    await admin.from("role_permissions").insert([{ role: "instructor", permission_key: "courses" }]);
    r = await body("/instructor", tCookie);
    check("granting Courses adds it to the teacher's sidebar", hasLink(r.text, "/courses"));
    await admin.from("role_permissions").delete().eq("role", "instructor").eq("permission_key", "instructor_dashboard");
    r = await body("/home", tCookie);
    check("without the dashboard permission the Dashboard item disappears", r.status === 200 && !hasLink(r.text, "/instructor") && hasLink(r.text, "/home") && hasLink(r.text, "/courses"));

    console.log("\n== Everyone else gets no menu ==");
    r = await body("/home", pCookie);
    check("pending user is redirected, no menu leaked", !hasLink(r.text, "/admin/teachers") && !hasLink(r.text, "/courses") && /pending-approval/.test(r.text + (r.loc || "")));
    const so = await fetch(APP + "/home", { redirect: "manual" });
    check("signed-out user is redirected to /login", so.status === 307 && /\/login$/.test(so.headers.get("location") || ""));
    r = await body("/pending-approval", pCookie);
    check("pending page stays a simple card (no sidebar)", r.status === 200 && r.text.includes("Waiting for approval") && !hasLink(r.text, "/home"));
  } catch (e) {
    console.log("HARNESS ERROR:", e.message);
    results.push(false);
  } finally {
    for (const u of Object.values(users)) await admin.auth.admin.deleteUser(u.id);
    if (snapshot) {
      await admin.from("role_permissions").delete().eq("role", "instructor");
      if (snapshot.length) await admin.from("role_permissions").insert(snapshot);
    }
    const failed = results.filter((x) => !x).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed`);
    process.exit(failed ? 1 : 0);
  }
})();
