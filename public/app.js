// Frontend state management
let ws = null;
let reconnectInterval = 3000;
let isConnected = false;
let currentStatus = 'stopped';
let uptimeTimer = null;
let currentUptimeSeconds = 0;

// FPS monitoring
let frameCount = 0;
let lastFpsTime = performance.now();

// DOM References
const statusPulse = document.getElementById('status-pulse');
const statusText = document.getElementById('status-text');
const uptimeValue = document.getElementById('uptime-value');
const fpsCounter = document.getElementById('fps-counter');

const browserUrlInput = document.getElementById('browser-url-input');
const browserTitleText = document.getElementById('browser-title-text');
const btnNavigate = document.getElementById('btn-navigate');
const btnReload = document.getElementById('btn-reload');

const previewCanvas = document.getElementById('preview-canvas');
const canvasCtx = previewCanvas.getContext('2d');
const canvasWrapper = previewCanvas.parentElement;
const canvasOverlay = document.getElementById('canvas-overlay');
const overlayMessage = document.getElementById('overlay-message');

const textSimulatorInput = document.getElementById('text-simulator-input');
const btnSendText = document.getElementById('btn-send-text');

const btnStart = document.getElementById('btn-start');
const btnStop = document.getElementById('btn-stop');

const configTargetUrl = document.getElementById('config-target-url');
const configAfkInterval = document.getElementById('config-afk-interval');
const afkIntervalBadge = document.getElementById('afk-interval-badge');
const configClickSelector = document.getElementById('config-click-selector');
const configPreviewSpeed = document.getElementById('config-preview-speed');
const previewSpeedBadge = document.getElementById('preview-speed-badge');
const btnSaveConfig = document.getElementById('btn-save-config');

const metricRam = document.getElementById('metric-ram');
const metricCpu = document.getElementById('metric-cpu');
const metricSysmem = document.getElementById('metric-sysmem');
const logConsole = document.getElementById('log-console');
const btnClearLogs = document.getElementById('btn-clear-logs');

// Canvas context configurations
canvasCtx.imageSmoothingEnabled = true;
canvasCtx.imageSmoothingQuality = 'medium';

// Setup tabindex to make canvas focusable for keyboard capture
previewCanvas.setAttribute('tabindex', '0');

// Initial setup helper functions
function updateUptimeDisplay() {
  const hrs = String(Math.floor(currentUptimeSeconds / 3600)).padStart(2, '0');
  const mins = String(Math.floor((currentUptimeSeconds % 3600) / 60)).padStart(2, '0');
  const secs = String(currentUptimeSeconds % 60).padStart(2, '0');
  uptimeValue.textContent = `${hrs}:${mins}:${secs}`;
}

function startUptimeClock() {
  if (uptimeTimer) clearInterval(uptimeTimer);
  uptimeTimer = setInterval(() => {
    if (currentStatus === 'running') {
      currentUptimeSeconds++;
      updateUptimeDisplay();
    }
  }, 1000);
}

function stopUptimeClock() {
  if (uptimeTimer) {
    clearInterval(uptimeTimer);
    uptimeTimer = null;
  }
}

// Log writing helper
function appendLog(logEntry) {
  const logRow = document.createElement('div');
  logRow.className = `log-line log-${logEntry.type || 'info'}`;
  
  const timeSpan = document.createElement('span');
  timeSpan.className = 'log-time';
  timeSpan.textContent = new Date(logEntry.time).toLocaleTimeString();
  
  const textSpan = document.createElement('span');
  textSpan.textContent = ` [${logEntry.type.toUpperCase()}] ${logEntry.message}`;
  
  logRow.appendChild(timeSpan);
  logRow.appendChild(textSpan);
  logConsole.appendChild(logRow);
  
  // Keep logs element scrolled to the bottom
  logConsole.parentElement.scrollTop = logConsole.parentElement.scrollHeight;
}

