
module.exports = function bruhifyPlugin(bot) {
    let text = '';
    let active = false;
    let timer = null;

    let frame = 0;
    let sending = false;
    const INTERVAL = 50;
    const MAX_TEXT_LENGTH = 500;
    const GRADIENT_LENGTH = 360;
    const SPEED = 80;
    const SATURATION = 100;
    const LIGHTNESS = 60;
    let characters = [];

    function log(message) {
        console.log(`[${bot.id}] [Bruhify] ${message}`);
    }

    function hslToHex(h, s, l) {
        h = ((h % 360) + 360) % 360;

        s /= 100;
        l /= 100;

        const c = (1 - Math.abs(2 * l - 1)) * s;
        const hp = h / 60;
        const x = c * (1 - Math.abs((hp % 2) - 1));

        let r = 0;
        let g = 0;
        let b = 0;

        if (hp < 1) {
            r = c;
            g = x;
        } else if (hp < 2) {
            r = x;
            g = c;
        } else if (hp < 3) {
            g = c;
            b = x;
        } else if (hp < 4) {
            g = x;
            b = c;
        } else if (hp < 5) {
            r = x;
            b = c;
        } else {
            r = c;
            b = x;
        }

        const m = l - c / 2;

        const ri = Math.round((r + m) * 255);
        const gi = Math.round((g + m) * 255);
        const bi = Math.round((b + m) * 255);

        return (
            '#' +
            ri.toString(16).padStart(2, '0') +
            gi.toString(16).padStart(2, '0') +
            bi.toString(16).padStart(2, '0')
        );
    }

    function rebuildCharacters() {
        const chars = Array.from(text);
        const length = Math.max(chars.length, 1);

        characters = chars.map((char, index) => {
            const position = (index / Math.max(length - 1, 1)) * GRADIENT_LENGTH;

            return {
                text: char,
                position
            };
        });
    }

    function canSend() {
        return (
            active &&
            text.length > 0 &&
            !sending &&
            bot.core &&
            bot.core.ready === true &&
            typeof bot.core.run === 'function'
        );
    }

    function buildComponent() {
        const extra = new Array(characters.length);

        const offset = frame * SPEED;

        for (let i = 0; i < characters.length; i++) {
            const char = characters[i];
            const hue =
                (char.position + offset) %
                360;

            extra[i] = {
                text: char.text,
                color: hslToHex(
                    hue,
                    SATURATION,
                    LIGHTNESS
                )
            };
        }

        return {
            text: '',
            extra
        };
    }

    function sendActionBar() {
        if (!canSend()) return false;

        sending = true;

        try {
            const component = buildComponent();
            const json = JSON.stringify(component);

            const result = bot.core.run(
                `title @a actionbar ${json}`
            );
            sending = false;

            return result !== false;
        } catch (error) {
            sending = false;

            console.error(
                `[${bot.id}] [Bruhify] Send error:`,
                error
            );

            return false;
        }
    }

    function tick() {
        if (!active) return;

        if (!text || characters.length === 0) {
            return;
        }
        frame++;

        sendActionBar();
    }

    function start() {
        if (active) return;

        active = true;

        if (timer) {
            clearInterval(timer);
            timer = null;
        }

        timer = setInterval(
            tick,
            INTERVAL
        );
        tick();


    }

    function clearActionBar() {
        try {
            if (
                bot.core &&
                bot.core.ready === true &&
                typeof bot.core.run === 'function'
            ) {
                bot.core.run(
                    'title @a actionbar {"text":""}'
                );
            }
        } catch (error) {
            console.error(
                `[${bot.id}] [Bruhify] Clear error:`,
                error
            );
        }
    }

    function stop(clear = true) {
        if (!active && !timer) return;

        active = false;

        if (timer) {
            clearInterval(timer);
            timer = null;
        }

        if (clear) {
            clearActionBar();
        }

    }

    function setText(newText) {
        if (typeof newText !== 'string') {
            text = '';
            characters = [];

            stop(true);

            return false;
        }
        text = Array.from(newText)
            .slice(0, MAX_TEXT_LENGTH)
            .join('');

        rebuildCharacters();

        frame = 0;

        if (!text.length) {
            stop(true);
            return true;
        }

        if (!active) {
            start();
        } else {

            sendActionBar();
        }

        return true;
    }


    function setFrame(newFrame) {
        const value = Number(newFrame);

        if (!Number.isFinite(value)) {
            return false;
        }

        frame = value;

        return true;
    }

    bot.bruhify = {
        setText,

        start,

        stop,

        clear() {
            text = '';
            characters = [];
            frame = 0;

            stop(true);

            return true;
        },

        isActive() {
            return active;
        },

        getText() {
            return text;
        },

        getLength() {
            return characters.length;
        },

        setFrame,

        getFrame() {
            return frame;
        },

        refresh() {
            return sendActionBar();
        }
    };
    bot.on('bot:disconnect', () => {
        stop(false);

        text = '';
        characters = [];

        frame = 0;
        sending = false;
    });

    bot.on('bot:destroy', () => {
        stop(false);

        text = '';
        characters = [];

        frame = 0;
        sending = false;

    });

};
