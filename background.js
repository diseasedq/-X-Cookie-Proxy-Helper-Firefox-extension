// Dynamic proxy management — listener only active when proxy is set
let activeProxy = null;
let proxyListenerActive = false;

function proxyRequestHandler(requestInfo) {
    if (!activeProxy) return;
    const isSocks = activeProxy.type === "socks";
    const info = {
        type: isSocks ? "socks" : "http",
        host: activeProxy.host,
        port: parseInt(activeProxy.port)
    };
    if (isSocks) {
        info.proxyDNS = true;
        if (activeProxy.username) {
            info.username = activeProxy.username;
            info.password = activeProxy.password || "";
        }
    }
    return info;
}

function authHandler(details) {
    if (activeProxy && details.isProxy && activeProxy.username) {
        return { authCredentials: { username: activeProxy.username, password: activeProxy.password || "" } };
    }
}

function enableProxy(proxy) {
    activeProxy = proxy;
    browser.storage.local.set({ activeProxy: proxy });
    if (!proxyListenerActive) {
        browser.proxy.onRequest.addListener(proxyRequestHandler, { urls: ["<all_urls>"] });
        browser.webRequest.onAuthRequired.addListener(authHandler, { urls: ["<all_urls>"] }, ["blocking"]);
        proxyListenerActive = true;
    }
    console.log(`[PROXY ON] ${proxy.type}://${proxy.host}:${proxy.port}`);
}

function disableProxy() {
    activeProxy = null;
    browser.storage.local.remove("activeProxy");
    if (proxyListenerActive) {
        browser.proxy.onRequest.removeListener(proxyRequestHandler);
        browser.webRequest.onAuthRequired.removeListener(authHandler);
        proxyListenerActive = false;
    }
    console.log("[PROXY OFF]");
}

// Restore proxy on startup
browser.storage.local.get("activeProxy", (data) => {
    if (data.activeProxy) {
        enableProxy(data.activeProxy);
    }
});

browser.proxy.onError.addListener((error) => {
    console.error("Proxy error:", error.message);
});

