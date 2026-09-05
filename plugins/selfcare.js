const RETRY_DELAY = 700;

function randomHex(length) {
    const chars = '0123456789abcdef';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars[Math.floor(Math.random() * 16)];
    }
    return result;
}

module.exports = function selfcare(bot) {
    bot.tagname = randomHex(16);

    let opLevel = 0;
    let gm = null;
    let muted = false;
    let unmuting = false;

    let spyOn = false;
    let opReq = false;
    let creativeReq = false;
    let spyReq = false;
    let vanished = false;
    let vanishReq = false;

    let ready = false;
    let timer = null;
    const cfg = bot.globalConfig?.bot || {};



    function executeWithCore(cmd, maxAttempts = 10) {
        let attempts = 0;
        return new Promise((resolve) => {
            function tryExecute() {
                if (attempts >= maxAttempts) {
                    resolve(false);
                    return;
                }
                attempts++;
                if (bot.core && bot.core.ready && typeof bot.core.run === 'function') {
                    const result = bot.core.run(cmd);
                    resolve(result !== false);
                } else {
                    setTimeout(tryExecute, 500);
                }
            }
            tryExecute();
        });
    }

    function run(cmd) {
        if (typeof bot.chat !== 'function') {
            return false;
        }
        try {
            bot.chat(cmd);
            return true;
        } catch (e) {
            console.error(`[${bot.id}] [SelfCare] Command error:`, e);
            return false;
        }
    }

    function onOpChange(pkt) {
        if (!pkt || typeof pkt.entityStatus !== 'number') return;
        const status = Number(pkt.entityStatus);
        if (status < 24 || status > 28) return;

        const myId = bot.client?.entityId;
        if (myId != null && Number(pkt.entityId) !== Number(myId)) return;

        const newLevel = status - 24;

        if (newLevel === 0) {
            opLevel = 0;
            if (opReq) return;
            if (cfg.creative !== false) askOp();
            return;
        }

        opLevel = newLevel;
        opReq = false;

        if (ready && cfg.creative !== false && gm !== 1) {
            setTimeout(() => ensureCreative(), 300);
        }
    }

    function askOp() {
        if (!ready) return;
        if (opLevel !== 0) return;
        if (opReq) return;
        if (cfg.creative === false) return;

        opReq = true;
        run('/op @s[type=player]');
        setTimeout(() => {
            opReq = false;
            if (ready && opLevel === 0) {
                setTimeout(() => {
                    if (ready && opLevel === 0 && !opReq) askOp();
                }, 5000);
            }
        }, RETRY_DELAY);
    }

    function ensureCreative() {
        if (!ready) return;
        if (cfg.creative === false) return;
        if (gm === null) return;
        if (gm === 1) {
            creativeReq = false;
            return;
        }
        if (creativeReq) return;

        if (opLevel === 0) {
            if (!opReq) askOp();
            return;
        }

        creativeReq = true;
        run('/gamemode creative');
        setTimeout(() => {
            creativeReq = false;
            if (ready && gm !== 1) ensureCreative();
        }, RETRY_DELAY);
    }

    function enableSpy() {
        if (!ready) return;
        if (cfg.commandSpy === false) return;
        if (spyOn) return;
        if (spyReq) return;

        spyReq = true;
        executeWithCore(`c ${bot.client.uuid} on`).then(success => {
            spyReq = false;
            if (success) {
                spyOn = true;
            } else {
                setTimeout(() => {
                    if (ready && !spyOn) enableSpy();
                }, RETRY_DELAY);
            }
        });
    }

    function ensureVanish() {
        if (!ready) return;
        if (cfg.vanish === false) return;
        if (vanished) return;
        if (vanishReq) return;

        vanishReq = true;
        executeWithCore(`vanish ${bot.client.username} enable`).then(success => {
            vanishReq = false;
            if (success) {
                vanished = true;
            } else {
                setTimeout(() => {
                    if (ready && !vanished) ensureVanish();
                }, RETRY_DELAY);
            }
        });
    }

    function unmuteMe() {
        if (!ready) return;
        if (cfg.unmute === false) return;
        if (!muted) return;
        if (unmuting) return;

        unmuting = true;
        executeWithCore(`mute ${bot.client.uuid} 0s`).then(success => {
            unmuting = false;
            if (success) {
                muted = false;
            } else {
                setTimeout(() => {
                    if (ready && muted) unmuteMe();
                }, RETRY_DELAY * 2);
            }
        });
    }

    function onLogin() {
        opLevel = 0;
        gm = null;
        spyOn = false;
        muted = false;
        unmuting = false;
        opReq = false;
        creativeReq = false;
        spyReq = false;
        ready = true;

        setTimeout(() => {
            if (!ready) return;
            enableSpy();
            if (cfg.creative !== false) askOp();
            if (cfg.vanish !== false) ensureVanish();
        }, 1500);
    }

    function onGameStateChange(pkt) {
        if (!pkt || pkt.reason !== 'change_game_mode') return;
        gm = Number(pkt.gameMode);
        creativeReq = false;
        if (gm !== 1) ensureCreative();
    }

    function onRespawn(pkt) {
        if (!pkt || pkt.gamemode === undefined) return;
        gm = Number(pkt.gamemode);
        creativeReq = false;
        ensureCreative();
    }

    function onChatPlain(msg) {
        if (typeof msg !== 'string') return;
        const text = msg.replace(/\x1b\[[0-9;]*m/g, '').trim();
        if (!text) return;
        const lower = text.toLowerCase();

        if (lower === 'successfully enabled commandspy') {
            spyOn = true;
            spyReq = false;
            return;
        }
        if (lower === 'successfully disabled commandspy') {
            spyOn = false;
            spyReq = false;
            setTimeout(() => { if (ready) enableSpy(); }, 100);
            return;
        }

        if (lower === 'you have been muted for now.' || lower === 'you can now talk again.') {
            muted = false;
            unmuting = false;
            return;
        }
        if (lower === 'you have been muted!' || lower === 'your voice has been silenced!') {
            muted = true;
            unmuting = false;
            unmuteMe();
            return;
        }
        if (lower.includes('you have been muted for') && !lower.includes('now')) {
            muted = true;
            unmuting = false;
            unmuteMe();
            return;
        }
        if (lower.includes('your voice has been silenced for') && !lower.includes('now')) {
            muted = true;
            unmuting = false;
            unmuteMe();
            return;
        }
        const botName = bot.config?.username || bot.username;
        const vanishEnabled = `vanish for ${botName.toLowerCase()}: enabled`;
        const vanishDisabled = `vanish for ${botName.toLowerCase()}: disabled`;
        if (lower.includes(vanishEnabled)) {
            vanished = true;
            vanishReq = false;
            return;
        }
        if (lower.includes(vanishDisabled)) {
            vanished = false;
            vanishReq = false;
            if (cfg.vanish !== false) {
                setTimeout(() => { if (ready && !vanished) ensureVanish(); }, 100);
            }
            return;
        }
    }

    function onBotDisconnect() {
        ready = false;
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
    }

    function onBotError(err) {
        console.error(`[${bot.id}] [SelfCare] Error:`, err);
    }

    function destroy() {
        ready = false;
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
        bot.removeListener('login', onLogin);
        bot.removeListener('entity_status', onOpChange);
        bot.removeListener('game_state_change', onGameStateChange);
        bot.removeListener('respawn', onRespawn);
        bot.removeListener('chat_plain', onChatPlain);
        bot.removeListener('bot:disconnect', onBotDisconnect);
        bot.removeListener('bot:error', onBotError);
        bot.removeListener('bot:destroy', destroy);
    }

    bot.on('login', onLogin);
    bot.on('entity_status', onOpChange);
    bot.on('game_state_change', onGameStateChange);
    bot.on('respawn', onRespawn);
    bot.on('chat_plain', onChatPlain);
    bot.on('bot:disconnect', onBotDisconnect);
    bot.on('bot:error', onBotError);
    bot.on('bot:destroy', destroy);

    timer = setInterval(() => {
        if (!ready) return;
        ensureCreative();
        if (cfg.commandSpy !== false && !spyOn && !spyReq) {
            enableSpy();
        }
        if (cfg.vanish !== false && !vanished && !vanishReq) {
            ensureVanish();
        }
    }, 3000);

    bot.selfcare = {
        getPermissionLevel: () => opLevel,
        getGamemode: () => gm,
        isOperator: () => opLevel > 0,
        isCreative: () => gm === 1,
        isCommandSpyEnabled: () => spyOn,
        isMuted: () => muted,
        checkCreative: ensureCreative,
        isVanished: () => vanished,
        enableCommandSpy: enableSpy,
        execute: run,
        ensureVanish
    };
};