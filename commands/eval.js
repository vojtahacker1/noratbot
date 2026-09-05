const vm = require('vm');

module.exports = {
    name: 'eval',
    description: 'Execute JavaScript code',
    level: 2,

    async execute(ctx) {
        const code = ctx.args.join(' ');
        if (!code) {
            ctx.tellrawCommand('Usage: eval <code>');
            return;
        }
        const sandbox = {
            bot: ctx.bot,
            ctx: ctx,
            console: {
                log: (...args) => {
                    const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a, null, 2)).join(' ');
                    ctx.tellrawCommand(`[Console] ${msg}`);
                },
                error: (...args) => {
                    const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a, null, 2)).join(' ');
                    ctx.tellrawCommand(`[Console] ${msg}`);
                }
            },
            Array, Object, String, Number, Boolean, Date, Math, JSON,
            parseInt, parseFloat, isNaN, isFinite,
            setTimeout: (fn, ms) => {
                const safeMs = Math.min(ms || 0, 5000);
                return setTimeout(fn, safeMs);
            },
            clearTimeout,
            setInterval: (fn, ms) => {
                const safeMs = Math.min(ms || 0, 5000);
                return setInterval(fn, safeMs);
            },
            clearInterval,
            Promise,
            Error,
            RangeError,
            TypeError,
            ReferenceError,
            SyntaxError,
            RegExp,
        };

        try {
            const script = new vm.Script(code);
            const context = vm.createContext(sandbox);
            const result = script.runInContext(context);

            if (result !== undefined) {
                const output = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
                const truncated = output.length > 500 ? output.substring(0, 500) + '...' : output;
                ctx.tellrawCommand(`Result: ${truncated}`);
            } else {
                ctx.tellrawCommand('Executed (no return value)');
            }
        } catch (err) {
            ctx.tellrawCommand(`Error: ${err.message}`);
            console.error(`[Eval] Error executing: ${code}`, err);
        }
    }
};