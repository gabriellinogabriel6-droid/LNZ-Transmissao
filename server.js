const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { Server } = require('socket.io');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: true },
  maxHttpBufferSize: 16e6
});

const PORT = Number(process.env.PORT) || 3000;
const rooms = new Map();

app.use(express.json({ limit: '16mb' }));

const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const dbPool = DATABASE_URL ? new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
}) : null;
let databaseReady = false;
const memoryUsers = new Map();
const memorySessions = new Map();
const memoryFriendships = new Map();
const memorySiteLogs = [];
const MAX_MEMORY_SITE_LOGS = 500;

function persistentAccountsRequired() {
  return Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID || process.env.NODE_ENV === 'production');
}

function ensurePersistentAccountStorage(_res) {
  // Contas continuam funcionando mesmo sem PostgreSQL.
  // Com DATABASE_URL conectado, os dados ficam persistentes; sem ele,
  // o servidor usa armazenamento em memória até o próximo reinício.
  return true;
}

function calculateAppVersion() {
  try {
    const hash = crypto.createHash('sha256');
    const versionFiles = [
      path.join(__dirname, 'server.js'),
      path.join(__dirname, 'public', 'app.js'),
      path.join(__dirname, 'public', 'index.html'),
      path.join(__dirname, 'public', 'style.css')
    ];
    for (const file of versionFiles) hash.update(fs.readFileSync(file));
    return hash.digest('hex').slice(0, 12);
  } catch {
    return String(process.env.APP_VERSION || 'dev');
  }
}

const APP_VERSION = String(process.env.APP_VERSION || calculateAppVersion());

function cleanAccountUsername(value) {
  const username = String(value || '').trim().replace(/\s+/g, '').slice(0, 24);
  if (!/^[A-Za-z0-9_.-]{3,24}$/.test(username)) return '';
  return username;
}

function isAdminUser(user) {
  const configured = cleanAccountUsername(process.env.ADMIN_USERNAME || '').toLowerCase();
  if (!configured || !user?.username) return false;
  return String(user.username).trim().toLowerCase() === configured;
}

function cleanLogText(value, max = 80) {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
}

async function logActivity({ userId = null, username = '', action = '', roomCode = '', details = {} } = {}) {
  const item = {
    id: crypto.randomUUID(),
    userId: userId || null,
    username: cleanLogText(username, 24),
    action: cleanLogText(action, 64) || 'site.event',
    roomCode: cleanLogText(roomCode, 9).toUpperCase(),
    details: details && typeof details === 'object' ? details : {},
    createdAt: Date.now()
  };
  if (databaseReady) {
    try {
      await dbPool.query(
        'INSERT INTO site_logs (id,user_id,username,action,room_code,details,created_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)',
        [item.id, item.userId, item.username || null, item.action, item.roomCode || null, JSON.stringify(item.details || {}), new Date(item.createdAt)]
      );
    } catch (error) {
      console.error('[Logs] Falha ao salvar:', error?.message || error);
    }
  } else {
    memorySiteLogs.push(item);
    while (memorySiteLogs.length > MAX_MEMORY_SITE_LOGS) memorySiteLogs.shift();
  }
  return item;
}

function validateAccountPassword(value) {
  const password = String(value || '');
  return password.length >= 6 && password.length <= 72 ? password : '';
}

function generateRecoveryCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const chars = Array.from({ length: 20 }, () => alphabet[crypto.randomInt(0, alphabet.length)]).join('');
  return `LNZ-${chars.match(/.{1,4}/g).join('-')}`;
}

function normalizeRecoveryCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function recoveryCodeHash(value) {
  return crypto.createHash('sha256').update(normalizeRecoveryCode(value)).digest('hex');
}

function verifyRecoveryCode(value, storedHash) {
  try {
    const attempt = Buffer.from(recoveryCodeHash(value), 'hex');
    const expected = Buffer.from(String(storedHash || ''), 'hex');
    return attempt.length === expected.length && crypto.timingSafeEqual(attempt, expected);
  } catch {
    return false;
  }
}

const recoveryAttempts = new Map();
function allowRecoveryAttempt(req) {
  const key = String(req.ip || req.socket?.remoteAddress || 'unknown');
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const current = recoveryAttempts.get(key);
  if (!current || current.resetAt <= now) {
    recoveryAttempts.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (current.count >= 8) return false;
  current.count += 1;
  return true;
}

function parseCookies(req) {
  const header = String(req.headers.cookie || '');
  const result = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = decodeURIComponent(part.slice(0, index).trim());
    const value = decodeURIComponent(part.slice(index + 1).trim());
    result[key] = value;
  }
  return result;
}

function sessionTokenHash(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function setSessionCookie(res, token, remember = false) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const persistent = remember ? `; Max-Age=${90 * 24 * 60 * 60}` : '';
  res.setHeader('Set-Cookie', `lnz_session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax${secure}${persistent}`);
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `lnz_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${secure}`);
}

