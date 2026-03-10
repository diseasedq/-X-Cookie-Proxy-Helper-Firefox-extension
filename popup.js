// Popup logic — accounts, proxy, cookies + auto-save

let currentTabId = null;
let lastCookies = null;
let accounts = [], selectedAccIdx = -1, saveCounter = 0;
let doneAccounts = new Set(); // indices of accounts with cookies saved

// ==================== INIT ====================

async function init() {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]) {
        currentTabId = tabs[0].id;
        const url = tabs[0].url || tabs[0].title || "—";
        document.getElementById("tabInfo").innerHTML =
            `Tab #${currentTabId}: <strong>${url.substring(0, 50)}</strong>`;

        browser.runtime.sendMessage({ action: "getTabProxy", tabId: currentTabId }, (resp) => {
            if (resp && resp.proxy) {
                fillProxyFields(resp.proxy);
                document.getElementById("proxyDot").classList.add("on");
                setStatus("proxyStatus", `Active: ${resp.proxy.host}:${resp.proxy.port}`, "ok");
            }
        });
    }

    browser.storage.local.get(["savedAccounts", "lastProxy", "saveCounter", "selectedAccIdx", "savedProxies", "proxyIdx", "batchLines", "doneAccounts", "proxyType", "clipChainEnabled"], (data) => {
        if (data.savedAccounts && data.savedAccounts.length > 0) {
            accounts = data.savedAccounts;
            if (data.selectedAccIdx >= 0 && data.selectedAccIdx < accounts.length) {
                selectAccount(data.selectedAccIdx);
            }
            renderAccountList();
        }
        if (data.lastProxy) fillProxyFields(data.lastProxy);
        if (data.saveCounter) saveCounter = data.saveCounter;
        if (data.savedProxies && data.savedProxies.length > 0) {
            proxyList = data.savedProxies;
            proxyIdx = data.proxyIdx >= 0 ? data.proxyIdx : -1;
            document.getElementById("proxyCounter").textContent = `${proxyIdx + 1}/${proxyList.length}`;
            if (proxyIdx >= 0 && proxyIdx < proxyList.length) {
                const p = proxyList[proxyIdx];
                fillProxyFields(p);
                document.getElementById("quickProxy").value = `${p.host}:${p.port}:${p.username}:${p.password}`;
            }
        }
        if (data.batchLines && data.batchLines.length > 0) {
            batchLines = data.batchLines;
            document.getElementById("batchCounter").textContent = `saved: ${batchLines.length}`;
            document.getElementById("btnDownloadBatch").style.display = "block";
        }
        if (data.doneAccounts && data.doneAccounts.length > 0) {
            doneAccounts = new Set(data.doneAccounts);
        }
        if (data.proxyType) {
            document.getElementById("proxyType").value = data.proxyType;
        }
    });
}

// ==================== ACCOUNTS ====================

document.getElementById("btnTogglePaste").addEventListener("click", () => {
    const area = document.getElementById("pasteArea");
    area.classList.toggle("visible");
});

document.getElementById("btnParseAccounts").addEventListener("click", () => {
    const text = document.getElementById("accTextarea").value.trim();
    if (!text) { setStatus("accStatus", "Paste accounts first!", "err"); return; }
    accounts = parseAccounts(text);
    browser.storage.local.set({ savedAccounts: accounts });
    renderAccountList();
    document.getElementById("pasteArea").classList.remove("visible");
    setStatus("accStatus", `Loaded ${accounts.length} accounts`, "ok");
});

