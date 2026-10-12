import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full. SQLite cannot change a
// CHECK in place, so `orders` is made again, and `order_fills`, whose rows name it, with it: the
// new tables first, the rows copied, the old tables dropped child first, then renamed, all in the
// migration's one transaction with foreign keys on. No release wrote an order before; one that
// exists anyway stays as an ended order of an intent that is not stored, never active.
const sql = `
CREATE TABLE orders_new (
  id TEXT PRIMARY KEY NOT NULL,
  agent_id TEXT NOT NULL REFERENCES agents (id),
  wallet_id TEXT NOT NULL REFERENCES wallets (id),
  kind TEXT NOT NULL CHECK (
    kind IN ('limit', 'takeProfit', 'stopLoss', 'trailing', 'dca', 'copy')
  ),
  state TEXT NOT NULL CHECK (
    state IN (
      'awaiting_confirmation', 'active', 'paused', 'filled', 'cancelled', 'expired', 'ended'
    )
  ),
  request TEXT NOT NULL CHECK (json_valid(request)),
  trigger_state TEXT CHECK (json_valid(trigger_state)),
  fills INTEGER NOT NULL DEFAULT 0 CHECK (fills >= 0),
  max_fills INTEGER CHECK (max_fills >= 1),
  expires_at INTEGER NOT NULL,
  intent_id TEXT NOT NULL,
  card_id TEXT REFERENCES cards (id),
  paper INTEGER NOT NULL CHECK (paper IN (0, 1)),
  outside_content INTEGER NOT NULL CHECK (outside_content IN (0, 1)),
  end_reason TEXT CHECK (end_reason IN ('position_closed')),
  expiry_noticed_at INTEGER,
  created_at INTEGER NOT NULL,
  changed_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  CHECK (end_reason IS NULL OR state = 'ended'),
  CHECK (state NOT IN ('active', 'paused', 'filled') OR card_id IS NOT NULL)
) STRICT;

INSERT INTO orders_new (
  id, agent_id, wallet_id, kind, state, request, trigger_state, fills, max_fills, expires_at,
  intent_id, card_id, paper, outside_content, end_reason, expiry_noticed_at, created_at,
  changed_at, version
)
SELECT
  id, agent_id, wallet_id, kind, 'cancelled', request, trigger_state, fills, max_fills,
  coalesce(expires_at, created_at), 'int_' || substr(id, 5), card_id, 0, 1, NULL, NULL,
  created_at, changed_at, version
FROM orders;

CREATE TABLE order_fills_new (
  id TEXT PRIMARY KEY NOT NULL,
  order_id TEXT NOT NULL REFERENCES orders_new (id),
  intent_id TEXT REFERENCES intents (id),
  outcome TEXT NOT NULL CHECK (outcome IN ('filled', 'skipped')),
  reason TEXT,
  at INTEGER NOT NULL
) STRICT;

INSERT INTO order_fills_new (id, order_id, intent_id, outcome, reason, at)
SELECT id, order_id, intent_id, outcome, reason, at FROM order_fills;

DROP TABLE order_fills;
DROP TABLE orders;
ALTER TABLE orders_new RENAME TO orders;
ALTER TABLE order_fills_new RENAME TO order_fills;

CREATE INDEX orders_state_agent ON orders (state, agent_id);
CREATE UNIQUE INDEX orders_intent ON orders (intent_id);
CREATE INDEX orders_position ON orders (wallet_id, paper, state);
CREATE INDEX order_fills_order_at ON order_fills (order_id, at);
`;

/**
 * Makes `orders` again for auto orders confirmed on a card (decision 0189): the `paused` state,
 * `intent_id` (the `autoOrder` intent that carries the card), `paper`, `outside_content`,
 * `end_reason` and `expiry_noticed_at`, a required expiry, and checks that only a confirmed order
 * is active, paused or filled. `order_fills` is made again beside it.
 */
export const migration: Migration = {
  name: "0031_order_cards",
  up(database) {
    database.exec(sql);
  },
};
