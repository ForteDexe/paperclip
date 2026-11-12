export function runCancellationLabel(input: { grokWork?: boolean; isFailed: boolean; isPending: boolean }): string {
  if (input.grokWork) return input.isPending ? "Stopping Outpost work…" : "Stop Outpost work";
  if (input.isFailed) return input.isPending ? "Stopping…" : "Stop";
  return input.isPending ? "Cancelling…" : "Cancel";
}
