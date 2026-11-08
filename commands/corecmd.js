// usage: core <command>
// runs the command in a core command block and sends back what the block output (its LastOutput).
// note: a command block only keeps the LAST line a command printed.

module.exports = {
    name: 'core',
    description: 'Run a command in the core and show its output',
    level: 2,

    async execute(ctx) {
        const core = ctx.bot.core;
        const command = (ctx.args || []).join(' ').trim().replace(/^\//, '');

        if (!command) return ctx.tellrawCommand('Usage: core <command>');
        if (!core || typeof core.runTracked !== 'function') {
            return ctx.tellrawCommand('Core is not loaded (or core.js has no runTracked).');
        }
        if (!core.ready) return ctx.tellrawCommand('Core is not ready.');

        const started = Date.now();
        const output = await core.runTracked(command);
        const took = Date.now() - started;

        if (core._lastRunOk === false) {
            return ctx.tellrawCommand('The core could not run the command (no free command block).');
        }
        if (output === null || output === undefined) {
            return ctx.tellrawCommand(`No output after ${took}ms (the command printed nothing, failed, or the bot is not op).`);
        }

        // drop the "[hh:mm:ss] " timestamp the command block puts in front
        const text = String(output).replace(/^\[\d{1,2}:\d{2}:\d{2}\]\s*/, '').trim();
        ctx.tellrawCommand(`Output (${took}ms): ${text.slice(0, 500)}${text.length > 500 ? '...' : ''}`);
    }
};
