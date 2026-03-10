// TOTP (Time-based One-Time Password) generator
// Pure JavaScript implementation using Web Crypto API

function base32Decode(encoded) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    encoded = encoded.replace(/[\s=-]+/g, '').toUpperCase();
    const bytes = [];
    let buffer = 0, bitsLeft = 0;
    for (const c of encoded) {
        const val = chars.indexOf(c);
        if (val === -1) continue;
        buffer = (buffer << 5) | val;
        bitsLeft += 5;
        if (bitsLeft >= 8) {
            bitsLeft -= 8;
            bytes.push((buffer >> bitsLeft) & 0xff);
        }
    }
    return new Uint8Array(bytes);
}

async function hmacSha1(key, message) {
    const cryptoKey = await crypto.subtle.importKey(
        'raw', key, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', cryptoKey, message);
    return new Uint8Array(sig);
}

async function generateTOTP(secret, period = 30, digits = 6) {
    if (!secret) return null;

    const key = base32Decode(secret);
    const time = Math.floor(Date.now() / 1000 / period);

    // Convert time to 8-byte big-endian
    const timeBytes = new Uint8Array(8);
    let t = time;
    for (let i = 7; i >= 0; i--) {
        timeBytes[i] = t & 0xff;
        t = Math.floor(t / 256);
    }

    const hash = await hmacSha1(key, timeBytes);

    // Dynamic truncation
    const offset = hash[hash.length - 1] & 0x0f;
    const code = (
        ((hash[offset] & 0x7f) << 24) |
        ((hash[offset + 1] & 0xff) << 16) |
        ((hash[offset + 2] & 0xff) << 8) |
        (hash[offset + 3] & 0xff)
    ) % (10 ** digits);

    return code.toString().padStart(digits, '0');
}

// Calculate seconds remaining until next code
function totpSecondsRemaining(period = 30) {
    return period - (Math.floor(Date.now() / 1000) % period);
}
