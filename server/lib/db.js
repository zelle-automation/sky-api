import { Pool, types } from "pg";

// Return DATE columns as "YYYY-MM-DD" (no timezone shifts), and numeric/bigint as numbers.
types.setTypeParser(1082, (v) => v);
types.setTypeParser(1700, (v) => parseFloat(v));
types.setTypeParser(20, (v) => parseInt(v, 10));

export const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });

export async function query(text, params = []) {
  const res = await pool.query(text, params);
  return res.rows;
}

export async function one(text, params = []) {
  return (await query(text, params))[0] ?? null;
}

/** Runs `fn` inside a transaction; rolls back on any thrown error. */
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
