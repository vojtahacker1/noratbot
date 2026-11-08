const fs = require('fs');
const path = require('path');

const cmdsDir = path.join(process.cwd(), 'commands');

const LVL = {
    PUBLIC: 0,
    TRUSTED: 1,
    ADMIN: 2
};

module.exports = function commandHandler(bot) {
    const registry = new Map();
    const userLevels = new Map();

    const prefixes = (() => {
        const cfg = bot.globalConfig?.bot || {};
        if (Array.isArray(cfg.prefixes)) return cfg.prefixes.filter(p => typeof p === 'string' && p.length > 0);
        if (Array.isArray(cfg.prefix)) return cfg.prefix.filter(p => typeof p === 'string' && p.length > 0);
        if (typeof cfg.prefix === 'string' && cfg.prefix.length > 0) return [cfg.prefix];
        return ['nr:'];
    })();

    const logSettings = bot.globalConfig?.logging || {};

function getUUID(name) {
    if (!name) return null;
    if (bot.playersAPI && typeof bot.playersAPI.getUUID === 'function') {
        const uuid = bot.playersAPI.getUUID(name);
        if (uuid) return uuid;
    }
    const offline = bot.playersAPI?.offlineUUID?.(name);
    if (offline) return offline;
    console.warn(`[CommandHandler] Cannot get UUID for ${name}`);
    return null;
}



    function removeLevel(uuid) {
        if (!uuid) return;
        userLevels.delete(uuid);
    }

function setLevel(uuid, level) {
    if (!uuid) return false;
    if (level < LVL.PUBLIC || level > LVL.ADMIN) return false;
    userLevels.set(uuid, level);
    return true;
};

function getLevel(uuid) {
    if (!uuid) return LVL.PUBLIC;
    const lvl = userLevels.get(uuid) ?? LVL.PUBLIC;
    return lvl;
}

function configuredLevel(name) {
    const authList = bot.globalConfig?.bot?.authList || {};
    const clean = String(name || '').toLowerCase();
    const admins = Array.isArray(authList.admin) ? authList.admin : [];
    const trusted = Array.isArray(authList.trusted) ? authList.trusted : [];
    if (admins.some(value => String(value).toLowerCase() === clean)) return LVL.ADMIN;
    if (trusted.some(value => String(value).toLowerCase() === clean)) return LVL.TRUSTED;
    return LVL.PUBLIC;
}

    function extractPlayer(msg) {
        if (typeof msg !== 'string') return null;
        const clean = msg.replace(/\x1b\[[0-9;]*m/g, '').trim();
        if (!clean) return null;
        if (/^\[[^\]]+:[^\]]+\]\s*[^:]+:/.test(clean)) {
            return null;
        }
        let name = null;
        let cmdText = null;

        let m = clean.match(/^\[[^\]]+\]\s*([^:]+):\s*(.*)$/s);
        if (m) {
            name = m[1].trim();
            cmdText = m[2].trim();
        } else {
            m = clean.match(/^([^:]+):\s*(.*)$/s);
            if (m) {
                name = m[1].trim();
                cmdText = m[2].trim();
            }
        }

        if (!name || !cmdText) return null;
        if (name && name.toLowerCase() === bot.config?.username?.toLowerCase()) {
            return null;
        }
        const hasPrefix = prefixes.some(p => cmdText.toLowerCase().startsWith(p.toLowerCase()));
        if (!hasPrefix) return null;

        const used = prefixes.find(p => cmdText.toLowerCase().startsWith(p.toLowerCase()));
        const uuid = getUUID(name);

        return {
            username: name,
            uuid,
            commandText: cmdText,
            usedPrefix: used || prefixes[0]
        };
    }

    function loadCmd(file) {
        if (!file.endsWith('.js')) return;
        const name = path.basename(file, '.js').toLowerCase();
        const fullPath = path.join(cmdsDir, file);

        try {
            delete require.cache[require.resolve(fullPath)];
            const cmd = require(fullPath);

            if (!cmd || typeof cmd.execute !== 'function') {
                console.error(`[${bot.id}] [CommandHandler] Invalid command: ${file}`);
                return;
            }

            const info = {
                name: String(cmd.name || name).toLowerCase(),
                description: String(cmd.description || 'No description'),
                level: Number.isInteger(cmd.level) ? cmd.level : LVL.PUBLIC,
                aliases: Array.isArray(cmd.aliases) ? cmd.aliases.map(x => String(x).toLowerCase()) : [],
                execute: cmd.execute,
                file: file
            };

            registry.set(info.name, info);
            for (const alias of info.aliases) {
                registry.set(alias, info);
            }
        } catch (e) {
            console.error(`[${bot.id}] [CommandHandler] Failed to load ${file}:`, e);
        }
    }

    function loadAll() {
        if (!fs.existsSync(cmdsDir)) {
            fs.mkdirSync(cmdsDir, { recursive: true });
            return;
        }
        const files = fs.readdirSync(cmdsDir);
        for (const f of files) loadCmd(f);
    }

    function gradText(text, start, end) {
        const grad = require('../utils/gradient');
        return grad.gradient(text, start, end);
    }

    function tellrawCmd(text) {
        const formatted = gradText('noratbot - ' + text, '#f4fcff', '#238bff');
        return bot.core.run(`tellraw @a ${JSON.stringify(formatted)}`);
    }


