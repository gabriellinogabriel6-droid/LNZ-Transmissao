const { io } = require('socket.io-client');

const $ = (id) => document.getElementById(id);
let socket = null;
let room = null;
let me = null;
let selectedSource = null;
let localStream = null;
let isSharing = false;
let iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
const peers = new Map();
const pendingIce = new Map();
let pcm = null;
let unsubscribeAudio = null;

const savedServer = localStorage.getItem('lnz_desktop_server') || '';
const savedNick = localStorage.getItem('lnz_desktop_nick') || '';
$('serverUrl').value = savedServer;
$('nickname').value = savedNick;

function normalizeServer(value) {
  let url = String(value || '').trim().replace(/\/+$/, '');
  if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url;
}

function normalizeCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8).replace(/^(.{4})(.+)$/, '$1-$2');
}

function setMessage(text, bad = false) {
  $('message').textContent = text;
  $('message').style.color = bad ? '#ffaaaa' : '#aaa2b4';
}

function setRoomStatus(text, ok = false) {
  $('roomStatus').textContent = text;
  $('roomStatus').style.color = ok ? '#9be1b9' : '#aaa2b4';
}

async function loadIce(server) {
  try {
    const text = await fetch(`${server}/config.js`, { cache: 'no-store' }).then((r) => r.text());
    const match = text.match(/window\.LNZ_CONFIG\s*=\s*(\{[\s\S]*\})\s*;?/);
    if (match) {
      const config = JSON.parse(match[1]);
      if (Array.isArray(config.iceServers) && config.iceServers.length) iceServers = config.iceServers;
    }
  } catch {}
}

async function connectServer() {
  const server = normalizeServer($('serverUrl').value);
  if (!server) throw new Error('Digite o endereço do seu site no Render.');
  localStorage.setItem('lnz_desktop_server', server);
  await loadIce(server);

  if (socket) socket.disconnect();
  socket = io(server, { transports: ['websocket', 'polling'], timeout: 12000, reconnection: true });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('O servidor demorou para responder.')), 13000);
    socket.once('connect', () => { clearTimeout(timer); resolve(); });
    socket.once('connect_error', (err) => { clearTimeout(timer); reject(err); });
  });

  socket.on('viewer-joined', ({ viewerId }) => {
    if (isSharing) createOutboundPeer(viewerId).catch(() => {});
  });
  socket.on('viewer-left', ({ viewerId }) => {
    peers.get(viewerId)?.close();
    peers.delete(viewerId);
    pendingIce.delete(viewerId);
  });
  socket.on('sharing-stopped', () => {
    if (!isSharing) setMessage('A transmissão da sala foi encerrada.');
  });
  socket.on('signal', handleSignal);
}

async function joinRoom() {
  try {
    const nick = $('nickname').value.trim();
    if (!nick) return setRoomStatus('Digite seu nickname.');
    localStorage.setItem('lnz_desktop_nick', nick);
    await connectServer();
    const code = normalizeCode($('roomCode').value);
    if (!code) return setRoomStatus('Digite o código da sala.');
    const result = await new Promise((resolve) => socket.emit('join-room', {
      roomCode: code,
      nickname: nick,
      avatar: '',
      avatarScale: 1,
      avatarOffsetX: 0,
      avatarOffsetY: 0,
      password: $('roomPassword').value
    }, resolve));
    if (!result?.ok) throw new Error(result?.error || 'Não foi possível entrar.');
    room = result.room;
    me = result.me;
    $('roomCode').value = room.code;
    setRoomStatus(`Conectado à sala ${room.code}.`, true);
    updateButtons();
  } catch (error) {
    setRoomStatus(error?.message || 'Falha ao conectar.');
  }
}

async function createRoom() {
  try {
    const nick = $('nickname').value.trim();
    if (!nick) return setRoomStatus('Digite seu nickname.');
    localStorage.setItem('lnz_desktop_nick', nick);
    await connectServer();
    const result = await new Promise((resolve) => socket.emit('create-room', {
      nickname: nick,
      avatar: '', avatarScale: 1, avatarOffsetX: 0, avatarOffsetY: 0,
      visibility: 'public', password: ''
    }, resolve));
    if (!result?.ok) throw new Error(result?.error || 'Não foi possível criar a sala.');
    room = result.room;
    me = result.me;
    $('roomCode').value = room.code;
    setRoomStatus(`Sala ${room.code} criada. Envie esse código para quem vai assistir.`, true);
    updateButtons();
  } catch (error) {
    setRoomStatus(error?.message || 'Falha ao criar a sala.');
  }
}

