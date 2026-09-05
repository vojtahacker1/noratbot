function toSNBT(obj) {
    if (typeof obj === 'string') {
        let safeStr = obj.replace(/\n/g, '\\n');
        safeStr = safeStr.replace(/'/g, "\\'");
        return `'${safeStr}'`;
    }
    if (typeof obj === 'number' || typeof obj === 'boolean') {
        return obj.toString();
    }
    if (Array.isArray(obj)) {
        return `[${obj.map(item => toSNBT(item)).join(',')}]`;
    }
    if (typeof obj === 'object' && obj !== null) {
        const pairs = [];
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                pairs.push(`${key}:${toSNBT(obj[key])}`);
            }
        }
        return `{${pairs.join(',')}}`;
    }
    return "''";
}

module.exports = {
    name: 'discord',
    description: 'Actual discord server link',
    aliases: ["ds", "dc"],
    level: 0,

    async execute(ctx) {
        const link = ctx.bot.globalConfig?.discord?.link;
        if (!link) {
            ctx.tellrawCommand('Discord link not configured.');
            return;
        }

        const components = [];

        components.push({
            text: `Discord server link - ${link}`,
            color: '#55aaff',
            click_event: {
                action: 'copy_to_clipboard',
                value: link
            },
            hover_event: {
                action: 'show_text',
                value: {
                    text: `Discord Server Invite\n\n• Server Link: ${link}\n\n» Click to copy invite link «`,
                    color: 'aqua'
                }
            }
        });
        const rootObject = {
            text: "",
            extra: components
        };

        const commandText = `tellraw @a ${toSNBT(rootObject)}`;
        ctx.run(commandText);
    }
};
