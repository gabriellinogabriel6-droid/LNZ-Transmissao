const socket = io();
const config = window.LNZ_CONFIG || {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  discordUrl: '',
  brandName: 'LNZ Transmissão'
};

const $ = (id) => document.getElementById(id);

const state = {
  avatar: localStorage.getItem('lnz_avatar') || '',
  avatarScale: Math.min(3, Math.max(0.5, Number(localStorage.getItem('lnz_avatar_scale') || 1.35))),
  avatarOffsetY: Math.min(60, Math.max(-60, Number(localStorage.getItem('lnz_avatar_offset_y') || 0))),
  nickname: localStorage.getItem('lnz_nickname') || '',
  room: null,
  me: null,
  participants: [],
  chatMessages: [],
  selectedChatFile: null,
  unreadChat: 0,
  selectedVisibility: 'public',
  shareAudio: false,
  isSharing: false,
  localStream: null,
  sharerId: null,
  outboundPeers: new Map(),
  inboundPeer: null
};

function applyDiscordLinks() {
  const links = ['discordButton', 'footerDiscordLink', 'roomDiscordLink'];
  for (const id of links) {
    const el = $(id);
    if (!el) continue;
    if (config.discordUrl) {
      el.href = config.discordUrl;
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  }
}

function normalizeCode(value) {
  const raw = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  if (raw.length <= 4) return raw;
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1]?.[0] || parts[0][1] || '')).toUpperCase();
}

function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2400);
}

async function copyText(text, label = 'Texto') {
  try {
    await navigator.clipboard.writeText(text);
    showToast(`${label} copiado.`);
  } catch {
    showToast('Não foi possível copiar automaticamente.');
  }
}

function setView(view) {
  $('landingView').classList.toggle('hidden', view !== 'landing');
  $('prejoinView').classList.toggle('hidden', view !== 'prejoin');
  $('roomView').classList.toggle('hidden', view !== 'room');
}

function saveIdentity(nickname) {
  state.nickname = nickname;
  localStorage.setItem('lnz_nickname', nickname);
  if (state.avatar) localStorage.setItem('lnz_avatar', state.avatar);
  localStorage.setItem('lnz_avatar_scale', String(state.avatarScale || 1));
  localStorage.setItem('lnz_avatar_offset_y', String(state.avatarOffsetY || 0));
}

function persistAvatarState() {
  if (state.avatar) localStorage.setItem('lnz_avatar', state.avatar);
  else localStorage.removeItem('lnz_avatar');
  localStorage.setItem('lnz_avatar_scale', String(state.avatarScale || 1));
  localStorage.setItem('lnz_avatar_offset_y', String(state.avatarOffsetY || 0));
}

function applyIdentityToUI() {
  $('landingNickname').value = state.nickname;
  $('prejoinNickname').value = state.nickname;
  updateNicknamePreview();
  updateAvatarUI();
}

function updateNicknamePreview() {
  const landingName = $('landingNickname').value.trim();
  const prejoinName = $('prejoinNickname').value.trim();
  $('landingNickCount').textContent = `${$('landingNickname').value.length}/24`;
  $('prejoinNickCount').textContent = `${$('prejoinNickname').value.length}/24`;
  $('landingAvatarInitials').textContent = initials(landingName || state.nickname || 'LZ');
  $('prejoinAvatarInitials').textContent = initials(prejoinName || state.nickname || '?');
  $('prejoinAvatarName').textContent = prejoinName || 'Sem nickname';
  const editorInitials = $('avatarEditorInitials');
  if (editorInitials) editorInitials.textContent = initials(landingName || prejoinName || state.nickname || 'LZ');
}

function applyAvatarTransform(img, scale = state.avatarScale, offsetY = state.avatarOffsetY) {
  if (!img) return;
  img.style.setProperty('--avatar-scale', String(scale || 1));
  img.style.setProperty('--avatar-y', String(Number(offsetY) || 0));
}

function updateAvatarUI() {
  const ids = ['landingAvatarImage', 'prejoinAvatarImage'];
  for (const id of ids) {
    const img = $(id);
    if (state.avatar) {
      img.src = state.avatar;
      img.classList.remove('hidden');
      applyAvatarTransform(img);
    } else {
      img.removeAttribute('src');
      img.classList.add('hidden');
      img.style.removeProperty('--avatar-scale');
      img.style.removeProperty('--avatar-y');
    }
  }
}

function pickAvatar() {
  $('avatarInput').click();
}

