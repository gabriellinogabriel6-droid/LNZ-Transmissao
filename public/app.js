const socket = io();
const config = window.LNZ_CONFIG || {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

const $ = (id) => document.getElementById(id);

const state = {
  avatar: localStorage.getItem('lnz_avatar') || '',
  avatarScale: Math.min(1.8, Math.max(0.6, Number(localStorage.getItem('lnz_avatar_scale') || 1))),
  nickname: localStorage.getItem('lnz_nickname') || '',
  room: null,
  me: null,
  participants: [],
  selectedVisibility: 'public',
  isSharing: false,
  localStream: null,
  sharerId: null,
  outboundPeers: new Map(),
  inboundPeer: null
};

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
}

function persistAvatarState() {
  if (state.avatar) localStorage.setItem('lnz_avatar', state.avatar);
  else localStorage.removeItem('lnz_avatar');
  localStorage.setItem('lnz_avatar_scale', String(state.avatarScale || 1));
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

function applyAvatarScale(img, scale = state.avatarScale) {
  if (!img) return;
  img.style.setProperty('--avatar-scale', String(scale || 1));
}

function updateAvatarUI() {
  const ids = ['landingAvatarImage', 'prejoinAvatarImage'];
  for (const id of ids) {
    const img = $(id);
    if (state.avatar) {
      img.src = state.avatar;
      img.classList.remove('hidden');
      applyAvatarScale(img);
    } else {
      img.removeAttribute('src');
      img.classList.add('hidden');
      img.style.removeProperty('--avatar-scale');
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
    state.avatarScale = 1;
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
  state.avatarScale = 1;
  persistAvatarState();
  updateAvatarUI();
  showToast('Foto removida.');
});

function updateAvatarEditorPreview() {
  const img = $('avatarEditorImage');
  const scale = Number($('avatarZoom').value || state.avatarScale || 1);
  $('avatarZoomValue').textContent = `${Math.round(scale * 100)}%`;
  $('avatarEditorInitials').textContent = initials($('landingNickname').value.trim() || $('prejoinNickname').value.trim() || state.nickname || 'LZ');
  if (state.avatar) {
    img.src = state.avatar;
    img.classList.remove('hidden');
    applyAvatarScale(img, scale);
  } else {
    img.removeAttribute('src');
    img.classList.add('hidden');
    img.style.removeProperty('--avatar-scale');
  }
}

function openAvatarEditor() {
  if (!state.avatar) return showToast('Escolha uma foto primeiro.');
  $('avatarZoom').value = String(state.avatarScale || 1);
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
$('avatarZoom').addEventListener('input', updateAvatarEditorPreview);
$('changeAvatarFromEditor').addEventListener('click', pickAvatar);
$('resetAvatarZoom').addEventListener('click', () => {
  $('avatarZoom').value = '1';
  updateAvatarEditorPreview();
});
$('saveAvatarEditor').addEventListener('click', () => {
  state.avatarScale = Math.min(1.8, Math.max(0.6, Number($('avatarZoom').value || 1)));
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
  state.sharerId = result.sharerId || null;
  setView('room');
  renderRoom();
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
    meMini.innerHTML = `<img src="${me.avatar}" alt="" style="--avatar-scale:${me.avatarScale || 1}">`;
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

function makePeerConnection() {
  return new RTCPeerConnection({ iceServers: config.iceServers });
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
      audio: true
    });

    const result = await new Promise((resolve) => socket.emit('start-sharing', {}, resolve));
    if (!result?.ok) {
      stream.getTracks().forEach((track) => track.stop());
      return showToast(result?.error || 'Não foi possível compartilhar.');
    }

    state.localStream = stream;
    state.isSharing = true;
    state.sharerId = state.me;
    $('stageVideo').srcObject = stream;
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
  $('stageVideo').srcObject = null;
  updateStage();
}

function updateStage() {
  const hasShare = Boolean(state.sharerId || state.isSharing);
  $('emptyStage').classList.toggle('hidden', hasShare);
  $('videoStage').classList.toggle('hidden', !hasShare);
  $('shareControl').textContent = state.isSharing ? '■ Parar transmissão' : '▣ Compartilhar tela';
  $('shareControl').classList.toggle('stop-control', state.isSharing);
  $('shareFromEmpty').disabled = Boolean(state.sharerId && state.sharerId !== state.me);

  if (state.isSharing) {
    $('sharingLabel').textContent = 'Você está compartilhando sua tela';
    $('videoConnecting').classList.add('hidden');
  } else if (state.sharerId) {
    const sharer = state.participants.find((p) => p.id === state.sharerId);
    $('sharingLabel').textContent = `${sharer?.nickname || 'Alguém'} está compartilhando`;
    if (!$('stageVideo').srcObject) $('videoConnecting').classList.remove('hidden');
  }
}

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
    $('stageVideo').srcObject = null;
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
      closeInboundPeer();
      const pc = makePeerConnection();
      state.inboundPeer = pc;

      pc.onicecandidate = (event) => {
        if (event.candidate) socket.emit('signal', { target: from, data: { type: 'ice', candidate: event.candidate } });
      };
      pc.ontrack = (event) => {
        $('stageVideo').srcObject = event.streams[0];
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
applyIdentityToUI();
loadPublicRooms();
routeFromLocation();
