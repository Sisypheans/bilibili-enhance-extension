// ==================== WBI 签名相关 ====================

function md5Hex(str) {
    function add32(a, b) { return (a & 0x7FFFFFFF) + (b & 0x7FFFFFFF) ^ (a & 0x80000000) ^ (b & 0x80000000); }
    function bitRol(n, c) { return (n << c) | (n >>> (32 - c)); }
    function cmn(q, a, b, x, s, t) { return add32(bitRol(add32(add32(a, q), add32(x, t)), s), b); }
    function ff(a, b, c, d, x, s, t) { return cmn((b & c) | ((~b) & d), a, b, x, s, t); }
    function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & (~d)), a, b, x, s, t); }
    function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
    function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | (~d)), a, b, x, s, t); }
    str = unescape(encodeURIComponent(str));
    const n = str.length;
    const state = [1732584193, -271733879, -1732584194, 271733878];
    const nWords = (((n + 8) >> 6) + 1) << 4;
    const x = new Array(nWords).fill(0);
    for (let i = 0; i < n; i++) {
        x[i >> 2] |= str.charCodeAt(i) << ((i % 4) << 3);
    }
    x[n >> 2] |= 0x80 << ((n % 4) << 3);
    x[nWords - 2] = n * 8;
    x[nWords - 1] = Math.floor(n / 0x20000000);
    for (let k = 0; k < x.length; k += 16) {
        const aa = state[0], bb = state[1], cc = state[2], dd = state[3];
        state[0] = ff(state[0], state[1], state[2], state[3], x[k + 0], 7, -680876936);
        state[3] = ff(state[3], state[0], state[1], state[2], x[k + 1], 12, -389564586);
        state[2] = ff(state[2], state[3], state[0], state[1], x[k + 2], 17, 606105819);
        state[1] = ff(state[1], state[2], state[3], state[0], x[k + 3], 22, -1044525330);
        state[0] = ff(state[0], state[1], state[2], state[3], x[k + 4], 7, -176418897);
        state[3] = ff(state[3], state[0], state[1], state[2], x[k + 5], 12, 1200080426);
        state[2] = ff(state[2], state[3], state[0], state[1], x[k + 6], 17, -1473231341);
        state[1] = ff(state[1], state[2], state[3], state[0], x[k + 7], 22, -45705983);
        state[0] = ff(state[0], state[1], state[2], state[3], x[k + 8], 7, 1770035416);
        state[3] = ff(state[3], state[0], state[1], state[2], x[k + 9], 12, -1958414417);
        state[2] = ff(state[2], state[3], state[0], state[1], x[k + 10], 17, -42063);
        state[1] = ff(state[1], state[2], state[3], state[0], x[k + 11], 22, -1990404162);
        state[0] = ff(state[0], state[1], state[2], state[3], x[k + 12], 7, 1804603682);
        state[3] = ff(state[3], state[0], state[1], state[2], x[k + 13], 12, -40341101);
        state[2] = ff(state[2], state[3], state[0], state[1], x[k + 14], 17, -1502002290);
        state[1] = ff(state[1], state[2], state[3], state[0], x[k + 15], 22, 1236535329);
        state[0] = gg(state[0], state[1], state[2], state[3], x[k + 1], 5, -165796510);
        state[3] = gg(state[3], state[0], state[1], state[2], x[k + 6], 9, -1069501632);
        state[2] = gg(state[2], state[3], state[0], state[1], x[k + 11], 14, 643717713);
        state[1] = gg(state[1], state[2], state[3], state[0], x[k + 0], 20, -373897302);
        state[0] = gg(state[0], state[1], state[2], state[3], x[k + 5], 5, -701558691);
        state[3] = gg(state[3], state[0], state[1], state[2], x[k + 10], 9, 38016083);
        state[2] = gg(state[2], state[3], state[0], state[1], x[k + 15], 14, -660478335);
        state[1] = gg(state[1], state[2], state[3], state[0], x[k + 4], 20, -405537848);
        state[0] = gg(state[0], state[1], state[2], state[3], x[k + 9], 5, 568446438);
        state[3] = gg(state[3], state[0], state[1], state[2], x[k + 14], 9, -1019803690);
        state[2] = gg(state[2], state[3], state[0], state[1], x[k + 3], 14, -187363961);
        state[1] = gg(state[1], state[2], state[3], state[0], x[k + 8], 20, 1163531501);
        state[0] = gg(state[0], state[1], state[2], state[3], x[k + 13], 5, -1444681467);
        state[3] = gg(state[3], state[0], state[1], state[2], x[k + 2], 9, -51403784);
        state[2] = gg(state[2], state[3], state[0], state[1], x[k + 7], 14, 1735328473);
        state[1] = gg(state[1], state[2], state[3], state[0], x[k + 12], 20, -1926607734);
        state[0] = hh(state[0], state[1], state[2], state[3], x[k + 5], 4, -378558);
        state[3] = hh(state[3], state[0], state[1], state[2], x[k + 8], 11, -2022574463);
        state[2] = hh(state[2], state[3], state[0], state[1], x[k + 11], 16, 1839030562);
        state[1] = hh(state[1], state[2], state[3], state[0], x[k + 14], 23, -35309556);
        state[0] = hh(state[0], state[1], state[2], state[3], x[k + 1], 4, -1530992060);
        state[3] = hh(state[3], state[0], state[1], state[2], x[k + 4], 11, 1272893353);
        state[2] = hh(state[2], state[3], state[0], state[1], x[k + 7], 16, -155497632);
        state[1] = hh(state[1], state[2], state[3], state[0], x[k + 10], 23, -1094730640);
        state[0] = hh(state[0], state[1], state[2], state[3], x[k + 13], 4, 681279174);
        state[3] = hh(state[3], state[0], state[1], state[2], x[k + 0], 11, -358537222);
        state[2] = hh(state[2], state[3], state[0], state[1], x[k + 3], 16, -722521979);
        state[1] = hh(state[1], state[2], state[3], state[0], x[k + 6], 23, 76029189);
        state[0] = hh(state[0], state[1], state[2], state[3], x[k + 9], 4, -640364487);
        state[3] = hh(state[3], state[0], state[1], state[2], x[k + 12], 11, -421815835);
        state[2] = hh(state[2], state[3], state[0], state[1], x[k + 15], 16, 530742520);
        state[1] = hh(state[1], state[2], state[3], state[0], x[k + 2], 23, -995338651);
        state[0] = ii(state[0], state[1], state[2], state[3], x[k + 0], 6, -198630844);
        state[3] = ii(state[3], state[0], state[1], state[2], x[k + 7], 10, 1126891415);
        state[2] = ii(state[2], state[3], state[0], state[1], x[k + 14], 15, -1416354905);
        state[1] = ii(state[1], state[2], state[3], state[0], x[k + 5], 21, -57434055);
        state[0] = ii(state[0], state[1], state[2], state[3], x[k + 12], 6, 1700485571);
        state[3] = ii(state[3], state[0], state[1], state[2], x[k + 3], 10, -1894986606);
        state[2] = ii(state[2], state[3], state[0], state[1], x[k + 10], 15, -1051523);
        state[1] = ii(state[1], state[2], state[3], state[0], x[k + 1], 21, -2054922799);
        state[0] = ii(state[0], state[1], state[2], state[3], x[k + 8], 6, 1873313359);
        state[3] = ii(state[3], state[0], state[1], state[2], x[k + 15], 10, -30611744);
        state[2] = ii(state[2], state[3], state[0], state[1], x[k + 6], 15, -1560198380);
        state[1] = ii(state[1], state[2], state[3], state[0], x[k + 13], 21, 1309151649);
        state[0] = ii(state[0], state[1], state[2], state[3], x[k + 4], 6, -145523070);
        state[3] = ii(state[3], state[0], state[1], state[2], x[k + 11], 10, -1120210379);
        state[2] = ii(state[2], state[3], state[0], state[1], x[k + 2], 15, 718787259);
        state[1] = ii(state[1], state[2], state[3], state[0], x[k + 9], 21, -343485551);
        state[0] = add32(state[0], aa);
        state[1] = add32(state[1], bb);
        state[2] = add32(state[2], cc);
        state[3] = add32(state[3], dd);
    }
    const hex = '0123456789abcdef';
    let result = '';
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
            const v = state[i] >>> (j * 8) & 0xff;
            result += hex.charAt(v >>> 4) + hex.charAt(v & 0x0f);
        }
    }
    return result;
}

