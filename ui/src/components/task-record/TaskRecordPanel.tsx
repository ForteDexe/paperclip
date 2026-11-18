import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { TASK_RECORD_FEATURE_STATES, taskRecordSchema, type Issue, type TaskRecord, type TaskRecordFeature } from "@outpost/shared";
import { Check, FilePenLine, Loader2, Plus, Trash2, X } from "lucide-react";
import { issuesApi } from "@/api/issues";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useTaskRecord } from "@/hooks/useTaskRecord";
import { queryKeys } from "@/lib/queryKeys";
import {
  buildTaskRecord,
  resolveTaskRecordNextStepFeature,
  taskRecordFeatureStateLabel,
} from "./task-record-model";

export function TaskRecordPanel({ issue }: { issue: Issue }) {
  const queryClient = useQueryClient();
  const taskRecordQuery = useTaskRecord(issue.id);
  const current = taskRecordQuery.data;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TaskRecord>(() => buildTaskRecord(issue));

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
      queryClient.setQueryData(queryKeys.issues.taskRecord(issue.id), saved);
      await queryClient.invalidateQueries({ queryKey: queryKeys.issues.documents(issue.id) });
    },
  });

  const record = current?.record ?? draft;
  const draftIsValid = taskRecordSchema.safeParse(draft).success;

  if (taskRecordQuery.isLoading) {
    return <div className="flex min-h-40 items-center justify-center"><Loader2 className="animate-spin" aria-label="Loading Task Record" /></div>;
  }

  if (current === null && !editing) {
    return (
      <div className="space-y-5 py-2">
        <TaskRecordHeader />
        <div className="rounded-lg border border-dashed p-4 text-sm">
          <p className="font-medium">No task record yet</p>
          <p className="mt-1 text-muted-foreground">
            Create one from this task&apos;s current title and description. It stays separate from the conversation and keeps revision history.
          </p>
          <Button
            className="mt-4"
            size="sm"
            onClick={() => save.mutate(buildTaskRecord(issue))}
            disabled={save.isPending}
          >
            {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
            Create task record
          </Button>
        </div>
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
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <FilePenLine aria-hidden /> Edit record
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {current ? `Revision ${current.latestRevisionNumber ?? 1} · Updated ${new Date(current.updatedAt).toLocaleString()}` : "Unsaved draft"}
        </p>
      </header>

      {editing ? (
        <TaskRecordEditor record={draft} onChange={setDraft} />
      ) : (
        <div className="space-y-5">
          <RecordTextSection title="Intent" items={[record.intent]} />
          <FeatureTable features={record.features} />
          {record.constraintsAndNonGoals.length > 0 ? <RecordTextSection title="Constraints and Non-Goals" items={record.constraintsAndNonGoals} list /> : null}
          {record.decisions.length > 0 ? <RecordTextSection title="Decisions" items={record.decisions} list /> : null}
          {record.openQuestions.length > 0 ? <RecordTextSection title="Open Questions" items={record.openQuestions} list /> : null}
          {record.nextStep ? <NextStepCard record={record} /> : null}
          {record.resultsAndVerification.length > 0 ? <RecordTextSection title="Results and Verification" items={record.resultsAndVerification} list /> : null}
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
      validation: null,
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
              <Textarea className="md:col-span-4" aria-label={`Feature ${index + 1} validation`} value={feature.validation ?? ""} placeholder="Validation (leave empty until a run or test exists)" onChange={(event) => updateFeature(index, { validation: event.target.value || null })} />
            </div>
          ))}
        </div>
      </StructuredField>
      <TextListEditor title="Constraints and Non-Goals" items={record.constraintsAndNonGoals} onChange={(items) => onChange({ ...record, constraintsAndNonGoals: items })} />
      <TextListEditor title="Decisions" items={record.decisions} onChange={(items) => onChange({ ...record, decisions: items })} />
      <TextListEditor title="Open Questions" items={record.openQuestions} onChange={(items) => onChange({ ...record, openQuestions: items })} />
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

function FeatureTable({ features }: { features: TaskRecordFeature[] }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Features and Behaviors</h3>
          <p className="mt-1 text-xs text-muted-foreground">The agent keeps each agreed outcome and state up to date.</p>
        </div>
        <span className="text-xs text-muted-foreground">{features.length} item{features.length === 1 ? "" : "s"}</span>
      </div>
      <div className="overflow-hidden rounded-lg border">
        {features.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No features recorded yet.</p>
        ) : features.map((feature) => {
          return (
            <div key={feature.id} className="grid gap-3 border-b p-4 last:border-b-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1fr)]">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium">{feature.behavior}</p>
                  <Badge variant="outline" className="text-xs text-muted-foreground">{taskRecordFeatureStateLabel(feature.state)}</Badge>
                </div>
              </div>
              <div>
                <p className="text-sm">{feature.outcome || "No agreed outcome recorded."}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Validation</p>
                <p className="mt-1 text-sm">{feature.validation || "Not run yet."}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function NextStepCard({ record }: { record: TaskRecord }) {
  const feature = resolveTaskRecordNextStepFeature(record);
  if (!record.nextStep || !feature) return null;
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">Next Step</h3>
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

function TaskRecordTitle() {
  return <h2 className="text-lg font-semibold">Task Record</h2>;
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
