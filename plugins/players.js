// idea taken from chipmunkbot
// credits to chipmunk

const crypto = require('crypto');

const gameModes = ['survival', 'creative', 'adventure', 'spectator'];

module.exports = function players(bot) {
    bot.players = [];
    const uuidMap = new Map();
    const nameMap = new Map();

    let pendingTellraw = false;
    let refreshInterval = null;

    function normalizeName(name) {
        if (!name) return null;
        return String(name).replace(/§[0-9a-fk-or]/gi, '').trim().toLowerCase();
    }

    function cleanName(name) {
        if (!name) return null;
        return String(name).replace(/§[0-9a-fk-or]/gi, '').trim();
    }

    function computeOfflineUUID(username) {
        const clean = cleanName(username);
        if (!clean) return null;
        const hash = crypto.createHash('md5')
            .update(Buffer.from(`OfflinePlayer:${clean}`, 'utf8'))
            .digest();
        hash[6] = (hash[6] & 0x0f) | 0x30;
        hash[8] = (hash[8] & 0x3f) | 0x80;
        const hex = hash.toString('hex');
        return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
    }

    function removePlayerFromMaps(player) {
        if (!player) return;
        const key = normalizeName(player.username);
        if (key && nameMap.get(key) === player) {
            nameMap.delete(key);
        }
        if (player.uuid) {
            uuidMap.delete(player.uuid);
        }
        const idx = bot.players.indexOf(player);
        if (idx !== -1) {
            bot.players.splice(idx, 1);
        }
    }

    function addPlayerFromInfo(entry) {
        if (!entry) return;
        const uuid = entry.uuid ?? entry.UUID;
        const rawName = entry.player?.name ?? entry.name;
        if (!rawName) return;
        const clean = cleanName(rawName);
        if (!clean) return;
        const key = normalizeName(clean);

        let existing = uuid ? uuidMap.get(uuid) : null;
        if (!existing) existing = nameMap.get(key);

        if (existing) {
            const oldKey = normalizeName(existing.username);
            if (oldKey && oldKey !== key && nameMap.get(oldKey) === existing) {
                nameMap.delete(oldKey);
            }

            if (uuid && existing.uuid !== uuid) {
                if (bot.commands && typeof bot.commands.removePlayer === 'function') {
                    bot.commands.removePlayer(existing.uuid);
                }
                uuidMap.delete(existing.uuid);
                existing.uuid = uuid;
                uuidMap.set(uuid, existing);
            }
            existing.username = clean;
            existing.online = true;
            existing.listed = true;
            existing.lastSeen = Date.now();
            if (entry.gamemode !== undefined) existing.gamemode = gameModes[entry.gamemode];
            if (entry.latency !== undefined) existing.latency = entry.latency;
            if (entry.ping !== undefined) existing.latency = entry.ping;
            if (entry.displayName !== undefined) existing.displayName = entry.displayName;
            if (nameMap.get(key) !== existing) {
                nameMap.set(key, existing);
            }
            return;
        }

        const now = Date.now();
        const player = {
            uuid: uuid || computeOfflineUUID(clean),
            username: clean,
            online: true,
            listed: true,
            vanished: false,
            lastSeen: now,
            firstSeen: now,
            gamemode: entry.gamemode !== undefined ? gameModes[entry.gamemode] : undefined,
            latency: entry.latency ?? entry.ping,
            displayName: entry.displayName,
            uuidSource: uuid ? 'server' : 'offline'
        };
        bot.players.push(player);
        nameMap.set(key, player);
        if (player.uuid) uuidMap.set(player.uuid, player);
        bot.emit('player_added', player);
    }

    function addPlayerByName(name, fromTellraw = false) {
        const clean = cleanName(name);
        if (!clean || clean.startsWith('/') || ['@a','@p','@r','@e','@s'].includes(clean.toLowerCase())) return null;
        const key = normalizeName(clean);
        let existing = nameMap.get(key);
        if (existing) {
            existing.online = true;
            existing.listed = true;
            existing.lastSeen = Date.now();
            return existing;
        }
        const uuid = computeOfflineUUID(clean);
        const now = Date.now();
        const player = {
            uuid, username: clean, online: true, listed: true, vanished: false,
            lastSeen: now, firstSeen: now, gamemode: undefined,
            latency: undefined, displayName: undefined, uuidSource: 'offline'
        };
        bot.players.push(player);
        nameMap.set(key, player);
        if (uuid) uuidMap.set(uuid, player);
        bot.emit('player_added', player);
        return player;
    }

    function uuidToIntArray(uuid) {
        if (!uuid) return null;
        const clean = uuid.replace(/-/g, '');
        if (clean.length !== 32) return null;
        const parts = [
            clean.slice(0, 8),
            clean.slice(8, 16),
            clean.slice(16, 24),
            clean.slice(24, 32)
        ];
        const ints = parts.map(hex => {
            const val = parseInt(hex, 16);
            return val < 0x80000000 ? val : val - 0x100000000;
        });
        return `[I;${ints.join(',')}]`;
    }

    async function refreshFromTellraw() {
        if (pendingTellraw) return;
        if (!bot.core || typeof bot.core.run !== 'function') return;
        const nbtUuid = uuidToIntArray(bot.client?.uuid);
        if (!nbtUuid) return;
        pendingTellraw = true;
        try {
            bot.core.run(
                `tellraw @a[nbt={UUID:${nbtUuid}}] {"text":"[PLAYER_LIST]","extra":[{"selector":"@a"}]}`
            );
            await new Promise(resolve => setTimeout(resolve, 1200));
        } finally {
            pendingTellraw = false;
        }
    }
    const handlers = {
        onChatPlain(msg) {
            if (typeof msg !== 'string') return;
            const text = msg.replace(/\x1b\[[0-9;]*m/g, '').trim();
            if (!text.startsWith('[PLAYER_LIST]')) return;
            const namesPart = text.slice('[PLAYER_LIST]'.length).trim();
            if (!namesPart) return;
            const names = namesPart.split(',').map(n => cleanName(n)).filter(Boolean);
            const current = new Set();
            for (const name of names) {
                const p = addPlayerByName(name, true);
                if (p) current.add(normalizeName(p.username));
            }
            for (const p of bot.players) {
                const key = normalizeName(p.username);
                if (current.has(key)) {
                    p.online = true;
                    p.listed = true;
                    p.lastSeen = Date.now();
                }
            }
        },

        onPlayerInfo(pkt) {
            if (!pkt || !Array.isArray(pkt.data)) return;
            for (const entry of pkt.data) addPlayerFromInfo(entry);
        },

        onPlayerRemove(pkt) {
            if (!pkt || !Array.isArray(pkt.players)) return;
            for (const uuid of pkt.players) {
                const p = uuidMap.get(uuid);
                if (p) {
                    p.online = false;
                    p.listed = false;
                    p.lastSeen = Date.now();
                    if (bot.commands && typeof bot.commands.removePlayer === 'function') {
                        bot.commands.removePlayer(uuid);
                    }
                    removePlayerFromMaps(p);
                }
            }
        },

        onLogin() {
            clearAllData();
            setTimeout(refreshFromTellraw, 3000);
            refreshInterval = setInterval(() => {
                if (bot.ready) refreshFromTellraw();
            }, 20000);
        },

        onDisconnect() {
            clearAllData();
        },

        onEnd() {
            clearAllData();
        }
    };

    bot.on('chat_plain', handlers.onChatPlain);
    bot.on('player_info', handlers.onPlayerInfo);
    bot.on('player_remove', handlers.onPlayerRemove);
    bot.on('login', handlers.onLogin);
    bot.on('bot:disconnect', handlers.onDisconnect);
    bot.on('end', handlers.onEnd);

    function clearAllData() {
        if (refreshInterval) {
            clearInterval(refreshInterval);
            refreshInterval = null;
        }
        pendingTellraw = false;
        bot.players = [];
        uuidMap.clear();
        nameMap.clear();
    }
    function destroy() {
        clearAllData();
        bot.removeListener('chat_plain', handlers.onChatPlain);
        bot.removeListener('player_info', handlers.onPlayerInfo);
        bot.removeListener('player_remove', handlers.onPlayerRemove);
        bot.removeListener('login', handlers.onLogin);
        bot.removeListener('bot:disconnect', handlers.onDisconnect);
        bot.removeListener('end', handlers.onEnd);
    }

    bot.playersAPI = {
        getAll() { return bot.players; },
        getOnline() { return bot.players.filter(p => p.online !== false); },
        get(name) {
            const key = normalizeName(name);
            return key ? nameMap.get(key) || null : null;
        },
        getUUID(name) {
            const p = this.get(name);
            if (p && p.uuid) return p.uuid;
            return computeOfflineUUID(name);
        },
        getByUUID(uuid) { return uuidMap.get(uuid) || null; },
        count() { return bot.players.length; },
        onlineCount() { return this.getOnline().length; },
        refresh: refreshFromTellraw,
        offlineUUID: computeOfflineUUID,
        destroy
    };
};