// Message handler
browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {

    if (msg.action === "setProxy") {
        const { host, port, username, password, type } = msg;
        enableProxy({ host, port, username, password, type: type || "http" });
        sendResponse({ success: true });
        return;
    }

    if (msg.action === "clearProxy") {
        disableProxy();
        sendResponse({ success: true });
        return;
    }

    if (msg.action === "getProxy") {
        sendResponse({ proxy: activeProxy });
        return;
    }

    if (msg.action === "getCookies") {
        browser.cookies.getAll({ domain: ".x.com" }).then((cookies) => {
            const result = {};
            for (const c of cookies) result[c.name] = c.value;
            sendResponse(result);
        });
        return true;
    }

    if (msg.action === "saveCookieFile") {
        const { content, filename } = msg;
        const blob = new Blob([content], { type: "text/plain" });
        const url = URL.createObjectURL(blob);

        browser.downloads.download({
            url: url,
            filename: filename, // e.g. "handshake/2026-03-10_1.txt"
            saveAs: false,
            conflictAction: "overwrite"
        }).then((downloadId) => {
            sendResponse({ success: true, downloadId });
            // Clean up blob URL after download
            setTimeout(() => URL.revokeObjectURL(url), 5000);
        }).catch((err) => {
            sendResponse({ success: false, error: err.message });
        });
        return true;
    }

    if (msg.action === "resetSession") {
        // 1. Remove all x.com cookies
        Promise.all([
            browser.cookies.getAll({ domain: ".x.com" }),
            browser.cookies.getAll({ domain: ".twitter.com" })
        ]).then(([xCookies, twCookies]) => {
            const all = [...xCookies, ...twCookies];
            const removals = all.map(c =>
                browser.cookies.remove({ url: `https://${c.domain}${c.path}`, name: c.name })
            );
            return Promise.all(removals);
        }).then(() => {
            // 2. Clear cache + localStorage for x.com only
            return browser.browsingData.remove({
                hostnames: ["x.com", "twitter.com"]
            }, {
                cache: true,
                localStorage: true,
                indexedDB: true,
                serviceWorkers: true
            });
        }).then(() => {
            // 3. Done — keep proxy active
            sendResponse({ success: true });
        }).catch(err => {
            sendResponse({ success: false, error: err.message });
        });
        return true;
    }

    if (msg.action === "autoExtractSave") {
        // Called by content script after detecting successful login
        browser.cookies.getAll({ domain: ".x.com" }).then(cookies => {
            const cookieMap = {};
            for (const c of cookies) cookieMap[c.name] = c.value;
            const authToken = cookieMap.auth_token || "";
            const ct0 = cookieMap.ct0 || "";
            if (!authToken) { sendResponse({ success: false }); return; }

            return browser.storage.local.get(["savedAccounts", "selectedAccIdx", "saveCounter", "batchLines"]).then(data => {
                const counter = (data.saveCounter || 0) + 1;
                const acc = data.savedAccounts?.[data.selectedAccIdx];
                const accInfo = acc ? `${acc.username} ${acc.password}` : "log pass";
                const line = `${counter}. auth_token=${authToken} ct0=${ct0} ${accInfo}`;

                const batch = data.batchLines || [];
                batch.push(line);

                const date = new Date().toISOString().split("T")[0];
                const blob = new Blob([batch.join("\n")], { type: "text/plain" });
                const url = URL.createObjectURL(blob);

                return browser.downloads.download({
                    url, filename: `handshake/${date}.txt`, saveAs: false, conflictAction: "overwrite"
                }).then(() => {
                    // Mark account as done
                    const done = data.doneAccounts || [];
                    if (data.selectedAccIdx >= 0 && !done.includes(data.selectedAccIdx)) {
                        done.push(data.selectedAccIdx);
                    }
                    browser.storage.local.set({ saveCounter: counter, batchLines: batch, doneAccounts: done });
                    setTimeout(() => URL.revokeObjectURL(url), 5000);
                    sendResponse({ success: true, count: counter });
                });
            });
        }).catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    }
    if (msg.action === "triggerNext") {
        // Called by content script after auto-save completes
        // Reset session → cycle account/proxy → open new tab in main window
        Promise.all([
            browser.cookies.getAll({ domain: ".x.com" }),
            browser.cookies.getAll({ domain: ".twitter.com" })
        ]).then(([xc, tc]) => {
            const removals = [...xc, ...tc].map(c =>
                browser.cookies.remove({ url: `https://${c.domain}${c.path}`, name: c.name })
            );
            return Promise.all(removals);
        }).then(() => {
            return browser.browsingData.remove({}, { cache: true, localStorage: true, indexedDB: true, serviceWorkers: true });
        }).then(() => {
            return browser.storage.local.get(["savedAccounts", "selectedAccIdx", "savedProxies", "proxyIdx", "proxyType"]);
        }).then(data => {
            const accounts = data.savedAccounts || [];
            const proxies = data.savedProxies || [];
            const type = data.proxyType || "http";

            // Cycle account
            let accIdx = (data.selectedAccIdx >= 0 ? data.selectedAccIdx + 1 : 0) % (accounts.length || 1);
            // Cycle proxy
            let pIdx = (data.proxyIdx >= 0 ? data.proxyIdx + 1 : 0) % (proxies.length || 1);

            browser.storage.local.set({ selectedAccIdx: accIdx, proxyIdx: pIdx });

            // Copy username
            const acc = accounts[accIdx];

            // Open in main window after delay
            setTimeout(() => {
                browser.windows.getAll().then(wins => {
                    const mainWin = wins.find(w => w.type === "normal");
                    const opts = { url: "https://x.com/i/flow/login", active: true };
                    if (mainWin) opts.windowId = mainWin.id;

                    browser.tabs.create(opts).then(newTab => {
                        if (mainWin) browser.windows.update(mainWin.id, { focused: true });

                        // Apply proxy globally
                        const proxy = proxies[pIdx];
                        if (proxy) {
                            activeProxy = {
                                host: proxy.host, port: proxy.port,
                                username: proxy.username, password: proxy.password,
                                type: type
                            };
                        }
                        sendResponse({ success: true, tabId: newTab.id });
                    });
                });
            }, 1500);
        }).catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    }

    return false;
});
