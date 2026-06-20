const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const os = require('os');
const fs = require('fs');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Load environment variables from .env if it exists
if (fs.existsSync(path.join(__dirname, '.env'))) {
  const envContent = fs.readFileSync(path.join(__dirname, '.env'), 'utf-8');
  envContent.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const separatorIdx = trimmed.indexOf('=');
    if (separatorIdx > 0) {
      const key = trimmed.substring(0, separatorIdx).trim();
      const val = trimmed.substring(separatorIdx + 1).trim().replace(/^["']|["']$/g, '');
      process.env[key] = val;
    }
  });
}

// Enable Puppeteer stealth
puppeteer.use(StealthPlugin());

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Application State
let browser = null;
let page = null;
let mainPage = null; // Stores reference to the primary VektalNodes tab
let botStatus = 'stopped'; // 'stopped' or 'running'
let uptimeStart = null;
const logs = [];
const maxLogs = 500;

// Configuration defaults
const config = {
  targetUrl: 'https://vektalnodes.in/earn',
  afkInterval: 30, // seconds
  clickSelector: '',
  previewInterval: 100, // ms
  viewportWidth: 1280,
  viewportHeight: 800,
};

// Logging System
function log(message, type = 'info') {
  const timestamp = new Date().toISOString();
  const logEntry = { time: timestamp, type, message };
  logs.push(logEntry);
  if (logs.length > maxLogs) logs.shift();
  
  console.log(`[${type.toUpperCase()}] ${message}`);
  broadcast({ type: 'log', log: logEntry });
}

// Broadcast utility
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

// Server metrics helper
function getSystemMetrics() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memoryUsage = process.memoryUsage();
  return {
    nodeCpu: process.cpuUsage().user / 1000000 + 's CPU time',
    nodeMemory: Math.round(memoryUsage.rss / 1024 / 1024) + ' MB (RSS)',
    systemMemory: Math.round((usedMem / totalMem) * 100) + '%',
  };
}

// Dynamic page state check
async function getPageState() {
  if (!page || page.isClosed()) return { url: '', title: '' };
  try {
    const url = page.url();
    const title = await page.title();
    return { url, title };
  } catch (err) {
    return { url: '', title: 'Unknown' };
  }
}

// Broadcast stats/uptime to dashboard every second
setInterval(async () => {
  if (wss.clients.size === 0) return;

  let uptime = 0;
  if (botStatus === 'running' && uptimeStart) {
    uptime = Math.floor((Date.now() - uptimeStart) / 1000);
  }

  const pageState = await getPageState();

  broadcast({
    type: 'status',
    status: botStatus,
    uptime,
    url: pageState.url,
    title: pageState.title,
    metrics: getSystemMetrics(),
  });
}, 1000);

// Live Screenshot Loop
let isScreenshotLoopActive = false;
let screenshotTimeout = null;
async function captureScreenshotLoop() {
  if (botStatus !== 'running' || !page || page.isClosed()) {
    isScreenshotLoopActive = false;
    return;
  }

  isScreenshotLoopActive = true;

  // Only take screenshots when clients are listening to conserve resource utilization
  if (wss.clients.size > 0) {
    try {
      const buffer = await page.screenshot({
        type: 'jpeg',
        quality: 50, // balanced quality/size
        encoding: 'base64',
      });
      broadcast({
        type: 'preview',
        data: `data:image/jpeg;base64,${buffer}`,
      });
    } catch (err) {
      if (!err.message.includes('Target closed') && !err.message.includes('Session closed')) {
        log(`Screenshot capture failed: ${err.message}`, 'error');
      }
    }
  }

  screenshotTimeout = setTimeout(captureScreenshotLoop, config.previewInterval);
}

