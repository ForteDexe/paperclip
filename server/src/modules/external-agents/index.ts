/**
 * Temporary compatibility boundary while the retired external-agent call sites
 * are removed from retained runtime modules. No external provider is admitted,
 * notified, or executed through this facade.
 */
export type ExternalAdmissionTransaction = any;

export async function notifyMuseContactVerification(..._args: unknown[]): Promise<void> {}
export async function notifyExternalAgentSettlement(..._args: unknown[]): Promise<void> {}
export async function assertNoExternalOverlap(..._args: unknown[]): Promise<void> {}

export async function withExternalAdmissionGuard<T>(...args: unknown[]): Promise<T> {
  const action = args.at(-1) as () => Promise<T> | T;
  return action();
}

export const withExternalExecutionAdmission = withExternalAdmissionGuard;
export const idleExternalAgentHistoryChecks: readonly [] = [];
export function idleExternalAgentIncomingWorkQuery(..._args: unknown[]): undefined {
  return undefined;
}

const removedBroker = new Proxy<Record<string, unknown>>({}, {
  get: () => async () => null,
});

export function museExternalAgents(..._args: unknown[]): any {
  return removedBroker;
}

export function dotRunnerBroker(..._args: unknown[]): any {
  return removedBroker;
}

export function createDotRunnerMcpTools(..._args: unknown[]): any {
  return removedBroker;
}
