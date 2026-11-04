import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

// Static chrome only. Authorization happens in each page (requireAdmin) and in
// the server action, never here.
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <TooltipProvider>
      <SidebarProvider>
        <AdminSidebar />
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
