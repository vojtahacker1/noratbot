// index.js treats this exit code as "start me again"
const RESTART_CODE = 42;

module.exports = async function shutdown(ctx, restart) {
    // let the chat message go out before the connection closes
    await new Promise(resolve => setTimeout(resolve, 500));

    try {
        const manager = ctx.bot.manager;
        if (manager) await manager.destroyAll();
        else await ctx.bot.destroy();
    } catch (error) {
        console.error('[Shutdown] Failed to close bots:', error);
    }

    setTimeout(() => process.exit(restart ? RESTART_CODE : 0), 500);
};