$('avatarInput').addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) return showToast('Escolha uma imagem válida.');
  if (file.size > 320 * 1024) return showToast('Use uma imagem menor que 320 KB.');

  const reader = new FileReader();
  reader.onload = () => {
    state.avatar = String(reader.result || '');
    state.avatarScale = 1.35;
    state.avatarOffsetY = 0;
    persistAvatarState();
    updateAvatarUI();
  };
  reader.readAsDataURL(file);
});

$('landingAvatarButton').addEventListener('click', pickAvatar);
$('prejoinAvatarButton').addEventListener('click', pickAvatar);
$('chooseAvatarPrejoin').addEventListener('click', pickAvatar);
$('adjustAvatarLanding').addEventListener('click', openAvatarEditor);
$('adjustAvatarPrejoin').addEventListener('click', openAvatarEditor);
$('removeAvatarLanding').addEventListener('click', () => {
  state.avatar = '';
  state.avatarScale = 1.35;
  state.avatarOffsetY = 0;
  persistAvatarState();
  updateAvatarUI();
  showToast('Foto removida.');
});

function updateAvatarEditorPreview() {
  const img = $('avatarEditorImage');
  const scale = Number($('avatarZoom').value || state.avatarScale || 1);
  const offsetY = Number($('avatarPositionY').value || 0);
  $('avatarZoomValue').textContent = `${Math.round(scale * 100)}%`;
  $('avatarPositionYValue').textContent = offsetY === 0 ? 'Centro' : (offsetY < 0 ? `${Math.abs(offsetY)}% para cima` : `${offsetY}% para baixo`);
  $('avatarEditorInitials').textContent = initials($('landingNickname').value.trim() || $('prejoinNickname').value.trim() || state.nickname || 'LZ');
  if (state.avatar) {
    img.src = state.avatar;
    img.classList.remove('hidden');
    applyAvatarTransform(img, scale, offsetY);
  } else {
    img.removeAttribute('src');
    img.classList.add('hidden');
    img.style.removeProperty('--avatar-scale');
    img.style.removeProperty('--avatar-y');
  }
}

function openAvatarEditor() {
  if (!state.avatar) return showToast('Escolha uma foto primeiro.');
  $('avatarZoom').value = String(state.avatarScale || 1);
  $('avatarPositionY').value = String(state.avatarOffsetY || 0);
  updateAvatarEditorPreview();
  $('avatarEditorModal').classList.remove('hidden');
  $('avatarEditorModal').setAttribute('aria-hidden', 'false');
}

function closeAvatarEditor() {
  $('avatarEditorModal').classList.add('hidden');
  $('avatarEditorModal').setAttribute('aria-hidden', 'true');
}

$('closeAvatarEditor').addEventListener('click', closeAvatarEditor);
$('avatarEditorModal').addEventListener('click', (event) => {
  if (event.target.dataset.closeAvatarEditor) closeAvatarEditor();
});
$('avatarZoom').min = '0.5';
$('avatarZoom').max = '3';
$('avatarZoom').step = '0.05';
$('avatarZoom').addEventListener('input', updateAvatarEditorPreview);
$('avatarPositionY').addEventListener('input', updateAvatarEditorPreview);

function clampAvatarY(value) {
  return Math.min(60, Math.max(-60, Number(value) || 0));
}

function nudgeAvatarY(delta) {
  $('avatarPositionY').value = String(clampAvatarY(Number($('avatarPositionY').value || 0) + delta));
  updateAvatarEditorPreview();
}

$('avatarMoveUp').addEventListener('click', () => nudgeAvatarY(-8));
$('avatarMoveDown').addEventListener('click', () => nudgeAvatarY(8));
$('avatarCenterY').addEventListener('click', () => {
  $('avatarPositionY').value = '0';
  updateAvatarEditorPreview();
});

// Arrastar a imagem no preview para cima/baixo também ajusta a posição vertical.
(() => {
  const preview = $('avatarEditorPreview');
  let dragging = false;
  let startClientY = 0;
  let startOffset = 0;

  preview.addEventListener('pointerdown', (event) => {
    if (!state.avatar) return;
    dragging = true;
    startClientY = event.clientY;
    startOffset = Number($('avatarPositionY').value || 0);
    preview.setPointerCapture?.(event.pointerId);
    preview.classList.add('dragging');
  });

  preview.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const deltaPx = event.clientY - startClientY;
    const deltaPercent = (deltaPx / Math.max(1, preview.clientHeight)) * 100;
    $('avatarPositionY').value = String(clampAvatarY(startOffset + deltaPercent));
    updateAvatarEditorPreview();
  });

  const finishDrag = () => {
    dragging = false;
    preview.classList.remove('dragging');
  };
  preview.addEventListener('pointerup', finishDrag);
  preview.addEventListener('pointercancel', finishDrag);
})();
$('changeAvatarFromEditor').addEventListener('click', pickAvatar);
$('resetAvatarZoom').addEventListener('click', () => {
  $('avatarZoom').value = '1.35';
  $('avatarPositionY').value = '0';
  updateAvatarEditorPreview();
});
$('saveAvatarEditor').addEventListener('click', () => {
  state.avatarScale = Math.min(3, Math.max(0.5, Number($('avatarZoom').value || 1)));
  state.avatarOffsetY = clampAvatarY($('avatarPositionY').value);
  persistAvatarState();
  updateAvatarUI();
  closeAvatarEditor();
  showToast('Foto ajustada.');
});

