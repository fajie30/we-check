import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeftIcon, LockIcon, PencilIcon } from "lucide-react";
import { ActivityOverview } from "@/components/courses/activity-overview";
import { ActivityStudents } from "@/components/courses/activity-students";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { getActivityPage } from "@/lib/activity-page";

export const metadata: Metadata = { title: "Activity | WeCheck" };

type Props = PageProps<"/courses/[id]/sections/[sectionId]/activities/[activityId]">;

export default function ActivityPage({ params }: Props) {
  return (
    <Suspense
      fallback={
        <div className="grid gap-3" role="status" aria-label="Loading activity">
          <div className="h-10 w-1/2 animate-pulse bg-muted" />
          <div className="h-48 w-full animate-pulse bg-muted" />
        </div>
      }
    >
      <Content params={params} />
    </Suspense>
  );
}

async function Content({ params }: { params: Props["params"] }) {
  const { id, sectionId, activityId } = await params;
  const page = await getActivityPage(id, sectionId, activityId);
  if (page === null) notFound();
  if ("error" in page) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>Couldn&apos;t load this activity. Reload the page to try again.</AlertDescription>
      </Alert>
    );
  }
  const locked = page.checkedCount > 0;
  const base = `/courses/${id}/sections/${sectionId}`;

  return (
    <div className="grid gap-6">
      <Link href={base} className={buttonVariants({ variant: "ghost", size: "sm" }) + " w-fit"}>
        <ArrowLeftIcon data-icon="inline-start" /> Section {page.section.name}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-xl font-semibold">{page.activity.title}</h1>
          <p className="text-sm text-muted-foreground">
            {page.course.name} · Section {page.section.name} · {page.checkedCount} of {page.students.length} checked
          </p>
        </div>
        {locked ? (
          <span className={buttonVariants({ variant: "outline" }) + " pointer-events-none opacity-60"} aria-disabled="true">
            <LockIcon data-icon="inline-start" /> Locked: students checked
          </span>
        ) : (
          <Link href={`${base}/activities/${activityId}/edit`} className={buttonVariants({ variant: "outline" })}>
            <PencilIcon data-icon="inline-start" /> Edit
          </Link>
        )}
      </div>

      <details className="border border-border p-4">
        <summary className="cursor-pointer text-sm font-medium">Activity details and rubric</summary>
        <div className="pt-4">
          <ActivityOverview activity={page.activity} />
        </div>
      </details>

      <section aria-labelledby="students-h" className="grid gap-3">
        <h2 id="students-h" className="text-sm font-semibold tracking-widest uppercase">
          Students ({page.students.length})
        </h2>
        <ActivityStudents
          activity={page.activity}
          sectionId={sectionId}
          sectionName={page.section.name}
          max={page.max}
          students={page.students}
        />
      </section>
    </div>
  );
}
