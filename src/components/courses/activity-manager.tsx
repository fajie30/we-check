"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ArrowLeftIcon, CopyPlusIcon, ExternalLinkIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { ActivityOverview } from "@/components/courses/activity-overview";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { linkActivity, unlinkActivity } from "@/app/(app)/courses/[id]/sections/actions";
import type { ActivityListItem, ActivityRow, ReuseGroup } from "@/lib/activities";
import { rubricTotal } from "@/lib/activity-schema";

const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });

function scoring(a: ActivityRow) {
  if (a.rubric) {
    const n = a.rubric.criteria.length;
    return `Rubric · ${n} criteri${n === 1 ? "on" : "a"} · ${rubricTotal(a.rubric)} pts`;
  }
  return `Total score · ${a.total_score ?? 0} pts`;
}

type Step = "choose" | "reuse" | "overview";

export function ActivityManager({
  courseId,
  sectionId,
  sectionName,
  activities,
  reusable,
}: {
  courseId: string;
  sectionId: string;
  sectionName: string;
  activities: ActivityListItem[];
  reusable: ReuseGroup[];
}) {
  const base = `/courses/${courseId}/sections/${sectionId}/activities`;
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("choose");
  const [selected, setSelected] = useState<ActivityRow | null>(null);
  const [toRemove, setToRemove] = useState<ActivityListItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function openModal() {
    setStep("choose");
    setSelected(null);
    setError(null);
    setOpen(true);
  }

  function run(action: () => Promise<{ ok: true } | { ok: false; message: string }>, success: string, done: () => void) {
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
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-widest uppercase">Activities ({activities.length})</h2>
        <Button onClick={openModal}>
          <PlusIcon data-icon="inline-start" /> New activity
        </Button>
      </div>

      {activities.length === 0 ? (
        <p className="border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No activities yet. Create one, or reuse an activity from another section.
        </p>
      ) : (
        <ul className="grid gap-2">
          {activities.map((a) => (
            <li key={a.id} className="flex items-start justify-between gap-3 border border-border p-3">
              <div className="grid gap-1">
                <Link href={`${base}/${a.id}`} className="w-fit text-sm font-medium underline-offset-4 hover:underline">
                  {a.title}
                </Link>
                <span className="line-clamp-2 text-xs whitespace-pre-line text-muted-foreground">{a.description}</span>
                <span className="text-xs text-muted-foreground">
                  {scoring(a)} · {dateFormat.format(new Date(a.created_at))}
                  {a.section_count > 1 ? ` · Shared with ${a.section_count - 1} other section${a.section_count === 2 ? "" : "s"}` : ""}
                </span>
                {a.file_url ? (
                  <a
                    href={a.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex w-fit items-center gap-1 text-xs underline-offset-4 hover:underline"
                  >
                    <ExternalLinkIcon className="size-3" /> Open file
                  </a>
                ) : null}
              </div>
              <span className="flex gap-1">
                <Link href={`${base}/${a.id}/edit`} className={buttonVariants({ variant: "ghost", size: "icon-sm" })} aria-label={`Edit activity ${a.title}`}>
                  <PencilIcon />
                </Link>
                <Button size="icon-sm" variant="ghost" aria-label={`Remove activity ${a.title} from this section`} onClick={() => { setError(null); setToRemove(a); }}>
                  <Trash2Icon />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* New / reuse modal */}
      <Dialog open={open} onOpenChange={(o) => !o && !pending && setOpen(false)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          {step === "choose" ? (
            <>
              <DialogHeader>
                <DialogTitle>New activity for section {sectionName}</DialogTitle>
                <DialogDescription>Start from scratch, or reuse an activity from this course.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 sm:grid-cols-2">
                <Link href={`${base}/new`} className="grid gap-1 border border-border p-4 hover:bg-muted">
                  <span className="flex items-center gap-2 text-sm font-semibold"><PlusIcon className="size-4" /> Create new</span>
                  <span className="text-xs text-muted-foreground">Write a new activity with its own scoring.</span>
                </Link>
                <button
                  type="button"
                  disabled={reusable.length === 0}
                  onClick={() => setStep("reuse")}
                  className="grid gap-1 border border-border p-4 text-left hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                >
                  <span className="flex items-center gap-2 text-sm font-semibold"><CopyPlusIcon className="size-4" /> Reuse existing</span>
                  <span className="text-xs text-muted-foreground">
                    {reusable.length === 0
                      ? "No other activities in this course yet."
                      : "Pick an activity already made for another section."}
                  </span>
                </button>
              </div>
            </>
          ) : null}

          {step === "reuse" ? (
            <>
              <DialogHeader>
                <DialogTitle>Reuse an activity</DialogTitle>
                <DialogDescription>Grouped by the section it was made for. Activities this section already has are hidden.</DialogDescription>
              </DialogHeader>
              <Accordion defaultValue={reusable[0] ? [reusable[0].sectionId] : []}>
                {reusable.map((g) => (
                  <AccordionItem key={g.sectionId} value={g.sectionId}>
                    <AccordionTrigger>
                      Section {g.sectionName} ({g.activities.length})
                    </AccordionTrigger>
                    <AccordionContent>
                      <ul className="grid gap-2 pb-3">
                        {g.activities.map((a) => (
                          <li key={a.id}>
                            <button
                              type="button"
                              onClick={() => { setSelected(a); setStep("overview"); }}
                              className="grid w-full gap-0.5 border border-border p-3 text-left hover:bg-muted"
                            >
                              <span className="text-sm font-medium">{a.title}</span>
                              <span className="text-xs text-muted-foreground">{scoring(a)}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
              <DialogFooter>
                <Button variant="outline" onClick={() => setStep("choose")}><ArrowLeftIcon data-icon="inline-start" /> Back</Button>
              </DialogFooter>
            </>
          ) : null}

          {step === "overview" && selected ? (
            <>
              <DialogHeader>
                <DialogTitle>Add to section {sectionName}?</DialogTitle>
                <DialogDescription>
                  This is the same activity, not a copy. Editing it from another section later makes a separate copy for that section.
                </DialogDescription>
              </DialogHeader>
              <ActivityOverview activity={selected} />
              {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
              <DialogFooter>
                <Button variant="outline" onClick={() => setStep("reuse")} disabled={pending}>
                  <ArrowLeftIcon data-icon="inline-start" /> Back
                </Button>
                <Button
                  disabled={pending}
                  onClick={() =>
                    run(() => linkActivity({ activityId: selected.id, sectionId }), "Activity added to section", () => setOpen(false))
                  }
                >
                  {pending ? "Adding..." : `Add to section ${sectionName}`}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Remove from this section */}
      <Dialog open={toRemove !== null} onOpenChange={(o) => !o && !pending && setToRemove(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {toRemove?.title} from section {sectionName}?</DialogTitle>
            <DialogDescription>
              {toRemove && toRemove.section_count > 1
                ? `It stays in the ${toRemove.section_count - 1} other section${toRemove.section_count === 2 ? "" : "s"} that use it.`
                : "No other section uses it, so the activity will be deleted. It can't be undone."}
            </DialogDescription>
          </DialogHeader>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setToRemove(null)} disabled={pending}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => {
                if (!toRemove) return;
                run(() => unlinkActivity({ activityId: toRemove.id, sectionId }), "Activity removed", () => setToRemove(null));
              }}
            >
              {pending ? "Removing..." : toRemove && toRemove.section_count > 1 ? "Remove" : "Delete activity"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
