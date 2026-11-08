const readline = require('readline');
const util = require('util');

module.exports = function consolePlugin(bot) {
    if (global.__noratConsole) {
        if (typeof global.__noratConsole.attach === 'function') global.__noratConsole.attach(bot);
        return;
    }
    global.__noratConsole = true;

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true
    });
            function gradText(text, start, end) {
        const grad = require('../utils/gradient');
        return grad.gradient(text, start, end);
    }

    function tellrawCmd(text) {
        const formatted = gradText('[noratbot Console] ' + text, '#f4fcff', '#238bff');
        return bot.core.run(`tellraw @a ${JSON.stringify(formatted)}`);
    }
    const attached = new Set();
    let selectedServer = 'global';
    function attach(target) {
        if (!target || attached.has(target)) return;
        attached.add(target);
        target.on('chat', (username, message) => {
            if (typeof message === 'string' && message.trim()) target.chat(message);
        });
    }
    function selectBots(server) {
        const manager = global.botManager;
        const bots = manager?.list ? manager.list() : [bot];
        if (!server) server = selectedServer;
        if (server.toLowerCase() === 'global') return bots.filter(item => item.ready && item.client);
        if (server.toLowerCase() === 'all') return bots;
        const selected = bots.find(item => item.id.toLowerCase() === server.toLowerCase());
        return selected ? [selected] : [];
    }

    function say(target, msg) {
        if (!target || typeof target.chat !== 'function') {
            console.log(`[${target?.id || 'console'}] [Console] Bot is not connected`);
            return;
        }
        const formatted = gradText('[noratbot Console] ' + msg, '#f4fcff', '#238bff');
        target.core?.run?.(`tellraw @a ${JSON.stringify(formatted)}`);
    }

    function doCmd(cmd) {
        const targets = selectBots();
        if (!targets.length) { console.log(`[Console] No connected bot selected (${selectedServer})`); return; }
        let c = String(cmd).trim();
        if (!c) return;
        if (!c.startsWith('/')) c = '/' + c;
        for (const target of targets) {
            console.log(`[${target.id}] [Console] Command -> ${c}`);
            target.chat(c);
        }
    }

    function handleEval(code) {
        if (!code) {
            console.log(`[${bot.id}] [Eval] Usage: !eval <code>`);
            return;
        }
        try {
            const result = eval(code);
            const out = util.inspect(result, { depth: null, colors: true });
            console.log(`[${bot.id}] [Eval] Result:`, out);
        } catch (err) {
            console.error(`[${bot.id}] [Eval] Error:`, err);
        }
    }

    function executeBotCommand(text) {
        for (const target of global.botManager?.list?.() || [bot]) attach(target);
        const parts = text.trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return;
        if (parts[0].replace(/^\./, '').toLowerCase() === 'server') {
            if (parts.length !== 2) { console.log('[Console] Usage: .server <server|global>'); return; }
            const requested = parts[1].toLowerCase();
            if (requested !== 'global' && !global.botManager?.has?.(requested)) {
                console.log(`[Console] Unknown server "${parts[1]}". Available: ${(global.botManager?.list?.() || []).map(item => item.id).join(', ')}, global`);
                return;
            }
            selectedServer = requested;
            console.log(`[Console] Server target: ${selectedServer}`);
            return;
        }
        let server = null;
        if (parts.length > 1 && (parts[0].toLowerCase() === 'all' || global.botManager?.has?.(parts[0]))) {
            server = parts.shift();
        }
        const raw = parts.shift() || '';
        const command = raw.replace(/^\//, '').replace(/^\./, '').replace(/^nr:/i, '');
        const targets = selectBots(server);
        if (!targets.length) {
            console.log(`[Console] Unknown bot: ${server}`);
            return;
        }
        if (!targets.length) { console.log('[Console] No connected bots available'); return; }
        for (const target of targets) {
            if (!target.commands?.executeConsole) {
                console.log(`[${target.id}] [Console] Command handler not ready`);
                continue;
            }
            target.commands.executeConsole(command, parts);
        }
    }

    global.__noratConsole.setServer = server => { selectedServer = server; };

    global.__noratConsole = { attach };
    for (const target of global.botManager?.list?.() || [bot]) attach(target);





    rl.on('line', line => {
        const text = String(line).trim();
        if (!text) return;

        if (text.startsWith('!eval')) {
            const code = text.slice(5).trim();
            handleEval(code);
            return;
        }
        if (/^(?:!bot|!cmd|nr:|\.)/i.test(text)) {
            executeBotCommand(text.replace(/^!bot\s*/i, '').replace(/^!cmd\s*/i, ''));
            return;
        }
        if (text.startsWith('/')) {
            doCmd(text);
            return;
        }
        const targets = selectBots();
        for (const target of targets) say(target, text);
    });

    bot.on('bot:destroy', () => {
        if (global.botManager?.list?.().length <= 1) {
            try { rl.close(); } catch {}
            delete global.__noratConsole;
        }
    });
};
