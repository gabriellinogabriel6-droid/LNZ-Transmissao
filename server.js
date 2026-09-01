const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: true },
  maxHttpBufferSize: 6e6
});

const PORT = Number(process.env.PORT) || 3000;
const rooms = new Map();

app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (_req, res) => {
  res.json({ ok: true, rooms: rooms.size });
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
      brandName: process.env.BRAND_NAME || 'LNZ Transmissão'
    })};`
  );
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
    sharing: Boolean(room.sharerId),
    createdAt: room.createdAt
  };
}

function participantView(id, participant, room) {
  return {
    id,
    nickname: participant.nickname,
    avatar: participant.avatar || '',
    avatarScale: cleanAvatarScale(participant.avatarScale),
    avatarOffsetY: cleanAvatarOffsetY(participant.avatarOffsetY),
    isHost: room.hostId === id,
    isSharer: room.sharerId === id
  };
}

function participantsFor(room) {
  return [...room.participants.entries()].map(([id, participant]) => participantView(id, participant, room));
}

function publicRooms() {
  return [...rooms.values()]
    .filter((room) => room.visibility === 'public')
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
    sharerId: room.sharerId
  });
}

function removeSocketFromRoom(socket, reason = 'left') {
  const code = socket.data.roomCode;
  if (!code) return;

  const room = rooms.get(code);
  socket.data.roomCode = null;
  if (!room) return;

  room.participants.delete(socket.id);
  socket.leave(code);

  if (room.sharerId === socket.id) {
    room.sharerId = null;
    io.to(code).emit('sharing-stopped', { reason: 'A transmissão foi encerrada.' });
  } else if (room.sharerId) {
    io.to(room.sharerId).emit('viewer-left', { viewerId: socket.id });
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

io.on('connection', (socket) => {
  socket.emit('public-rooms-updated', publicRooms());

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

  socket.on('create-room', ({ nickname, avatar, avatarScale, avatarOffsetY, visibility, password }, callback = () => {}) => {
    const cleanName = cleanNickname(nickname);
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
      sharerId: null,
      createdAt: Date.now(),
      participants: new Map(),
      chatMessages: [],
      chatBytes: 0
    };

    room.participants.set(socket.id, {
      nickname: cleanName,
      avatar: cleanAvatar(avatar),
      avatarScale: cleanAvatarScale(avatarScale),
      avatarOffsetY: cleanAvatarOffsetY(avatarOffsetY)
    });

    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;

    callback({
      ok: true,
      room: roomPublicView(room),
      participants: participantsFor(room),
      chatMessages: room.chatMessages.map(chatMessageView),
      me: socket.id
    });

    broadcastRoomState(room);
    broadcastPublicRooms();
  });

  socket.on('join-room', ({ roomCode, nickname, avatar, avatarScale, avatarOffsetY, password }, callback = () => {}) => {
    const code = normalizeCode(compactCode(roomCode));
    const cleanName = cleanNickname(nickname);
    const room = rooms.get(code);

    if (!room) return callback({ ok: false, error: 'Sala não encontrada ou encerrada.' });
    if (!cleanName) return callback({ ok: false, error: 'Digite seu nickname.' });
    if (room.visibility === 'private' && !verifyPassword(password, room.passwordHash)) {
      return callback({ ok: false, error: 'Senha da sala incorreta.' });
    }

    removeSocketFromRoom(socket);

    room.participants.set(socket.id, {
      nickname: cleanName,
      avatar: cleanAvatar(avatar),
      avatarScale: cleanAvatarScale(avatarScale),
      avatarOffsetY: cleanAvatarOffsetY(avatarOffsetY)
    });
    socket.join(code);
    socket.data.roomCode = code;

    callback({
      ok: true,
      room: roomPublicView(room),
      participants: participantsFor(room),
      chatMessages: room.chatMessages.map(chatMessageView),
      me: socket.id,
      sharerId: room.sharerId
    });

    broadcastRoomState(room);
    broadcastPublicRooms();

    if (room.sharerId && room.sharerId !== socket.id) {
      io.to(room.sharerId).emit('viewer-joined', { viewerId: socket.id });
    }
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
      avatarOffsetY: cleanAvatarOffsetY(participant.avatarOffsetY),
      text: cleanText,
      attachment: fileResult.attachment,
      createdAt: now
    };

    addChatMessage(room, message, fileResult.bytes);
    io.to(code).emit('chat-message', chatMessageView(message));
    callback({ ok: true, messageId: message.id });
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
    if (room.sharerId && room.sharerId !== socket.id) {
      return callback({ ok: false, error: 'Outra pessoa já está compartilhando a tela.' });
    }

    room.sharerId = socket.id;
    const viewerIds = [...room.participants.keys()].filter((id) => id !== socket.id);
    callback({ ok: true, viewerIds });
    io.to(code).emit('sharing-started', { sharerId: socket.id });
    broadcastRoomState(room);
    broadcastPublicRooms();
  });

  socket.on('stop-sharing', (_payload, callback = () => {}) => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (room && room.sharerId === socket.id) {
      room.sharerId = null;
      io.to(code).emit('sharing-stopped', { reason: 'A transmissão foi encerrada.' });
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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`LNZ Transmissão online em http://localhost:${PORT}`);
});
