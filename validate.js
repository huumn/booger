import { z } from 'zod'
import * as secp from 'secp'
import { crypto, toHashString } from 'std/crypto/mod.ts'

export const zPrefix = z.string().regex(/^[a-f0-9]{4,64}$/)

export const zId = z.string().regex(/^[a-f0-9]{64}$/)

export const zPubkey = z.string().regex(/^[a-f0-9]{64}$/)

export const zKind = z.number().int().gte(0)

export const zSig = z.string().regex(/^[a-f0-9]{128}$/)

export const zSub = z.string().min(1).max(255)

export const zTime = z.number().int().min(0).max(2147483647)

export const zTag = z.tuple([z.string().max(255)]).rest(z.string().max(1024)) // max(10)?

export const zEvent = z.object({
  id: zId,
  pubkey: zPubkey,
  created_at: zTime,
  kind: zKind,
  tags: z.array(zTag).max(2500),
  content: z.string().max(100 * 1024), // 100 kB
  sig: zSig,
}).refine(async (e) => {
  try {
    return e.id === await eventHash(e)
  } catch {
    return false
  }
}, { message: 'invalid: id not equal to sha256 of note' }).refine(async (e) => {
  try {
    return await secp.schnorr.verify(e.sig, e.id, e.pubkey)
  } catch {
    return false
  }
}, { message: 'invalid: sig does not match pubkey' })

export const zFilter = z.object({
  ids: z.array(zPrefix).max(1000),
  authors: z.array(zPrefix).max(1000),
  kinds: z.array(zKind).max(20),
  since: zTime,
  until: zTime,
  limit: z.number().int().min(0).max(5000),
}).catchall(z.array(z.string().max(1024)).max(256))
  .partial()

export const zFilters = z.array(zFilter)

const zDelegateCond = z.array(
  z.union([
    z.string().regex(/^kind=[0-9]+$/),
    z.string().regex(/^created_at[<>][0-9]+$/),
  ]),
)
export const zDelegate = z.tuple([
  zPubkey,
  z.string().refine((c) => zDelegateCond.safeParse(c.split('&')).success),
  zSig,
]).transform((d) =>
  d[1].split('&').reduce((a, c) => {
    if (c.startsWith('kind=')) {
      a.kinds.push(parseInt(c.slice(5)))
    } else if (c.startsWith('created_at>')) {
      a.from = parseInt(c.slice(11))
    } else if (c.startsWith('created_at<')) {
      a.to = parseInt(c.slice(11))
    }
    return a
  }, { kinds: [] })
)

export async function eventHash({
  pubkey,
  created_at: createdAt,
  kind,
  tags,
  content,
}) {
  return await sha256HexStr(
    JSON.stringify([0, pubkey, createdAt, kind, tags, content]),
  )
}

export async function sha256HexStr(str) {
  return toHashString(
    await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(str),
    ),
  )
}

export async function validateDelgation(kind, createdAt, pubkey, delegation) {
  const { kinds, to, from } = await zDelegate.parseAsync(delegation)

  try {
    await secp.schnorr.verify(
      delegation[2],
      await sha256HexStr(
        ['nostr', 'delegation', pubkey, delegation[1]].join(':'),
      ),
      delegation[0],
    )
  } catch {
    throw new Error('invalid: delegation token sig')
  }

  if (kinds && !kinds.includes(kind)) {
    throw new Error('invalid: not delegated for kind')
  }
  if (to && createdAt > to) {
    throw new Error('invalid: not delegated that far into future')
  }
  if (from && createdAt < from) {
    throw new Error('invalid: not delegated that far into past')
  }
}