$('landingNickname').addEventListener('input', () => {
  $('prejoinNickname').value = $('landingNickname').value;
  updateNicknamePreview();
});
$('prejoinNickname').addEventListener('input', () => {
  $('landingNickname').value = $('prejoinNickname').value;
  updateNicknamePreview();
});

function openCreateModal() {
  const nickname = $('landingNickname').value.trim();
  if (!nickname) return showToast('Digite seu nickname primeiro.');
  state.selectedVisibility = 'public';
  updateVisibilityModal();
  $('createModal').classList.remove('hidden');
  $('createModal').setAttribute('aria-hidden', 'false');
}

function closeCreateModal() {
  $('createModal').classList.add('hidden');
  $('createModal').setAttribute('aria-hidden', 'true');
  $('createPassword').value = '';
}

function updateVisibilityModal() {
  document.querySelectorAll('.visibility-option').forEach((button) => {
    button.classList.toggle('active', button.dataset.visibility === state.selectedVisibility);
  });
  const isPrivate = state.selectedVisibility === 'private';
  $('createPasswordWrap').classList.toggle('hidden', !isPrivate);
  $('createRoomConfirm').textContent = isPrivate ? 'Criar sala privada' : 'Criar sala pública';
}

$('openCreateRoom').addEventListener('click', openCreateModal);
$('heroCreateRoom').addEventListener('click', () => {
  document.getElementById('landingNickname').scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(openCreateModal, 150);
});
$('closeCreateModal').addEventListener('click', closeCreateModal);
$('createModal').addEventListener('click', (event) => {
  if (event.target.dataset.closeModal) closeCreateModal();
});
document.querySelectorAll('.visibility-option').forEach((button) => {
  button.addEventListener('click', () => {
    state.selectedVisibility = button.dataset.visibility;
    updateVisibilityModal();
  });
});

$('createRoomConfirm').addEventListener('click', async () => {
  const nickname = $('landingNickname').value.trim();
  const password = $('createPassword').value;
  if (!nickname) return showToast('Digite seu nickname.');
  if (state.selectedVisibility === 'private' && password.length < 4) {
    return showToast('A senha precisa ter pelo menos 4 caracteres.');
  }

  $('createRoomConfirm').disabled = true;
  const result = await new Promise((resolve) => socket.emit('create-room', {
    nickname,
    avatar: state.avatar,
    avatarScale: state.avatarScale,
    avatarOffsetY: state.avatarOffsetY,
    visibility: state.selectedVisibility,
    password
  }, resolve));
  $('createRoomConfirm').disabled = false;

  if (!result?.ok) return showToast(result?.error || 'Não foi possível criar a sala.');
  saveIdentity(nickname);
  closeCreateModal();
  enterActiveRoom(result);
  history.pushState({}, '', `/room/${result.room.code}`);
  showToast(result.room.visibility === 'private' ? 'Sala privada criada.' : 'Sala pública criada.');
});

async function openPrejoin(code) {
  const clean = normalizeCode(code);
  if (clean.length !== 9) return showToast('Digite um código válido.');

  const info = await new Promise((resolve) => socket.emit('get-room-info', { roomCode: clean }, resolve));
  if (!info?.ok) {
    history.replaceState({}, '', '/');
    setView('landing');
    return showToast(info?.error || 'Sala não encontrada.');
  }

  state.room = info.room;
  $('prejoinRoomCode').textContent = info.room.code;
  $('prejoinPrivacy').textContent = info.room.visibility === 'private' ? '🔒 PRIVADA' : '◎ PÚBLICA';
  $('prejoinPrivacy').className = `privacy-pill ${info.room.visibility}`;
  $('passwordField').classList.toggle('hidden', !info.requiresPassword);
  $('roomPassword').value = '';
  $('prejoinNickname').value = $('landingNickname').value || state.nickname;
  updateNicknamePreview();
  updateAvatarUI();
  setView('prejoin');
}