// Establish WebSockets connection
function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  
  console.log(`Connecting WebSocket to ${wsUrl}...`);
  ws = new WebSocket(wsUrl);
  
  ws.onopen = () => {
    console.log('WebSocket successfully connected!');
    isConnected = true;
    statusPulse.className = 'indicator-pulse';
    statusText.textContent = 'CONNECTING...';
    appendLog({ time: Date.now(), type: 'info', message: 'WebSocket tunnel established' });
  };
  
  ws.onclose = () => {
    console.log('WebSocket disconnected. Reconnecting...');
    isConnected = false;
    currentStatus = 'stopped';
    statusPulse.className = 'indicator-pulse stopped';
    statusText.textContent = 'DISCONNECTED';
    overlayMessage.textContent = 'Offline. Connecting to server backend...';
    canvasOverlay.classList.remove('hidden');
    canvasWrapper.classList.remove('running');
    stopUptimeClock();
    setTimeout(connectWebSocket, reconnectInterval);
  };
  
  ws.onerror = (err) => {
    console.error('WebSocket Error:', err);
  };
  
  ws.onmessage = (msg) => {
    try {
      const payload = JSON.parse(msg.data);
      
      switch (payload.type) {
        case 'init':
          // Load configurations
          configTargetUrl.value = payload.config.targetUrl;
          configAfkInterval.value = payload.config.afkInterval;
          afkIntervalBadge.textContent = `${payload.config.afkInterval}s`;
          configClickSelector.value = payload.config.clickSelector;
          configPreviewSpeed.value = payload.config.previewInterval;
          previewSpeedBadge.textContent = `${payload.config.previewInterval}ms`;
          
          // Clear initial dummy log message if loaded server history
          if (payload.logs.length > 0) {
            logConsole.innerHTML = '';
            payload.logs.forEach(appendLog);
          }
          
          updateBotState(payload.status);
          break;
          
        case 'status':
          updateBotState(payload.status);
          currentUptimeSeconds = payload.uptime;
          updateUptimeDisplay();
          
          // Set inputs
          if (payload.url) {
            browserUrlInput.value = payload.url;
          }
          browserTitleText.textContent = payload.title || 'None';
          
          // Update CPU & RAM
          if (payload.metrics) {
            metricRam.textContent = payload.metrics.nodeMemory;
            metricCpu.textContent = payload.metrics.nodeCpu;
            metricSysmem.textContent = payload.metrics.systemMemory;
          }
          break;
          
        case 'preview':
          renderFrame(payload.data);
          break;
          
        case 'log':
          appendLog(payload.log);
          break;
      }
    } catch (err) {
      console.error('Error parsing WS message:', err);
    }
  };
}

// Bot state updater
function updateBotState(status) {
  if (currentStatus === status) return;
  currentStatus = status;
  
  if (status === 'running') {
    statusPulse.className = 'indicator-pulse running';
    statusText.textContent = 'RUNNING';
    btnStart.setAttribute('disabled', 'true');
    btnStop.removeAttribute('disabled');
    canvasOverlay.classList.add('hidden');
    canvasWrapper.classList.add('running');
    startUptimeClock();
  } else {
    statusPulse.className = 'indicator-pulse stopped';
    statusText.textContent = 'STOPPED';
    btnStart.removeAttribute('disabled');
    btnStop.setAttribute('disabled', 'true');
    overlayMessage.textContent = 'Bot is Stopped. Click Start to initialize.';
    canvasOverlay.classList.remove('hidden');
    canvasWrapper.classList.remove('running');
    stopUptimeClock();
  }
}

// Render Preview Frames on Canvas
function renderFrame(base64Data) {
  const img = new Image();
  img.onload = () => {
    canvasCtx.drawImage(img, 0, 0, previewCanvas.width, previewCanvas.height);
    
    // FPS Calculator
    frameCount++;
    const now = performance.now();
    if (now - lastFpsTime >= 1000) {
      fpsCounter.textContent = `${frameCount} FPS`;
      frameCount = 0;
      lastFpsTime = now;
    }
  };
  img.src = base64Data;
}

// Input Simulation Actions
function sendAction(action, payload = null) {
  if (!isConnected || !ws) return;
  ws.send(JSON.stringify({
    type: 'action',
    action,
    payload
  }));
}

