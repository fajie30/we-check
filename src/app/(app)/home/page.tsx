import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CardSkeleton } from "@/components/auth/auth-shell";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireMember } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Home | WeCheck" };

// Modules that already have a page. Everything else is shown as "Coming soon".
const MODULE_LINKS: Record<string, string> = {
  instructor_dashboard: "/instructor",
  courses: "/courses",
  sections: "/courses", // sections are managed inside a course
};
// System modules are admin-only and never appear here.

type Module = { key: string; label: string; description: string; placeholder: boolean };

export default function HomePage() {
  return (
    <div className="mx-auto w-full max-w-2xl">
      <Suspense fallback={<CardSkeleton />}>
        <HomeContent />
      </Suspense>
    </div>
  );
}

async function HomeContent() {
  // Any approved, verified non-admin user. Which modules show depends on their role.
  const { profile } = await requireMember();
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_modules");
  const modules = (Array.isArray(data) ? (data as Module[]) : []).filter(
    (m) => m.key !== "teacher_approvals" && m.key !== "role_management",
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Welcome, {profile.full_name}</CardTitle>
        <CardDescription>
          Signed in as <strong className="text-foreground">{profile.role_label}</strong>
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {modules.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Your role doesn&apos;t have access to any module yet. Ask your administrator to enable
            access, then reload this page.
          </p>
        ) : (
          <ul className="grid gap-2">
            {modules.map((m) => {
              const href = MODULE_LINKS[m.key];
              return (
                <li
                  key={m.key}
                  className="flex items-center justify-between gap-3 border border-border p-3"
                >
                  <div className="grid gap-0.5">
                    <span className="text-sm font-medium">{m.label}</span>
                    <span className="text-xs text-muted-foreground">{m.description}</span>
                  </div>
                  {href ? (
                    <Link href={href} className={buttonVariants({ size: "sm" })}>
                      Open
                    </Link>
                  ) : (
                    <Badge variant="outline">Coming soon</Badge>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
