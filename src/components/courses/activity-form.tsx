"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CopyIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { createActivity, updateActivity } from "@/app/(app)/courses/[id]/sections/actions";
import type { ActivityRow } from "@/lib/activities";
import {
  ActivityInputSchema,
  DEFAULT_TOTAL_SCORE,
  MAX_CRITERIA,
  MAX_LEVELS,
  criterionMax,
  rubricTotal,
} from "@/lib/activity-schema";

type LevelDraft = { key: string; label: string; points: string; description: string };
type CriterionDraft = { key: string; name: string; description: string; levels: LevelDraft[] };

const uid = () => crypto.randomUUID();
const newLevel = (label = "", points = ""): LevelDraft => ({ key: uid(), label, points, description: "" });
const newCriterion = (): CriterionDraft => ({
  key: uid(),
  name: "",
  description: "",
  levels: [newLevel("Very good", ""), newLevel("Good", ""), newLevel("Needs work", "")],
});

/** Copy a criterion (name, description, every level) and place the copy right after it. */
function duplicateAfter(list: CriterionDraft[], key: string): CriterionDraft[] {
  const i = list.findIndex((c) => c.key === key);
  if (i === -1) return list;
  const src = list[i];
  const copy: CriterionDraft = {
    ...src,
    key: uid(),
    name: src.name.trim() === "" ? "" : `${src.name} (copy)`.slice(0, 100),
    levels: src.levels.map((l) => ({ ...l, key: uid() })),
  };
  return [...list.slice(0, i + 1), copy, ...list.slice(i + 1)];
}

const num = (s: string) => (s.trim() === "" ? NaN : Number(s));

function fromRubric(activity: ActivityRow | undefined): CriterionDraft[] {
  if (!activity?.rubric) return [];
  return activity.rubric.criteria.map((c) => ({
    key: c.id,
    name: c.name,
    description: c.description,
    levels: c.levels.map((l) => ({ key: uid(), label: l.label, points: String(l.points), description: l.description })),
  }));
}