// Map Click Events from Canvas
previewCanvas.addEventListener('mousedown', (e) => {
  if (currentStatus !== 'running') return;
  
  // Calculate relative coordinate based on styled layout width/height
  const rect = previewCanvas.getBoundingClientRect();
  const scaleX = previewCanvas.width / rect.width;
  const scaleY = previewCanvas.height / rect.height;
  
  const x = (e.clientX - rect.left) * scaleX;
  const y = (e.clientY - rect.top) * scaleY;
  
  sendAction('click', {
    x: Math.round(x),
    y: Math.round(y)
  });
});

// Map Keystrokes when Canvas is Active
previewCanvas.addEventListener('keydown', (e) => {
  if (currentStatus !== 'running') return;
  
  // Prevent browser actions like tab indexing or backspace nav
  const preventKeys = ['Tab', 'Backspace', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '];
  if (preventKeys.includes(e.key)) {
    e.preventDefault();
  }
  
  // If it's a standard letter, number or control key
  sendAction('key', { key: e.key });
});

// Save configuration updates
function saveConfig() {
  if (!isConnected || !ws) return;
  
  const targetUrl = configTargetUrl.value.trim();
  const afkInterval = parseInt(configAfkInterval.value, 10);
  const clickSelector = configClickSelector.value.trim();
  const previewInterval = parseInt(configPreviewSpeed.value, 10);
  
  ws.send(JSON.stringify({
    type: 'updateConfig',
    config: {
      targetUrl,
      afkInterval,
      clickSelector,
      previewInterval
    }
  }));
  
  appendLog({
    time: Date.now(),
    type: 'info',
    message: 'Configuration profile saved and updated.'
  });
}

// Set Event Listeners
btnStart.addEventListener('click', () => sendAction('start'));
btnStop.addEventListener('click', () => sendAction('stop'));
btnReload.addEventListener('click', () => sendAction('reload'));

btnNavigate.addEventListener('click', () => {
  const url = browserUrlInput.value.trim();
  if (url) {
    sendAction('navigate', { url });
  }
});

browserUrlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const url = browserUrlInput.value.trim();
    if (url) {
      sendAction('navigate', { url });
    }
  }
});

btnSendText.addEventListener('click', () => {
  const text = textSimulatorInput.value;
  if (text) {
    sendAction('type', { text });
    textSimulatorInput.value = '';
  }
});

textSimulatorInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const text = textSimulatorInput.value;
    if (text) {
      sendAction('type', { text });
      textSimulatorInput.value = '';
    }
  }
});

// Settings Input Listeners
configAfkInterval.addEventListener('input', () => {
  afkIntervalBadge.textContent = `${configAfkInterval.value}s`;
});

configPreviewSpeed.addEventListener('input', () => {
  previewSpeedBadge.textContent = `${configPreviewSpeed.value}ms`;
});

btnSaveConfig.addEventListener('click', saveConfig);

btnClearLogs.addEventListener('click', () => {
  logConsole.innerHTML = '';
});

// Keyboard simulator preset buttons click mapping
document.querySelectorAll('.key-preset').forEach((btn) => {
  btn.addEventListener('click', () => {
    const key = btn.getAttribute('data-key');
    sendAction('key', { key });
  });
});

// Focus styling helper on canvas
previewCanvas.addEventListener('focus', () => {
  canvasWrapper.style.borderColor = 'var(--color-primary)';
  canvasWrapper.style.boxShadow = '0 0 25px var(--color-primary-glow)';
});

previewCanvas.addEventListener('blur', () => {
  if (currentStatus === 'running') {
    canvasWrapper.style.borderColor = 'rgba(139, 92, 246, 0.3)';
    canvasWrapper.style.boxShadow = '0 0 20px var(--color-primary-glow)';
  } else {
    canvasWrapper.style.borderColor = '#1a1530';
    canvasWrapper.style.boxShadow = 'inset 0 0 20px rgba(0, 0, 0, 0.9)';
  }
});

// Auto-run connection
connectWebSocket();
updateUptimeDisplay();
