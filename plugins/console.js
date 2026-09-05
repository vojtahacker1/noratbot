const readline = require('readline');
const util = require('util');

module.exports = function consolePlugin(bot) {
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
    function say(msg) {
        if (!bot.client || typeof bot.chat !== 'function') {
            console.log(`[${bot.id}] [Console] Bot is not connected`);
            return;
        }
        tellrawCmd(msg)
    }

    function doCmd(cmd) {
        if (!bot.client || typeof bot.chat !== 'function') {
            console.log(`[${bot.id}] [Console] Bot is not connected`);
            return;
        }
        let c = String(cmd).trim();
        if (!c) return;
        if (!c.startsWith('/')) c = '/' + c;
        console.log(`[${bot.id}] [Console] Command -> ${c}`);
        bot.chat(c);
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





    rl.on('line', line => {
        const text = String(line).trim();
        if (!text) return;

        if (text.startsWith('!eval')) {
            const code = text.slice(5).trim();
            handleEval(code);
            return;
        }
        if (text.startsWith('/')) {
            doCmd(text);
            return;
        }
        say(text);
    });

    bot.on('bot:destroy', () => {
        try { rl.close(); } catch {}
    });
};