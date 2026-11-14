import { expect, test } from 'bun:test'
import { b64url, createVapid, encrypt, fromB64url, topicOf, vapidAuthorization } from '../server/webpush'

/** A browser's side of RFC 8291: decrypt what the relay sent with the subscription's private key. */
async function decrypt(body: Uint8Array, ua: CryptoKeyPair, auth: Uint8Array<ArrayBuffer>) {
	const salt = body.slice(0, 16)
	const idlen = body[20]!
	const asPublic = body.slice(21, 21 + idlen)
	const sealed = body.slice(21 + idlen)
	const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey))
	const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
	const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256))
	const hkdf = async (
		s: Uint8Array<ArrayBuffer>,
		ikm: Uint8Array<ArrayBuffer>,
		info: Uint8Array<ArrayBuffer>,
		n: number,
	) =>
		new Uint8Array(
			await crypto.subtle.deriveBits(
				{ name: 'HKDF', hash: 'SHA-256', salt: s, info },
				await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']),
				n * 8,
			),
		)
	const te = new TextEncoder()
	const info = new Uint8Array([...te.encode('WebPush: info\0'), ...uaPublic, ...asPublic])
	const ikm = await hkdf(auth, shared, info, 32)
	const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16)
	const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12)
	const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt'])
	const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, sealed))
	expect(plain.at(-1)).toBe(2)
	return new TextDecoder().decode(plain.slice(0, -1))
}

test('a message encrypted for a subscription decrypts with its keys', async () => {
	const ua = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
		'deriveBits',
	])) as CryptoKeyPair
	const auth = crypto.getRandomValues(new Uint8Array(16))
	const keys = {
		p256dh: b64url(new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey))),
		auth: b64url(auth),
	}
	const message = JSON.stringify({ title: 'Ada', body: 'Fertig: ✓' })
	const body = await encrypt(new TextEncoder().encode(message), keys)
	expect(new DataView(body.buffer).getUint32(16)).toBe(4096)
	expect(await decrypt(body, ua, auth)).toBe(message)
})

test('the VAPID header is a JWT for the push service, signed with the relay key', async () => {
	const vapid = await createVapid()
	const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', vapid, 'https://caduceus.test', 0)
	const m = header.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/)!
	expect(m[4]).toBe(vapid.publicKey)
	const claims = JSON.parse(Buffer.from(m[2]!, 'base64url').toString())
	expect(claims).toEqual({ aud: 'https://fcm.googleapis.com', exp: 12 * 3600, sub: 'https://caduceus.test' })
	const pub = await crypto.subtle.importKey(
		'raw',
		fromB64url(vapid.publicKey),
		{ name: 'ECDSA', namedCurve: 'P-256' },
		false,
		['verify'],
	)
	const ok = await crypto.subtle.verify(
		{ name: 'ECDSA', hash: 'SHA-256' },
		pub,
		fromB64url(m[3]!),
		new TextEncoder().encode(`${m[1]}.${m[2]}`),
	)
	expect(ok).toBe(true)
})

test('a topic fits what push services take', async () => {
	const t = await topicOf('bot:ada')
	expect(t).toMatch(/^[A-Za-z0-9_-]{32}$/)
	expect(await topicOf('bot:ada')).toBe(t)
})