// AFK Simulation Loop
let afkTimeout = null;
async function startAfkLoop() {
  if (botStatus !== 'running' || !page || page.isClosed()) return;

  try {
    const currentUrl = page.url();
    if (currentUrl.includes('/login')) {
      log('Detected session expiration/redirect to login page. Attempting automated authentication...', 'warning');
      const loginSuccess = await handleAutoLogin();
      if (loginSuccess) {
        log(`Navigating to target page: ${config.targetUrl}...`, 'info');
        await page.goto(config.targetUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 60000,
        });
      }
    } else if (currentUrl.includes('/earn')) {
      log('Simulating AFK active check...', 'info');

      // 1. Hover/Move Mouse
      const x = Math.floor(Math.random() * (config.viewportWidth - 100)) + 50;
      const y = Math.floor(Math.random() * (config.viewportHeight - 100)) + 50;
      await page.mouse.move(x, y, { steps: 5 });

      // 2. Tiny Scroll Simulation
      await page.evaluate(() => {
        window.scrollBy(0, 80);
        setTimeout(() => window.scrollBy(0, -80), 400);
      });

      // 3. Automated Selector click or neutral click
      if (config.clickSelector) {
        const clicked = await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (el) {
            el.click();
            return true;
          }
          return false;
        }, config.clickSelector);

        if (clicked) {
          log(`Clicked custom selector: "${config.clickSelector}"`, 'info');
        } else {
          log(`Selector "${config.clickSelector}" not found on page`, 'warning');
        }
      } else {
        // Perform a safe click on neutral coordinate
        await page.mouse.click(x, y);
        log(`Simulated neutral click at coordinates [${x}, ${y}]`, 'info');
      }
    } else {
      log(`Viewing active redirect tab: ${currentUrl} (AFK simulation paused for manual interaction)`, 'info');
    }
  } catch (err) {
    log(`AFK execution error: ${err.message}`, 'warning');
  }

  afkTimeout = setTimeout(startAfkLoop, config.afkInterval * 1000);
}

// Automated Login Helper
async function handleAutoLogin() {
  if (!page || page.isClosed()) return false;

  const email = process.env.EMAIL;
  const password = process.env.PASSWORD;

  if (!email || !password) {
    log('Auto-login aborted: EMAIL or PASSWORD environment variables are not set in .env', 'error');
    return false;
  }

  try {
    log('Waiting for login form fields...', 'info');
    await page.waitForSelector('input[name="email"]', { timeout: 15000 });
    await page.waitForSelector('input[name="password"]', { timeout: 15000 });
    await page.waitForSelector('button[type="submit"]', { timeout: 15000 });

    log('Typing credentials...', 'info');
    // Clear and type email
    await page.click('input[name="email"]', { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.type('input[name="email"]', email, { delay: 50 });

    // Clear and type password
    await page.click('input[name="password"]', { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.type('input[name="password"]', password, { delay: 50 });

    log('Submitting login form...', 'info');
    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45000 })
    ]);

    const postLoginUrl = page.url();
    if (postLoginUrl.includes('/login')) {
      log('Authentication failed! Still on the login page (invalid credentials?).', 'error');
      return false;
    }

    log('Authentication successful!', 'info');
    return true;
  } catch (err) {
    log(`Automated login failed: ${err.message}`, 'error');
    return false;
  }
}

// Automated LinkPays Solver
async function handleLinkPaysSolver(targetPage) {
  if (!targetPage || targetPage.isClosed()) return;
  try {
    log('LinkPays redirect page detected. Waiting 5 seconds for verification...', 'info');
    await new Promise(r => setTimeout(r, 5000));

    if (targetPage.isClosed()) return;

    log('Searching for "Continue to Next" button...', 'info');
    const clicked = await targetPage.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('button, a, input[type="button"], input[type="submit"]'));
      const target = elements.find(el => {
        const text = el.textContent.trim().toLowerCase();
        const value = el.value ? el.value.trim().toLowerCase() : '';
        return text.includes('continue to next') || value.includes('continue to next');
      });
      if (target) {
        target.click();
        return true;
      }
      return false;
    });

    if (clicked) {
      log('Clicked "Continue to Next" button successfully!', 'info');
    } else {
      log('"Continue to Next" button not found on this step.', 'warning');
    }
  } catch (err) {
    log(`LinkPays automation failed: ${err.message}`, 'warning');
  }
}