async function initDatabase() {
  if (!dbPool) {
    console.warn('[Banco] DATABASE_URL não configurado. Contas funcionarão apenas enquanto o servidor estiver ligado.');
    return false;
  }
  try {
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY,
        username VARCHAR(24) NOT NULL,
        username_key VARCHAR(24) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        recovery_code_hash CHAR(64),
        recovery_code_created_at TIMESTAMPTZ,
        avatar TEXT,
        avatar_scale DOUBLE PRECISION NOT NULL DEFAULT 1.35,
        avatar_x DOUBLE PRECISION NOT NULL DEFAULT 0,
        avatar_y DOUBLE PRECISION NOT NULL DEFAULT 0,
        bio VARCHAR(160) NOT NULL DEFAULT '',
        status_text VARCHAR(60) NOT NULL DEFAULT '',
        theme_color VARCHAR(7) NOT NULL DEFAULT '#7a3cff',
        preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_login_at TIMESTAMPTZ
      );
      ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_code_hash CHAR(64);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_code_created_at TIMESTAMPTZ;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_scale DOUBLE PRECISION NOT NULL DEFAULT 1.35;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_x DOUBLE PRECISION NOT NULL DEFAULT 0;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_y DOUBLE PRECISION NOT NULL DEFAULT 0;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS bio VARCHAR(160) NOT NULL DEFAULT '';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS status_text VARCHAR(60) NOT NULL DEFAULT '';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS theme_color VARCHAR(7) NOT NULL DEFAULT '#7a3cff';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL DEFAULT '{}'::jsonb;
      CREATE TABLE IF NOT EXISTS friendships (
        user_a UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        user_b UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        requested_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(12) NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_a,user_b),
        CHECK (user_a <> user_b)
      );
      CREATE INDEX IF NOT EXISTS friendships_status_idx ON friendships(status);
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash CHAR(64) PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at);
      CREATE TABLE IF NOT EXISTS feedbacks (
        id UUID PRIMARY KEY,
        type VARCHAR(20) NOT NULL,
        rating SMALLINT NOT NULL,
        message VARCHAR(1000) NOT NULL,
        contact VARCHAR(100),
        nickname VARCHAR(24),
        room_code VARCHAR(9),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS site_logs (
        id UUID PRIMARY KEY,
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        username VARCHAR(24),
        action VARCHAR(64) NOT NULL,
        room_code VARCHAR(9),
        details JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS site_logs_created_idx ON site_logs(created_at DESC);
      CREATE INDEX IF NOT EXISTS site_logs_user_idx ON site_logs(user_id);
      CREATE INDEX IF NOT EXISTS site_logs_action_idx ON site_logs(action);
    `);
    databaseReady = true;
    const { rows } = await dbPool.query(`SELECT id,type,rating,message,contact,nickname,room_code,created_at FROM feedbacks ORDER BY created_at DESC LIMIT 200`);
    feedbackItems.splice(0, feedbackItems.length, ...rows.reverse().map((row) => ({
      id: row.id,
      type: row.type,
      rating: Number(row.rating),
      message: row.message,
      contact: row.contact || '',
      nickname: row.nickname || '',
      roomCode: row.room_code || '',
      createdAt: new Date(row.created_at).getTime()
    })));
    console.log('[Banco] PostgreSQL conectado.');
    return true;
  } catch (error) {
    databaseReady = false;
    console.error('[Banco] Falha ao iniciar PostgreSQL:', error?.message || error);
    return false;
  }
}


function cleanProfileText(value, max) {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
}

function cleanThemeColor(value) {
  const color = String(value || '').trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(color) ? color : '#7a3cff';
}

function profileFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    avatar: row.avatar || '',
    avatarScale: cleanAvatarScale(row.avatar_scale ?? row.avatarScale ?? 1.35),
    avatarOffsetX: cleanAvatarOffsetX(row.avatar_x ?? row.avatarOffsetX ?? 0),
    avatarOffsetY: cleanAvatarOffsetY(row.avatar_y ?? row.avatarOffsetY ?? 0),
    bio: row.bio || '',
    status: row.status_text ?? row.status ?? '',
    themeColor: cleanThemeColor(row.theme_color ?? row.themeColor ?? '#7a3cff'),
    preferences: (row.preferences && typeof row.preferences === 'object') ? row.preferences : {},
    createdAt: row.created_at ? new Date(row.created_at).getTime() : (row.createdAt || Date.now())
  };
}

async function getUserProfileById(id) {
  if (databaseReady) {
    const { rows } = await dbPool.query('SELECT id,username,avatar,avatar_scale,avatar_x,avatar_y,bio,status_text,theme_color,preferences,created_at FROM users WHERE id=$1 LIMIT 1', [id]);
    return profileFromRow(rows[0]);
  }
  for (const row of memoryUsers.values()) if (row.id === id) return profileFromRow(row);
  return null;
}

async function getUserProfileByUsername(username) {
  const key = String(username || '').trim().toLowerCase();
  if (!key) return null;
  if (databaseReady) {
    const { rows } = await dbPool.query('SELECT id,username,avatar,avatar_scale,avatar_x,avatar_y,bio,status_text,theme_color,preferences,created_at FROM users WHERE username_key=$1 LIMIT 1', [key]);
    return profileFromRow(rows[0]);
  }
  return profileFromRow(memoryUsers.get(key));
}

function isUserOnline(userId) {
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data?.account?.id === userId) return true;
  }
  return false;
}

function friendPair(a,b) {
  return String(a) < String(b) ? [a,b] : [b,a];
}

function memoryFriendKey(a,b) {
  const [x,y]=friendPair(a,b); return `${x}:${y}`;
}

async function getFriendshipBetween(a,b) {
  if (!a || !b || a === b) return null;
  const [x,y]=friendPair(a,b);
  if (databaseReady) {
    const { rows } = await dbPool.query('SELECT user_a,user_b,requested_by,status,created_at,updated_at FROM friendships WHERE user_a=$1 AND user_b=$2 LIMIT 1',[x,y]);
    return rows[0] || null;
  }
  return memoryFriendships.get(memoryFriendKey(a,b)) || null;
}

async function friendshipPublicStatus(viewerId,targetId) {
  if (!viewerId || !targetId) return 'none';
  if (viewerId === targetId) return 'self';
  const rel = await getFriendshipBetween(viewerId,targetId);
  if (!rel) return 'none';
  if (rel.status === 'accepted') return 'friends';
  return rel.requested_by === viewerId ? 'outgoing' : 'incoming';
}

function emitToAccount(userId, event, data={}) {
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data?.account?.id === userId) socket.emit(event, data);
  }
}

async function createUserAccount(username, password) {
  const id = crypto.randomUUID();
  const usernameKey = username.toLowerCase();
  const passwordHash = hashPassword(password);
  const recoveryCode = generateRecoveryCode();
  const recoveryHash = recoveryCodeHash(recoveryCode);
  if (databaseReady) {
    try {
      await dbPool.query(
        'INSERT INTO users (id,username,username_key,password_hash,recovery_code_hash,recovery_code_created_at) VALUES ($1,$2,$3,$4,$5,NOW())',
        [id, username, usernameKey, passwordHash, recoveryHash]
      );
      const user = profileFromRow({ id, username, avatar:'', avatar_scale:1.35, avatar_x:0, avatar_y:0, bio:'', status_text:'', theme_color:'#7a3cff', preferences:{}, created_at:new Date() });
      return { user, recoveryCode };
    } catch (error) {
      if (error?.code === '23505') throw new Error('Esse login já está em uso.');
      throw error;
    }
  }
  if (memoryUsers.has(usernameKey)) throw new Error('Esse login já está em uso.');
  memoryUsers.set(usernameKey, { id, username, usernameKey, passwordHash, recoveryCodeHash: recoveryHash, recoveryCodeCreatedAt: Date.now(), avatar:'', avatarScale:1.35, avatarOffsetX:0, avatarOffsetY:0, bio:'', status:'', themeColor:'#7a3cff', preferences:{}, createdAt: Date.now() });
  return { user: profileFromRow(memoryUsers.get(usernameKey)), recoveryCode };
}

async function regenerateRecoveryCodeForUser(userId) {
  const recoveryCode = generateRecoveryCode();
  const recoveryHash = recoveryCodeHash(recoveryCode);
  if (databaseReady) {
    await dbPool.query('UPDATE users SET recovery_code_hash=$1,recovery_code_created_at=NOW() WHERE id=$2', [recoveryHash, userId]);
    return recoveryCode;
  }
  for (const row of memoryUsers.values()) {
    if (row.id === userId) {
      row.recoveryCodeHash = recoveryHash;
      row.recoveryCodeCreatedAt = Date.now();
      return recoveryCode;
    }
  }
  throw new Error('Conta não encontrada.');
}

async function recoverUserAccount(username, recoveryCode, newPassword) {
  const usernameKey = username.toLowerCase();
  const newRecoveryCode = generateRecoveryCode();
  const newRecoveryHash = recoveryCodeHash(newRecoveryCode);
  const passwordHash = hashPassword(newPassword);

  if (databaseReady) {
    const { rows } = await dbPool.query(
      'SELECT id,username,recovery_code_hash,avatar,avatar_scale,avatar_x,avatar_y,bio,status_text,theme_color,preferences,created_at FROM users WHERE username_key=$1 LIMIT 1',
      [usernameKey]
    );
    const row = rows[0];
    if (!row || !row.recovery_code_hash || !verifyRecoveryCode(recoveryCode, row.recovery_code_hash)) return null;
    await dbPool.query(
      'UPDATE users SET password_hash=$1,recovery_code_hash=$2,recovery_code_created_at=NOW(),last_login_at=NOW() WHERE id=$3',
      [passwordHash, newRecoveryHash, row.id]
    );
    await dbPool.query('DELETE FROM sessions WHERE user_id=$1', [row.id]);
    return { user: profileFromRow(row), recoveryCode: newRecoveryCode };
  }

  const row = memoryUsers.get(usernameKey);
  if (!row || !row.recoveryCodeHash || !verifyRecoveryCode(recoveryCode, row.recoveryCodeHash)) return null;
  row.passwordHash = passwordHash;
  row.recoveryCodeHash = newRecoveryHash;
  row.recoveryCodeCreatedAt = Date.now();
  for (const [tokenHash, session] of memorySessions.entries()) {
    if (session.userId === row.id) memorySessions.delete(tokenHash);
  }
  return { user: profileFromRow(row), recoveryCode: newRecoveryCode };
}

async function authenticateUser(username, password) {
  const usernameKey = username.toLowerCase();
  if (databaseReady) {
    const { rows } = await dbPool.query('SELECT id,username,password_hash,avatar,avatar_scale,avatar_x,avatar_y,bio,status_text,theme_color,preferences,created_at FROM users WHERE username_key=$1 LIMIT 1', [usernameKey]);
    const row = rows[0];
    if (!row || !verifyPassword(password, row.password_hash)) return null;
    await dbPool.query('UPDATE users SET last_login_at=NOW() WHERE id=$1', [row.id]);
    return profileFromRow(row);
  }
  const row = memoryUsers.get(usernameKey);
  if (!row || !verifyPassword(password, row.passwordHash)) return null;
  return profileFromRow(row);
}

async function createSessionForUser(user, remember = false) {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = sessionTokenHash(token);
  const lifetimeMs = remember
    ? 90 * 24 * 60 * 60 * 1000
    : 24 * 60 * 60 * 1000;
  const expiresAt = new Date(Date.now() + lifetimeMs);
  if (databaseReady) {
    await dbPool.query('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES ($1,$2,$3)', [tokenHash, user.id, expiresAt]);
  } else {
    memorySessions.set(tokenHash, { userId: user.id, username: user.username, expiresAt: expiresAt.getTime() });
  }
  return token;
}

async function currentUserFromRequest(req) {
  const token = parseCookies(req).lnz_session;
  if (!token) return null;
  const tokenHash = sessionTokenHash(token);
  if (databaseReady) {
    const { rows } = await dbPool.query(`
      SELECT u.id,u.username,u.avatar,u.avatar_scale,u.avatar_x,u.avatar_y,u.bio,u.status_text,u.theme_color,u.preferences,u.created_at FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=$1 AND s.expires_at > NOW() LIMIT 1
    `, [tokenHash]);
    return profileFromRow(rows[0]);
  }
  const session = memorySessions.get(tokenHash);
  if (!session || session.expiresAt <= Date.now()) {
    memorySessions.delete(tokenHash);
    return null;
  }
  return await getUserProfileById(session.userId);
}

async function destroySession(req) {
  const token = parseCookies(req).lnz_session;
  if (!token) return;
  const tokenHash = sessionTokenHash(token);
  if (databaseReady) await dbPool.query('DELETE FROM sessions WHERE token_hash=$1', [tokenHash]);
  else memorySessions.delete(tokenHash);
}

app.get('/api/auth/me', async (req, res) => {
  try {
    const user = await currentUserFromRequest(req);
    res.json({ ok: true, user: user ? { ...user, isAdmin: isAdminUser(user) } : null, persistentDatabase: databaseReady });
  } catch {
    res.status(500).json({ ok: false, error: 'Não foi possível consultar sua conta.' });
  }
});

app.get('/api/auth/username-available', async (req, res) => {
  const username = cleanAccountUsername(req.query?.username);
  if (!username) return res.json({ ok: true, valid: false, available: false });
  const key = username.toLowerCase();
  try {
    let exists = false;
    if (databaseReady) {
      const { rows } = await dbPool.query('SELECT 1 FROM users WHERE username_key=$1 LIMIT 1', [key]);
      exists = rows.length > 0;
    } else {
      exists = memoryUsers.has(key);
    }
    res.json({ ok: true, valid: true, available: !exists });
  } catch {
    res.status(500).json({ ok: false, error: 'Não foi possível verificar o usuário.' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  if (!ensurePersistentAccountStorage(res)) return;
  const username = cleanAccountUsername(req.body?.username);
  const password = validateAccountPassword(req.body?.password);
  const remember = Boolean(req.body?.remember);
  if (!username) return res.status(400).json({ ok: false, error: 'Use um login de 3 a 24 caracteres: letras, números, ponto, hífen ou _.' });
  if (!password) return res.status(400).json({ ok: false, error: 'A senha precisa ter entre 6 e 72 caracteres.' });
  try {
    const created = await createUserAccount(username, password);
    const token = await createSessionForUser(created.user, remember);
    setSessionCookie(res, token, remember);
    logActivity({ userId: created.user.id, username: created.user.username, action: 'auth.register' }).catch(() => {});
    res.json({ ok: true, user: { ...created.user, isAdmin: isAdminUser(created.user) }, recoveryCode: created.recoveryCode, persistentDatabase: databaseReady });
  } catch (error) {
    res.status(400).json({ ok: false, error: error?.message || 'Não foi possível criar a conta.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  if (!ensurePersistentAccountStorage(res)) return;
  const username = cleanAccountUsername(req.body?.username);
  const password = validateAccountPassword(req.body?.password);
  const remember = Boolean(req.body?.remember);
  if (!username || !password) return res.status(400).json({ ok: false, error: 'Login ou senha inválidos.' });
  try {
    const user = await authenticateUser(username, password);
    if (!user) return res.status(401).json({ ok: false, error: 'Login ou senha incorretos.' });
    const token = await createSessionForUser(user, remember);
    setSessionCookie(res, token, remember);
    logActivity({ userId: user.id, username: user.username, action: 'auth.login' }).catch(() => {});
    res.json({ ok: true, user: { ...user, isAdmin: isAdminUser(user) }, persistentDatabase: databaseReady });
  } catch {
    res.status(500).json({ ok: false, error: 'Não foi possível entrar na conta.' });
  }
});

app.post('/api/auth/recover', async (req, res) => {
  if (!ensurePersistentAccountStorage(res)) return;
  if (!allowRecoveryAttempt(req)) return res.status(429).json({ ok: false, error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' });
  const username = cleanAccountUsername(req.body?.username);
  const recoveryCode = String(req.body?.recoveryCode || '').trim();
  const password = validateAccountPassword(req.body?.password);
  const remember = Boolean(req.body?.remember);
  if (!username || normalizeRecoveryCode(recoveryCode).length < 16 || !password) {
    return res.status(400).json({ ok: false, error: 'Confira o login, o código de recuperação e a nova senha.' });
  }
  try {
    const recovered = await recoverUserAccount(username, recoveryCode, password);
    if (!recovered) return res.status(401).json({ ok: false, error: 'Login ou código de recuperação incorretos.' });
    const token = await createSessionForUser(recovered.user, remember);
    setSessionCookie(res, token, remember);
    logActivity({ userId: recovered.user.id, username: recovered.user.username, action: 'auth.recover' }).catch(() => {});
    res.json({ ok: true, user: { ...recovered.user, isAdmin: isAdminUser(recovered.user) }, recoveryCode: recovered.recoveryCode, persistentDatabase: databaseReady });
  } catch (error) {
    console.error('[Conta] Falha na recuperação:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Não foi possível recuperar a conta agora.' });
  }
});

app.post('/api/auth/recovery-code/regenerate', async (req, res) => {
  try {
    const user = await currentUserFromRequest(req);
    if (!user) return res.status(401).json({ ok: false, error: 'Faça login.' });
    const recoveryCode = await regenerateRecoveryCodeForUser(user.id);
    res.json({ ok: true, recoveryCode });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Não foi possível gerar um novo código de recuperação.' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  let user = null;
  try { user = await currentUserFromRequest(req); } catch {}
  try { await destroySession(req); } catch {}
  if (user) logActivity({ userId: user.id, username: user.username, action: 'auth.logout' }).catch(() => {});
  clearSessionCookie(res);
  res.json({ ok: true });
});


app.get('/api/profile/me', async (req,res) => {
  try {
    const user = await currentUserFromRequest(req);
    if (!user) return res.status(401).json({ok:false,error:'Faça login.'});
    res.json({ok:true, profile:{...user, online:true}});
  } catch { res.status(500).json({ok:false,error:'Não foi possível carregar seu perfil.'}); }
});

app.get('/api/profile/:username', async (req,res) => {
  try {
    const viewer = await currentUserFromRequest(req);
    if (!viewer) return res.status(401).json({ok:false,error:'Faça login.'});
    const profile = await getUserProfileByUsername(req.params.username);
    if (!profile) return res.status(404).json({ok:false,error:'Usuário não encontrado.'});
    const relation = await friendshipPublicStatus(viewer.id, profile.id);
    res.json({ok:true, profile:{...profile, online:isUserOnline(profile.id)}, relation});
  } catch { res.status(500).json({ok:false,error:'Não foi possível abrir o perfil.'}); }
});

app.post('/api/profile/update', async (req,res) => {
  try {
    const user = await currentUserFromRequest(req);
    if (!user) return res.status(401).json({ok:false,error:'Faça login.'});
    const avatar = cleanAvatar(req.body?.avatar);
    const avatarScale = cleanAvatarScale(req.body?.avatarScale);
    const avatarX = cleanAvatarOffsetX(req.body?.avatarOffsetX);
    const avatarY = cleanAvatarOffsetY(req.body?.avatarOffsetY);
    const bio = cleanProfileText(req.body?.bio,160);
    const status = cleanProfileText(req.body?.status,60);
    const themeColor = cleanThemeColor(req.body?.themeColor);
    if (databaseReady) {
      await dbPool.query('UPDATE users SET avatar=$1,avatar_scale=$2,avatar_x=$3,avatar_y=$4,bio=$5,status_text=$6,theme_color=$7 WHERE id=$8', [avatar||null,avatarScale,avatarX,avatarY,bio,status,themeColor,user.id]);
    } else {
      for (const row of memoryUsers.values()) if (row.id===user.id) Object.assign(row,{avatar,avatarScale,avatarOffsetX:avatarX,avatarOffsetY:avatarY,bio,status,themeColor});
    }
    const profile = await getUserProfileById(user.id);
    emitToAccount(user.id,'profile-updated',{profile});
    res.json({ok:true,profile});
  } catch (error) { res.status(500).json({ok:false,error:'Não foi possível salvar o perfil.'}); }
});


function cleanUserPreferences(value) {
  const input = value && typeof value === 'object' ? value : {};
  return {
    transmissionVolume: Math.min(1, Math.max(0, Number(input.transmissionVolume ?? 0.9) || 0)),
    voiceVolume: Math.min(1, Math.max(0, Number(input.voiceVolume ?? 0.9) || 0)),
    voiceOutputMuted: Boolean(input.voiceOutputMuted),
    transmissionMuted: Boolean(input.transmissionMuted),
    shareAudio: Boolean(input.shareAudio)
  };
}

app.post('/api/preferences/update', async (req,res) => {
  try {
    const user = await currentUserFromRequest(req);
    if (!user) return res.status(401).json({ok:false,error:'Faça login.'});
    const preferences = cleanUserPreferences(req.body?.preferences);
    if (databaseReady) {
      await dbPool.query('UPDATE users SET preferences=$1::jsonb WHERE id=$2', [JSON.stringify(preferences), user.id]);
    } else {
      for (const row of memoryUsers.values()) if (row.id===user.id) row.preferences=preferences;
    }
    res.json({ok:true,preferences});
  } catch {
    res.status(500).json({ok:false,error:'Não foi possível salvar suas preferências.'});
  }
});

app.get('/api/users/search', async (req,res) => {
  try {
    const viewer = await currentUserFromRequest(req);
    if (!viewer) return res.status(401).json({ok:false,error:'Faça login.'});
    const q=String(req.query.q||'').trim().toLowerCase().slice(0,24);
    if (!q) return res.json({ok:true,users:[]});
    let profiles=[];
    if (databaseReady) {
      const {rows}=await dbPool.query("SELECT id,username,avatar,avatar_scale,avatar_x,avatar_y,bio,status_text,theme_color,preferences,created_at FROM users WHERE username_key LIKE $1 AND id<>$2 ORDER BY username_key LIMIT 12", [`%${q}%`,viewer.id]);
      profiles=rows.map(profileFromRow);
    } else {
      profiles=[...memoryUsers.values()].filter(r=>r.id!==viewer.id && r.usernameKey.includes(q)).slice(0,12).map(profileFromRow);
    }
    const users=[];
    for (const profile of profiles) users.push({...profile,online:isUserOnline(profile.id),relation:await friendshipPublicStatus(viewer.id,profile.id)});
    res.json({ok:true,users});
  } catch { res.status(500).json({ok:false,error:'Não foi possível pesquisar usuários.'}); }
});

app.get('/api/friends', async (req,res) => {
  try {
    const viewer=await currentUserFromRequest(req);
    if (!viewer) return res.status(401).json({ok:false,error:'Faça login.'});
    const result={friends:[],incoming:[],outgoing:[]};
    let relations=[];
    if (databaseReady) {
      const {rows}=await dbPool.query('SELECT user_a,user_b,requested_by,status,created_at,updated_at FROM friendships WHERE user_a=$1 OR user_b=$1 ORDER BY updated_at DESC',[viewer.id]);
      relations=rows;
    } else {
      relations=[...memoryFriendships.values()].filter(r=>r.user_a===viewer.id||r.user_b===viewer.id);
    }
    for (const rel of relations) {
      const otherId=rel.user_a===viewer.id?rel.user_b:rel.user_a;
      const profile=await getUserProfileById(otherId);
      if (!profile) continue;
      const item={...profile,online:isUserOnline(otherId)};
      if (rel.status==='accepted') result.friends.push(item);
      else if (rel.requested_by===viewer.id) result.outgoing.push(item);
      else result.incoming.push(item);
    }
    res.json({ok:true,...result});
  } catch { res.status(500).json({ok:false,error:'Não foi possível carregar seus amigos.'}); }
});

app.post('/api/friends/request', async (req,res) => {
  try {
    const viewer=await currentUserFromRequest(req);
    if (!viewer) return res.status(401).json({ok:false,error:'Faça login.'});
    const target=await getUserProfileByUsername(req.body?.username);
    if (!target) return res.status(404).json({ok:false,error:'Usuário não encontrado.'});
    if (target.id===viewer.id) return res.status(400).json({ok:false,error:'Você não pode adicionar a si mesmo.'});
    const existing=await getFriendshipBetween(viewer.id,target.id);
    if (existing) {
      if (existing.status==='accepted') return res.json({ok:true,status:'friends'});
      if (existing.requested_by===target.id) {
        const [a,b]=friendPair(viewer.id,target.id);
        if (databaseReady) await dbPool.query("UPDATE friendships SET status='accepted',updated_at=NOW() WHERE user_a=$1 AND user_b=$2",[a,b]);
        else Object.assign(existing,{status:'accepted',updated_at:Date.now()});
        emitToAccount(target.id,'friendship-updated',{}); emitToAccount(viewer.id,'friendship-updated',{});
        return res.json({ok:true,status:'friends'});
      }
      return res.json({ok:true,status:'outgoing'});
    }
    const [a,b]=friendPair(viewer.id,target.id);
    if (databaseReady) await dbPool.query('INSERT INTO friendships (user_a,user_b,requested_by,status) VALUES ($1,$2,$3,$4)',[a,b,viewer.id,'pending']);
    else memoryFriendships.set(memoryFriendKey(a,b),{user_a:a,user_b:b,requested_by:viewer.id,status:'pending',created_at:Date.now(),updated_at:Date.now()});
    emitToAccount(target.id,'friend-request',{from:viewer.username});
    res.json({ok:true,status:'outgoing'});
  } catch { res.status(500).json({ok:false,error:'Não foi possível enviar o pedido.'}); }
});

app.post('/api/friends/respond', async (req,res) => {
  try {
    const viewer=await currentUserFromRequest(req);
    if (!viewer) return res.status(401).json({ok:false,error:'Faça login.'});
    const target=await getUserProfileByUsername(req.body?.username);
    const action=req.body?.action==='accept'?'accept':'reject';
    if (!target) return res.status(404).json({ok:false,error:'Usuário não encontrado.'});
    const rel=await getFriendshipBetween(viewer.id,target.id);
    if (!rel || rel.status!=='pending' || rel.requested_by===viewer.id) return res.status(400).json({ok:false,error:'Pedido não encontrado.'});
    const [a,b]=friendPair(viewer.id,target.id);
    if (action==='accept') {
      if (databaseReady) await dbPool.query("UPDATE friendships SET status='accepted',updated_at=NOW() WHERE user_a=$1 AND user_b=$2",[a,b]);
      else Object.assign(rel,{status:'accepted',updated_at:Date.now()});
    } else {
      if (databaseReady) await dbPool.query('DELETE FROM friendships WHERE user_a=$1 AND user_b=$2',[a,b]);
      else memoryFriendships.delete(memoryFriendKey(a,b));
    }
    emitToAccount(target.id,'friendship-updated',{}); emitToAccount(viewer.id,'friendship-updated',{});
    res.json({ok:true,status:action==='accept'?'friends':'none'});
  } catch { res.status(500).json({ok:false,error:'Não foi possível responder ao pedido.'}); }
});

app.post('/api/friends/remove', async (req,res) => {
  try {
    const viewer=await currentUserFromRequest(req);
    if (!viewer) return res.status(401).json({ok:false,error:'Faça login.'});
    const target=await getUserProfileByUsername(req.body?.username);
    if (!target) return res.status(404).json({ok:false,error:'Usuário não encontrado.'});
    const [a,b]=friendPair(viewer.id,target.id);
    if (databaseReady) await dbPool.query('DELETE FROM friendships WHERE user_a=$1 AND user_b=$2',[a,b]);
    else memoryFriendships.delete(memoryFriendKey(a,b));
    emitToAccount(target.id,'friendship-updated',{}); emitToAccount(viewer.id,'friendship-updated',{});
    res.json({ok:true,status:'none'});
  } catch { res.status(500).json({ok:false,error:'Não foi possível remover o amigo.'}); }
});


app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (_req, res) => {
  res.json({ ok: true, rooms: rooms.size, feedbacks: feedbackItems.length, database: databaseReady ? 'postgres' : 'memory' });
});

app.get('/version', (_req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.json({ ok: true, version: APP_VERSION });
});

app.get('/public/feedback', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    ok: true,
    feedbacks: feedbackItems.slice().reverse().slice(0, 60).map(publicFeedbackView)
  });
});

app.get('/config.js', (_req, res) => {
  const iceServers = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }
  ];

  if (process.env.TURN_URL && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    iceServers.push({
      urls: process.env.TURN_URL,
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL
    });
  }

  res.type('application/javascript').send(
    `window.LNZ_CONFIG = ${JSON.stringify({ 
      iceServers,
      discordUrl: process.env.DISCORD_URL || 'https://discord.gg/m67kQeZrns',
      brandName: process.env.BRAND_NAME || 'LNZ Transmissão',
      appVersion: APP_VERSION
    })};`
  );
});


app.get('/api/admin/dashboard', async (req, res) => {
  try {
    const admin = await currentUserFromRequest(req);
    if (!admin || !isAdminUser(admin)) return res.status(403).json({ ok: false, error: 'Acesso restrito ao administrador.' });

    let users = [];
    let logs = [];
    let activeSessions = 0;
    if (databaseReady) {
      const [usersResult, logsResult, sessionsResult] = await Promise.all([
        dbPool.query('SELECT id,username,created_at,last_login_at FROM users ORDER BY created_at DESC LIMIT 250'),
        dbPool.query('SELECT id,user_id,username,action,room_code,details,created_at FROM site_logs ORDER BY created_at DESC LIMIT 300'),
        dbPool.query('SELECT COUNT(*)::int AS count FROM sessions WHERE expires_at > NOW()')
      ]);
      users = usersResult.rows.map((row) => ({
        id: row.id,
        username: row.username,
        createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
        lastLoginAt: row.last_login_at ? new Date(row.last_login_at).getTime() : null,
        online: isUserOnline(row.id)
      }));
      logs = logsResult.rows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        username: row.username || '',
        action: row.action,
        roomCode: row.room_code || '',
        details: row.details || {},
        createdAt: new Date(row.created_at).getTime()
      }));
      activeSessions = Number(sessionsResult.rows?.[0]?.count || 0);
    } else {
      users = [...memoryUsers.values()].map((row) => ({
        id: row.id,
        username: row.username,
        createdAt: row.createdAt || null,
        lastLoginAt: null,
        online: isUserOnline(row.id)
      })).sort((a,b) => (b.createdAt || 0) - (a.createdAt || 0));
      logs = memorySiteLogs.slice().reverse().slice(0, 300);
      activeSessions = [...memorySessions.values()].filter((item) => item.expiresAt > Date.now()).length;
    }

    const liveRooms = [...rooms.values()].map((room) => ({
      code: room.code,
      visibility: room.visibility,
      isOpen: room.isOpen !== false,
      participants: room.participants.size,
      sharers: room.sharerIds?.size || 0,
      createdAt: room.createdAt
    })).sort((a,b) => b.createdAt - a.createdAt);

    const onlineUserIds = new Set();
    for (const socket of io.sockets.sockets.values()) if (socket.data?.account?.id) onlineUserIds.add(socket.data.account.id);

    res.set('Cache-Control', 'no-store');
    res.json({
      ok: true,
      database: databaseReady ? 'postgres' : 'memory',
      stats: {
        users: users.length,
        onlineUsers: onlineUserIds.size,
        activeSessions,
        activeRooms: rooms.size,
        activeStreams: liveRooms.reduce((sum, room) => sum + room.sharers, 0),
        feedbacks: feedbackItems.length
      },
      users,
      rooms: liveRooms,
      feedbacks: feedbackItems.slice().reverse().slice(0, 80),
      logs
    });
  } catch (error) {
    console.error('[Admin] Falha ao carregar painel:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Não foi possível carregar o painel administrativo.' });
  }
});

app.get('/admin/feedback', async (req, res) => {
  try {
    const admin = await currentUserFromRequest(req);
    if (!admin || !isAdminUser(admin)) return res.status(403).json({ ok: false, error: 'Acesso negado.' });
    res.json({ ok: true, feedbacks: feedbackItems.slice().reverse() });
  } catch {
    res.status(500).json({ ok: false, error: 'Não foi possível carregar os feedbacks.' });
  }
});

// Permite abrir links como /room/ABCD-1234 diretamente.
app.get('/room/:code', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function normalizeCode(value) {
  const raw = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  if (raw.length <= 4) return raw;
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
}

function compactCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

function generateCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let compact = '';
  do {
    compact = Array.from({ length: 8 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  } while (rooms.has(normalizeCode(compact)));
  return normalizeCode(compact);
}

function cleanNickname(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 24);
}

function cleanAvatar(value) {
  const avatar = String(value || '');
  if (!avatar) return '';
  if (!avatar.startsWith('data:image/')) return '';
  if (avatar.length > 14500000) return ''; // ~10 MB de arquivo após conversão para base64
  return avatar;
}

function cleanAvatarScale(value) {
  const scale = Number(value);
  if (!Number.isFinite(scale)) return 1;
  return Math.min(3, Math.max(0.5, scale));
}

function cleanAvatarOffsetX(value) {
  const offset = Number(value);
  if (!Number.isFinite(offset)) return 0;
  return Math.min(60, Math.max(-60, offset));
}

function cleanAvatarOffsetY(value) {
  const offset = Number(value);
  if (!Number.isFinite(offset)) return 0;
  return Math.min(60, Math.max(-60, offset));
}

const MAX_CHAT_TEXT = 1000;
const MAX_CHAT_FILE_BYTES = 2 * 1024 * 1024;
const MAX_CHAT_HISTORY_BYTES = 12 * 1024 * 1024;
const MAX_CHAT_HISTORY_ITEMS = 80;
const CHAT_ALLOWED_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'pdf', 'txt', 'zip',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'
]);
const CHAT_BLOCKED_EXTENSIONS = new Set([
  'exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'ps1', 'vbs', 'js', 'mjs', 'html', 'htm', 'jar', 'apk'
]);

function cleanChatText(value) {
  return String(value || '').replace(/\r\n/g, '\n').trim().slice(0, MAX_CHAT_TEXT);
}

function cleanFilename(value) {
  return String(value || 'arquivo')
    .replace(/[\\/\0]/g, '_')
    .replace(/[<>:"|?*]/g, '_')
    .trim()
    .slice(0, 90) || 'arquivo';
}

function validateChatAttachment(value) {
  if (!value || typeof value !== 'object') return { ok: true, attachment: null, bytes: 0 };
  const name = cleanFilename(value.name);
  const type = String(value.type || '').toLowerCase().slice(0, 100);
  const size = Number(value.size || 0);
  const data = String(value.data || '');
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';

  if (!ext || CHAT_BLOCKED_EXTENSIONS.has(ext) || !CHAT_ALLOWED_EXTENSIONS.has(ext)) {
    return { ok: false, error: 'Esse tipo de arquivo não é permitido no chat.' };
  }
  if (!Number.isFinite(size) || size <= 0 || size > MAX_CHAT_FILE_BYTES) {
    return { ok: false, error: 'O arquivo deve ter no máximo 2 MB.' };
  }
  if (!data.startsWith('data:') || !data.includes(';base64,')) {
    return { ok: false, error: 'Arquivo inválido.' };
  }
  const expectedPrefix = type ? `data:${type};base64,` : 'data:';
  if (type && !data.startsWith(expectedPrefix)) {
    return { ok: false, error: 'O tipo do arquivo não confere.' };
  }
  if (data.length > 3_000_000) {
    return { ok: false, error: 'O arquivo codificado ficou grande demais.' };
  }

  return { ok: true, attachment: { name, type, size, data }, bytes: data.length };
}

function addChatMessage(room, message, attachmentBytes = 0) {
  if (!room.chatMessages) room.chatMessages = [];
  if (!Number.isFinite(room.chatBytes)) room.chatBytes = 0;
  message._attachmentBytes = attachmentBytes;
  room.chatMessages.push(message);
  room.chatBytes += attachmentBytes;

  while (room.chatMessages.length > MAX_CHAT_HISTORY_ITEMS || room.chatBytes > MAX_CHAT_HISTORY_BYTES) {
    const removed = room.chatMessages.shift();
    room.chatBytes -= Number(removed?._attachmentBytes || 0);
  }
}

function chatMessageView(message) {
  const { _attachmentBytes, ...view } = message;
  return view;
}


const feedbackItems = [];
const MAX_FEEDBACK_ITEMS = 200;

function cleanFeedbackText(value, max = 1000) {
  return String(value || '').replace(/\r\n/g, '\n').trim().slice(0, max);
}

function cleanFeedbackType(value) {
  const allowed = new Set(['elogio', 'sugestao', 'bug', 'outro']);
  const type = String(value || '').toLowerCase();
  return allowed.has(type) ? type : 'outro';
}

function cleanFeedbackRating(value) {
  const rating = Number(value);
  if (!Number.isFinite(rating)) return 0;
  return Math.min(5, Math.max(1, Math.round(rating)));
}

function publicFeedbackView(item) {
  return {
    id: item.id,
    type: item.type,
    rating: item.rating,
    message: item.message,
    nickname: item.nickname || 'Visitante',
    createdAt: item.createdAt
  };
}

async function forwardFeedbackToDiscord(item) {
  const webhook = String(process.env.FEEDBACK_WEBHOOK_URL || '').trim();
  if (!webhook) return { sent: false, reason: 'not-configured' };
  if (!/^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\//i.test(webhook)) {
    return { sent: false, reason: 'invalid-webhook' };
  }

  const typeLabels = {
    elogio: '💜 Elogio',
    sugestao: '💡 Sugestão',
    bug: '🐞 Problema / Bug',
    outro: '📝 Outro'
  };
  const stars = item.rating ? `${'⭐'.repeat(item.rating)} (${item.rating}/5)` : 'Sem nota';
  const fields = [
    { name: 'Tipo', value: typeLabels[item.type] || typeLabels.outro, inline: true },
    { name: 'Nota', value: stars, inline: true },
    { name: 'Usuário', value: item.nickname || 'Visitante', inline: true }
  ];
  if (item.roomCode) fields.push({ name: 'Sala', value: item.roomCode, inline: true });
  if (item.contact) fields.push({ name: 'Contato', value: item.contact, inline: false });

  const body = {
    username: 'LNZ Feedback',
    embeds: [{
      title: 'Novo feedback no LNZ Transmissão',
      description: item.message,
      color: 0x8f50ff,
      fields,
      timestamp: new Date(item.createdAt).toISOString(),
      footer: { text: 'LNZ Transmissão • Feedback' }
    }]
  };

  try {
    const response = await fetch(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    return { sent: response.ok, reason: response.ok ? 'ok' : `http-${response.status}` };
  } catch (error) {
    console.error('Falha ao enviar feedback para Discord:', error?.message || error);
    return { sent: false, reason: 'request-failed' };
  }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const digest = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${digest}`;
}

function verifyPassword(password, stored) {
  try {
    const [salt, digest] = String(stored || '').split(':');
    if (!salt || !digest) return false;
    const attempt = crypto.scryptSync(String(password), salt, 64);
    const expected = Buffer.from(digest, 'hex');
    return expected.length === attempt.length && crypto.timingSafeEqual(expected, attempt);
  } catch {
    return false;
  }
}

function roomPublicView(room) {
  return {
    code: room.code,
    visibility: room.visibility,
    participants: room.participants.size,
    sharing: Boolean(room.sharerIds?.size),
    sharingCount: room.sharerIds?.size || 0,
    isOpen: room.isOpen !== false,
    createdAt: room.createdAt
  };
}

function participantView(id, participant, room) {
  return {
    id,
    userId: participant.userId || null,
    nickname: participant.nickname,
    avatar: participant.avatar || '',
    avatarScale: cleanAvatarScale(participant.avatarScale),
    avatarOffsetX: cleanAvatarOffsetX(participant.avatarOffsetX),
    avatarOffsetY: cleanAvatarOffsetY(participant.avatarOffsetY),
    isHost: room.hostId === id,
    isSharer: Boolean(room.sharerIds?.has(id)),
    inVoice: Boolean(participant.inVoice),
    micMuted: Boolean(participant.micMuted),
    serverMuted: Boolean(participant.serverMuted),
    cameraOn: Boolean(participant.cameraOn),
    speaking: Boolean(participant.speaking) && Boolean(participant.inVoice) && !Boolean(participant.micMuted)
  };
}

function participantsFor(room) {
  return [...room.participants.entries()].map(([id, participant]) => participantView(id, participant, room));
}

function publicRooms() {
  return [...rooms.values()]
    .filter((room) => room.visibility === 'public' && room.isOpen !== false)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 40)
    .map(roomPublicView);
}

