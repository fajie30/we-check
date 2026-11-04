// LOCAL USE ONLY. Reads SUPABASE_SERVICE_ROLE_KEY from .env.local to create/delete throwaway test users.
// Never import this from app code. Run from the project root with the dev server running:
//   node scripts/verify/NAME.cjs
// Admin-path verification: admin pages + the live approve/reject server action.
// Uses a one-time magic-link session for the admin (no password change).
// Only throwaway test teachers are ever approved/rejected, then deleted.
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

const manifest = JSON.parse(fs.readFileSync(`${ROOT}/.next/dev/server/server-reference-manifest.json`, "utf8"));
const ACTION_ID = Object.entries(manifest.node).find(([, v]) => v.exportedName === "reviewTeacher")[0];

const results = [];
const check = (name, pass, detail = "") => {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
};
const tag = crypto.randomBytes(3).toString("hex");
const users = {};
async function mk(name, confirmed = true) {
  const password = crypto.randomBytes(12).toString("base64url") + "aA1";
  const email = `verify-${name}-${tag}@wecheck-verify.invalid`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: confirmed, user_metadata: { full_name: `Verify ${name} ${tag}` } });
  if (error) throw new Error(error.message);
  users[name] = { id: data.user.id, email, password };
}
function jarClient() {
  const jar = new Map();
  const sb = createServerClient(URL_, PUB, {
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach(({ name, value }) => jar.set(name, value)) },
  });
  return { sb, cookie: () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ") };
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
async function callAction(cookie, arg, path = "/admin/teachers") {
  const res = await fetch(APP + path, {
    method: "POST", redirect: "manual",
    headers: { cookie, "Next-Action": ACTION_ID, "Content-Type": "text/plain;charset=UTF-8", Accept: "text/x-component" },
    body: JSON.stringify([arg]),
  });
  const text = await res.text();
  const m = text.match(/"ok":(true|false)(?:,"message":"([^"]*)")?/);
  return { status: res.status, ok: m ? m[1] === "true" : null, message: m && m[2], text, location: res.headers.get("location") };
}
const row = async (id) => (await admin.from("profiles").select("approval_status,rejection_reason,reviewed_by,reviewed_at").eq("id", id).single()).data;

(async () => {
  let adminId;
  try {
    await mk("vp"); await mk("unv", false); await mk("rj"); await mk("selfapprove");
    // Make the "unverified" profile exist as pending (trigger already did).

    const { data: adm } = await admin.from("profiles").select("id,email").eq("role", "admin").single();
    adminId = adm.id;
    const { data: link, error: le } = await admin.auth.admin.generateLink({ type: "magiclink", email: adm.email });
    if (le) throw new Error("generateLink: " + le.message);
    const A = jarClient();
    const { error: ve } = await A.sb.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
    if (ve) throw new Error("verifyOtp: " + ve.message);
    const cookie = A.cookie();

    console.log("== Admin pages ==");
    const ov = await page("/admin", cookie);
    check("admin /admin renders overview", ov.status === 200 && !ov.dest && /Overview/.test(ov.body), `status=${ov.status}`);
    const tl = await page("/admin/teachers", cookie);
    check("admin /admin/teachers renders list with test teachers", tl.status === 200 && !tl.dest && tl.body.includes(`Verify vp ${tag}`), `status=${tl.status}`);
    check("unverified teacher shows 'Email not verified' + disabled-approve hint", tl.body.includes("Email not verified") && tl.body.includes("until the email is verified"));
    const flt = await page("/admin/teachers?status=approved&q=zzzz-no-match", cookie);
    check("filter + search with no match -> empty state", flt.body.includes("No teachers match"));
    for (const p of ["/instructor", "/pending-approval", "/rejected", "/login"]) {
      const r = await page(p, cookie);
      check(`admin ${p} -> /admin`, r.dest === "/admin", `status=${r.status} -> ${r.dest}`);
    }

    console.log("\n== Server action: approve/reject ==");
    const r1 = await callAction(cookie, { id: users.unv.id, decision: "approve" });
    check("approve UNVERIFIED teacher is refused", r1.ok === false, r1.message || `status=${r1.status}`);
    check("  ...and the row is unchanged", (await row(users.unv.id)).approval_status === "pending_approval");

    const r2 = await callAction(cookie, { id: users.vp.id, decision: "approve" });
    check("approve verified pending teacher succeeds", r2.ok === true, `status=${r2.status}`);
    const vp = await row(users.vp.id);
    check("  ...row approved, reviewed_by = admin, reviewed_at set", vp.approval_status === "approved" && vp.reviewed_by === adminId && !!vp.reviewed_at);

    const r3 = await callAction(cookie, { id: users.rj.id, decision: "reject", reason: "Verification test reason" });
    check("reject with reason succeeds", r3.ok === true);
    const rj = await row(users.rj.id);
    check("  ...row rejected, reason stored, reviewed_by = admin", rj.approval_status === "rejected" && rj.rejection_reason === "Verification test reason" && rj.reviewed_by === adminId);

    const { data: audit } = await admin.from("approval_audit_log").select("decision,decided_by,profile_id").in("profile_id", [users.vp.id, users.rj.id]);
    check("audit log has both decisions with decided_by = admin", audit.length === 2 && audit.every((a) => a.decided_by === adminId), `rows=${audit.length}`);

    const r4 = await callAction(cookie, { id: users.vp.id, decision: "reject" });
    check("re-deciding an already-approved teacher is refused", r4.ok === false);
    check("  ...still approved", (await row(users.vp.id)).approval_status === "approved");
    const r5 = await callAction(cookie, { id: "not-a-uuid", decision: "approve" });
    check("invalid id is refused (Zod)", r5.ok === false);
    const r6 = await callAction(cookie, { id: users.unv.id, decision: "promote" });
    check("invalid decision is refused (Zod)", r6.ok === false);
    const r7 = await callAction(cookie, { id: adminId, decision: "reject" });
    check("admin cannot target the admin account", r7.ok === false);
    check("  ...admin row untouched", (await admin.from("profiles").select("role,approval_status").eq("id", adminId).single()).data.role === "admin");

    console.log("\n== Server action as NON-admin (self-approval attempt) ==");
    const T = jarClient();
    const { error: se } = await T.sb.auth.signInWithPassword({ email: users.selfapprove.email, password: users.selfapprove.password });
    if (se) throw new Error("teacher login: " + se.message);
    const r8 = await callAction(T.cookie(), { id: users.selfapprove.id, decision: "approve" });
    check("pending teacher calling the action cannot approve themselves", r8.ok !== true, `status=${r8.status} ok=${r8.ok}`);
    check("  ...row still pending_approval", (await row(users.selfapprove.id)).approval_status === "pending_approval");
    const r9 = await callAction("", { id: users.selfapprove.id, decision: "approve" });
    check("signed-out caller cannot use the action", r9.ok !== true);
    check("  ...row still pending_approval", (await row(users.selfapprove.id)).approval_status === "pending_approval");

    console.log("\n== Decided teachers now land correctly ==");
    for (const [who, want] of [["vp", "/instructor"], ["rj", "/rejected"]]) {
      const C = jarClient();
      await C.sb.auth.signInWithPassword({ email: users[who].email, password: users[who].password });
      const r = await page("/instructor", C.cookie());
      const body = who === "vp" ? r.body.includes("Instructor dashboard") : r.dest === want;
      check(`${who === "vp" ? "approved" : "rejected"} teacher after decision: /instructor -> ${who === "vp" ? "dashboard" : want}`, body, `status=${r.status} -> ${r.dest || "(rendered)"}`);
    }
  } catch (e) {
    console.log("HARNESS ERROR:", e.message);
    results.push(false);
  } finally {
    console.log("\n== Cleanup ==");
    for (const u of Object.values(users)) await admin.auth.admin.deleteUser(u.id);
    const { count } = await admin.from("profiles").select("*", { count: "exact", head: true });
    const { count: ac } = await admin.from("approval_audit_log").select("*", { count: "exact", head: true });
    const { data: still } = await admin.from("profiles").select("role,approval_status").eq("role", "admin");
    console.log(`profiles remaining: ${count}, audit rows remaining: ${ac}, admin intact: ${JSON.stringify(still)}`);
    const failed = results.filter((r) => !r).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed`);
    process.exit(failed ? 1 : 0);
  }
})();
