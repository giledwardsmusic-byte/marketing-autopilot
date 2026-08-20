import { id, nowIso } from './utils.js';
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
  let user = null;
  let valid = false;

  // This is a single-owner personal app. An empty password means "open my app".
  // Prefer the matching owner email, then fall back to the first active owner.
  if (suppliedPassword === '') {
    if (normalizedEmail) {
      user = await env.DB.prepare(`SELECT * FROM users WHERE email=? AND role='owner' AND status='active' LIMIT 1`).bind(normalizedEmail).first();
    }
    if (!user) user = await env.DB.prepare(`SELECT * FROM users WHERE role='owner' AND status='active' ORDER BY created_at LIMIT 1`).first();
    if (!user) user = await env.DB.prepare(`SELECT * FROM users WHERE status='active' ORDER BY created_at LIMIT 1`).first();
    valid = Boolean(user);
  } else {
    user = await env.DB.prepare(`SELECT * FROM users WHERE email=? AND status='active'`).bind(normalizedEmail).first();
    if (user) {
      try { valid = await verifyPassword(suppliedPassword, user.password_salt, user.password_hash); }
      catch { valid = false; }
    }
  }

  // Keep the old bootstrap-secret recovery path available if a password is ever used.
  const bootstrapEmail = String(env.BOOTSTRAP_ADMIN_EMAIL||'').trim().toLowerCase();
  const bootstrapPassword = String(env.BOOTSTRAP_ADMIN_PASSWORD||'');
  const bootstrapPasswordMatches = bootstrapPassword && (suppliedPassword === bootstrapPassword || suppliedPassword.trim() === bootstrapPassword.trim());
  const bootstrapMatch = bootstrapEmail && normalizedEmail === bootstrapEmail && bootstrapPasswordMatches;

  if (!valid && bootstrapMatch) {
    if (!user) user = await env.DB.prepare(`SELECT * FROM users WHERE role='owner' AND status='active' ORDER BY created_at LIMIT 1`).first();
    const salt = randomSalt();
    const hash = await hashPassword(bootstrapPassword.trim(), salt);
    if (user) {
      await env.DB.prepare(`UPDATE users SET email=?,password_hash=?,password_salt=? WHERE id=?`).bind(bootstrapEmail,hash,salt,user.id).run();
      user = {...user,email:bootstrapEmail,password_hash:hash,password_salt:salt,role:'owner',status:'active'};
    } else {
      const uid=id('usr');
      await env.DB.prepare(`INSERT INTO users(id,email,password_hash,password_salt,role,status,created_at) VALUES(?,?,?,?,?,'active',?)`).bind(uid,bootstrapEmail,hash,salt,'owner',nowIso()).run();
      user={id:uid,email:bootstrapEmail,role:'owner',status:'active'};
    }
    valid = true;
  }

  if (!user || !valid) return null;
  const token = randomToken();
  const tokenHash = await hashSessionToken(token);
  const expires = new Date(Date.now()+365*86400_000).toISOString();
  await env.DB.prepare(`INSERT INTO sessions(id,user_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?)`).bind(id('ses'),user.id,tokenHash,expires,nowIso()).run();
  await env.DB.prepare(`UPDATE users SET last_login_at=? WHERE id=?`).bind(nowIso(),user.id).run();
  await audit(env,{userId:user.id,type:'auth.login',entityType:'user',entityId:user.id,summary:'Opened app'});
  return { user:{id:user.id,email:user.email,role:user.role,session_token:token}, cookie:sessionCookie(token,60*60*24*365) };
}

function requestToken(request) {
  const auth = request.headers.get('authorization') || '';
  if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i,'').trim();
  return readCookie(request,'ma_session');
}

export async function currentUser(env, request) {
  const token = requestToken(request);
  if (!token) return null;
  const tokenHash = await hashSessionToken(token);
  const row = await env.DB.prepare(`SELECT u.id,u.email,u.role,u.status,s.id AS session_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.status='active'`).bind(tokenHash,nowIso()).first();
  return row || null;
}

export async function logout(env, request) {
  const token = requestToken(request);
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
  await env.DB.prepare(`INSERT INTO users(id,email,password_hash,password_salt,role,status,created_at) VALUES(?,?,?,?,?,'active',?)`).bind(uid,email.trim().toLowerCase(),hash,salt,role,nowIso()).run();
  await audit(env,{userId:actor.id,type:'user.created',entityType:'user',entityId:uid,summary:`Created ${role} account ${email}`});
  return {id:uid,email,role};
}
