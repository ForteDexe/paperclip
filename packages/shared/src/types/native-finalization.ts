export type NativeRuntimeMode = "legacy" | "native";
export const NATIVE_FINALIZATION_SCHEMA = "outpost.native-finalization.v1" as const;
export type NativeReportedWorkDisposition = "done" | "blocked" | "needs_review" | "yielded";
export type NativeRunTerminalState = "succeeded" | "failed" | "cancelled";

export interface NativeFinalizationResultV1 {
  schema: typeof NATIVE_FINALIZATION_SCHEMA;
  runtimeMode: "native";
  runId: string;
  issueId: string;
  spaceId: string;
  result: Record<string, unknown>;
  terminal: {
    schema: "outpost.orp.terminal.v1";
    turnTerminalState: "completed" | "failed" | "interrupted" | "cancelled";
    runTerminalState: NativeRunTerminalState;
    reportedWorkDisposition: NativeReportedWorkDisposition;
  };
  turnId: string | null;
  sourceInstanceId: string;
  normalizedSessionId: string;
  providerSessionId: string | null;
  driverKind: string;
  driverVersion: string;
  nativeEventCount: number;
  highestContiguousSourceSeq: number;
  workspaceFinalizeStatus: "pending" | "succeeded" | "failed";
}

export type NativeFinalizationResult = NativeFinalizationResultV1;
