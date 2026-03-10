# X Cookie & Proxy Helper 🔥

Firefox extension for managing X.com (Twitter) accounts — per-tab proxy, cookie extraction, and TOTP 2FA generation.

![Firefox](https://img.shields.io/badge/Firefox-Extension-orange?logo=firefox)
![License](https://img.shields.io/badge/License-MIT-blue)

## Features

### 🔌 Per-Tab Proxy
- Assign **different proxies to different tabs** (HTTP / SOCKS5)
- Quick paste format: `host:port:user:pass`
- Proxy persists per tab — switch tabs, keep proxy
- Only Firefox supports per-tab proxy via `proxy.onRequest` API

### 👤 Account Manager
- Paste accounts from file (supports `|`, `:`, tab separators)
- Copy username, email, password, 2FA token with one click
- Accounts saved in extension storage between sessions

### 🔑 TOTP 2FA Generator
- Generate 2FA codes directly from account's secret token
- Auto-copies code to clipboard on generation
- Live countdown timer shows seconds until next code
- Pure JavaScript implementation — no external dependencies

### 🍪 Cookie Extractor
- Extract `auth_token` + `ct0` from X.com in one click
- Copy as JSON or single line
- **Auto-save** to file with linked account credentials
- Files saved as `handshake/YYYY-MM-DD_N.txt`

## Installation

1. Open Firefox
2. Go to `about:debugging#/runtime/this-firefox`
3. Click **"Load Temporary Add-on"**
4. Select `manifest.json` from this folder

> **Tip:** Click 📌 **"Open in tab"** in popup to keep it open permanently

## Account File Format

Supports multiple formats:

```
username | password | 2fa_secret | email | ...
username:password:email:2fa_secret
username	password	email	2fa_secret
```

Header rows are automatically skipped.

## Cookie Save Format

Files saved as `handshake/YYYY-MM-DD_N.txt`:

```
1. auth_token=abc123... ct0=def456... username password
```

> **Tip:** Set Firefox download directory to your project folder so files save directly there.

## Tech Stack

- Firefox Manifest V2
- `proxy.onRequest` API (Firefox exclusive)
- Web Crypto API for TOTP/HMAC-SHA1
- Zero external dependencies

## Why Firefox?

Chrome and other Chromium-based browsers **do not support per-tab proxy**. Firefox's `proxy.onRequest` API is the only browser API that allows routing specific tabs through different proxies.

## License

MIT
