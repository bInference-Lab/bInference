/** One page of rows numbered in the order recorded, after a row number. */
export type RowPageRead<Row extends { readonly id: number }> = (
  after: number,
  limit: number,
) => Promise<readonly Row[]>;

const pageLimit = 1_000;

/** Every row a paged read answers, page after page, in the order recorded. */
export async function readAllRows<Row extends { readonly id: number }>(
  read: RowPageRead<Row>,
  after = 0,
): Promise<readonly Row[]> {
  const rows = await read(after, pageLimit);
  const last = rows.at(-1);
  return rows.length < pageLimit || last === undefined
    ? rows
    : [...rows, ...(await readAllRows(read, last.id))];
}
