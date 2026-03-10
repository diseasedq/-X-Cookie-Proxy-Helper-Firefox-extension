// Smart Clipboard Chain for x.com
// Listens for paste events and auto-cycles: username → password → 2FA → extract+save+next
// Communicates with background.js via messages

(function () {
    "use strict";

    let pasteStep = 0; // 0=username pasted, ready for password; 1=password pasted, ready for 2FA; 2=2FA pasted, extract

    // Listen for paste events on x.com
    document.addEventListener("paste", () => {
        // Small delay to let the paste complete
        setTimeout(() => {
            browser.storage.local.get(["savedAccounts", "selectedAccIdx", "clipChainEnabled"], (data) => {
                if (!data.clipChainEnabled) return;
                if (!data.savedAccounts || data.selectedAccIdx < 0) return;

                const acc = data.savedAccounts[data.selectedAccIdx];
                if (!acc) return;

                pasteStep++;

                if (pasteStep === 1) {
                    // Username was just pasted → put password in clipboard
                    navigator.clipboard.writeText(acc.password).then(() => {
                        showToast("📋 Password ready → Ctrl+V");
                    });
                } else if (pasteStep === 2) {
                    // Password was just pasted → generate 2FA and put in clipboard
                    if (acc.mfa && acc.mfa.length > 5) {
                        // Generate TOTP inline
                        generateTOTPInline(acc.mfa).then(code => {
                            navigator.clipboard.writeText(code).then(() => {
                                showToast("🔑 2FA ready → Ctrl+V");
                            });
                        });
                    } else {
                        showToast("⚠️ No 2FA secret");
                        pasteStep = 0;
                    }
                } else if (pasteStep === 3) {
                    // 2FA pasted → wait random 10-15s so user can browse, then extract+save
                    const delay = Math.floor(Math.random() * 6 + 10); // 10-15 seconds
                    showToast(`🕐 ${delay}s — scroll around, like some tweets...`);
                    pasteStep = 0;

                    // Countdown
                    let remaining = delay;
                    const countdown = setInterval(() => {
                        remaining--;
                        if (remaining > 0) {
                            showToast(`🕐 ${remaining}s — extracting cookies soon...`);
                        } else {
                            clearInterval(countdown);
                            showToast("🍪 Extracting cookies...");
                            waitForLoginThenSave();
                        }
                    }, 1000);
                }
            });
        }, 300);
    });

    // Wait for auth_token cookie to appear, then trigger save + next
    function waitForLoginThenSave() {
        let attempts = 0;
        const check = setInterval(() => {
            attempts++;
            if (attempts > 60) { // 30 seconds max
                clearInterval(check);
                showToast("⚠️ Login timeout");
                return;
            }
            browser.runtime.sendMessage({ action: "getCookies" }, (cookies) => {
                if (cookies && cookies.auth_token && cookies.ct0) {
                    clearInterval(check);
                    // Trigger extract+save via background
                    browser.runtime.sendMessage({ action: "autoExtractSave" }, (resp) => {
                        if (resp && resp.success) {
                            showToast(`✅ Saved #${resp.count} → opening next...`);
                            // Auto-trigger next after short delay
                            setTimeout(() => {
                                browser.runtime.sendMessage({ action: "triggerNext" });
                            }, 1500);
                        }
                    });
                }
            });
        }, 500);
    }

    // Inline TOTP generation (same as totp.js but self-contained)
    async function generateTOTPInline(secret) {
        const base32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
        let bits = "", bytes = [];
        for (const c of secret.toUpperCase().replace(/[^A-Z2-7]/g, "")) {
            bits += base32.indexOf(c).toString(2).padStart(5, "0");
        }
        for (let i = 0; i + 8 <= bits.length; i += 8) {
            bytes.push(parseInt(bits.substring(i, i + 8), 2));
        }
        const key = await crypto.subtle.importKey("raw", new Uint8Array(bytes), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
        const time = Math.floor(Date.now() / 30000);
        const msg = new Uint8Array(8);
        let t = time;
        for (let i = 7; i >= 0; i--) { msg[i] = t & 0xff; t >>= 8; }
        const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg));
        const offset = sig[sig.length - 1] & 0x0f;
        const code = ((sig[offset] & 0x7f) << 24 | sig[offset + 1] << 16 | sig[offset + 2] << 8 | sig[offset + 3]) % 1000000;
        return code.toString().padStart(6, "0");
    }

    // Toast notification
    function showToast(msg) {
        let toast = document.getElementById("xhelper-toast");
        if (!toast) {
            toast = document.createElement("div");
            toast.id = "xhelper-toast";
            toast.style.cssText = `
                position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
                background: #1a1a2e; color: #fff; padding: 10px 20px; border-radius: 8px;
                font-size: 14px; z-index: 999999; border: 1px solid #1d9bf0;
                box-shadow: 0 4px 20px rgba(29,155,240,0.3); transition: opacity 0.3s;
                font-family: -apple-system, BlinkMacSystemFont, sans-serif;
            `;
            document.body.appendChild(toast);
        }
        toast.textContent = msg;
        toast.style.opacity = "1";
        clearTimeout(toast._timer);
        toast._timer = setTimeout(() => { toast.style.opacity = "0"; }, 3000);
    }

    // Reset paste step when page navigates
    window.addEventListener("load", () => { pasteStep = 0; });

    // Check if chain is enabled
    browser.storage.local.get(["clipChainEnabled"], (data) => {
        if (data.clipChainEnabled) {
            showToast("⛓ Smart paste active");
        }
    });
})();
