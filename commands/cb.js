module.exports = {
    name: 'cb',
    description: 'Run command through command block',
    level: 0,

    async execute(ctx) {
        const cmd = ctx.args.join(' ');
        if (!cmd) return;
        ctx.core.run(cmd);
    }
};