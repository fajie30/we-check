import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeftIcon } from "lucide-react";
import { CourseEditor } from "@/components/courses/course-editor";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { getCourse } from "@/lib/courses";

export const metadata: Metadata = { title: "Course | WeCheck" };

export default function CoursePage({ params }: PageProps<"/courses/[id]">) {
  return (
    <div className="grid gap-6">
      <Link href="/courses" className={buttonVariants({ variant: "ghost", size: "sm" }) + " w-fit"}>
        <ArrowLeftIcon data-icon="inline-start" /> All courses
      </Link>
      <Suspense
        fallback={
          <div className="grid gap-3" role="status" aria-label="Loading course">
            <div className="h-10 w-1/2 animate-pulse bg-muted" />
            <div className="h-32 w-full animate-pulse bg-muted" />
          </div>
        }
      >
        <CourseContent params={params} />
      </Suspense>
    </div>
  );
}

async function CourseContent({ params }: { params: PageProps<"/courses/[id]">["params"] }) {
  const { id } = await params;
  const course = await getCourse(id);
  // Another teacher's course is invisible (RLS), so it looks exactly like a missing one.
  if (course === null) notFound();
  if ("error" in course) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>Couldn&apos;t load this course. Reload the page to try again.</AlertDescription>
      </Alert>
    );
  }
  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-semibold">{course.name}</h1>
      <CourseEditor key={course.id + course.name} course={course} />
    </div>
  );
}
