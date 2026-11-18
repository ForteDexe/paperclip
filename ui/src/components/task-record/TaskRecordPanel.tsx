import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { TASK_RECORD_FEATURE_STATES, taskRecordSchema, type Issue, type TaskRecord, type TaskRecordFeature } from "@outpost/shared";
import { Bot, Check, FilePenLine, FlaskConical, Image, Loader2, MessageSquareText, Pause, Play, Plus, Rocket, Trash2, User, X } from "lucide-react";
import { issuesApi } from "@/api/issues";
import { DocumentMarkdownBody } from "@/components/DocumentMarkdownBody";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { useTaskRecord } from "@/hooks/useTaskRecord";
import { queryKeys } from "@/lib/queryKeys";
import {
  buildTaskRecord,
  resolveTaskRecordNextStepFeature,
  taskRecordFeatureStateLabel,
  TASK_RECORD_DOCUMENT_KEY,
} from "./task-record-model";

const PREVIEW_RECORD: TaskRecord = {
  version: 1,
  intent: "The agreed task outcome appears here.",
  features: [{
    id: "example_behavior",
    behavior: "Example behavior",
    outcome: "The agreed result the user can test.",
    state: "implemented",
  }],
  constraintsAndNonGoals: [],
  decisions: [],
  nextStep: { featureId: "example_behavior", comment: "Review the result the user can test." },
  resultsAndVerification: [],
};

export function TaskRecordPanel({ issue }: { issue: Issue }) {
  const queryClient = useQueryClient();
  const taskRecordQuery = useTaskRecord(issue.id);
  const current = taskRecordQuery.data;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TaskRecord>(() => buildTaskRecord(issue));
  const [automaticExecution, setAutomaticExecution] = useState(false);
  const [executionState, setExecutionState] = useState<"blocked" | "paused" | "running">("paused");
  const [pendingChanges, setPendingChanges] = useState(0);

  useEffect(() => {
    if (current && !editing) setDraft(structuredClone(current.record));
  }, [current, editing]);

  const save = useMutation({
    mutationFn: (record: TaskRecord) => issuesApi.upsertTaskRecord(issue.id, {
      record,
      baseRevisionId: current?.latestRevisionId ?? null,
      changeSummary: current ? "Update task record" : "Create task record",
    }),
    onSuccess: async (saved) => {
      setDraft(structuredClone(saved.record));
      setEditing(false);
      setPendingChanges((count) => count + 1);
      queryClient.setQueryData(queryKeys.issues.taskRecord(issue.id), saved);
      await queryClient.invalidateQueries({ queryKey: queryKeys.issues.documents(issue.id) });
    },
  });

  const record = current?.record ?? draft;
  const draftIsValid = taskRecordSchema.safeParse(draft).success;
  const displayedRecord = current ? record : PREVIEW_RECORD;
  const allFeaturesReady = record.features.length > 0 && record.features.every((feature) =>
    ["implemented", "validated", "skipped_by_agreement"].includes(feature.state));
  const canWrapUp = executionState === "paused" && allFeaturesReady;
  const wrapUpReason = executionState === "blocked"
    ? "Resolve the blocker in chat first"
    : executionState === "running"
      ? "Pause the task before wrapping up"
      : !allFeaturesReady
        ? "Every feature must be Implemented, Validated, or skipped"
        : null;
  const resumeTask = () => {
    setExecutionState("running");
    setPendingChanges(0);
  };
  const changeAutomaticExecution = (checked: boolean) => {
    setAutomaticExecution(checked);
    setPendingChanges((count) => count + 1);
  };

  if (taskRecordQuery.isLoading) {
    return <div className="flex min-h-40 items-center justify-center"><Loader2 className="animate-spin" aria-label="Loading Task Record" /></div>;
  }

  if (current === null && !editing) {
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
            onClick={() => save.mutate(buildTaskRecord(issue))}
            disabled={save.isPending || executionState === "running"}
            title={executionState === "running" ? "Pause the task before creating the Task Record" : undefined}
          >
            {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
            Create task record
          </Button>
        </div>
        <PrototypeNotice />
        <FeatureTable features={PREVIEW_RECORD.features} preview />
        <NextStepCard record={PREVIEW_RECORD} preview />
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
                setDraft(current ? structuredClone(current.record) : buildTaskRecord(issue));
                setEditing(false);
              }} disabled={save.isPending}>
                <X aria-hidden /> Cancel
              </Button>
              <Button size="sm" onClick={() => save.mutate(draft)} disabled={save.isPending || !draftIsValid}>
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
        <TaskRecordEditor record={draft} onChange={setDraft} />
      ) : (
        <div className="space-y-5">
          <PrototypeNotice />
          <RecordTextSection title="Intent" items={[displayedRecord.intent]} />
          <FeatureTable features={displayedRecord.features} preview={!current} />
          {displayedRecord.constraintsAndNonGoals.length > 0 ? <RecordTextSection title="Constraints and Non-Goals" items={displayedRecord.constraintsAndNonGoals} list /> : null}
          {displayedRecord.decisions.length > 0 ? <RecordTextSection title="Decisions" items={displayedRecord.decisions} list /> : null}
          {displayedRecord.nextStep ? <NextStepCard record={displayedRecord} preview={!current} /> : null}
          <ContinuousReview
            body={displayedRecord.resultsAndVerification.map((item) => `- ${item}`).join("\n") || "The agent's result summary, verification notes, screenshots, videos, and related files will appear here as continuous submissions."}
            preview={displayedRecord.resultsAndVerification.length === 0}
            readOnly={executionState === "running"}
            canWrapUp={canWrapUp}
            wrapUpReason={wrapUpReason}
            onFeedbackSaved={() => setPendingChanges((count) => count + 1)}
            onWrapUp={resumeTask}
          />
        </div>
      )}

      {save.error ? <p className="text-sm text-destructive">Could not save the record: {save.error.message}</p> : null}
    </article>
  );
}