$('goToRoom').addEventListener('click', () => {
  const code = normalizeCode($('roomCodeInput').value);
  if (code.length !== 9) return showToast('Digite o código completo da sala.');
  history.pushState({}, '', `/room/${code}`);
  openPrejoin(code);
});
$('roomCodeInput').addEventListener('input', () => {
  $('roomCodeInput').value = normalizeCode($('roomCodeInput').value);
});
$('roomCodeInput').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') $('goToRoom').click();
});

$('enterRoom').addEventListener('click', async () => {
  if (!state.room) return;
  const nickname = $('prejoinNickname').value.trim();
  if (!nickname) return showToast('Digite seu nickname.');

  $('enterRoom').disabled = true;
  const result = await new Promise((resolve) => socket.emit('join-room', {
    roomCode: state.room.code,
    nickname,
    avatar: state.avatar,
    avatarScale: state.avatarScale,
    avatarOffsetY: state.avatarOffsetY,
    password: $('roomPassword').value
  }, resolve));
  $('enterRoom').disabled = false;

  if (!result?.ok) return showToast(result?.error || 'Não foi possível entrar.');
  saveIdentity(nickname);
  enterActiveRoom(result);
});

$('backHome').addEventListener('click', () => {
  history.pushState({}, '', '/');
  state.room = null;
  setView('landing');
});

function enterActiveRoom(result) {
  state.room = result.room;
  state.me = result.me;
  state.participants = result.participants || [];
  state.chatMessages = result.chatMessages || [];
  state.unreadChat = 0;
  state.sharerId = result.sharerId || null;
  setView('room');
  renderRoom();
  renderChatHistory();
  updateChatUnread();
  updateStage();
}

function renderRoom() {
  if (!state.room) return;
  const code = state.room.code;
  $('topRoomCode').textContent = code;
  $('sidebarRoomCode').textContent = code;
  $('topPeople').textContent = `♙ ${state.participants.length}`;
  $('participantCount').textContent = String(state.participants.length);
  $('sidebarPrivacy').innerHTML = state.room.visibility === 'private'
    ? '<span class="privacy-pill private">🔒 PRIVADA</span><small>Senha necessária</small>'
    : '<span class="privacy-pill public">◎ PÚBLICA</span><small>Visível na lista pública</small>';

  const me = state.participants.find((p) => p.id === state.me);
  $('meName').textContent = me?.nickname || state.nickname || 'Você';
  const meMini = $('meMiniAvatar');
  if (me?.avatar) {
    meMini.innerHTML = `<img src="${me.avatar}" alt="" style="--avatar-scale:${me.avatarScale || 1};--avatar-y:${me.avatarOffsetY || 0}">`;
  } else {
    meMini.textContent = initials(me?.nickname || state.nickname);
  }

  $('participantsList').innerHTML = '';
  state.participants.forEach((person) => {
    const row = document.createElement('div');
    row.className = 'participant';

    const avatar = document.createElement('div');
    avatar.className = 'participant-avatar';
    if (person.avatar) {
      const img = document.createElement('img');
      img.src = person.avatar;
      img.alt = '';
      img.style.setProperty('--avatar-scale', String(person.avatarScale || 1));
      img.style.setProperty('--avatar-y', String(person.avatarOffsetY || 0));
      avatar.appendChild(img);
    } else {
      avatar.textContent = initials(person.nickname);
    }

    const details = document.createElement('div');
    details.className = 'participant-details';
    const name = document.createElement('strong');
    name.textContent = person.nickname;
    const sub = document.createElement('span');
    sub.textContent = person.id === state.me ? 'Você' : (person.isSharer ? 'Compartilhando tela' : 'Conectado');
    details.append(name, sub);

    const badges = document.createElement('div');
    badges.className = 'participant-badges';
    if (person.isHost) badges.innerHTML += '<b title="Dono da sala">♛</b>';
    if (person.id === state.me) badges.innerHTML += '<em>VOCÊ</em>';

    row.append(avatar, details, badges);
    $('participantsList').appendChild(row);
  });
}

function roomInviteLink() {
  return state.room ? `${location.origin}/room/${state.room.code}` : location.origin;
}

$('copyCode').addEventListener('click', () => copyText(state.room?.code || '', 'Código'));
$('topRoomCode').addEventListener('click', () => copyText(state.room?.code || '', 'Código'));
$('copyInvite').addEventListener('click', () => copyText(roomInviteLink(), 'Link'));
$('copyInviteCenter').addEventListener('click', () => copyText(roomInviteLink(), 'Link'));

