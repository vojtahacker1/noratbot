module.exports = {
    name: 'chattranslate',
    description: 'Auto-translate chat and announce it to everyone without the notranslate tag',
    aliases: ['ct'],
    usage: 'chattranslate <on|off|lang <code>>',
    level: 1,

    async execute(ctx) {
        const ct = ctx.bot.chatTranslate;
        if (!ct) {
            ctx.tellrawCommand('ChatTranslate plugin not loaded.');
            return;
        }

        const say = ctx.tellrawCommand.bind(ctx);
        const sub = (ctx.args[0] || '').toLowerCase();

        if (!sub || sub === 'status') {
            say(`ChatTranslate is ${ct.isEnabled() ? 'ON' : 'OFF'} (target: ${ct.getLang()}). Usage: chattranslate <on|off|lang <code>>`);
            return;
        }

        if (sub === 'on' || sub === 'enable') {
            ct.setEnabled(true);
            say(`ChatTranslate enabled (target: ${ct.getLang()}). Opt out with /tag @s add ${ct.tag}`);
            return;
        }

        if (sub === 'off' || sub === 'disable') {
            ct.setEnabled(false);
            say('ChatTranslate disabled.');
            return;
        }

        if (sub === 'lang') {
            if (!ctx.args[1]) return say(`Target language is ${ct.getLang()}. Usage: chattranslate lang <code> (e.g. en, cs, de)`);
            if (!ct.setLang(ctx.args[1])) return say('Invalid language code. Use something like en, cs, de or pt-BR.');
            say(`ChatTranslate target language set to ${ct.getLang()}`);
            return;
        }

        say(`Unknown option: ${sub}. Usage: chattranslate <on|off|lang <code>>`);
    }
};