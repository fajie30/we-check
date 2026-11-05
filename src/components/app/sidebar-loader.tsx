import { getAccessState } from "@/lib/auth/access";
import { AppSidebar, type NavItem } from "./app-sidebar";

/**
 * Builds the menu for whoever is signed in. Items come from their role's permissions,
 * so a new module only needs one entry here. This is navigation only: every page and
 * action still checks access on the server, and the database enforces it again.
 */
export async function SidebarLoader() {
  const state = await getAccessState();
  if (state.kind !== "admin" && state.kind !== "member") return null; // pages redirect these users anyway

  const can = (key: string) => state.permissions.includes(key);
  const items: NavItem[] = [];

  if (state.kind === "admin") {
    items.push({ href: "/admin", label: "Overview", icon: "overview", exact: true });
    if (can("teacher_approvals")) items.push({ href: "/admin/teachers", label: "Users", icon: "users" });
    if (can("courses")) items.push({ href: "/courses", label: "Courses", icon: "courses" });
    if (can("role_management")) items.push({ href: "/admin/roles", label: "Roles", icon: "roles" });
  } else {
    items.push({ href: "/home", label: "Home", icon: "home", exact: true });
    if (can("instructor_dashboard")) items.push({ href: "/instructor", label: "Dashboard", icon: "dashboard" });
    if (can("courses")) items.push({ href: "/courses", label: "Courses", icon: "courses" });
  }

  return (
    <AppSidebar
      items={items}
      groupLabel={state.kind === "admin" ? "Admin" : "Menu"}
      userName={state.profile.full_name}
      roleLabel={state.profile.role_label}
    />
  );
}
