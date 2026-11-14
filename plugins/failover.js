'use strict';
const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(process.cwd(), 'failover.json');

function loadState() {
    try {
        if (!fs.existsSync(STATE_FILE)) return {};
        const raw = fs.readFileSync(STATE_FILE, 'utf8');
        if (!raw.trim()) return {};
        return JSON.parse(raw);
    } catch (e) { return {}; }
}

function saveState(state) {
    try { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8'); } catch (e) {}
}

module.exports = function failoverPlugin(bot) {
    const cfg = bot.globalConfig?.failover || bot.config?.failover || {};
    if (cfg.enabled === false) return;

    const role = String(cfg.role || 'executor').toLowerCase();
    const heartbeatMs = Number(cfg.heartbeatMs) || 3000;
    const timeoutMs = Number(cfg.timeoutMs) || 15000;
    const lives = Number(cfg.lives) || 2;

    let timer = null;
    let currentLives = lives;
    let promoted = (role === 'manager');

    function heartbeat() {
        const state = loadState();
        state.managerId = bot.id;
        state.heartbeat = Date.now();
        state.lives = currentLives;
        saveState(state);
    }

    function check() {
        const state = loadState();
        if (state.managerId === bot.id) {
            // I am manager; just heartbeat.
            heartbeat();
            return;
        }
        const last = Number(state.heartbeat) || 0;
        if (Date.now() - last > timeoutMs) {
            if (currentLives > 0) {
                currentLives--;
                // Promote self.
                saveState({ managerId: bot.id, heartbeat: Date.now(), lives: currentLives, promotedAt: Date.now(), previousManager: state.managerId });
                promoted = true;
                console.log(`[${bot.id}] [Failover] Promoted to manager (lives left: ${currentLives})`);
                // Start heartbeating as manager.
                if (timer) clearInterval(timer);
                timer = setInterval(heartbeat, heartbeatMs);
                heartbeat();
            } else {
                console.log(`[${bot.id}] [Failover] No lives left; staying executor.`);
            }
        }
    }

    if (promoted) {
        timer = setInterval(heartbeat, heartbeatMs);
        heartbeat();
    } else {
        timer = setInterval(check, Math.min(heartbeatMs, 2000));
    }

    bot.failover = {
        role, promoted: () => promoted, lives: () => currentLives,
        promote: () => {
            promoted = true;
            if (timer) clearInterval(timer);
            timer = setInterval(heartbeat, heartbeatMs);
            heartbeat();
            console.log(`[${bot.id}] [Failover] Manually promoted.`);
            return true;
        },
        demote: () => {
            promoted = false;
            if (timer) clearInterval(timer);
            timer = setInterval(check, Math.min(heartbeatMs, 2000));
            console.log(`[${bot.id}] [Failover] Demoted to executor.`);
            return true;
        }
    };

    bot.on('end', () => { if (timer) clearInterval(timer); });
};
