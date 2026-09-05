const gradient = require('../utils/gradient');

module.exports = {
    name: 'uuid',
    description: 'Get UUID of a player or your own',
    level: 0,

    async execute(ctx) {
        const args = ctx.args;
        let targetName = ctx.player.name;
        let isSelf = true;

        if (args.length > 0) {
            targetName = args.join(' ');
            isSelf = false;
        }

        let uuid = null;
        let isReal = false;

        if (ctx.bot.playersAPI && typeof ctx.bot.playersAPI.getUUID === 'function') {
            uuid = ctx.bot.playersAPI.getUUID(targetName);
            const playerObj = ctx.bot.playersAPI.get(targetName);
            if (playerObj && playerObj.uuid) {
                isReal = true;
            }
        }

        if (!uuid) {
            if (ctx.bot.playersAPI && typeof ctx.bot.playersAPI.offlineUUID === 'function') {
                uuid = ctx.bot.playersAPI.offlineUUID(targetName);
            } else {
                const crypto = require('crypto');
                const clean = targetName.replace(/§[0-9a-fk-or]/gi, '').trim();
                const hash = crypto.createHash('md5')
                    .update(Buffer.from(`OfflinePlayer:${clean}`, 'utf8'))
                    .digest();
                hash[6] = (hash[6] & 0x0f) | 0x30;
                hash[8] = (hash[8] & 0x3f) | 0x80;
                const hex = hash.toString('hex');
                uuid = `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
            }
        }

        if (!uuid) {
            ctx.tellrawCommand(`Could not determine UUID for "${targetName}"`);
            return;
        }

        let fullMessage = isSelf 
            ? `noratbot - Your UUID: ${uuid}` 
            : `noratbot - UUID of ${targetName}: ${uuid}`;


        const comps = gradient.gradient(fullMessage, '#f4fcff', '#238bff');
        for (const comp of comps) {
            comp.click_event = { action: 'copy_to_clipboard', value: uuid };
            comp.hover_event = { action: 'show_text', value: { text: 'Click to copy UUID', color: 'green' } };
        }

        ctx.tellraw('@a', { text: '', extra: comps });
    }
};