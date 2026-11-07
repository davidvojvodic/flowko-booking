// Flowko U24: pure half-open interval arithmetic for the salon availability engine.
// No imports; inputs are never mutated.

export type Ms = number;
/** Half-open interval [start, end). */
export type Interval = { start: Ms; end: Ms };

/**
 * Flowko U24: drops empty and negative intervals, sorts by start, and merges
 * overlapping AND touching intervals. Returns new objects; input is untouched.
 */
export function normalize(list: Interval[]): Interval[] {
  const sorted = list
    .filter((i) => i.end > i.start)
    .map((i) => ({ start: i.start, end: i.end }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) {
      if (i.end > last.end) last.end = i.end;
    } else {
      out.push(i);
    }
  }
  return out;
}

/** Flowko U24: union of any number of interval lists, normalized. */
export function union(...lists: Interval[][]): Interval[] {
  return normalize(lists.flat());
}

/** Flowko U24: intersection of two interval lists (each normalized internally); result is normalized. */
export function intersect(a: Interval[], b: Interval[]): Interval[] {
  const x = normalize(a);
  const y = normalize(b);
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    const start = Math.max(x[i].start, y[j].start);
    const end = Math.min(x[i].end, y[j].end);
    if (end > start) out.push({ start, end });
    if (x[i].end < y[j].end) i++;
    else j++;
  }
  return out;
}

/** Flowko U24: the parts of `from` not covered by `minus`; result is normalized. */
export function subtract(from: Interval[], minus: Interval[]): Interval[] {
  const holes = normalize(minus);
  const out: Interval[] = [];
  for (const f of normalize(from)) {
    let cursor = f.start;
    for (const h of holes) {
      if (h.end <= cursor) continue;
      if (h.start >= f.end) break;
      if (h.start > cursor) out.push({ start: cursor, end: h.start });
      cursor = Math.max(cursor, h.end);
      if (cursor >= f.end) break;
    }
    if (cursor < f.end) out.push({ start: cursor, end: f.end });
  }
  return out;
}

/** Flowko U24: true when `inner` lies fully inside ONE interval of normalize(outer). */
export function contains(outer: Interval[], inner: Interval): boolean {
  return normalize(outer).some((o) => o.start <= inner.start && inner.end <= o.end);
}

/**
 * Flowko U24: members of `list` as given (not normalized), in input order, that
 * overlap `probe` under half-open semantics (start < probe.end && end > probe.start).
 */
export function overlapping(list: Interval[], probe: Interval): Interval[] {
  return list.filter((i) => i.start < probe.end && i.end > probe.start);
}