const WBI_MIXIN_KEY_ENC_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
    27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
    37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
    22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52
];

let _wbiKeys = null;
let _wbiKeysExpireTime = 0;

function getMixinKey(orig) {
    return WBI_MIXIN_KEY_ENC_TAB.map(n => orig[n]).join('').slice(0, 32);
}

function encWbi(params, img_key, sub_key) {
    const mixin_key = getMixinKey(img_key + sub_key);
    const curr_time = Math.round(Date.now() / 1000);
    const chr_filter = /[!'()\*]/g;
    Object.assign(params, { wts: curr_time });
    const query = Object.keys(params)
        .sort()
        .map(key => {
            const value = params[key].toString().replace(chr_filter, '');
            return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
        })
        .join('&');
    params.w_rid = md5Hex(query + mixin_key);
    return params;
}

async function getWbiKeys() {
    const now = Date.now();
    if (_wbiKeys && now < _wbiKeysExpireTime) return _wbiKeys;

    try {
        const response = await fetch('https://api.bilibili.com/x/web-interface/nav', {
            headers: { 'Referer': 'https://www.bilibili.com/' }
        });
        const data = await response.json();
        const img_url = data.data.wbi_img.img_url;
        const sub_url = data.data.wbi_img.sub_url;
        _wbiKeys = {
            img_key: img_url.slice(img_url.lastIndexOf('/') + 1, img_url.lastIndexOf('.')),
            sub_key: sub_url.slice(sub_url.lastIndexOf('/') + 1, sub_url.lastIndexOf('.'))
        };
        _wbiKeysExpireTime = now + 30 * 60 * 1000; // 缓存30分钟
        return _wbiKeys;
    } catch (e) {
        throw new Error('WBI密钥获取失败: ' + e.message);
    }
}

async function getWbiSignedUrl(baseUrl, params) {
    const { img_key, sub_key } = await getWbiKeys();
    const signed = encWbi({ ...params }, img_key, sub_key);
    const query = Object.keys(signed)
        .sort()
        .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(signed[key])}`)
        .join('&');
    return `${baseUrl}?${query}`;
}

// ==================== 消息处理 ====================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'fetch') {
        handleFetch(message, sendResponse);
        return true; // 异步响应
    }
    if (message.type === 'wbi_sign') {
        handleWbiSign(message, sendResponse);
        return true;
    }
});

async function handleFetch(message, sendResponse) {
    const { url, options = {} } = message;
    try {
        const response = await fetch(url, {
            ...options,
            headers: {
                'Referer': 'https://www.bilibili.com/',
                ...(options.headers || {})
            }
        });

        const contentType = response.headers.get('content-type') || '';
        let body;

        if (message.responseType === 'arraybuffer') {
            const buffer = await response.arrayBuffer();
            body = Array.from(new Uint8Array(buffer));
        } else if (message.responseType === 'json' || contentType.includes('application/json')) {
            body = await response.json();
        } else {
            body = await response.text();
        }

        sendResponse({
            ok: response.ok,
            status: response.status,
            body,
            contentType
        });
    } catch (e) {
        sendResponse({ ok: false, error: e.message });
    }
}

async function handleWbiSign(message, sendResponse) {
    const { baseUrl, params } = message;
    try {
        const signedUrl = await getWbiSignedUrl(baseUrl, params);
        sendResponse({ ok: true, signedUrl });
    } catch (e) {
        sendResponse({ ok: false, error: e.message });
    }
}
