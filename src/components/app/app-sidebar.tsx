"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpenIcon,
  GraduationCapIcon,
  HouseIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  ShieldCheckIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { signOut } from "@/lib/auth/actions";

export type NavIcon = "overview" | "users" | "courses" | "roles" | "home" | "dashboard";
export type NavItem = { href: string; label: string; icon: NavIcon; exact?: boolean };

// Icons are passed by name from the server (functions can't cross the server/client boundary).
const ICONS: Record<NavIcon, LucideIcon> = {
  overview: LayoutDashboardIcon,
  users: UsersIcon,
  courses: BookOpenIcon,
  roles: ShieldCheckIcon,
  home: HouseIcon,
  dashboard: GraduationCapIcon,
};

type Props = { items: NavItem[]; groupLabel: string; userName: string; roleLabel: string };

export function AppSidebar({ items, groupLabel, userName, roleLabel }: Props) {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <p className="px-2 py-1.5 text-sm font-semibold tracking-widest uppercase group-data-[collapsible=icon]:hidden">
          WeCheck
        </p>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{groupLabel}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map(({ href, label, icon, exact }) => {
                const Icon = ICONS[icon];
                const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
                return (
                  <SidebarMenuItem key={href}>
                    <SidebarMenuButton
                      isActive={active}
                      tooltip={label}
                      render={<Link href={href} aria-current={active ? "page" : undefined} />}
                    >
                      <Icon />
                      <span>{label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <div className="grid gap-0.5 px-2 py-1 group-data-[collapsible=icon]:hidden">
          <span className="truncate text-sm font-medium">{userName}</span>
          <span className="truncate text-xs text-muted-foreground">{roleLabel}</span>
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <form action={signOut}>
              <SidebarMenuButton type="submit" tooltip="Sign out">
                <LogOutIcon />
                <span>Sign out</span>
              </SidebarMenuButton>
            </form>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
