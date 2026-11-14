const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(process.cwd(), 'whitelist.json');

module.exports = function whitelistPlugin(bot) {
    const SCAN_INTERVAL = 2;
    let seen = new Set();

    function log(msg) {
        console.log(`[${bot.id}] [Whitelist] ${msg}`);
    }

    function loadData() {
        try {
            if (!fs.existsSync(STORE_PATH)) {
                fs.writeFileSync(STORE_PATH, JSON.stringify({}), 'utf8');
                return {};
            }
            const raw = fs.readFileSync(STORE_PATH, 'utf8');
            if (!raw.trim()) return {};
            return JSON.parse(raw);
        } catch (e) {
            console.error(`[${bot.id}] [Whitelist] load error:`, e);
            return {};
        }
    }

    function saveData(data) {
        try {
            fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 4), 'utf8');
            return true;
        } catch (e) {
            console.error(`[${bot.id}] [Whitelist] save error:`, e);
            return false;
        }
    }

    function getServerData() {
        const all = loadData();
        if (!all[bot.id]) {
            all[bot.id] = { enabled: false, players: [], uuids: [], ips: [] };
            saveData(all);
        }
        if (typeof all[bot.id].enabled !== 'boolean') all[bot.id].enabled = false;
        if (!Array.isArray(all[bot.id].players)) all[bot.id].players = [];
        if (!Array.isArray(all[bot.id].uuids)) all[bot.id].uuids = [];
        if (!Array.isArray(all[bot.id].ips)) all[bot.id].ips = [];
        return all[bot.id];
    }

    function updateServerData(updateFn) {
        const all = loadData();
        if (!all[bot.id]) {
            all[bot.id] = { enabled: false, players: [], uuids: [], ips: [] };
        }
        if (typeof all[bot.id].enabled !== 'boolean') all[bot.id].enabled = false;
        if (!Array.isArray(all[bot.id].players)) all[bot.id].players = [];
        if (!Array.isArray(all[bot.id].uuids)) all[bot.id].uuids = [];
        if (!Array.isArray(all[bot.id].ips)) all[bot.id].ips = [];
        updateFn(all[bot.id]);
        saveData(all);
    }

    function cleanName(name) {
        return String(name || '').replace(/§[0-9a-fk-or]/g, '').trim().toLowerCase();
    }

    function isUuid(str) {
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str) ||
               /^[0-9a-f]{32}$/i.test(str);
    }

    function getPlayerIP(player) {
        if (player && (player.ip || player.IP)) return String(player.ip || player.IP).trim();
        const name = player?.username || player?.name;
        if (name && bot.playersDatabase && typeof bot.playersDatabase.getPlayerIP === 'function') {
            try { return bot.playersDatabase.getPlayerIP(name); } catch (e) { return null; }
        }
        return null;
    }

    function isWhitelisted(player) {
        const data = getServerData();
        const name = player.username || player.name;
        const uuid = player.uuid;
        const botName = bot.config?.username || bot.username || '';
        if (botName && cleanName(name) === cleanName(botName)) return true;

        if (data.players.some(p => cleanName(p) === cleanName(name))) return true;
        if (data.uuids.some(id => String(id) === String(uuid))) return true;

        const ip = getPlayerIP(player);
        if (ip && data.ips.some(x => String(x).trim() === ip)) return true;

        return false;
    }

    function shouldFilter(player) {
        const data = getServerData();
        if (!data.enabled) return false;
        const name = player.username || player.name;
        const uuid = player.uuid;
        const botName = bot.config?.username || bot.username || '';
        if (botName && cleanName(name) === cleanName(botName)) return false;
        return !isWhitelisted(player);
    }

    function doFilter(player) {
        if (!player) return false;
        const name = player.username || player.name;
        const uuid = player.uuid;
        if (!name || !uuid || !player.online) return false;
        const botName = bot.config?.username || bot.username || '';
        if (botName && cleanName(name) === cleanName(botName)) return false;

        const cmds = [
            `deop ${name}`,
            `gamemode spectator ${name}`,
            `execute as ${uuid} in minecraft:the_end run tp @s 0 1 0`,
            `execute as ${uuid} run kill @s`
        ];
        if (bot.core && typeof bot.core.run === 'function') {
            for (const cmd of cmds) bot.core.run(cmd);
        }
        return true;
    }

    function sweep() {
        if (!bot.ready) return;
        const data = getServerData();
        if (!data.enabled) return;
        if (!bot.playersAPI || typeof bot.playersAPI.getAll !== 'function') return;
        const players = bot.playersAPI.getAll();
        if (!players || !players.length) return;
        for (const p of players) {
            if (p.online !== true || !p.uuid) continue;
            if (shouldFilter(p)) doFilter(p);
        }
    }

    bot.on('player_added', p => {
        if (!bot.ready || !p.online || !p.uuid) return;
        if (shouldFilter(p)) doFilter(p);
    });

    bot.on('player_updated', p => {
        if (!bot.ready || !p.online || !p.uuid) return;
        if (shouldFilter(p)) doFilter(p);
    });

    bot.on('bot:login', () => {
        setTimeout(sweep, 500);
        setTimeout(sweep, 1500);
    });

    const scanTimer = setInterval(sweep, SCAN_INTERVAL);
    bot.on('bot:disconnect', () => seen.clear());
    bot.on('bot:destroy', () => clearInterval(scanTimer));

    bot.whitelist = {
        isEnabled() { return getServerData().enabled; },
        on() { updateServerData(d => { d.enabled = true; }); sweep(); return true; },
        off() { updateServerData(d => { d.enabled = false; }); return true; },

        addPlayer(name) {
            const n = cleanName(name);
            if (!n) return false;
            let ok = false;
            updateServerData(data => {
                if (!data.players.includes(n)) {
                    data.players.push(n);
                    ok = true;
                }
            });
            if (ok) sweep();
            return ok;
        },

        removePlayer(name) {
            const n = cleanName(name);
            let ok = false;
            updateServerData(data => {
                const idx = data.players.indexOf(n);
                if (idx !== -1) {
                    data.players.splice(idx, 1);
                    ok = true;
                }
            });
            return ok;
        },

        listPlayers() { return getServerData().players; },
        clearPlayers() { updateServerData(data => { data.players = []; }); return true; },

        addUUID(uuid) {
            uuid = String(uuid).trim();
            if (!uuid) return false;
            let ok = false;
            updateServerData(data => {
                if (!data.uuids.includes(uuid)) {
                    data.uuids.push(uuid);
                    ok = true;
                }
            });
            if (ok) sweep();
            return ok;
        },

        removeUUID(uuid) {
            uuid = String(uuid).trim();
            let ok = false;
            updateServerData(data => {
                const idx = data.uuids.indexOf(uuid);
                if (idx !== -1) {
                    data.uuids.splice(idx, 1);
                    ok = true;
                }
            });
            return ok;
        },

        listUUIDs() { return getServerData().uuids; },
        clearUUIDs() { updateServerData(data => { data.uuids = []; }); return true; },

        addIP(ip) {
            ip = String(ip || '').trim();
            if (!ip) return false;
            let ok = false;
            updateServerData(data => {
                if (!data.ips.includes(ip)) {
                    data.ips.push(ip);
                    ok = true;
                }
            });
            if (ok) sweep();
            return ok;
        },

        removeIP(ip) {
            ip = String(ip || '').trim();
            let ok = false;
            updateServerData(data => {
                const idx = data.ips.indexOf(ip);
                if (idx !== -1) {
                    data.ips.splice(idx, 1);
                    ok = true;
                }
            });
            return ok;
        },

        listIPs() { return getServerData().ips; },
        clearIPs() { updateServerData(data => { data.ips = []; }); return true; },

        rescan() { seen.clear(); sweep(); return true; }
    };
};
