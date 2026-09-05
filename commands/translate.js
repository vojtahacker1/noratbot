const { translate } = require('@deeplx/core');
const gradient = require('../utils/gradient');

function grad(text, start, end) {
    return gradient.gradient(text, start, end);
}

function toSNBT(obj) {
    if (typeof obj === 'string') {
        let safeStr = obj.replace(/\n/g, '\\n').replace(/'/g, "\\'");
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
    name: 'translate',
    description: 'Translate text',
    aliases: ["tr"],
    level: 0,

    async execute(ctx) {
        const args = ctx.args;
        if (args.length < 2) {
            ctx.tellrawCommand('Usage: translate <lang> <text>');
            return;
        }
        const targetLang = args[0].toUpperCase();
        const text = args.slice(1).join(' ');

        if (!text.trim()) {
            ctx.tellrawCommand('Text cannot be empty.');
            return;
        }

        try {
            const translated = await translate(text, targetLang);

            if (!translated) {
                ctx.tellrawCommand('No translation returned.');
                return;
            }

            const extra = [];
            extra.push(...grad('Translation', '#f4fcff', '#238bff'));
            extra.push({ text: '\n', color: 'gray' });

            extra.push({ text: 'Original: ', color: '#62d66b' });
            extra.push(...grad(text, '#f4fcff', '#238bff'));
            extra.push({ text: '\n', color: 'gray' });

            extra.push({ text: 'Translated: ', color: '#62d66b' });
            extra.push(...grad(translated, '#f4fcff', '#238bff'));

            const root = { text: '', extra };
            ctx.run(`tellraw @a ${toSNBT(root)}`);
        } catch (error) {
            console.error('[Translate] Error:', error);
            ctx.tellrawCommand('Translation failed. Please try again later.');
        }
    }
};