// Decide which node:test isolation-related flag (if any) a given Node
// runtime supports, and what to actually pass on the command line.
//
// This exists as its own tiny, pure, testable module because the
// previous two attempts at this logic broke in production: a
// version-number heuristic (`minor < 23`) and a feature-detection
// attempt via process.allowedNodeEnvironmentFlags both picked the wrong
// answer for Node 22.23.2 — a real, currently-supported runtime — and
// each cost a full commit-push-wait-diagnose cycle to catch. Comparing
// version *strings* or a flag registry meant for NODE_OPTIONS is not
// reliable; comparing the three numeric components against the known
// minimum (22.8.0) is. See CONTRIBUTING.md "Running the tests".

/**
 * @param {string} versionString e.g. "22.23.2" (usually process.versions.node)
 * @returns {[number, number, number]}
 */
export function parseNodeVersion(versionString) {
  const parts = versionString.trim().split('.').map((p) => Number.parseInt(p, 10));
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) {
    throw new Error(`isolation-flag: cannot parse Node version "${versionString}"`);
  }
  return [parts[0], parts[1], parts[2]];
}

/** Numeric [major, minor, patch] comparison. Returns -1, 0, or 1. */
export function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

const MIN_VERSION_WITH_ISOLATION_NONE = [22, 8, 0];

/**
 * @param {string} versionString process.versions.node
 * @returns {{ supported: true, flag: string } | { supported: false, reason: string }}
 */
export function pickIsolationFlag(versionString) {
  const version = parseNodeVersion(versionString);
  if (compareVersions(version, MIN_VERSION_WITH_ISOLATION_NONE) >= 0) {
    return { supported: true, flag: '--test-isolation=none' };
  }
  return {
    supported: false,
    reason:
      `Node ${versionString} is older than 22.8.0, which is where ` +
      `node:test's --test-isolation=none landed.`,
  };
}