function broadcastPublicRooms() {
  io.emit('public-rooms-updated', publicRooms());
}

function broadcastRoomState(room) {
  io.to(room.code).emit('room-state', {
    room: roomPublicView(room),
    participants: participantsFor(room),
    sharerIds: [...(room.sharerIds || [])]
  });
}

function removeSocketFromRoom(socket, reason = 'left') {
  const code = socket.data.roomCode;
  if (!code) return;

  const room = rooms.get(code);
  socket.data.roomCode = null;
  if (!room) return;

  const leavingParticipant = room.participants.get(socket.id);
  if (leavingParticipant) logActivity({ userId: leavingParticipant.userId, username: leavingParticipant.nickname, action: 'room.leave', roomCode: code, details: { reason } }).catch(() => {});
  if (leavingParticipant?.inVoice) {
    socket.to(code).emit('voice-user-left', { userId: socket.id });
  }
  room.participants.delete(socket.id);
  socket.leave(code);

  if (room.sharerIds?.has(socket.id)) {
    room.sharerIds.delete(socket.id);
    io.to(code).emit('sharing-stopped', { sharerId: socket.id, reason: 'A transmissão foi encerrada.' });
  }
  for (const sharerId of room.sharerIds || []) {
    if (sharerId !== socket.id) io.to(sharerId).emit('viewer-left', { viewerId: socket.id });
  }

  if (room.hostId === socket.id) {
    room.hostId = room.participants.keys().next().value || null;
  }

  if (room.participants.size === 0) {
    rooms.delete(code);
  } else {
    broadcastRoomState(room);
  }

  broadcastPublicRooms();
}

