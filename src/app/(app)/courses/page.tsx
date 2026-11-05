import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { NewCourseDialog } from "@/components/courses/new-course-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getCourses, type CourseRow } from "@/lib/courses";

export const metadata: Metadata = { title: "Courses | WeCheck" };

const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });

export default function CoursesPage() {
  return (
    <Suspense
      fallback={
        <div className="grid gap-3" role="status" aria-label="Loading courses">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 w-full animate-pulse bg-muted" />
          ))}
        </div>
      }
    >
      <CourseList />
    </Suspense>
  );
}

async function CourseList() {
  const result = await getCourses();
  if ("error" in result) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>Couldn&apos;t load courses. Reload the page to try again.</AlertDescription>
      </Alert>
    );
  }
  const { courses, isAdmin, canCreateSections } = result;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-xl font-semibold">Courses</h1>
          <p className="text-sm text-muted-foreground">
            {isAdmin ? "All courses across WeCheck." : "Your courses and their sections."}
          </p>
        </div>
        <NewCourseDialog canCreateSections={canCreateSections} />
      </div>

      {courses.length === 0 ? (
        <div className="grid gap-2 border border-dashed border-border p-10 text-center">
          <p className="font-medium">No courses yet</p>
          <p className="text-sm text-muted-foreground">
            Create your first course, for example &ldquo;English&rdquo; with sections A, B, C and D.
          </p>
        </div>
      ) : (
        <>
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Course</TableHead>
                  {isAdmin ? <TableHead>Owner</TableHead> : null}
                  <TableHead>Sections</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {courses.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="whitespace-normal">
                      <CourseLink course={c} />
                    </TableCell>
                    {isAdmin ? <TableCell>{c.owner_name ?? "Unknown"}</TableCell> : null}
                    <TableCell>{c.section_count}</TableCell>
                    <TableCell>{dateFormat.format(new Date(c.created_at))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <ul className="grid gap-3 md:hidden">
            {courses.map((c) => (
              <li key={c.id}>
                <Card>
                  <CardContent className="grid gap-1.5">
                    <CourseLink course={c} />
                    {isAdmin ? <p className="text-xs text-muted-foreground">Owner: {c.owner_name ?? "Unknown"}</p> : null}
                    <p className="text-xs text-muted-foreground">
                      {c.section_count} section{c.section_count === 1 ? "" : "s"} · {dateFormat.format(new Date(c.created_at))}
                    </p>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function CourseLink({ course }: { course: CourseRow }) {
  return (
    <div className="grid gap-0.5">
      <Link href={`/courses/${course.id}`} className="font-medium underline-offset-4 hover:underline">
        {course.name}
      </Link>
      {course.description ? <span className="text-xs text-muted-foreground">{course.description}</span> : null}
    </div>
  );
}
