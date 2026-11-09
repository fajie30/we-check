"use client";

import { useState, useTransition } from "react";
import { CheckIcon, ExternalLinkIcon, PencilIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { clearCheck, saveCheck, setLink } from "@/app/(app)/courses/[id]/sections/submission-actions";
import type { ActivityRow } from "@/lib/activities";
import type { StudentCheckRow } from "@/lib/activity-page";
import { LinkSchema, MAX_REMARKS, computeCheck } from "@/lib/submissions-schema";

/** One student: their Google Drive link, the rubric (or total score) and a short comment. */
export function CheckSheet({
  activity,
  max,
  student,
  onClose,
}: {
  activity: ActivityRow;
  max: number;
  student: StudentCheckRow;
  onClose: () => void;
}) {
  const [link, setLinkDraft] = useState(student.link ?? "");
  const [editingLink, setEditingLink] = useState(false);
  const [picks, setPicks] = useState<Record<string, string>>(
    Object.fromEntries((student.selections ?? []).map((s) => [s.criterionId, s.levelLabel])),
  );
  const [score, setScore] = useState(student.checked && !activity.rubric ? String(student.score) : "");
  const [remarks, setRemarks] = useState(student.remarks ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const rubric = activity.rubric;
  const live = computeCheck(
    { rubric, total_score: activity.total_score },
    { picks, score: score.trim() === "" ? undefined : Number(score) },
  );
  const total = live.ok ? live.total : 0;
  const filled = rubric ? rubric.criteria.filter((c) => picks[c.id] !== undefined).length : 0;

  function run(action: () => Promise<{ ok: true } | { ok: false; message: string }>, success: string, done?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (res.ok) {
        toast.success(success);
        done?.();
      } else setError(res.message);
    });
  }

  function saveLink() {
    const v = link.trim();
    if (v !== "") {
      const parsed = LinkSchema.safeParse(v);
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? "That isn't a valid link.");
        return;
      }
    }
    run(() => setLink({ activityId: activity.id, studentId: student.id, link: v }), "Link saved", () => setEditingLink(false));
  }

  function save() {
    if (!live.ok) {
      setError(live.message);
      return;
    }
    run(
      () =>
        saveCheck({
          activityId: activity.id,
          studentId: student.id,
          picks: rubric ? picks : undefined,
          score: rubric ? undefined : Number(score),
          remarks,
        }),
      "Check saved",
      onClose,
    );
  }

  return (
    <Sheet open onOpenChange={(o) => !o && !pending && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>{student.full_name}</SheetTitle>
          <SheetDescription>
            ID {student.id_number} · {student.checked ? "Checked" : "Not checked yet"} · {activity.title}
          </SheetDescription>
        </SheetHeader>

        <div className="grid gap-6 p-4">
          <section aria-labelledby="cs-link" className="grid gap-2">
            <h3 id="cs-link" className="text-xs font-semibold tracking-widest uppercase">Student&apos;s work</h3>
            {student.link && !editingLink ? (
              <div className="flex flex-wrap items-center justify-between gap-2 border border-border p-3">
                <a
                  href={student.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-w-0 items-center gap-1.5 text-sm underline underline-offset-4"
                >
                  <ExternalLinkIcon className="size-4 shrink-0" />
                  <span className="truncate">{student.link}</span>
                </a>
                <span className="flex gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => {
                      setLinkDraft(student.link ?? "");
                      setError(null);
                      setEditingLink(true);
                    }}
                  >
                    <PencilIcon data-icon="inline-start" /> Edit
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => run(() => setLink({ activityId: activity.id, studentId: student.id, link: "" }), "Link removed")}
                  >
                    Remove
                  </Button>
                </span>
              </div>
            ) : (
              <div className="grid gap-2">
                {!student.link ? <p className="text-sm text-muted-foreground">No link attached yet.</p> : null}
                <div className="flex flex-wrap items-end gap-2">
                  <div className="grid min-w-0 flex-1 gap-1.5">
                    <Label htmlFor="cs-link-input">Google Drive link</Label>
                    <Input
                      id="cs-link-input"
                      type="url"
                      inputMode="url"
                      value={link}
                      onChange={(e) => setLinkDraft(e.target.value)}
                      placeholder="https://drive.google.com/file/d/..."
                      maxLength={500}
                      autoFocus={editingLink}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={saveLink}
                    disabled={pending || link.trim() === "" || link.trim() === (student.link ?? "")}
                  >
                    {student.link ? "Save link" : "Attach link"}
                  </Button>
                  {editingLink ? (
                    <Button type="button" variant="ghost" disabled={pending} onClick={() => { setEditingLink(false); setError(null); }}>
                      Cancel
                    </Button>
                  ) : null}
                </div>
              </div>
            )}
            <p className="text-xs text-muted-foreground">The work opens in Google Drive in a new tab. Nothing is stored here.</p>
          </section>

          <section aria-labelledby="cs-score" className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="cs-score" className="text-xs font-semibold tracking-widest uppercase">
                {rubric ? `Rubric · ${filled} of ${rubric.criteria.length} filled` : "Score"}
              </h3>
              <p className="text-sm">
                Total <strong>{total}</strong> / {max}
              </p>
            </div>

            {rubric ? (
              rubric.criteria.map((c) => {
                const picked = picks[c.id];
                return (
                  <div key={c.id} className="grid gap-2 border border-border p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-medium">{c.name}</p>
                      <span className="text-xs text-muted-foreground">{picked === undefined ? "Not yet" : `Picked: ${picked}`}</span>
                    </div>
                    {c.description ? <p className="text-xs text-muted-foreground">{c.description}</p> : null}
                    <div className="flex gap-2 overflow-x-auto pb-1" role="radiogroup" aria-label={`Level for ${c.name}`}>
                      {c.levels.map((l) => {
                        const on = picked === l.label;
                        return (
                          <button
                            key={l.label}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            onClick={() =>
                              setPicks((p) => {
                                const next = { ...p };
                                if (on) delete next[c.id];
                                else next[c.id] = l.label;
                                return next;
                              })
                            }
                            className={`w-44 shrink-0 border p-2 text-left text-xs ${on ? "border-foreground bg-muted" : "border-dashed border-border hover:bg-muted"}`}
                          >
                            <span className="flex items-center justify-between gap-1 font-medium">
                              {l.label}
                              <span className="font-normal text-muted-foreground">{l.points}</span>
                              {on ? <CheckIcon className="size-3.5" /> : null}
                            </span>
                            {l.description ? <span className="mt-1 block text-muted-foreground">{l.description}</span> : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="grid max-w-xs gap-1.5">
                <Label htmlFor="cs-score-input">Score (0 to {max})</Label>
                <Input
                  id="cs-score-input"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={max}
                  step="any"
                  value={score}
                  onChange={(e) => setScore(e.target.value)}
                />
              </div>
            )}
            {rubric ? <p className="text-xs text-muted-foreground">A criterion with no level picked counts 0. Click a picked level again to unpick it.</p> : null}
          </section>

          <section aria-labelledby="cs-remarks" className="grid gap-1.5">
            <Label htmlFor="cs-remarks-input" id="cs-remarks">Comment (optional)</Label>
            <Textarea
              id="cs-remarks-input"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              maxLength={MAX_REMARKS}
              rows={3}
              placeholder="A short note for this student"
            />
          </section>

          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </div>

        <SheetFooter className="flex-row flex-wrap justify-between gap-2 border-t border-border">
          <div>
            {student.checked ? (
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => run(() => clearCheck({ activityId: activity.id, studentId: student.id }), "Check cleared", onClose)}
              >
                Clear check
              </Button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Close</Button>
            <Button type="button" onClick={save} disabled={pending}>{pending ? "Saving..." : student.checked ? "Update check" : "Save check"}</Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
