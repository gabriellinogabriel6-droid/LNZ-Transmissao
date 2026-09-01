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
  activeProfile: null,
  activeProfileRelation: 'none',
  themeColor: localStorage.getItem('lnz_theme_color') || '#7a3cff',
  seasonTheme: localStorage.getItem('lnz_season_theme') || 'default',
  pendingSeasonTheme: localStorage.getItem('lnz_season_theme') || 'default',
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
  voiceServerMuted: false,
  voiceStream: null,
  voicePeers: new Map(),
  voiceAudios: new Map(),
  voiceRemoteStreams: new Map(),
  voicePendingIce: new Map(),
  voicePeerVolumes: new Map(),
  voicePeerMuted: new Set(),
  cameraOn: false,
  cameraTrack: null,
  cameraHiddenPeers: new Set(),
  cameraDockMinimized: false,
  participantMenuTarget: null,
  voiceSpeaking: false,
  voiceSpeakingContext: null,
  voiceSpeakingTimer: null,
  voiceSpeakingSource: null,
  voiceSpeakingLastLoudAt: 0,
  feedbackType: 'sugestao',
  feedbackRating: 5,
  adminTab: 'logs'
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
  state.authMode = ['register', 'recover'].includes(mode) ? mode : 'login';
  const register = state.authMode === 'register';
  const recover = state.authMode === 'recover';
  const login = state.authMode === 'login';

  $('authConfirmWrap')?.classList.toggle('hidden', !(register || recover));
  $('authRecoveryCodeWrap')?.classList.toggle('hidden', !recover);
  $('authRememberWrap')?.classList.toggle('hidden', recover);
  $('authLoginActions')?.classList.toggle('hidden', !login);
  $('authBackToLogin')?.classList.toggle('hidden', login);
  $('chooseAnotherUsername')?.classList.add('hidden');

  if ($('authEyebrow')) $('authEyebrow').textContent = register ? 'CRIE SUA CONTA' : (recover ? 'RECUPERAÇÃO DE CONTA' : 'BEM-VINDO DE VOLTA');
  if ($('authTitle')) $('authTitle').textContent = register ? 'Escolha seu usuário' : (recover ? 'Recuperar acesso' : 'Entrar na sua conta');
  if ($('authSubtitle')) $('authSubtitle').textContent = register
    ? 'Crie um usuário único para usar todos os recursos do LNZ.'
    : (recover ? 'Use seu código de recuperação para definir uma nova senha.' : 'Entre para acessar suas salas, perfil, amigos e configurações.');
  if ($('authSubmit')) $('authSubmit').textContent = register ? 'Criar minha conta' : (recover ? 'Salvar nova senha' : 'Entrar');
  if ($('authPasswordLabel')) $('authPasswordLabel').textContent = recover ? 'NOVA SENHA' : 'SENHA';
  if ($('authUsernameHelper')) $('authUsernameHelper').textContent = register ? 'O nome precisa ser único e ter de 3 a 24 caracteres.' : 'Digite o usuário da sua conta.';
  if ($('authPassword')) {
    $('authPassword').autocomplete = register || recover ? 'new-password' : 'current-password';
    $('authPassword').placeholder = recover ? 'Crie uma nova senha' : (register ? 'Crie uma senha segura' : 'Digite sua senha');
  }
  if ($('authPasswordConfirm')) $('authPasswordConfirm').placeholder = recover ? 'Repita a nova senha' : 'Repita sua senha';
  $('authError')?.classList.add('hidden');
  setUsernameAvailability();
}

function updateAccountUI() {
  const logged = Boolean(state.account);
  $('accountButton')?.classList.toggle('hidden', logged);
  $('accountSignedIn')?.classList.toggle('hidden', !logged);
  $('authLoggedOut')?.classList.toggle('hidden', logged);
  $('authLoggedIn')?.classList.toggle('hidden', !logged);
  document.querySelectorAll('.social-account-action').forEach((el) => el.classList.toggle('hidden', !logged));
  const adminVisible = Boolean(logged && state.account?.isAdmin);
  document.querySelectorAll('.admin-only').forEach((el) => el.classList.toggle('hidden', !adminVisible));
  if (logged) {
    const username = state.account.username;
    if ($('accountUsernameLabel')) $('accountUsernameLabel').textContent = username;
    if ($('authLoggedInUsername')) $('authLoggedInUsername').textContent = username;
    state.nickname = username;
    localStorage.setItem('lnz_nickname', username);

    // O perfil salvo na conta passa a ser a fonte principal do avatar/tema.
    if (typeof state.account.avatar === 'string') state.avatar = state.account.avatar;
    if (Number.isFinite(Number(state.account.avatarScale))) state.avatarScale = Number(state.account.avatarScale);
    if (Number.isFinite(Number(state.account.avatarOffsetX))) state.avatarOffsetX = Number(state.account.avatarOffsetX);
    if (Number.isFinite(Number(state.account.avatarOffsetY))) state.avatarOffsetY = Number(state.account.avatarOffsetY);
    state.themeColor = state.account.themeColor || state.themeColor || '#7a3cff';
    const savedPrefs = state.account.preferences || {};
    if (Number.isFinite(Number(savedPrefs.transmissionVolume))) state.transmissionVolume = Math.min(1, Math.max(0, Number(savedPrefs.transmissionVolume)));
    if (Number.isFinite(Number(savedPrefs.voiceVolume))) state.voiceVolume = Math.min(1, Math.max(0, Number(savedPrefs.voiceVolume)));
    if (typeof savedPrefs.voiceOutputMuted === 'boolean') state.voiceOutputMuted = savedPrefs.voiceOutputMuted;
    if (typeof savedPrefs.transmissionMuted === 'boolean') state.remoteAudioMuted = savedPrefs.transmissionMuted;
    if (typeof savedPrefs.shareAudio === 'boolean') state.shareAudio = savedPrefs.shareAudio;
    localStorage.setItem('lnz_theme_color', state.themeColor);
    localStorage.setItem('lnz_transmission_volume', String(state.transmissionVolume));
    localStorage.setItem('lnz_voice_volume', String(state.voiceVolume));
    localStorage.setItem('lnz_voice_output_muted', state.voiceOutputMuted ? '1' : '0');
    persistAvatarState();
    applyThemeColor(state.themeColor);
    updateMixerUI?.();
    updateAudioControl?.();

    if ($('landingNickname')) {
      $('landingNickname').value = username;
      $('landingNickname').readOnly = true;
    }
    if ($('prejoinNickname')) {
      $('prejoinNickname').value = username;
      $('prejoinNickname').readOnly = true;
    }
    updateNicknamePreview();
    updateAvatarUI();
    renderEditProfileAvatar();
  } else {
    if ($('landingNickname')) $('landingNickname').readOnly = true;
    if ($('prejoinNickname')) $('prejoinNickname').readOnly = true;
    document.querySelectorAll('.social-account-action').forEach((el) => el.classList.add('hidden'));
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
  } catch {
    state.account = null;
  }
  updateAccountUI();
  if (!state.account) openAuthModal(true);
  return state.account;
}

function showRecoveryCode(code) {
  if (!code) return;
  const value = $('recoveryCodeValue');
  if (value) value.textContent = code;
  $('recoveryCodeModal')?.classList.remove('hidden');
  $('recoveryCodeModal')?.setAttribute('aria-hidden', 'false');
}

function closeRecoveryCodeModal() {
  $('recoveryCodeModal')?.classList.add('hidden');
  $('recoveryCodeModal')?.setAttribute('aria-hidden', 'true');
}

async function copyRecoveryCodeValue() {
  const code = $('recoveryCodeValue')?.textContent?.trim() || '';
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    showToast('Código de recuperação copiado.');
  } catch {
    showToast('Não foi possível copiar automaticamente.');
  }
}