function parseAccounts(text) {
    const lines = text.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#") && !l.startsWith("//"));
    const result = [];

    for (const line of lines) {
        // Skip header rows
        if (line.toLowerCase().includes("username") && line.toLowerCase().includes("password")) continue;

        let parts;
        if (line.includes("|")) parts = line.split("|").map(s => s.trim());
        else if (line.includes("\t")) parts = line.split("\t").map(s => s.trim());
        else parts = line.split(":").map(s => s.trim());

        if (parts.length < 2) continue;

        const acc = { username: "", password: "", email: "", mfa: "" };

        // Detect format by field count
        if (parts.length >= 4 && parts[3].includes("@")) {
            // Format: username | password | 2fa | email | ...
            acc.username = parts[0];
            acc.password = parts[1];
            acc.mfa = parts[2];
            acc.email = parts[3];
        } else if (parts.length >= 4) {
            // Format: username | password | email | 2fa (fallback)
            acc.username = parts[0];
            acc.password = parts[1];
            acc.email = parts[2];
            acc.mfa = parts[3];
        } else if (parts.length === 3) {
            acc.username = parts[0];
            acc.password = parts[1];
            acc.email = parts[2];
        } else {
            acc.username = parts[0];
            acc.password = parts[1];
        }

        // Skip junk lines
        if (acc.username.includes("=") || acc.username.length > 60) continue;
        if (acc.username) result.push(acc);
    }
    return result;
}


function renderAccountList() {
    const container = document.getElementById("accList");
    container.innerHTML = "";
    accounts.forEach((acc, i) => {
        const div = document.createElement("div");
        const isDone = doneAccounts.has(i);
        div.className = "acc-item" + (i === selectedAccIdx ? " active" : "") + (isDone ? " done" : "");
        div.innerHTML = `<div class="acc-name">${isDone ? "✅" : ""} @${acc.username}</div><div class="acc-email">${acc.email || "no email"}</div>`;
        div.addEventListener("click", () => selectAccount(i));
        container.appendChild(div);
    });
}

function selectAccount(idx) {
    selectedAccIdx = idx;
    const acc = accounts[idx];
    document.getElementById("fUsername").textContent = acc.username;
    document.getElementById("fUsername").dataset.value = acc.username;
    document.getElementById("fEmail").textContent = acc.email || "—";
    document.getElementById("fEmail").dataset.value = acc.email || "";
    document.getElementById("fPassword").textContent = "•".repeat(Math.min(acc.password.length, 12));
    document.getElementById("fPassword").dataset.value = acc.password;
    document.getElementById("f2FA").textContent = acc.mfa || "—";
    document.getElementById("f2FA").dataset.value = acc.mfa || "";
    document.getElementById("accDetail").classList.add("visible");

    // Show linked account in cookie section
    document.getElementById("linkedName").textContent = `@${acc.username}`;
    document.getElementById("linkedAccount").style.display = "block";

    // Persist selection
    browser.storage.local.set({ selectedAccIdx: idx });

    // Auto-generate 2FA
    if (acc.mfa && acc.mfa.length > 5) {
        generateTOTP(acc.mfa).then(code => {
            if (code) {
                document.getElementById("totpCode").textContent = code;
                document.getElementById("totpResult").style.display = "block";
                // Start timer
                if (totpInterval) clearInterval(totpInterval);
                totpInterval = setInterval(async () => {
                    const remaining = totpSecondsRemaining();
                    document.getElementById("totpTimer").textContent = `${remaining}s`;
                    if (remaining >= 29) {
                        const newCode = await generateTOTP(acc.mfa);
                        document.getElementById("totpCode").textContent = newCode;
                    }
                }, 1000);
            }
        });
    }

    renderAccountList();
}

document.querySelectorAll("[data-copy]").forEach(btn => {
    btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const el = document.getElementById(btn.dataset.copy);
        const val = el.dataset.value || el.textContent;
        if (val && val !== "—") {
            navigator.clipboard.writeText(val);
            btn.textContent = "✓";
            setTimeout(() => btn.textContent = "📋", 1000);
        }
    });
});

// ==================== TOTP 2FA ====================

let totpInterval = null;

