const fs = require('fs');
const path = require('path');
const BotManager = require('./core/botmanager');

const configPath = path.join(__dirname, 'config.json');

function loadConfig() {
    if (!fs.existsSync(configPath)) {
        throw new Error(`Config not found at ${configPath}`);
    }
    let config;
    try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (error) {
        throw new Error(`Failed to parse config.json: ${error.message}`);
    }
    return config;
}

const config = loadConfig();
const manager = new BotManager(config);
global.botManager = manager;

manager.on('bot:created', bot => {});
manager.on('bot:connecting', bot => {
    console.log(`[${bot.id}] Connecting to ${bot.config.host}:${bot.config.port}`);
});
manager.on('bot:ready', () => {});
manager.on('bot:disconnect', (bot, reason) => {
    console.log(`[${bot.id}] Disconnected`, reason || '');
});
manager.on('bot:error', (bot, error) => {
    console.error(`[${bot.id}] Error:`, error);
});
manager.on('bot:reconnect', bot => {
    console.log(`[${bot.id}] Reconnecting...`);
});
manager.on('bot:failed', (bot, reason) => {
    console.log(`[${bot.id}] Failed permanently:`, reason);
});

const servers = Array.isArray(config?.minecraft?.servers)
    ? config.minecraft.servers
    : [];

global.botInitializing = true;

async function startBotsWithDelay() {
    const delayMs = 500; 
    for (const server of servers) {
        if (!server || server.enabled !== true) continue;
        try {
            manager.create(server);
            console.log(`[Manager] Created ${server.id}`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
        } catch (error) {
            console.error(`[Manager] Failed to create ${server.id}:`, error);
        }
    }
}

startBotsWithDelay()
    .then(() => {
        global.botInitializing = false;
        console.log('[Manager] All bots created. Starting deferred reconnects...');
        for (const bot of manager.list()) {
            if (!bot.ready && bot.pendingReconnect) {
                bot.startReconnect();
            }
        }
    })
    .catch(err => {
        console.error('[Manager] Error during startup:', err);
        global.botInitializing = false;
    });

process.on('uncaughtException', error => {
    console.error('[Process] Uncaught exception:', error);
});
process.on('unhandledRejection', error => {
    console.error('[Process] Unhandled rejection:', error);
});

module.exports = manager;