const CHAT_MAX_FILE_SIZE = 2 * 1024 * 1024;
const CHAT_ALLOWED_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'pdf', 'txt', 'zip',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'
]);

function formatFileSize(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatChatTime(timestamp) {
  try {
    return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp));
  } catch {
    return '';
  }
}

function isChatDrawerMode() {
  return window.matchMedia('(max-width: 1100px)').matches;
}

function isChatOpen() {
  return !isChatDrawerMode() || $('chatPanel').classList.contains('open');
}

function openChat() {
  $('chatPanel').classList.add('open');
  state.unreadChat = 0;
  updateChatUnread();
  setTimeout(() => $('chatInput').focus(), 50);
  scrollChatToBottom();
}

function closeChat() {
  $('chatPanel').classList.remove('open');
}

function updateChatUnread() {
  const badge = $('chatUnread');
  if (!badge) return;
  badge.textContent = state.unreadChat > 99 ? '99+' : String(state.unreadChat);
  badge.classList.toggle('hidden', state.unreadChat <= 0);
}

function scrollChatToBottom() {
  const container = $('chatMessages');
  if (container) container.scrollTop = container.scrollHeight;
}

function renderChatHistory() {
  const container = $('chatMessages');
  if (!container) return;
  container.innerHTML = '';
  $('chatEmpty')?.remove();

  if (!state.chatMessages.length) {
    const empty = document.createElement('div');
    empty.id = 'chatEmpty';
    empty.className = 'chat-empty';
    const icon = document.createElement('div');
    icon.textContent = '💬';
    const title = document.createElement('strong');
    title.textContent = 'Nenhuma mensagem ainda';
    const text = document.createElement('span');
    text.textContent = 'Envie uma mensagem ou arquivo para a sala.';
    empty.append(icon, title, text);
    container.appendChild(empty);
    return;
  }

  state.chatMessages.forEach((message) => renderChatMessage(message, false));
  scrollChatToBottom();
}

function renderChatMessage(message, shouldScroll = true) {
  const container = $('chatMessages');
  if (!container || !message) return;
  $('chatEmpty')?.remove();

  const item = document.createElement('div');
  item.className = `chat-message${message.senderId === state.me ? ' own' : ''}`;
  item.dataset.messageId = message.id || '';

  const avatar = document.createElement('div');
  avatar.className = 'chat-message-avatar';
  if (message.avatar) {
    const img = document.createElement('img');
    img.src = message.avatar;
    img.alt = '';
    img.style.setProperty('--avatar-scale', String(message.avatarScale || 1));
    img.style.setProperty('--avatar-y', String(message.avatarOffsetY || 0));
    avatar.appendChild(img);
  } else {
    avatar.textContent = initials(message.nickname);
  }

  const body = document.createElement('div');
  body.className = 'chat-message-body';

  const meta = document.createElement('div');
  meta.className = 'chat-message-meta';
  const name = document.createElement('strong');
  name.textContent = message.senderId === state.me ? 'Você' : (message.nickname || 'Participante');
  const time = document.createElement('span');
  time.textContent = formatChatTime(message.createdAt);
  meta.append(name, time);
  body.appendChild(meta);

  if (message.text) {
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.textContent = message.text;
    body.appendChild(bubble);
  }

  if (message.attachment?.data) {
    const attachment = document.createElement('div');
    attachment.className = 'chat-attachment';

    if (String(message.attachment.type || '').startsWith('image/')) {
      const preview = document.createElement('img');
      preview.src = message.attachment.data;
      preview.alt = message.attachment.name || 'Imagem enviada';
      preview.loading = 'lazy';
      attachment.appendChild(preview);
    }

    const download = document.createElement('a');
    download.className = 'chat-file-card';
    download.href = message.attachment.data;
    download.download = message.attachment.name || 'arquivo';
    const icon = document.createElement('span');
    icon.textContent = '📎';
    const fileMeta = document.createElement('div');
    const fileName = document.createElement('strong');
    fileName.textContent = message.attachment.name || 'Arquivo';
    const fileSize = document.createElement('small');
    fileSize.textContent = `${formatFileSize(message.attachment.size)} • clique para baixar`;
    fileMeta.append(fileName, fileSize);
    download.append(icon, fileMeta);
    attachment.appendChild(download);
    body.appendChild(attachment);
  }

  item.append(avatar, body);
  container.appendChild(item);
  if (shouldScroll) scrollChatToBottom();
}

