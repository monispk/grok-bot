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
      // Railway's private network terminates TLS at the edge; inside it the
      // hostname is internal and the certificate will not match.
      ssl: URL.includes('railway.internal') ? undefined : { rejectUnauthorized: false },
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
  const ok = await query(`
    CREATE TABLE IF NOT EXISTS speech (
      id          text PRIMARY KEY,
      mime        text NOT NULL,
      bytes       bytea NOT NULL,
      said        text NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT now(),
      used_at     timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS outbox (
      id            bigserial PRIMARY KEY,
      application   uuid NOT NULL,
      endpoint      text NOT NULL,
      idempotency   text NOT NULL UNIQUE,
      body          jsonb NOT NULL,
      attempts      int NOT NULL DEFAULT 0,
      next_attempt  timestamptz NOT NULL DEFAULT now(),
      created_at    timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS outbox_due ON outbox (next_attempt);
    /* What the row is: a batch of fields, a document, or the final submission. */
    ALTER TABLE outbox ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'fields';
    /* Which fields this row carries, so they can be marked when it lands. */
    ALTER TABLE outbox ADD COLUMN IF NOT EXISTS fields jsonb NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE outbox ADD COLUMN IF NOT EXISTS last_error text;
    CREATE INDEX IF NOT EXISTS outbox_app ON outbox (application);

    CREATE TABLE IF NOT EXISTS applications (
      id          uuid PRIMARY KEY,
      phone       text,
      full_name   text,
      step        int NOT NULL DEFAULT 0,
      completed   boolean NOT NULL DEFAULT false,
      flow        jsonb NOT NULL,
      history     jsonb NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS applications_phone ON applications (phone, updated_at DESC);
    /*
     * What the backend has acknowledged, field by field.
     *
     * "pushed" is the last acknowledged value of each field, so the next push
     * can carry only what changed. "pushed_at" is when each was acknowledged,
     * which is what somebody asking "what has actually reached them?" wants to
     * see. Kept beside the application rather than derived from the outbox,
     * because the outbox is emptied and this is the record.
     */
    ALTER TABLE applications ADD COLUMN IF NOT EXISTS pushed jsonb NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE applications ADD COLUMN IF NOT EXISTS pushed_at jsonb NOT NULL DEFAULT '{}'::jsonb;

    CREATE TABLE IF NOT EXISTS uploads (
      id          text PRIMARY KEY,
      application uuid,
      kind        text NOT NULL,
      mime        text NOT NULL,
      bytes       bytea NOT NULL,
      sha256      text NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT now()
    );
  `)
  console.log(ok ? 'postgres: ready' : 'postgres: schema failed, running from memory')
}

/** Drops what nobody will ask for again. Called on the same sweep as the rest. */
export async function sweep() {
  await query(`DELETE FROM speech  WHERE used_at    < now() - interval '30 days'`)
  await query(`DELETE FROM uploads WHERE created_at < now() - interval '24 hours'`)
}
