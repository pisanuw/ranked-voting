// A stand-in for the shared HintWise Supabase project, for the migration tests: real Postgres
// (PGlite, in-process WASM, no network) with the parts of Supabase the migration relies on:
// the anon, authenticated and service_role roles, auth.users and auth.uid(). Each call runs in
// a transaction as one role, with auth.uid() set the way PostgREST sets it from a token.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

export const MIGRATION = readFileSync(new URL('../migrations/0001_app_ranked_voting.sql', import.meta.url), 'utf8')

const SUPABASE_STUB = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email varchar(255));
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
`

export async function freshDb() {
  const db = await PGlite.create()
  await db.exec(SUPABASE_STUB)
  await db.exec(MIGRATION)
  return db
}

/** Runs fn(tx) as `who`: null for an anonymous visitor (anon key), else a signed-in user's id. */
export function as(db, who, fn) {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${who ? 'authenticated' : 'anon'}`)
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [who ?? ''])
    return fn(tx)
  })
}

/** Calls one of the schema's functions as `who` and returns its single value. */
export async function rpc(db, who, sql, params = []) {
  return as(db, who, async (tx) => {
    const res = await tx.query(`select ${sql} as result`, params)
    return res.rows[0]?.result
  })
}

/** The error a call raises (its SQLSTATE in .code), or null when it succeeds. */
export async function failure(promise) {
  try {
    await promise
    return null
  } catch (e) {
    return e
  }
}

export async function addUser(db, email) {
  const id = randomUUID()
  await db.query('insert into auth.users (id, email) values ($1, $2)', [id, email])
  return id
}