// Click Open LinkPays Button
async function clickLinkPaysButton() {
  if (!page || page.isClosed()) return;
  try {
    log('Looking for "Open LinkPays" button...', 'info');
    // Wait for the button to load
    await page.waitForSelector('button.button-primary', { timeout: 15000 });

    const clicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button.button-primary'));
      const target = buttons.find(b => b.textContent.trim().includes('Open LinkPays'));
      if (target) {
        target.click();
        return true;
      }
      return false;
    });

    if (clicked) {
      log('Clicked "Open LinkPays" button successfully!', 'info');
    } else {
      log('"Open LinkPays" button not found among primary buttons.', 'warning');
    }
  } catch (err) {
    log(`Failed to click "Open LinkPays" button: ${err.message}`, 'warning');
  }
}

// Core Operations
async function startBot() {
  if (botStatus === 'running') {
    log('Bot is already running', 'warning');
    return;
  }

  log('Launching browser with stealth settings...', 'info');
  botStatus = 'running';
  uptimeStart = Date.now();

  try {
    browser = await puppeteer.launch({
      headless: true, // headless mode for headless server environments
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        `--window-size=${config.viewportWidth},${config.viewportHeight}`,
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
      ],
      defaultViewport: {
        width: config.viewportWidth,
        height: config.viewportHeight,
      },
    });

    const pages = await browser.pages();
    page = pages[0] || (await browser.newPage());
    mainPage = page;

    // Listen for newly opened browser tabs (e.g. LinkPays redirection)
    browser.on('targetcreated', async (target) => {
      if (target.type() === 'page') {
        try {
          const newPage = await target.page();
          if (!newPage) return;

          // Wait a brief moment for page URL to populate
          await new Promise(r => setTimeout(r, 1000));
          const newUrl = newPage.url();

          // Skip default blank pages or the main page itself
          if (newUrl === 'about:blank' || (mainPage && newPage === mainPage)) {
            return;
          }

          log(`Redirect tab detected: "${await newPage.title()}" (${newUrl})`, 'info');

          // Switch active view and interaction page to the new tab
          page = newPage;

          // If it is LinkPays, register navigation handler and solve it
          if (newUrl.includes('linkpays.in')) {
            newPage.on('framenavigated', async (frame) => {
              if (frame === newPage.mainFrame()) {
                const currentUrl = newPage.url();
                if (currentUrl.includes('linkpays.in')) {
                  await handleLinkPaysSolver(newPage);
                }
              }
            });

            // Run the solver for the initial page load
            await handleLinkPaysSolver(newPage);
          }

          // Revert back when tab is closed
          newPage.on('close', () => {
            log('Redirect tab closed. Reverting active view back to main page.', 'info');
            page = mainPage;
          });
        } catch (err) {
          log(`Error tracking redirect tab: ${err.message}`, 'debug');
        }
      }
    });

    // Spoof client environment characteristics
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // Start screenshot loop immediately to show initial loading progress on dashboard
    if (!isScreenshotLoopActive) {
      captureScreenshotLoop();
    }

    // Page state handlers
    page.on('console', (msg) => {
      const type = msg.type();
      if (type === 'error' || type === 'warning') {
        log(`Browser console [${type}]: ${msg.text()}`, 'debug');
      }
    });

    page.on('error', (err) => {
      log(`Browser tab crashed: ${err.message}`, 'error');
    });

    log(`Navigating to ${config.targetUrl}...`, 'info');
    await page.goto(config.targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    
    // Check for login page and handle auto-login if needed
    const currentUrl = page.url();
    if (currentUrl.includes('/login')) {
      log('Redirected to login page. Attempting automated authentication...', 'info');
      const loginSuccess = await handleAutoLogin();
      if (loginSuccess) {
        log(`Navigating to target page: ${config.targetUrl}...`, 'info');
        await page.goto(config.targetUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 60000,
        });
      }
    }
    
    log(`Successfully loaded: "${await page.title()}"`, 'info');

    // If we successfully loaded the earn page, attempt to click the "Open LinkPays" button
    if (page.url().includes('/earn')) {
      await clickLinkPaysButton();
    }

    // Run event loops
    startAfkLoop();
  } catch (err) {
    log(`Failed to initiate browser session: ${err.message}`, 'error');
    await stopBot();
  }
}

