const { app, BrowserWindow, shell, ipcMain, globalShortcut, screen } = require('electron');
const path = require('path');

// Override with BASE_URL=http://localhost:4100 to test against a local server.
const APP_URL = process.env.BASE_URL || 'https://pm.nicelycontrol.com';
const TOGGLE_STICKY = 'CommandOrControl+Shift+Space';

let mainWin = null;
let stickyWin = null;

function createWindow() {
  mainWin = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Base',
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWin.loadURL(APP_URL);

  // Open external links (mailto, other sites) in the real browser;
  // keep navigation inside the app window.
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(APP_URL)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWin.on('closed', () => { mainWin = null; });
}

// Small frameless note that floats above other apps. Created once, then shown/hidden —
// so the checklist and the chosen board/group survive being dismissed.
function createSticky() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const W = 340, H = 460, PAD = 24;

  stickyWin = new BrowserWindow({
    width: W,
    height: H,
    x: width - W - PAD,
    y: height - H - PAD,
    minWidth: 260,
    minHeight: 260,
    title: 'Today',
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#1b1f27',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload-sticky.js')
    }
  });

  // Float above fullscreen apps too, not just normal windows.
  stickyWin.setAlwaysOnTop(true, 'floating');
  stickyWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  stickyWin.loadURL(APP_URL + '/sticky.html');
  stickyWin.once('ready-to-show', () => stickyWin.show());

  // Hiding (rather than closing) keeps the list in memory and the window position.
  stickyWin.on('close', (e) => {
    if (!app.isQuitting) { e.preventDefault(); stickyWin.hide(); }
  });
}

function toggleSticky() {
  if (!stickyWin) return createSticky();
  if (stickyWin.isVisible()) stickyWin.hide();
  else { stickyWin.show(); stickyWin.focus(); }
}

ipcMain.on('sticky:hide', () => { if (stickyWin) stickyWin.hide(); });

app.whenReady().then(() => {
  createWindow();
  createSticky();

  globalShortcut.register(TOGGLE_STICKY, toggleSticky);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => { app.isQuitting = true; });
app.on('will-quit', () => globalShortcut.unregisterAll());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