function RecordTextSection({ title, items, list = false }: { title: string; items: string[]; list?: boolean }) {
  return (
    <section className="rounded-lg border bg-card/30 p-4">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      {list ? (
        <ul className="list-disc space-y-2 pl-5 text-sm">{items.map((item, index) => <li key={`${title}-${index}`} className="whitespace-pre-wrap">{item}</li>)}</ul>
      ) : <p className="whitespace-pre-wrap text-sm">{items[0]}</p>}
    </section>
  );
}

function TaskRecordEditor({ record, onChange }: { record: TaskRecord; onChange: (record: TaskRecord) => void }) {
  const updateFeature = (index: number, patch: Partial<TaskRecordFeature>) => onChange({
    ...record,
    features: record.features.map((feature, candidate) => candidate === index ? { ...feature, ...patch } : feature),
  });
  const addFeature = () => onChange({
    ...record,
    features: [...record.features, {
      id: `feature_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
      behavior: "",
      outcome: "",
      state: "agreed",
    }],
  });
  const removeFeature = (index: number) => {
    const removed = record.features[index];
    onChange({
      ...record,
      features: record.features.filter((_, candidate) => candidate !== index),
      nextStep: record.nextStep?.featureId === removed?.id ? null : record.nextStep,
    });
  };

  return (
    <div className="space-y-5">
      <StructuredField title="Intent">
        <Textarea aria-label="Intent" value={record.intent} onChange={(event) => onChange({ ...record, intent: event.target.value })} />
      </StructuredField>
      <StructuredField title="Features and Behaviors" action={<Button type="button" variant="outline" size="sm" onClick={addFeature}><Plus aria-hidden /> Add feature</Button>}>
        <div className="space-y-3">
          {record.features.length === 0 ? <p className="text-sm text-muted-foreground">No features recorded yet.</p> : record.features.map((feature, index) => (
            <div key={feature.id} className="grid gap-3 rounded-md border p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_12rem_auto]">
              <Input aria-label={`Feature ${index + 1} behavior`} value={feature.behavior} placeholder="Feature or behavior" onChange={(event) => updateFeature(index, { behavior: event.target.value })} />
              <Textarea aria-label={`Feature ${index + 1} outcome`} value={feature.outcome} placeholder="Agreed outcome" onChange={(event) => updateFeature(index, { outcome: event.target.value })} />
              <Select value={feature.state} onValueChange={(state) => updateFeature(index, { state: state as TaskRecordFeature["state"] })}>
                <SelectTrigger aria-label={`Feature ${index + 1} state`}><SelectValue /></SelectTrigger>
                <SelectContent>{TASK_RECORD_FEATURE_STATES.map((state) => <SelectItem key={state} value={state}>{taskRecordFeatureStateLabel(state)}</SelectItem>)}</SelectContent>
              </Select>
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${feature.behavior || `feature ${index + 1}`}`} onClick={() => removeFeature(index)}><Trash2 aria-hidden /></Button>
            </div>
          ))}
        </div>
      </StructuredField>
      <TextListEditor title="Constraints and Non-Goals" items={record.constraintsAndNonGoals} onChange={(items) => onChange({ ...record, constraintsAndNonGoals: items })} />
      <TextListEditor title="Decisions" items={record.decisions} onChange={(items) => onChange({ ...record, decisions: items })} />
      <StructuredField title="Next Step">
        <div className="grid gap-3 md:grid-cols-2">
          <Select value={record.nextStep?.featureId ?? "none"} onValueChange={(featureId) => onChange({ ...record, nextStep: featureId === "none" ? null : { featureId, comment: record.nextStep?.comment ?? null } })}>
            <SelectTrigger aria-label="Next Step feature"><SelectValue placeholder="No immediate next step" /></SelectTrigger>
            <SelectContent><SelectItem value="none">No immediate next step</SelectItem>{record.features.filter((feature) => feature.behavior.trim()).map((feature) => <SelectItem key={feature.id} value={feature.id}>{feature.behavior}</SelectItem>)}</SelectContent>
          </Select>
          <Input aria-label="Next Step comment" value={record.nextStep?.comment ?? ""} disabled={!record.nextStep} placeholder="Optional comment" onChange={(event) => record.nextStep && onChange({ ...record, nextStep: { ...record.nextStep, comment: event.target.value || null } })} />
        </div>
      </StructuredField>
      <TextListEditor title="Results and Verification" items={record.resultsAndVerification} onChange={(items) => onChange({ ...record, resultsAndVerification: items })} />
      <p className="text-xs text-muted-foreground">Each section is saved as a structured Record field. Markdown is generated only for agent-readable presentation.</p>
    </div>
  );
}

