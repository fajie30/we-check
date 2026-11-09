import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeftIcon } from "lucide-react";
import { ActivityManager } from "@/components/courses/activity-manager";
import { GradesTab } from "@/components/courses/grades-tab";
import { StudentsTab } from "@/components/courses/students-tab";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { buttonVariants } from "@/components/ui/button";
import { getSection } from "@/lib/activities";
import { getSectionGrades } from "@/lib/grades";

export const metadata: Metadata = { title: "Section | WeCheck" };

export default function SectionPage({ params }: PageProps<"/courses/[id]/sections/[sectionId]">) {
  return (
    <Suspense
      fallback={
        <div className="grid gap-3" role="status" aria-label="Loading section">
          <div className="h-10 w-1/2 animate-pulse bg-muted" />
          <div className="h-32 w-full animate-pulse bg-muted" />
        </div>
      }
    >
      <SectionContent params={params} />
    </Suspense>
  );
}

async function SectionContent({ params }: { params: PageProps<"/courses/[id]/sections/[sectionId]">["params"] }) {
  const { id, sectionId } = await params;
  const [section, grades] = await Promise.all([getSection(id, sectionId), getSectionGrades(sectionId)]);
  if (section === null || grades === null) notFound();
  if ("error" in grades) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>Couldn&apos;t load this section. Reload the page to try again.</AlertDescription>
      </Alert>
    );
  }
  if ("error" in section) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>Couldn&apos;t load this section. Reload the page to try again.</AlertDescription>
      </Alert>
    );
  }
  return (
    <div className="grid gap-6">
      <Link href={`/courses/${section.course.id}`} className={buttonVariants({ variant: "ghost", size: "sm" }) + " w-fit"}>
        <ArrowLeftIcon data-icon="inline-start" /> {section.course.name}
      </Link>
      <h1 className="text-xl font-semibold">
        {section.course.name} · Section {section.name}
      </h1>
      <Tabs defaultValue="activities">
        <TabsList aria-label="Section">
          <TabsTrigger value="activities">Activities ({section.activities.length})</TabsTrigger>
          <TabsTrigger value="students">Students ({section.students.length})</TabsTrigger>
          <TabsTrigger value="grades">Grades</TabsTrigger>
        </TabsList>
        <TabsContent value="activities" className="pt-2">
          {section.canEditActivities ? (
            <ActivityManager
              courseId={section.course.id}
              sectionId={section.id}
              sectionName={section.name}
              activities={section.activities}
              reusable={section.reusable}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Your role doesn&apos;t have access to activities.</p>
          )}
        </TabsContent>
        <TabsContent value="students" className="pt-2">
          <StudentsTab sectionId={section.id} sectionName={section.name} students={section.students} />
        </TabsContent>
        <TabsContent value="grades" className="pt-2">
          <GradesTab data={grades} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
