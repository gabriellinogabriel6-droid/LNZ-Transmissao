const path = require('path');
const { app, BrowserWindow, ipcMain, desktopCapturer, session } = require('electron');

let mainWindow = null;
let selectedSourceId = '';
let nativeCapture = null;
let audioRunning = false;

function safeNativeModule() {
  if (nativeCapture) return nativeCapture;
  try {
    nativeCapture = require('electron-native-screenshare');
  } catch (error) {
    nativeCapture = {
      isAvailable: () => false,
      getLoadError: () => String(error?.message || error),
      stopCapture: () => false
    };
  }
  return nativeCapture;
}

async function listSources() {
  const sources = await desktopCapturer.getSources({
    types: ['window', 'screen'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true
  });

  return sources
    .filter((source) => !/^LNZ Desktop$/i.test(source.name))
    .map((source) => ({
      id: source.id,
      name: source.name,
      displayId: source.display_id || '',
      thumbnail: source.thumbnail?.toDataURL() || '',
      isWindow: source.id.startsWith('window:')
    }));
}

async function stopNativeAudio() {
  const capture = safeNativeModule();
  if (audioRunning) {
    try { capture.stopCapture?.(); } catch {}
  }
  audioRunning = false;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 880,
    minHeight: 620,
    backgroundColor: '#09070e',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile('index.html');

  mainWindow.on('closed', () => {
    stopNativeAudio();
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(['media', 'display-capture'].includes(permission));
  });

  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      if (!selectedSourceId) return callback({});
      const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });
      const source = sources.find((item) => item.id === selectedSourceId);
      if (!source) return callback({});
      // O áudio não vem do Chromium. Ele será capturado separadamente
      // pelo WASAPI por processo, para não misturar Discord.
      callback({ video: source });
    } catch {
      callback({});
    }
  });

  ipcMain.handle('sources:list', () => listSources());
  ipcMain.handle('sources:select', (_event, sourceId) => {
    selectedSourceId = String(sourceId || '');
    return { ok: Boolean(selectedSourceId) };
  });

  ipcMain.handle('native:status', () => {
    const capture = safeNativeModule();
    return {
      available: Boolean(capture.isAvailable?.()),
      error: capture.getLoadError?.() || null,
      platform: capture.getPlatform?.() || process.platform
    };
  });

  ipcMain.handle('audio:stop', async () => {
    await stopNativeAudio();
    return { ok: true };
  });

  ipcMain.handle('audio:start', async (_event, sourceId) => {
    await stopNativeAudio();
    const capture = safeNativeModule();
    if (!capture.isAvailable?.()) {
      return { ok: false, error: capture.getLoadError?.() || 'Captura nativa indisponível.' };
    }

    const id = String(sourceId || selectedSourceId || '');
    if (!id.startsWith('window:')) {
      return {
        ok: false,
        safeFallback: true,
        error: 'Para áudio isolado, escolha uma JANELA. Tela inteira será transmitida sem áudio para não capturar o Discord.'
      };
    }

    const parts = id.split(':');
    const hwnd = Number.parseInt(parts[1], 10);
    if (!Number.isFinite(hwnd) || hwnd <= 0) {
      return { ok: false, error: 'Não foi possível identificar a janela escolhida.' };
    }

    const pid = capture.getPidFromWindowHandle(hwnd);
    if (!pid) return { ok: false, error: 'Não foi possível identificar o processo desta janela.' };

    let firstMeta = null;
    let firstResolve;
    const firstMetaPromise = new Promise((resolve) => { firstResolve = resolve; });

    try {
      const started = capture.startCapture(pid, true, (buffer, meta) => {
        if (!firstMeta) {
          firstMeta = meta || { sampleRate: 48000, channels: 2, bitsPerSample: 32, isFloat: true };
          firstResolve(firstMeta);
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('audio:chunk', {
            data: Buffer.from(buffer).toString('base64'),
            meta: meta || firstMeta
          });
        }
      });

      if (!started) return { ok: false, error: 'O Windows não iniciou a captura do áudio desse aplicativo.' };
      audioRunning = true;

      const meta = await Promise.race([
        firstMetaPromise,
        new Promise((resolve) => setTimeout(() => resolve({ sampleRate: 48000, channels: 2, bitsPerSample: 32, isFloat: true }), 900))
      ]);

      return { ok: true, pid, meta };
    } catch (error) {
      await stopNativeAudio();
      return { ok: false, error: String(error?.message || error) };
    }
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopNativeAudio();
  if (process.platform !== 'darwin') app.quit();
});
