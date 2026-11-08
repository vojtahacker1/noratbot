const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(process.cwd(), 'chattranslate.json');

const DEFAULT_LANG = 'en';
const NO_TRANSLATE_TAG = 'notranslate'; // players with this tag don't receive translations
const OUT_LABEL = '[Translate]';        // also how we recognise (and ignore) our own output
const MAX_QUEUE = 8;                    // chat spam protection: extra messages are dropped
const TIMEOUT_MS = 8000;
const MAX_IN = 500;
const MAX_OUT = 1000;

module.exports = function chatTranslatePlugin(bot) {
    const state = { enabled: false, lang: DEFAULT_LANG };
    const queue = [];
    let busy = false;
    let lastErrLog = 0;

    // translate library state
    let lib = null;       // null = not tried yet, false = unavailable, function = ready
    let libAuto = true;   // flips to false if the library refuses from:'auto'

    function log(msg) {
        console.log(`[${bot.id}] [ChatTranslate] ${msg}`);
    }

    function logError(msg, err) {
        const now = Date.now();
        if (now - lastErrLog < 30000) return; // don't flood the console
        lastErrLog = now;
        console.error(`[${bot.id}] [ChatTranslate] ${msg}`, err?.message || err || '');
    }

    // ---------- persistence (per bot id, same style as filter.json) ----------

    function loadAll() {
        try {
            if (!fs.existsSync(STORE_PATH)) return {};
            const raw = fs.readFileSync(STORE_PATH, 'utf8');
            return raw.trim() ? JSON.parse(raw) : {};
        } catch (e) {
            console.error(`[${bot.id}] [ChatTranslate] load error:`, e);
            return {};
        }
    }

    function saveState() {
        try {
            const all = loadAll();
            all[bot.id] = { enabled: state.enabled, lang: state.lang };
            fs.writeFileSync(STORE_PATH, JSON.stringify(all, null, 4), 'utf8');
            return true;
        } catch (e) {
            console.error(`[${bot.id}] [ChatTranslate] save error:`, e);
            return false;
        }
    }

    const saved = loadAll()[bot.id];
    if (saved) {
        state.enabled = saved.enabled === true;
        if (typeof saved.lang === 'string' && saved.lang) state.lang = saved.lang;
    }

    // ---------- translation ----------

    async function loadLib() {
        if (lib !== null) return lib;
        try {
            const mod = await import('translate'); // works for both ESM and CJS builds
            const fn = mod.default || mod;
            lib = typeof fn === 'function' ? fn : false;
        } catch {
            lib = false;
            log("'translate' package not found (npm i translate), using the built-in Google endpoint instead");
        }
        return lib;
    }

    // Same endpoint the translate package uses for its google engine, but with sl=auto,
    // and it tells us which language it detected.
    async function googleTranslate(text, to) {
        const axios = require('axios');
        const res = await axios.get('https://translate.googleapis.com/translate_a/single', {
            params: { client: 'gtx', sl: 'auto', tl: to, dt: 't', q: text },
            timeout: TIMEOUT_MS
        });
        const data = res.data;
        const out = Array.isArray(data?.[0]) ? data[0].map(s => s?.[0]).filter(Boolean).join('') : '';
        return { text: out, from: typeof data?.[2] === 'string' ? data[2] : null };
    }

    async function translateText(text, to) {
        const fn = await loadLib();
        if (fn && libAuto) {
            try {
                const out = await fn(text, { from: 'auto', to });
                return { text: String(out || ''), from: null };
            } catch (e) {
                // If the library refuses 'auto' as a language, stop trying it.
                // Any failure falls through to the built-in endpoint for this message.
                if (/language|iso|639|auto/i.test(e?.message || '')) {
                    libAuto = false;
                    log("translate package doesn't accept from:'auto', using the built-in Google endpoint instead");
                }
            }
        }
        return googleTranslate(text, to);
    }

    function withTimeout(promise, ms) {
        let timer;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('translation timed out')), ms);
        });
        return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
    }

    function norm(s) {
        return String(s).normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
    }

    function sameLang(a, b) {
        return String(a).toLowerCase().split('-')[0] === String(b).toLowerCase().split('-')[0];
    }

    // ---------- chat parsing ----------

    function getPrefixes() {
        const cfg = bot.globalConfig?.bot || {};
        const raw = Array.isArray(cfg.prefixes) ? cfg.prefixes
            : Array.isArray(cfg.prefix) ? cfg.prefix
            : [cfg.prefix || 'nr:'];
        return raw.filter(p => typeof p === 'string' && p.length > 0).map(p => p.toLowerCase());
    }

    // "<Steve> hi", "[Rank] <Steve> hi", "Steve: hi"
    const CHAT_PATTERNS = [
        /^(?:\[[^\]]*\]\s*){0,3}<([^<>\s]{1,32})>\s*([\s\S]+)$/,
        /^(?:\[[^\]]*\]\s*){0,3}([^\s:<>[\]]{1,32}):\s*([\s\S]+)$/
    ];

    function parseChat(raw) {
        const line = raw.replace(/§[0-9a-fk-or]/gi, '').trim();
        if (!line) return null;

        // our own tellraw output comes back through chat: never translate it again
        if (line.startsWith(OUT_LABEL)) return null;

        let m = null;
        for (const re of CHAT_PATTERNS) {
            m = line.match(re);
            if (m) break;
        }
        if (!m) return null;

        const sender = m[1].trim();
        const text = m[2].trim().slice(0, MAX_IN);
        if (!sender || !text) return null;

        const botName = String(bot.config?.username || bot.username || '').toLowerCase();
        if (botName && sender.toLowerCase() === botName) return null;

        // must be a real player, so server/bot messages like "Foo: bar" are ignored
        if (typeof bot.playersAPI?.get === 'function') {
            if (!bot.playersAPI.get(sender)) return null;
        } else if (!/^\w{3,16}$/.test(sender)) {
            return null;
        }

        if (text.startsWith('/')) return null;
        const lower = text.toLowerCase();
        if (getPrefixes().some(p => lower.startsWith(p))) return null; // bot commands

        // nothing worth translating (only emoji/numbers/links)
        if (!/\p{L}/u.test(text.replace(/https?:\/\/\S+/gi, ''))) return null;

        return { sender, text };
    }

    // ---------- output ----------

    let labelCache = null;
    function label() {
        if (labelCache) return labelCache;
        try {
            const g = require('../utils/gradient').gradient(OUT_LABEL, '#f4fcff', '#238bff');
            if (Array.isArray(g) && g.length) return (labelCache = g);
        } catch { /* fall back to a plain label */ }
        return (labelCache = [{ text: OUT_LABEL, color: '#55aaff' }]);
    }

    function announce(job, translated, from) {
        if (!bot.core || typeof bot.core.run !== 'function') return false;

        const cleanOut = translated.replace(/§[0-9a-fk-or]/gi, '').slice(0, MAX_OUT);
        const hover = (from ? `Original (${from}): ` : 'Original: ') + job.text;

        const root = {
            text: '',
            extra: [
                ...label(),
                { text: ' ' },
                { text: job.sender, color: '#62d66b' },
                { text: ': ', color: 'gray' },
                { text: cleanOut, color: 'white' }
            ],
            hover_event: { action: 'show_text', value: { text: hover, color: 'gray' } }
        };

        return bot.core.run(`tellraw @a[tag=!${NO_TRANSLATE_TAG}] ${JSON.stringify(root)}`);
    }

    // ---------- queue (keeps message order, caps spam) ----------

    async function handle(job) {
        const result = await withTimeout(translateText(job.text, state.lang), TIMEOUT_MS);
        if (!result || !result.text) return;

        // already in the target language: nothing to announce
        if (result.from && sameLang(result.from, state.lang)) return;
        if (norm(result.text) === norm(job.text)) return;

        announce(job, result.text, result.from);
    }

    async function pump() {
        if (busy) return;
        busy = true;
        try {
            while (queue.length) {
                const job = queue.shift();
                if (!state.enabled) continue; // switched off while queued
                try {
                    await handle(job);
                } catch (e) {
                    logError('Translation failed:', e);
                }
            }
        } finally {
            busy = false;
        }
    }

    function onChat(raw) {
        if (!state.enabled || typeof raw !== 'string') return;
        const job = parseChat(raw);
        if (!job) return;
        if (queue.length >= MAX_QUEUE) return; // flood: drop
        queue.push(job);
        pump();
    }

    // If this plugin is ever initialised twice on the same bot, don't double-translate.
    if (bot.__chatTranslateHandler) bot.removeListener('chat_display', bot.__chatTranslateHandler);
    bot.__chatTranslateHandler = onChat;
    bot.on('chat_display', onChat);

    bot.on('bot:disconnect', () => { queue.length = 0; });
    bot.on('bot:destroy', () => {
        queue.length = 0;
        bot.removeListener('chat_display', onChat);
        if (bot.__chatTranslateHandler === onChat) delete bot.__chatTranslateHandler;
    });

    bot.chatTranslate = {
        tag: NO_TRANSLATE_TAG,

        isEnabled() {
            return state.enabled;
        },

        setEnabled(on) {
            state.enabled = !!on;
            if (!state.enabled) queue.length = 0;
            return saveState();
        },

        getLang() {
            return state.lang;
        },

        // "en", "cs", "pt-BR" ... returns false if it doesn't look like a language code
        setLang(code) {
            const m = String(code || '').trim().match(/^([a-z]{2,3})(?:-([a-z]{2}))?$/i);
            if (!m) return false;
            state.lang = m[2] ? `${m[1].toLowerCase()}-${m[2].toUpperCase()}` : m[1].toLowerCase();
            saveState();
            return true;
        }
    };
};