async function stopBot() {
  if (botStatus === 'stopped') return;

  log('Shutting down browser session...', 'info');
  botStatus = 'stopped';
  uptimeStart = null;
  isScreenshotLoopActive = false;

  if (screenshotTimeout) {
    clearTimeout(screenshotTimeout);
    screenshotTimeout = null;
  }
  if (afkTimeout) {
    clearTimeout(afkTimeout);
    afkTimeout = null;
  }

  try {
    if (browser) {
      await browser.close();
    }
  } catch (err) {
    log(`Error closing browser: ${err.message}`, 'error');
  } finally {
    browser = null;
    page = null;
    log('Bot terminated', 'info');
  }
}

async function reloadPage() {
  if (!page || page.isClosed()) return;
  try {
    log('Reloading browser...', 'info');
    await page.reload({ waitUntil: 'domcontentloaded' });
  } catch (err) {
    log(`Reload action failed: ${err.message}`, 'warning');
  }
}

async function navigateTo(url) {
  if (!page || page.isClosed()) return;
  try {
    log(`Navigating to URL: ${url}`, 'info');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (err) {
    log(`Navigation failed: ${err.message}`, 'warning');
  }
}

async function simulateClick(x, y) {
  if (!page || page.isClosed()) return;
  try {
    await page.mouse.click(x, y);
    log(`Sent click: X=${x}, Y=${y}`, 'info');
  } catch (err) {
    log(`Click simulation failed: ${err.message}`, 'warning');
  }
}

async function simulateType(text) {
  if (!page || page.isClosed()) return;
  try {
    await page.keyboard.type(text);
    log(`Sent keystrokes (Length: ${text.length})`, 'info');
  } catch (err) {
    log(`Keystroke simulation failed: ${err.message}`, 'warning');
  }
}

async function simulateKey(key) {
  if (!page || page.isClosed()) return;
  try {
    await page.keyboard.press(key);
    log(`Sent keypress: "${key}"`, 'info');
  } catch (err) {
    log(`Keypress simulation failed: ${err.message}`, 'warning');
  }
}

// WebSocket Event Interface
wss.on('connection', (ws) => {
  log('Dashboard client connected', 'info');

  // Send initial session payload
  ws.send(
    JSON.stringify({
      type: 'init',
      config,
      status: botStatus,
      logs,
    })
  );

  // Resume frame captures if session is active and not already running
  if (botStatus === 'running' && !isScreenshotLoopActive) {
    captureScreenshotLoop();
  }

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      switch (data.type) {
        case 'action':
          if (data.action === 'start') {
            await startBot();
          } else if (data.action === 'stop') {
            await stopBot();
          } else if (data.action === 'reload') {
            await reloadPage();
          } else if (data.action === 'click') {
            await simulateClick(data.payload.x, data.payload.y);
          } else if (data.action === 'type') {
            await simulateType(data.payload.text);
          } else if (data.action === 'key') {
            await simulateKey(data.payload.key);
          } else if (data.action === 'navigate') {
            await navigateTo(data.payload.url);
          }
          break;
        case 'updateConfig':
          Object.assign(config, data.config);
          log(`Config updated: ${JSON.stringify(data.config)}`, 'info');
          break;
      }
    } catch (err) {
      log(`WS execution exception: ${err.message}`, 'warning');
    }
  });

  ws.on('close', () => {
    log('Dashboard client disconnected', 'info');
  });
});

// Serve frontend dashboard statically
app.use(express.static(path.join(__dirname, 'public')));

// Fallback to index.html for general paths
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Express Listener
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`=========================================`);
  console.log(`  AFK Bot Dashboard Server Running`);
  console.log(`  Dashboard URL: http://localhost:${PORT}`);
  console.log(`=========================================`);
});
