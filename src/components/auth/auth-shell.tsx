import type { ReactNode } from "react";

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 px-4 py-10">
      <p className="text-sm font-semibold tracking-widest uppercase">WeCheck</p>
      <div className="w-full max-w-md">{children}</div>
    </main>
  );
}

export function CardSkeleton() {
  return (
    <div
      className="h-72 w-full animate-pulse bg-muted"
      role="status"
      aria-label="Loading"
    />
  );
}
