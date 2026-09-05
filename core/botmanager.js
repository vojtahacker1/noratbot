const EventEmitter = require('events');
const Bot = require('./botinstance');

class Manager extends EventEmitter {
    constructor(cfg) {
        super();
        this.cfg = cfg || {};
        this.bots = new Map();
    }

    create(srv) {
        if (!srv) throw new Error('Missing server config');
        const id = String(srv.id || '').trim();
        if (!id) throw new Error('Server ID required');
        if (this.bots.has(id)) throw new Error(`Bot "${id}" already exists`);

        const bot = new Bot(this.cfg, srv);
        this.bots.set(id, bot);
        bot.manager = this;
        this.attach(bot);
        this.emit('bot:created', bot);
        bot.start();
        return bot;
    }

    attach(bot) {
        const evs = [
            'bot:connecting', 'bot:login', 'bot:ready', 'bot:disconnect',
            'bot:error', 'bot:reconnect', 'bot:destroy',
            'chat', 'chat_plain', 'command',
            'plugin:loaded', 'plugin:error'
        ];
        for (const e of evs) {
            bot.on(e, (...args) => this.emit(e, bot, ...args));
        }
        bot.on('bot:destroy', () => {
            if (this.bots.get(bot.id) === bot) this.bots.delete(bot.id);
        });
    }

    get(id) { return this.bots.get(String(id)) || null; }
    has(id) { return this.bots.has(String(id)); }
    list() { return [...this.bots.values()]; }

    async restart(id) {
        const bot = this.get(id);
        if (!bot) return false;
        await bot.stop();
        bot.start();
        return true;
    }

    async destroy(id) {
        const bot = this.get(id);
        if (!bot) return false;
        await bot.destroy();
        this.bots.delete(String(id));
        return true;
    }

    async stopAll() {
        for (const bot of this.list()) {
            try { await bot.stop(); }
            catch (e) { console.error(`[Manager] stop ${bot.id} fail:`, e); }
        }
    }

    async destroyAll() {
        for (const bot of this.list()) {
            try { await bot.destroy(); }
            catch (e) { console.error(`[Manager] destroy ${bot.id} fail:`, e); }
        }
        this.bots.clear();
    }
}

module.exports = Manager;