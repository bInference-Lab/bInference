import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full. The new tables first,
// the rows copied, the old tables dropped child first, then renamed, as on SQLite, so the
// columns keep their order; the key's index takes the table's name back. An order stored before
// stays as an ended order of an intent that is not stored, never active.
const sql = `
CREATE TABLE orders_new (
  id text COLLATE "C" PRIMARY KEY NOT NULL,
  agent_id text COLLATE "C" NOT NULL REFERENCES agents (id),
  wallet_id text COLLATE "C" NOT NULL REFERENCES wallets (id),
  kind text COLLATE "C" NOT NULL CHECK (
    kind IN ('limit', 'takeProfit', 'stopLoss', 'trailing', 'dca', 'copy')
  ),
  state text COLLATE "C" NOT NULL CHECK (
    state IN (
      'awaiting_confirmation', 'active', 'paused', 'filled', 'cancelled', 'expired', 'ended'
    )
  ),
  request text COLLATE "C" NOT NULL CHECK (request IS JSON),
  trigger_state text COLLATE "C" CHECK (trigger_state IS JSON),
  fills bigint NOT NULL DEFAULT 0 CHECK (fills >= 0),
  max_fills bigint CHECK (max_fills >= 1),
  expires_at bigint NOT NULL,
  intent_id text COLLATE "C" NOT NULL,
  card_id text COLLATE "C" REFERENCES cards (id),
  paper smallint NOT NULL CHECK (paper IN (0, 1)),
  outside_content smallint NOT NULL CHECK (outside_content IN (0, 1)),
  end_reason text COLLATE "C" CHECK (end_reason IN ('position_closed')),
  expiry_noticed_at bigint,
  created_at bigint NOT NULL,
  changed_at bigint NOT NULL,
  version bigint NOT NULL DEFAULT 0,
  CHECK (end_reason IS NULL OR state = 'ended'),
  CHECK (state NOT IN ('active', 'paused', 'filled') OR card_id IS NOT NULL)
);

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
  id text COLLATE "C" PRIMARY KEY NOT NULL,
  order_id text COLLATE "C" NOT NULL REFERENCES orders_new (id),
  intent_id text COLLATE "C" REFERENCES intents (id),
  outcome text COLLATE "C" NOT NULL CHECK (outcome IN ('filled', 'skipped')),
  reason text COLLATE "C",
  at bigint NOT NULL
);

INSERT INTO order_fills_new (id, order_id, intent_id, outcome, reason, at)
SELECT id, order_id, intent_id, outcome, reason, at FROM order_fills;

DROP TABLE order_fills;
DROP TABLE orders;
ALTER TABLE orders_new RENAME TO orders;
ALTER TABLE order_fills_new RENAME TO order_fills;
ALTER INDEX orders_new_pkey RENAME TO orders_pkey;
ALTER INDEX order_fills_new_pkey RENAME TO order_fills_pkey;

CREATE INDEX orders_state_agent ON orders (state, agent_id);
CREATE UNIQUE INDEX orders_intent ON orders (intent_id);
CREATE INDEX orders_position ON orders (wallet_id, paper, state);
CREATE INDEX order_fills_order_at ON order_fills (order_id, at);
`;

/**
 * Makes `orders` again with its kind, its intent, its card, paper and the outside-content mark, and
 * `order_fills` with it, as engine 0031 does.
 */
export const migration: PostgresMigration = { name: "0031_order_cards", sql };
