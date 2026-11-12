import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { companiesApi } from "../api/companies";
import { queryKeys } from "../lib/queryKeys";
import { useNavigate, useSearchParams } from "react-router-dom";
import { QueryErrorState } from "../components/QueryView";
import { relativeTime } from "../lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import {
  Pencil,
  Check,
  X,
  MoreHorizontal,
  Trash2,
  Users,
  CircleDot,
  Calendar,
  ArchiveRestore,
  Plus,
  FolderOpen,
  Map,
} from "lucide-react";

function spaceNameFromPath(value: string) {
  const normalized = value.trim().replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).pop() || "Space";
}

export function Companies() {
  const {
    companies,
    selectedCompanyId,
    setSelectedCompanyId,
    loading,
    error,
    retryCompanies,
    createCompany,
  } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const { data: stats } = useQuery({
    queryKey: queryKeys.companies.stats,
    queryFn: () => companiesApi.stats(),
  });

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [spaceName, setSpaceName] = useState("");
  const [workspaceRoot, setWorkspaceRoot] = useState("");

  const createMutation = useMutation({
    mutationFn: () => createCompany({
      name: spaceName.trim() || spaceNameFromPath(workspaceRoot),
      workspaceRoot: workspaceRoot.trim(),
    }),
    onSuccess: (company) => {
      setShowCreate(false);
      setSpaceName("");
      setWorkspaceRoot("");
      navigate(`/${company.issuePrefix}/dashboard`);
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, newName }: { id: string; newName: string }) =>
      companiesApi.update(id, { name: newName }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      setEditingId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => companiesApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.stats });
      setConfirmDeleteId(null);
    },
  });

  // Unarchiving previously had no UI at all: archiving happens in company
  // settings, but an archived company disappears from the sidebar switcher,
  // so its settings page — and with it any way back — was only reachable by
  // hand-typed URL. This list is the one place that still shows archived
  // companies, so restoration lives here.
  const unarchiveMutation = useMutation({
    mutationFn: (id: string) => companiesApi.update(id, { status: "active" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.stats });
    },
  });

  useEffect(() => {
    setBreadcrumbs([{ label: "Spaces" }]);
  }, [setBreadcrumbs]);

  useEffect(() => {
    if (searchParams.get("new") === "1") setShowCreate(true);
  }, [searchParams]);

  function startEdit(companyId: string, currentName: string) {
    setEditingId(companyId);
    setEditName(currentName);
  }

  function saveEdit() {
    if (!editingId || !editName.trim()) return;
    editMutation.mutate({ id: editingId, newName: editName.trim() });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName("");
  }

  function selectSpace(company: (typeof companies)[number]) {
    setSelectedCompanyId(company.id);
    navigate(`/${company.issuePrefix}/dashboard`);
  }

  const createSpaceForm = showCreate ? (
    <Card className="w-full space-y-4 p-5 text-left">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1.5 text-sm">
          <span className="font-medium">Name <span className="font-normal text-muted-foreground">(optional)</span></span>
          <Input value={spaceName} onChange={(event) => setSpaceName(event.target.value)} placeholder="Derived from the folder name" />
        </label>
        <label className="space-y-1.5 text-sm">
          <span className="font-medium">Working directory</span>
          <Input value={workspaceRoot} onChange={(event) => setWorkspaceRoot(event.target.value)} placeholder={"C:\\work\\maya"} autoFocus />
        </label>
      </div>
      {createMutation.error ? <p className="text-sm text-destructive">{createMutation.error.message}</p> : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
        <Button
          onClick={() => createMutation.mutate()}
          disabled={!workspaceRoot.trim() || createMutation.isPending}
        >
          {createMutation.isPending ? "Creating…" : "Create Space"}
        </Button>
      </div>
    </Card>
  ) : null;

  if (!loading && !error && companies.length === 0) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6 py-12" data-testid="spaces-welcome">
        <div className="flex w-full max-w-2xl flex-col items-center text-center">
          <div className="mb-8 flex h-28 w-28 items-center justify-center rounded-3xl border border-border bg-muted/30 text-muted-foreground/40 shadow-sm">
            <Map className="h-14 w-14" strokeWidth={1.25} aria-hidden="true" />
          </div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Welcome to Outpost</p>
          <h1 className="text-3xl font-semibold tracking-tight">Create your first Space</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
            A Space connects one repository to its agents, tasks, decisions, and Campfire rooms.
            Start by choosing its working directory.
          </p>
          <div className="mt-8 w-full">
            {createSpaceForm ?? (
              <Button size="lg" onClick={() => setShowCreate(true)}>
                <FolderOpen className="h-4 w-4" /> Choose working directory
              </Button>
            )}
          </div>
          {!showCreate ? (
            <p className="mt-4 text-xs text-muted-foreground">
              Outpost keeps each Space&apos;s agent and work context separate.
            </p>
          ) : null}
        </div>
      </main>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Spaces</h1>
          <p className="text-sm text-muted-foreground">Each Space owns one repository and its complete agent context.</p>
        </div>
        <Button onClick={() => setShowCreate((value) => !value)}>
          <Plus className="h-4 w-4" /> New Space
        </Button>
      </div>
      {createSpaceForm}
      <div className="min-h-6">
        {loading && <p className="text-sm text-muted-foreground">Loading spaces...</p>}
        {error ? (
          <QueryErrorState size="inline" error={error} action="load spaces" onRetry={() => void retryCompanies()} />
        ) : null}
      </div>

      <div className="grid gap-4">
        {companies.map((company) => {
          const selected = company.id === selectedCompanyId;
          const isEditing = editingId === company.id;
          const isConfirmingDelete = confirmDeleteId === company.id;
          const companyStats = stats?.[company.id];
          const agentCount = companyStats?.agentCount ?? 0;
          const issueCount = companyStats?.issueCount ?? 0;

          return (
            <Card
              key={company.id}
              role="button"
              tabIndex={0}
              onClick={() => selectSpace(company)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  selectSpace(company);
                }
              }}
              interactive
              className={`block group text-left p-5 ${
                selected ? "border-primary ring-1 ring-primary hover:border-primary" : ""
              }`}
            >
              {/* Header row: name + menu */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  {isEditing ? (
                    <div
                      className="flex items-center gap-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="h-7 text-sm"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEdit();
                          if (e.key === "Escape") cancelEdit();
                        }}
                      />
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={saveEdit}
                        disabled={editMutation.isPending}
                      >
                        <Check className="h-3.5 w-3.5 text-green-500" />
                      </Button>
                      <Button variant="ghost" size="icon-xs" onClick={cancelEdit}>
                        <X className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-base">{company.name}</h3>
                      <Badge variant="ghost"
                        className={`text-(length:--text-micro) ${
                          company.status === "active"
                            ? "bg-green-500/10 text-green-600 dark:text-green-400"
                            : company.status === "paused"
                              ? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
                              : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {company.status}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="text-muted-foreground opacity-0 group-hover:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          startEdit(company.id, company.name);
                        }}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                  {company.description && !isEditing && (
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                      {company.description}
                    </p>
                  )}
                  {company.workspaceRoot ? (
                    <p className="mt-1 flex items-center gap-1.5 truncate text-sm text-muted-foreground">
                      <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{company.workspaceRoot}</span>
                    </p>
                  ) : null}
                </div>

                {/* Three-dot menu */}
                <div onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="text-muted-foreground opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => startEdit(company.id, company.name)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Rename
                      </DropdownMenuItem>
                      {company.status === "archived" && (
                        <DropdownMenuItem
                          disabled={unarchiveMutation.isPending}
                          onClick={() => unarchiveMutation.mutate(company.id)}
                        >
                          <ArchiveRestore className="h-3.5 w-3.5" />
                          Unarchive
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => setConfirmDeleteId(company.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete Space
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {/* Stats row */}
              <div className="flex items-center gap-3 sm:gap-5 mt-4 text-sm text-muted-foreground flex-wrap">
                <div className="flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5" />
                  <span>
                    {agentCount} {agentCount === 1 ? "agent" : "agents"}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <CircleDot className="h-3.5 w-3.5" />
                  <span>
                    {issueCount} {issueCount === 1 ? "task" : "tasks"}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 ml-auto">
                  <Calendar className="h-3.5 w-3.5" />
                  <span>Created {relativeTime(company.createdAt)}</span>
                </div>
              </div>

              {/* Delete confirmation */}
              {isConfirmingDelete && (
                <div
                  className="mt-4 flex items-center justify-between bg-destructive/5 border border-destructive/20 rounded-md px-4 py-3"
                  onClick={(e) => e.stopPropagation()}
                >
                  <p className="text-sm text-destructive font-medium">
                    Delete this Space and all its data? This cannot be undone.
                  </p>
                  <div className="flex items-center gap-2 ml-4 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmDeleteId(null)}
                      disabled={deleteMutation.isPending}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => deleteMutation.mutate(company.id)}
                      disabled={deleteMutation.isPending}
                    >
                      {deleteMutation.isPending ? "Deleting…" : "Delete"}
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