function clearSelectedChatFile() {
  state.selectedChatFile = null;
  $('chatFileInput').value = '';
  $('chatFilePreview').classList.add('hidden');
}

function fileExtension(name) {
  const value = String(name || '');
  return value.includes('.') ? value.split('.').pop().toLowerCase() : '';
}

function chooseChatFile() {
  $('chatFileInput').click();
}

$('chatFileInput').addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const ext = fileExtension(file.name);
  if (!CHAT_ALLOWED_EXTENSIONS.has(ext)) {
    clearSelectedChatFile();
    return showToast('Esse tipo de arquivo não é permitido.');
  }
  if (file.size > CHAT_MAX_FILE_SIZE) {
    clearSelectedChatFile();
    return showToast('O arquivo deve ter no máximo 2 MB.');
  }
  state.selectedChatFile = file;
  $('chatFileName').textContent = file.name;
  $('chatFileSize').textContent = formatFileSize(file.size);
  $('chatFilePreview').classList.remove('hidden');
});

$('chatAttach').addEventListener('click', chooseChatFile);
$('removeChatFile').addEventListener('click', clearSelectedChatFile);
$('chatControl').addEventListener('click', () => {
  if (isChatDrawerMode() && $('chatPanel').classList.contains('open')) closeChat();
  else openChat();
});
$('closeChat').addEventListener('click', closeChat);

