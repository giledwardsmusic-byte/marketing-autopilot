import { id, nowIso, sha256Hex } from './utils.js';
import { randomSalt, randomToken, hashPassword, verifyPassword, hashSessionToken, readCookie, sessionCookie, clearSessionCookie } from './security.js';
import { audit } from './db.js';

export async function authStatus(env) {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM users`).first();
  return { initialized: Number(row?.n || 0) > 0 };
}

export async function bootstrap(env) {
  const status = await authStatus(env);
  if (status.initialized) throw new Error('Already initialized');
  if (!env.BOOTSTRAP_ADMIN_EMAIL || !env.BOOTSTRAP_ADMIN_PASSWORD) throw new Error('Bootstrap secrets are not configured');
  if (env.BOOTSTRAP_ADMIN_PASSWORD.length < 12) throw new Error('Bootstrap password must be at least 12 characters');
  const salt = randomSalt();
  const hash = await hashPassword(env.BOOTSTRAP_ADMIN_PASSWORD, salt);
  const uid = id('usr');
  await env.DB.prepare(`INSERT INTO users(id,email,password_hash,password_salt,role,status,created_at) VALUES(?,?,?,?,?,'active',?)`)
    .bind(uid, env.BOOTSTRAP_ADMIN_EMAIL.trim().toLowerCase(), hash, salt, 'owner', nowIso()).run();
  await audit(env,{userId:uid,type:'auth.bootstrap',entityType:'user',entityId:uid,summary:'Owner account initialized'});
  return { ok:true, email: env.BOOTSTRAP_ADMIN_EMAIL };
}

export async function login(env, email, password) {
  const normalizedEmail = String(email||'').trim().toLowerCase();
  const suppliedPassword = String(password||'');
  const user = await env.DB.prepare(`SELECT * FROM users WHERE email=? AND status='active'`).bind(normalizedEmail).first();
  if (!user) return null;

  let valid = await verifyPassword(suppliedPassword, user.password_salt, user.password_hash);

  // Recovery path for the owner during initial setup. If the stored hash was
  // created by an incompatible PBKDF2 configuration, the Cloudflare bootstrap
  // secret is the source of truth and repairs the stored hash automatically.
  if (!valid && user.role === 'owner' && env.BOOTSTRAP_ADMIN_EMAIL && env.BOOTSTRAP_ADMIN_PASSWORD) {
    const bootstrapEmail = env.BOOTSTRAP_ADMIN_EMAIL.trim().toLowerCase();
    if (normalizedEmail === bootstrapEmail && suppliedPassword === env.BOOTSTRAP_ADMIN_PASSWORD) {
      const salt = randomSalt();
      const hash = await hashPassword(suppliedPassword, salt);
      await env.DB.prepare(`UPDATE users SET password_hash=?,password_salt=? WHERE id=?`).bind(hash,salt,user.id).run();
      await audit(env,{userId:user.id,type:'auth.password_repaired',entityType:'user',entityId:user.id,summary:'Owner password hash repaired from bootstrap secret'});
      valid = true;
    }
  }

  if (!valid) return null;
  const token = randomToken();
  const tokenHash = await hashSessionToken(token);
  const expires = new Date(Date.now()+14*86400_000).toISOString();
  await env.DB.prepare(`INSERT INTO sessions(id,user_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?)`).bind(id('ses'),user.id,tokenHash,expires,nowIso()).run();
  await env.DB.prepare(`UPDATE users SET last_login_at=? WHERE id=?`).bind(nowIso(),user.id).run();
  await audit(env,{userId:user.id,type:'auth.login',entityType:'user',entityId:user.id,summary:'Signed in'});
  return { user:{id:user.id,email:user.email,role:user.role}, cookie:sessionCookie(token) };
}

export async function currentUser(env, request) {
  const token = readCookie(request,'ma_session');
  if (!token) return null;
  const tokenHash = await hashSessionToken(token);
  const row = await env.DB.prepare(`SELECT u.id,u.email,u.role,u.status,s.id AS session_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.status='active'`).bind(tokenHash,nowIso()).first();
  return row || null;
}

export async function logout(env, request) {
  const token = readCookie(request,'ma_session');
  if (token) {
    const tokenHash = await hashSessionToken(token);
    await env.DB.prepare(`DELETE FROM sessions WHERE token_hash=?`).bind(tokenHash).run();
  }
  return clearSessionCookie();
}

export async function createUser(env, actor, {email,password,role='admin'}) {
  if (actor.role !== 'owner') throw new Error('Owner role required');
  if (!email || !password || password.length < 12) throw new Error('Email and 12+ character password required');
  if (!['admin','viewer'].includes(role)) throw new Error('Invalid role');
  const salt=randomSalt(), hash=await hashPassword(password,salt), uid=id('usr');
  await env.DB.prepare(`INSERT INTO users(id,email,password_hash,password_salt,role,status,created_at) VALUES(?,?,?,?,?,'active',?)`)
    .bind(uid,email.trim().toLowerCase(),hash,salt,role,nowIso()).run();
  await audit(env,{userId:actor.id,type:'user.created',entityType:'user',entityId:uid,summary:`Created ${role} account ${email}`});
  return {id:uid,email,role};
}
