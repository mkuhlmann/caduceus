/**
 * Web Push, without a library: the message is encrypted for the browser (RFC 8291, `aes128gcm`) and the relay
 * identifies itself with VAPID (RFC 8292). The browser's push service (FCM for Chrome, Mozilla's, Apple's) only
 * carries the encrypted bytes; it never sees what a notice says.
 */

const utf8 = new TextEncoder()

type Bytes = Uint8Array<ArrayBuffer>

export const b64url = (b: Uint8Array) => Buffer.from(b).toString('base64url')
export const fromB64url = (s: string): Bytes => new Uint8Array(Buffer.from(s, 'base64url'))

/** The relay's VAPID key pair: the public half as the browser takes it (raw, base64url), the private one as a JWK. */
export type Vapid = { publicKey: string; privateJwk: JsonWebKey }

/** A browser's push subscription, as `PushSubscription.toJSON()` gives it. */
export type PushTarget = { endpoint: string; keys: { p256dh: string; auth: string } }

export async function createVapid(): Promise<Vapid> {
	const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
		'sign',
		'verify',
	])) as CryptoKeyPair
	const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
	return { publicKey: b64url(raw), privateJwk: await crypto.subtle.exportKey('jwk', pair.privateKey) }
}

function concat(...parts: Uint8Array[]): Bytes {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
	let at = 0
	for (const p of parts) {
		out.set(p, at)
		at += p.length
	}
	return out
}

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, bytes: number) {
	const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
	return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8))
}

const RECORD_SIZE = 4096

/**
 * Encrypt one message for a subscription: one `aes128gcm` record whose header carries the salt and the relay's
 * one-time public key. `salt` and `local` are for tests; every real message gets fresh ones.
 */
export async function encrypt(
	payload: Bytes,
	keys: PushTarget['keys'],
	salt: Bytes = crypto.getRandomValues(new Uint8Array(16)),
	local?: CryptoKeyPair,
): Promise<Bytes> {
	const uaPublic = fromB64url(keys.p256dh)
	const auth = fromB64url(keys.auth)
	const own =
		local ??
		((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair)
	const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', own.publicKey))
	const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
	const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, own.privateKey, 256))

	const ikm = await hkdf(auth, shared, concat(utf8.encode('WebPush: info\0'), uaPublic, asPublic), 32)
	const cek = await hkdf(salt, ikm, utf8.encode('Content-Encoding: aes128gcm\0'), 16)
	const nonce = await hkdf(salt, ikm, utf8.encode('Content-Encoding: nonce\0'), 12)
	const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
	// The one and last record: the payload, then the delimiter 0x02 and no padding.
	const sealed = new Uint8Array(
		await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(payload, new Uint8Array([2]))),
	)
	const header = new Uint8Array(21 + asPublic.length)
	header.set(salt, 0)
	new DataView(header.buffer).setUint32(16, RECORD_SIZE)
	header[20] = asPublic.length
	header.set(asPublic, 21)
	return concat(header, sealed)
}

const signingKeys = new WeakMap<Vapid, Promise<CryptoKey>>()

/** The `Authorization` header for one push service: a JWT for its origin, signed with the relay's VAPID key. */
export async function vapidAuthorization(endpoint: string, vapid: Vapid, subject: string, now = Date.now()) {
	let key = signingKeys.get(vapid)
	if (!key) {
		key = crypto.subtle.importKey('jwk', vapid.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
		signingKeys.set(vapid, key)
	}
	const part = (o: object) => b64url(utf8.encode(JSON.stringify(o)))
	const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({
		aud: new URL(endpoint).origin,
		exp: Math.floor(now / 1000) + 12 * 3600,
		sub: subject,
	})}`
	const sig = new Uint8Array(
		await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await key, utf8.encode(unsigned)),
	)
	return `vapid t=${unsigned}.${b64url(sig)}, k=${vapid.publicKey}`
}

export type PushOptions = {
	/** Seconds the push service keeps the message for a device that is offline. */
	ttl: number
	urgency: 'very-low' | 'low' | 'normal' | 'high'
	/** A message waiting for an offline device is replaced by a newer one with the same topic. */
	topic?: string
}

/** What came of one push: `gone` means the subscription no longer exists and should be forgotten. */
export type PushOutcome = { result: 'sent' | 'gone' | 'failed'; status: number; detail?: string }

export async function sendPush(
	target: PushTarget,
	payload: string,
	vapid: Vapid,
	subject: string,
	opts: PushOptions,
): Promise<PushOutcome> {
	try {
		const body = await encrypt(utf8.encode(payload), target.keys)
		const headers: Record<string, string> = {
			Authorization: await vapidAuthorization(target.endpoint, vapid, subject),
			TTL: String(opts.ttl),
			Urgency: opts.urgency,
			'Content-Encoding': 'aes128gcm',
			'Content-Type': 'application/octet-stream',
		}
		if (opts.topic) headers.Topic = opts.topic
		const res = await fetch(target.endpoint, { method: 'POST', headers, body, signal: AbortSignal.timeout(15_000) })
		if (res.ok) {
			await res.body?.cancel()
			return { result: 'sent', status: res.status }
		}
		const detail = (await res.text().catch(() => '')).slice(0, 300)
		return { result: res.status === 404 || res.status === 410 ? 'gone' : 'failed', status: res.status, detail }
	} catch (e) {
		return { result: 'failed', status: 0, detail: (e as Error).message }
	}
}

/** A topic for a tag: at most 32 characters of the URL-safe base64 alphabet, as push services require. */
export async function topicOf(tag: string) {
	return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8.encode(tag)))).slice(0, 32)
}
