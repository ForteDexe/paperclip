import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SpaceSkillFileInventoryEntry } from "@outpost/shared";
import { BookOpen, ChevronLeft, FileCode2, FileText, Plus, Search, Trash2, Users } from "lucide-react";
import { spaceSkillsApi } from "@/api/spaceSkills";
import { describeError } from "@/api/errors";
import { EmptyState } from "@/components/EmptyState";
import { MarkdownBody } from "@/components/MarkdownBody";
import { PageSkeleton } from "@/components/PageSkeleton";
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
import { useSpace } from "@/context/SpaceContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useToastActions } from "@/context/ToastContext";
import {
  parseSkillRoute,
  resolveSkillRouteToken,
  skillRoute,
} from "@/lib/space-skill-routes";
import { queryKeys } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import { useNavigate, useParams } from "@/lib/router";

function stripFrontmatter(markdown: string) {
  const normalized = markdown.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return normalized.trim();
  const closing = normalized.indexOf("\n---\n", 4);
  return closing < 0 ? normalized.trim() : normalized.slice(closing + 5).trim();
}

function fileIcon(kind: SpaceSkillFileInventoryEntry["kind"]) {
  return kind === "script" || kind === "reference" ? FileCode2 : FileText;
}

function isCoreSkill(skill: { sourceLabel: string | null }) {
  return skill.sourceLabel === "Outpost bundled";
}