document.getElementById("btn2FA").addEventListener("click", async () => {
    if (selectedAccIdx < 0) { setStatus("accStatus", "Select an account first", "err"); return; }
    const acc = accounts[selectedAccIdx];
    const secret = acc.mfa;
    if (!secret) { setStatus("accStatus", "No 2FA token for this account", "err"); return; }

    // Generate and show
    const code = await generateTOTP(secret);
    if (!code) { setStatus("accStatus", "Invalid 2FA token", "err"); return; }

    document.getElementById("totpCode").textContent = code;
    document.getElementById("totpResult").style.display = "block";
    navigator.clipboard.writeText(code);
    setStatus("accStatus", "✓ 2FA code copied!", "ok");

    // Start countdown timer
    if (totpInterval) clearInterval(totpInterval);
    totpInterval = setInterval(async () => {
        const remaining = totpSecondsRemaining();
        document.getElementById("totpTimer").textContent = `${remaining}s`;

        // Refresh code when timer hits 30 (new period)
        if (remaining >= 29) {
            const newCode = await generateTOTP(secret);
            document.getElementById("totpCode").textContent = newCode;
        }
    }, 1000);
});

document.getElementById("btnCopyTotp").addEventListener("click", () => {
    const code = document.getElementById("totpCode").textContent;
    if (code && code !== "------") {
        navigator.clipboard.writeText(code);
        document.getElementById("btnCopyTotp").textContent = "✓";
        setTimeout(() => document.getElementById("btnCopyTotp").textContent = "📋", 1000);
    }
});

// ==================== PROXY LIST ====================

let proxyList = [];
let proxyIdx = -1;

document.getElementById("proxyHeader").addEventListener("click", () => {
    const d = document.getElementById("proxyDetails");
    d.style.display = d.style.display === "none" ? "block" : "none";
});

document.getElementById("proxyType").addEventListener("change", () => {
    browser.storage.local.set({ proxyType: document.getElementById("proxyType").value });
});

document.getElementById("btnToggleProxyPaste").addEventListener("click", () => {
    document.getElementById("proxyPasteArea").classList.toggle("visible");
});

document.getElementById("btnLoadProxies").addEventListener("click", () => {
    const text = document.getElementById("proxyTextarea").value.trim();
    if (!text) { setStatus("proxyStatus", "Paste proxies first!", "err"); return; }

    const type = document.getElementById("proxyType").value;
    proxyList = text.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#")).map(line => {
        const parts = line.split(":").map(s => s.trim());
        let port = parts[1];
        // Auto-fix webshare ports: SOCKS5 uses 1080, HTTP uses 80
        if (parts[0].includes("webshare")) {
            if (type === "socks" && port === "80") port = "1080";
            if (type === "http" && port === "1080") port = "80";
        }
        return { host: parts[0], port, username: parts[2] || "", password: parts[3] || "" };
    }).filter(p => p.host && p.port);

    proxyIdx = -1;
    browser.storage.local.set({ savedProxies: proxyList, proxyIdx });
    document.getElementById("proxyPasteArea").classList.remove("visible");
    document.getElementById("proxyCounter").textContent = `0/${proxyList.length}`;
    setStatus("proxyStatus", `Loaded ${proxyList.length} proxies (${type.toUpperCase()})`, "ok");
});

document.getElementById("btnNextProxy").addEventListener("click", () => {
    if (proxyList.length === 0) { setStatus("proxyStatus", "Load proxies first!", "err"); return; }

    proxyIdx = (proxyIdx + 1) % proxyList.length;
    browser.storage.local.set({ proxyIdx });
    const p = proxyList[proxyIdx];

    fillProxyFields(p);
    document.getElementById("quickProxy").value = `${p.host}:${p.port}:${p.username}:${p.password}`;
    document.getElementById("proxyCounter").textContent = `${proxyIdx + 1}/${proxyList.length}`;

    // Auto-apply to tab
    const type = document.getElementById("proxyType").value;
    setStatus("proxyStatus", `⏳ ${type.toUpperCase()} ${p.host}:${p.port}...`, "");
    browser.runtime.sendMessage({
        action: "setTabProxy", tabId: currentTabId,
        host: p.host, port: p.port, username: p.username, password: p.password, type
    }, (resp) => {
        if (resp && resp.success) {
            document.getElementById("proxyDot").classList.add("on");
            setStatus("proxyStatus", `✓ ${type.toUpperCase()} ${p.host}:${p.port} → tab #${currentTabId}`, "ok");
        }
    });
});

