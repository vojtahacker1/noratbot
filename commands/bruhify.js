module.exports = {
    name: 'bruhify',
    description: 'Show text in actionbar with rainbow hue effect',
    aliases: ["bh"],
    level: 0,

    async execute(ctx) {
        const args = ctx.args;
        if (args.length === 0) {
            if (ctx.bot.bruhify) {
                ctx.bot.bruhify.stop();
                ctx.tellrawCommand('Bruhify disabled.');
            } else {
                ctx.tellrawCommand('Bruhify plugin not loaded.');
            }
            return;
        }

        const text = args.join(' ');
        if (!ctx.bot.bruhify) {
            ctx.tellrawCommand('Bruhify plugin not loaded.');
            return;
        }

        ctx.bot.bruhify.setText(text);
        ctx.tellrawCommand(`Bruhify set to: ${text}`);
    }
};