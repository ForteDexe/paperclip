import { Fragment } from "react";
import {
  ISSUE_THREAD_INTERACTION_KINDS,
  normalizeIssueThreadInteractionResolverPolicy,
  type InteractionResolverPolicy,
  type IssueThreadInteractionCanonicalResolverPolicy,
  type IssueThreadInteractionKind,
  type IssueThreadInteractionResolverPolicy,
} from "@outpost/shared";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { resolverPolicyLabel } from "../lib/interaction-audience";

const INTERACTION_KIND_LABELS: Record<IssueThreadInteractionKind, string> = {
  suggest_tasks: "Suggested tasks",
  ask_user_questions: "Ask user questions",
  request_confirmation: "Confirmations",
  request_checkbox_confirmation: "Checkbox confirmations",
  request_item_verdicts: "Item verdicts",
  connection_intent: "Connection requests",
};

/**
 * Sentinel for "no override" — Radix Select disallows empty-string item values.
 * Under the open-default contract (PAP-17280) an absent override *is* the open
 * audience, so this sentinel is what a space sees selected until it
 * deliberately narrows a kind.
 */
export const APPROVALS_UNSET = "default";
export type PolicySelectValue = typeof APPROVALS_UNSET | IssueThreadInteractionResolverPolicy;

export type PolicyField = "defaultPolicy" | "cap";

/**
 * Only *narrowing* policies are offered. `anyone` is the product default, so
 * requesting it as a default override is a no-op, and capping at `anyone` cannot
 * narrow anything — both collapse into the unset sentinel, which is presented as
 * the visible default.
 */
const NARROWING_POLICIES: readonly IssueThreadInteractionCanonicalResolverPolicy[] = [
  "not_creator",
  "human_only",
];

const UNSET_LABELS: Record<PolicyField, string> = {
  defaultPolicy: "Anyone (default)",
  cap: "No cap",
};

const UNSET_EFFECTS: Record<PolicyField, string> = {
  defaultPolicy: "New cards are open — the operator or any agent can respond, including the one that asked.",
  cap: "A request keeps whatever audience it asks for.",
};

const DEFAULT_POLICY_EFFECTS: Record<IssueThreadInteractionCanonicalResolverPolicy, string> = {
  anyone: UNSET_EFFECTS.defaultPolicy,
  not_creator: "New cards exclude the agent that created them, so the answer comes from someone else.",
  human_only: "New cards wait for a person on the operator. Agents are turned away.",
};

const CAP_EFFECTS: Record<IssueThreadInteractionCanonicalResolverPolicy, string> = {
  anyone: UNSET_EFFECTS.cap,
  not_creator: "Even a card that asks for Anyone is narrowed to exclude its creator.",
  human_only: "Every card of this kind waits for a person, whatever it asked for.",
};

function policyOptions(field: PolicyField): {
  value: PolicySelectValue;
  label: string;
  effect: string;
}[] {
  const effects = field === "cap" ? CAP_EFFECTS : DEFAULT_POLICY_EFFECTS;
  return [
    { value: APPROVALS_UNSET, label: UNSET_LABELS[field], effect: UNSET_EFFECTS[field] },
    ...NARROWING_POLICIES.map((policy) => ({
      value: policy as PolicySelectValue,
      label: resolverPolicyLabel(policy),
      effect: effects[policy],
    })),
  ];
}

/**
 * The label a *closed* trigger must show. Derived from the value rather than
 * looked up in the option list so an out-of-list value (a raw `anyone`, say)
 * still renders a complete, truthful label instead of falling back to a lie.
 */
export function policyValueLabel(field: PolicyField, value: PolicySelectValue): string {
  return value === APPROVALS_UNSET ? UNSET_LABELS[field] : resolverPolicyLabel(value);
}

/**
 * Map a persisted override onto a select value. A stored `anyone` — including
 * the deprecated `operator_or_agents` alias — is the open default, so it shows as
 * the unset sentinel rather than as a narrowing override.
 */
export function toPolicySelectValue(
  policy: IssueThreadInteractionResolverPolicy | undefined,
): PolicySelectValue {
  if (!policy) return APPROVALS_UNSET;
  const canonical = normalizeIssueThreadInteractionResolverPolicy(policy);
  return canonical === "anyone" ? APPROVALS_UNSET : canonical;
}

/**
 * Apply a single (kind, field) change to a policy map immutably, pruning
 * empty entries so the persisted object stays sparse (only real overrides).
 */
export function applyPolicyChange(
  current: InteractionResolverPolicy,
  kind: IssueThreadInteractionKind,
  field: PolicyField,
  value: PolicySelectValue,
): InteractionResolverPolicy {
  const next: InteractionResolverPolicy = { ...current };
  const entry = { ...(next[kind] ?? {}) };
  if (value === APPROVALS_UNSET) {
    delete entry[field];
  } else {
    entry[field] = value;
  }
  if (entry.defaultPolicy === undefined && entry.cap === undefined) {
    delete next[kind];
  } else {
    next[kind] = entry;
  }
  return next;
}

