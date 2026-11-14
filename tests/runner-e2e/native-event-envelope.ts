export function isValidNativePrpEnvelope(
  envelope: Record<string, unknown>,
  protocolSchemaVersion: unknown,
) {
  const version = envelope.schemaVersion;
  const validSchema =
    (envelope.schema === "outpost.orp.event.v1" && version === 1) ||
    (envelope.schema === "outpost.orp.event.v2" && version === 2);
  return validSchema && protocolSchemaVersion === version;
}

export interface NativePrpRunBinding {
  runId: string;
  spaceId: string;
  agentId: string;
}

export function isBoundNativePrpEventRow(row: Record<string, any>, binding?: NativePrpRunBinding, sourceInstanceId?: string): boolean {
  const event = row.payload?.orpEvent;
  return Boolean(binding && [binding.runId, binding.spaceId, binding.agentId]
    .every(value => typeof value === "string" && value.trim())
    && event && isValidNativePrpEnvelope(event, row.protocolSchemaVersion)
    && row.runId === binding.runId && row.spaceId === binding.spaceId && row.agentId === binding.agentId
    && event.runId === binding.runId && event.eventType === row.eventType && event.sourceKind === "runner"
    && typeof event.sourceEventId === "string" && event.sourceEventId.trim() && event.sourceEventId === row.sourceEventId
    && typeof event.sourceInstanceId === "string" && event.sourceInstanceId.trim() && event.sourceInstanceId === row.sourceInstanceId
    && (sourceInstanceId === undefined || event.sourceInstanceId === sourceInstanceId)
    && Number.isSafeInteger(event.sourceSeq) && event.sourceSeq > 0 && event.sourceSeq === row.sourceSeq);
}
