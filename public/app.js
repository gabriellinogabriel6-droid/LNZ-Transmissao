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
  avatarOffsetX: Math.min(60, Math.max(-60, Number(localStorage.getItem('lnz_avatar_offset_x') || 0))),
  avatarOffsetY: Math.min(60, Math.max(-60, Number(localStorage.getItem('lnz_avatar_offset_y') || 0))),
  nickname: localStorage.getItem('lnz_nickname') || '',
  room: null,
  me: null,
  participants: [],
  chatMessages: [],
  selectedChatFile: null,
  unreadChat: 0,
  selectedVisibility: 'public',
  shareAudio: true,
  remoteAudioMuted: false,
  transmissionVolume: Math.min(1, Math.max(0, Number(localStorage.getItem('lnz_transmission_volume') || 0.9))),
  voiceVolume: Math.min(1, Math.max(0, Number(localStorage.getItem('lnz_voice_volume') || 0.9))),
  voiceOutputMuted: localStorage.getItem('lnz_voice_output_muted') === '1',
  mixerOpen: false,
  account: null,
  authMode: 'login',
  authRequired: false,
  suppressDisconnectBanner: false,
  appVersion: null,
  isSharing: false,
  localStream: null,
  sharerIds: new Set(),
  outboundPeers: new Map(),
  inboundPeers: new Map(),
  inboundStreams: new Map(),
  screenPendingInboundIce: new Map(),
  screenPendingOutboundIce: new Map(),
  mutedSharers: new Set(),
  voiceJoined: false,
  voiceMuted: false,
  voiceStream: null,
  voicePeers: new Map(),
  voiceAudios: new Map(),
  voicePendingIce: new Map(),
  voiceSpeaking: false,
  voiceSpeakingContext: null,
  voiceSpeakingTimer: null,
  voiceSpeakingSource: null,
  voiceSpeakingLastLoudAt: 0,
  feedbackType: 'sugestao',
  feedbackRating: 5
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


function setAuthMode(mode) {
  state.authMode = mode === 'register' ? 'register' : 'login';
  const register = state.authMode === 'register';
  $('authLoginTab')?.classList.toggle('active', !register);
  $('authRegisterTab')?.classList.toggle('active', register);
  $('authConfirmWrap')?.classList.toggle('hidden', !register);
  if ($('authTitle')) $('authTitle').textContent = register ? 'Criar sua conta' : 'Entrar na sua conta';
  if ($('authSubmit')) $('authSubmit').textContent = register ? 'Criar conta' : 'Entrar';
  if ($('authPassword')) $('authPassword').autocomplete = register ? 'new-password' : 'current-password';
  $('authError')?.classList.add('hidden');
}

function updateAccountUI() {
  const logged = Boolean(state.account);
  $('accountButton')?.classList.toggle('hidden', logged);
  $('accountSignedIn')?.classList.toggle('hidden', !logged);
  $('authLoggedOut')?.classList.toggle('hidden', logged);
  $('authLoggedIn')?.classList.toggle('hidden', !logged);
  if (logged) {
    const username = state.account.username;
    if ($('accountUsernameLabel')) $('accountUsernameLabel').textContent = username;
    if ($('authLoggedInUsername')) $('authLoggedInUsername').textContent = username;
    state.nickname = username;
    localStorage.setItem('lnz_nickname', username);
    if ($('landingNickname')) {
      $('landingNickname').value = username;
      $('landingNickname').readOnly = true;
    }
    if ($('prejoinNickname')) {
      $('prejoinNickname').value = username;
      $('prejoinNickname').readOnly = true;
    }
    updateNicknamePreview();
  } else {
    if ($('landingNickname')) $('landingNickname').readOnly = true;
    if ($('prejoinNickname')) $('prejoinNickname').readOnly = true;
  }
}

function openAuthModal(required = false) {
  state.authRequired = required || !state.account;
  document.body.classList.toggle('auth-required', state.authRequired && !state.account);
  setAuthMode(state.authMode);
  updateAccountUI();
  $('authModal')?.classList.remove('hidden');
  $('authModal')?.setAttribute('aria-hidden', 'false');
  setTimeout(() => $('authUsername')?.focus(), 60);
  return false;
}

function closeAuthModal() {
  if (!state.account && state.authRequired) return;
  document.body.classList.remove('auth-required');
  $('authModal')?.classList.add('hidden');
  $('authModal')?.setAttribute('aria-hidden', 'true');
}

async function reconnectSocketAfterAuth() {
  state.suppressDisconnectBanner = true;
  if (socket.connected) socket.disconnect();
  return new Promise((resolve) => {
    const done = () => {
      state.suppressDisconnectBanner = false;
      resolve();
    };
    socket.once('connect', done);
    socket.connect();
    setTimeout(done, 4000);
  });
}

async function loadAccount() {
  try {
    const response = await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' });
    const data = await response.json();
    state.account = data?.user || null;
    if ($('authDatabaseStatus')) {
      $('authDatabaseStatus').textContent = data?.persistentDatabase
        ? 'Conta salva com segurança no banco PostgreSQL.'
        : 'Atenção: configure DATABASE_URL no Render para salvar contas permanentemente.';
    }
  } catch {
    state.account = null;
  }
  updateAccountUI();
  if (!state.account) openAuthModal(true);
  return state.account;
}