export function InstalledSkills() {
  const { "*": routePath } = useParams<{ "*": string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { selectedSpaceId } = useSpace();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToastActions();
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [source, setSource] = useState("");
  const [removeOpen, setRemoveOpen] = useState(false);

  const spaceId = selectedSpaceId ?? "";
  const parsedRoute = useMemo(() => parseSkillRoute(routePath), [routePath]);
  const skillsQuery = useQuery({
    queryKey: queryKeys.spaceSkills.list(spaceId),
    queryFn: () => spaceSkillsApi.list(spaceId),
    enabled: Boolean(spaceId),
  });
  const skills = skillsQuery.data ?? [];
  const routeResolution = useMemo(
    () => resolveSkillRouteToken(parsedRoute.skillToken, skills),
    [parsedRoute.skillToken, skills],
  );
  const selectedSkill = routeResolution.skill;
  const selectedPath = parsedRoute.filePath;

  useEffect(() => {
    if (!routeResolution.skill || !routeResolution.shouldRedirect) return;
    navigate(skillRoute(routeResolution.skill, skills, selectedPath), { replace: true });
  }, [navigate, routeResolution, selectedPath, skills]);

  const detailQuery = useQuery({
    queryKey: queryKeys.spaceSkills.detail(spaceId, selectedSkill?.id ?? ""),
    queryFn: () => spaceSkillsApi.detail(spaceId, selectedSkill!.id),
    enabled: Boolean(spaceId && selectedSkill),
  });
  const detail = detailQuery.data;
  const fileQuery = useQuery({
    queryKey: queryKeys.spaceSkills.file(spaceId, selectedSkill?.id ?? "", selectedPath),
    queryFn: () => spaceSkillsApi.file(spaceId, selectedSkill!.id, selectedPath),
    enabled: Boolean(spaceId && selectedSkill),
  });

  useEffect(() => {
    setBreadcrumbs([
      { label: "Skills", href: "/skills" },
      ...(detail ? [{ label: detail.name }] : []),
    ]);
  }, [detail, setBreadcrumbs]);

  const importSkill = useMutation({
    mutationFn: (value: string) => spaceSkillsApi.importFromSource(spaceId, value),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.spaceSkills.list(spaceId) });
      setAddOpen(false);
      setSource("");
      const imported = result.imported[0];
      if (imported) navigate(skillRoute(imported));
      pushToast({
        tone: "success",
        title: "Skill added",
        body: result.imported.length === 1 ? result.imported[0]!.name : `${result.imported.length} skills added.`,
      });
    },
    onError: (error) => pushToast({
      tone: "error",
      title: "Could not add skill",
      body: describeError(error).body,
    }),
  });

  const removeSkill = useMutation({
    mutationFn: () => spaceSkillsApi.delete(spaceId, selectedSkill!.id),
    onSuccess: async (removed) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.spaceSkills.list(spaceId) });
      setRemoveOpen(false);
      navigate("/skills", { replace: true });
      pushToast({ tone: "success", title: "Skill removed", body: removed.name });
    },
    onError: (error) => pushToast({
      tone: "error",
      title: "Could not remove skill",
      body: describeError(error).body,
    }),
  });

  const filteredSkills = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return skills;
    return skills.filter((skill) =>
      [skill.name, skill.description, skill.key]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(needle)),
    );
  }, [search, skills]);

  if (!selectedSpaceId) {
    return <EmptyState icon={BookOpen} message="Select a Space to view its skills." />;
  }

  if (parsedRoute.skillToken) {
    if (skillsQuery.isLoading || detailQuery.isLoading || fileQuery.isLoading) {
      return <PageSkeleton variant="detail" />;
    }
    if (!selectedSkill || !detail) {
      return <EmptyState icon={BookOpen} message="Skill not found." />;
    }

    const file = fileQuery.data;
    const body = file?.markdown ? stripFrontmatter(file.content) : file?.content ?? "";
    const coreSkill = isCoreSkill(detail);
    return (
      <div className="min-h-(--sz-calc-30)">
        <header className="border-b border-border px-5 py-4">
          <Button variant="ghost" size="sm" className="mb-2 -ml-2" onClick={() => navigate("/skills")}>
            <ChevronLeft className="h-4 w-4" />
            Installed skills
          </Button>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold">{detail.name}</h1>
              {detail.description ? <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{detail.description}</p> : null}
            </div>
            <Button variant="outline" size="sm" onClick={() => setRemoveOpen(true)} disabled={removeSkill.isPending}>
              <Trash2 className="h-4 w-4" />
              Remove
            </Button>
          </div>
        </header>

        <div className="grid min-h-0 md:grid-cols-[14rem_minmax(0,1fr)]">
          <aside className="border-b border-border p-3 md:border-b-0 md:border-r">
            <p className="mb-2 px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Files</p>
            <div className="space-y-1">
              {detail.fileInventory.map((entry) => {
                const Icon = fileIcon(entry.kind);
                return (
                  <button
                    key={entry.path}
                    type="button"
                    onClick={() => navigate(skillRoute(detail, skills, entry.path))}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent",
                      selectedPath === entry.path && "bg-accent font-medium",
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{entry.path}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-5 border-t border-border pt-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Users className="h-4 w-4 text-muted-foreground" />
                {coreSkill ? "Available to all agents" : `Used by ${detail.usedByAgents.length}`}
              </div>
              {coreSkill ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  Core skills are selected automatically when an agent needs them.
                </p>
              ) : detail.usedByAgents.length > 0 ? (
                <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                  {detail.usedByAgents.map((agent) => <li key={agent.id}>{agent.name}</li>)}
                </ul>
              ) : <p className="mt-2 text-sm text-muted-foreground">No agents yet.</p>}
            </div>
          </aside>
          <main className="min-w-0 p-5">
            <h2 className="mb-4 text-sm font-medium text-muted-foreground">{selectedPath}</h2>
            {fileQuery.isError ? (
              <p className="text-sm text-destructive">{describeError(fileQuery.error).body}</p>
            ) : file?.markdown ? (
              <MarkdownBody softBreaks={false} linkIssueReferences={false}>{body}</MarkdownBody>
            ) : (
              <pre className="overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-4 text-sm">{body || "This file is empty."}</pre>
            )}
          </main>
        </div>

        <Dialog open={removeOpen} onOpenChange={setRemoveOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Remove {detail.name}?</DialogTitle>
              <DialogDescription>
                {detail.usedByAgents.length > 0
                  ? "Remove this skill from its agents first."
                  : "This removes the skill from this Space."}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setRemoveOpen(false)}>Cancel</Button>
              <Button
                variant="destructive"
                onClick={() => removeSkill.mutate()}
                disabled={detail.usedByAgents.length > 0 || removeSkill.isPending}
              >
                Remove
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="min-h-(--sz-calc-30)">
      <header className="border-b border-border px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">Installed skills</h1>
            <p className="mt-1 text-sm text-muted-foreground">Skills available to agents in this Space.</p>
          </div>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" />
            Add skill
          </Button>
        </div>
        <div className="mt-4 flex max-w-xl items-center gap-2 rounded-md border border-border px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search installed skills"
            aria-label="Search installed skills"
            className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      </header>

      <main className="p-5">
        {skillsQuery.isLoading ? (
          <PageSkeleton variant="list" />
        ) : skillsQuery.isError ? (
          <div className="py-10 text-center">
            <p className="text-sm text-destructive">{describeError(skillsQuery.error).body}</p>
            <Button className="mt-3" variant="outline" size="sm" onClick={() => skillsQuery.refetch()}>Retry</Button>
          </div>
        ) : filteredSkills.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            message={skills.length === 0 ? "No skills installed." : "No skills match your search."}
            action={skills.length === 0 ? "Add skill" : undefined}
            onAction={skills.length === 0 ? () => setAddOpen(true) : undefined}
          />
        ) : (
          <div className="divide-y divide-border rounded-md border border-border">
            {filteredSkills.map((skill) => (
              <button
                key={skill.id}
                type="button"
                onClick={() => navigate(skillRoute(skill, skills))}
                className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-accent/40"
              >
                <BookOpen className="h-5 w-5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{skill.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{skill.description || skill.key}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {isCoreSkill(skill)
                    ? "Available to all agents"
                    : `${skill.attachedAgentCount} ${skill.attachedAgentCount === 1 ? "agent" : "agents"}`}
                </span>
              </button>
            ))}
          </div>
        )}
      </main>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add skill</DialogTitle>
            <DialogDescription>Enter a local folder path or GitHub repository URL containing a SKILL.md file.</DialogDescription>
          </DialogHeader>
          <Input
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder="C:\\path\\to\\skill or https://github.com/..."
            autoFocus
            onKeyDown={(event) => {
              if (event.key === "Enter" && source.trim() && !importSkill.isPending) importSkill.mutate(source.trim());
            }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={() => importSkill.mutate(source.trim())} disabled={!source.trim() || importSkill.isPending}>
              {importSkill.isPending ? "Adding…" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
