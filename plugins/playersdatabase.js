// port of PlayersDatabasePlugin + the IP querying part of PlayersPlugin
// IPs are queried by running essentials:seen <uuid> in a core command block and reading the
// block's LastOutput with an nbt query (core.runTracked). no chat involved
// data is kept in playersdb.json instead of MySQL

const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(process.cwd(), 'playersdb.json');
const IP_REGEX = /- IP Address: \/?(\S+)/;
const RETRY_DELAY = 10000;    // ms before retrying a player we got no IP for
const MAX_ATTEMPTS = 3;       // then give up on that player until they rejoin

// shared between every bot instance so they don't overwrite each other's file
// shape: {
//   players: { "<uuid>": { username, lastSeenTime, lastSeenServer } },
//   ips:     { "<server>": { "<uuid>": "<ip>" } }
// }
let store = null;
let saveTimer = null;

function load() {
    if (store) return store;
    try {
        if (fs.existsSync(DB_FILE)) {
            const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
            store = parsed && parsed.players && parsed.ips ? parsed : { players: {}, ips: {} };
        } else {
            store = { players: {}, ips: {} };
            fs.writeFileSync(DB_FILE, JSON.stringify(store, null, 4), 'utf8');
        }
    } catch (e) {
        console.error('[PlayersDB] Failed to load:', e);
        store = { players: {}, ips: {} };
    }
    return store;
}

function saveSoon() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        try {
            fs.writeFileSync(DB_FILE, JSON.stringify(store, null, 4), 'utf8');
        } catch (e) {
            console.error('[PlayersDB] Failed to save:', e);
        }
    }, 2000);
}

function clean(name) {
    return String(name ?? '').replace(/§[0-9a-fk-or]/gi, '').trim();
}

