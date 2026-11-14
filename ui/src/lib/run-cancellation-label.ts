export function runCancellationLabel(input: { isFailed: boolean; isPending: boolean }): string {
  if (input.isFailed) return input.isPending ? "Stopping…" : "Stop";
  return input.isPending ? "Cancelling…" : "Cancel";
}