async function regenerateRecoveryCode() {
  const button = $('regenerateRecoveryCode');
  if (button) { button.disabled = true; button.textContent = 'Gerando...'; }
  try {
    const response = await fetch('/api/auth/recovery-code/regenerate', { method: 'POST', credentials: 'same-origin' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) throw new Error(data?.error || 'Não foi possível gerar o código.');
    showRecoveryCode(data.recoveryCode);
  } catch (error) {
    showToast(error?.message || 'Não foi possível gerar o código.');
  } finally {
    if (button) { button.disabled = false; button.textContent = '🔑 Gerar novo código de recuperação'; }
  }
}

let usernameCheckTimer = null;
let lastUsernameAvailability = null;

function setUsernameAvailability(message = '', type = '') {
  const el = $('authUsernameStatus');
  const chooseAnother = $('chooseAnotherUsername');
  if (!el) return;
  if (!message) {
    el.textContent = '';
    el.className = 'auth-username-status hidden';
    chooseAnother?.classList.add('hidden');
    return;
  }
  el.textContent = message;
  el.className = `auth-username-status ${type}`;
  chooseAnother?.classList.toggle('hidden', type !== 'taken');
}

async function checkUsernameAvailability() {
  if (state.authMode !== 'register') {
    lastUsernameAvailability = null;
    setUsernameAvailability();
    return;
  }
  const username = $('authUsername')?.value.trim() || '';
  if (!/^[A-Za-z0-9_.-]{3,24}$/.test(username)) {
    lastUsernameAvailability = false;
    setUsernameAvailability('Escolha um user válido de 3 a 24 caracteres.', 'invalid');
    return;
  }
  setUsernameAvailability('Verificando...', 'checking');
  try {
    const response = await fetch(`/api/auth/username-available?username=${encodeURIComponent(username)}`, { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) throw new Error('Falha');
    lastUsernameAvailability = Boolean(data.available);
    setUsernameAvailability(data.available ? '✓ Usuário disponível' : '✕ Esse nome já existe — escolha outro nome', data.available ? 'available' : 'taken');
  } catch {
    lastUsernameAvailability = null;
    setUsernameAvailability('Não foi possível verificar agora.', 'checking');
  }
}

$('authUsername')?.addEventListener('input', () => {
  clearTimeout(usernameCheckTimer);
  lastUsernameAvailability = null;
  if (state.authMode !== 'register') {
    setUsernameAvailability();
    return;
  }
  usernameCheckTimer = setTimeout(checkUsernameAvailability, 350);
});

async function submitAuth() {
  const username = $('authUsername')?.value.trim() || '';
  const password = $('authPassword')?.value || '';
  const confirm = $('authPasswordConfirm')?.value || '';
  const recoveryCode = $('authRecoveryCode')?.value.trim() || '';
  const remember = state.authMode === 'recover' ? true : Boolean($('authRemember')?.checked);
  const error = $('authError');
  if (error) error.classList.add('hidden');

  if (state.authMode === 'register') {
    if (lastUsernameAvailability === false) {
      if (error) { error.textContent = 'Esse nome já existe. Escolha outro nome.'; error.classList.remove('hidden'); }
      return;
    }
    if (lastUsernameAvailability === null) await checkUsernameAvailability();
    if (lastUsernameAvailability === false) {
      if (error) { error.textContent = 'Esse nome já existe. Escolha outro nome.'; error.classList.remove('hidden'); }
      return;
    }
  }

  if ((state.authMode === 'register' || state.authMode === 'recover') && password !== confirm) {
    if (error) { error.textContent = 'As duas senhas precisam ser iguais.'; error.classList.remove('hidden'); }
    return;
  }
  if (state.authMode === 'recover' && !recoveryCode) {
    if (error) { error.textContent = 'Digite seu código de recuperação.'; error.classList.remove('hidden'); }
    return;
  }

  const button = $('authSubmit');
  const loadingText = state.authMode === 'register' ? 'Criando...' : (state.authMode === 'recover' ? 'Recuperando...' : 'Entrando...');
  if (button) { button.disabled = true; button.textContent = loadingText; }
  try {
    const endpoint = state.authMode === 'register' ? 'register' : (state.authMode === 'recover' ? 'recover' : 'login');
    const body = state.authMode === 'recover'
      ? { username, recoveryCode, password, remember }
      : { username, password, remember };
    localStorage.setItem('lnz_remember_login', remember ? '1' : '0');
    const response = await fetch(`/api/auth/${endpoint}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) throw new Error(data?.error || 'Não foi possível entrar.');
    state.account = data.user;
    state.authRequired = false;
    document.body.classList.remove('auth-required');
    updateAccountUI();
    await reconnectSocketAfterAuth();
    closeAuthModal();
    if (data.recoveryCode) showRecoveryCode(data.recoveryCode);
    showToast(state.authMode === 'register'
      ? (remember ? 'Conta criada. Você ficará conectado neste dispositivo.' : 'Conta criada e conectada.')
      : (state.authMode === 'recover'
        ? 'Senha alterada. Você já está conectado.'
        : (remember ? 'Login realizado. Manter conectado ativado.' : 'Login realizado.')));
    setAuthMode('login');
    if ($('authPassword')) $('authPassword').value = '';
    if ($('authPasswordConfirm')) $('authPasswordConfirm').value = '';
    if ($('authRecoveryCode')) $('authRecoveryCode').value = '';
    await loadPublicRooms();
    await loadFriends(false);
    await routeFromLocation();
  } catch (err) {
    if (error) { error.textContent = err?.message || 'Não foi possível entrar.'; error.classList.remove('hidden'); }
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = state.authMode === 'register' ? 'Criar conta' : (state.authMode === 'recover' ? 'Trocar senha e entrar' : 'Entrar');
    }
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


function hexToRgb(hex) {
  const clean = String(hex || '#7a3cff').replace('#', '');
  const value = Number.parseInt(clean, 16);
  if (!Number.isFinite(value)) return { r: 122, g: 60, b: 255 };
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

function lightenHex(hex, amount = 0.18) {
  const { r, g, b } = hexToRgb(hex);
  const mix = (v) => Math.round(v + (255 - v) * amount).toString(16).padStart(2, '0');
  return `#${mix(r)}${mix(g)}${mix(b)}`;
}

function applyThemeColor(color) {
  const selected = /^#[0-9a-f]{6}$/i.test(String(color || '')) ? String(color).toLowerCase() : '#7a3cff';
  state.themeColor = selected;
  localStorage.setItem('lnz_theme_color', selected);
  const { r, g, b } = hexToRgb(selected);
  const root = document.documentElement;
  root.style.setProperty('--accent', selected);
  root.style.setProperty('--accent-2', lightenHex(selected, .2));
  root.style.setProperty('--cyan', lightenHex(selected, .12));
  root.style.setProperty('--line', `rgba(${r}, ${g}, ${b}, .22)`);
  root.style.setProperty('--line-strong', `rgba(${r}, ${g}, ${b}, .42)`);
  root.style.setProperty('--user-accent-rgb', `${r}, ${g}, ${b}`);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', selected);
  if ($('themeColorPicker')) $('themeColorPicker').value = selected;
  if ($('themeHexLabel')) $('themeHexLabel').textContent = selected.toUpperCase();
  document.querySelectorAll('#themePresets [data-theme]').forEach((button) => {
    button.classList.toggle('active', button.dataset.theme?.toLowerCase() === selected);
  });
}

async function apiJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.ok) throw new Error(data?.error || 'Não foi possível concluir a ação.');
  return data;
}

function currentSavedPreferences() {
  return {
    transmissionVolume: state.transmissionVolume,
    voiceVolume: state.voiceVolume,
    voiceOutputMuted: state.voiceOutputMuted,
    transmissionMuted: state.remoteAudioMuted,
    shareAudio: state.shareAudio
  };
}

function savePreferencesToAccountSoon() {
  if (!state.account) return;
  clearTimeout(savePreferencesToAccountSoon.timer);
  savePreferencesToAccountSoon.timer = setTimeout(async () => {
    try {
      const data = await apiJson('/api/preferences/update', {
        method: 'POST',
        body: JSON.stringify({ preferences: currentSavedPreferences() })
      });
      state.account = { ...state.account, preferences: data.preferences };
    } catch {
      // Mantém a preferência local e tenta de novo na próxima alteração.
    }
  }, 450);
}

function setAvatarInContainer(container, profile, fallback = '?') {
  if (!container) return;
  const avatar = profile?.avatar || '';
  const name = profile?.username || fallback;
  container.innerHTML = '';
  if (avatar) {
    const img = document.createElement('img');
    img.src = avatar;
    img.alt = `Avatar de ${name}`;
    applyAvatarTransform(img, profile?.avatarScale ?? 1.35, profile?.avatarOffsetX ?? 0, profile?.avatarOffsetY ?? 0);
    container.appendChild(img);
  } else {
    const span = document.createElement('span');
    span.textContent = initials(name);
    container.appendChild(span);
  }
}

function renderEditProfileAvatar() {
  if (!$('editProfileAvatar')) return;
  setAvatarInContainer($('editProfileAvatar'), {
    username: state.account?.username || state.nickname || 'LZ',
    avatar: state.avatar,
    avatarScale: state.avatarScale,
    avatarOffsetX: state.avatarOffsetX,
    avatarOffsetY: state.avatarOffsetY
  });
}


async function saveAvatarToAccountSilently({ throwOnError = false } = {}) {
  // Sempre mantém o ajuste no dispositivo atual.
  persistAvatarState();
  if (!state.account) return { ok: true, localOnly: true };
  try {
    const data = await apiJson('/api/profile/update', {
      method: 'POST',
      body: JSON.stringify({
        avatar: state.avatar,
        avatarScale: state.avatarScale,
        avatarOffsetX: state.avatarOffsetX,
        avatarOffsetY: state.avatarOffsetY,
        bio: state.account.bio || '',
        status: state.account.status || '',
        themeColor: state.account.themeColor || state.themeColor || '#7a3cff'
      })
    });
    state.account = { ...state.account, ...data.profile };
    persistAvatarState();
    return { ok: true, localOnly: false, profile: data.profile };
  } catch (error) {
    if (throwOnError) throw error;
    return { ok: false, error };
  }
}

function closeProfileModal() {
  $('profileModal')?.classList.add('hidden');
  $('profileModal')?.setAttribute('aria-hidden', 'true');
  state.activeProfile = null;
  state.activeProfileRelation = 'none';
}

function renderProfile(profile, relation = 'none') {
  state.activeProfile = profile;
  state.activeProfileRelation = relation;
  $('profileUsername').textContent = profile.username || '—';
  $('profileOnline').textContent = profile.online ? 'online' : 'offline';
  $('profileOnline').classList.toggle('online', Boolean(profile.online));
  $('profileStatus').textContent = profile.status || 'Sem status';
  $('profileBio').textContent = profile.bio || 'Este usuário ainda não escreveu uma bio.';
  $('profileMemberSince').textContent = new Date(profile.createdAt || Date.now()).toLocaleDateString('pt-BR');
  setAvatarInContainer($('profileAvatar'), profile, profile.username);

  const isSelf = relation === 'self' || profile.id === state.account?.id || profile.username === state.account?.username;
  $('editMyProfile').classList.toggle('hidden', !isSelf);
  $('profileFriendAction').classList.toggle('hidden', isSelf);
  if (!isSelf) {
    const labels = {
      none: 'Adicionar amigo',
      outgoing: 'Cancelar pedido',
      incoming: 'Aceitar pedido',
      friends: 'Remover amigo'
    };
    $('profileFriendAction').textContent = labels[relation] || 'Adicionar amigo';
  }
}

async function openUserProfile(username) {
  if (!ensureLoggedIn()) return;
  const target = String(username || state.account?.username || '').trim();
  if (!target) return;
  try {
    const data = await apiJson(`/api/profile/${encodeURIComponent(target)}`);
    renderProfile(data.profile, data.relation);
    $('profileModal').classList.remove('hidden');
    $('profileModal').setAttribute('aria-hidden', 'false');
  } catch (error) {
    showToast(error.message);
  }
}

function openEditProfile() {
  if (!state.account) return openAuthModal(true);
  $('profileStatusInput').value = state.account.status || '';
  $('profileBioInput').value = state.account.bio || '';
  $('profileStatusCount').textContent = `${$('profileStatusInput').value.length}/60`;
  $('profileBioCount').textContent = `${$('profileBioInput').value.length}/160`;
  renderEditProfileAvatar();
  $('editProfileModal').classList.remove('hidden');
  $('editProfileModal').setAttribute('aria-hidden', 'false');
}

function closeEditProfile() {
  $('editProfileModal')?.classList.add('hidden');
  $('editProfileModal')?.setAttribute('aria-hidden', 'true');
}

async function saveProfileChanges() {
  if (!state.account) return;
  const button = $('saveProfile');
  button.disabled = true;
  button.textContent = 'Salvando...';
  try {
    const data = await apiJson('/api/profile/update', {
      method: 'POST',
      body: JSON.stringify({
        avatar: state.avatar,
        avatarScale: state.avatarScale,
        avatarOffsetX: state.avatarOffsetX,
        avatarOffsetY: state.avatarOffsetY,
        status: $('profileStatusInput').value.trim(),
        bio: $('profileBioInput').value.trim(),
        themeColor: state.themeColor
      })
    });
    state.account = { ...state.account, ...data.profile };
    updateAccountUI();
    closeEditProfile();
    showToast('Perfil salvo.');
    if (!($('profileModal')?.classList.contains('hidden'))) openUserProfile(state.account.username);
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Salvar perfil';
  }
}

async function runProfileFriendAction() {
  const profile = state.activeProfile;
  if (!profile || !state.account) return;
  try {
    let data;
    if (state.activeProfileRelation === 'incoming') {
      data = await apiJson('/api/friends/respond', { method: 'POST', body: JSON.stringify({ username: profile.username, action: 'accept' }) });
    } else if (state.activeProfileRelation === 'friends' || state.activeProfileRelation === 'outgoing') {
      data = await apiJson('/api/friends/remove', { method: 'POST', body: JSON.stringify({ username: profile.username }) });
    } else {
      data = await apiJson('/api/friends/request', { method: 'POST', body: JSON.stringify({ username: profile.username }) });
    }
    state.activeProfileRelation = data.status || 'none';
    renderProfile(profile, state.activeProfileRelation);
    await loadFriends(false);
    showToast(state.activeProfileRelation === 'friends' ? 'Agora vocês são amigos.' : state.activeProfileRelation === 'outgoing' ? 'Pedido de amizade enviado.' : 'Amizade atualizada.');
  } catch (error) {
    showToast(error.message);
  }
}

function friendCard(profile, mode = 'friend') {
  const row = document.createElement('div');
  row.className = 'friend-item';
  const avatar = document.createElement('button');
  avatar.type = 'button';
  avatar.className = 'friend-avatar';
  setAvatarInContainer(avatar, profile, profile.username);
  avatar.addEventListener('click', () => openUserProfile(profile.username));

  const info = document.createElement('button');
  info.type = 'button';
  info.className = 'friend-info';
  info.innerHTML = `<strong>${escapeHtml(profile.username)}</strong><span>${profile.online ? '● Online' : '○ Offline'}${profile.status ? ` • ${escapeHtml(profile.status)}` : ''}</span>`;
  info.addEventListener('click', () => openUserProfile(profile.username));

  const actions = document.createElement('div');
  actions.className = 'friend-actions';
  if (mode === 'incoming') {
    const accept = document.createElement('button'); accept.type='button'; accept.className='friend-action accept'; accept.textContent='Aceitar';
    const reject = document.createElement('button'); reject.type='button'; reject.className='friend-action'; reject.textContent='Recusar';
    accept.addEventListener('click', async () => { try { await apiJson('/api/friends/respond',{method:'POST',body:JSON.stringify({username:profile.username,action:'accept'})}); await loadFriends(); } catch(e){showToast(e.message);} });
    reject.addEventListener('click', async () => { try { await apiJson('/api/friends/respond',{method:'POST',body:JSON.stringify({username:profile.username,action:'reject'})}); await loadFriends(); } catch(e){showToast(e.message);} });
    actions.append(accept,reject);
  } else if (mode === 'outgoing') {
    const cancel = document.createElement('button'); cancel.type='button'; cancel.className='friend-action'; cancel.textContent='Cancelar';
    cancel.addEventListener('click', async () => { try { await apiJson('/api/friends/remove',{method:'POST',body:JSON.stringify({username:profile.username})}); await loadFriends(); } catch(e){showToast(e.message);} });
    actions.append(cancel);
  } else if (mode === 'search') {
    const add = document.createElement('button'); add.type='button'; add.className='friend-action accept';
    const relation = profile.relation || 'none';
    add.textContent = relation === 'friends' ? 'Amigos' : relation === 'outgoing' ? 'Enviado' : relation === 'incoming' ? 'Aceitar' : 'Adicionar';
    add.disabled = relation === 'friends' || relation === 'outgoing';
    add.addEventListener('click', async () => {
      try {
        if (relation === 'incoming') await apiJson('/api/friends/respond',{method:'POST',body:JSON.stringify({username:profile.username,action:'accept'})});
        else await apiJson('/api/friends/request',{method:'POST',body:JSON.stringify({username:profile.username})});
        await searchFriends(); await loadFriends(false);
      } catch(e){ showToast(e.message); }
    });
    actions.append(add);
  } else {
    const open = document.createElement('button'); open.type='button'; open.className='friend-action'; open.textContent='Perfil'; open.addEventListener('click',()=>openUserProfile(profile.username));
    actions.append(open);
  }
  row.append(avatar, info, actions);
  return row;
}

function renderFriendList(containerId, items, mode, emptyText) {
  const container = $(containerId);
  container.innerHTML = '';
  if (!items?.length) {
    container.innerHTML = `<div class="friend-empty">${escapeHtml(emptyText)}</div>`;
    return;
  }
  items.forEach((item) => container.appendChild(friendCard(item, mode)));
}

async function loadFriends(showErrors = true) {
  if (!state.account) return;
  try {
    const data = await apiJson('/api/friends');
    renderFriendList('acceptedFriends', data.friends, 'friend', 'Você ainda não adicionou amigos.');
    renderFriendList('incomingFriends', data.incoming, 'incoming', 'Nenhum pedido.');
    renderFriendList('outgoingFriends', data.outgoing, 'outgoing', 'Nenhum pedido pendente.');
    $('acceptedFriendCount').textContent = String(data.friends.length);
    $('incomingFriendCount').textContent = String(data.incoming.length);
    $('outgoingFriendCount').textContent = String(data.outgoing.length);
    $('friendRequestBadge').textContent = String(data.incoming.length);
    $('friendRequestBadge').classList.toggle('hidden', data.incoming.length === 0);
  } catch (error) {
    if (showErrors) showToast(error.message);
  }
}

async function searchFriends() {
  const query = $('friendSearchInput').value.trim();
  const container = $('friendSearchResults');
  container.innerHTML = '';
  if (!query) return;
  try {
    const data = await apiJson(`/api/users/search?q=${encodeURIComponent(query)}`);
    renderFriendList('friendSearchResults', data.users, 'search', 'Nenhum usuário encontrado.');
  } catch (error) { showToast(error.message); }
}

async function openFriendsModal() {
  if (!ensureLoggedIn()) return;
  $('friendsModal').classList.remove('hidden');
  $('friendsModal').setAttribute('aria-hidden', 'false');
  await loadFriends();
}

function closeFriendsModal() {
  $('friendsModal')?.classList.add('hidden');
  $('friendsModal')?.setAttribute('aria-hidden', 'true');
}

function applySeasonTheme(mode) {
  const selected = mode === 'halloween' ? 'halloween' : 'default';
  state.pendingSeasonTheme = selected;
  document.documentElement.dataset.seasonTheme = selected;
  applyThemeColor(selected === 'halloween' ? '#ff7a00' : '#7a3cff');
  document.querySelectorAll('[data-season-theme]').forEach((button) => {
    button.classList.toggle('active', button.dataset.seasonTheme === selected);
  });
  const button = $('themeModeButton');
  if (button) button.textContent = selected === 'halloween' ? '🎃 Halloween' : '🎭 Tema';
}

function openThemeModal() {
  state.pendingSeasonTheme = state.seasonTheme || 'default';
  applySeasonTheme(state.pendingSeasonTheme);
  $('themeModal').classList.remove('hidden');
  $('themeModal').setAttribute('aria-hidden', 'false');
}

function closeThemeModal() {
  $('themeModal')?.classList.add('hidden');
  $('themeModal')?.setAttribute('aria-hidden', 'true');
  applySeasonTheme(state.seasonTheme || 'default');
}

function saveThemeColor() {
  state.seasonTheme = state.pendingSeasonTheme === 'halloween' ? 'halloween' : 'default';
  localStorage.setItem('lnz_season_theme', state.seasonTheme);
  applySeasonTheme(state.seasonTheme);
  $('themeModal')?.classList.add('hidden');
  $('themeModal')?.setAttribute('aria-hidden', 'true');
  showToast(state.seasonTheme === 'halloween' ? 'Tema Halloween ativado. 🎃' : 'Tema padrão LNZ ativado.');
}

// Social: Perfil, Amigos e Cor do site.
$('myProfileButton')?.addEventListener('click', () => openUserProfile(state.account?.username));
$('friendsButton')?.addEventListener('click', openFriendsModal);
$('themeButton')?.addEventListener('click', openThemeModal);
$('themeModeButton')?.addEventListener('click', openThemeModal);
$('closeProfile')?.addEventListener('click', closeProfileModal);
$('profileModal')?.addEventListener('click', (event) => { if (event.target.dataset.closeProfile) closeProfileModal(); });
$('profileFriendAction')?.addEventListener('click', runProfileFriendAction);
$('editMyProfile')?.addEventListener('click', () => { closeProfileModal(); openEditProfile(); });
$('closeEditProfile')?.addEventListener('click', closeEditProfile);
$('editProfileModal')?.addEventListener('click', (event) => { if (event.target.dataset.closeEditProfile) closeEditProfile(); });
$('editProfileChooseAvatar')?.addEventListener('click', pickAvatar);
$('editProfileAdjustAvatar')?.addEventListener('click', openAvatarEditor);
$('profileStatusInput')?.addEventListener('input', () => { $('profileStatusCount').textContent = `${$('profileStatusInput').value.length}/60`; });
$('profileBioInput')?.addEventListener('input', () => { $('profileBioCount').textContent = `${$('profileBioInput').value.length}/160`; });
$('saveProfile')?.addEventListener('click', saveProfileChanges);
$('closeFriends')?.addEventListener('click', closeFriendsModal);
$('friendsModal')?.addEventListener('click', (event) => { if (event.target.dataset.closeFriends) closeFriendsModal(); });
$('friendSearchButton')?.addEventListener('click', searchFriends);
$('friendSearchInput')?.addEventListener('keydown', (event) => { if (event.key === 'Enter') searchFriends(); });
$('closeTheme')?.addEventListener('click', closeThemeModal);
$('themeModal')?.addEventListener('click', (event) => { if (event.target.dataset.closeTheme) closeThemeModal(); });
document.querySelectorAll('[data-season-theme]').forEach((button) => button.addEventListener('click', () => applySeasonTheme(button.dataset.seasonTheme)));
$('saveTheme')?.addEventListener('click', saveThemeColor);

socket.on('friend-request', ({ from }) => {
  showToast(`${from || 'Alguém'} enviou um pedido de amizade.`);
  loadFriends(false);
});
socket.on('friendship-updated', () => loadFriends(false));
socket.on('profile-updated', ({ profile }) => {
  if (!profile || profile.id !== state.account?.id) return;
  state.account = { ...state.account, ...profile };
  updateAccountUI();
});

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
$('authRemember')?.addEventListener('change', () => localStorage.setItem('lnz_remember_login', $('authRemember').checked ? '1' : '0'));
$('forgotPasswordButton')?.addEventListener('click', () => setAuthMode('recover'));
$('authCreateAccountButton')?.addEventListener('click', () => { setAuthMode('register'); setTimeout(() => $('authUsername')?.focus(), 50); });
$('authBackToLogin')?.addEventListener('click', () => { setAuthMode('login'); setTimeout(() => $('authUsername')?.focus(), 50); });
$('toggleAuthPassword')?.addEventListener('click', () => {
  const input = $('authPassword');
  const button = $('toggleAuthPassword');
  if (!input || !button) return;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  button.textContent = show ? '◌' : '◉';
  button.title = show ? 'Ocultar senha' : 'Mostrar senha';
});
$('chooseAnotherUsername')?.addEventListener('click', () => {
  setAuthMode('register');
  if ($('authUsername')) $('authUsername').value = '';
  if ($('authPassword')) $('authPassword').value = '';
  if ($('authPasswordConfirm')) $('authPasswordConfirm').value = '';
  lastUsernameAvailability = null;
  setUsernameAvailability('Digite um nome novo para verificar se está disponível.', 'checking');
  setTimeout(() => $('authUsername')?.focus(), 50);
});
$('regenerateRecoveryCode')?.addEventListener('click', regenerateRecoveryCode);
$('copyRecoveryCode')?.addEventListener('click', copyRecoveryCodeValue);
$('closeRecoveryCode')?.addEventListener('click', closeRecoveryCodeModal);
$('authSubmit')?.addEventListener('click', submitAuth);
$('authPassword')?.addEventListener('keydown', (event) => { if (event.key === 'Enter' && state.authMode === 'login') submitAuth(); });
$('authPasswordConfirm')?.addEventListener('keydown', (event) => { if (event.key === 'Enter') submitAuth(); });
$('authRecoveryCode')?.addEventListener('keydown', (event) => { if (event.key === 'Enter') submitAuth(); });
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
  if (file.size > 10 * 1024 * 1024) return showToast('Use uma imagem ou GIF de até 10 MB.');

  const reader = new FileReader();
  reader.onload = () => {
    state.avatar = String(reader.result || '');
    state.avatarScale = 1.35;
    state.avatarOffsetX = 0;
    state.avatarOffsetY = 0;
    persistAvatarState();
    updateAvatarUI();
    renderEditProfileAvatar();
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
  renderEditProfileAvatar();
  saveAvatarToAccountSilently();
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
$('saveAvatarEditor').addEventListener('click', async () => {
  const button = $('saveAvatarEditor');
  state.avatarScale = Math.min(3, Math.max(0.5, Number($('avatarZoom').value || 1)));
  state.avatarOffsetX = clampAvatarAxis($('avatarPositionX').value);
  state.avatarOffsetY = clampAvatarAxis($('avatarPositionY').value);
  persistAvatarState();
  updateAvatarUI();
  renderEditProfileAvatar();

  const previousText = button.textContent;
  button.disabled = true;
  button.textContent = 'Salvando...';
  try {
    const result = await saveAvatarToAccountSilently({ throwOnError: true });
    closeAvatarEditor();
    if (result.localOnly) {
      showToast('Foto/GIF salva neste dispositivo. Entre na conta para salvar no perfil.');
    } else {
      showToast('Foto/GIF salva na sua conta.');
    }
  } catch (error) {
    showToast(error?.message || 'Não foi possível salvar a foto/GIF.');
  } finally {
    button.disabled = false;
    button.textContent = previousText || 'Salvar foto/GIF';
  }
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

function participantById(id) {
  return state.participants.find((person) => person.id === id) || null;
}

function renderCameraDock() {
  const dock = $('cameraDock');
  const grid = $('cameraGrid');
  if (!dock || !grid) return;

  const cameraPeople = state.participants.filter((person) => person.inVoice && (person.cameraOn || (person.id === state.me && state.cameraOn)));
  dock.classList.toggle('hidden', cameraPeople.length === 0);
  dock.classList.toggle('minimized', state.cameraDockMinimized);
  if ($('cameraCountLabel')) $('cameraCountLabel').textContent = `${cameraPeople.length} câmera${cameraPeople.length === 1 ? '' : 's'}`;
  if ($('toggleCameraDock')) $('toggleCameraDock').textContent = state.cameraDockMinimized ? '+' : '−';

  const activeIds = new Set(cameraPeople.map((person) => person.id));
  grid.querySelectorAll('.camera-card').forEach((card) => {
    if (!activeIds.has(card.dataset.peerId)) {
      const video = card.querySelector('video');
      if (video) video.srcObject = null;
      card.remove();
    }
  });

  cameraPeople.forEach((person) => {
    let card = grid.querySelector(`.camera-card[data-peer-id="${CSS.escape(person.id)}"]`);
    if (!card) {
      card = document.createElement('div');
      card.className = 'camera-card';
      card.dataset.peerId = person.id;

      const video = document.createElement('video');
      video.autoplay = true;
      video.playsInline = true;
      video.muted = true;

      const placeholder = document.createElement('div');
      placeholder.className = 'camera-card-placeholder';
      const avatar = document.createElement('div');
      avatar.className = 'participant-avatar';
      const placeholderText = document.createElement('span');
      placeholder.append(avatar, placeholderText);

      const footer = document.createElement('div');
      footer.className = 'camera-card-footer';
      const name = document.createElement('strong');
      const status = document.createElement('span');
      footer.append(name, status);

      card.append(video, placeholder, footer);
      grid.appendChild(card);
    }

    const video = card.querySelector('video');
    const placeholder = card.querySelector('.camera-card-placeholder');
    const avatar = placeholder.querySelector('.participant-avatar');
    const placeholderText = placeholder.querySelector('span');
    const name = card.querySelector('.camera-card-footer strong');
    const status = card.querySelector('.camera-card-footer span');

    const isLocal = person.id === state.me;
    const hiddenForMe = !isLocal && state.cameraHiddenPeers.has(person.id);
    const stream = isLocal ? state.voiceStream : state.voiceRemoteStreams.get(person.id);
    const hasLiveVideo = Boolean(stream?.getVideoTracks?.().some((track) => track.readyState === 'live'));

    card.classList.toggle('local', isLocal);
    card.classList.toggle('speaking', Boolean(person.speaking && !person.micMuted));
    card.classList.toggle('camera-hidden', hiddenForMe || !hasLiveVideo);
    name.textContent = isLocal ? `${person.nickname} (você)` : person.nickname;
    status.textContent = person.micMuted ? '🔇 Mic OFF' : (person.speaking ? '🟢 Falando' : '🎙 Na call');

    avatar.innerHTML = '';
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

    if (hiddenForMe) placeholderText.textContent = 'Câmera oculta para você';
    else if (!hasLiveVideo) placeholderText.textContent = 'Conectando câmera...';
    else placeholderText.textContent = '';

    if (!hiddenForMe && hasLiveVideo) {
      if (video.srcObject !== stream) video.srcObject = stream;
      video.classList.remove('hidden');
      placeholder.classList.add('hidden');
      video.play().catch(() => {});
    } else {
      video.srcObject = null;
      video.classList.add('hidden');
      placeholder.classList.remove('hidden');
    }
  });
}

$('toggleCameraDock')?.addEventListener('click', () => {
  state.cameraDockMinimized = !state.cameraDockMinimized;
  renderCameraDock();
});

function closeParticipantMenu() {
  const menu = $('participantMenu');
  if (!menu) return;
  menu.classList.add('hidden');
  state.participantMenuTarget = null;
}

function renderParticipantMenu() {
  const menu = $('participantMenu');
  const person = participantById(state.participantMenuTarget);
  if (!menu || !person) return closeParticipantMenu();

  $('participantMenuName').textContent = person.nickname;
  $('participantMenuStatus').textContent = person.inVoice
    ? (person.serverMuted ? 'Na call • Mic bloqueado pelo dono' : (person.micMuted ? 'Na call • Mic OFF' : (person.speaking ? 'Falando agora' : 'Na call • Em silêncio')))
    : (person.isSharer ? 'Compartilhando tela' : 'Conectado');

  const avatar = $('participantMenuAvatar');
  avatar.innerHTML = '';
  if (person.avatar) {
    const img = document.createElement('img');
    img.src = person.avatar;
    img.alt = '';
    img.style.setProperty('--avatar-scale', String(person.avatarScale || 1));
    img.style.setProperty('--avatar-x', String(person.avatarOffsetX || 0));
    img.style.setProperty('--avatar-y', String(person.avatarOffsetY || 0));
    avatar.appendChild(img);
  } else avatar.textContent = initials(person.nickname);

  const self = person.id === state.me;
  const volumeWrap = $('participantVolumeWrap');
  const volume = Math.round(voicePeerVolume(person.id) * 100);
  volumeWrap.classList.toggle('hidden', self || !person.inVoice);
  $('participantVolume').value = String(volume);
  $('participantVolumeValue').textContent = `${volume}%`;

  const mute = $('participantMuteForMe');
  mute.classList.toggle('hidden', self || !person.inVoice);
  mute.textContent = state.voicePeerMuted.has(person.id) ? '🔊 Voltar a ouvir' : '🔇 Silenciar para mim';

  const hideCamera = $('participantHideCameraForMe');
  hideCamera.classList.toggle('hidden', self || !person.cameraOn);
  hideCamera.textContent = state.cameraHiddenPeers.has(person.id) ? '📹 Mostrar câmera para mim' : '📹 Ocultar câmera para mim';

  const me = participantById(state.me);
  const hostActions = $('participantHostActions');
  const canModerate = Boolean(me?.isHost && !self);
  hostActions.classList.toggle('hidden', !canModerate);
  $('participantHostMute').disabled = !person.inVoice;
  $('participantHostMute').textContent = person.serverMuted ? '🔓 Liberar microfone na sala' : '🔇 Silenciar na sala';
}

function openParticipantMenu(person, anchor) {
  const menu = $('participantMenu');
  if (!menu || !person) return;
  state.participantMenuTarget = person.id;
  renderParticipantMenu();
  menu.classList.remove('hidden');
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(320, window.innerWidth - 24);
  let left = rect.right - width;
  left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
  let top = rect.bottom + 6;
  const estimatedHeight = 330;
  if (top + estimatedHeight > window.innerHeight - 12) top = Math.max(12, rect.top - estimatedHeight - 6);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

$('closeParticipantMenu')?.addEventListener('click', closeParticipantMenu);
$('participantViewProfile')?.addEventListener('click', () => {
  const person = participantById(state.participantMenuTarget);
  if (person) openUserProfile(person.nickname);
  closeParticipantMenu();
});
$('participantVolume')?.addEventListener('input', () => {
  const peerId = state.participantMenuTarget;
  if (!peerId) return;
  const value = Math.min(1, Math.max(0, Number($('participantVolume').value || 0) / 100));
  state.voicePeerVolumes.set(peerId, value);
  $('participantVolumeValue').textContent = `${Math.round(value * 100)}%`;
  syncVoicePeerAudio(peerId);
});
$('participantMuteForMe')?.addEventListener('click', () => {
  const peerId = state.participantMenuTarget;
  if (!peerId) return;
  if (state.voicePeerMuted.has(peerId)) state.voicePeerMuted.delete(peerId);
  else state.voicePeerMuted.add(peerId);
  syncVoicePeerAudio(peerId);
  renderParticipantMenu();
});
$('participantHideCameraForMe')?.addEventListener('click', () => {
  const peerId = state.participantMenuTarget;
  if (!peerId) return;
  if (state.cameraHiddenPeers.has(peerId)) state.cameraHiddenPeers.delete(peerId);
  else state.cameraHiddenPeers.add(peerId);
  renderCameraDock();
  renderParticipantMenu();
});
$('participantHostMute')?.addEventListener('click', async () => {
  const target = state.participantMenuTarget;
  if (!target) return;
  const result = await new Promise((resolve) => socket.emit('host-mute-participant', { target }, resolve));
  if (!result?.ok) return showToast(result?.error || 'Não foi possível silenciar essa pessoa.');
  showToast('Participante silenciado na call.');
  closeParticipantMenu();
});
$('participantHostKick')?.addEventListener('click', async () => {
  const person = participantById(state.participantMenuTarget);
  if (!person) return;
  if (!confirm(`Remover ${person.nickname} da sala?`)) return;
  const result = await new Promise((resolve) => socket.emit('host-kick-participant', { target: person.id }, resolve));
  if (!result?.ok) return showToast(result?.error || 'Não foi possível remover essa pessoa.');
  showToast(`${person.nickname} foi removido da sala.`);
  closeParticipantMenu();
});
document.addEventListener('pointerdown', (event) => {
  const menu = $('participantMenu');
  if (!menu || menu.classList.contains('hidden')) return;
  if (menu.contains(event.target) || event.target.closest?.('.participant-more')) return;
  closeParticipantMenu();
});

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
      const cameraText = person.cameraOn ? ' • Câmera ON' : '';
      if (person.serverMuted) sub.textContent = `Na call${cameraText} • Mic bloqueado`;
      else if (person.micMuted) sub.textContent = `Na call${cameraText} • Mic OFF`;
      else if (person.speaking) sub.textContent = `Falando agora${cameraText}`;
      else sub.textContent = `Na call${cameraText} • Em silêncio`;
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
      if (person.cameraOn) badges.innerHTML += '<span class="voice-badge camera-badge" title="Câmera ligada">📹</span>';
      if (person.serverMuted) badges.innerHTML += '<span class="voice-badge muted" title="Microfone bloqueado pelo dono">🔒</span>';
      else if (person.micMuted) badges.innerHTML += '<span class="voice-badge muted" title="Na call com microfone desligado">🔇</span>';
      else if (person.speaking) badges.innerHTML += '<span class="voice-badge speaking" title="Falando agora">🔊</span>';
      else badges.innerHTML += '<span class="voice-badge" title="Na call de voz">🎙</span>';
    }
    if (person.id === state.me) badges.innerHTML += '<em>VOCÊ</em>';

    const more = document.createElement('button');
    more.className = 'participant-more';
    more.type = 'button';
    more.textContent = '⋯';
    more.title = `Opções de ${person.nickname}`;
    more.addEventListener('click', (event) => {
      event.stopPropagation();
      openParticipantMenu(person, more);
    });

    row.append(avatar, details, badges, more);
    row.classList.add('profile-clickable');
    row.title = `Abrir perfil de ${person.nickname}`;
    row.addEventListener('click', () => openUserProfile(person.nickname));
    $('participantsList').appendChild(row);
  });
  renderCameraDock();
  if (state.participantMenuTarget) renderParticipantMenu();
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
  state.voiceRemoteStreams.delete(peerId);
  renderCameraDock();
}

function voicePeerVolume(peerId) {
  return Math.min(1, Math.max(0, Number(state.voicePeerVolumes.get(peerId) ?? 1)));
}

function syncVoicePeerAudio(peerId) {
  const audio = state.voiceAudios.get(peerId);
  if (!audio) return;
  const individualMuted = state.voicePeerMuted.has(peerId);
  const volume = state.voiceVolume * voicePeerVolume(peerId);
  audio.muted = state.voiceOutputMuted || individualMuted || volume <= 0;
  audio.volume = audio.muted ? 0 : Math.min(1, Math.max(0, volume));
  if (!audio.muted) audio.play().catch(() => {});
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
  state.voiceRemoteStreams.set(peerId, stream);
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
  syncVoicePeerAudio(peerId);
  renderCameraDock();
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
  state.voiceStream.getTracks().forEach((track) => pc.addTrack(track, state.voiceStream));

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
  const camera = $('cameraControl');
  if (!call || !mic) return;
  call.textContent = state.voiceJoined ? '📞 Sair da call' : '📞 Entrar na call';
  call.classList.toggle('voice-active', state.voiceJoined);
  mic.disabled = !state.voiceJoined || state.voiceServerMuted;
  mic.textContent = state.voiceServerMuted ? '🔒 Mic bloqueado' : (state.voiceMuted ? '🔇 Mic OFF' : '🎙 Mic ON');
  mic.classList.toggle('mic-muted', state.voiceMuted || state.voiceServerMuted);
  if (camera) {
    camera.disabled = !state.voiceJoined;
    camera.textContent = state.cameraOn ? '📹 Câmera ON' : '📹 Câmera OFF';
    camera.classList.toggle('camera-on', state.cameraOn);
  }
}

async function renegotiateVoicePeer(peerId, retry = 0) {
  const pc = state.voicePeers.get(peerId);
  if (!pc) return;
  if (pc.signalingState !== 'stable') {
    if (retry < 5) setTimeout(() => renegotiateVoicePeer(peerId, retry + 1), 300);
    return;
  }
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('voice-signal', { target: peerId, data: { type: 'offer', sdp: pc.localDescription } });
  } catch {}
}

async function startCamera() {
  if (!state.voiceJoined || !state.voiceStream || state.cameraOn) return;
  if (!navigator.mediaDevices?.getUserMedia) return showToast('Seu navegador não permite usar a câmera.');
  try {
    const cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
      audio: false
    });
    const track = cameraStream.getVideoTracks()[0];
    if (!track) return;
    state.cameraTrack = track;
    state.cameraOn = true;
    state.voiceStream.addTrack(track);
    track.addEventListener('ended', () => stopCamera(true), { once: true });

    for (const [peerId, pc] of state.voicePeers.entries()) {
      pc.addTrack(track, state.voiceStream);
      renegotiateVoicePeer(peerId);
    }
    socket.emit('voice-camera-state', { on: true }, () => {});
    updateVoiceControls();
    renderCameraDock();
    showToast('Câmera ligada.');
  } catch (error) {
    if (error?.name === 'NotAllowedError') showToast('Permita o acesso à câmera.');
    else showToast('Não foi possível abrir a câmera.');
  }
}

