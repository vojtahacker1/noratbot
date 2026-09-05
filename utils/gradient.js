function hexToRgb(hex) {
    if (typeof hex !== 'string') throw new TypeError(`Invalid color: ${hex}`);
    hex = hex.replace('#', '').trim();
    if (!/^[0-9a-f]{6}$/i.test(hex)) throw new Error(`Invalid hex color: ${hex}`);
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

function gradient(text, start, end) {
    const a = hexToRgb(start);
    const b = hexToRgb(end);
    const chars = [...String(text)];
    if (!chars.length) return [];
    if (chars.length === 1) return [{ text: chars[0], color: start }];

    return chars.map((char, i) => {
        const t = i / (chars.length - 1);
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

module.exports = { gradient };