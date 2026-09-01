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
  maxHttpBufferSize: 6e6
});

const PORT = Number(process.env.PORT) || 3000;
const rooms = new Map();

app.use(express.json({ limit: '64kb' }));

const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const dbPool = DATABASE_URL ? new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
}) : null;
let databaseReady = false;
const memoryUsers = new Map();
const memorySessions = new Map();

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

function validateAccountPassword(value) {
  const password = String(value || '');
  return password.length >= 6 && password.length <= 72 ? password : '';
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

function setSessionCookie(res, token) {
  const maxAge = 30 * 24 * 60 * 60;
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `lnz_session=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`);
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
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_login_at TIMESTAMPTZ
      );
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

async function createUserAccount(username, password) {
  const id = crypto.randomUUID();
  const usernameKey = username.toLowerCase();
  const passwordHash = hashPassword(password);
  if (databaseReady) {
    try {
      await dbPool.query('INSERT INTO users (id,username,username_key,password_hash) VALUES ($1,$2,$3,$4)', [id, username, usernameKey, passwordHash]);
      return { id, username };
    } catch (error) {
      if (error?.code === '23505') throw new Error('Esse login já está em uso.');
      throw error;
    }
  }
  if (memoryUsers.has(usernameKey)) throw new Error('Esse login já está em uso.');
  memoryUsers.set(usernameKey, { id, username, usernameKey, passwordHash, createdAt: Date.now() });
  return { id, username };
}

async function authenticateUser(username, password) {
  const usernameKey = username.toLowerCase();
  if (databaseReady) {
    const { rows } = await dbPool.query('SELECT id,username,password_hash FROM users WHERE username_key=$1 LIMIT 1', [usernameKey]);
    const row = rows[0];
    if (!row || !verifyPassword(password, row.password_hash)) return null;
    await dbPool.query('UPDATE users SET last_login_at=NOW() WHERE id=$1', [row.id]);
    return { id: row.id, username: row.username };
  }
  const row = memoryUsers.get(usernameKey);
  if (!row || !verifyPassword(password, row.passwordHash)) return null;
  return { id: row.id, username: row.username };
}

async function createSessionForUser(user) {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = sessionTokenHash(token);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
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
      SELECT u.id,u.username FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=$1 AND s.expires_at > NOW() LIMIT 1
    `, [tokenHash]);
    return rows[0] || null;
  }
  const session = memorySessions.get(tokenHash);
  if (!session || session.expiresAt <= Date.now()) {
    memorySessions.delete(tokenHash);
    return null;
  }
  return { id: session.userId, username: session.username };
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
    res.json({ ok: true, user, persistentDatabase: databaseReady });
  } catch {
    res.status(500).json({ ok: false, error: 'Não foi possível consultar sua conta.' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  const username = cleanAccountUsername(req.body?.username);
  const password = validateAccountPassword(req.body?.password);
  if (!username) return res.status(400).json({ ok: false, error: 'Use um login de 3 a 24 caracteres: letras, números, ponto, hífen ou _.' });
  if (!password) return res.status(400).json({ ok: false, error: 'A senha precisa ter entre 6 e 72 caracteres.' });
  try {
    const user = await createUserAccount(username, password);
    const token = await createSessionForUser(user);
    setSessionCookie(res, token);
    res.json({ ok: true, user, persistentDatabase: databaseReady });
  } catch (error) {
    res.status(400).json({ ok: false, error: error?.message || 'Não foi possível criar a conta.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const username = cleanAccountUsername(req.body?.username);
  const password = validateAccountPassword(req.body?.password);
  if (!username || !password) return res.status(400).json({ ok: false, error: 'Login ou senha inválidos.' });
  try {
    const user = await authenticateUser(username, password);
    if (!user) return res.status(401).json({ ok: false, error: 'Login ou senha incorretos.' });
    const token = await createSessionForUser(user);
    setSessionCookie(res, token);
    res.json({ ok: true, user, persistentDatabase: databaseReady });
  } catch {
    res.status(500).json({ ok: false, error: 'Não foi possível entrar na conta.' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  try { await destroySession(req); } catch {}
  clearSessionCookie(res);
  res.json({ ok: true });
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


app.get('/admin/feedback', (req, res) => {
  const configured = String(process.env.FEEDBACK_ADMIN_TOKEN || '').trim();
  const supplied = String(req.query.token || '').trim();
  if (!configured || supplied !== configured) return res.status(403).json({ ok: false, error: 'Acesso negado.' });
  res.json({ ok: true, feedbacks: feedbackItems.slice().reverse() });
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
  if (avatar.length > 450000) return '';
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
    nickname: participant.nickname,
    avatar: participant.avatar || '',
    avatarScale: cleanAvatarScale(participant.avatarScale),
    avatarOffsetX: cleanAvatarOffsetX(participant.avatarOffsetX),
    avatarOffsetY: cleanAvatarOffsetY(participant.avatarOffsetY),
    isHost: room.hostId === id,
    isSharer: Boolean(room.sharerIds?.has(id)),
    inVoice: Boolean(participant.inVoice),
    micMuted: Boolean(participant.micMuted),
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
      avatar: cleanAvatar(avatar),
      avatarScale: cleanAvatarScale(avatarScale),
      avatarOffsetX: cleanAvatarOffsetX(avatarOffsetX),
      avatarOffsetY: cleanAvatarOffsetY(avatarOffsetY),
      inVoice: false,
      micMuted: false,
      speaking: false
    });

    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;

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
      avatar: cleanAvatar(avatar),
      avatarScale: cleanAvatarScale(avatarScale),
      avatarOffsetX: cleanAvatarOffsetX(avatarOffsetX),
      avatarOffsetY: cleanAvatarOffsetY(avatarOffsetY),
      inVoice: false,
      micMuted: false,
      speaking: false
    });
    socket.join(code);
    socket.data.roomCode = code;

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
    participant.speaking = false;
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
      participant.speaking = false;
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
    participant.micMuted = Boolean(muted);
    if (participant.micMuted) participant.speaking = false;
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
      room.sharerIds.delete(socket.id);
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
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`LNZ Transmissão online em http://localhost:${PORT}`);
  });
});
