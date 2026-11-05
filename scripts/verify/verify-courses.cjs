// LOCAL USE ONLY. Reads SUPABASE_SERVICE_ROLE_KEY from .env.local to create/delete throwaway test users.
// Never import this from app code. Run from the project root with the dev server running:
//   node scripts/verify/verify-courses.cjs
// Verifies courses + sections: ownership, the permission matrix, RLS, and the server actions.
// Temporarily edits the role matrix and restores it afterwards.
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
async function login(name) {
  const c = jar();
  const { data, error } = await c.sb.auth.signInWithPassword({ email: users[name].email, password: users[name].password });
  if (error) throw new Error("login " + name + ": " + error.message);
  const api = createClient(URL_, PUB, { global: { headers: { Authorization: `Bearer ${data.session.access_token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  return { api, cookie: c.cookie(), id: users[name].id };
}
async function page(path, cookie) {
  const res = await fetch(APP + path, { headers: cookie ? { cookie } : {}, redirect: "manual" });
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
  const hit = Object.entries(m.node).find(([, v]) => v.exportedName === name && v.filename && v.filename.includes("courses/actions"));
  if (!hit) throw new Error("action not found: " + name);
  return hit[0];
}
async function act(cookie, name, arg) {
  const res = await fetch(APP + "/courses", {
    method: "POST", redirect: "manual",
    headers: { cookie, "Next-Action": actionId(name), "Content-Type": "text/plain;charset=UTF-8", Accept: "text/x-component" },
    body: JSON.stringify([arg]),
  });
  const text = await res.text();
  const ok = text.match(/"ok":(true|false)/);
  const msg = text.match(/"message":"([^"]*)"/);
  const id = text.match(/"id":"([0-9a-f-]{36})"/);
  return { ok: ok ? ok[1] === "true" : null, message: msg && msg[1], id: id && id[1] };
}
const secNames = async (courseId) => ((await admin.from("sections").select("name").eq("course_id", courseId).order("created_at")).data || []).map((s) => s.name);
const courseRow = async (id) => (await admin.from("courses").select("*").eq("id", id).maybeSingle()).data;
const setGrant = async (role, key, on) => {
  if (on) await admin.from("role_permissions").upsert({ role, permission_key: key });
  else await admin.from("role_permissions").delete().eq("role", role).eq("permission_key", key);
};

(async () => {
  try {
    // Known baseline for Teacher: dashboard + courses + sections (restored in finally).
    snapshot = (await admin.from("role_permissions").select("role,permission_key").eq("role", "instructor")).data;
    await admin.from("role_permissions").delete().eq("role", "instructor");
    await admin.from("role_permissions").insert(["instructor_dashboard", "courses", "sections"].map((k) => ({ role: "instructor", permission_key: k })));

    await mk("ta", "approved"); await mk("tb", "approved"); await mk("pend"); await mk("gone", "approved");
    const TA = await login("ta"), TB = await login("tb"), PEND = await login("pend");
    const anon = createClient(URL_, PUB, { auth: { persistSession: false } });
    const { data: adm } = await admin.from("profiles").select("id,email").eq("role", "admin").single();
    const { data: lk } = await admin.auth.admin.generateLink({ type: "magiclink", email: adm.email });
    const AD = jar();
    const { error: ve } = await AD.sb.auth.verifyOtp({ token_hash: lk.properties.hashed_token, type: "magiclink" });
    if (ve) throw new Error(ve.message);
    const adCookie = AD.cookie();
    await page("/courses", TA.cookie); // compile actions

    console.log("== Permission model ==");
    const { data: perm } = await admin.from("permissions").select("key,placeholder").in("key", ["courses", "sections"]);
    check("courses and sections are real modules now (not coming soon)", perm.length === 2 && perm.every((p) => p.placeholder === false));

    console.log("\n== Anyone without access is locked out (API) ==");
    const a1 = await anon.from("courses").select("*");
    check("anonymous cannot read courses", !!a1.error || (a1.data || []).length === 0, a1.error ? a1.error.code : "0 rows");
    const a2 = await anon.from("sections").select("*");
    check("anonymous cannot read sections", !!a2.error || (a2.data || []).length === 0, a2.error ? a2.error.code : "0 rows");
    const p1 = await PEND.api.from("courses").insert({ owner_id: PEND.id, name: "Pending Course" });
    check("pending (unapproved) user cannot create a course", !!p1.error, p1.error && p1.error.code);
    const pg = await page("/courses", PEND.cookie);
    check("pending user: /courses -> /pending-approval", pg.dest === "/pending-approval", `-> ${pg.dest}`);
    const so = await page("/courses");
    check("signed out: /courses -> /login", so.dest === "/login", `-> ${so.dest}`);

    console.log("\n== A teacher creates a course with sections ==");
    const c1 = await act(TA.cookie, "createCourse", { name: "English", description: "Grade 7", sections: "A, B, C\nD" });
    check("teacher creates a course with sections A, B, C, D", c1.ok === true && !!c1.id, c1.message);
    const english = c1.id;
    await page(`/courses/${english}`, TA.cookie); // compile the editor so its actions are registered (dev mode)
    check("  ...owned by that teacher", (await courseRow(english)).owner_id === TA.id);
    check("  ...with four sections in order", JSON.stringify(await secNames(english)) === '["A","B","C","D"]', JSON.stringify(await secNames(english)));
    const c2 = await act(TA.cookie, "createCourse", { name: "Math", sections: "a, A, b" });
    check("duplicate names (any case) in one request are merged", c2.ok === true && JSON.stringify(await secNames(c2.id)) === '["a","b"]', JSON.stringify(c2.id && await secNames(c2.id)));
    const bad1 = await act(TA.cookie, "createCourse", { name: "x" });
    check("refused: course name too short", bad1.ok === false);
    const bad2 = await act(TA.cookie, "createCourse", { name: "Long", sections: "S".repeat(51) });
    check("refused: section name too long", bad2.ok === false);
    const bad3 = await act(TA.cookie, "createCourse", { name: "Many", sections: Array.from({ length: 51 }, (_, i) => `S${i}`).join(",") });
    check("refused: more than 50 sections", bad3.ok === false);
    check("  ...and no half-made courses were left behind", ((await admin.from("courses").select("id").in("name", ["Long", "Many"])).data || []).length === 0);

    console.log("\n== Dynamic sections ==");
    const add = await act(TA.cookie, "addSections", { courseId: english, names: "E, F" });
    check("add more sections later", add.ok === true && (await secNames(english)).join() === "A,B,C,D,E,F");
    const dup = await act(TA.cookie, "addSections", { courseId: english, names: "a" });
    check("refused: a section that already exists (any case)", dup.ok === false && /already exists/.test(dup.message || ""), dup.message);
    check("  ...nothing was added by the failed request", (await secNames(english)).length === 6);
    const none = await act(TA.cookie, "addSections", { courseId: english, names: " , ," });
    check("refused: nothing to add", none.ok === false);
    const secF = (await admin.from("sections").select("id").eq("course_id", english).eq("name", "F").single()).data;
    const rn = await act(TA.cookie, "renameSection", { id: secF.id, name: "Section F" });
    check("rename a section", rn.ok === true && (await secNames(english)).includes("Section F"));
    const rnDup = await act(TA.cookie, "renameSection", { id: secF.id, name: "a" });
    check("refused: rename onto an existing section", rnDup.ok === false);
    const rm = await act(TA.cookie, "deleteSection", { id: secF.id });
    check("remove a section", rm.ok === true && !(await secNames(english)).includes("Section F"));
    const up = await act(TA.cookie, "updateCourse", { id: english, name: "English 7", description: "Updated" });
    check("rename the course and edit its description", up.ok === true && (await courseRow(english)).name === "English 7");

    console.log("\n== Teachers cannot touch each other's courses ==");
    const mine = await TB.api.from("courses").select("id");
    check("teacher B sees none of teacher A's courses", !mine.error && mine.data.length === 0, `rows=${mine.data && mine.data.length}`);
    const own = await TA.api.from("courses").select("id");
    check("teacher A sees only their own (2)", !own.error && own.data.length === 2, `rows=${own.data && own.data.length}`);
    const secRead = await TB.api.from("sections").select("id").eq("course_id", english);
    check("teacher B cannot read A's sections", !secRead.error && secRead.data.length === 0);
    const stolen = await TB.api.from("courses").insert({ owner_id: TA.id, name: "Forged" });
    check("teacher B cannot create a course owned by A", !!stolen.error, stolen.error && stolen.error.code);
    const upd = await TB.api.from("courses").update({ name: "Hacked" }).eq("id", english).select();
    check("teacher B cannot rename A's course", !upd.error ? (upd.data || []).length === 0 : true);
    const del = await TB.api.from("courses").delete().eq("id", english).select();
    check("teacher B cannot delete A's course", !del.error ? (del.data || []).length === 0 : true);
    const secIns = await TB.api.from("sections").insert({ course_id: english, name: "Z" });
    check("teacher B cannot add a section to A's course", !!secIns.error, secIns.error && secIns.error.code);
    const own2 = await TA.api.from("courses").update({ owner_id: TB.id }).eq("id", english).select();
    check("owner cannot be changed (even by the owner)", !!own2.error || (own2.data || []).length === 0 || (await courseRow(english)).owner_id === TA.id);
    const actHack = await act(TB.cookie, "updateCourse", { id: english, name: "Hacked via action", description: "" });
    check("server action refuses B editing A's course", actHack.ok === false && (await courseRow(english)).name === "English 7");
    const actDel = await act(TB.cookie, "deleteCourse", { id: english });
    check("server action refuses B deleting A's course", actDel.ok === false && !!(await courseRow(english)));
    const actSec = await act(TB.cookie, "addSections", { courseId: english, names: "Z" });
    check("server action refuses B adding sections to A's course", actSec.ok === false && !(await secNames(english)).includes("Z"));
    const pgB = await page(`/courses/${english}`, TB.cookie);
    check("page: B opening A's course shows Not Found and none of A's data", /could not be found|404/i.test(pgB.body) && !pgB.body.includes("English 7") && !pgB.body.includes("Grade 7") && !pgB.body.includes("Add sections"), `status=${pgB.status}`);
    const pgA = await page(`/courses/${english}`, TA.cookie);
    check("page: A opens their own course", pgA.status === 200 && pgA.body.includes("English 7") && pgA.body.includes("Add sections"));
    const pgBad = await page("/courses/not-a-uuid", TA.cookie);
    check("page: invalid id shows Not Found", /could not be found|404/i.test(pgBad.body) && !pgBad.body.includes("Add sections"), `status=${pgBad.status}`);
    const list = await page("/courses", TA.cookie);
    check("page: course list shows only A's courses", list.body.includes("English 7") && list.body.includes("Math"));
    const listB = await page("/courses", TB.cookie);
    check("page: B's list is empty", !listB.body.includes("English 7") && listB.body.includes("No courses yet"));

    console.log("\n== The admin sees and manages everything ==");
    const allSeen = await admin.from("courses").select("id");
    void allSeen;
    const adList = await page("/courses", adCookie);
    check("admin's course list shows A's courses and the owner", adList.body.includes("English 7") && adList.body.includes("Verify ta"));
    const adEdit = await act(adCookie, "updateCourse", { id: english, name: "English 7 (admin)", description: "Edited by admin" });
    check("admin can edit any course", adEdit.ok === true && (await courseRow(english)).name === "English 7 (admin)");
    check("  ...ownership is unchanged", (await courseRow(english)).owner_id === TA.id);
    const adSec = await act(adCookie, "addSections", { courseId: english, names: "X" });
    check("admin can add sections to any course", adSec.ok === true && (await secNames(english)).includes("X"));
    const adNew = await act(adCookie, "createCourse", { name: "Admin Course", sections: "One, Two" });
    check("admin can create their own course", adNew.ok === true && (await courseRow(adNew.id)).owner_id === adm.id);
    const taSeesAdmin = await TA.api.from("courses").select("id").eq("id", adNew.id);
    check("  ...which teachers cannot see", taSeesAdmin.data.length === 0);

    console.log("\n== The permission matrix controls it ==");
    await setGrant("instructor", "sections", false);
    const noSecRead = await TA.api.from("sections").select("id").eq("course_id", english);
    check("without 'sections', teacher can't read sections (RLS)", !noSecRead.error && noSecRead.data.length === 0);
    const noSecAct = await act(TA.cookie, "addSections", { courseId: english, names: "Q" });
    check("  ...nor add them", noSecAct.ok !== true && !(await secNames(english)).includes("Q"));
    const pgNoSec = await page(`/courses/${english}`, TA.cookie);
    check("  ...the course page says they have no access to sections", pgNoSec.body.includes("have access to sections"), `status=${pgNoSec.status}`);
    const stillCourse = await TA.api.from("courses").select("id").eq("id", english);
    check("  ...but can still see the course", stillCourse.data.length === 1);
    await setGrant("instructor", "sections", true);
    await setGrant("instructor", "courses", false);
    const noCourse = await TA.api.from("courses").select("id");
    check("without 'courses', the teacher sees no courses (RLS)", !noCourse.error && noCourse.data.length === 0);
    const noCourseIns = await TA.api.from("courses").insert({ owner_id: TA.id, name: "Blocked" });
    check("  ...and cannot create one", !!noCourseIns.error);
    const pgNoCourse = await page("/courses", TA.cookie);
    check("  ...and /courses redirects them away", pgNoCourse.dest === "/instructor", `-> ${pgNoCourse.dest}`);
    await setGrant("instructor", "courses", true);
    const back = await TA.api.from("courses").select("id");
    check("restoring the permission restores access", back.data.length === 2);

    console.log("\n== Deactivated users lose access ==");
    const G = await login("gone");
    const gc = await act(G.cookie, "createCourse", { name: "Before Deactivation" });
    check("(before) the user can create a course", gc.ok === true);
    await admin.from("profiles").update({ deactivated_at: new Date().toISOString() }).eq("id", G.id);
    const gSee = await G.api.from("courses").select("id");
    check("deactivated user cannot read their own courses (RLS)", !gSee.error && gSee.data.length === 0);
    const gIns = await G.api.from("courses").insert({ owner_id: G.id, name: "After Deactivation" });
    check("  ...nor create new ones", !!gIns.error);
    await admin.from("profiles").update({ deactivated_at: null }).eq("id", G.id);

    console.log("\n== Deleting ==");
    const before = await secNames(english);
    const dc = await act(TA.cookie, "deleteCourse", { id: english });
    check("owner deletes their course", dc.ok === true && !(await courseRow(english)), `had ${before.length} sections`);
    check("  ...its sections are gone too", ((await admin.from("sections").select("id").eq("course_id", english)).data || []).length === 0);
  } catch (e) {
    console.log("HARNESS ERROR:", e.message);
    results.push(false);
  } finally {
    console.log("\n== Cleanup ==");
    const ids = Object.values(users).map((u) => u.id);
    if (ids.length) await admin.from("courses").delete().in("owner_id", ids);
    const { data: adm2 } = await admin.from("profiles").select("id").eq("role", "admin").single();
    await admin.from("courses").delete().eq("owner_id", adm2.id).like("name", "Admin Course%");
    for (const u of Object.values(users)) await admin.auth.admin.deleteUser(u.id);
    if (snapshot) {
      await admin.from("role_permissions").delete().eq("role", "instructor");
      if (snapshot.length) await admin.from("role_permissions").insert(snapshot);
    }
    const { count: pc } = await admin.from("profiles").select("*", { count: "exact", head: true });
    const { count: cc } = await admin.from("courses").select("*", { count: "exact", head: true });
    console.log(`profiles: ${pc} (expected 1); courses left: ${cc}`);
    const failed = results.filter((r) => !r).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed`);
    process.exit(failed ? 1 : 0);
  }
})();
