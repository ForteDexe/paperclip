import { createHash, randomBytes } from "node:crypto";

export function createArtifactProof() {
  const nonce = randomBytes(12).toString("hex");
  const values = Array.from({ length: 7 }, () => randomBytes(2).readUInt16BE());
  const input = `${JSON.stringify({ nonce, values })}\n`;
  const expected = {
    nonce,
    count: values.length,
    total: values.reduce((sum, value) => sum + value, 0),
    sha256: createHash("sha256").update(input).digest("hex"),
  };
  const followup = {
    nonce,
    minimum: Math.min(...values),
    maximum: Math.max(...values),
    total: expected.total,
  };
  return { input, expected, followup };
}

export function verifyArtifactProof(
  bytes: Buffer,
  expected: Record<string, unknown>,
) {
  try {
    const value = JSON.parse(bytes.toString("utf8"));
    return (
      Object.keys(value).length === Object.keys(expected).length &&
      Object.entries(expected).every(([key, entry]) => value[key] === entry)
    );
  } catch {
    return false;
  }
}

/** Only durable run attribution is accepted; assistant text cannot provide it. */
export function verifyArtifactRun(
  run: Record<string, any>,
  expected: {
    agentId: string;
    connectionId: string;
    method: string;
    runtimeMode: string;
    environmentId: string;
  },
) {
  const connection = run.contextSnapshot?.aiConnection;
  return (
    run.status === "succeeded" &&
    run.agentId === expected.agentId &&
    run.runtimeMode === expected.runtimeMode &&
    connection?.connectionId === expected.connectionId &&
    connection?.method === expected.method &&
    run.contextSnapshot?.outpostEnvironment?.id === expected.environmentId
  );
}
