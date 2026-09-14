import { Pool } from 'pg'

/**
 * Postgres, for the few things that must outlive a deploy.
 *
 * Most of what this server holds in memory should stay there — an in-flight
 * turn, a rate-limit bucket, a five-minute cache. What cannot stay there is
 * anything a rider has already been shown or has already handed over:
 *
 *   speech   a voice note's URL sits in the rider's thread. When the cache
 *            went with the deploy, that URL 404'd and the bubble stalled.
 *   outbox   a push to the backend that has not landed yet. Losing it loses
 *            a rider's application, which is the one thing we cannot redo.
 *   uploads  a document held between arriving and being accepted upstream.
 *            Thirty minutes in memory is fine until a deploy lands inside it.
 *
 * Without DATABASE_URL everything degrades to memory, so the tests and the
 * offline mock run unchanged.
 */
const URL = process.env.DATABASE_URL ?? ''

export const dbReady = () => Boolean(URL)

const pool = URL
  ? new Pool({
      connectionString: URL,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      /*
       * Railway's private network terminates TLS at the edge; inside it the
       * hostname is internal and the certificate will not match. And a plain
       * `sslmode=disable` in the URL means what it says — without it there was
       * no way to point this at a Postgres on a laptop, which is where the
       * push is easiest to prove.
       */
      ssl:
        URL.includes('railway.internal') || /[?&]sslmode=disable\b/.test(URL)
          ? undefined
          : { rejectUnauthorized: false },
    })
  : null

pool?.on('error', (err) => console.error('postgres pool:', err.message))

/** Runs a query, or returns null if there is no database. Never throws. */
export async function query<T = Record<string, unknown>>(
  text: string,
  values: unknown[] = [],
): Promise<T[] | null> {
  if (!pool) return null
  try {
    const res = await pool.query(text, values)
    return res.rows as T[]
  } catch (err) {
    console.error('postgres:', err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Creates what is missing, every boot. Small enough that a migration tool
 * would be more machinery than the thing it manages.
 */
export async function init() {
  if (!pool) {
    console.log('postgres: no DATABASE_URL, running from memory')
    return
  }

  /**
   * One statement per entry, applied one at a time.
   *
   * They used to be a single query, which Postgres runs in one implicit
   * transaction: one ALTER that could not apply rolled back the entire schema
   * and left the app running from memory, announcing only "schema failed".
   * Which statement, and why, was not recoverable afterwards. Now a failure
   * names itself and costs only its own table.
   */
  const statements = [
    `CREATE TABLE IF NOT EXISTS speech (
      id          text PRIMARY KEY,
      mime        text NOT NULL,
      bytes       bytea NOT NULL,
      said        text NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT now(),
      used_at     timestamptz NOT NULL DEFAULT now()
    )`,

    `CREATE TABLE IF NOT EXISTS outbox (
      id            bigserial PRIMARY KEY,
      application   uuid NOT NULL,
      endpoint      text NOT NULL,
      idempotency   text NOT NULL UNIQUE,
      body          jsonb NOT NULL,
      attempts      int NOT NULL DEFAULT 0,
      next_attempt  timestamptz NOT NULL DEFAULT now(),
      created_at    timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS outbox_due ON outbox (next_attempt)`,
    // What the row carries: a batch of fields, or a document.
    `ALTER TABLE outbox ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'fields'`,
    // Which fields, so they can be marked delivered when it lands.
    `ALTER TABLE outbox ADD COLUMN IF NOT EXISTS fields jsonb NOT NULL DEFAULT '[]'::jsonb`,
    `ALTER TABLE outbox ADD COLUMN IF NOT EXISTS last_error text`,
    `CREATE INDEX IF NOT EXISTS outbox_app ON outbox (application)`,

    `CREATE TABLE IF NOT EXISTS applications (
      id          uuid PRIMARY KEY,
      phone       text,
      full_name   text,
      step        int NOT NULL DEFAULT 0,
      completed   boolean NOT NULL DEFAULT false,
      flow        jsonb NOT NULL,
      history     jsonb NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS applications_phone ON applications (phone, updated_at DESC)`,
    /*
     * What the backend has acknowledged, field by field. "pushed" is the last
     * value it accepted, so the next push carries only what changed;
     * "pushed_at" is when each landed, which is what anyone asking "what has
     * actually reached them?" wants to see.
     */
    `ALTER TABLE applications ADD COLUMN IF NOT EXISTS pushed jsonb NOT NULL DEFAULT '{}'::jsonb`,
    `ALTER TABLE applications ADD COLUMN IF NOT EXISTS pushed_at jsonb NOT NULL DEFAULT '{}'::jsonb`,
    /*
     * The id the Rozeena ingest API hands back on the first call for an
     * application. Every call after it carries this instead of our own id —
     * without somewhere to keep it, each push would create a second candidate.
     */
    `ALTER TABLE applications ADD COLUMN IF NOT EXISTS submission_id bigint`,

    `CREATE TABLE IF NOT EXISTS uploads (
      id          text PRIMARY KEY,
      application uuid,
      kind        text NOT NULL,
      mime        text NOT NULL,
      bytes       bytea NOT NULL,
      sha256      text NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT now()
    )`,
  ]

  let failed = 0
  for (const statement of statements) {
    if ((await query(statement)) === null) {
      failed++
      console.error(`postgres: failed — ${statement.replace(/\s+/g, ' ').slice(0, 100)}`)
    }
  }
  console.log(failed ? `postgres: ${failed} statement(s) failed` : 'postgres: ready')
}

/** Drops what nobody will ask for again. Called on the same sweep as the rest. */
export async function sweep() {
  /*
   * Sixty days, for everything a rider handed over and everything they were
   * told — documents, their voice notes, and the lines Rozeena spoke back.
   *
   * One window rather than three. Documents used to go after a day and voice
   * notes after a month, which meant an application could be looked at in a
   * state it was never in: a thread with the pictures missing, or one where
   * only Rozeena could still be heard. Whatever the window is, both halves of
   * a conversation should reach the end of it together.
   */
  const days = Number(process.env.KEEP_DAYS ?? 60)
  const older = `created_at < now() - ($1 || ' days')::interval`

  await query(`DELETE FROM uploads WHERE ${older}`, [days])
  // Speech is deduplicated by the words, so one row serves every rider who
  // heard that line, and `used_at` moves each time it is played. A line still
  // in use is never swept; this only drops what nobody has needed for sixty
  // days.
  await query(`DELETE FROM speech WHERE used_at < now() - ($1 || ' days')::interval`, [days])
}