$('chatInput').addEventListener('input', () => {
  const input = $('chatInput');
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 110)}px`;
});
$('chatInput').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    $('chatForm').requestSubmit();
  }
});

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Falha ao ler arquivo'));
    reader.readAsDataURL(file);
  });
}

$('chatForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.room || !state.me) return showToast('Entre em uma sala primeiro.');

  const text = $('chatInput').value.trim();
  const file = state.selectedChatFile;
  if (!text && !file) return;

  let attachment = null;
  if (file) {
    try {
      const data = await readFileAsDataURL(file);
      attachment = { name: file.name, type: file.type || 'application/octet-stream', size: file.size, data };
    } catch {
      return showToast('Não foi possível ler o arquivo.');
    }
  }

  $('chatSend').disabled = true;
  const result = await new Promise((resolve) => socket.emit('send-chat-message', { text, attachment }, resolve));
  $('chatSend').disabled = false;
  if (!result?.ok) return showToast(result?.error || 'Não foi possível enviar a mensagem.');

  $('chatInput').value = '';
  $('chatInput').style.height = 'auto';
  clearSelectedChatFile();
});

socket.on('chat-message', (message) => {
  if (!state.room || !message) return;
  state.chatMessages.push(message);
  if (state.chatMessages.length > 80) state.chatMessages.shift();
  renderChatMessage(message);

  if (message.senderId !== state.me && !isChatOpen()) {
    state.unreadChat += 1;
    updateChatUnread();
  }
});

window.addEventListener('resize', () => {
  if (!isChatDrawerMode()) {
    state.unreadChat = 0;
    updateChatUnread();
  }
});

function makePeerConnection() {
  return new RTCPeerConnection({ iceServers: config.iceServers });
}

function hardMuteStageVideo() {
  const video = $('stageVideo');
  if (!video) return;
  video.muted = true;
  video.defaultMuted = true;
  video.volume = 0;
  video.setAttribute('muted', '');
}

async function createOutboundPeer(viewerId) {
  if (!state.localStream || !state.isSharing || viewerId === state.me) return;
  state.outboundPeers.get(viewerId)?.close();

  const pc = makePeerConnection();
  state.outboundPeers.set(viewerId, pc);
  state.localStream.getTracks().forEach((track) => pc.addTrack(track, state.localStream));

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('signal', { target: viewerId, data: { type: 'ice', candidate: event.candidate } });
    }
  };
  pc.onconnectionstatechange = () => {
    if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
      pc.close();
      state.outboundPeers.delete(viewerId);
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit('signal', { target: viewerId, data: { type: 'offer', sdp: pc.localDescription } });
}

async function startSharing() {
  if (!state.room) return;
  if (state.isSharing) return stopSharing();
  if (state.sharerId && state.sharerId !== state.me) return showToast('Outra pessoa já está compartilhando a tela.');
  if (!navigator.mediaDevices?.getDisplayMedia) return showToast('Seu navegador não permite compartilhar tela.');

  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 30, max: 60 } },
      // Modo anti-retorno: a transmissão é SOMENTE VÍDEO.
      // Isso impede eco e evita capturar Discord, notificações e áudio do sistema.
      audio: false,
      systemAudio: 'exclude',
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include'
    });

    // Segurança extra: se algum navegador ainda entregar uma faixa de áudio,
    // ela é encerrada e removida antes de enviar para qualquer participante.
    stream.getAudioTracks().forEach((track) => {
      track.enabled = false;
      track.stop();
      stream.removeTrack(track);
    });

    const result = await new Promise((resolve) => socket.emit('start-sharing', {}, resolve));
    if (!result?.ok) {
      stream.getTracks().forEach((track) => track.stop());
      return showToast(result?.error || 'Não foi possível compartilhar.');
    }

    state.localStream = stream;
    state.isSharing = true;
    state.sharerId = state.me;
    const localPreview = $('stageVideo');
    hardMuteStageVideo();
    localPreview.srcObject = stream;
    stream.getVideoTracks()[0]?.addEventListener('ended', () => stopSharing(), { once: true });

    updateStage();
    for (const viewerId of result.viewerIds || []) {
      createOutboundPeer(viewerId).catch(() => {});
    }
  } catch (error) {
    if (error?.name !== 'NotAllowedError') showToast('Não foi possível iniciar o compartilhamento.');
  }
}

function closeOutboundPeers() {
  for (const pc of state.outboundPeers.values()) pc.close();
  state.outboundPeers.clear();
}

function closeInboundPeer() {
  state.inboundPeer?.close();
  state.inboundPeer = null;
}

function stopSharing(notifyServer = true) {
  if (notifyServer && state.isSharing) socket.emit('stop-sharing', {});
  closeOutboundPeers();
  state.localStream?.getTracks().forEach((track) => track.stop());
  state.localStream = null;
  state.isSharing = false;
  if (state.sharerId === state.me) state.sharerId = null;
  const stageVideo = $('stageVideo');
  stageVideo.srcObject = null;
  hardMuteStageVideo();
  updateStage();
}

function updateStage() {
  hardMuteStageVideo();
  const hasShare = Boolean(state.sharerId || state.isSharing);
  $('emptyStage').classList.toggle('hidden', hasShare);
  $('videoStage').classList.toggle('hidden', !hasShare);
  $('shareControl').textContent = state.isSharing ? '■ Parar transmissão' : '▣ Compartilhar tela';
  $('shareControl').classList.toggle('stop-control', state.isSharing);
  $('shareFromEmpty').disabled = Boolean(state.sharerId && state.sharerId !== state.me);
  updateAudioControl();

  if (state.isSharing) {
    const stageVideo = $('stageVideo');
    stageVideo.muted = true;
    stageVideo.volume = 0;
    $('sharingLabel').textContent = 'Você está compartilhando sua tela';
    $('videoConnecting').classList.add('hidden');
  } else if (state.sharerId) {
    const sharer = state.participants.find((p) => p.id === state.sharerId);
    $('sharingLabel').textContent = `${sharer?.nickname || 'Alguém'} está compartilhando`;
    if (!$('stageVideo').srcObject) $('videoConnecting').classList.remove('hidden');
  }
}

function updateAudioControl() {
  const button = $('audioControl');
  if (!button) return;
  state.shareAudio = false;
  button.textContent = '🔇 Áudio bloqueado';
  button.classList.remove('audio-on');
  button.disabled = true;
  button.title = 'Modo anti-retorno: nenhum áudio é transmitido.';
}

$('audioControl').addEventListener('click', () => {
  showToast('Áudio bloqueado para evitar retorno e impedir captura do Discord.');
});

$('shareFromEmpty').addEventListener('click', startSharing);
$('shareControl').addEventListener('click', startSharing);
$('fullscreenControl').addEventListener('click', () => {
  const video = $('stageVideo');
  if (!video.srcObject) return showToast('Não há transmissão na tela.');
  video.requestFullscreen?.();
});

async function leaveRoom() {
  if (!state.room) return;
  stopSharing(true);
  closeInboundPeer();
  $('stageVideo').srcObject = null;
  await new Promise((resolve) => socket.emit('leave-room', {}, resolve));
  state.room = null;
  state.me = null;
  state.participants = [];
  state.chatMessages = [];
  state.unreadChat = 0;
  clearSelectedChatFile();
  closeChat();
  updateChatUnread();
  state.sharerId = null;
  history.pushState({}, '', '/');
  setView('landing');
  loadPublicRooms();
}
$('leaveControl').addEventListener('click', leaveRoom);

socket.on('room-state', ({ room, participants, sharerId }) => {
  if (!state.room || room.code !== state.room.code) return;
  state.room = room;
  state.participants = participants || [];
  state.sharerId = sharerId || null;
  renderRoom();
  updateStage();
});

socket.on('sharing-started', ({ sharerId }) => {
  if (!state.room) return;
  state.sharerId = sharerId;
  if (sharerId !== state.me) {
    const stageVideo = $('stageVideo');
    stageVideo.srcObject = null;
    hardMuteStageVideo();
    $('videoConnecting').classList.remove('hidden');
  }
  updateStage();
});

socket.on('sharing-stopped', () => {
  if (!state.room) return;
  if (!state.isSharing) {
    closeInboundPeer();
    $('stageVideo').srcObject = null;
  }
  state.sharerId = state.isSharing ? state.me : null;
  updateStage();
});

socket.on('viewer-joined', ({ viewerId }) => {
  createOutboundPeer(viewerId).catch(() => {});
});

socket.on('viewer-left', ({ viewerId }) => {
  const pc = state.outboundPeers.get(viewerId);
  if (pc) pc.close();
  state.outboundPeers.delete(viewerId);
});

socket.on('signal', async ({ from, data }) => {
  try {
    if (data.type === 'offer') {
      // O transmissor nunca deve receber/reproduzir uma transmissão de volta.
      if (state.isSharing || state.sharerId === state.me || from === state.me) return;
      closeInboundPeer();
      const pc = makePeerConnection();
      state.inboundPeer = pc;

      pc.onicecandidate = (event) => {
        if (event.candidate) socket.emit('signal', { target: from, data: { type: 'ice', candidate: event.candidate } });
      };
      pc.ontrack = (event) => {
        if (state.isSharing || state.sharerId === state.me) return;
        const stageVideo = $('stageVideo');
        hardMuteStageVideo();
        stageVideo.srcObject = event.streams[0];
        stageVideo.play?.().catch(() => {});
        $('videoConnecting').classList.add('hidden');
      };
      pc.onconnectionstatechange = () => {
        if (['failed', 'closed'].includes(pc.connectionState)) {
          $('videoConnecting').classList.remove('hidden');
        }
      };

      await pc.setRemoteDescription(data.sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('signal', { target: from, data: { type: 'answer', sdp: pc.localDescription } });
      return;
    }

    if (data.type === 'answer') {
      const pc = state.outboundPeers.get(from);
      if (pc) await pc.setRemoteDescription(data.sdp);
      return;
    }

    if (data.type === 'ice' && data.candidate) {
      const pc = state.isSharing ? state.outboundPeers.get(from) : state.inboundPeer;
      if (pc) await pc.addIceCandidate(data.candidate);
    }
  } catch {
    showToast('Falha na conexão da transmissão.');
  }
});

function renderPublicRooms(rooms) {
  const container = $('publicRooms');
  container.innerHTML = '';
  $('publicEmpty').classList.toggle('hidden', rooms.length > 0);

  rooms.forEach((room) => {
    const card = document.createElement('button');
    card.className = 'public-room-card';
    card.innerHTML = `
      <div class="public-room-top"><span class="public-dot"></span><strong>${room.code}</strong><em>${room.sharing ? 'AO VIVO' : 'ABERTA'}</em></div>
      <div class="public-room-bottom"><span>♙ ${room.participants} participante${room.participants === 1 ? '' : 's'}</span><b>Entrar →</b></div>
    `;
    card.addEventListener('click', () => {
      history.pushState({}, '', `/room/${room.code}`);
      openPrejoin(room.code);
    });
    container.appendChild(card);
  });
}

async function loadPublicRooms() {
  const result = await new Promise((resolve) => socket.emit('list-public-rooms', resolve));
  if (result?.ok) renderPublicRooms(result.rooms || []);
}

socket.on('public-rooms-updated', (rooms) => renderPublicRooms(rooms || []));
$('refreshRooms').addEventListener('click', loadPublicRooms);

window.addEventListener('popstate', () => routeFromLocation());
window.addEventListener('beforeunload', () => {
  if (state.isSharing) socket.emit('stop-sharing', {});
});

async function routeFromLocation() {
  const match = location.pathname.match(/^\/room\/([A-Za-z0-9-]+)/);
  if (match) {
    const code = normalizeCode(match[1]);
    if (state.room?.code === code && state.me) {
      setView('room');
      return;
    }
    await openPrejoin(code);
  } else {
    if (state.room && state.me) await leaveRoom();
    setView('landing');
  }
}

$('year').textContent = new Date().getFullYear();
updateAudioControl();
applyDiscordLinks();
applyIdentityToUI();
loadPublicRooms();
routeFromLocation();
