const fs = require('fs');
const path = require('path');
const storage = path.join(process.cwd(), 'cloops.json');

module.exports = function cloopPlugin(bot) {
    let db = {};
    let timers = new Map();

    function load() {
        try {
            if (!fs.existsSync(storage)) { save(); return; }
            const raw = fs.readFileSync(storage, 'utf8');
            if (!raw.trim()) { db = {}; save(); return; }
            db = JSON.parse(raw);
            for (const srv in db) {
                if (!Array.isArray(db[srv])) db[srv] = [];
                db[srv] = db[srv].filter(x =>
                    typeof x === 'object' &&
                    typeof x.id === 'number' &&
                    typeof x.interval === 'number' &&
                    typeof x.command === 'string'
                );
                db[srv].forEach((x, i) => x.id = i);
            }
        } catch (e) {
            console.error(`[${bot.id}] [Cloop] load fail:`, e);
            db = {};
        }
    }

    function save() {
        try {
            const out = {};
            for (const srv in db) {
                out[srv] = db[srv].map(x => ({ id: x.id, interval: x.interval, command: x.command }));
            }
            fs.writeFileSync(storage, JSON.stringify(out, null, 4), 'utf8');
        } catch (e) {
            console.error(`[${bot.id}] [Cloop] save fail:`, e);
        }
    }

    function startTimers(srv) {
        if (timers.has(srv)) {
            for (const t of timers.get(srv)) clearInterval(t);
            timers.delete(srv);
        }
        if (!db[srv]) return;
        const set = new Set();
        for (const item of db[srv]) {
            if (item.interval <= 0) continue;
            const t = setInterval(() => {
                if (bot.core && typeof bot.core.run === 'function') {
                    bot.core.run(item.command);
                }
            }, item.interval);
            set.add(t);
        }
        if (set.size) timers.set(srv, set);
    }

    bot.cloops = {
        add(srv, interval, cmd) {
            if (!srv || !interval || !cmd) return false;
            if (interval <= 0) return false;
            if (!db[srv]) db[srv] = [];
            let maxId = -1;
            for (const x of db[srv]) if (x.id > maxId) maxId = x.id;
            const newId = maxId + 1;
            db[srv].push({ id: newId, interval, command: cmd });
            save();
            startTimers(srv);
            return true;
        },
        remove(srv, id) {
            if (!db[srv]) return false;
            const idx = db[srv].findIndex(x => x.id === id);
            if (idx === -1) return false;
            db[srv].splice(idx, 1);
            db[srv].forEach((x, i) => x.id = i);
            save();
            startTimers(srv);
            return true;
        },
        list(srv) {
            if (!db[srv]) return [];
            return db[srv].map(x => ({ id: x.id, interval: x.interval, command: x.command }));
        },
        clear(srv) {
            if (!db[srv]) return false;
            db[srv] = [];
            save();
            startTimers(srv);
            return true;
        },
        startAll() {
            for (const srv in db) startTimers(srv);
        },
        stopAll(srv) {
            if (timers.has(srv)) {
                for (const t of timers.get(srv)) clearInterval(t);
                timers.delete(srv);
            }
        }
    };

    load();
    bot.cloops.startAll();

    bot.on('bot:login', () => {
        for (const srv in db) {
            bot.cloops.stopAll(srv);
            startTimers(srv);
        }
    });

    bot.on('bot:disconnect', () => {
        for (const srv in db) bot.cloops.stopAll(srv);
    });

    bot.on('bot:destroy', () => {
        for (const srv in db) bot.cloops.stopAll(srv);
    });
};