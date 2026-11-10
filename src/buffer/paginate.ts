export type Page<T> = {
  items: T[];
  hasNextPage: boolean;
  endCursor: string | null;
};

export async function collectPages<T>(
  fetchPage: (after: string | null) => Promise<Page<T>>,
  options: { maxPages: number; stop?: (page: Page<T>) => boolean },
): Promise<{ items: T[]; pages: number; truncated: boolean }> {
  const items: T[] = [];
  let after: string | null = null;
  let pages = 0;

  while (pages < options.maxPages) {
    const page = await fetchPage(after);
    pages += 1;
    items.push(...page.items);
    const stopEarly = options.stop?.(page) ?? false;
    if (stopEarly || !page.hasNextPage || !page.endCursor) {
      return { items, pages, truncated: false };
    }
    after = page.endCursor;
  }

  return { items, pages, truncated: true };
}