function StructuredField({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return <section className="space-y-3 rounded-lg border bg-card/30 p-4"><div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">{title}</h3>{action}</div>{children}</section>;
}

function TextListEditor({ title, items, onChange }: { title: string; items: string[]; onChange: (items: string[]) => void }) {
  return (
    <StructuredField title={title} action={<Button type="button" variant="outline" size="sm" onClick={() => onChange([...items, ""])}><Plus aria-hidden /> Add item</Button>}>
      <div className="space-y-2">{items.length === 0 ? <p className="text-sm text-muted-foreground">Nothing recorded.</p> : items.map((item, index) => <div key={`${title}-${index}`} className="flex gap-2"><Textarea aria-label={`${title} item ${index + 1}`} value={item} onChange={(event) => onChange(items.map((candidate, candidateIndex) => candidateIndex === index ? event.target.value : candidate))} /><Button type="button" variant="ghost" size="icon" aria-label={`Remove ${title} item ${index + 1}`} onClick={() => onChange(items.filter((_, candidateIndex) => candidateIndex !== index))}><Trash2 aria-hidden /></Button></div>)}</div>
    </StructuredField>
  );
}

function PrototypeNotice() {
  return (
    <div className="rounded-md border border-sky-500/25 bg-sky-500/5 px-3 py-2 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">UI/UX prototype.</span>{" "}
      Nothing wakes an agent in this prototype. In the implemented workflow, only Resume task and Final — Wrap up will wake it; edits and feedback only accumulate pending changes.
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
  const statusLabel = executionState === "running" ? "Running" : executionState === "blocked" ? "Needs input" : "Paused";
  const statusDetail = executionState === "running"
    ? checked ? "The agent continues until blocked or ready for final review." : "The agent runs one turn, then returns to Paused."
    : executionState === "blocked"
      ? "Resolve the blocker in chat before resuming the task."
      : "Resume to wake the agent with the current Record revision.";
  const resumeTitle = resumeDisabled
    ? "Save or cancel the Record edit before resuming"
    : executionState === "blocked"
      ? "Resolve the blocker in chat before resuming"
      : "Wake the agent with the current Record revision";

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 rounded-lg border bg-card/30 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2 overflow-hidden">
        <p className="truncate text-sm font-semibold" title="Automatic execution continues through routine steps; Manual returns to Paused after one agent turn.">Automatic execution</p>
        <Badge variant="outline" className={`shrink-0 ${checked ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "text-muted-foreground"}`}>
          {checked ? "Automatic" : "Manual"}
        </Badge>
        <span className="h-4 w-px shrink-0 bg-border" aria-hidden />
        <span className={`size-2 shrink-0 rounded-full ${executionState === "running" ? "bg-emerald-500" : executionState === "blocked" ? "bg-amber-500" : "bg-muted-foreground"}`} aria-hidden />
        <span className="truncate text-sm font-medium" title={statusDetail}>{statusLabel}</span>
        {pendingChanges ? <span className="shrink-0 text-xs text-muted-foreground">· {pendingChanges} pending</span> : null}
      </div>
      <ToggleSwitch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={executionState === "running"}
        aria-label="Toggle automatic task execution"
        title={checked ? "Automatic: continue until blocked or ready for final review" : "Manual: pause after one agent turn"}
      />
      {executionState === "running" ? (
        <Button variant="outline" size="sm" onClick={() => onExecutionStateChange("paused")} title="Pause after the current agent action"><Pause aria-hidden /> Pause task</Button>
      ) : (
        <Button size="sm" disabled={executionState === "blocked" || resumeDisabled} title={resumeTitle} onClick={onResume}><Play aria-hidden /> Resume task</Button>
      )}
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
          <p className="mt-1 text-xs text-muted-foreground">The agent keeps each agreed outcome and state up to date.</p>
        </div>
        <span className="text-xs text-muted-foreground">{features.length} item{features.length === 1 ? "" : "s"}</span>
      </div>
      <div className="overflow-hidden rounded-lg border">
        {features.map((feature, index) => {
          return (
            <div key={feature.id} className="grid gap-3 border-b p-4 last:border-b-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium">{feature.behavior}</p>
                  <Badge variant="outline" className="text-xs text-muted-foreground">{taskRecordFeatureStateLabel(feature.state)}</Badge>
                </div>
              </div>
              <div>
                <p className="text-sm">{feature.outcome || "No agreed outcome recorded."}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function NextStepCard({ record, preview = false }: { record: TaskRecord; preview?: boolean }) {
  const feature = resolveTaskRecordNextStepFeature(record);
  if (!record.nextStep || !feature) return null;
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">Next Step</h3>
        {preview ? <Badge variant="outline" className="text-muted-foreground">Example</Badge> : null}
      </div>
      <div className="rounded-lg border bg-card/30 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">{feature.behavior}</p>
          <Badge variant="outline" className="text-xs text-muted-foreground">
            {taskRecordFeatureStateLabel(feature.state)}
          </Badge>
        </div>
        {record.nextStep.comment ? <p className="mt-2 text-sm text-muted-foreground">{record.nextStep.comment}</p> : null}
      </div>
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
        A living source of truth for agreed behaviors, constraints, decisions, current state, and next step.
      </p>
    </header>
  );
}
