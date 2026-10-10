import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full. The realized P&L is a
// decimal string of micro-dollars, at most 78 digits after one optional minus sign, with no
// leading zero and never "-0".
const sql = `
ALTER TABLE executions ADD COLUMN realized_usd_micros TEXT NOT NULL DEFAULT '0' CHECK (
  ltrim(realized_usd_micros, '-') != ''
  AND ltrim(realized_usd_micros, '-') NOT GLOB '*[^0-9]*'
  AND (ltrim(realized_usd_micros, '-') = '0' OR ltrim(realized_usd_micros, '-') NOT GLOB '0*')
  AND realized_usd_micros NOT GLOB '--*'
  AND realized_usd_micros != '-0'
  AND length(realized_usd_micros) <= 79
);
`;

/**
 * Adds `executions.realized_usd_micros`: the profit or loss an execution realized at average cost
 * when it was recorded, below zero for a loss, which `portfolio/pnl` sums (decision 0137). An
 * execution recorded before has none kept, and counts 0.
 */
export const migration: Migration = {
  name: "0017_execution_realized",
  up(database) {
    database.exec(sql);
  },
};