module.exports = function playersDatabase(bot) {
    const data = load();
    const server = String(bot.id || 'default');

    let queryInterval = null;
    let querying = false;
    const lastTried = new Map();      // uuid -> timestamp
    const attempts = new Map();       // uuid -> failed query count
    const known = new Map();          // uuid -> player object

    // ---------- database api ----------

    function touchPlayer(player) {
        if (!player?.uuid || !player.username) return;
        data.players[player.uuid] = {
            username: player.username,
            lastSeenTime: Date.now(),
            lastSeenServer: server
        };
        saveSoon();
    }

    function setIP(uuid, ip, serverId = server, time = Date.now()) {
        if (!uuid || !ip) return false;
        ip = String(ip).trim();
        (data.ips[serverId] ||= {})[uuid] = ip;
        const info = data.players[uuid];
        if (info) {
            if (!info.ips || typeof info.ips !== 'object' || Array.isArray(info.ips)) info.ips = {};
            const prev = Number(info.ips[ip]) || 0;
            if (time > prev) info.ips[ip] = time;
        }
        saveSoon();
        return true;
    }

    // by username, on this server
    function getPlayerIP(username) {
        const key = clean(username).toLowerCase();
        if (!key) return null;
        const ips = data.ips[server] || {};
        let best = null;
        for (const [uuid, info] of Object.entries(data.players)) {
            if (info.username.toLowerCase() !== key || !ips[uuid]) continue;
            if (!best || info.lastSeenTime > best.time) best = { ip: ips[uuid], time: info.lastSeenTime };
        }
        return best?.ip || null;
    }

    // Map<username, { lastSeen, server }>
    function findPlayerAlts(ip, allServers = false, limit = 200) {
        const matches = new Set();
        const serverIds = allServers ? Object.keys(data.ips) : [server];
        for (const serverId of serverIds) {
            for (const [uuid, storedIP] of Object.entries(data.ips[serverId] || {})) {
                if (storedIP === ip) matches.add(uuid);
            }
        }

        const rows = [];
        for (const uuid of matches) {
            const info = data.players[uuid];
            if (info) rows.push({ username: info.username, lastSeen: info.lastSeenTime, server: info.lastSeenServer });
        }
        rows.sort((a, b) => b.lastSeen - a.lastSeen);

        const out = new Map();
        for (const r of rows.slice(0, limit)) out.set(r.username, { lastSeen: r.lastSeen, server: r.server });
        return out;
    }

    // list every IP a player with this username has joined with, deduped by IP
    function getPlayerIPs(username, allServers = false) {
        const key = clean(username).toLowerCase();
        if (!key) return [];
        const serverIds = allServers ? Object.keys(data.ips) : [server];
        const byIp = new Map();

        for (const serverId of serverIds) {
            for (const [uuid, storedIP] of Object.entries(data.ips[serverId] || {})) {
                const info = data.players[uuid];
                if (!info || clean(info.username).toLowerCase() !== key) continue;
                const ip = String(storedIP).trim();
                let time = 0;
                if (info.ips && typeof info.ips === 'object' && !Array.isArray(info.ips)) {
                    time = Number(info.ips[ip]) || 0;
                }
                if (!time) time = Number(info.lastSeenTime) || 0;
                const prev = byIp.get(ip);
                if (!prev || time > prev.time) {
                    byIp.set(ip, { ip, time, server: info.lastSeenServer || serverId });
                }
            }
        }

        // include historical IPs that are no longer the current IP for any uuid
        for (const info of Object.values(data.players)) {
            if (clean(info.username).toLowerCase() !== key) continue;
            if (!info.ips || typeof info.ips !== 'object' || Array.isArray(info.ips)) continue;
            if (!allServers && info.lastSeenServer && info.lastSeenServer !== server) continue;
            for (const [ipRaw, timeRaw] of Object.entries(info.ips)) {
                const ip = String(ipRaw).trim();
                if (!ip) continue;
                const time = Number(timeRaw) || 0;
                const prev = byIp.get(ip);
                if (!prev || time > prev.time) {
                    byIp.set(ip, { ip, time, server: info.lastSeenServer || server });
                }
            }
        }

        return [...byIp.values()].sort((a, b) => b.time - a.time);
    }

    // [lastSeenTime, lastSeenServer] or null
    function getPlayerLastSeen(username) {
        const key = clean(username).toLowerCase();
        let best = null;
        for (const info of Object.values(data.players)) {
            if (info.username.toLowerCase() !== key) continue;
            if (!best || info.lastSeenTime > best.lastSeenTime) best = info;
        }
        return best ? { username: best.username, time: best.lastSeenTime, server: best.lastSeenServer } : null;
    }

    // ---------- ip querying (essentials:seen) ----------

    async function queryNext() {
        if (querying || !bot.core?.ready || typeof bot.core.runTracked !== 'function') return;
        const api = bot.playersAPI;
        if (!api) return;

        const now = Date.now();
        const target = api.getOnline().find(p =>
            p.uuid && !p.ip &&
            (attempts.get(p.uuid) || 0) < MAX_ATTEMPTS &&
            (!lastTried.has(p.uuid) || now - lastTried.get(p.uuid) > RETRY_DELAY)
        );
        if (!target) return;

        // already known from a previous session on this server
        const known = data.ips[server]?.[target.uuid];
        if (known) {
            target.ip = known;
            return setTimeout(queryNext, 0);
        }

        lastTried.set(target.uuid, now);
        querying = true;
        let ranIt = true;
        try {
            const output = await bot.core.runTracked(`essentials:seen ${target.uuid}`);
            ranIt = bot.core._lastRunOk !== false;
            const match = output && output.match(IP_REGEX);

            if (match) {
                target.ip = match[1];
                setIP(target.uuid, target.ip);
                touchPlayer(target);
                bot.emit('queried_player_ip', target, target.ip);
            } else if (ranIt) {
                const n = (attempts.get(target.uuid) || 0) + 1;
                attempts.set(target.uuid, n);
                if (n >= MAX_ATTEMPTS) {
                    console.log(`[${bot.id}] [PlayersDB] giving up on ${target.username}, last output: ${JSON.stringify(output)}`);
                }
            } else {
                lastTried.delete(target.uuid); // core wasn't able to run it, don't count it
            }
        } catch (e) {
            console.error(`[${bot.id}] [PlayersDB] IP query failed:`, e);
        } finally {
            querying = false;
        }

        // keep going right away instead of waiting for the next tick
        if (queryInterval && ranIt) setTimeout(queryNext, 50);
    }

    function start() {
        if (queryInterval) return;
        touchAllOnline();
        queryInterval = setInterval(queryNext, 1000);
    }

    function stop() {
        if (queryInterval) clearInterval(queryInterval);
        queryInterval = null;
        lastTried.clear();
        attempts.clear();
        known.clear();
    }

    // ---------- listeners ----------

    // players.js drops a player from its own maps before our player_remove listener runs,
    // so keep our own uuid -> player map to still be able to update their last seen time
    function onPlayerAdded(player) {
        if (!player?.uuid) return;
        known.set(player.uuid, player);
        attempts.delete(player.uuid);
        lastTried.delete(player.uuid);
        touchPlayer(player);
        const stored = data.ips[server]?.[player.uuid];
        if (stored) {
            player.ip = stored;
            setIP(player.uuid, stored, server, Date.now());
        }
    }

    function onPlayerRemove(pkt) {
        if (!pkt || !Array.isArray(pkt.players)) return;
        for (const uuid of pkt.players) {
            const p = known.get(uuid);
            if (p) touchPlayer(p);
            known.delete(uuid);
        }
    }

    function touchAllOnline() {
        const api = bot.playersAPI;
        if (!api) return;
        for (const p of api.getOnline()) {
            if (p.uuid) known.set(p.uuid, p);
            touchPlayer(p);
        }
    }

    function onDisconnect() {
        touchAllOnline();
        stop();
    }

    bot.on('player_added', onPlayerAdded);
    bot.on('player_remove', onPlayerRemove);
    bot.on('login', start);
    bot.on('bot:disconnect', onDisconnect);
    bot.on('end', onDisconnect);
    if (bot.ready) start();

    bot.playersDatabase = {
        getPlayerIP,
        getPlayerIPs,
        findPlayerIPs: getPlayerIPs,
        getIPs: getPlayerIPs,
        getPlayerIPHistory: getPlayerIPs,
        findPlayerAlts,
        getPlayerLastSeen,
        setIP,
        file: DB_FILE,
        destroy() {
            stop();
            bot.removeListener('player_added', onPlayerAdded);
            bot.removeListener('player_remove', onPlayerRemove);
            bot.removeListener('login', start);
            bot.removeListener('bot:disconnect', onDisconnect);
            bot.removeListener('end', onDisconnect);
        }
    };
};
