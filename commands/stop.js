const shutdown = require('../utils/shutdown');

module.exports = {
    name: 'stop',
    description: 'Shut the bot down completely (admin only)',
    usage: 'stop',
    level: 2,
    async execute(ctx) {
        ctx.tellrawCommand('Stopping...');
        shutdown(ctx, false);
    }
};