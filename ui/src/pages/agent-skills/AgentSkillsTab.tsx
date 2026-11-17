import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Agent, SpaceSkillListItem } from "@outpost/shared";
import { AlertCircle, BookOpen, CheckCircle2, Loader2, Search } from "lucide-react";
import { agentsApi } from "@/api/agents";
import { describeError } from "@/api/errors";
import { spaceSkillsApi } from "@/api/spaceSkills";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { queryKeys } from "@/lib/queryKeys";
import { Link } from "@/lib/router";

function isCoreSkill(skill: Pick<SpaceSkillListItem, "sourceLabel">) {
  return skill.sourceLabel === "Outpost bundled";
}

function SkillRow({
  skill,
  checked,
  disabled,
  automatic = false,
  onChange,
}: {
  skill: Pick<SpaceSkillListItem, "key" | "name" | "description">;
  checked: boolean;
  disabled: boolean;
  automatic?: boolean;
  onChange?: (checked: boolean) => void;
}) {
  return (
    <div className="flex min-h-14 items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <BookOpen className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{skill.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {automatic ? "Core skill selected automatically when needed." : skill.description || skill.key}
        </p>
      </div>
      {automatic ? (
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden="true" />
          Available
        </span>
      ) : (
        <ToggleSwitch
          checked={checked}
          disabled={disabled}
          onCheckedChange={(next) => onChange?.(next)}
          aria-label={`${checked ? "Disable" : "Enable"} ${skill.name}`}
        />
      )}
    </div>
  );
}

export function AgentSkillsTab({ agent, spaceId }: { agent: Agent; spaceId: string }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const skillsQuery = useQuery({
    queryKey: queryKeys.spaceSkills.list(spaceId),
    queryFn: () => spaceSkillsApi.list(spaceId),
  });
  const snapshotQuery = useQuery({
    queryKey: queryKeys.agents.skills(agent.id),
    queryFn: () => agentsApi.skills(agent.id, spaceId),
  });
  const skills = skillsQuery.data ?? [];
  const snapshot = snapshotQuery.data;
  const desiredSkills = snapshot?.desiredSkills ?? [];
  const desiredSet = useMemo(() => new Set(desiredSkills), [desiredSkills]);
  const libraryKeys = useMemo(() => new Set(skills.map((skill) => skill.key)), [skills]);
  const needle = search.trim().toLowerCase();
  const visibleSkills = useMemo(() => {
    if (!needle) return skills;
    return skills.filter((skill) => [skill.name, skill.description, skill.key]
      .filter(Boolean)
      .some((value) => value!.toLowerCase().includes(needle)));
  }, [needle, skills]);
  const coreSkills = visibleSkills.filter(isCoreSkill);
  const additionalSkills = visibleSkills.filter((skill) => !isCoreSkill(skill));
  const staleKeys = desiredSkills.filter((key) => !libraryKeys.has(key));

  const syncSkills = useMutation({
    mutationFn: (next: string[]) => agentsApi.syncSkills(agent.id, next, "replace", spaceId),
    onSuccess: async (nextSnapshot) => {
      queryClient.setQueryData(queryKeys.agents.skills(agent.id), nextSnapshot);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.agents.detail(agent.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.spaceSkills.list(spaceId) }),
      ]);
    },
  });

  const setEnabled = (key: string, enabled: boolean) => {
    const next = new Set(desiredSkills);
    if (enabled) next.add(key);
    else next.delete(key);
    syncSkills.mutate([...next]);
  };

  if (skillsQuery.isLoading || snapshotQuery.isLoading) {
    return <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading skills…</p>;
  }

  if (skillsQuery.isError || snapshotQuery.isError) {
    const error = skillsQuery.error ?? snapshotQuery.error;
    return <p role="alert" className="text-sm text-destructive">{describeError(error).body}</p>;
  }

  const assignmentUnsupported = !snapshot?.supported || snapshot.mode === "unsupported";
  const assignmentDisabled = assignmentUnsupported || syncSkills.isPending;

  return (
    <div className="max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            Core skills are automatic. Enable additional skills only when this agent needs them.
          </p>
        </div>
        <Button asChild variant="outline" size="sm"><Link to="/skills">Manage library</Link></Button>
      </div>

      {assignmentUnsupported ? (
        <div className="flex gap-2 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-400/40 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          This harness does not support managed skill assignment.
        </div>
      ) : null}
      {syncSkills.isError ? <p role="alert" className="text-sm text-destructive">{describeError(syncSkills.error).body}</p> : null}
      {snapshot?.warnings.map((warning) => <p key={warning} className="text-sm text-amber-700 dark:text-amber-300">{warning}</p>)}

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search skills" aria-label="Search skills" className="pl-9" />
      </div>

      {coreSkills.length > 0 ? (
        <section>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Core skills</h3>
          <div className="overflow-hidden rounded-md border border-border">
            {coreSkills.map((skill) => <SkillRow key={skill.key} skill={skill} checked automatic disabled />)}
          </div>
        </section>
      ) : null}

      <section>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Additional skills</h3>
        {additionalSkills.length > 0 ? (
          <div className="overflow-hidden rounded-md border border-border">
            {additionalSkills.map((skill) => (
              <SkillRow
                key={skill.key}
                skill={skill}
                checked={desiredSet.has(skill.key)}
                disabled={assignmentDisabled}
                onChange={(checked) => setEnabled(skill.key, checked)}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            {needle ? "No skills match your search." : "No additional skills are installed in this Space."}
          </div>
        )}
      </section>

      {staleKeys.length > 0 ? (
        <section>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Unavailable assignments</h3>
          <div className="overflow-hidden rounded-md border border-border">
            {staleKeys.map((key) => (
              <SkillRow
                key={key}
                skill={{ key, name: key, description: "This skill is no longer installed in the Space." }}
                checked
                disabled={assignmentDisabled}
                onChange={(checked) => setEnabled(key, checked)}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
