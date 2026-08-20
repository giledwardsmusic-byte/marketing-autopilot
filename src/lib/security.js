import { sha256Hex } from './utils.js';

const enc = new TextEncoder();
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const fromHex = hex => new Uint8Array(hex.match(/.{1,2}/g).map(x => parseInt(x,16)));

export function randomToken(bytes = 32) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return b64url(arr);
}

export function randomSalt() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return [...arr].map(b => b.toString(16).padStart(2,'0')).join('');
}

export async function hashPassword(password, saltHex, iterations = 100000) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({name:'PBKDF2', hash:'SHA-256', salt:fromHex(saltHex), iterations}, key, 256);
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2,'0')).join('');
}

export async function verifyPassword(password, salt, expected) {
  const actual = await hashPassword(password, salt);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i=0;i<actual.length;i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export const hashSessionToken = token => sha256Hex(token);

export function sessionCookie(token, maxAge = 60*60*24*14) {
  return `ma_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}
export function clearSessionCookie() {
  return 'ma_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0';
}
export function readCookie(request, name) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const [k,...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

export function assertSameOrigin(request, env) {
  if (['GET','HEAD','OPTIONS'].includes(request.method)) return true;
  const origin = request.headers.get('origin');
  if (!origin) return true;
  const allowed = env.TRUSTED_ORIGIN || new URL(request.url).origin;
  return origin === allowed;
}

function bytesToB64(bytes){ return btoa(String.fromCharCode(...bytes)); }
function b64ToBytes(s){ return Uint8Array.from(atob(s), c=>c.charCodeAt(0)); }
async function importCredentialKey(env){
  if(!env.CREDENTIAL_ENCRYPTION_KEY) return null;
  const raw=b64ToBytes(env.CREDENTIAL_ENCRYPTION_KEY);
  if(raw.length!==32) throw new Error('CREDENTIAL_ENCRYPTION_KEY must be base64 for exactly 32 bytes');
  return crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['encrypt','decrypt']);
}
export async function encryptCredential(env, plaintext){
  if(!plaintext) return {ciphertext:null,iv:null};
  const key=await importCredentialKey(env); if(!key) throw new Error('Credential encryption key not configured');
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(plaintext));
  return {ciphertext:bytesToB64(new Uint8Array(ct)),iv:bytesToB64(iv)};
}
export async function decryptCredential(env, ciphertext, iv){
  if(!ciphertext) return null;
  const key=await importCredentialKey(env); if(!key) throw new Error('Credential encryption key not configured');
  const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv:b64ToBytes(iv)},key,b64ToBytes(ciphertext));
  return new TextDecoder().decode(pt);
}