async function submitAuth() {
  const username = $('authUsername')?.value.trim() || '';
  const password = $('authPassword')?.value || '';
  const confirm = $('authPasswordConfirm')?.value || '';
  const error = $('authError');
  if (error) error.classList.add('hidden');

  if (state.authMode === 'register' && password !== confirm) {
    if (error) { error.textContent = 'As duas senhas precisam ser iguais.'; error.classList.remove('hidden'); }
    return;
  }

  const button = $('authSubmit');
  if (button) { button.disabled = true; button.textContent = state.authMode === 'register' ? 'Criando...' : 'Entrando...'; }
  try {
    const response = await fetch(`/api/auth/${state.authMode === 'register' ? 'register' : 'login'}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) throw new Error(data?.error || 'Não foi possível entrar.');
    state.account = data.user;
    state.authRequired = false;
    document.body.classList.remove('auth-required');
    updateAccountUI();
    await reconnectSocketAfterAuth();
    closeAuthModal();
    showToast(state.authMode === 'register' ? 'Conta criada e conectada.' : 'Login realizado.');
    await loadPublicRooms();
    await routeFromLocation();
  } catch (err) {
    if (error) { error.textContent = err?.message || 'Não foi possível entrar.'; error.classList.remove('hidden'); }
  } finally {
    if (button) { button.disabled = false; button.textContent = state.authMode === 'register' ? 'Criar conta' : 'Entrar'; }
  }
}

async function logoutAccount() {
  if (state.room) await leaveRoom();
  try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); } catch {}
  state.account = null;
  updateAccountUI();
  await reconnectSocketAfterAuth();
  openAuthModal(true);
  showToast('Você saiu da conta.');
}

function ensureLoggedIn() {
  if (state.account) return true;
  openAuthModal(true);
  showToast('Faça login para continuar.');
  return false;
}

function showUpdateBanner(title, message, connectionLost = false) {
  const banner = $('updateBanner');
  if (!banner) return;
  banner.querySelector('strong').textContent = title;
  banner.querySelector('span').textContent = message;
  banner.classList.toggle('connection-lost', connectionLost);
  banner.classList.remove('hidden');
}

function hideUpdateBanner() {
  $('updateBanner')?.classList.add('hidden');
}

async function checkAppVersion() {
  try {
    const response = await fetch(`/version?t=${Date.now()}`, { cache: 'no-store' });
    const data = await response.json();
    if (!data?.version) return;
    if (!state.appVersion) state.appVersion = data.version;
    else if (state.appVersion !== data.version) {
      showUpdateBanner('✨ Nova versão disponível', 'O site foi atualizado. Clique em Atualizar agora para carregar a versão nova.');
    }
  } catch {}
}

$('accountButton')?.addEventListener('click', () => openAuthModal(false));
$('accountLogoutQuick')?.addEventListener('click', logoutAccount);
$('authLogout')?.addEventListener('click', logoutAccount);
$('authLoginTab')?.addEventListener('click', () => setAuthMode('login'));
$('authRegisterTab')?.addEventListener('click', () => setAuthMode('register'));
$('authSubmit')?.addEventListener('click', submitAuth);
$('authPassword')?.addEventListener('keydown', (event) => { if (event.key === 'Enter' && state.authMode === 'login') submitAuth(); });
$('authPasswordConfirm')?.addEventListener('keydown', (event) => { if (event.key === 'Enter') submitAuth(); });
$('closeAuth')?.addEventListener('click', closeAuthModal);
$('authModal')?.addEventListener('click', (event) => { if (event.target.dataset.closeAuth) closeAuthModal(); });
$('reloadSite')?.addEventListener('click', () => location.reload());

socket.on('app-version', ({ version }) => {
  if (!version) return;
  if (!state.appVersion) state.appVersion = version;
  else if (state.appVersion !== version) showUpdateBanner('✨ Nova versão disponível', 'O servidor mudou de versão. Atualize a página para continuar.');
});
socket.on('disconnect', () => {
  if (!state.suppressDisconnectBanner) showUpdateBanner('⚠ Conexão perdida', 'O servidor caiu ou está reiniciando. Clique em Atualizar agora após alguns segundos.', true);
});
socket.on('connect', () => {
  if (!state.suppressDisconnectBanner) checkAppVersion();
});
socket.on('connect_error', () => {
  if (!state.suppressDisconnectBanner) showUpdateBanner('⚠ Servidor indisponível', 'Não foi possível conectar. Aguarde alguns segundos e clique em Atualizar agora.', true);
});

setInterval(checkAppVersion, 30000);

function normalizeCode(value) {
  const raw = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  if (raw.length <= 4) return raw;
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
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


function updateFeedbackUI() {
  document.querySelectorAll('.feedback-type').forEach((button) => {
    button.classList.toggle('active', button.dataset.feedbackType === state.feedbackType);
  });
  document.querySelectorAll('#feedbackStars button').forEach((button) => {
    const active = Number(button.dataset.rating) <= state.feedbackRating;
    button.classList.toggle('active', active);
    button.setAttribute('aria-checked', String(Number(button.dataset.rating) === state.feedbackRating));
  });
  const ratingText = $('feedbackRatingText');
  if (ratingText) ratingText.textContent = `${state.feedbackRating}/5`;
}

function openFeedbackModal() {
  state.feedbackType = 'sugestao';
  state.feedbackRating = 5;
  $('feedbackMessage').value = '';
  $('feedbackContact').value = '';
  $('feedbackMessageCount').textContent = '0/1000';
  updateFeedbackUI();
  $('feedbackModal').classList.remove('hidden');
  $('feedbackModal').setAttribute('aria-hidden', 'false');
  setTimeout(() => $('feedbackMessage')?.focus(), 80);
}

function closeFeedbackModal() {
  $('feedbackModal').classList.add('hidden');
  $('feedbackModal').setAttribute('aria-hidden', 'true');
}

async function submitFeedback() {
  const message = $('feedbackMessage').value.trim();
  const contact = $('feedbackContact').value.trim();
  if (message.length < 3) return showToast('Escreva um feedback um pouco mais detalhado.');

  const button = $('sendFeedback');
  button.disabled = true;
  button.textContent = 'Enviando...';
  const result = await new Promise((resolve) => socket.emit('submit-feedback', {
    type: state.feedbackType,
    rating: state.feedbackRating,
    message,
    contact
  }, resolve));
  button.disabled = false;
  button.textContent = 'Enviar feedback';

  if (!result?.ok) return showToast(result?.error || 'Não foi possível enviar o feedback.');
  closeFeedbackModal();
  showToast(result.sentToDiscord ? 'Feedback enviado. Obrigado! 💜' : 'Feedback recebido. Obrigado! 💜');
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
  localStorage.setItem('lnz_avatar_offset_x', String(state.avatarOffsetX || 0));
  localStorage.setItem('lnz_avatar_offset_y', String(state.avatarOffsetY || 0));
}

function persistAvatarState() {
  if (state.avatar) localStorage.setItem('lnz_avatar', state.avatar);
  else localStorage.removeItem('lnz_avatar');
  localStorage.setItem('lnz_avatar_scale', String(state.avatarScale || 1));
  localStorage.setItem('lnz_avatar_offset_x', String(state.avatarOffsetX || 0));
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

function applyAvatarTransform(img, scale = state.avatarScale, offsetX = state.avatarOffsetX, offsetY = state.avatarOffsetY) {
  if (!img) return;
  img.style.setProperty('--avatar-scale', String(scale || 1));
  img.style.setProperty('--avatar-x', String(Number(offsetX) || 0));
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
      img.style.removeProperty('--avatar-x');
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
    state.avatarOffsetX = 0;
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
  state.avatarOffsetX = 0;
  state.avatarOffsetY = 0;
  persistAvatarState();
  updateAvatarUI();
  showToast('Foto removida.');
});

function updateAvatarEditorPreview() {
  const img = $('avatarEditorImage');
  const scale = Number($('avatarZoom').value || state.avatarScale || 1);
  const offsetX = Number($('avatarPositionX').value || 0);
  const offsetY = Number($('avatarPositionY').value || 0);
  $('avatarZoomValue').textContent = `${Math.round(scale * 100)}%`;
  $('avatarPositionXValue').textContent = offsetX === 0 ? 'Centro' : (offsetX < 0 ? `${Math.abs(offsetX)}% para esquerda` : `${offsetX}% para direita`);
  $('avatarPositionYValue').textContent = offsetY === 0 ? 'Centro' : (offsetY < 0 ? `${Math.abs(offsetY)}% para cima` : `${offsetY}% para baixo`);
  $('avatarEditorInitials').textContent = initials($('landingNickname').value.trim() || $('prejoinNickname').value.trim() || state.nickname || 'LZ');
  if (state.avatar) {
    img.src = state.avatar;
    img.classList.remove('hidden');
    applyAvatarTransform(img, scale, offsetX, offsetY);
  } else {
    img.removeAttribute('src');
    img.classList.add('hidden');
    img.style.removeProperty('--avatar-scale');
    img.style.removeProperty('--avatar-x');
    img.style.removeProperty('--avatar-y');
  }
}

function openAvatarEditor() {
  if (!state.avatar) return showToast('Escolha uma foto primeiro.');
  $('avatarZoom').value = String(state.avatarScale || 1);
  $('avatarPositionX').value = String(state.avatarOffsetX || 0);
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
$('avatarPositionX').addEventListener('input', updateAvatarEditorPreview);
$('avatarPositionY').addEventListener('input', updateAvatarEditorPreview);

function clampAvatarAxis(value) {
  return Math.min(60, Math.max(-60, Number(value) || 0));
}

function nudgeAvatarX(delta) {
  $('avatarPositionX').value = String(clampAvatarAxis(Number($('avatarPositionX').value || 0) + delta));
  updateAvatarEditorPreview();
}

function nudgeAvatarY(delta) {
  $('avatarPositionY').value = String(clampAvatarAxis(Number($('avatarPositionY').value || 0) + delta));
  updateAvatarEditorPreview();
}

$('avatarMoveLeft').addEventListener('click', () => nudgeAvatarX(-8));
$('avatarMoveRight').addEventListener('click', () => nudgeAvatarX(8));
$('avatarMoveUp').addEventListener('click', () => nudgeAvatarY(-8));
$('avatarMoveDown').addEventListener('click', () => nudgeAvatarY(8));
$('avatarCenterPosition').addEventListener('click', () => {
  $('avatarPositionX').value = '0';
  $('avatarPositionY').value = '0';
  updateAvatarEditorPreview();
});

// Arraste a imagem livremente dentro do círculo: esquerda/direita/cima/baixo.
(() => {
  const preview = $('avatarEditorPreview');
  let dragging = false;
  let startClientX = 0;
  let startClientY = 0;
  let startOffsetX = 0;
  let startOffsetY = 0;

  preview.addEventListener('pointerdown', (event) => {
    if (!state.avatar) return;
    dragging = true;
    startClientX = event.clientX;
    startClientY = event.clientY;
    startOffsetX = Number($('avatarPositionX').value || 0);
    startOffsetY = Number($('avatarPositionY').value || 0);
    preview.setPointerCapture?.(event.pointerId);
    preview.classList.add('dragging');
  });

  preview.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const deltaX = ((event.clientX - startClientX) / Math.max(1, preview.clientWidth)) * 100;
    const deltaY = ((event.clientY - startClientY) / Math.max(1, preview.clientHeight)) * 100;
    $('avatarPositionX').value = String(clampAvatarAxis(startOffsetX + deltaX));
    $('avatarPositionY').value = String(clampAvatarAxis(startOffsetY + deltaY));
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
  $('avatarPositionX').value = '0';
  $('avatarPositionY').value = '0';
  updateAvatarEditorPreview();
});
$('saveAvatarEditor').addEventListener('click', () => {
  state.avatarScale = Math.min(3, Math.max(0.5, Number($('avatarZoom').value || 1)));
  state.avatarOffsetX = clampAvatarAxis($('avatarPositionX').value);
  state.avatarOffsetY = clampAvatarAxis($('avatarPositionY').value);
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
  if (!ensureLoggedIn()) return;
  const nickname = state.account.username;
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
  if (!ensureLoggedIn()) return;
  const nickname = state.account.username;
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
    avatarOffsetX: state.avatarOffsetX,
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
  if (!ensureLoggedIn()) return;
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
  const access = $('prejoinAccess');
  const roomOpen = info.room.isOpen !== false;
  access.textContent = roomOpen ? 'ABERTA' : 'FECHADA';
  access.className = `access-pill ${roomOpen ? 'open' : 'closed'}`;
  $('enterRoom').disabled = !roomOpen;
  $('enterRoom').textContent = roomOpen ? 'Entrar na sala →' : 'Sala fechada';
  $('passwordField').classList.toggle('hidden', !info.requiresPassword);
  $('roomPassword').value = '';
  $('prejoinNickname').value = state.account?.username || state.nickname;
  updateNicknamePreview();
  updateAvatarUI();
  setView('prejoin');
}

$('goToRoom').addEventListener('click', () => {
  if (!ensureLoggedIn()) return;
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
  if (!ensureLoggedIn()) return;
  if (!state.room) return;
  if (state.room.isOpen === false) return showToast('Essa sala está fechada pelo dono.');
  const nickname = state.account.username;

  $('enterRoom').disabled = true;
  const result = await new Promise((resolve) => socket.emit('join-room', {
    roomCode: state.room.code,
    nickname,
    avatar: state.avatar,
    avatarScale: state.avatarScale,
    avatarOffsetX: state.avatarOffsetX,
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
  state.sharerIds = new Set(result.sharerIds || []);
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
  const roomOpen = state.room.isOpen !== false;
  const accessBadge = $('roomAccessBadge');
  accessBadge.textContent = roomOpen ? 'ABERTA' : 'FECHADA';
  accessBadge.className = `access-pill ${roomOpen ? 'open' : 'closed'}`;
  const meParticipant = state.participants.find((p) => p.id === state.me);
  const accessButton = $('toggleRoomAccess');
  const isHost = Boolean(meParticipant?.isHost);
  accessButton.classList.toggle('hidden', !isHost);
  accessButton.textContent = roomOpen ? '🔒 Fechar sala' : '🔓 Abrir sala';
  accessButton.classList.toggle('closed-state', !roomOpen);
  $('sidebarPrivacy').innerHTML = state.room.visibility === 'private'
    ? '<span class="privacy-pill private">🔒 PRIVADA</span><small>Senha necessária</small>'
    : '<span class="privacy-pill public">◎ PÚBLICA</span><small>Visível na lista pública</small>';

  const me = meParticipant;
  $('meName').textContent = me?.nickname || state.nickname || 'Você';
  const meMini = $('meMiniAvatar');
  if (me?.avatar) {
    meMini.innerHTML = `<img src="${me.avatar}" alt="" style="--avatar-scale:${me.avatarScale || 1};--avatar-x:${me.avatarOffsetX || 0};--avatar-y:${me.avatarOffsetY || 0}">`;
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
      img.style.setProperty('--avatar-x', String(person.avatarOffsetX || 0));
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
    if (person.inVoice) {
      if (person.micMuted) sub.textContent = 'Na call • Mic OFF';
      else if (person.speaking) sub.textContent = 'Falando agora';
      else sub.textContent = 'Na call • Em silêncio';
    } else if (person.isSharer) {
      sub.textContent = 'Compartilhando tela';
    } else {
      sub.textContent = person.id === state.me ? 'Você' : 'Conectado';
    }
    details.append(name, sub);

    if (person.speaking && person.inVoice && !person.micMuted) row.classList.add('speaking');

    const badges = document.createElement('div');
    badges.className = 'participant-badges';
    if (person.isHost) badges.innerHTML += '<b title="Dono da sala">♛</b>';
    if (person.inVoice) {
      if (person.micMuted) badges.innerHTML += '<span class="voice-badge muted" title="Na call com microfone desligado">🔇</span>';
      else if (person.speaking) badges.innerHTML += '<span class="voice-badge speaking" title="Falando agora">🔊</span>';
      else badges.innerHTML += '<span class="voice-badge" title="Na call de voz">🎙</span>';
    }
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

$('toggleRoomAccess').addEventListener('click', async () => {
  if (!state.room) return;
  const nextOpen = state.room.isOpen === false;
  const result = await new Promise((resolve) => socket.emit('set-room-access', { open: nextOpen }, resolve));
  if (!result?.ok) return showToast(result?.error || 'Não foi possível alterar a sala.');
  state.room.isOpen = result.isOpen;
  renderRoom();
  showToast(result.isOpen ? 'Sala aberta para novas entradas.' : 'Sala fechada. Quem já entrou continua na sala.');
});

socket.on('room-access-changed', ({ isOpen, changedBy }) => {
  if (!state.room) return;
  state.room.isOpen = Boolean(isOpen);
  renderRoom();
  if (changedBy !== state.me) showToast(isOpen ? 'A sala foi aberta pelo dono.' : 'A sala foi fechada pelo dono.');
});

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
    img.style.setProperty('--avatar-x', String(message.avatarOffsetX || 0));
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

function voicePeerConnection() {
  return new RTCPeerConnection({ iceServers: config.iceServers });
}

function removeVoiceAudio(peerId) {
  const audio = state.voiceAudios.get(peerId);
  if (audio) {
    audio.srcObject = null;
    audio.remove();
  }
  state.voiceAudios.delete(peerId);
}

function closeVoicePeer(peerId) {
  const pc = state.voicePeers.get(peerId);
  if (pc) pc.close();
  state.voicePeers.delete(peerId);
  state.voicePendingIce.delete(peerId);
  removeVoiceAudio(peerId);
}

function closeAllVoicePeers() {
  for (const peerId of [...state.voicePeers.keys()]) closeVoicePeer(peerId);
}

function attachRemoteVoice(peerId, stream) {
  let audio = state.voiceAudios.get(peerId);
  if (!audio) {
    audio = document.createElement('audio');
    audio.autoplay = true;
    audio.playsInline = true;
    audio.dataset.peerId = peerId;
    $('voiceAudioContainer').appendChild(audio);
    state.voiceAudios.set(peerId, audio);
  }
  audio.srcObject = stream;
  audio.muted = state.voiceOutputMuted;
  audio.volume = state.voiceOutputMuted ? 0 : state.voiceVolume;
  audio.play().catch(() => {});
}

async function flushVoiceIce(peerId, pc) {
  const queued = state.voicePendingIce.get(peerId) || [];
  state.voicePendingIce.delete(peerId);
  for (const candidate of queued) {
    try { await pc.addIceCandidate(candidate); } catch {}
  }
}

async function createVoicePeer(peerId, initiator = false) {
  if (!state.voiceJoined || !state.voiceStream || !peerId || peerId === state.me) return null;
  if (state.voicePeers.has(peerId)) return state.voicePeers.get(peerId);

  const pc = voicePeerConnection();
  state.voicePeers.set(peerId, pc);
  state.voiceStream.getAudioTracks().forEach((track) => pc.addTrack(track, state.voiceStream));

  pc.onicecandidate = (event) => {
    if (event.candidate) socket.emit('voice-signal', { target: peerId, data: { type: 'ice', candidate: event.candidate } });
  };
  pc.ontrack = (event) => {
    const stream = event.streams?.[0];
    if (stream) attachRemoteVoice(peerId, stream);
  };
  pc.onconnectionstatechange = () => {
    if (['failed', 'closed'].includes(pc.connectionState)) closeVoicePeer(peerId);
  };

  if (initiator) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('voice-signal', { target: peerId, data: { type: 'offer', sdp: pc.localDescription } });
  }
  return pc;
}

function stopVoiceSpeakingDetector(notify = true) {
  if (state.voiceSpeakingTimer) {
    cancelAnimationFrame(state.voiceSpeakingTimer);
    state.voiceSpeakingTimer = null;
  }
  try { state.voiceSpeakingSource?.disconnect(); } catch {}
  state.voiceSpeakingSource = null;
  if (state.voiceSpeakingContext) {
    state.voiceSpeakingContext.close().catch(() => {});
    state.voiceSpeakingContext = null;
  }
  if (state.voiceSpeaking && notify) socket.emit('voice-speaking-state', { speaking: false }, () => {});
  state.voiceSpeaking = false;
  state.voiceSpeakingLastLoudAt = 0;
}

function setLocalSpeakingState(speaking) {
  const next = Boolean(speaking) && !state.voiceMuted && state.voiceJoined;
  if (next === state.voiceSpeaking) return;
  state.voiceSpeaking = next;
  socket.emit('voice-speaking-state', { speaking: next }, () => {});
}

function startVoiceSpeakingDetector(stream) {
  stopVoiceSpeakingDetector(false);
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const context = new AudioCtx();
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.72;
    const source = context.createMediaStreamSource(stream);
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    state.voiceSpeakingContext = context;
    state.voiceSpeakingSource = source;

    const tick = () => {
      if (!state.voiceJoined || !state.voiceStream) return;
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const sample = (data[i] - 128) / 128;
        sum += sample * sample;
      }
      const rms = Math.sqrt(sum / data.length);
      const now = performance.now();
      if (!state.voiceMuted && rms > 0.045) state.voiceSpeakingLastLoudAt = now;
      const speaking = !state.voiceMuted && (now - state.voiceSpeakingLastLoudAt) < 420;
      setLocalSpeakingState(speaking);
      state.voiceSpeakingTimer = requestAnimationFrame(tick);
    };
    state.voiceSpeakingTimer = requestAnimationFrame(tick);
  } catch {}
}

function updateVoiceControls() {
  const call = $('voiceCallControl');
  const mic = $('micControl');
  if (!call || !mic) return;
  call.textContent = state.voiceJoined ? '📞 Sair da call' : '📞 Entrar na call';
  call.classList.toggle('voice-active', state.voiceJoined);
  mic.disabled = !state.voiceJoined;
  mic.textContent = state.voiceMuted ? '🔇 Mic OFF' : '🎙 Mic ON';
  mic.classList.toggle('mic-muted', state.voiceMuted);
}

async function joinVoiceCall() {
  if (!state.room || state.voiceJoined) return;
  if (!navigator.mediaDevices?.getUserMedia) return showToast('Seu navegador não permite usar o microfone.');

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1
      },
      video: false
    });

    const result = await new Promise((resolve) => socket.emit('join-voice', {}, resolve));
    if (!result?.ok) {
      stream.getTracks().forEach((track) => track.stop());
      return showToast(result?.error || 'Não foi possível entrar na call.');
    }

    state.voiceStream = stream;
    state.voiceJoined = true;
    state.voiceMuted = false;
    startVoiceSpeakingDetector(stream);
    updateVoiceControls();
    showToast('Você entrou na call de voz.');

    for (const peerId of result.peerIds || []) {
      createVoicePeer(peerId, true).catch(() => {});
    }
  } catch (error) {
    if (error?.name === 'NotAllowedError') showToast('Permita o acesso ao microfone para entrar na call.');
    else showToast('Não foi possível abrir o microfone.');
  }
}

async function leaveVoiceCall(notifyServer = true) {
  if (notifyServer && state.voiceJoined) {
    await new Promise((resolve) => socket.emit('leave-voice', {}, resolve));
  }
  closeAllVoicePeers();
  stopVoiceSpeakingDetector(true);
  state.voiceStream?.getTracks().forEach((track) => track.stop());
  state.voiceStream = null;
  state.voiceJoined = false;
  state.voiceMuted = false;
  updateVoiceControls();
}

function toggleVoiceMic() {
  if (!state.voiceJoined || !state.voiceStream) return;
  state.voiceMuted = !state.voiceMuted;
  state.voiceStream.getAudioTracks().forEach((track) => { track.enabled = !state.voiceMuted; });
  socket.emit('voice-mic-state', { muted: state.voiceMuted }, () => {});
  if (state.voiceMuted) setLocalSpeakingState(false);
  updateVoiceControls();
}

$('voiceCallControl').addEventListener('click', () => {
  if (state.voiceJoined) leaveVoiceCall(true);
  else joinVoiceCall();
});
$('micControl').addEventListener('click', toggleVoiceMic);

socket.on('voice-user-left', ({ userId }) => {
  closeVoicePeer(userId);
});

socket.on('voice-signal', async ({ from, data }) => {
  if (!state.voiceJoined || !from || !data) return;
  try {
    if (data.type === 'offer') {
      let pc = state.voicePeers.get(from);
      if (!pc) pc = await createVoicePeer(from, false);
      await pc.setRemoteDescription(data.sdp);
      await flushVoiceIce(from, pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('voice-signal', { target: from, data: { type: 'answer', sdp: pc.localDescription } });
      return;
    }
    if (data.type === 'answer') {
      const pc = state.voicePeers.get(from);
      if (pc) {
        await pc.setRemoteDescription(data.sdp);
        await flushVoiceIce(from, pc);
      }
      return;
    }
    if (data.type === 'ice' && data.candidate) {
      const pc = state.voicePeers.get(from);
      if (pc && pc.remoteDescription) {
        await pc.addIceCandidate(data.candidate);
      } else {
        const queued = state.voicePendingIce.get(from) || [];
        queued.push(data.candidate);
        state.voicePendingIce.set(from, queued);
      }
    }
  } catch {
    closeVoicePeer(from);
  }
});

function makePeerConnection() {
  return new RTCPeerConnection({ iceServers: config.iceServers });
}

function remoteSharerIds() {
  return [...state.sharerIds].filter((id) => id !== state.me);
}

function streamCardFor(sharerId) {
  return document.querySelector(`.stream-card[data-sharer-id="${CSS.escape(sharerId)}"]`);
}

function streamVideoFor(sharerId) {
  return streamCardFor(sharerId)?.querySelector('.stream-video') || null;
}

function participantName(id) {
  return state.participants.find((p) => p.id === id)?.nickname || (id === state.me ? state.nickname : 'Participante');
}

function ensureStreamCard(sharerId) {
  let card = streamCardFor(sharerId);
  if (card) return card;

  const isLocal = sharerId === state.me;
  card = document.createElement('article');
  card.className = `stream-card${isLocal ? ' local-stream-card' : ''}`;
  card.dataset.sharerId = sharerId;
  card.innerHTML = `
    <div class="stream-card-head">
      <div class="stream-owner">
        <i class="stream-live-dot"></i>
        <strong class="stream-owner-name"></strong>
        <small>${isLocal ? 'VOCÊ' : 'AO VIVO'}</small>
      </div>
      <div class="stream-actions">
        ${isLocal ? '' : '<button class="stream-action stream-audio-toggle" type="button">🔊 Som ON</button>'}
        <button class="stream-action stream-fullscreen" type="button">⛶ Tela cheia</button>
      </div>
    </div>
    <div class="stream-video-wrap">
      <video class="stream-video" autoplay playsinline ${isLocal ? 'muted' : ''}></video>
      <div class="stream-connecting"><div class="spinner"></div><span>Conectando transmissão...</span></div>
    </div>
  `;

  const audioButton = card.querySelector('.stream-audio-toggle');
  if (audioButton) {
    audioButton.addEventListener('click', () => {
      if (state.mutedSharers.has(sharerId)) state.mutedSharers.delete(sharerId);
      else state.mutedSharers.add(sharerId);
      syncTransmissionAudio();
      updateStreamAudioButtons();
    });
  }

  card.querySelector('.stream-fullscreen')?.addEventListener('click', () => {
    card.querySelector('.stream-video')?.requestFullscreen?.();
  });

  $('streamsGrid').appendChild(card);
  return card;
}

function removeStreamCard(sharerId) {
  const card = streamCardFor(sharerId);
  if (card) {
    const video = card.querySelector('.stream-video');
    if (video) video.srcObject = null;
    card.remove();
  }
  state.mutedSharers.delete(sharerId);
}

function updateStreamAudioButtons() {
  for (const sharerId of remoteSharerIds()) {
    const button = streamCardFor(sharerId)?.querySelector('.stream-audio-toggle');
    if (!button) continue;
    const muted = state.remoteAudioMuted || state.mutedSharers.has(sharerId) || state.transmissionVolume <= 0;
    button.textContent = muted ? '🔇 Som OFF' : '🔊 Som ON';
    button.classList.toggle('muted', muted);
  }
}

function syncTransmissionAudio() {
  document.querySelectorAll('.stream-card').forEach((card) => {
    const sharerId = card.dataset.sharerId;
    const video = card.querySelector('.stream-video');
    if (!video) return;
    const local = sharerId === state.me;
    const muted = local || state.remoteAudioMuted || state.mutedSharers.has(sharerId) || state.transmissionVolume <= 0;
    video.muted = muted;
    video.defaultMuted = muted;
    video.volume = muted ? 0 : state.transmissionVolume;
    if (muted) video.setAttribute('muted', '');
    else video.removeAttribute('muted');
    if (!muted) video.play().catch(() => {});
  });
  updateStreamAudioButtons();
}

function syncVoiceOutputVolume() {
  for (const audio of state.voiceAudios.values()) {
    audio.muted = state.voiceOutputMuted || state.voiceVolume <= 0;
    audio.volume = audio.muted ? 0 : state.voiceVolume;
    if (!audio.muted) audio.play().catch(() => {});
  }
}

function updateMixerUI() {
  const panel = $('audioMixerPanel');
  if (!panel) return;
  panel.classList.toggle('hidden', !state.mixerOpen);

  const transmission = $('transmissionVolume');
  const voice = $('voiceVolume');
  if (transmission) transmission.value = String(Math.round(state.transmissionVolume * 100));
  if (voice) voice.value = String(Math.round(state.voiceVolume * 100));
  if ($('transmissionVolumeValue')) $('transmissionVolumeValue').textContent = `${Math.round(state.transmissionVolume * 100)}%`;
  if ($('voiceVolumeValue')) $('voiceVolumeValue').textContent = `${Math.round(state.voiceVolume * 100)}%`;

  const transmissionMuted = state.remoteAudioMuted || state.transmissionVolume <= 0;
  const transmissionBtn = $('mixerToggleTransmission');
  if (transmissionBtn) {
    transmissionBtn.textContent = transmissionMuted ? '🔇 Mutado' : '🔊 Ouvindo';
    transmissionBtn.classList.toggle('is-muted', transmissionMuted);
  }

  const voiceMuted = state.voiceOutputMuted || state.voiceVolume <= 0;
  const voiceBtn = $('mixerToggleVoice');
  if (voiceBtn) {
    voiceBtn.textContent = voiceMuted ? '🔇 Mutado' : '🔊 Ouvindo';
    voiceBtn.classList.toggle('is-muted', voiceMuted);
  }
}

function setTransmissionVolume(value) {
  state.transmissionVolume = Math.min(1, Math.max(0, Number(value) || 0));
  localStorage.setItem('lnz_transmission_volume', String(state.transmissionVolume));
  if (state.transmissionVolume > 0) state.remoteAudioMuted = false;
  syncTransmissionAudio();
  updateMixerUI();
  updateAudioControl();
}

function setVoiceVolume(value) {
  state.voiceVolume = Math.min(1, Math.max(0, Number(value) || 0));
  localStorage.setItem('lnz_voice_volume', String(state.voiceVolume));
  if (state.voiceVolume > 0) state.voiceOutputMuted = false;
  localStorage.setItem('lnz_voice_output_muted', state.voiceOutputMuted ? '1' : '0');
  syncVoiceOutputVolume();
  updateMixerUI();
}

async function flushScreenIce(map, key, pc) {
  const queued = map.get(key) || [];
  map.delete(key);
  for (const candidate of queued) {
    try { await pc.addIceCandidate(candidate); } catch {}
  }
}

async function createOutboundPeer(viewerId) {
  if (!state.localStream || !state.isSharing || viewerId === state.me) return;
  state.outboundPeers.get(viewerId)?.close();

  const pc = makePeerConnection();
  state.outboundPeers.set(viewerId, pc);
  state.localStream.getTracks().forEach((track) => pc.addTrack(track, state.localStream));

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('signal', { target: viewerId, data: { type: 'ice', shareId: state.me, candidate: event.candidate } });
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
  socket.emit('signal', { target: viewerId, data: { type: 'offer', shareId: state.me, sdp: pc.localDescription } });
}

function closeInboundPeer(sharerId) {
  const pc = state.inboundPeers.get(sharerId);
  if (pc) pc.close();
  state.inboundPeers.delete(sharerId);
  state.inboundStreams.delete(sharerId);
  state.screenPendingInboundIce.delete(sharerId);
  removeStreamCard(sharerId);
}

function closeAllInboundPeers() {
  for (const sharerId of [...state.inboundPeers.keys()]) closeInboundPeer(sharerId);
}

async function startSharing() {
  if (!state.room) return;
  if (!state.account) return openAuthModal(true);
  if (state.isSharing) return stopSharing();
  if (!navigator.mediaDevices?.getDisplayMedia) return showToast('Seu navegador não permite compartilhar tela.');

  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 30, max: 60 } },
      audio: state.shareAudio ? {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        suppressLocalAudioPlayback: false
      } : false,
      systemAudio: state.shareAudio ? 'include' : 'exclude',
      monitorTypeSurfaces: 'include',
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include'
    });

    if (state.shareAudio && stream.getAudioTracks().length === 0) {
      showToast('Nenhum áudio foi capturado. Se quiser som, marque a opção de áudio na janela do navegador.');
    }

    const result = await new Promise((resolve) => socket.emit('start-sharing', {}, resolve));
    if (!result?.ok) {
      stream.getTracks().forEach((track) => track.stop());
      return showToast(result?.error || 'Não foi possível compartilhar.');
    }

    state.localStream = stream;
    state.isSharing = true;
    state.sharerIds.add(state.me);
    const card = ensureStreamCard(state.me);
    const video = card.querySelector('.stream-video');
    video.srcObject = stream;
    video.muted = true;
    video.defaultMuted = true;
    card.querySelector('.stream-connecting')?.classList.add('hidden');
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
  state.screenPendingOutboundIce.clear();
}

function stopSharing(notifyServer = true) {
  if (notifyServer && state.isSharing) socket.emit('stop-sharing', {});
  closeOutboundPeers();
  state.localStream?.getTracks().forEach((track) => track.stop());
  state.localStream = null;
  state.isSharing = false;
  state.sharerIds.delete(state.me);
  removeStreamCard(state.me);
  updateStage();
}

function renderStreamsStage() {
  const active = new Set(state.sharerIds);
  if (state.isSharing && state.me) active.add(state.me);

  document.querySelectorAll('.stream-card').forEach((card) => {
    const id = card.dataset.sharerId;
    if (!active.has(id)) removeStreamCard(id);
  });

  for (const sharerId of active) {
    const card = ensureStreamCard(sharerId);
    const nameEl = card.querySelector('.stream-owner-name');
    if (nameEl) nameEl.textContent = participantName(sharerId);
    if (sharerId === state.me && state.localStream) {
      const video = card.querySelector('.stream-video');
      if (video.srcObject !== state.localStream) video.srcObject = state.localStream;
      card.querySelector('.stream-connecting')?.classList.add('hidden');
    } else {
      const stream = state.inboundStreams.get(sharerId);
      const video = card.querySelector('.stream-video');
      if (stream && video.srcObject !== stream) {
        video.srcObject = stream;
        card.querySelector('.stream-connecting')?.classList.add('hidden');
        video.play().catch(() => {});
      }
    }
  }

  const count = active.size;
  $('emptyStage').classList.toggle('hidden', count > 0);
  $('videoStage').classList.toggle('hidden', count === 0);
  $('streamsGrid').classList.toggle('single-stream', count === 1);
  $('sharingLabel').textContent = count === 1 ? '1 transmissão ao vivo' : `${count} transmissões ao vivo`;
  $('sharingCountLabel').textContent = `${count} AO VIVO`;
  syncTransmissionAudio();
}

function updateStage() {
  renderStreamsStage();
  $('shareControl').textContent = state.isSharing ? '■ Parar transmissão' : '▣ Compartilhar tela';
  $('shareControl').classList.toggle('stop-control', state.isSharing);
  $('shareFromEmpty').disabled = false;
  updateAudioControl();
}

function updateAudioControl() {
  const button = $('audioControl');
  if (!button) return;

  const remoteCount = remoteSharerIds().length;
  if (remoteCount > 0) {
    button.disabled = false;
    button.textContent = state.remoteAudioMuted ? '🔇 Transmissões OFF' : '🔊 Transmissões ON';
    button.classList.toggle('audio-on', !state.remoteAudioMuted);
    button.title = 'Liga ou desliga o áudio das transmissões que você está assistindo.';
    return;
  }

  if (state.isSharing) {
    const hasAudio = Boolean(state.localStream?.getAudioTracks().length);
    button.disabled = true;
    button.textContent = hasAudio ? '🔊 Áudio enviado' : '🔇 Sem áudio';
    button.classList.toggle('audio-on', hasAudio);
    button.title = 'Seu próprio player fica mudo para não dar retorno.';
    return;
  }

  button.disabled = false;
  button.textContent = state.shareAudio ? '🔊 Enviar áudio ON' : '🔇 Enviar áudio OFF';
  button.classList.toggle('audio-on', state.shareAudio);
  button.title = 'Ative antes de compartilhar.';
}

$('audioControl').addEventListener('click', () => {
  if (remoteSharerIds().length > 0) {
    state.remoteAudioMuted = !state.remoteAudioMuted;
    syncTransmissionAudio();
    updateAudioControl();
    updateMixerUI();
    return;
  }
  if (state.isSharing) return;
  state.shareAudio = !state.shareAudio;
  updateAudioControl();
  showToast(state.shareAudio ? 'Áudio ativado para a próxima transmissão.' : 'Áudio da transmissão desativado.');
});

$('mixerControl')?.addEventListener('click', () => {
  state.mixerOpen = !state.mixerOpen;
  updateMixerUI();
});
$('transmissionVolume')?.addEventListener('input', (event) => setTransmissionVolume(Number(event.target.value) / 100));
$('voiceVolume')?.addEventListener('input', (event) => setVoiceVolume(Number(event.target.value) / 100));
$('mixerToggleTransmission')?.addEventListener('click', () => {
  state.remoteAudioMuted = !state.remoteAudioMuted;
  syncTransmissionAudio();
  updateAudioControl();
  updateMixerUI();
});
$('mixerToggleVoice')?.addEventListener('click', () => {
  state.voiceOutputMuted = !state.voiceOutputMuted;
  localStorage.setItem('lnz_voice_output_muted', state.voiceOutputMuted ? '1' : '0');
  syncVoiceOutputVolume();
  updateMixerUI();
});

$('shareFromEmpty').addEventListener('click', startSharing);
$('shareControl').addEventListener('click', startSharing);
$('fullscreenControl').addEventListener('click', () => {
  if (state.sharerIds.size === 0 && !state.isSharing) return showToast('Não há transmissão na tela.');
  $('videoStage').requestFullscreen?.();
});

async function leaveRoom() {
  if (!state.room) return;
  await leaveVoiceCall(true);
  stopSharing(true);
  closeAllInboundPeers();
  await new Promise((resolve) => socket.emit('leave-room', {}, resolve));
  state.room = null;
  state.me = null;
  state.participants = [];
  state.chatMessages = [];
  state.unreadChat = 0;
  state.sharerIds.clear();
  state.inboundStreams.clear();
  clearSelectedChatFile();
  closeChat();
  updateChatUnread();
  $('streamsGrid').innerHTML = '';
  history.pushState({}, '', '/');
  setView('landing');
  loadPublicRooms();
}
$('leaveControl').addEventListener('click', leaveRoom);

socket.on('room-state', ({ room, participants, sharerIds }) => {
  if (!state.room || room.code !== state.room.code) return;
  state.room = room;
  state.participants = participants || [];
  state.sharerIds = new Set(sharerIds || []);
  if (state.isSharing && state.me) state.sharerIds.add(state.me);

  for (const id of [...state.inboundPeers.keys()]) {
    if (!state.sharerIds.has(id)) closeInboundPeer(id);
  }
  renderRoom();
  updateStage();
  updateVoiceControls();
});

socket.on('sharing-started', ({ sharerId }) => {
  if (!state.room || !sharerId) return;
  state.sharerIds.add(sharerId);
  if (sharerId !== state.me) ensureStreamCard(sharerId);
  updateStage();
});

socket.on('sharing-stopped', ({ sharerId }) => {
  if (!state.room || !sharerId) return;
  state.sharerIds.delete(sharerId);
  if (sharerId === state.me) {
    if (state.isSharing) {
      state.localStream?.getTracks().forEach((track) => track.stop());
      state.localStream = null;
      state.isSharing = false;
      closeOutboundPeers();
    }
    removeStreamCard(sharerId);
  } else {
    closeInboundPeer(sharerId);
  }
  updateStage();
});

socket.on('viewer-joined', ({ viewerId }) => {
  createOutboundPeer(viewerId).catch(() => {});
});

socket.on('viewer-left', ({ viewerId }) => {
  const pc = state.outboundPeers.get(viewerId);
  if (pc) pc.close();
  state.outboundPeers.delete(viewerId);
  state.screenPendingOutboundIce.delete(viewerId);
});

socket.on('signal', async ({ from, data }) => {
  try {
    const shareId = data?.shareId;
    if (!shareId || !from || !data?.type) return;

    if (data.type === 'offer') {
      if (shareId !== from || from === state.me) return;
      closeInboundPeer(shareId);
      const pc = makePeerConnection();
      state.inboundPeers.set(shareId, pc);
      ensureStreamCard(shareId);

      pc.onicecandidate = (event) => {
        if (event.candidate) socket.emit('signal', { target: from, data: { type: 'ice', shareId, candidate: event.candidate } });
      };
      pc.ontrack = (event) => {
        const stream = event.streams?.[0];
        if (!stream) return;
        state.inboundStreams.set(shareId, stream);
        state.sharerIds.add(shareId);
        const card = ensureStreamCard(shareId);
        const video = card.querySelector('.stream-video');
        video.srcObject = stream;
        card.querySelector('.stream-connecting')?.classList.add('hidden');
        syncTransmissionAudio();
        video.play().catch(() => {});
        updateStage();
      };
      pc.onconnectionstatechange = () => {
        if (['failed', 'closed'].includes(pc.connectionState)) {
          const card = streamCardFor(shareId);
          card?.querySelector('.stream-connecting')?.classList.remove('hidden');
        }
      };

      await pc.setRemoteDescription(data.sdp);
      await flushScreenIce(state.screenPendingInboundIce, shareId, pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('signal', { target: from, data: { type: 'answer', shareId, sdp: pc.localDescription } });
      return;
    }

    if (data.type === 'answer') {
      if (shareId !== state.me) return;
      const pc = state.outboundPeers.get(from);
      if (pc) {
        await pc.setRemoteDescription(data.sdp);
        await flushScreenIce(state.screenPendingOutboundIce, from, pc);
      }
      return;
    }

    if (data.type === 'ice' && data.candidate) {
      if (shareId === state.me) {
        const pc = state.outboundPeers.get(from);
        if (pc?.remoteDescription) await pc.addIceCandidate(data.candidate);
        else {
          const queued = state.screenPendingOutboundIce.get(from) || [];
          queued.push(data.candidate);
          state.screenPendingOutboundIce.set(from, queued);
        }
      } else if (shareId === from) {
        const pc = state.inboundPeers.get(shareId);
        if (pc?.remoteDescription) await pc.addIceCandidate(data.candidate);
        else {
          const queued = state.screenPendingInboundIce.get(shareId) || [];
          queued.push(data.candidate);
          state.screenPendingInboundIce.set(shareId, queued);
        }
      }
    }
  } catch {
    showToast('Falha na conexão de uma transmissão.');
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
      <div class="public-room-top"><span class="public-dot"></span><strong>${room.code}</strong><em>${room.sharing ? `${room.sharingCount || 1} TELA${(room.sharingCount || 1) === 1 ? '' : 'S'} AO VIVO` : 'ABERTA'}</em></div>
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
  if (state.voiceJoined) socket.emit('leave-voice', {});
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



function renderPublicFeedbacks(items = []) {
  const list = $('publicFeedbackList');
  if (!list) return;
  list.innerHTML = '';
  $('publicFeedbackEmpty')?.classList.toggle('hidden', items.length > 0);
  const count = items.length;
  const avg = count ? items.reduce((sum, item) => sum + Number(item.rating || 0), 0) / count : 0;
  if ($('publicFeedbackAverage')) $('publicFeedbackAverage').textContent = count ? avg.toFixed(1) : '—';
  if ($('publicFeedbackCount')) $('publicFeedbackCount').textContent = String(count);
  for (const item of items) {
    const card = document.createElement('div');
    card.className = 'public-feedback-item';
    const date = item.createdAt ? new Date(item.createdAt).toLocaleDateString('pt-BR') : '';
    card.innerHTML = `<div class="public-feedback-item-head"><strong>${escapeHtml(item.nickname || 'Usuário LNZ')}</strong><span>${'★'.repeat(Math.max(1, Math.min(5, Number(item.rating || 5))))}</span></div><p></p><small>${escapeHtml(item.type || 'feedback')} ${date ? `• ${escapeHtml(date)}` : ''}</small>`;
    card.querySelector('p').textContent = item.message || '';
    list.appendChild(card);
  }
}

async function loadPublicFeedbacks() {
  try {
    const result = await new Promise((resolve) => socket.emit('list-public-feedback', resolve));
    if (result?.ok) renderPublicFeedbacks(result.feedbacks || []);
  } catch {}
}

function openPublicFeedbackModal() {
  $('publicFeedbackModal')?.classList.remove('hidden');
  $('publicFeedbackModal')?.setAttribute('aria-hidden', 'false');
  loadPublicFeedbacks();
}

function closePublicFeedbackModal() {
  $('publicFeedbackModal')?.classList.add('hidden');
  $('publicFeedbackModal')?.setAttribute('aria-hidden', 'true');
}

$('heroFeedbacks')?.addEventListener('click', openPublicFeedbackModal);
$('refreshPublicFeedback')?.addEventListener('click', loadPublicFeedbacks);
$('closePublicFeedback')?.addEventListener('click', closePublicFeedbackModal);
$('publicFeedbackModal')?.addEventListener('click', (event) => { if (event.target.dataset.closePublicFeedback) closePublicFeedbackModal(); });
$('writeFeedbackFromPublic')?.addEventListener('click', () => { closePublicFeedbackModal(); openFeedbackModal(); });
socket.on('public-feedback-updated', (items) => renderPublicFeedbacks(items || []));
socket.on('public-feedback-added', () => loadPublicFeedbacks());

const feedbackButton = $('feedbackButton');
if (feedbackButton) feedbackButton.addEventListener('click', openFeedbackModal);
$('heroSendFeedback').addEventListener('click', openFeedbackModal);
$('closeFeedback').addEventListener('click', closeFeedbackModal);
$('feedbackModal').addEventListener('click', (event) => {
  if (event.target.dataset.closeFeedback) closeFeedbackModal();
});
document.querySelectorAll('.feedback-type').forEach((button) => {
  button.addEventListener('click', () => {
    state.feedbackType = button.dataset.feedbackType || 'outro';
    updateFeedbackUI();
  });
});
document.querySelectorAll('#feedbackStars button').forEach((button) => {
  button.addEventListener('click', () => {
    state.feedbackRating = Number(button.dataset.rating) || 5;
    updateFeedbackUI();
  });
});
$('feedbackMessage').addEventListener('input', () => {
  $('feedbackMessageCount').textContent = `${$('feedbackMessage').value.length}/1000`;
});
$('sendFeedback').addEventListener('click', submitFeedback);
$('feedbackMessage').addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') submitFeedback();
});

async function initApp() {
  $('year').textContent = new Date().getFullYear();
  updateAudioControl();
  updateMixerUI();
  applyDiscordLinks();
  applyIdentityToUI();
  updateVoiceControls();
  await checkAppVersion();
  await loadAccount();
  await loadPublicRooms();
  if (state.account) await routeFromLocation();
}

initApp();