io.on('connection', async (socket) => {
  try { socket.data.account = await currentUserFromRequest(socket.request); } catch { socket.data.account = null; }
  socket.emit('public-rooms-updated', publicRooms());
  socket.emit('app-version', { version: APP_VERSION });
  socket.emit('public-feedback-updated', feedbackItems.slice().reverse().slice(0, 60).map(publicFeedbackView));

  socket.on('list-public-feedback', (callback = () => {}) => {
    callback({ ok: true, feedbacks: feedbackItems.slice().reverse().slice(0, 60).map(publicFeedbackView) });
  });

  socket.on('list-public-rooms', (callback = () => {}) => {
    callback({ ok: true, rooms: publicRooms() });
  });

  socket.on('get-room-info', ({ roomCode }, callback = () => {}) => {
    const code = normalizeCode(compactCode(roomCode));
    const room = rooms.get(code);
    if (!room) return callback({ ok: false, error: 'Sala não encontrada ou encerrada.' });

    callback({
      ok: true,
      room: roomPublicView(room),
      requiresPassword: room.visibility === 'private'
    });
  });

  socket.on('create-room', ({ nickname, avatar, avatarScale, avatarOffsetX, avatarOffsetY, visibility, password }, callback = () => {}) => {
    const account = socket.data.account;
    if (!account) return callback({ ok: false, error: 'Faça login para criar uma sala.' });
    const cleanName = cleanNickname(account.username);
    const mode = visibility === 'private' ? 'private' : 'public';
    const pass = String(password || '');

    if (!cleanName) return callback({ ok: false, error: 'Digite seu nickname.' });
    if (mode === 'private' && pass.length < 4) {
      return callback({ ok: false, error: 'A senha da sala privada precisa ter pelo menos 4 caracteres.' });
    }

    removeSocketFromRoom(socket);

    const code = generateCode();
    const room = {
      code,
      visibility: mode,
      passwordHash: mode === 'private' ? hashPassword(pass) : null,
      hostId: socket.id,
      sharerIds: new Set(),
      isOpen: true,
      createdAt: Date.now(),
      participants: new Map(),
      chatMessages: [],
      chatBytes: 0
    };

    room.participants.set(socket.id, {
      userId: account.id,
      nickname: cleanName,
      avatar: cleanAvatar(avatar) || cleanAvatar(account.avatar),
      avatarScale: cleanAvatarScale(avatarScale ?? account.avatarScale),
      avatarOffsetX: cleanAvatarOffsetX(avatarOffsetX ?? account.avatarOffsetX),
      avatarOffsetY: cleanAvatarOffsetY(avatarOffsetY ?? account.avatarOffsetY),
      inVoice: false,
      micMuted: false,
      speaking: false
    });

    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    logActivity({ userId: account.id, username: account.username, action: 'room.create', roomCode: code, details: { visibility: mode } }).catch(() => {});

    callback({
      ok: true,
      room: roomPublicView(room),
      participants: participantsFor(room),
      chatMessages: room.chatMessages.map(chatMessageView),
      me: socket.id,
      sharerIds: [...room.sharerIds]
    });

    broadcastRoomState(room);
    broadcastPublicRooms();
  });

  socket.on('join-room', ({ roomCode, nickname, avatar, avatarScale, avatarOffsetX, avatarOffsetY, password }, callback = () => {}) => {
    const account = socket.data.account;
    if (!account) return callback({ ok: false, error: 'Faça login para entrar em uma sala.' });
    const code = normalizeCode(compactCode(roomCode));
    const cleanName = cleanNickname(account.username);
    const room = rooms.get(code);

    if (!room) return callback({ ok: false, error: 'Sala não encontrada ou encerrada.' });
    if (!cleanName) return callback({ ok: false, error: 'Digite seu nickname.' });
    if (room.isOpen === false) return callback({ ok: false, error: 'Essa sala está fechada pelo dono no momento.' });
    if (room.visibility === 'private' && !verifyPassword(password, room.passwordHash)) {
      return callback({ ok: false, error: 'Senha da sala incorreta.' });
    }
    const duplicateAccount = [...room.participants.values()].some((person) => person.userId === account.id);
    if (duplicateAccount) return callback({ ok: false, error: 'Sua conta já está conectada nessa sala.' });

    removeSocketFromRoom(socket);

    room.participants.set(socket.id, {
      userId: account.id,
      nickname: cleanName,
      avatar: cleanAvatar(avatar) || cleanAvatar(account.avatar),
      avatarScale: cleanAvatarScale(avatarScale ?? account.avatarScale),
      avatarOffsetX: cleanAvatarOffsetX(avatarOffsetX ?? account.avatarOffsetX),
      avatarOffsetY: cleanAvatarOffsetY(avatarOffsetY ?? account.avatarOffsetY),
      inVoice: false,
      micMuted: false,
      speaking: false
    });
    socket.join(code);
    socket.data.roomCode = code;
    logActivity({ userId: account.id, username: account.username, action: 'room.join', roomCode: code, details: { visibility: room.visibility } }).catch(() => {});

    callback({
      ok: true,
      room: roomPublicView(room),
      participants: participantsFor(room),
      chatMessages: room.chatMessages.map(chatMessageView),
      me: socket.id,
      sharerIds: [...(room.sharerIds || [])]
    });

    broadcastRoomState(room);
    broadcastPublicRooms();

    for (const sharerId of room.sharerIds) {
      if (sharerId !== socket.id) io.to(sharerId).emit('viewer-joined', { viewerId: socket.id });
    }
  });

  socket.on('set-room-access', ({ open }, callback = () => {}) => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room || !room.participants.has(socket.id)) {
      return callback({ ok: false, error: 'Você não está em uma sala.' });
    }
    if (room.hostId !== socket.id) {
      return callback({ ok: false, error: 'Somente o dono da sala pode abrir ou fechar a entrada.' });
    }

    room.isOpen = Boolean(open);
    const accessParticipant = room.participants.get(socket.id);
    logActivity({ userId: accessParticipant?.userId, username: accessParticipant?.nickname, action: room.isOpen ? 'room.open' : 'room.close', roomCode: code }).catch(() => {});
    callback({ ok: true, isOpen: room.isOpen });
    io.to(code).emit('room-access-changed', { isOpen: room.isOpen, changedBy: socket.id });
    broadcastRoomState(room);
    broadcastPublicRooms();
  });

  socket.on('send-chat-message', ({ text, attachment }, callback = () => {}) => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    const participant = room?.participants.get(socket.id);
    if (!room || !participant) {
      return callback({ ok: false, error: 'Você não está em uma sala.' });
    }

    const now = Date.now();
    if (socket.data.lastChatAt && now - socket.data.lastChatAt < 450) {
      return callback({ ok: false, error: 'Espere um instante antes de enviar outra mensagem.' });
    }

    const cleanText = cleanChatText(text);
    const fileResult = validateChatAttachment(attachment);
    if (!fileResult.ok) return callback({ ok: false, error: fileResult.error });
    if (!cleanText && !fileResult.attachment) {
      return callback({ ok: false, error: 'Digite uma mensagem ou escolha um arquivo.' });
    }

    socket.data.lastChatAt = now;
    const message = {
      id: crypto.randomUUID(),
      senderId: socket.id,
      nickname: participant.nickname,
      avatar: participant.avatar || '',
      avatarScale: cleanAvatarScale(participant.avatarScale),
      avatarOffsetX: cleanAvatarOffsetX(participant.avatarOffsetX),
      avatarOffsetY: cleanAvatarOffsetY(participant.avatarOffsetY),
      text: cleanText,
      attachment: fileResult.attachment,
      createdAt: now
    };

    addChatMessage(room, message, fileResult.bytes);
    logActivity({ userId: participant.userId, username: participant.nickname, action: 'chat.message', roomCode: code, details: { hasAttachment: Boolean(fileResult.attachment), attachmentName: fileResult.attachment?.name || '' } }).catch(() => {});
    io.to(code).emit('chat-message', chatMessageView(message));
    callback({ ok: true, messageId: message.id });
  });

  socket.on('join-voice', (_payload, callback = () => {}) => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    const participant = room?.participants.get(socket.id);
    if (!room || !participant) return callback({ ok: false, error: 'Você não está em uma sala.' });

    const peerIds = [...room.participants.entries()]
      .filter(([id, person]) => id !== socket.id && person.inVoice)
      .map(([id]) => id);

    participant.inVoice = true;
    participant.micMuted = false;
    participant.serverMuted = false;
    participant.cameraOn = false;
    participant.speaking = false;
    logActivity({ userId: participant.userId, username: participant.nickname, action: 'voice.join', roomCode: code }).catch(() => {});
    callback({ ok: true, peerIds });
    socket.to(code).emit('voice-user-joined', { userId: socket.id });
    broadcastRoomState(room);
  });

  socket.on('leave-voice', (_payload, callback = () => {}) => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    const participant = room?.participants.get(socket.id);
    if (room && participant?.inVoice) {
      participant.inVoice = false;
      participant.micMuted = false;
      participant.serverMuted = false;
      participant.cameraOn = false;
      participant.speaking = false;
      logActivity({ userId: participant.userId, username: participant.nickname, action: 'voice.leave', roomCode: code }).catch(() => {});
      socket.to(code).emit('voice-user-left', { userId: socket.id });
      broadcastRoomState(room);
    }
    callback({ ok: true });
  });

  socket.on('voice-mic-state', ({ muted }, callback = () => {}) => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    const participant = room?.participants.get(socket.id);
    if (!room || !participant?.inVoice) return callback({ ok: false });
    if (participant.serverMuted && !Boolean(muted)) {
      participant.micMuted = true;
      participant.speaking = false;
      broadcastRoomState(room);
      return callback({ ok: false, error: 'Seu microfone foi bloqueado pelo dono da sala.', serverMuted: true });
    }
    participant.micMuted = Boolean(muted) || Boolean(participant.serverMuted);
    if (participant.micMuted) participant.speaking = false;
    broadcastRoomState(room);
    callback({ ok: true, serverMuted: Boolean(participant.serverMuted) });
  });

  socket.on('voice-camera-state', ({ on }, callback = () => {}) => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    const participant = room?.participants.get(socket.id);
    if (!room || !participant?.inVoice) return callback({ ok: false });
    participant.cameraOn = Boolean(on);
    logActivity({ userId: participant.userId, username: participant.nickname, action: participant.cameraOn ? 'voice.camera_on' : 'voice.camera_off', roomCode: code }).catch(() => {});
    broadcastRoomState(room);
    callback({ ok: true });
  });

  socket.on('voice-speaking-state', ({ speaking }, callback = () => {}) => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    const participant = room?.participants.get(socket.id);
    if (!room || !participant?.inVoice) return callback({ ok: false });
    const next = Boolean(speaking) && !participant.micMuted;
    if (participant.speaking !== next) {
      participant.speaking = next;
      broadcastRoomState(room);
    }
    callback({ ok: true });
  });

  socket.on('host-mute-participant', ({ target }, callback = () => {}) => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room || room.hostId !== socket.id) return callback({ ok: false, error: 'Somente o dono da sala pode fazer isso.' });
    if (!target || target === socket.id) return callback({ ok: false, error: 'Participante inválido.' });
    const person = room.participants.get(target);
    if (!person?.inVoice) return callback({ ok: false, error: 'Essa pessoa não está na call.' });

    person.serverMuted = !Boolean(person.serverMuted);
    if (person.serverMuted) {
      person.micMuted = true;
      person.speaking = false;
      io.to(target).emit('voice-force-muted', { by: socket.id });
    } else {
      person.micMuted = true;
      person.speaking = false;
      io.to(target).emit('voice-server-mute-released', { by: socket.id });
    }
    logActivity({ userId: person.userId, username: person.nickname, action: person.serverMuted ? 'voice.server_mute' : 'voice.server_unmute', roomCode: code, details: { by: room.participants.get(socket.id)?.nickname || 'host' } }).catch(() => {});
    broadcastRoomState(room);
    callback({ ok: true, serverMuted: person.serverMuted });
  });

  socket.on('host-kick-participant', ({ target }, callback = () => {}) => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room || room.hostId !== socket.id) return callback({ ok: false, error: 'Somente o dono da sala pode remover pessoas.' });
    if (!target || target === socket.id) return callback({ ok: false, error: 'Participante inválido.' });
    const targetSocket = io.sockets.sockets.get(target);
    if (!targetSocket || targetSocket.data.roomCode !== code) return callback({ ok: false, error: 'Participante não encontrado.' });
    const person = room.participants.get(target);
    io.to(target).emit('kicked-from-room', { reason: 'Você foi removido pelo dono da sala.' });
    logActivity({ userId: person?.userId, username: person?.nickname || 'Participante', action: 'room.kicked', roomCode: code, details: { by: room.participants.get(socket.id)?.nickname || 'host' } }).catch(() => {});
    removeSocketFromRoom(targetSocket, 'kicked');
    callback({ ok: true });
  });

  socket.on('voice-signal', ({ target, data }) => {
    if (!target || !data) return;
    const sourceCode = socket.data.roomCode;
    const targetSocket = io.sockets.sockets.get(target);
    if (!sourceCode || !targetSocket || targetSocket.data.roomCode !== sourceCode) return;
    io.to(target).emit('voice-signal', { from: socket.id, data });
  });


  socket.on('submit-feedback', async ({ type, rating, message, contact }, callback = () => {}) => {
    const now = Date.now();
    if (socket.data.lastFeedbackAt && now - socket.data.lastFeedbackAt < 8000) {
      return callback({ ok: false, error: 'Espere alguns segundos antes de enviar outro feedback.' });
    }

    const cleanMessage = cleanFeedbackText(message, 1000);
    const cleanContact = cleanFeedbackText(contact, 100);
    const cleanType = cleanFeedbackType(type);
    const cleanRating = cleanFeedbackRating(rating);
    if (cleanMessage.length < 3) return callback({ ok: false, error: 'Escreva um feedback com pelo menos 3 caracteres.' });

    const room = rooms.get(socket.data.roomCode);
    const participant = room?.participants.get(socket.id);
    const item = {
      id: crypto.randomUUID(),
      type: cleanType,
      rating: cleanRating,
      message: cleanMessage,
      contact: cleanContact,
      nickname: participant?.nickname || socket.data.account?.username || '',
      roomCode: room?.code || '',
      createdAt: now
    };

    feedbackItems.push(item);
    while (feedbackItems.length > MAX_FEEDBACK_ITEMS) feedbackItems.shift();
    if (databaseReady) {
      dbPool.query('INSERT INTO feedbacks (id,type,rating,message,contact,nickname,room_code,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [
        item.id, item.type, item.rating, item.message, item.contact || null, item.nickname || null, item.roomCode || null, new Date(item.createdAt)
      ]).catch((error) => console.error('[Banco] Falha ao salvar feedback:', error?.message || error));
    }
    socket.data.lastFeedbackAt = now;
    io.emit('public-feedback-added', publicFeedbackView(item));

    const discordResult = await forwardFeedbackToDiscord(item);
    console.log(`[Feedback] ${item.type} ${item.rating}/5 ${item.nickname || 'Visitante'}: ${item.message.slice(0, 120)}`);
    logActivity({ userId: participant?.userId || socket.data.account?.id || null, username: item.nickname, action: 'feedback.submit', roomCode: item.roomCode, details: { type: item.type, rating: item.rating } }).catch(() => {});
    callback({ ok: true, sentToDiscord: discordResult.sent });
  });

  socket.on('leave-room', (_payload, callback = () => {}) => {
    removeSocketFromRoom(socket);
    callback({ ok: true });
  });

  socket.on('start-sharing', (_payload, callback = () => {}) => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room || !room.participants.has(socket.id)) {
      return callback({ ok: false, error: 'Você não está em uma sala.' });
    }

    room.sharerIds.add(socket.id);
    const sharingParticipant = room.participants.get(socket.id);
    logActivity({ userId: sharingParticipant?.userId, username: sharingParticipant?.nickname, action: 'stream.start', roomCode: code }).catch(() => {});
    const viewerIds = [...room.participants.keys()].filter((id) => id !== socket.id);
    callback({ ok: true, viewerIds, sharerIds: [...room.sharerIds] });
    io.to(code).emit('sharing-started', { sharerId: socket.id });
    broadcastRoomState(room);
    broadcastPublicRooms();
  });

  socket.on('stop-sharing', (_payload, callback = () => {}) => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (room && room.sharerIds.has(socket.id)) {
      const sharingParticipant = room.participants.get(socket.id);
      room.sharerIds.delete(socket.id);
      logActivity({ userId: sharingParticipant?.userId, username: sharingParticipant?.nickname, action: 'stream.stop', roomCode: code }).catch(() => {});
      io.to(code).emit('sharing-stopped', { sharerId: socket.id, reason: 'A transmissão foi encerrada.' });
      broadcastRoomState(room);
      broadcastPublicRooms();
    }
    callback({ ok: true });
  });

  socket.on('signal', ({ target, data }) => {
    if (!target || !data) return;
    const sourceCode = socket.data.roomCode;
    const targetSocket = io.sockets.sockets.get(target);
    if (!sourceCode || !targetSocket || targetSocket.data.roomCode !== sourceCode) return;
    io.to(target).emit('signal', { from: socket.id, data });
  });

  socket.on('disconnect', () => {
    removeSocketFromRoom(socket, 'disconnect');
  });
});

initDatabase().finally(() => {
  logActivity({ action: 'system.start', details: { version: APP_VERSION, database: databaseReady ? 'postgres' : 'memory' } }).catch(() => {});
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`LNZ Transmissão online em http://localhost:${PORT}`);
  });
});