export function ActivityForm({
  courseId,
  sectionId,
  sectionName,
  activity,
  usedIn = [],
  locked = false,
}: {
  courseId: string;
  sectionId: string;
  sectionName?: string;
  activity?: ActivityRow;
  usedIn?: { id: string; name: string }[];
  /** Students are already checked: the form is read-only. */
  locked?: boolean;
}) {
  const router = useRouter();
  const back = `/courses/${courseId}/sections/${sectionId}`;
  const [title, setTitle] = useState(activity?.title ?? "");
  const [description, setDescription] = useState(activity?.description ?? "");
  const [fileUrl, setFileUrl] = useState(activity?.file_url ?? "");
  const [mode, setMode] = useState<"total" | "rubric">(activity?.rubric ? "rubric" : "total");
  const [totalScore, setTotalScore] = useState(String(activity?.total_score ?? DEFAULT_TOTAL_SCORE));
  const [criteria, setCriteria] = useState<CriterionDraft[]>(() => {
    const existing = fromRubric(activity);
    return existing.length > 0 ? existing : [newCriterion()];
  });
  const [confirmSwitch, setConfirmSwitch] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const rubricHasContent = criteria.some(
    (c) => c.name.trim() !== "" || c.description.trim() !== "" || c.levels.some((l) => l.points.trim() !== "" || l.description.trim() !== ""),
  );

  function patchCriterion(key: string, patch: Partial<CriterionDraft>) {
    setCriteria((cs) => cs.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  }
  function patchLevel(ck: string, lk: string, patch: Partial<LevelDraft>) {
    setCriteria((cs) =>
      cs.map((c) => (c.key === ck ? { ...c, levels: c.levels.map((l) => (l.key === lk ? { ...l, ...patch } : l)) } : c)),
    );
  }

  const liveRubric = {
    criteria: criteria.map((c) => ({ levels: c.levels.map((l) => ({ points: Number.isFinite(num(l.points)) ? num(l.points) : 0 })) })),
  };

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const candidate = {
      title,
      description,
      fileUrl,
      mode,
      totalScore: mode === "total" ? num(totalScore) : undefined,
      rubric:
        mode === "rubric"
          ? {
              criteria: criteria.map((c) => ({
                id: c.key,
                name: c.name,
                description: c.description,
                levels: c.levels.map((l) => ({ label: l.label, points: num(l.points), description: l.description })),
              })),
            }
          : undefined,
    };
    const parsed = ActivityInputSchema.safeParse(candidate);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "That isn't valid.";
      setError(Number.isNaN(candidate.totalScore) ? "Enter a total score" : msg);
      return;
    }
    startTransition(async () => {
      const res = activity
        ? await updateActivity({ id: activity.id, sectionId, activity: parsed.data })
        : await createActivity({ sectionId, activity: parsed.data });
      if (res.ok) {
        toast.success(
          !activity ? "Activity created" : res.forked ? "Saved as a new activity for this section" : "Activity saved",
        );
        router.push(back);
      } else {
        setError(res.message);
      }
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-8">
      {/* A disabled fieldset makes every field below read-only when students are already checked. */}
      <fieldset disabled={locked} className="contents">
      {activity && usedIn.length > 1 ? (
        <p role="note" className="border border-border bg-muted p-3 text-sm">
          This activity is shared by sections {usedIn.map((s) => s.name).join(", ")}. Saving your changes creates a
          separate copy for section {sectionName ?? "this section"} and leaves the other sections on the original.
        </p>
      ) : null}
      <section aria-labelledby="a-details" className="grid gap-4">
        <h2 id="a-details" className="text-sm font-semibold tracking-widest uppercase">Details</h2>
        <div className="grid gap-1.5">
          <Label htmlFor="a-title">Title</Label>
          <Input id="a-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="a-desc">Description</Label>
          <Textarea id="a-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={10000} rows={8} required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="a-file">Activity PDF: Google Drive link (optional)</Label>
          <Input
            id="a-file"
            type="url"
            inputMode="url"
            value={fileUrl}
            onChange={(e) => setFileUrl(e.target.value)}
            placeholder="https://drive.google.com/file/d/..."
            maxLength={500}
          />
          <p className="text-xs text-muted-foreground">
            Link to the PDF of the problem or activity in Google Drive. Set sharing to &ldquo;Anyone with the link&rdquo; so students can open it.
          </p>
        </div>
      </section>

      <section aria-labelledby="a-scoring" className="grid gap-4">
        <h2 id="a-scoring" className="text-sm font-semibold tracking-widest uppercase">Scoring</h2>
        <Tabs
          value={mode}
          onValueChange={(value) => {
            if (value === mode) return;
            if (value === "total" && rubricHasContent) setConfirmSwitch(true);
            else setMode(value as "total" | "rubric");
          }}
        >
          <TabsList aria-label="Scoring mode">
            <TabsTrigger value="total">Total score only</TabsTrigger>
            <TabsTrigger value="rubric">Rubric</TabsTrigger>
          </TabsList>

          <TabsContent value="total" className="pt-2">
          <div className="grid max-w-xs gap-1.5">
            <Label htmlFor="a-total">Total score</Label>
            <Input
              id="a-total"
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={totalScore}
              onChange={(e) => setTotalScore(e.target.value)}
              required
            />
          </div>
          </TabsContent>

          <TabsContent value="rubric" className="pt-2">
          <div className="grid gap-4">
            <p className="text-sm text-muted-foreground">
              Total: <span className="font-medium text-foreground">{rubricTotal(liveRubric)}</span> points (the highest level of each criterion, added up).
            </p>
            {criteria.map((c, ci) => (
              <fieldset key={c.key} className="grid gap-3 border border-border p-4">
                <legend className="px-1 text-xs font-semibold tracking-widest uppercase">
                  Criterion {ci + 1} · max {criterionMax({ levels: c.levels.map((l) => ({ points: Number.isFinite(num(l.points)) ? num(l.points) : 0 })) })}
                </legend>
                <div className="flex items-end gap-2">
                  <div className="grid flex-1 gap-1.5">
                    <Label htmlFor={`c-name-${c.key}`}>Criterion name</Label>
                    <Input id={`c-name-${c.key}`} value={c.name} onChange={(e) => patchCriterion(c.key, { name: e.target.value })} maxLength={100} />
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`Duplicate criterion ${ci + 1}`}
                    title="Duplicate criterion"
                    disabled={criteria.length >= MAX_CRITERIA}
                    onClick={() => setCriteria((cs) => duplicateAfter(cs, c.key))}
                  >
                    <CopyIcon />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove criterion ${ci + 1}`}
                    disabled={criteria.length === 1}
                    onClick={() => setCriteria((cs) => cs.filter((x) => x.key !== c.key))}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`c-desc-${c.key}`}>Description (optional)</Label>
                  <Textarea id={`c-desc-${c.key}`} value={c.description} onChange={(e) => patchCriterion(c.key, { description: e.target.value })} maxLength={500} rows={2} />
                </div>

                <div className="grid gap-2">
                  <p className="text-xs font-medium">Levels</p>
                  <div className="flex items-stretch gap-3 overflow-x-auto pb-2" tabIndex={0} role="group" aria-label={`Levels of criterion ${ci + 1}`}>
                    {c.levels.map((l, li) => (
                      <div key={l.key} className="grid w-56 shrink-0 content-start gap-2 border border-dashed border-border p-3">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-xs text-muted-foreground">Level {li + 1}</span>
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Remove level ${li + 1} of criterion ${ci + 1}`}
                            disabled={c.levels.length <= 2}
                            onClick={() => patchCriterion(c.key, { levels: c.levels.filter((x) => x.key !== l.key) })}
                          >
                            <Trash2Icon />
                          </Button>
                        </div>
                        <div className="grid gap-1.5">
                          <Label htmlFor={`l-label-${l.key}`}>Name</Label>
                          <Input id={`l-label-${l.key}`} value={l.label} onChange={(e) => patchLevel(c.key, l.key, { label: e.target.value })} maxLength={50} placeholder="Very good" />
                        </div>
                        <div className="grid gap-1.5">
                          <Label htmlFor={`l-pts-${l.key}`}>Score</Label>
                          <Input id={`l-pts-${l.key}`} type="number" inputMode="decimal" min={0} step="any" value={l.points} onChange={(e) => patchLevel(c.key, l.key, { points: e.target.value })} />
                        </div>
                        <Textarea
                          aria-label={`Level ${li + 1} description for criterion ${ci + 1}`}
                          value={l.description}
                          onChange={(e) => patchLevel(c.key, l.key, { description: e.target.value })}
                          maxLength={500}
                          rows={4}
                          placeholder="What does this level look like? (optional)"
                        />
                      </div>
                    ))}
                    <div className="flex shrink-0 items-start">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={c.levels.length >= MAX_LEVELS}
                        onClick={() => patchCriterion(c.key, { levels: [...c.levels, newLevel()] })}
                      >
                        <PlusIcon data-icon="inline-start" /> Add level
                      </Button>
                    </div>
                  </div>
                </div>
              </fieldset>
            ))}
            <div>
              <Button
                type="button"
                variant="outline"
                disabled={criteria.length >= MAX_CRITERIA}
                onClick={() => setCriteria((cs) => [...cs, newCriterion()])}
              >
                <PlusIcon data-icon="inline-start" /> Add criterion
              </Button>
            </div>
          </div>
          </TabsContent>
        </Tabs>
      </section>

      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving..." : activity ? "Save changes" : "Create activity"}</Button>
        <Link href={back} className={buttonVariants({ variant: "outline" })}>Cancel</Link>
      </div>

      </fieldset>

      <Dialog open={confirmSwitch} onOpenChange={setConfirmSwitch}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Switch to total score only?</DialogTitle>
            <DialogDescription>The rubric you built will be discarded when you save.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmSwitch(false)}>Keep rubric</Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setMode("total");
                setCriteria([newCriterion()]);
                setConfirmSwitch(false);
              }}
            >
              Discard rubric
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}
