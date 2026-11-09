import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeftIcon } from "lucide-react";
import { ActivityForm } from "@/components/courses/activity-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { getSection } from "@/lib/activities";

export const metadata: Metadata = { title: "New activity | WeCheck" };

export default function NewActivityPage({ params }: PageProps<"/courses/[id]/sections/[sectionId]/activities/new">) {
  return (
    <Suspense fallback={<div className="h-64 w-full animate-pulse bg-muted" role="status" aria-label="Loading" />}>
      <Content params={params} />
    </Suspense>
  );
}

async function Content({ params }: { params: PageProps<"/courses/[id]/sections/[sectionId]/activities/new">["params"] }) {
  const { id, sectionId } = await params;
  const section = await getSection(id, sectionId);
  if (section === null) notFound();
  if ("error" in section) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>Couldn&apos;t load this section. Reload the page to try again.</AlertDescription>
      </Alert>
    );
  }
  return (
    <div className="grid gap-6">
      <Link href={`/courses/${id}/sections/${sectionId}`} className={buttonVariants({ variant: "ghost", size: "sm" }) + " w-fit"}>
        <ArrowLeftIcon data-icon="inline-start" /> Section {section.name}
      </Link>
      <h1 className="text-xl font-semibold">New activity · {section.course.name} · {section.name}</h1>
      {section.canEditActivities ? (
        <ActivityForm courseId={id} sectionId={sectionId} />
      ) : (
        <p className="text-sm text-muted-foreground">Your role doesn&apos;t have access to activities.</p>
      )}
    </div>
  );
}
