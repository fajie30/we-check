import { ExternalLinkIcon } from "lucide-react";
import type { ActivityRow } from "@/lib/activities";
import { criterionMax, rubricTotal } from "@/lib/activity-schema";

/** Read-only summary of an activity: details, file link and scoring (total or full rubric). */
export function ActivityOverview({ activity }: { activity: ActivityRow }) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <h3 className="text-base font-semibold">{activity.title}</h3>
        <p className="text-sm whitespace-pre-line text-muted-foreground">{activity.description}</p>
        {activity.file_url ? (
          <a
            href={activity.file_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-fit items-center gap-1 text-xs underline-offset-4 hover:underline"
          >
            <ExternalLinkIcon className="size-3" /> Open file
          </a>
        ) : null}
      </div>

      {activity.rubric ? (
        <div className="grid gap-3">
          <p className="text-xs font-semibold tracking-widest uppercase">
            Rubric · {rubricTotal(activity.rubric)} pts
          </p>
          {activity.rubric.criteria.map((c) => (
            <div key={c.id} className="grid gap-2 border border-border p-3">
              <div>
                <p className="text-sm font-medium">
                  {c.name} <span className="font-normal text-muted-foreground">· max {criterionMax(c)}</span>
                </p>
                {c.description ? <p className="text-xs text-muted-foreground">{c.description}</p> : null}
              </div>
              <ul className="flex gap-2 overflow-x-auto pb-1">
                {c.levels.map((l) => (
                  <li key={l.label} className="w-44 shrink-0 border border-dashed border-border p-2 text-xs">
                    <p className="font-medium">
                      {l.label} <span className="font-normal text-muted-foreground">· {l.points}</span>
                    </p>
                    {l.description ? <p className="text-muted-foreground">{l.description}</p> : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs font-semibold tracking-widest uppercase">Total score · {activity.total_score ?? 0} pts</p>
      )}
    </div>
  );
}