function stopCamera(notifyServer = true) {
  if (!state.cameraOn && !state.cameraTrack) return;
  const track = state.cameraTrack;
  for (const [peerId, pc] of state.voicePeers.entries()) {
    const sender = pc.getSenders().find((item) => item.track === track || item.track?.kind === 'video');
    if (sender) {
      try { pc.removeTrack(sender); } catch {}
      renegotiateVoicePeer(peerId);
    }
  }
  try { state.voiceStream?.removeTrack(track); } catch {}
  try { track?.stop(); } catch {}
  state.cameraTrack = null;
  state.cameraOn = false;
  if (notifyServer) socket.emit('voice-camera-state', { on: false }, () => {});
  updateVoiceControls();
  renderCameraDock();
}

$('cameraControl')?.addEventListener('click', () => {
  if (!state.voiceJoined) return;
  if (state.cameraOn) stopCamera(true);
  else startCamera();
});

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
    state.voiceServerMuted = false;
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
  stopCamera(false);
  closeAllVoicePeers();
  stopVoiceSpeakingDetector(true);
  state.voiceStream?.getTracks().forEach((track) => track.stop());
  state.voiceStream = null;
  state.voiceJoined = false;
  state.voiceMuted = false;
  state.voiceServerMuted = false;
  updateVoiceControls();
}

