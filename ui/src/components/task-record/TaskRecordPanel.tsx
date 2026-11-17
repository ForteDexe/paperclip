import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Issue, IssueDocument } from "@outpost/shared";
import { Bot, Check, CircleCheck, CircleHelp, Clock3, FilePenLine, FlaskConical, Image, Loader2, MessageSquareText, Pause, Play, Plus, Rocket, User, X } from "lucide-react";
import { issuesApi } from "@/api/issues";
import { DocumentMarkdownBody } from "@/components/DocumentMarkdownBody";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RadioCardGroup } from "@/components/ui/radio-card";
import { Textarea } from "@/components/ui/textarea";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { queryKeys } from "@/lib/queryKeys";
import {
  buildTaskRecord,
  parseTaskRecord,
  parseTaskRecordFeatures,
  TASK_RECORD_DOCUMENT_KEY,
  TASK_RECORD_DOCUMENT_TITLE,
  type TaskRecordFeature,
} from "./task-record-model";

export function TaskRecordPanel({ issue, document }: { issue: Issue; document?: IssueDocument }) {
  const queryClient = useQueryClient();
  const [current, setCurrent] = useState<IssueDocument | undefined>(document);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(document?.body ?? buildTaskRecord(issue));
  const [automaticExecution, setAutomaticExecution] = useState(false);
  const [executionState, setExecutionState] = useState<"blocked" | "paused" | "running">("blocked");
  const [pendingChanges, setPendingChanges] = useState(0);

  useEffect(() => {
    if (!document) return;
    setCurrent(document);
    if (!editing) setDraft(document.body);
  }, [document, editing]);

  const save = useMutation({
    mutationFn: (body: string) => issuesApi.upsertDocument(issue.id, TASK_RECORD_DOCUMENT_KEY, {
      title: TASK_RECORD_DOCUMENT_TITLE,
      format: "markdown",
      body,
      baseRevisionId: current?.latestRevisionId ?? null,
      changeSummary: current ? "Update task record" : "Create task record",
    }),
    onSuccess: async (saved) => {
      setCurrent(saved);
      setDraft(saved.body);
      setEditing(false);
      setPendingChanges((count) => count + 1);
      await queryClient.invalidateQueries({ queryKey: queryKeys.issues.documents(issue.id) });
    },
  });

  const body = current?.body ?? draft;
  const sections = useMemo(() => parseTaskRecord(body), [body]);
  const features = useMemo(() => parseTaskRecordFeatures(body), [body]);
  const reviewBody = sections.find((section) => ["review timeline", "stages"].includes(section.heading.toLowerCase()))?.body ?? "";
  const reviewIsPlaceholder = !reviewBody || reviewBody.includes("The agent will add its result summary");
  const previewFeatures = useMemo<TaskRecordFeature[]>(() => [{
    behavior: "Example behavior",
    outcome: "The agreed result the user can test.",
    agentState: "Implemented",
    evidence: "Screenshot or verification link",
  }], []);
  const displayedFeatures = features.length ? features : previewFeatures;
  const allFeaturesReady = displayedFeatures.every((feature) => ["implemented", "validated", "skipped", "skipped by agreement"].includes(feature.agentState.trim().toLowerCase()));
  const canWrapUp = executionState === "paused" && allFeaturesReady;
  const wrapUpReason = executionState === "blocked"
    ? "Resolve blocking questions first"
    : executionState === "running"
      ? "Pause the task before wrapping up"
      : !allFeaturesReady
        ? "Every feature must be Implemented, Validated, or skipped"
        : null;
  const resolveBlockingQuestion = () => {
    setExecutionState("paused");
    setPendingChanges((count) => count + 1);
  };
  const resumeTask = () => {
    setExecutionState("running");
    setPendingChanges(0);
  };
  const changeAutomaticExecution = (checked: boolean) => {
    setAutomaticExecution(checked);
    setPendingChanges((count) => count + 1);
  };

  if (!current && !editing) {
    return (
      <div className="space-y-5 py-2">
        <TaskRecordHeader />
        <AutomationSwitch checked={automaticExecution} onCheckedChange={changeAutomaticExecution} executionState={executionState} onExecutionStateChange={setExecutionState} pendingChanges={pendingChanges} onResume={resumeTask} />
        <div className="rounded-lg border border-dashed p-4 text-sm">
          <p className="font-medium">No task record yet</p>
          <p className="mt-1 text-muted-foreground">
            Create one from this task&apos;s current title and description. It stays separate from the conversation and keeps revision history.
          </p>
          <Button
            className="mt-4"
            size="sm"
            onClick={() => save.mutate(draft)}
            disabled={save.isPending || executionState === "running"}
            title={executionState === "running" ? "Pause the task before creating the Task Record" : undefined}
          >
            {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
            Create task record
          </Button>
        </div>
        <PrototypeNotice />
        <FeatureTable features={previewFeatures} preview />
        <QuestionsPrototype onBlockingResolved={resolveBlockingQuestion} readOnly={executionState === "running"} />
        <ContinuousReview body="The agent's result summary, verification notes, screenshots, videos, and related files will appear here as continuous submissions." preview readOnly={executionState === "running"} canWrapUp={canWrapUp} wrapUpReason={wrapUpReason} onFeedbackSaved={() => setPendingChanges((count) => count + 1)} onWrapUp={resumeTask} />
        {save.error ? <p className="text-sm text-destructive">{save.error.message}</p> : null}
      </div>
    );
  }

  return (
    <article className="space-y-5 py-2">
      <header className="space-y-2 border-b pb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TaskRecordTitle />
          {editing ? (
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={() => {
                setDraft(current?.body ?? buildTaskRecord(issue));
                setEditing(false);
              }} disabled={save.isPending}>
                <X aria-hidden /> Cancel
              </Button>
              <Button size="sm" onClick={() => save.mutate(draft)} disabled={save.isPending || !draft.trim()}>
                {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
                Save revision
              </Button>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)} disabled={executionState === "running"} title={executionState === "running" ? "Pause the task before editing the Task Record" : undefined}>
              <FilePenLine aria-hidden /> Edit record
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {current ? `Revision ${current.latestRevisionNumber ?? 1} · Updated ${new Date(current.updatedAt).toLocaleString()}` : "Unsaved draft"}
        </p>
      </header>

      <AutomationSwitch checked={automaticExecution} onCheckedChange={changeAutomaticExecution} executionState={executionState} onExecutionStateChange={setExecutionState} pendingChanges={pendingChanges} onResume={resumeTask} resumeDisabled={editing} />

      {editing ? (
        <div className="space-y-2">
          <Textarea aria-label="Task record Markdown" className="min-h-[32rem] resize-y font-mono text-xs leading-relaxed" value={draft} onChange={(event) => setDraft(event.target.value)} />
          <p className="text-xs text-muted-foreground">Markdown is stored as a revisioned task document.</p>
        </div>
      ) : sections.length > 0 ? (
        <div className="space-y-5">
          <PrototypeNotice />
          <div className="space-y-3">
          {sections.filter((section) => !["features and behaviors", "open questions", "questions", "review timeline", "stages"].includes(section.heading.toLowerCase())).map((section) => (
            <section key={section.heading} className="rounded-lg border bg-card/30 p-4">
              <h3 className="mb-3 text-sm font-semibold">{section.heading}</h3>
              {section.body ? (
                <DocumentMarkdownBody documentKey={TASK_RECORD_DOCUMENT_KEY} currentIssueId={issue.id}>
                  {section.body}
                </DocumentMarkdownBody>
              ) : <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>}
            </section>
          ))}
          </div>
          <FeatureTable features={displayedFeatures} preview={features.length === 0} />
          <QuestionsPrototype onBlockingResolved={resolveBlockingQuestion} readOnly={executionState === "running"} />
          <ContinuousReview
            body={reviewBody || "The agent's result summary, verification notes, screenshots, videos, and related files will appear here as continuous submissions."}
            preview={reviewIsPlaceholder}
            readOnly={executionState === "running"}
            canWrapUp={canWrapUp}
            wrapUpReason={wrapUpReason}
            onFeedbackSaved={() => setPendingChanges((count) => count + 1)}
            onWrapUp={resumeTask}
          />
        </div>
      ) : (
        <DocumentMarkdownBody documentKey={TASK_RECORD_DOCUMENT_KEY} currentIssueId={issue.id}>{body}</DocumentMarkdownBody>
      )}

      {save.error ? <p className="text-sm text-destructive">Could not save the record: {save.error.message}</p> : null}
    </article>
  );
}

function PrototypeNotice() {
  return (
    <div className="rounded-md border border-sky-500/25 bg-sky-500/5 px-3 py-2 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">UI/UX prototype.</span>{" "}
      Nothing wakes an agent in this prototype. In the implemented workflow, only Resume task and Final — Wrap up will wake it; answers and feedback only accumulate pending changes.
    </div>
  );
}

function AutomationSwitch({
  checked,
  onCheckedChange,
  executionState,
  onExecutionStateChange,
  pendingChanges,
  onResume,
  resumeDisabled = false,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  executionState: "blocked" | "paused" | "running";
  onExecutionStateChange: (state: "blocked" | "paused" | "running") => void;
  pendingChanges: number;
  onResume: () => void;
  resumeDisabled?: boolean;
}) {
  return (
    <div className="space-y-3 rounded-lg border bg-card/30 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">Automatic execution</p>
            <Badge variant="outline" className={checked ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "text-muted-foreground"}>
              {checked ? "Automatic" : "Manual"}
            </Badge>
          </div>
          <p className="max-w-2xl text-xs text-muted-foreground">
            Once the Brief and Features &amp; Behaviors are clear, let the agent continue from implementation through review submissions without waiting between routine steps.
          </p>
        </div>
        <ToggleSwitch checked={checked} onCheckedChange={onCheckedChange} disabled={executionState === "running"} aria-label="Toggle automatic task execution" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
        <div>
          <div className="flex items-center gap-2">
            <span className={`size-2 rounded-full ${executionState === "running" ? "bg-emerald-500" : executionState === "blocked" ? "bg-amber-500" : "bg-muted-foreground"}`} aria-hidden />
            <span className="text-sm font-medium">{executionState === "running" ? "Running" : executionState === "blocked" ? "Paused · needs input" : "Paused"}</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {executionState === "running"
              ? checked ? "The agent continues until blocked or ready for final review." : "The agent runs one turn, then returns to Paused."
              : executionState === "blocked"
                ? "Resolve the blocking question before resuming the task."
                : `${pendingChanges ? `${pendingChanges} pending change${pendingChanges === 1 ? "" : "s"}. ` : ""}Resume when the Task Record is ready; the agent wakes with one coherent revision.`}
          </p>
        </div>
        {executionState === "running" ? (
          <Button variant="outline" size="sm" onClick={() => onExecutionStateChange("paused")}><Pause aria-hidden /> Pause task</Button>
        ) : (
          <Button size="sm" disabled={executionState === "blocked" || resumeDisabled} title={resumeDisabled ? "Save or cancel the Task Record edit before resuming" : undefined} onClick={onResume}><Play aria-hidden /> Resume task</Button>
        )}
      </div>
    </div>
  );
}

function FeatureTable({ features, preview = false }: { features: TaskRecordFeature[]; preview?: boolean }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">Features and Behaviors</h3>
            {preview ? <Badge variant="outline" className="text-muted-foreground">Example</Badge> : null}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">The agent keeps each agreed outcome, state, and current evidence up to date.</p>
        </div>
        <span className="text-xs text-muted-foreground">{features.length} item{features.length === 1 ? "" : "s"}</span>
      </div>
      <div className="overflow-hidden rounded-lg border">
        {features.map((feature, index) => {
          return (
            <div key={`${feature.behavior}-${index}`} className="grid gap-3 border-b p-4 last:border-b-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium">{feature.behavior}</p>
                  <Badge variant="outline" className="text-xs text-muted-foreground">{feature.agentState || "Not reported"}</Badge>
                </div>
              </div>
              <div>
                <p className="text-sm">{feature.outcome || "No agreed outcome recorded."}</p>
                {feature.evidence ? <p className="mt-1 text-xs text-muted-foreground">Evidence: {feature.evidence}</p> : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function QuestionsPrototype({ onBlockingResolved, readOnly }: { onBlockingResolved: () => void; readOnly: boolean }) {
  const [choice, setChoice] = useState("restore");
  const [customAnswer, setCustomAnswer] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const answerLabel = choice === "restore"
    ? "Restore the last used scale"
    : choice === "default"
      ? "Reset to the default scale"
      : choice === "project"
        ? "Follow the project setting"
        : customAnswer.trim();

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Questions</h3>
          <p className="mt-1 text-xs text-muted-foreground">Blocking choices pause automatic execution; non-blocking questions carry an agent assumption.</p>
        </div>
        <Badge variant="outline" className={confirmed ? "text-muted-foreground" : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"}>
          {confirmed ? "No blockers" : "1 blocking"}
        </Badge>
      </div>

      {!confirmed ? (
        <div className="space-y-3 rounded-lg border border-amber-500/25 bg-amber-500/5 p-4">
          <div className="flex items-start gap-2">
            <CircleHelp className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">When the preview tool reopens, which scale should it use?</p>
                <Badge variant="outline" className="text-xs text-muted-foreground">Blocks automatic execution</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">The agent needs this behavior defined before persistence can be implemented.</p>
            </div>
          </div>
          <RadioCardGroup
            value={choice}
            onValueChange={(value) => setChoice(value)}
            ariaLabel="Choose preview scale persistence behavior"
            disabled={readOnly}
            options={[
              { value: "restore", title: "Restore last used", description: "Recommended · preserves the user's choice." },
              { value: "default", title: "Reset to default", description: "Every session starts from the same scale." },
              { value: "project", title: "Follow project", description: "Use a shared project-level setting." },
              { value: "custom", title: "Write my own answer", description: "Provide behavior that is not covered by the suggested choices." },
            ]}
          />
          {choice === "custom" ? (
            <div className="space-y-1.5">
              <label htmlFor="custom-blocking-answer" className="text-sm font-medium">Your answer</label>
              <Textarea
                id="custom-blocking-answer"
                value={customAnswer}
                onChange={(event) => setCustomAnswer(event.target.value)}
                placeholder="Describe the behavior you want…"
                className="min-h-20"
                disabled={readOnly}
              />
            </div>
          ) : null}
          <div className="flex justify-end">
            <Button size="sm" title={readOnly ? "Pause the task before answering" : "Save this answer to the Task Record without waking the agent"} disabled={readOnly || (choice === "custom" && !customAnswer.trim())} onClick={() => {
              setConfirmed(true);
              onBlockingResolved();
            }}><Check aria-hidden /> Confirm choice</Button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3 text-sm">
          <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
          <div>
            <p className="font-medium">Blocking question answered</p>
            <p className="mt-1 text-xs text-muted-foreground">The answer is saved with the Task Record. The task stays paused and the agent is not woken until you press Resume task.</p>
          </div>
        </div>
      )}

      <div className="flex items-start gap-2 rounded-lg border p-4">
        <Clock3 className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">Should the first version include a keyboard shortcut?</p>
            <Badge variant="outline" className="text-xs text-muted-foreground">Non-blocking</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground"><span className="font-medium text-foreground">Agent assumption:</span> ship without a shortcut and revisit it after the main workflow is validated.</p>
        </div>
      </div>

      <details className="rounded-lg border px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium">Resolved questions · {confirmed ? 2 : 1}</summary>
        <div className="mt-3 space-y-3 border-t pt-3 text-sm">
          <div>
            <p className="font-medium">Where should the preview control live?</p>
            <p className="mt-1 text-muted-foreground">Viewport toolbar, beside the existing display controls.</p>
          </div>
          {confirmed ? (
            <div>
              <p className="font-medium">When the preview tool reopens, which scale should it use?</p>
              <p className="mt-1 text-muted-foreground">{answerLabel}.</p>
            </div>
          ) : null}
        </div>
      </details>
    </section>
  );
}

function ContinuousReview({
  body,
  preview = false,
  readOnly,
  canWrapUp,
  wrapUpReason,
  onFeedbackSaved,
  onWrapUp,
}: {
  body: string;
  preview?: boolean;
  readOnly: boolean;
  canWrapUp: boolean;
  wrapUpReason: string | null;
  onFeedbackSaved: () => void;
  onWrapUp: () => void;
}) {
  const [action, setAction] = useState<"idle" | "feedback-sent" | "wrap-up">("idle");
  const [feedback, setFeedback] = useState("");

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">Review</h3>
        {preview ? <Badge variant="outline" className="text-muted-foreground">Example</Badge> : null}
      </div>

      {preview ? <ExampleReviewTurns /> : (
        <>
          <DocumentMarkdownBody documentKey={TASK_RECORD_DOCUMENT_KEY}>{body}</DocumentMarkdownBody>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-md border border-dashed px-3 py-3 text-xs text-muted-foreground">Screenshots and video records</div>
            <div className="rounded-md border border-dashed px-3 py-3 text-xs text-muted-foreground">Verification notes and files</div>
          </div>
        </>
      )}

      <div className="space-y-2 border-t pt-4">
        <label htmlFor="task-review-feedback" className="text-sm font-medium">Feedback</label>
        <Textarea
          id="task-review-feedback"
          value={feedback}
          onChange={(event) => {
            setFeedback(event.target.value);
            if (action !== "idle") setAction("idle");
          }}
          placeholder="Overall, UX, or post-implementation feedback…"
          className="min-h-24"
          disabled={readOnly}
        />
        {action === "feedback-sent" ? (
          <p className="text-xs text-orange-700 dark:text-orange-300">Feedback is queued with the Task Record. It will be delivered with the other accumulated changes when you resume or wrap up.</p>
        ) : action === "wrap-up" ? (
          <p className="text-xs text-emerald-700 dark:text-emerald-300">Prototype: the agent would start final implementation, general validation, cleanup, commit, and the repository delivery workflow.</p>
        ) : (
          <p className="text-xs text-muted-foreground">Feedback stays attached to the result instead of becoming general chat.</p>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="outline" size="sm" title={readOnly ? "Pause the task before adding feedback" : "Save feedback without waking the agent"} disabled={readOnly || !feedback.trim()} onClick={() => {
            setAction("feedback-sent");
            onFeedbackSaved();
          }}>
            <MessageSquareText aria-hidden /> Send feedback
          </Button>
          <Button size="sm" disabled={readOnly || !canWrapUp} onClick={() => {
            setAction("wrap-up");
            onWrapUp();
          }} title={wrapUpReason ?? "Wake the agent for final implementation, general validation, cleanup, commit, and repository delivery"}>
            <Rocket aria-hidden /> Final — Wrap up
          </Button>
        </div>
      </div>
    </section>
  );
}

function ExampleReviewTurns() {
  return (
    <div className="space-y-5" aria-label="Example review history">
      <div className="flex gap-3">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted"><Bot className="size-3.5" aria-hidden /></div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span className="font-semibold text-foreground">Agent</span>
            <span className="text-muted-foreground">Submission 1 · Initial implementation</span>
          </div>
          <p className="text-sm">Implemented the preview overlay and kept it isolated from the normal render path. The control is available in the viewport toolbar.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <ExampleMedia label="Before" detail="Viewport without preview" icon={<Image className="size-4" aria-hidden />} />
            <ExampleMedia label="After" detail="Preview overlay enabled" icon={<Image className="size-4" aria-hidden />} />
          </div>
          <p className="text-xs text-muted-foreground">Verification: focused UI tests pass; existing render behavior is unchanged while disabled.</p>
        </div>
      </div>

      <div className="ml-auto flex max-w-[85%] flex-row-reverse gap-3">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"><User className="size-3.5" aria-hidden /></div>
        <div className="rounded-xl rounded-tr-sm bg-muted px-3 py-2">
          <div className="mb-1 text-xs font-semibold">You · Feedback</div>
          <p className="text-sm">The overlay works, but the checker pattern is too dense. Please make the default scale easier to read and keep the chosen scale after reopening the tool.</p>
        </div>
      </div>

      <div className="flex gap-3">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted"><Bot className="size-3.5" aria-hidden /></div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span className="font-semibold text-foreground">Agent</span>
            <span className="text-muted-foreground">Submission 2 · Revision</span>
          </div>
          <p className="text-sm">Reduced the default density and persisted the scale per workspace. The short recording shows the setting surviving a close and reopen.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <ExampleMedia label="Revised result" detail="Readable default density" icon={<Image className="size-4" aria-hidden />} />
            <ExampleMedia label="Behavior recording" detail="Setting persists after reopen" icon={<Play className="size-4" aria-hidden />} />
          </div>
          <p className="text-xs text-muted-foreground">Verification: UI tests and the general smoke suite pass.</p>
        </div>
      </div>
    </div>
  );
}

function ExampleMedia({ label, detail, icon }: { label: string; detail: string; icon: ReactNode }) {
  return (
    <div className="flex min-h-20 items-end rounded-md border border-dashed bg-muted/20 p-3">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{icon}</span>
        <span>
          <span className="block text-xs font-medium">{label}</span>
          <span className="block text-xs text-muted-foreground">{detail}</span>
        </span>
      </div>
    </div>
  );
}

function TaskRecordTitle() {
  return (
    <div className="flex items-center gap-2">
      <h2 className="text-lg font-semibold">Task Record</h2>
      <Badge variant="outline" className="gap-1 text-muted-foreground">
        <FlaskConical className="size-3" aria-hidden /> Prototype
      </Badge>
    </div>
  );
}

function TaskRecordHeader() {
  return (
    <header className="space-y-2">
      <TaskRecordTitle />
      <p className="text-sm text-muted-foreground">
        A living source of truth for the refined brief, answered questions, decisions, evidence, and result.
      </p>
    </header>
  );
}
