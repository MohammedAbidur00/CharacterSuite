// auth.js
const ITERATIONS = 600000; // current OWASP guidance for PBKDF2-SHA256

const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256
  );
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, ITERATIONS);
  return `${ITERATIONS}:${toB64(salt)}:${toB64(hash)}`; // one string to store
}

export async function verifyPassword(password, stored) {
  const [iter, saltB64, hashB64] = stored.split(':');
  const hash = new Uint8Array(await derive(password, fromB64(saltB64), Number(iter)));
  const expected = fromB64(hashB64);
  if (hash.length !== expected.length) return false;

  let diff = 0; // compare without exiting early
  for (let i = 0; i < hash.length; i++) diff |= hash[i] ^ expected[i];
  return diff === 0;
}