export interface DevicePrivateInput {
  userId: string;
  spaceName: string;
}

/** Only the owned issuer's exact device-code UI is allowed, never arbitrary
 * navigation. The current code and complete URL remain private worker input. */
export function validDevicePrivateInput(
  mode: string,
  baseURL: string,
  setupURL: string,
  spaceId: unknown,
  device: DevicePrivateInput | undefined,
  userCode: string,
) {
  try {
    const base = new URL(baseURL), setup = new URL(setupURL);
    return ["device-approve", "device-expired"].includes(mode)
      && base.protocol === "http:" && base.hostname === "127.0.0.1"
      && !base.username && !base.password && base.pathname === "/" && !base.search && !base.hash
      && setup.origin === base.origin && !setup.username && !setup.password
      && setup.pathname === "/mcp-device" && !setup.hash
      && setup.searchParams.size === 1 && setup.searchParams.get("user_code") === userCode
      && /^[A-Za-z0-9 -]{8,12}$/.test(userCode)
      && typeof spaceId === "string" && /^[a-f0-9-]{36}$/i.test(spaceId)
      && !!device && typeof device.userId === "string" && device.userId.length > 0 && device.userId.length <= 256
      && typeof device.spaceName === "string" && device.spaceName.trim().length > 0 && device.spaceName.length <= 256
      && !/[\r\n]/.test(device.userId + device.spaceName);
  } catch { return false; }
}

export function matchesDevicePrivateReceipt(mode: string, value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const receipt = value as Record<string, unknown>;
  const expected = {
    processIsolation: true, testRunnerAttached: false, tracingEnabled: false,
    videoEnabled: false, apiStepRecorder: false, deviceSessionVerified: true,
    ...(mode === "device-approve" ? {
      currentCodeVisible: true, spaceConsentVisible: true, readScopeVisible: true,
      humanApproved: true,
    } : mode === "device-expired" ? { expiredPageVisible: true } : {}),
  };
  return ["device-approve", "device-expired"].includes(mode)
    && Object.keys(receipt).length === Object.keys(expected).length
    && Object.entries(expected).every(([key, expectedValue]) => receipt[key] === expectedValue);
}
