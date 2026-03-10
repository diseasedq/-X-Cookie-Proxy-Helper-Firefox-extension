// Per-tab proxy management + cookie save
// Firefox proxy.onRequest for per-tab routing

const tabProxies = {};

// Per-tab proxy routing
browser.proxy.onRequest.addListener(
    (requestInfo) => {
        const tabId = requestInfo.tabId;
        if (tabId > 0 && tabProxies[tabId]) {
            const p = tabProxies[tabId];
            return {
                type: p.type || "http",
                host: p.host,
                port: parseInt(p.port),
                username: p.username || undefined,
                password: p.password || undefined,
                proxyDNS: true
            };
        }
        return { type: "direct" };
    },
    { urls: ["<all_urls>"] }
);

browser.proxy.onError.addListener((error) => {
    console.error("Proxy error:", error.message);
});

browser.tabs.onRemoved.addListener((tabId) => {
    delete tabProxies[tabId];
});

// Message handler
browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {

    if (msg.action === "setTabProxy") {
        const { tabId, host, port, username, password, type } = msg;
        tabProxies[tabId] = { host, port, username, password, type: type || "http" };
        browser.tabs.reload(tabId);
        sendResponse({ success: true, tabId });
        return;
    }

    if (msg.action === "clearTabProxy") {
        delete tabProxies[msg.tabId];
        browser.tabs.reload(msg.tabId);
        sendResponse({ success: true });
        return;
    }

    if (msg.action === "getTabProxy") {
        sendResponse({ proxy: tabProxies[msg.tabId] || null });
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
            conflictAction: "uniquify"
        }).then((downloadId) => {
            sendResponse({ success: true, downloadId });
            // Clean up blob URL after download
            setTimeout(() => URL.revokeObjectURL(url), 5000);
        }).catch((err) => {
            sendResponse({ success: false, error: err.message });
        });
        return true;
    }

    return false;
});
