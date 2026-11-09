import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeftIcon } from "lucide-react";
import { ActivityForm } from "@/components/courses/activity-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { getActivityPage } from "@/lib/activity-page";

export const metadata: Metadata = { title: "Edit activity | WeCheck" };

type Props = PageProps<"/courses/[id]/sections/[sectionId]/activities/[activityId]/edit">;

export default function EditActivityPage({ params }: Props) {
  return (
    <Suspense fallback={<div className="h-64 w-full animate-pulse bg-muted" role="status" aria-label="Loading" />}>
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
  return (
    <div className="grid gap-6">
      <Link
        href={`/courses/${id}/sections/${sectionId}/activities/${activityId}`}
        className={buttonVariants({ variant: "ghost", size: "sm" }) + " w-fit"}
      >
        <ArrowLeftIcon data-icon="inline-start" /> {page.activity.title}
      </Link>
      <h1 className="text-xl font-semibold">Edit activity · {page.course.name} · {page.section.name}</h1>
      {page.checkedCount > 0 ? (
        <Alert role="note">
          <AlertDescription>
            {page.checkedCount} student{page.checkedCount === 1 ? " is" : "s are"} already checked, so this activity can&apos;t be edited.
            Clear their checks on the activity page to unlock it.
          </AlertDescription>
        </Alert>
      ) : null}
      {/* key: reset the form state if the saved activity changes under us */}
      <ActivityForm
        key={page.activity.id + page.activity.created_at}
        courseId={id}
        sectionId={sectionId}
        sectionName={page.section.name}
        activity={page.activity}
        usedIn={page.usedIn}
        locked={page.checkedCount > 0}
      />
    </div>
  );
}