function PolicySelect({
  field,
  value,
  onChange,
  disabled,
  testId,
  ariaLabel,
  mobileLabel,
}: {
  field: PolicyField;
  value: PolicySelectValue;
  onChange: (value: PolicySelectValue) => void;
  disabled?: boolean;
  testId?: string;
  ariaLabel: string;
  mobileLabel: string;
}) {
  const options = policyOptions(field);
  return (
    <div className="min-w-0">
      {/*
       * Below `sm` the policy grid collapses to a single column (see the
       * grid classes on the panel), detaching each select from its column
       * header. Surface a mobile-only inline label so the control stays
       * self-describing for sighted users, and always carry `aria-label` for
       * screen-reader pairing. WCAG 2.1 SC 1.4.10 (Reflow) — design review R2.
       */}
      <span className="mb-1 block text-xs font-medium text-muted-foreground uppercase tracking-wide sm:hidden">
        {mobileLabel}
      </span>
      <Select value={value} onValueChange={(v) => onChange(v as PolicySelectValue)} disabled={disabled}>
        <SelectTrigger
          size="sm"
          aria-label={ariaLabel}
          // 208px is sized for the longest label the control can hold —
          // `Anyone except creator` needs ~150px of text room, and 170px only
          // left 122px after padding, gap and chevron, so it clipped even once
          // the effect sentence was gone (PAP-17297).
          className="w-full min-w-0 text-xs sm:w-(--sz-208px)"
          data-testid={testId}
        >
          {/*
           * Explicit children, not the default `<SelectValue />`. Radix portals
           * the selected item's *whole* subtree into an empty value node, which
           * dragged each option's effect sentence into the closed trigger and
           * clipped the selected label (desktop truncated the prose, mobile cut
           * `Anyone (default)` mid-label — PAP-17293/PAP-17297). Passing children
           * sets `valueNodeHasChildren`, which suppresses that portal, so the
           * trigger shows exactly the label and nothing else.
           */}
          <SelectValue>{policyValueLabel(field, value)}</SelectValue>
        </SelectTrigger>
        {/*
         * Cap the option list so the effect sentences wrap instead of stretching
         * the popover past a ~390px viewport (WCAG 2.1 SC 1.4.10 Reflow).
         */}
        <SelectContent className="max-w-(--sz-280px) sm:max-w-(--sz-360px)">
          {options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              // Keyboard typeahead matches on `textValue` when given; without it
              // Radix would match against the effect prose too.
              textValue={option.label}
              className="text-xs"
            >
              {/*
               * Effect preview lives inside the option so the consequence of a
               * narrowing choice is legible at the moment of choosing, not only
               * after saving (PAP-17280).
               */}
              <span className="flex min-w-0 flex-col gap-0.5">
                <span>{option.label}</span>
                <span className="text-(length:--text-micro) text-muted-foreground">
                  {option.effect}
                </span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * Space-level interaction policy: the per-kind default audience and cap.
 *
 * The open default is the headline — interactions are resolvable by anyone in
 * the space unless a row here narrows them — so the panel only offers
 * narrowing choices and never presents an unrestricted card as operator-required
 * (PAP-17280, contract in `doc/execution-semantics.md`, "Issue-thread
 * interaction resolution").
 */
export function InteractionPolicyPanel({
  policy,
  onChange,
  isPending,
  errorMessage,
}: {
  policy: InteractionResolverPolicy;
  onChange: (kind: IssueThreadInteractionKind, field: PolicyField, value: PolicySelectValue) => void;
  isPending?: boolean;
  errorMessage?: string | null;
}) {
  return (
    <div className="space-y-4" data-testid="outpost-settings-interaction-policy-section">
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Interaction policy
      </div>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Thread interactions are open by default:{" "}
          <span className="font-medium text-foreground">Anyone</span> in the outpost — the
          operator or any agent, including the one that asked — can respond. Narrow a kind
          only when you need to.{" "}
          <span className="font-medium text-foreground">Default policy</span> is the
          audience new cards get when the requester does not ask for one;{" "}
          <span className="font-medium text-foreground">Cap</span> narrows every request of
          that kind and can never widen one. Tool-approval confirmations always stay{" "}
          <span className="font-medium text-foreground">Human only</span>.
        </p>
        {/*
         * Responsive: below `sm` the row collapses to a single column so the
         * two 170px selects never force horizontal overflow on a ~390px
         * viewport (WCAG 2.1 SC 1.4.10 Reflow — design review R2). Each kind
         * then stacks as: label → Default policy → Cap, each full-width with
         * its own inline label. At `sm`+ it restores the aligned 3-col grid.
         */}
        <div className="grid grid-cols-1 gap-y-4 sm:grid-cols-[1fr_auto_auto] sm:items-center sm:gap-x-4 sm:gap-y-2.5">
          <div className="hidden text-xs font-medium text-muted-foreground uppercase tracking-wide sm:block">
            Kind
          </div>
          <div className="hidden text-xs font-medium text-muted-foreground uppercase tracking-wide sm:block">
            Default policy
          </div>
          <div className="hidden text-xs font-medium text-muted-foreground uppercase tracking-wide sm:block">
            Cap
          </div>
          {ISSUE_THREAD_INTERACTION_KINDS.map((kind) => {
            const entry = policy[kind] ?? {};
            const kindLabel = INTERACTION_KIND_LABELS[kind];
            return (
              <Fragment key={kind}>
                <div className="text-sm font-medium sm:font-normal">{kindLabel}</div>
                <PolicySelect
                  field="defaultPolicy"
                  testId={`policy-${kind}-default`}
                  ariaLabel={`Default resolver audience for ${kindLabel}`}
                  mobileLabel="Default policy"
                  value={toPolicySelectValue(entry.defaultPolicy)}
                  disabled={isPending}
                  onChange={(v) => onChange(kind, "defaultPolicy", v)}
                />
                <PolicySelect
                  field="cap"
                  testId={`policy-${kind}-cap`}
                  ariaLabel={`Resolver cap for ${kindLabel}`}
                  mobileLabel="Cap"
                  value={toPolicySelectValue(entry.cap)}
                  disabled={isPending}
                  onChange={(v) => onChange(kind, "cap", v)}
                />
              </Fragment>
            );
          })}
        </div>
        {errorMessage ? (
          <span className="text-xs text-destructive">{errorMessage}</span>
        ) : null}
      </div>
    </div>
  );
}
