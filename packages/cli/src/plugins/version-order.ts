// A semantic version: `major.minor.patch`, a prerelease after `-`, build data after `+`.
const versionPattern = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

const numeric = /^\d+$/;

// One prerelease identifier against another: numbers by value and below words, words by text.
function identifierOrder(left: string, right: string): number {
  const [leftNumber, rightNumber] = [numeric.test(left), numeric.test(right)];
  if (leftNumber && rightNumber) {
    return Math.sign(Number(left) - Number(right));
  }
  if (leftNumber !== rightNumber) {
    return leftNumber ? -1 : 1;
  }
  return left < right ? -1 : Number(left > right);
}

// Prereleases in SemVer's order: none ranks above any, then identifier by identifier.
function prereleaseOrder(left: string | undefined, right: string | undefined): number {
  if (left === undefined || right === undefined) {
    return Number(left === undefined) - Number(right === undefined);
  }
  const [a, b] = [left.split("."), right.split(".")];
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const order = identifierOrder(a[index] ?? "", b[index] ?? "");
    if (order !== 0) {
      return order;
    }
  }
  return Math.sign(a.length - b.length);
}

/**
 * Whether `version` comes before `installed` in SemVer 2.0.0's order: by major, minor and patch,
 * then a prerelease below its release, build data ignored. A version that is not SemVer, as npm
 * never publishes, counts as older, so it always asks for a review.
 */
export function isOlderVersion(version: string, installed: string): boolean {
  const [next, now] = [versionPattern.exec(version), versionPattern.exec(installed)];
  if (next === null || now === null) {
    return true;
  }
  for (const index of [1, 2, 3]) {
    const order = Math.sign(Number(next[index]) - Number(now[index]));
    if (order !== 0) {
      return order < 0;
    }
  }
  return prereleaseOrder(next[4], now[4]) < 0;
}
