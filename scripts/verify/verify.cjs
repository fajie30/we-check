// LOCAL USE ONLY. Reads SUPABASE_SERVICE_ROLE_KEY from .env.local to create/delete throwaway test users.
// Never import this from app code. Run from the project root with the dev server running:
//   node scripts/verify/NAME.cjs
// Security verification harness. Reads .env.local itself; never prints secrets.
// Creates throwaway users, runs real API + page attacks, then deletes them.
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
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const PUB = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SRK = env.SUPABASE_SERVICE_ROLE_KEY;
const APP = process.env.APP_URL || "http://localhost:3000";

const admin = createClient(URL, SRK, { auth: { persistSession: false, autoRefreshToken: false } });
const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
};
const pw = () => crypto.randomBytes(12).toString("base64url") + "aA1";
const tag = crypto.randomBytes(3).toString("hex");
const mail = (n) => `verify-${n}-${tag}@wecheck-verify.invalid`;

const users = {};
async function mk(name, { confirmed = true, meta = { full_name: `Verify ${name}` }, status } = {}) {
  const password = pw();
  const { data, error } = await admin.auth.admin.createUser({
    email: mail(name), password, email_confirm: confirmed, user_metadata: meta,
  });
  if (error) throw new Error(`createUser ${name}: ${error.message}`);
  users[name] = { id: data.user.id, email: mail(name), password };
  if (status) {
    const { error: e } = await admin.from("profiles").update({ approval_status: status }).eq("id", data.user.id);
    if (e) throw new Error(`set status ${name}: ${e.message}`);
  }
}

