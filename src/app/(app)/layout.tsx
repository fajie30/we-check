import { Suspense, type ReactNode } from "react";
import { SidebarLoader } from "@/components/app/sidebar-loader";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

// One shell for everyone who uses the app (admin and every approved role).
// Chrome only: each page still checks access on the server.
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider>
      <SidebarProvider>
        <Suspense fallback={<div className="hidden w-64 shrink-0 bg-sidebar md:block" aria-hidden />}>
          <SidebarLoader />
        </Suspense>
        <SidebarInset>
          {/* Only the sidebar toggle lives up here; navigation is in the sidebar. */}
          <div className="flex h-12 items-center px-3">
            <SidebarTrigger aria-label="Toggle sidebar" />
          </div>
          <div className="mx-auto w-full max-w-5xl flex-1 px-4 pb-8">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
