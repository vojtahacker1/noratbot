module.exports = {
    name: 'music',
    description: 'Play MIDI files or URLs, manage queue, settings',
    aliases: ["m"],
    level: 0,

    async execute(ctx) {
        const args = ctx.args;
        if (!args.length) {
            ctx.tellrawCommand('Usage: music <list|play|stop|pause|resume|queue|volume|pitch|loop|display|status> [params]');
            return;
        }

        const sub = args[0].toLowerCase();
        const music = ctx.bot.music;

        if (!music || typeof music.list !== 'function') {
            ctx.tellrawCommand('Music plugin not loaded.');
            return;
        }
        if (sub === 'list') {
            const tracks = music.list();
            if (!tracks.length) {
                ctx.tellrawCommand('No .mid or .nbs files found. Add them to music/ folder.');
            } else {
                ctx.tellrawCommand(`Available tracks: ${tracks.join(', ')}`);
            }
            return;
        }
        if (sub === 'play') {
            const name = args[1];
            if (!name) {
                ctx.tellrawCommand('Usage: music play <track_name or URL>');
                return;
            }
            if (music.isPlaying()) {
                ctx.tellrawCommand('A track is already playing. Use "music queue add <name>" to add to queue.');
                return;
            }
            const ok = await music.play(name);
            if (ok) {
                ctx.tellrawCommand(`Now playing: ${name}`);
            } else {
                ctx.tellrawCommand(`Failed to play "${name}" (not found or invalid).`);
            }
            return;
        }
        if (sub === 'stop') {
            if (!music.isPlaying()) {
                ctx.tellrawCommand('No track is playing.');
                return;
            }
            music.stop();
            ctx.tellrawCommand('Stopped.');
            return;
        }
        if (sub === 'pause') {
            if (!music.isPlaying()) {
                ctx.tellrawCommand('No track is playing.');
                return;
            }
            if (music.isPaused()) {
                ctx.tellrawCommand('Already paused.');
                return;
            }
            music.pause();
            ctx.tellrawCommand('Paused.');
            return;
        }
        if (sub === 'resume') {
            if (!music.isPlaying()) {
                ctx.tellrawCommand('No track is playing.');
                return;
            }
            if (!music.isPaused()) {
                ctx.tellrawCommand('Not paused.');
                return;
            }
            music.resume();
            ctx.tellrawCommand('Resumed.');
            return;
        }
        if (sub === 'queue') {
            const qSub = args[1]?.toLowerCase();
            if (qSub === 'add') {
                const name = args[2];
                if (!name) {
                    ctx.tellrawCommand('Usage: music queue add <track_name or URL>');
                    return;
                }
                const isUrl = name.startsWith('http://') || name.startsWith('https://');
                const ok = music.queue.add(name);
                if (ok) {
                    ctx.tellrawCommand(`Added "${name}" to queue.`);
                } else {
                    if (isUrl) {
                        ctx.tellrawCommand(`Failed to add URL to queue.`);
                    } else {
                        ctx.tellrawCommand(`Track "${name}" not found.`);
                    }
                }
                return;
            }
            if (qSub === 'list') {
                const list = music.queue.list();
                if (!list.length) {
                    ctx.tellrawCommand('Queue is empty.');
                } else {
                    ctx.tellrawCommand(`Queue: ${list.join(', ')}`);
                }
                return;
            }
            if (qSub === 'clear') {
                music.queue.clear();
                ctx.tellrawCommand('Queue cleared.');
                return;
            }
            if (qSub === 'skip') {
                const skipped = music.queue.skip();
                if (skipped) {
                    ctx.tellrawCommand('Skipped to next track.');
                } else {
                    ctx.tellrawCommand('Queue is empty.');
                }
                return;
            }
            ctx.tellrawCommand('Usage: music queue <add|list|clear|skip>');
            return;
        }
        if (sub === 'skip') {
            const skipped = music.queue.skip();
            if (skipped) {
                ctx.tellrawCommand('Skipped to next track.');
            } else {
                ctx.tellrawCommand('Queue is empty.');
            }
            return;
        }
        if (sub === 'volume') {
            const val = parseFloat(args[1]);
            if (isNaN(val) || val < 0 || val > 2) {
                ctx.tellrawCommand('Usage: music volume <0.0-2.0>');
                return;
            }
            music.settings.setVolume(val);
            ctx.tellrawCommand(`Volume set to ${val}`);
            return;
        }
        if (sub === 'pitch') {
            const val = parseFloat(args[1]);
            if (isNaN(val) || val < 0.5 || val > 2.0) {
                ctx.tellrawCommand('Usage: music pitch <0.5-2.0>');
                return;
            }
            music.settings.setPitchShift(val);
            ctx.tellrawCommand(`Pitch shift set to ${val}`);
            return;
        }
        if (sub === 'loop') {
            const val = args[1]?.toLowerCase();
            if (val === 'on' || val === 'true') {
                music.settings.setLoop(true);
                ctx.tellrawCommand('Loop enabled');
            } else if (val === 'off' || val === 'false') {
                music.settings.setLoop(false);
                ctx.tellrawCommand('Loop disabled');
            } else {
                ctx.tellrawCommand('Usage: music loop <on|off>');
            }
            return;
        }
        if (sub === 'display') {
            const mode = args[1]?.toLowerCase();
            if (mode === 'bossbar' || mode === 'actionbar') {
                music.settings.setDisplay(mode);
                ctx.tellrawCommand(`Display mode set to ${mode}`);
            } else {
                ctx.tellrawCommand('Usage: music display <bossbar|actionbar>');
            }
            return;
        }
        if (sub === 'status') {
            const current = music.current();
            const playing = music.isPlaying();
            const paused = music.isPaused();
            const vol = music.settings.getVolume();
            const pitch = music.settings.getPitchShift();
            const loop = music.settings.getLoop();
            const display = music.settings.getDisplay();
            const queueList = music.queue.list();
            const statusText = `Status: ${playing ? (paused ? '⏸ Paused' : '▶ Playing') : '⏹ Stopped'}\n` +
                               `Current: ${current || 'none'}\n` +
                               `Volume: ${vol}\nPitch: ${pitch}\nLoop: ${loop ? 'ON' : 'OFF'}\n` +
                               `Display: ${display}\nQueue: ${queueList.length ? queueList.join(', ') : 'empty'}`;
            ctx.tellrawCommand(statusText);
            return;
        }

        ctx.tellrawCommand('Usage: music <list|play|stop|pause|resume|queue|skip|volume|pitch|loop|display|status> [params]');
    }
};