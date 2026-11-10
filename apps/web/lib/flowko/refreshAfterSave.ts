// Flowko U29c: the refresh after a saved write (P1). TanStack's plain invalidate() resolves even when its refetch
// fails, so a failed refresh used to go unnoticed (the next save then carried a stale version and answered „someone
// else changed it“ about the owner's own save). The probe is the query that carries the version, invalidated with
// { throwOnError: true } (it rejects once that query's refetch has failed after its retries). The other
// invalidations only run alongside; their failure changes nothing. A saved result is never undone by a failed
// refresh: the caller shows a „refresh“ notice instead.
export async function refreshAfterSave(
  probe: () => Promise<unknown>,
  others: Array<() => Promise<unknown>>
): Promise<boolean> {
  for (const other of others) {
    try {
      void other().catch(() => undefined);
    } catch {
      // a synchronous failure of an invalidation is as irrelevant as a rejected one
    }
  }
  try {
    await probe();
    return true;
  } catch {
    return false;
  }
}
