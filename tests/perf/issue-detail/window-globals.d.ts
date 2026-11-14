export {};

// Mirrors the declarations in ui/src/lib/issue-detail-performance.ts, which these specs set from init scripts.
declare global {
  interface Window {
    __OUTPOST_ISSUE_DETAIL_NAVIGATE_START__?: number;
    __OUTPOST_ISSUE_DETAIL_PROFILE__?: boolean;
  }
}
