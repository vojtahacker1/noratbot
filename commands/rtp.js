module.exports = {
    name: 'rtp',
    description: 'Random teleport',
    level: 0,

    async execute(ctx) {
        const target = ctx.player.uuid || ctx.player.name;
        if (!target) {
            ctx.tellrawCommand('No target.');
            return;
        }

        const x = Math.floor(Math.random() * 10000000);
        const z = Math.floor(Math.random() * 10000000);
        const y = 100;

        ctx.tellrawCommand(`Teleporting ${ctx.player.name} to ${x} ${y} ${z}`);
        ctx.core.run(`tp ${target} ${x} ${y} ${z}`);
    }
};