function fillProxyFields(p) {
    document.getElementById("proxyHost").value = p.host || "";
    document.getElementById("proxyPort").value = p.port || "";
    document.getElementById("proxyUser").value = p.username || "";
    document.getElementById("proxyPass").value = p.password || "";
    document.getElementById("quickProxy").value = [p.host, p.port, p.username, p.password].filter(Boolean).join(":");
}

// Quick apply single proxy from input
document.getElementById("btnApplyProxy").addEventListener("click", () => {
    const raw = document.getElementById("quickProxy").value.trim();
    if (!raw) { setStatus("proxyStatus", "Paste a proxy first", "err"); return; }
    const parts = raw.split(":");
    if (parts.length < 2) { setStatus("proxyStatus", "Format: host:port:user:pass", "err"); return; }
    const [host, port, username, password] = [parts[0], parts[1], parts[2] || "", parts[3] || ""];
    const type = document.getElementById("proxyType").value;

    // Fill detail fields
    document.getElementById("proxyHost").value = host;
    document.getElementById("proxyPort").value = port;
    document.getElementById("proxyUser").value = username;
    document.getElementById("proxyPass").value = password;

    setStatus("proxyStatus", `⏳ Applying ${type.toUpperCase()} ${host}:${port}...`, "");

    browser.runtime.sendMessage({ action: "setTabProxy", tabId: currentTabId, host, port, username, password, type }, (resp) => {
        if (resp && resp.success) {
            document.getElementById("proxyDot").classList.add("on");
            setStatus("proxyStatus", `✓ ${type.toUpperCase()} ${host}:${port} → tab #${currentTabId}`, "ok");
            browser.storage.local.set({ lastProxy: raw });
        }
    });
});

document.getElementById("btnConnect").addEventListener("click", () => {
    const host = document.getElementById("proxyHost").value.trim();
    const port = document.getElementById("proxyPort").value.trim();
    const username = document.getElementById("proxyUser").value.trim();
    const password = document.getElementById("proxyPass").value.trim();
    const type = document.getElementById("proxyType").value;
    if (!host || !port) { setStatus("proxyStatus", "Fill host & port", "err"); return; }
    browser.runtime.sendMessage({ action: "setTabProxy", tabId: currentTabId, host, port, username, password, type }, (resp) => {
        if (resp && resp.success) {
            document.getElementById("proxyDot").classList.add("on");
            setStatus("proxyStatus", `✓ Proxy → tab #${currentTabId}`, "ok");
        }
    });
});

document.getElementById("btnDisconnect").addEventListener("click", () => {
    browser.runtime.sendMessage({ action: "clearTabProxy", tabId: currentTabId }, () => {
        document.getElementById("proxyDot").classList.remove("on");
        setStatus("proxyStatus", "Proxy removed", "ok");
    });
});

// ==================== SESSION RESET ====================

// ==================== ⚡ NEXT (ALL IN ONE) ====================

