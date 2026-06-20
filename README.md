# VektalNodes AFK Bot & Dashboard

A Puppeteer and Chromium-based AFK automation bot for `vektalnodes.in/earn` bundled with a responsive dashboard that provides a real-time live browser preview, node metrics, configuration controls, and audit logging.

## Features
- **Stealth Automation**: Simulates active user behavior (random cursor movements, scrolls, neutral clicks, and custom selector actions) to bypass idle detection.
- **Automated Login**: Uses credentials from `.env` or environment variables to sign in when redirected to the login page.
- **Live Preview Stream**: Captures and transmits browser screenshots at 100ms intervals over WebSockets to show rendering progress.
- **Interactive Controls**: Click or type inside the live preview canvas to interact directly with the running Puppeteer instance.

---

## Local Development

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Credentials
Create a `.env` file in the project root:
```env
EMAIL=your_email@example.com
PASSWORD=your_password
```

### 3. Run the Server
```bash
npm start
```
Open **`http://localhost:3000`** in your browser to access the control panel.

---

## Deploy to Render (Render.com)

This repository includes a `render.yaml` blueprint configuration which simplifies deployment.

### Automated Setup (Blueprint)
1. Commit your code and push it to your GitHub repository.
2. Go to the [Render Dashboard](https://dashboard.render.com/).
3. Click **New +** and select **Blueprint**.
4. Connect your GitHub repository.
5. Render will automatically parse `render.yaml` and prompt you to set your environment variables:
   - `EMAIL`: Your VektalNodes email.
   - `PASSWORD`: Your VektalNodes password.
6. Click **Apply** to build and deploy.

### Manual Setup on Render
If you prefer to configure the web service manually:
1. Create a new **Web Service** on Render pointing to your repository.
2. Set the following settings:
   - **Environment / Runtime**: `Node`
   - **Build Command**: `./render-build.sh`
   - **Start Command**: `npm start`
3. Add the following **Environment Variables** in the settings tab:
   - `PUPPETEER_CACHE_DIR` = `./.cache/puppeteer`
   - `EMAIL` = `your_email`
   - `PASSWORD` = `your_password`
4. Click **Deploy**.