async function refreshSources() {
  try {
    const list = await window.lnzDesktop.listSources();
    const box = $('sources');
    box.innerHTML = '';
    list.forEach((source) => {
      const btn = document.createElement('button');
      btn.className = 'source';
      btn.innerHTML = `<img alt=""><span></span>`;
      btn.querySelector('img').src = source.thumbnail;
      btn.querySelector('span').textContent = `${source.isWindow ? '▣' : '▤'} ${source.name}`;
      btn.onclick = async () => {
        selectedSource = source;
        document.querySelectorAll('.source').forEach((item) => item.classList.remove('selected'));
        btn.classList.add('selected');
        await window.lnzDesktop.selectSource(source.id);
        setMessage(source.isWindow
          ? `Selecionado: ${source.name}. Áudio pode ser isolado deste aplicativo.`
          : `Selecionado: ${source.name}. Tela inteira será sem áudio isolado para não vazar o Discord.`);
        updateButtons();
      };
      box.appendChild(btn);
    });
  } catch (error) {
    setMessage(`Erro ao listar janelas: ${error?.message || error}`, true);
  }
}

class PcmToMediaTrack {
  constructor(meta) {
    this.meta = { sampleRate: Number(meta?.sampleRate) || 48000, channels: Math.min(2, Math.max(1, Number(meta?.channels) || 2)), bitsPerSample: Number(meta?.bitsPerSample) || 32, isFloat: meta?.isFloat !== false };
    this.context = new AudioContext({ sampleRate: this.meta.sampleRate });
    this.dest = this.context.createMediaStreamDestination();
    this.processor = this.context.createScriptProcessor(2048, 0, this.meta.channels);
    this.frames = [];
    this.frameOffset = 0;
    this.processor.onaudioprocess = (event) => this.render(event);
    this.processor.connect(this.dest);
    this.context.resume().catch(() => {});
  }

  push(base64, meta) {
    if (!base64) return;
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    const channels = this.meta.channels;
    const samples = [];
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (this.meta.isFloat && this.meta.bitsPerSample === 32) {
      for (let i = 0; i + 3 < bytes.byteLength; i += 4) samples.push(view.getFloat32(i, true));
    } else if (this.meta.bitsPerSample === 16) {
      for (let i = 0; i + 1 < bytes.byteLength; i += 2) samples.push(view.getInt16(i, true) / 32768);
    } else {
      return;
    }
    this.frames.push({ samples: Float32Array.from(samples), channels });
  }

  render(event) {
    const outputs = [];
    for (let c = 0; c < this.meta.channels; c += 1) {
      const out = event.outputBuffer.getChannelData(c);
      out.fill(0);
      outputs.push(out);
    }
    let targetFrame = 0;
    const totalFrames = outputs[0].length;
    while (targetFrame < totalFrames && this.frames.length) {
      const head = this.frames[0];
      const available = Math.floor(head.samples.length / head.channels) - this.frameOffset;
      const take = Math.min(available, totalFrames - targetFrame);
      for (let i = 0; i < take; i += 1) {
        for (let c = 0; c < outputs.length; c += 1) {
          const srcChannel = Math.min(c, head.channels - 1);
          outputs[c][targetFrame + i] = head.samples[(this.frameOffset + i) * head.channels + srcChannel] || 0;
        }
      }
      targetFrame += take;
      this.frameOffset += take;
      if (this.frameOffset >= Math.floor(head.samples.length / head.channels)) {
        this.frames.shift();
        this.frameOffset = 0;
      }
    }
    if (this.frames.length > 80) this.frames.splice(0, this.frames.length - 40);
  }

  getTrack() { return this.dest.stream.getAudioTracks()[0] || null; }
  close() {
    try { this.processor.disconnect(); } catch {}
    try { this.context.close(); } catch {}
    this.frames.length = 0;
  }
}

function makePeer() {
  return new RTCPeerConnection({ iceServers });
}

async function createOutboundPeer(viewerId) {
  if (!localStream || !isSharing || viewerId === me) return;
  peers.get(viewerId)?.close();
  const pc = makePeer();
  peers.set(viewerId, pc);
  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
  pc.onicecandidate = (event) => {
    if (event.candidate) socket.emit('signal', { target: viewerId, data: { type: 'ice', candidate: event.candidate } });
  };
  pc.onconnectionstatechange = () => {
    if (['failed', 'closed'].includes(pc.connectionState)) {
      pc.close(); peers.delete(viewerId); pendingIce.delete(viewerId);
    }
  };
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit('signal', { target: viewerId, data: { type: 'offer', sdp: pc.localDescription } });
}

