const SEMVER_RE =
  /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function parseSemver(version) {
  const m = SEMVER_RE.exec(String(version).trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ? m[4].split(".") : [],
    raw: version,
  };
}

function isNumericIdentifier(id) {
  return /^\d+$/.test(id);
}

/** Compares two prerelease identifier arrays per semver.org §11.4. */
function comparePrerelease(a, b) {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1; // no prerelease > has prerelease
  if (b.length === 0) return -1;

  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1; // fewer fields = lower precedence
    if (y === undefined) return 1;

    const xNum = isNumericIdentifier(x);
    const yNum = isNumericIdentifier(y);

    if (xNum && yNum) {
      const diff = Number(x) - Number(y);
      if (diff !== 0) return diff < 0 ? -1 : 1;
      continue;
    }
    if (xNum !== yNum) return xNum ? -1 : 1; // numeric < alphanumeric
    if (x === y) continue;
    return x < y ? -1 : 1; // ASCII lexical order
  }
  return 0;
}

/** -1 / 0 / 1, per SemVer 2.0.0 precedence. Falls back to string compare for non-SemVer input. */
function semverCompare(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);

  if (!pa && !pb) return String(a).localeCompare(String(b));
  if (!pa) return 1; // malformed sorts after well-formed
  if (!pb) return -1;

  if (pa.major !== pb.major) return pa.major - pb.major < 0 ? -1 : 1;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor < 0 ? -1 : 1;
  if (pa.patch !== pb.patch) return pa.patch - pb.patch < 0 ? -1 : 1;
  return comparePrerelease(pa.prerelease, pb.prerelease);
}

/** Descending-order comparator (for sort()): malformed versions always sort last, regardless of direction. */
function compareVersionsDesc(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa && !pb) return String(a).localeCompare(String(b));
  if (!pa) return 1;
  if (!pb) return -1;
  return semverCompare(b, a);
}

/** Convenience: sort an array of version strings newest-first. */
function sortVersionsDesc(versions) {
  return [...versions].sort(compareVersionsDesc);
}
