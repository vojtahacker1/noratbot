const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(process.cwd(), 'filter.json');

module.exports = function filterPlugin(bot) {
    const SCAN_INTERVAL = 2;
    let seen = new Set();

    function log(msg) {
        console.log(`[${bot.id}] [Filter] ${msg}`);
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
            console.error(`[${bot.id}] [Filter] load error:`, e);
            return {};
        }
    }

    function saveData(data) {
        try {
            fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 4), 'utf8');
            return true;
        } catch (e) {
            console.error(`[${bot.id}] [Filter] save error:`, e);
            return false;
        }
    }

    function getServerData() {
        const all = loadData();
        if (!all[bot.id]) {
            all[bot.id] = { players: [], uuids: [], ips: [], regex: null };
            saveData(all);
        }
        if (!Array.isArray(all[bot.id].ips)) all[bot.id].ips = [];
        return all[bot.id];
    }

    function updateServerData(updateFn) {
        const all = loadData();
        if (!all[bot.id]) {
            all[bot.id] = { players: [], uuids: [], ips: [], regex: null };
        }
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

    function shouldFilter(player) {
        const data = getServerData();
        const name = player.username || player.name;
        const uuid = player.uuid;
        const botName = bot.config?.username || bot.username || '';
        if (botName && cleanName(name) === cleanName(botName)) return false;

        const matchPlayer = data.players.some(p => cleanName(p) === cleanName(name));
        if (matchPlayer) return true;

        const matchUuid = data.uuids.some(id => String(id) === String(uuid));
        if (matchUuid) return true;

        const playerIp = (player && (player.ip || player.IP)) || (bot.playersDatabase && typeof bot.playersDatabase.getPlayerIP === 'function' ? bot.playersDatabase.getPlayerIP(name) : null);
        if (playerIp) {
            const cleanIp = String(playerIp).trim();
            if (data.ips.some(ip => String(ip).trim() === cleanIp)) return true;
        }

        if (data.regex) {
            try {
                return new RegExp(data.regex, 'i').test(name);
            } catch { return false; }
        }
        return false;
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

    bot.filter = {
        get() {
            const data = getServerData();
            return { players: [...data.players], uuids: [...data.uuids], regex: data.regex };
        },

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

        listPlayers() {
            return getServerData().players;
        },

        clearPlayers() {
            updateServerData(data => { data.players = []; });
            return true;
        },

        addUUID(uuid) {
            uuid = String(uuid).trim();
            if (!uuid || !isUuid(uuid)) return false;
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

        listUUIDs() {
            return getServerData().uuids;
        },

        clearUUIDs() {
            updateServerData(data => { data.uuids = []; });
            return true;
        },

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

        listIPs() {
            return getServerData().ips;
        },

        clearIPs() {
            updateServerData(data => { data.ips = []; });
            return true;
        },

        setRegex(regex) {
            let ok = false;
            updateServerData(data => {
                if (typeof regex !== 'string' || !regex.trim()) {
                    data.regex = null;
                } else {
                    try { new RegExp(regex); } catch { ok = false; return; }
                    data.regex = regex.trim();
                }
                ok = true;
            });
            if (ok) sweep();
            return ok;
        },

        getRegex() {
            return getServerData().regex;
        },

        removeRegex() {
            updateServerData(data => { data.regex = null; });
            return true;
        },

        rescan() {
            seen.clear();
            sweep();
            return true;
        }
    };
};