async function exec(cmdName, args, raw, msg, player) {
    const cmd = registry.get(String(cmdName).toLowerCase());
    if (!cmd) {
        if (bot.core && typeof bot.core.run === 'function' && player) {
            const grad = require('../utils/gradient');
            const gradText = (text, start, end) => grad.gradient(text, start, end);
            const prefix = prefixes[0] || 'nr:';
            const helpCmd = `${prefix}help`;
            const components = [];
            components.push(...gradText('noratbot - Command not found. ', '#f4fcff', '#238bff'));
            components.push(...gradText('Try ', '#f4fcff', '#238bff'));
            components.push({
                text: helpCmd,
                color: '#55aaff',
                click_event: { action: 'suggest_command', command: helpCmd },
                hover_event: { action: 'show_text', value: { text: `Click to suggest ${helpCmd}`, color: 'green' } }
            });
            const root = { text: '', extra: components };
            bot.core.run(`tellraw ${player.username} ${JSON.stringify(root)}`);
        }
        return;
    }

    if (!player) {
        console.log(`[${bot.id}] [CommandHandler] Unable to identify player for ${cmdName}`);
        return;
    }

    const name = player.username;
    const isConsole = player.isConsole === true;
    let uuid = isConsole ? 'console' : null;
    const chatBind = isConsole ? null : bot.chatSenderUUIDs?.get(name.toLowerCase());
    if (isConsole) {
        // Console execution is already an authenticated local admin source.
    } else if (chatBind && (Date.now() - chatBind.ts < 15000)) {
        uuid = chatBind.uuid;
if (!uuid) {
    console.error(`[CommandHandler] No UUID for ${name}`);
    return;
}
    } else {
        uuid = getUUID(name);
if (!uuid) {
    console.error(`[CommandHandler] No UUID for ${name}`);
    return;
}
    }
    player.uuid = uuid;
    const configured = isConsole ? LVL.ADMIN : configuredLevel(name);
    const currentLevel = isConsole
        ? LVL.ADMIN
        : Math.max(bot.commands.getPlayerLevel(uuid) || 0, configured);
    if (!isConsole && configured > 0) userLevels.set(uuid, configured);
    if (cmd.level > currentLevel) {
        tellrawCmd("Authenticate to use this command")
        return;
    }
    const ctx = {
        bot,
        bots: bot.manager ? bot.manager.bots : new Map(),
        player: {
            name: name,
            uuid: uuid
        },
        command: cmd,
        commandName: cmd.name,
        args,
        raw,
        message: msg,
        prefix: player.usedPrefix || prefixes[0] || 'nr:',
        level: currentLevel,
        source: isConsole ? 'console' : 'chat',
        levels: LVL,
        commands: registry,
        commandsDir: cmdsDir,
        core: bot.core,
        run(cmd) {
            if (!bot.core || typeof bot.core.run !== 'function') return false;
            return bot.core.run(cmd);
        },
        tellraw(target, text) {
            if (!bot.core || typeof bot.core.run !== 'function') return false;
            const json = typeof text === 'string' ? JSON.stringify({ text }) : JSON.stringify(text);
            return bot.core.run(`tellraw ${target} ${json}`);
        },
        tellrawCommand: isConsole
            ? (text) => {
                console.log(`[${bot.id}] [Console] ${text}`);
                return true;
            }
            : tellrawCmd
    };

    try {
        await cmd.execute(ctx);
    } catch (e) {
        console.error(`[${bot.id}] [CommandHandler] Error in "${cmd.name}":`, e);
    }
}
    bot.on('chat_plain', msg => {
        if (typeof msg !== 'string') return;
        const clean = msg.replace(/\x1b\[[0-9;]*m/g, '').trim();
        if (!clean) return;

        const player = extractPlayer(clean);
        if (!player) return;

        const cmdText = player.commandText;
        const hasPrefix = prefixes.some(p => cmdText.toLowerCase().startsWith(p.toLowerCase()));
        if (!hasPrefix) return;


        const used = player.usedPrefix || prefixes[0] || 'nr:';
        const raw = cmdText.slice(used.length).trim();
        if (!raw) return;

        const parts = raw.split(/\s+/);
        const cmdName = parts.shift();
        const args = parts;

        exec(cmdName, args, raw, clean, player, false, null);
    });

    bot.commands = {
        get(name) { return registry.get(String(name).toLowerCase()); },
        has(name) { return registry.has(String(name).toLowerCase()); },
        list() { return [...new Set([...registry.values()].map(c => c.name))]; },
        all() { return [...new Map([...registry.values()].map(c => [c.name, c])).values()]; },
        getPlayerLevel: (uuid) => getLevel(uuid),
        setPlayerLevel: (uuid, level) => setLevel(uuid, level),
        removePlayer: (uuid) => removeLevel(uuid),
        getPlayerUUID: getUUID,
		reload(name) {
			const reloadFile = (file) => {
				const fullPath = path.join(cmdsDir, file);

				if (!fs.existsSync(fullPath) || !file.endsWith('.js')) {
					return false;
				}

				try {
					const resolved = require.resolve(fullPath);
					delete require.cache[resolved];

					const cmd = require(fullPath);

					if (!cmd || typeof cmd.execute !== 'function') {
						console.error(`[${bot.id}] Invalid command: ${file}`);
						return false;
					}

					const info = {
						name: String(cmd.name || path.basename(file, '.js')).toLowerCase(),
						description: String(cmd.description || 'No description'),
						level: Number.isInteger(cmd.level) ? cmd.level : LVL.PUBLIC,
						aliases: Array.isArray(cmd.aliases)
							? cmd.aliases.map(x => String(x).toLowerCase())
							: [],
						execute: cmd.execute,
						file
					};

					registry.set(info.name, info);

					for (const alias of info.aliases) {
						registry.set(alias, info);
					}

					return true;
				} catch (e) {
					console.error(`[${bot.id}] Failed to load ${file}:`, e);
					return false;
				}
			};

			if (name) {
				const norm = String(name).toLowerCase();
				const old = registry.get(norm);
				const file = old?.file || `${norm}.js`;

				if (old) {
					registry.forEach((v, k) => {
						if (v === old) registry.delete(k);
					});
				}

				return reloadFile(file);
			}

			registry.clear();

			if (!fs.existsSync(cmdsDir)) {
				fs.mkdirSync(cmdsDir, { recursive: true });
				return;
			}

			const files = fs.readdirSync(cmdsDir).filter(f => f.endsWith('.js'));

			for (const file of files) {
				reloadFile(file);
			}
		},
        execute: exec,
        executeConsole(commandName, args = []) {
            const name = String(commandName || '').replace(/^\.+/, '').replace(/^nr:/i, '');
            if (!name) return false;
            const list = Array.isArray(args) ? args.map(String) : String(args).trim().split(/\s+/).filter(Boolean);
            return exec(name, list, [name, ...list].join(' '), `[console] ${name}`, {
                username: 'Console',
                uuid: 'console',
                usedPrefix: '',
                isConsole: true
            });
        }
    };

    loadAll();
};