document.getElementById("btnNext").addEventListener("click", () => {
    setStatus("resetStatus", "⚡ Resetting...", "");

    browser.runtime.sendMessage({ action: "resetSession", tabId: currentTabId }, (resp) => {
        if (!resp || !resp.success) {
            setStatus("resetStatus", `Error: ${resp?.error || "unknown"}`, "err");
            return;
        }

        // 1. Next account + copy username to clipboard
        if (accounts.length > 0) {
            selectedAccIdx = (selectedAccIdx + 1) % accounts.length;
            selectAccount(selectedAccIdx);
            const acc = accounts[selectedAccIdx];
            navigator.clipboard.writeText(acc.username);
        }

        // 2. Next proxy
        let proxyToApply = null;
        if (proxyList.length > 0) {
            proxyIdx = (proxyIdx + 1) % proxyList.length;
            browser.storage.local.set({ proxyIdx });
            proxyToApply = proxyList[proxyIdx];
            fillProxyFields(proxyToApply);
            document.getElementById("proxyCounter").textContent = `${proxyIdx + 1}/${proxyList.length}`;
        }

        // 3. Wait 1.5s for proxy to be ready, then open tab
        const accName = selectedAccIdx >= 0 ? `@${accounts[selectedAccIdx].username}` : "";
        const proxyInfo = proxyToApply ? `proxy ${proxyIdx + 1}/${proxyList.length}` : "no proxy";
        setStatus("resetStatus", `⏳ ${accName} + ${proxyInfo} — connecting proxy...`, "");

        setTimeout(() => {
            // Open in a different window (not the extension window)
            browser.windows.getAll().then(wins => {
                const extWinId = extensionWindowId || browser.windows.WINDOW_ID_CURRENT;
                const mainWin = wins.find(w => w.id !== extWinId && w.type === "normal");

                const createOpts = { url: "https://x.com/i/flow/login", active: true };
                if (mainWin) {
                    createOpts.windowId = mainWin.id;
                }

                browser.tabs.create(createOpts).then((newTab) => {
                    currentTabId = newTab.id;
                    document.getElementById("tabInfo").innerHTML =
                        `Tab #${currentTabId}: <strong>x.com/i/flow/login</strong>`;

                    // Focus the main window
                    if (mainWin) {
                        browser.windows.update(mainWin.id, { focused: true });
                    }

                    // Apply proxy to new tab (no reload — tab is fresh)
                    if (proxyToApply) {
                        const type = document.getElementById("proxyType").value;
                        browser.runtime.sendMessage({
                            action: "setTabProxy", tabId: currentTabId,
                            host: proxyToApply.host, port: proxyToApply.port,
                            username: proxyToApply.username, password: proxyToApply.password,
                            type, noReload: true
                        });
                        document.getElementById("proxyDot").classList.add("on");
                    }

                    document.getElementById("cookieOutput")?.classList.remove("visible");
                    renderAccountList();
                    setStatus("resetStatus", `✓ ${accName} copied + ${proxyInfo} → ready!`, "ok");
                });
            });
        }, 1500);
    });
});

// Reset only (no account/proxy cycling)
document.getElementById("btnReset").addEventListener("click", () => {
    setStatus("resetStatus", "Clearing...", "");
    browser.runtime.sendMessage({ action: "resetSession", tabId: currentTabId }, (resp) => {
        if (resp && resp.success) {
            document.getElementById("proxyDot").classList.remove("on");
            browser.tabs.create({ url: "https://x.com/i/flow/login" }).then((newTab) => {
                browser.tabs.remove(currentTabId);
                currentTabId = newTab.id;
                setStatus("resetStatus", "✓ Reset done, fresh tab", "ok");
            });
        } else {
            setStatus("resetStatus", `Error: ${resp?.error || "unknown"}`, "err");
        }
    });
});

// ==================== COOKIES: EXTRACT & SAVE ====================

let batchLines = [];