async function toggleVoiceMic() {
  if (!state.voiceJoined || !state.voiceStream) return;
  if (state.voiceServerMuted) return showToast('Seu microfone está bloqueado pelo dono da sala.');
  const nextMuted = !state.voiceMuted;
  const result = await new Promise((resolve) => socket.emit('voice-mic-state', { muted: nextMuted }, resolve));
  if (!result?.ok) {
    if (result?.serverMuted) state.voiceServerMuted = true;
    state.voiceMuted = true;
    state.voiceStream.getAudioTracks().forEach((track) => { track.enabled = false; });
    setLocalSpeakingState(false);
    updateVoiceControls();
    return showToast(result?.error || 'Não foi possível alterar o microfone.');
  }
  state.voiceMuted = nextMuted;
  state.voiceStream.getAudioTracks().forEach((track) => { track.enabled = !state.voiceMuted; });
  if (state.voiceMuted) setLocalSpeakingState(false);
  updateVoiceControls();
}

$('voiceCallControl').addEventListener('click', () => {
  if (state.voiceJoined) leaveVoiceCall(true);
  else joinVoiceCall();
});
$('micControl').addEventListener('click', toggleVoiceMic);

socket.on('voice-force-muted', () => {
  if (!state.voiceJoined || !state.voiceStream) return;
  state.voiceServerMuted = true;
  state.voiceMuted = true;
  state.voiceStream.getAudioTracks().forEach((track) => { track.enabled = false; });
  setLocalSpeakingState(false);
  updateVoiceControls();
  showToast('O dono da sala bloqueou seu microfone.');
});

