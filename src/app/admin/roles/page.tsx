import type { Metadata } from "next";
import { Suspense } from "react";
import { RoleMatrix } from "@/components/admin/role-matrix";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { getMatrix } from "@/lib/admin/roles";

export const metadata: Metadata = { title: "Roles | Admin | WeCheck" };

export default function RolesPage() {
  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="text-xl font-semibold">Roles</h1>
        <p className="text-sm text-muted-foreground">
          Choose which modules each role can use. Changes apply the next time a user loads a page.
        </p>
      </div>
      <Suspense
        fallback={
          <div className="grid gap-3" role="status" aria-label="Loading roles">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-14 w-full animate-pulse bg-muted" />
            ))}
          </div>
        }
      >
        <Matrix />
      </Suspense>
    </div>
  );
}

async function Matrix() {
  const result = await getMatrix();
  if ("error" in result) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>Couldn&apos;t load roles. Reload the page to try again.</AlertDescription>
      </Alert>
    );
  }
  return <RoleMatrix permissions={result.permissions} grants={result.grants} />;
}