document.getElementById("btnExtractSave").addEventListener("click", () => {
    browser.runtime.sendMessage({ action: "getCookies" }, (cookies) => {
        const authToken = cookies.auth_token || "";
        const ct0 = cookies.ct0 || "";
        if (!authToken && !ct0) { setStatus("cookieStatus", "No cookies — log in first!", "err"); return; }

        lastCookies = { auth_token: authToken, ct0 };
        saveCounter++;
        browser.storage.local.set({ saveCounter });

        // Build line
        const acc = selectedAccIdx >= 0 ? accounts[selectedAccIdx] : null;
        const accInfo = acc ? `${acc.username} ${acc.password}` : "log pass";
        const line = `${saveCounter}. auth_token=${authToken} ct0=${ct0} ${accInfo}`;

        // Add to batch
        batchLines.push(line);
        browser.storage.local.set({ batchLines });

        // Show in UI
        const box = document.getElementById("cookieOutput");
        box.innerHTML = `<span class="ck">auth_token:</span> <span class="cv">${authToken.substring(0, 20)}...</span><br><span class="ck">ct0:</span> <span class="cv">${ct0.substring(0, 20)}...</span>`;
        box.classList.add("visible");
        document.getElementById("btnCopyJson").style.display = "block";
        document.getElementById("btnCopyLine").style.display = "block";
        document.getElementById("btnDownloadBatch").style.display = "block";
        document.getElementById("batchCounter").textContent = `saved: ${batchLines.length}`;

        // Auto-save batch file
        const date = new Date().toISOString().split("T")[0];
        const filename = `handshake/${date}.txt`;
        const content = batchLines.join("\n");

        browser.runtime.sendMessage({
            action: "saveCookieFile",
            content: content,
            filename: filename
        }, (resp) => {
            if (resp && resp.success) {
                // Mark account as done
                if (selectedAccIdx >= 0) {
                    doneAccounts.add(selectedAccIdx);
                    browser.storage.local.set({ doneAccounts: [...doneAccounts] });
                    renderAccountList();
                }
                setStatus("cookieStatus", `✓ #${saveCounter} saved (${batchLines.length} total)`, "ok");
            } else {
                setStatus("cookieStatus", `Save error: ${resp?.error || "unknown"}`, "err");
            }
        });
    });
});

document.getElementById("btnCopyJson").addEventListener("click", () => {
    if (!lastCookies) return;
    navigator.clipboard.writeText(JSON.stringify(lastCookies, null, 2));
    setStatus("cookieStatus", "✓ JSON copied!", "ok");
});

document.getElementById("btnCopyLine").addEventListener("click", () => {
    if (!lastCookies) return;
    navigator.clipboard.writeText(`auth_token=${lastCookies.auth_token};ct0=${lastCookies.ct0}`);
    setStatus("cookieStatus", "✓ Line copied!", "ok");
});

document.getElementById("btnDownloadBatch").addEventListener("click", () => {
    if (batchLines.length === 0) return;
    const date = new Date().toISOString().split("T")[0];
    const content = batchLines.join("\n");
    const filename = `handshake/${date}_all.txt`;
    browser.runtime.sendMessage({
        action: "saveCookieFile", content, filename
    }, (resp) => {
        if (resp && resp.success) {
            setStatus("cookieStatus", `✓ Batch file: ${batchLines.length} accounts`, "ok");
        }
    });
});

// ==================== UTILS ====================

function setStatus(id, text, cls) {
    const el = document.getElementById(id);
    el.textContent = text;
    el.className = "status " + (cls || "");
}

// Smart paste toggle
const chk = document.getElementById("chkSmartPaste");
browser.storage.local.get(["clipChainEnabled"], (data) => {
    chk.checked = !!data.clipChainEnabled;
});
chk.addEventListener("change", () => {
    browser.storage.local.set({ clipChainEnabled: chk.checked });
});

// Open as separate window
let extensionWindowId = null;
document.getElementById("btnPin").addEventListener("click", () => {
    browser.windows.create({
        url: browser.runtime.getURL("popup.html"),
        type: "popup",
        width: 420,
        height: 700
    }).then(win => {
        extensionWindowId = win.id;
    });
    window.close();
});

// Detect if opened as a full tab (not popup)
const isInTab = window.innerWidth > 400;
if (isInTab) {
    document.body.classList.add("in-tab");
    document.getElementById("btnPin").style.display = "none";
}

init();
