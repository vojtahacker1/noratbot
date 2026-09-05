function hexToRgb(hex) {
    hex = hex.replace('#', '');
    return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16)
    };
}

function rgbToHex(r, g, b) {
    return '#' + [r, g, b]
        .map(v => Math.round(v).toString(16).padStart(2, '0'))
        .join('');
}

function skyGradient(text) {
    const palette = [
        hexToRgb('#F2FCFF'),
        hexToRgb('#BDEFFF'),
        hexToRgb('#72D9FF'),
        hexToRgb('#4DA8FF')
    ];
    const chars = [...String(text)];
    if (!chars.length) return [];
    if (chars.length === 1) return [{ text: chars[0], color: '#BDEFFF' }];

    return chars.map((char, i) => {
        const pos = i / (chars.length - 1);
        const scaled = pos * (palette.length - 1);
        const idx = Math.min(Math.floor(scaled), palette.length - 2);
        const t = scaled - idx;
        const a = palette[idx];
        const b = palette[idx + 1];
        return {
            text: char,
            color: rgbToHex(
                a.r + (b.r - a.r) * t,
                a.g + (b.g - a.g) * t,
                a.b + (b.b - a.b) * t
            )
        };
    });
}

function levelGradient(text, level) {
    const palettes = {
        0: ['#F2FFF5', '#B9F5C8', '#63D98A'],
        1: ['#FFF5F5', '#FFBABA', '#FF7777'],
        2: ['#FFECEC', '#FF7777', '#C52F42']
    };
    const pal = palettes[level] || palettes[0];
    const chars = [...String(text)];
    if (!chars.length) return [];

    return chars.map((char, i) => {
        const t = chars.length === 1 ? 0 : i / (chars.length - 1);
        const a = hexToRgb(pal[0]);
        const b = hexToRgb(pal[1]);
        const c = hexToRgb(pal[2]);
        let from, to, local;
        if (t < 0.5) {
            from = a;
            to = b;
            local = t * 2;
        } else {
            from = b;
            to = c;
            local = (t - 0.5) * 2;
        }
        return {
            text: char,
            color: rgbToHex(
                from.r + (to.r - from.r) * local,
                from.g + (to.g - from.g) * local,
                from.b + (to.b - from.b) * local
            )
        };
    });
}

function plainComponent(text, color = '#FFFFFF') {
    return { text: String(text), color };
}

module.exports = {
    sky: skyGradient,
    level: levelGradient,
    component: plainComponent
};