// Real session as the app would hold it: cookies set by @supabase/ssr.
async function login(name) {
  const jar = new Map();
  const sb = createServerClient(URL, PUB, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => list.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  const { data, error } = await sb.auth.signInWithPassword({ email: users[name].email, password: users[name].password });
  if (error) return { error };
  const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const api = createClient(URL, PUB, {
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { sb, api, cookie, token: data.session.access_token };
}

async function page(path, cookie) {
  const res = await fetch(APP + path, { headers: cookie ? { cookie } : {}, redirect: "manual" });
  const body = await res.text();
  let dest = res.headers.get("location");
  if (dest) dest = new globalThis.URL(dest, APP).pathname;
  if (!dest) {
    const m = body.match(/NEXT_REDIRECT;(?:replace|push);([^;]+);/) || body.match(/http-equiv="refresh"[^>]*content="[^"]*url=([^"]+)"/);
    if (m) dest = decodeURIComponent(m[1]);
  }
  return { status: res.status, dest, body };
}

(async () => {
  try {
    await mk("pending");
    await mk("other");
    await mk("rejected", { status: "rejected" });
    await mk("approved", { status: "approved" });
    await mk("unverified", { confirmed: false });
    await mk("tamper", { meta: { full_name: "Tamper", role: "admin", approval_status: "approved", is_admin: true } });

    console.log("\n== 7. Signup cannot create an admin (tampered metadata) ==");
    const { data: tp } = await admin.from("profiles").select("role,approval_status,full_name").eq("id", users.tamper.id).single();
    check("tampered signup metadata -> role=instructor, status=pending_approval", tp.role === "instructor" && tp.approval_status === "pending_approval", JSON.stringify(tp));
    const { data: admins } = await admin.from("profiles").select("id").eq("role", "admin");
    check("exactly one admin exists", admins.length === 1, `count=${admins.length}`);

    console.log("\n== 3. Unverified email ==");
    const un = await login("unverified");
    check("unverified email cannot sign in (no session)", !!un.error && un.error.code === "email_not_confirmed", un.error && un.error.code);
    const { data: unp } = await admin.from("profiles").select("approval_status").eq("id", users.unverified.id).single();
    check("unverified profile stays pending_approval", unp.approval_status === "pending_approval");

    console.log("\n== Anonymous (publishable key only) ==");
    const anon = createClient(URL, PUB, { auth: { persistSession: false } });
    const a1 = await anon.from("profiles").select("*");
    check("anon cannot read profiles", !!a1.error || (a1.data || []).length === 0, a1.error ? a1.error.code : "0 rows");
    const a2 = await anon.rpc("review_instructor", { p_target: users.pending.id, p_decision: "approve" });
    check("anon cannot call review_instructor", !!a2.error, a2.error && a2.error.code);
    const a3 = await anon.rpc("admin_list_instructors");
    check("anon cannot call admin_list_instructors", !!a3.error, a3.error && a3.error.code);

    for (const who of ["pending", "rejected"]) {
      console.log(`\n== API attacks as ${who} instructor (real JWT) ==`);
      const s = await login(who);
      const me = users[who].id;
      const own = await s.api.from("profiles").select("id");
      check(`${who}: reads only own profile row`, !own.error && own.data.length === 1 && own.data[0].id === me, `rows=${own.data && own.data.length}`);
      const other = await s.api.from("profiles").select("*").eq("id", users.other.id);
      check(`${who}: cannot read another instructor's profile`, !other.error && other.data.length === 0, `rows=${other.data && other.data.length}`);
      const u1 = await s.api.from("profiles").update({ approval_status: "approved" }).eq("id", me).select();
      check(`${who}: cannot set own approval_status`, !!u1.error || (u1.data || []).length === 0, u1.error ? u1.error.code : "0 rows");
      const u2 = await s.api.from("profiles").update({ role: "admin" }).eq("id", me).select();
      check(`${who}: cannot set own role=admin`, !!u2.error || (u2.data || []).length === 0, u2.error ? u2.error.code : "0 rows");
      const u3 = await s.api.from("profiles").update({ reviewed_by: me }).eq("id", me).select();
      check(`${who}: cannot set own reviewed_by`, !!u3.error || (u3.data || []).length === 0, u3.error ? u3.error.code : "0 rows");
      const ins = await s.api.from("profiles").insert({ id: crypto.randomUUID(), full_name: "x", email: "x@x.x", role: "admin" });
      check(`${who}: cannot insert profiles`, !!ins.error, ins.error && ins.error.code);
      const del = await s.api.from("profiles").delete().eq("id", me).select();
      check(`${who}: cannot delete own profile`, !!del.error || (del.data || []).length === 0, del.error ? del.error.code : "0 rows");
      const rv = await s.api.rpc("review_instructor", { p_target: users.other.id, p_decision: "approve" });
      check(`${who}: non-admin cannot call approve/reject`, !!rv.error, rv.error && rv.error.code);
      const ls = await s.api.rpc("admin_list_instructors");
      check(`${who}: non-admin cannot list all instructors`, !!ls.error, ls.error && ls.error.code);
      const au = await s.api.from("approval_audit_log").select("*");
      check(`${who}: cannot read audit log`, !!au.error || (au.data || []).length === 0, au.error ? au.error.code : "0 rows");
    }
    const { data: after } = await admin.from("profiles").select("id,role,approval_status").in("id", [users.pending.id, users.rejected.id, users.other.id]);
    const pend = after.find((p) => p.id === users.pending.id), rej = after.find((p) => p.id === users.rejected.id), oth = after.find((p) => p.id === users.other.id);
    check("after all attacks: pending still pending, rejected still rejected, other untouched",
      pend.approval_status === "pending_approval" && rej.approval_status === "rejected" && oth.approval_status === "pending_approval" && [pend, rej, oth].every((p) => p.role === "instructor"));

    console.log("\n== Pages (real session cookies against the running app) ==");
    const show = (r) => `status=${r.status} -> ${r.dest || "(rendered)"}`;
    const so = {};
    for (const p of ["/instructor", "/admin", "/admin/teachers", "/pending-approval", "/rejected"]) {
      so[p] = await page(p);
      check(`signed out ${p} -> /login`, so[p].dest === "/login", show(so[p]));
    }
    const sessions = { pending: await login("pending"), rejected: await login("rejected"), approved: await login("approved") };

    const expect = {
      pending: { "/instructor": "/pending-approval", "/admin": "/pending-approval", "/admin/teachers": "/pending-approval", "/rejected": "/pending-approval", "/pending-approval": null },
      rejected: { "/instructor": "/rejected", "/admin": "/rejected", "/admin/teachers": "/rejected", "/pending-approval": "/rejected", "/rejected": null },
      approved: { "/instructor": null, "/admin": "/instructor", "/admin/teachers": "/instructor", "/pending-approval": "/instructor", "/rejected": "/instructor" },
    };
    for (const who of ["pending", "rejected", "approved"]) {
      for (const [path, want] of Object.entries(expect[who])) {
        const r = await page(path, sessions[who].cookie);
        let pass = r.dest === want;
        let extra = show(r);
        if (want !== null) {
          const leaked = /Instructor dashboard|Manage teachers|registered in total|Pending approvals/.test(r.body);
          pass = pass && !leaked;
          if (leaked) extra += " [PROTECTED CONTENT IN RESPONSE]";
        } else {
          const marker = { "/instructor": "Instructor dashboard", "/pending-approval": "Waiting for approval", "/rejected": "Registration declined" }[path];
          pass = pass && r.body.includes(marker);
          extra += r.body.includes(marker) ? ` (shows "${marker}")` : " (expected page content missing)";
        }
        check(`${who} ${path} -> ${want || "own page renders"}`, pass, extra);
      }
    }
  } catch (e) {
    console.log("HARNESS ERROR:", e.message);
    results.push({ name: "harness", pass: false });
  } finally {
    console.log("\n== Cleanup ==");
    for (const [name, u] of Object.entries(users)) {
      const { error } = await admin.auth.admin.deleteUser(u.id);
      if (error) console.log(`could not delete ${name}: ${error.message}`);
    }
    const { count } = await admin.from("profiles").select("*", { count: "exact", head: true });
    console.log(`profiles remaining: ${count} (expected 1 = the real admin)`);
    const failed = results.filter((r) => !r.pass);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    process.exit(failed.length ? 1 : 0);
  }
})();