socket.on('voice-server-mute-released', () => {
  state.voiceServerMuted = false;
  state.voiceMuted = true;
  updateVoiceControls();
  showToast('O dono liberou seu microfone. Clique em Mic OFF para ligá-lo quando quiser.');
});

socket.on('kicked-from-room', async ({ reason } = {}) => {
  stopSharing(false);
  await leaveVoiceCall(false);
  closeAllInboundPeers();
  state.room = null;
  state.me = null;
  state.participants = [];
  state.chatMessages = [];
  state.sharerIds.clear();
  state.inboundStreams.clear();
  state.cameraHiddenPeers.clear();
  state.voicePeerMuted.clear();
  state.voicePeerVolumes.clear();
  closeParticipantMenu();
  $('cameraGrid').innerHTML = '';
  $('cameraDock').classList.add('hidden');
  history.replaceState({}, '', '/');
  setView('landing');
  loadPublicRooms();
  showToast(reason || 'Você foi removido da sala.');
});

socket.on('voice-user-left', ({ userId }) => {
  closeVoicePeer(userId);
  state.voicePeerMuted.delete(userId);
  state.voicePeerVolumes.delete(userId);
  state.cameraHiddenPeers.delete(userId);
  renderCameraDock();
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
  for (const peerId of state.voiceAudios.keys()) syncVoicePeerAudio(peerId);
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
  savePreferencesToAccountSoon();
}

function setVoiceVolume(value) {
  state.voiceVolume = Math.min(1, Math.max(0, Number(value) || 0));
  localStorage.setItem('lnz_voice_volume', String(state.voiceVolume));
  if (state.voiceVolume > 0) state.voiceOutputMuted = false;
  localStorage.setItem('lnz_voice_output_muted', state.voiceOutputMuted ? '1' : '0');
  syncVoiceOutputVolume();
  updateMixerUI();
  savePreferencesToAccountSoon();
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
    savePreferencesToAccountSoon();
    return;
  }
  if (state.isSharing) return;
  state.shareAudio = !state.shareAudio;
  updateAudioControl();
  savePreferencesToAccountSoon();
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
  savePreferencesToAccountSoon();
});
$('mixerToggleVoice')?.addEventListener('click', () => {
  state.voiceOutputMuted = !state.voiceOutputMuted;
  localStorage.setItem('lnz_voice_output_muted', state.voiceOutputMuted ? '1' : '0');
  syncVoiceOutputVolume();
  updateMixerUI();
  savePreferencesToAccountSoon();
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
  state.voicePeerMuted.clear();
  state.voicePeerVolumes.clear();
  state.cameraHiddenPeers.clear();
  closeParticipantMenu();
  $('cameraGrid').innerHTML = '';
  $('cameraDock').classList.add('hidden');
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
  const currentVoiceMe = state.participants.find((person) => person.id === state.me);
  if (currentVoiceMe) {
    state.voiceServerMuted = Boolean(currentVoiceMe.serverMuted);
    if (state.voiceServerMuted) {
      state.voiceMuted = true;
      state.voiceStream?.getAudioTracks().forEach((track) => { track.enabled = false; });
    }
  }
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


function adminDate(value) {
  if (!value) return '—';
  try { return new Date(Number(value)).toLocaleString('pt-BR'); } catch { return '—'; }
}

function adminActionLabel(action) {
  const labels = {
    'auth.register': 'Conta criada',
    'auth.login': 'Login realizado',
    'auth.logout': 'Logout',
    'auth.recover': 'Senha recuperada',
    'room.create': 'Sala criada',
    'room.join': 'Entrou na sala',
    'room.leave': 'Saiu da sala',
    'room.open': 'Sala aberta',
    'room.close': 'Sala fechada',
    'stream.start': 'Iniciou transmissão',
    'stream.stop': 'Parou transmissão',
    'voice.join': 'Entrou na call',
    'voice.leave': 'Saiu da call',
    'chat.message': 'Enviou mensagem no chat',
    'feedback.submit': 'Enviou feedback',
    'system.start': 'Site iniciado / atualizado'
  };
  return labels[action] || action || 'Atividade';
}

function setAdminTab(tab) {
  state.adminTab = ['users','rooms','feedbacks'].includes(tab) ? tab : 'logs';
  document.querySelectorAll('.admin-tab').forEach((button) => button.classList.toggle('active', button.dataset.adminTab === state.adminTab));
  ['Logs','Users','Rooms','Feedbacks'].forEach((name) => {
    const id = `adminTab${name}`;
    $(id)?.classList.toggle('hidden', name.toLowerCase() !== state.adminTab);
  });
}

function renderAdminDashboard(data) {
  const stats = data?.stats || {};
  if ($('adminStatUsers')) $('adminStatUsers').textContent = String(stats.users || 0);
  if ($('adminStatOnline')) $('adminStatOnline').textContent = String(stats.onlineUsers || 0);
  if ($('adminStatRooms')) $('adminStatRooms').textContent = String(stats.activeRooms || 0);
  if ($('adminStatStreams')) $('adminStatStreams').textContent = String(stats.activeStreams || 0);
  if ($('adminStatSessions')) $('adminStatSessions').textContent = String(stats.activeSessions || 0);
  if ($('adminStatFeedbacks')) $('adminStatFeedbacks').textContent = String(stats.feedbacks || 0);
  if ($('adminDatabaseBadge')) $('adminDatabaseBadge').textContent = data?.database === 'postgres' ? 'Banco: PostgreSQL conectado' : 'Banco: memória temporária';

  const logs = Array.isArray(data?.logs) ? data.logs : [];
  $('adminLogsList').innerHTML = logs.length ? logs.map((item) => {
    const details = item.details && Object.keys(item.details).length ? escapeHtml(JSON.stringify(item.details)) : 'Sem detalhes adicionais';
    return `<div class="admin-row admin-log-row"><div><strong>${escapeHtml(adminActionLabel(item.action))}</strong><span>${escapeHtml(item.username || 'Sistema')}${item.roomCode ? ` • Sala ${escapeHtml(item.roomCode)}` : ''}</span></div><div class="admin-row-right"><small>${escapeHtml(adminDate(item.createdAt))}</small><em>${details}</em></div></div>`;
  }).join('') : '<div class="admin-empty">Nenhum registro ainda.</div>';

  const users = Array.isArray(data?.users) ? data.users : [];
  $('adminUsersList').innerHTML = users.length ? users.map((user) => `
    <div class="admin-row"><div><strong>${escapeHtml(user.username || 'Usuário')}</strong><span>${user.online ? '● Online' : '○ Offline'}</span></div><div class="admin-row-right"><small>Criado: ${escapeHtml(adminDate(user.createdAt))}</small><em>Último login: ${escapeHtml(adminDate(user.lastLoginAt))}</em></div></div>
  `).join('') : '<div class="admin-empty">Nenhuma conta cadastrada.</div>';

  const rooms = Array.isArray(data?.rooms) ? data.rooms : [];
  $('adminRoomsList').innerHTML = rooms.length ? rooms.map((room) => `
    <div class="admin-row"><div><strong>${escapeHtml(room.code)}</strong><span>${room.visibility === 'private' ? '🔒 Privada' : '◎ Pública'} • ${room.isOpen ? 'Aberta' : 'Fechada'}</span></div><div class="admin-row-right"><small>${Number(room.participants || 0)} participante(s)</small><em>${Number(room.sharers || 0)} transmissão(ões) • ${escapeHtml(adminDate(room.createdAt))}</em></div></div>
  `).join('') : '<div class="admin-empty">Nenhuma sala ativa.</div>';

  const feedbacks = Array.isArray(data?.feedbacks) ? data.feedbacks : [];
  $('adminFeedbacksList').innerHTML = feedbacks.length ? feedbacks.map((item) => `
    <div class="admin-row admin-feedback-row"><div><strong>${escapeHtml(item.nickname || 'Usuário LNZ')} • ${Number(item.rating || 0)}/5</strong><span>${escapeHtml(item.type || 'feedback')}${item.roomCode ? ` • Sala ${escapeHtml(item.roomCode)}` : ''}</span><p>${escapeHtml(item.message || '')}</p></div><div class="admin-row-right"><small>${escapeHtml(adminDate(item.createdAt))}</small><em>${item.contact ? `Contato: ${escapeHtml(item.contact)}` : 'Sem contato'}</em></div></div>
  `).join('') : '<div class="admin-empty">Nenhum feedback recebido.</div>';
}

async function loadAdminDashboard() {
  if (!state.account?.isAdmin) return;
  const refresh = $('refreshAdminPanel');
  if (refresh) { refresh.disabled = true; refresh.textContent = 'Atualizando...'; }
  try {
    const response = await fetch('/api/admin/dashboard', { credentials: 'same-origin', cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) throw new Error(data?.error || 'Acesso negado.');
    renderAdminDashboard(data);
  } catch (error) {
    showToast(error?.message || 'Não foi possível carregar o painel admin.');
  } finally {
    if (refresh) { refresh.disabled = false; refresh.textContent = '↻ Atualizar'; }
  }
}

async function openAdminPanel() {
  if (!state.account?.isAdmin) return showToast('Esse painel é restrito ao administrador.');
  $('adminPanelModal')?.classList.remove('hidden');
  $('adminPanelModal')?.setAttribute('aria-hidden', 'false');
  setAdminTab(state.adminTab);
  await loadAdminDashboard();
}

function closeAdminPanel() {
  $('adminPanelModal')?.classList.add('hidden');
  $('adminPanelModal')?.setAttribute('aria-hidden', 'true');
}

$('adminPanelButton')?.addEventListener('click', openAdminPanel);
$('railAdmin')?.addEventListener('click', openAdminPanel);
$('closeAdminPanel')?.addEventListener('click', closeAdminPanel);
$('refreshAdminPanel')?.addEventListener('click', loadAdminDashboard);
$('adminPanelModal')?.addEventListener('click', (event) => { if (event.target.dataset.closeAdmin) closeAdminPanel(); });
document.querySelectorAll('.admin-tab').forEach((button) => button.addEventListener('click', () => setAdminTab(button.dataset.adminTab)));

async function initApp() {
  $('year').textContent = new Date().getFullYear();
  if ($('authRemember')) $('authRemember').checked = localStorage.getItem('lnz_remember_login') === '1';
  updateAudioControl();
  updateMixerUI();
  applyDiscordLinks();
  applyIdentityToUI();
  updateVoiceControls();
  await checkAppVersion();
  await loadAccount();
  await loadPublicRooms();
  if (state.account) {
    await loadFriends(false);
    await routeFromLocation();
  }
}

initApp();

// Atalhos laterais inspirados na organização de apps sociais/Discord.
function setDiscordChannelActive(target) {
  ['railStream', 'railChat', 'railCall', 'channelStream', 'channelChat', 'channelCall'].forEach((id) => {
    const el = $(id);
    if (!el) return;
    const isTarget = id.toLowerCase().includes(target);
    el.classList.toggle('active', isTarget);
  });
}

$('railHome')?.addEventListener('click', () => leaveRoom());
$('railFriends')?.addEventListener('click', openFriendsModal);
$('railProfile')?.addEventListener('click', () => openUserProfile(state.account?.username));
$('railTheme')?.addEventListener('click', openThemeModal);

$('railStream')?.addEventListener('click', () => {
  closeChat();
  setDiscordChannelActive('stream');
});
$('channelStream')?.addEventListener('click', () => {
  closeChat();
  setDiscordChannelActive('stream');
});

$('railChat')?.addEventListener('click', () => {
  openChat();
  setDiscordChannelActive('chat');
});
$('channelChat')?.addEventListener('click', () => {
  openChat();
  setDiscordChannelActive('chat');
});

$('railCall')?.addEventListener('click', () => {
  if (!state.voiceJoined) joinVoiceCall();
  setDiscordChannelActive('call');
});
$('channelCall')?.addEventListener('click', () => {
  if (!state.voiceJoined) joinVoiceCall();
  setDiscordChannelActive('call');
});


// Tema visual sazonal
applySeasonTheme(state.seasonTheme || 'default');
