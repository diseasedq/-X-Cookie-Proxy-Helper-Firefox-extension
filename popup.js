// Popup logic — accounts, proxy, cookies + auto-save

let currentTabId = null;
let lastCookies = null;
let accounts = [];
let selectedAccIdx = -1;
let saveCounter = 0;

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

    browser.storage.local.get(["savedAccounts", "lastProxy", "saveCounter", "selectedAccIdx"], (data) => {
        if (data.savedAccounts && data.savedAccounts.length > 0) {
            accounts = data.savedAccounts;
            if (data.selectedAccIdx >= 0 && data.selectedAccIdx < accounts.length) {
                selectAccount(data.selectedAccIdx);
            }
            renderAccountList();
        }
        if (data.lastProxy) fillProxyFields(data.lastProxy);
        if (data.saveCounter) saveCounter = data.saveCounter;
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
        div.className = "acc-item" + (i === selectedAccIdx ? " active" : "");
        div.innerHTML = `<div class="acc-name">@${acc.username}</div><div class="acc-email">${acc.email || "no email"}</div>`;
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

// ==================== PROXY ====================

function fillProxyFields(p) {
    document.getElementById("proxyHost").value = p.host || "";
    document.getElementById("proxyPort").value = p.port || "";
    document.getElementById("proxyUser").value = p.username || "";
    document.getElementById("proxyPass").value = p.password || "";
    document.getElementById("proxyType").value = p.type || "http";
    if (p.host && p.port) {
        document.getElementById("quickProxy").value = [p.host, p.port, p.username, p.password].filter(Boolean).join(":");
    }
}

document.getElementById("quickProxy").addEventListener("input", (e) => {
    const parts = e.target.value.trim().split(":");
    if (parts.length >= 2) {
        document.getElementById("proxyHost").value = parts[0];
        document.getElementById("proxyPort").value = parts[1];
        if (parts.length >= 4) {
            document.getElementById("proxyUser").value = parts[2];
            document.getElementById("proxyPass").value = parts[3];
        }
    }
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
            browser.storage.local.set({ lastProxy: { host, port, username, password, type } });
        }
    });
});

document.getElementById("btnDisconnect").addEventListener("click", () => {
    browser.runtime.sendMessage({ action: "clearTabProxy", tabId: currentTabId }, () => {
        document.getElementById("proxyDot").classList.remove("on");
        setStatus("proxyStatus", "Proxy removed", "ok");
    });
});

// ==================== COOKIES ====================

document.getElementById("btnGetCookies").addEventListener("click", () => {
    browser.runtime.sendMessage({ action: "getCookies" }, (cookies) => {
        const authToken = cookies.auth_token || "";
        const ct0 = cookies.ct0 || "";
        if (!authToken && !ct0) { setStatus("cookieStatus", "No X.com cookies. Log in first!", "err"); return; }
        lastCookies = { auth_token: authToken, ct0 };

        const box = document.getElementById("cookieOutput");
        box.innerHTML = `<span class="ck">auth_token:</span> <span class="cv">${authToken || "—"}</span><br><span class="ck">ct0:</span> <span class="cv">${ct0 || "—"}</span>`;
        box.classList.add("visible");
        document.getElementById("btnCopyJson").style.display = "block";
        document.getElementById("btnCopyLine").style.display = "block";
        document.getElementById("btnSaveFile").style.display = "block";
        setStatus("cookieStatus", "✓ Extracted", "ok");
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

// ==================== SAVE TO FILE ====================

document.getElementById("btnSaveFile").addEventListener("click", () => {
    if (!lastCookies) return;

    saveCounter++;
    browser.storage.local.set({ saveCounter });

    const now = new Date();
    const date = now.toISOString().split("T")[0]; // YYYY-MM-DD

    // Build line: N. auth_token=xxx ct0=xxx log pass
    const acc = selectedAccIdx >= 0 ? accounts[selectedAccIdx] : null;
    const accInfo = acc ? `${acc.username} ${acc.password}` : "log pass";

    const line = `${saveCounter}. auth_token=${lastCookies.auth_token} ct0=${lastCookies.ct0} ${accInfo}`;

    const filename = `handshake/${date}_${saveCounter}.txt`;

    browser.runtime.sendMessage({
        action: "saveCookieFile",
        content: line,
        filename: filename
    }, (resp) => {
        if (resp && resp.success) {
            setStatus("cookieStatus", `✓ Saved → ${filename}`, "ok");
        } else {
            setStatus("cookieStatus", `Save error: ${resp?.error || "unknown"}`, "err");
        }
    });
});

// ==================== UTILS ====================

function setStatus(id, text, cls) {
    const el = document.getElementById(id);
    el.textContent = text;
    el.className = "status " + (cls || "");
}

// Open as tab button
document.getElementById("btnPin").addEventListener("click", () => {
    browser.tabs.create({ url: browser.runtime.getURL("popup.html") });
    window.close();
});

// If opened as a tab, add class for wider layout
if (window.location.href.startsWith("moz-extension://")) {
    const params = new URLSearchParams(window.location.search);
    if (!window.opener && document.referrer === "") {
        document.body.classList.add("in-tab");
        document.getElementById("btnPin").style.display = "none";
    }
}

init();
