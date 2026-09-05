function hslToHex(h, s, l) {
    s /= 100;
    l /= 100;
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    const toHex = x => Math.round(255 * x).toString(16).padStart(2, '0');
    return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

module.exports = {
    name: 'rainbowify',
    description: 'Make text rainbow colored',
    level: 0,
    async execute(ctx) {
        const text = ctx.args.join(' ');
        if (!text) {
            ctx.tellrawCommand('Usage: rainbowify <text>');
            return;
        }

        const components = [];
        const len = text.length;
        for (let i = 0; i < len; i++) {
            const hue = (i / len) * 360;
            const color = hslToHex(hue, 90, 60);
            components.push({
                text: text[i],
                color: color
            });
        }

        ctx.run(`tellraw @a ${JSON.stringify({ text: '', extra: components })}`);
    }
};