module.exports = {
    name: 'test',
    description: 'Test command',
    level: 0,
    async execute(ctx) {
        ctx.core.run(`tellraw ${ctx.player.name} "Hello World!"`);
    }
};