async function handleSignal({ from, data }) {
  try {
    if (data?.type === 'answer') {
      const pc = peers.get(from);
      if (!pc) return;
      await pc.setRemoteDescription(data.sdp);
      const queue = pendingIce.get(from) || [];
      for (const candidate of queue) await pc.addIceCandidate(candidate);
      pendingIce.delete(from);
    } else if (data?.type === 'ice' && data.candidate) {
      const pc = peers.get(from);
      if (!pc) return;
      if (pc.remoteDescription) await pc.addIceCandidate(data.candidate);
      else {
        if (!pendingIce.has(from)) pendingIce.set(from, []);
        pendingIce.get(from).push(data.candidate);
      }
    }
  } catch (error) {
    setMessage(`Falha WebRTC: ${error?.message || error}`, true);
  }
}

async function startShare() {
  if (!room || !socket?.connected) return setMessage('Entre em uma sala primeiro.', true);
  if (!selectedSource) return setMessage('Escolha uma janela ou tela.', true);
  if (isSharing) return;

  try {
    await window.lnzDesktop.selectSource(selectedSource.id);
    const videoStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
    const tracks = [...videoStream.getVideoTracks()];

    if ($('sendAppAudio').checked && selectedSource.isWindow) {
      unsubscribeAudio?.();
      unsubscribeAudio = window.lnzDesktop.onAudioChunk((payload) => pcm?.push(payload.data, payload.meta));
      const result = await window.lnzDesktop.startAudio(selectedSource.id);
      if (result?.ok) {
        pcm = new PcmToMediaTrack(result.meta);
        const audioTrack = pcm.getTrack();
        if (audioTrack) tracks.push(audioTrack);
        setMessage(`Áudio isolado do aplicativo ativo (PID ${result.pid}). Discord fica fora.`);
      } else {
        setMessage(result?.error || 'Áudio isolado indisponível. Transmitindo apenas vídeo.', false);
      }
    } else if ($('sendAppAudio').checked && !selectedSource.isWindow) {
      setMessage('Tela inteira: vídeo sem áudio para garantir que o Discord não seja capturado.');
    }

    localStream = new MediaStream(tracks);
    $('preview').srcObject = localStream;
    const result = await new Promise((resolve) => socket.emit('start-sharing', {}, resolve));
    if (!result?.ok) throw new Error(result?.error || 'Servidor recusou a transmissão.');

    isSharing = true;
    $('shareState').textContent = 'AO VIVO';
    $('shareState').classList.add('on');
    localStream.getVideoTracks()[0]?.addEventListener('ended', stopShare, { once: true });
    updateButtons();
    for (const viewerId of result.viewerIds || []) createOutboundPeer(viewerId).catch(() => {});
  } catch (error) {
    await cleanupMedia();
    setMessage(error?.message || 'Não foi possível iniciar a transmissão.', true);
  }
}

async function cleanupMedia() {
  peers.forEach((pc) => pc.close()); peers.clear(); pendingIce.clear();
  localStream?.getTracks().forEach((track) => track.stop());
  localStream = null;
  $('preview').srcObject = null;
  await window.lnzDesktop.stopAudio().catch(() => {});
  unsubscribeAudio?.(); unsubscribeAudio = null;
  pcm?.close(); pcm = null;
}

async function stopShare() {
  if (isSharing && socket?.connected) socket.emit('stop-sharing', {});
  isSharing = false;
  await cleanupMedia();
  $('shareState').textContent = 'OFF';
  $('shareState').classList.remove('on');
  setMessage('Transmissão encerrada.');
  updateButtons();
}

function updateButtons() {
  $('startShare').disabled = !room || !selectedSource || isSharing;
  $('stopShare').disabled = !isSharing;
}

$('joinRoom').onclick = joinRoom;
$('createRoom').onclick = createRoom;
$('refreshSources').onclick = refreshSources;
$('startShare').onclick = startShare;
$('stopShare').onclick = stopShare;
$('roomCode').addEventListener('input', (e) => { e.target.value = normalizeCode(e.target.value); });

(async function boot() {
  const status = await window.lnzDesktop.nativeStatus();
  $('nativeBadge').textContent = status.available ? 'Áudio por aplicativo: OK' : 'Áudio por aplicativo: indisponível';
  $('nativeBadge').classList.add(status.available ? 'ok' : 'bad');
  if (!status.available) setMessage(`Módulo de áudio: ${status.error || 'indisponível'}`, true);
  await refreshSources();
  updateButtons();
})();

window.addEventListener('beforeunload', () => {
  if (isSharing && socket?.connected) socket.emit('stop-sharing', {});
  window.lnzDesktop.stopAudio().catch(() => {});
});
