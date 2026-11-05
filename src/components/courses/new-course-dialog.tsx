"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { PlusIcon } from "lucide-react";
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
import { createCourse } from "@/app/(app)/courses/actions";

export function NewCourseDialog({ canCreateSections }: { canCreateSections: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sections, setSections] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function close() {
    if (pending) return;
    setOpen(false);
    setName("");
    setDescription("");
    setSections("");
    setError(null);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createCourse({ name, description, sections });
      if (res.ok) {
        toast.success(`${name.trim()} created`);
        setOpen(false);
        router.push(`/courses/${res.id}`);
      } else {
        setError(res.message);
      }
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <PlusIcon data-icon="inline-start" /> New course
      </Button>
      <Dialog open={open} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          <form onSubmit={submit} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>New course</DialogTitle>
              <DialogDescription>You can add, rename and remove sections at any time.</DialogDescription>
            </DialogHeader>

            <div className="grid gap-1.5">
              <Label htmlFor="nc-name">Course name</Label>
              <Input id="nc-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required placeholder="English" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="nc-desc">Description (optional)</Label>
              <Textarea id="nc-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
            </div>
            {canCreateSections ? (
              <div className="grid gap-1.5">
                <Label htmlFor="nc-sections">Sections (optional)</Label>
                <Textarea
                  id="nc-sections"
                  value={sections}
                  onChange={(e) => setSections(e.target.value)}
                  placeholder="A, B, C, D"
                />
                <p className="text-xs text-muted-foreground">Separate with commas or new lines.</p>
              </div>
            ) : null}

            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close} disabled={pending}>Cancel</Button>
              <Button type="submit" disabled={pending}>{pending ? "Creating..." : "Create course"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
