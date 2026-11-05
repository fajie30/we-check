"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  addSections,
  deleteCourse,
  deleteSection,
  renameSection,
  updateCourse,
  type CourseResult,
} from "@/app/(app)/courses/actions";
import type { CourseDetail } from "@/lib/courses";

export function CourseEditor({ course }: { course: CourseDetail }) {
  const router = useRouter();
  const [name, setName] = useState(course.name);
  const [description, setDescription] = useState(course.description ?? "");
  const [newSections, setNewSections] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = name.trim() !== course.name || description.trim() !== (course.description ?? "");

  function run(action: () => Promise<CourseResult>, success: string, after?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (res.ok) {
        toast.success(success);
        after?.();
      } else {
        setError(res.message);
        toast.error(res.message);
      }
    });
  }

  return (
    <div className="grid gap-8">
      <section aria-labelledby="course-details" className="grid gap-4">
        <h2 id="course-details" className="text-sm font-semibold tracking-widest uppercase">Course</h2>
        {course.owner_name ? (
          <p className="text-xs text-muted-foreground">Owner: {course.owner_name}</p>
        ) : null}
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => updateCourse({ id: course.id, name, description }), "Course saved");
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="c-name">Name</Label>
            <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="c-desc">Description</Label>
            <Textarea id="c-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={pending || !dirty}>{pending ? "Saving..." : "Save changes"}</Button>
            <Button type="button" variant="destructive" onClick={() => setConfirmDelete(true)} disabled={pending}>
              Delete course
            </Button>
          </div>
        </form>
      </section>

      <section aria-labelledby="course-sections" className="grid gap-4">
        <h2 id="course-sections" className="text-sm font-semibold tracking-widest uppercase">
          Sections ({course.sections.length})
        </h2>

        {!course.canEditSections ? (
          <p className="text-sm text-muted-foreground">Your role doesn&apos;t have access to sections.</p>
        ) : (
          <>
            {course.sections.length === 0 ? (
              <p className="border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                No sections yet. Add some below, for example &ldquo;A, B, C, D&rdquo;.
              </p>
            ) : (
              <ul className="grid gap-2">
                {course.sections.map((s) => (
                  <SectionRow key={s.id} id={s.id} name={s.name} />
                ))}
              </ul>
            )}

            <form
              className="grid gap-2 border border-border p-4"
              onSubmit={(e) => {
                e.preventDefault();
                run(
                  () => addSections({ courseId: course.id, names: newSections }),
                  "Sections added",
                  () => setNewSections(""),
                );
              }}
            >
              <Label htmlFor="add-sections">Add sections</Label>
              <Textarea
                id="add-sections"
                value={newSections}
                onChange={(e) => setNewSections(e.target.value)}
                placeholder="A, B, C, D"
              />
              <p className="text-xs text-muted-foreground">Separate with commas or new lines. Up to 50 per course.</p>
              <div>
                <Button type="submit" variant="outline" disabled={pending || newSections.trim() === ""}>
                  <PlusIcon data-icon="inline-start" /> Add
                </Button>
              </div>
            </form>
          </>
        )}

        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      </section>

      <Dialog open={confirmDelete} onOpenChange={(o) => !o && !pending && setConfirmDelete(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {course.name}?</DialogTitle>
            <DialogDescription>
              This also removes its {course.sections.length} section{course.sections.length === 1 ? "" : "s"}. It can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)} disabled={pending}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                run(() => deleteCourse({ id: course.id }), "Course deleted", () => {
                  setConfirmDelete(false);
                  router.push("/courses");
                })
              }
            >
              {pending ? "Deleting..." : "Delete course"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SectionRow({ id, name }: { id: string; name: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<CourseResult>, success: string, done: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (res.ok) {
        toast.success(success);
        done();
      } else {
        setError(res.message);
      }
    });
  }

  return (
    <li className="grid gap-1 border border-border p-3">
      {editing ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => renameSection({ id, name: value }), "Section renamed", () => setEditing(false));
          }}
        >
          <Input
            aria-label={`Rename section ${name}`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={50}
            className="max-w-xs"
            autoFocus
          />
          <Button type="submit" size="sm" disabled={pending}>Save</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => { setEditing(false); setValue(name); setError(null); }} disabled={pending}>
            Cancel
          </Button>
        </form>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">{name}</span>
          <span className="flex gap-1">
            <Button size="icon-sm" variant="ghost" aria-label={`Rename section ${name}`} onClick={() => { setValue(name); setEditing(true); }}>
              <PencilIcon />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label={`Remove section ${name}`} onClick={() => setConfirm(true)}>
              <Trash2Icon />
            </Button>
          </span>
        </div>
      )}
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}

      <Dialog open={confirm} onOpenChange={(o) => !o && !pending && setConfirm(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove section {name}?</DialogTitle>
            <DialogDescription>It can&apos;t be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)} disabled={pending}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => run(() => deleteSection({ id }), "Section removed", () => setConfirm(false))}
            >
              {pending ? "Removing..." : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}
