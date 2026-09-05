module.exports = {
    name: 'validate',
    description: 'Authorize with hash or show current level',
    aliases: ['auth', 'val'],
    level: 0,

    async execute(ctx) {
        const uuid = ctx.player.uuid;
        if (!uuid) {
            ctx.tellrawCommand('Unable to determine your UUID.');
            return;
        }
        const currentLevel = ctx.bot.commands.getPlayerLevel(uuid);

        if (ctx.args.length > 0) {
            const hash = ctx.args[0];
            const tKey = ctx.bot.globalConfig?.bot?.trustedKey;
            const aKey = ctx.bot.globalConfig?.bot?.adminKey;
            const verify = ctx.bot.verifyHash;

            if (!verify) {
                ctx.tellrawCommand('Validation plugin not loaded.');
                return;
            }

            let level = null;
            let role = null;

            if (tKey && verify(hash, tKey)) {
                level = 1;
                role = 'trusted';
            } else if (aKey && verify(hash, aKey)) {
                level = 2;
                role = 'admin';
            }

            if (level !== null) {
                ctx.bot.commands.setPlayerLevel(uuid, level);
                ctx.tellrawCommand(`Authorized as ${role}`);
                return;
            } else {
                ctx.tellrawCommand('Invalid hash.');
                return;
            }
        }

        let levelText = 'public';
        if (currentLevel >= 2) {
            levelText = 'admin';
        } else if (currentLevel >= 1) {
            levelText = 'trusted';
        }
        ctx.tellrawCommand(`Your current level: ${levelText}`);
    }
};