// LOCAL USE ONLY. Reads SUPABASE_SERVICE_ROLE_KEY from .env.local to create/delete throwaway test users.
// Never import this from app code. Run from the project root with the dev server running:
//   node scripts/verify/verify-users.cjs
// Verifies admin user management: add (invite link), edit, deactivate/reactivate, password links.
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
const mail = (n) => `verify-${n}-${tag}@wecheck-verify.invalid`;
const STRONG = () => crypto.randomBytes(9).toString("base64url") + "aA1";
const users = {};

async function mk(name, status) {
  const password = STRONG();
  const { data, error } = await admin.auth.admin.createUser({ email: mail(name), password, email_confirm: true, user_metadata: { full_name: `Verify ${name}` } });
  if (error) throw new Error(error.message);
  users[name] = { id: data.user.id, email: mail(name), password };
  if (status) await admin.from("profiles").update({ approval_status: status }).eq("id", data.user.id);
}
function jar() {
  const j = new Map();
  const sb = createServerClient(URL_, PUB, {
    cookies: { getAll: () => [...j].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach(({ name, value }) => j.set(name, value)) },
  });
  return { sb, cookie: () => [...j].map(([k, v]) => `${k}=${v}`).join("; ") };
}
async function login(email, password) {
  const c = jar();
  const { data, error } = await c.sb.auth.signInWithPassword({ email, password });
  if (error) return { error };
  const api = createClient(URL_, PUB, { global: { headers: { Authorization: `Bearer ${data.session.access_token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  return { api, cookie: c.cookie() };
}
async function page(path, cookie) {
  const res = await fetch(APP + path, { headers: cookie ? { cookie } : {}, redirect: "manual" });
  const body = await res.text();
  let dest = res.headers.get("location");
  if (dest) dest = new URL(dest, APP).pathname + new URL(dest, APP).search;
  if (!dest) {
    const m = body.match(/NEXT_REDIRECT;(?:replace|push);([^;]+);/) || body.match(/http-equiv="refresh"[^>]*content="[^"]*url=([^"]+)"/);
    if (m) dest = decodeURIComponent(m[1]);
  }
  return { status: res.status, dest, body, setCookie: res.headers.getSetCookie ? res.headers.getSetCookie() : [] };
}
const cookieFrom = (setCookie) => setCookie.map((c) => c.split(";")[0]).join("; ");

function actionId(name, fileHint) {
  const m = JSON.parse(fs.readFileSync(`${ROOT}/.next/dev/server/server-reference-manifest.json`, "utf8"));
  const hit = Object.entries(m.node).find(([, v]) => v.exportedName === name && v.filename && v.filename.includes(fileHint));
  if (!hit) throw new Error("action not found: " + name);
  return hit[0];
}
async function act(cookie, name, fileHint, arg, path = "/admin/teachers") {
  const res = await fetch(APP + path, {
    method: "POST", redirect: "manual",
    headers: { cookie, "Next-Action": actionId(name, fileHint), "Content-Type": "text/plain;charset=UTF-8", Accept: "text/x-component" },
    body: JSON.stringify(Array.isArray(arg) ? arg : [arg]),
  });
  const text = await res.text();
  const ok = text.match(/"ok":(true|false)/);
  const msg = text.match(/"message":"([^"]*)"/);
  const link = text.match(/"link":"([^"]*)"/);
  return { ok: ok ? ok[1] === "true" : null, message: msg && msg[1], link: link && link[1], redirected: res.status >= 300 && res.status < 400 || !!res.headers.get("x-action-redirect"), text };
}
const U = (name, arg) => (cookie) => act(cookie, name, "user-actions", arg);
const profile = async (id) => (await admin.from("profiles").select("*").eq("id", id).single()).data;
const authUserByEmail = async (email) => {
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  return (data.users || []).find((u) => u.email === email);
};
const pathOf = (link) => { const u = new URL(link); return u.pathname + u.search; };

(async () => {
  try {
    await mk("t1", "approved"); await mk("t2", "approved"); await mk("pend");
    const { data: adm } = await admin.from("profiles").select("id,email").eq("role", "admin").single();
    const { data: lk } = await admin.auth.admin.generateLink({ type: "magiclink", email: adm.email });
    const A = jar();
    const { error: ve } = await A.sb.auth.verifyOtp({ token_hash: lk.properties.hashed_token, type: "magiclink" });
    if (ve) throw new Error(ve.message);
    const ac = A.cookie();
    await page("/admin/teachers", ac); // compile

    console.log("== Non-admins cannot manage users ==");
    const T1 = await login(users.t1.email, users.t1.password);
    const anon = createClient(URL_, PUB, { auth: { persistSession: false } });
    const rpcs = [
      ["admin_prepare_user", { p_user: users.pend.id, p_role: "instructor" }],
      ["admin_update_user", { p_user: users.t2.id, p_full_name: "Hacked" }],
      ["admin_set_user_active", { p_user: users.t2.id, p_active: false }],
      ["admin_log_user_event", { p_user: users.t2.id, p_action: "edit", p_detail: {} }],
    ];
    for (const [who, c] of [["anonymous", anon], ["teacher", T1.api]]) {
      for (const [fn, args] of rpcs) {
        const r = await c.rpc(fn, args);
        check(`${who}: cannot call ${fn}`, !!r.error, r.error && r.error.code);
      }
    }
    const sd = await T1.api.from("profiles").update({ deactivated_at: null, deactivated_by: users.t1.id }).eq("id", users.t1.id).select();
    check("teacher: cannot touch deactivation columns", !!sd.error || (sd.data || []).length === 0, sd.error ? sd.error.code : "0 rows");
    const al = await T1.api.from("user_audit_log").select("*");
    check("teacher: cannot read user_audit_log", !!al.error || (al.data || []).length === 0);
    check("targets unchanged after attacks", (await profile(users.t2.id)).full_name === "Verify t2" && !(await profile(users.t2.id)).deactivated_at);
    const ta = await U("createUser", { fullName: "Teacher Made", email: mail("tm"), role: "instructor" })(T1.cookie);
    check("teacher cannot add a user via the server action", ta.ok !== true && !(await authUserByEmail(mail("tm"))));
    const td = await U("setUserActive", { id: users.t2.id, active: false })(T1.cookie);
    check("teacher cannot deactivate via the server action", td.ok !== true && !(await profile(users.t2.id)).deactivated_at);

    console.log("\n== Add a user (invite) ==");
    const inv = await U("createUser", { fullName: "Invited One", email: mail("inv"), role: "instructor" })(ac);
    check("admin adds a user and gets an invite link", inv.ok === true && !!inv.link && /\/auth\/confirm\?token_hash=.+&type=invite/.test(inv.link.replace(/\\u0026/g, "&")), inv.message);
    const invUser = await authUserByEmail(mail("inv"));
    users.inv = { id: invUser && invUser.id, email: mail("inv") };
    const ip = invUser ? await profile(invUser.id) : null;
    check("  ...profile is approved with the chosen role and name", ip && ip.approval_status === "approved" && ip.role === "instructor" && ip.full_name === "Invited One" && !!ip.reviewed_by);
    check("  ...email is NOT verified until the link is used", invUser && !invUser.email_confirmed_at);
    const dupe = await U("createUser", { fullName: "Dup", email: mail("inv"), role: "instructor" })(ac);
    check("duplicate email is refused", dupe.ok === false && /already exists/.test(dupe.message || ""), dupe.message);
    const unk = await U("createUser", { fullName: "Ghost User", email: mail("ghost"), role: "no_such_role" })(ac);
    check("unknown role is refused and leaves no account behind", unk.ok === false && !(await authUserByEmail(mail("ghost"))));
    const adr = await U("createUser", { fullName: "Evil Admin", email: mail("evil"), role: "admin" })(ac);
    check("creating an admin is refused and leaves no account behind", adr.ok === false && !(await authUserByEmail(mail("evil"))));
    const bad = await U("createUser", { fullName: "x", email: "nope", role: "instructor" })(ac);
    check("invalid name/email is refused", bad.ok === false);
    check("  ...still exactly one admin", ((await admin.from("profiles").select("id").eq("role", "admin")).data || []).length === 1);

    console.log("\n== The invite link ==");
    const invPath = pathOf(inv.link.replace(/\\u0026/g, "&"));
    const tamper = await page(invPath.replace(/token_hash=[^&]+/, "token_hash=deadbeef"));
    check("tampered token is rejected", /verify-email\?error=link/.test(tamper.dest || ""), tamper.dest);
    const wrongType = await page(invPath.replace("type=invite", "type=magiclink"));
    check("link type other than invite/recovery is rejected", /verify-email\?error=link/.test(wrongType.dest || ""), wrongType.dest);
    const use = await page(invPath);
    check("valid link -> /set-password with a session", use.dest === "/set-password" && use.setCookie.length > 0, use.dest);
    const invCookie = cookieFrom(use.setCookie);
    const used = await page(invPath);
    check("link is single-use", /verify-email\?error=link/.test(used.dest || ""), used.dest);
    const sp = await page("/set-password", invCookie);
    check("set-password page renders for the invited user", sp.body.includes("Choose your password") && !sp.dest);
    const anonSp = await page("/set-password");
    check("signed-out visitors cannot use /set-password", anonSp.dest === "/login");
    // Set the password with the invited user's own session from the link (what the form does).
    const newPw = STRONG();
    const parse = (c) => c.split('; ').filter(Boolean).map((p) => ({ name: p.slice(0, p.indexOf('=')), value: p.slice(p.indexOf('=') + 1) }));
    const IC = createServerClient(URL_, PUB, { cookies: { getAll: () => parse(invCookie), setAll() {} } });
    const upd = await IC.auth.updateUser({ password: newPw });
    check("invited user can set a password with the link's session", !upd.error, upd.error && upd.error.message);
    const ac2 = await admin.auth.admin.getUserById(users.inv.id);
    check("  ...their email is now verified", !!(ac2.data.user && ac2.data.user.email_confirmed_at));
    const li = await login(mail("inv"), newPw);
    check("  ...and sign in with it", !li.error);
    const landing = li.error ? { dest: null } : await page("/", li.cookie);
    check("  ...landing on their dashboard", landing.dest === "/instructor", `-> ${landing.dest}`);

    console.log("\n== Edit a user ==");
    const ed = await U("updateUser", { id: users.t1.id, fullName: "Renamed Person", email: mail("t1b") })(ac);
    const p1 = await profile(users.t1.id);
    check("admin edits name and email", ed.ok === true && p1.full_name === "Renamed Person" && p1.email === mail("t1b"), ed.message);
    const nl = await login(mail("t1b"), users.t1.password);
    check("  ...user signs in with the new email, same password", !nl.error);
    const ol = await login(users.t1.email, users.t1.password);
    check("  ...old email no longer works", !!ol.error);
    const ede = await U("updateUser", { id: users.t2.id, fullName: "Verify t2", email: mail("t1b") })(ac);
    check("email already in use is refused", ede.ok === false && /already exists/.test(ede.message || ""), ede.message);
    const edadm = await U("updateUser", { id: adm.id, fullName: "Hacked Admin", email: "admin-hacked@wecheck-verify.invalid" })(ac);
    check("editing the admin is refused", edadm.ok === false && (await profile(adm.id)).full_name !== "Hacked Admin");
    const edbad = await U("updateUser", { id: users.t2.id, fullName: "A", email: "not-an-email" })(ac);
    check("invalid edit is refused", edbad.ok === false);

    console.log("\n== Deactivate / reactivate ==");
    const t2s = await login(users.t2.email, users.t2.password);
    const before = await page("/", t2s.cookie);
    check("(before) active teacher lands on their dashboard", before.dest === "/instructor", `-> ${before.dest}`);
    const de = await U("setUserActive", { id: users.t2.id, active: false })(ac);
    check("admin deactivates a user", de.ok === true && !!(await profile(users.t2.id)).deactivated_at);
    const blocked = await login(users.t2.email, users.t2.password);
    check("  ...sign-in is blocked at the Auth level", !!blocked.error, blocked.error && blocked.error.code);
    const stale = await page("/instructor", t2s.cookie);
    check("  ...an existing session is rejected on the next request (banned at Auth)", stale.dest === "/login", `-> ${stale.dest}`);
    // Defence in depth: if the Auth ban were ever missing, the app itself still refuses them.
    await mk("soft", "approved");
    const SF = await login(users.soft.email, users.soft.password);
    await admin.from("profiles").update({ deactivated_at: new Date().toISOString() }).eq("id", users.soft.id);
    const sfi = await page("/instructor", SF.cookie);
    check("  ...without the ban, the app still sends a deactivated profile to /deactivated", sfi.dest === "/deactivated", `-> ${sfi.dest}`);
    const dp = await page("/deactivated", SF.cookie);
    check("  ...and that page explains it", dp.body.includes("Account deactivated"));
    const sfp = (await SF.api.rpc("my_permissions")).data;
    check("  ...with no permissions", JSON.stringify(sfp) === "[]", JSON.stringify(sfp));
    const perms = (await t2s.api.rpc("my_permissions")).data;
    check("  ...and they hold no permissions", JSON.stringify(perms) === "[]", JSON.stringify(perms));
    const rl = await U("createResetLink", { id: users.t2.id })(ac);
    check("  ...no password link for a deactivated user", rl.ok === false);
    const re = await U("setUserActive", { id: users.t2.id, active: true })(ac);
    check("admin reactivates", re.ok === true && !(await profile(users.t2.id)).deactivated_at);
    const back = await login(users.t2.email, users.t2.password);
    check("  ...user signs in again", !back.error);
    const bp = back.error ? { dest: null } : await page("/", back.cookie);
    check("  ...and reaches their dashboard", bp.dest === "/instructor", `-> ${bp.dest}`);
    const dadm = await U("setUserActive", { id: adm.id, active: false })(ac);
    check("deactivating the admin account is refused", dadm.ok === false && !(await profile(adm.id)).deactivated_at);

    console.log("\n== Password link for an existing user ==");
    const rs = await U("createResetLink", { id: users.t1.id })(ac);
    check("admin creates a password link", rs.ok === true && /type=recovery/.test((rs.link || "").replace(/\\u0026/g, "&")));
    const rsPath = pathOf((rs.link || "").replace(/\\u0026/g, "&"));
    const ru = await page(rsPath);
    check("  ...the link opens /set-password", ru.dest === "/set-password", ru.dest);
    const radm = await U("createResetLink", { id: adm.id })(ac);
    check("no password link for the admin account", radm.ok === false);

    console.log("\n== Audit trail ==");
    const { data: log } = await admin.from("user_audit_log").select("action,changed_by").gte("changed_at", started);
    const actions = new Set(log.map((l) => l.action));
    check("create, edit, deactivate, reactivate, reset_link are all logged by the admin", ["create", "edit", "deactivate", "reactivate", "reset_link"].every((a) => actions.has(a)) && log.every((l) => l.changed_by === adm.id), [...actions].join());
  } catch (e) {
    console.log("HARNESS ERROR:", e.message);
    results.push(false);
  } finally {
    console.log("\n== Cleanup ==");
    const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
    for (const u of data.users || []) if ((u.email || "").endsWith(`-${tag}@wecheck-verify.invalid`) || (u.email || "").includes(`-${tag}@`) || u.email === mail("t1b")) await admin.auth.admin.deleteUser(u.id);
    await admin.from("user_audit_log").delete().gte("changed_at", started);
    await admin.from("approval_audit_log").delete().gte("decided_at", started);
    const { count } = await admin.from("profiles").select("*", { count: "exact", head: true });
    console.log(`profiles remaining: ${count} (expected 1 = the real admin)`);
    const failed = results.filter((r) => !r).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed`);
    process.exit(failed ? 1 : 0);
  }
})();
