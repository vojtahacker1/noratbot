const wiki = require('wikipedia');
const gradient = require('../utils/gradient');

function grad(text, start, end) {
    return gradient.gradient(text, start, end);
}

function toSNBT(obj) {
    if (typeof obj === 'string') {
        if (obj.includes('://') || obj.startsWith('Click')) {
            let safeStr = obj.replace(/\n/g, '\\n').replace(/"/g, '\\"');
            return `"${safeStr}"`;
        }
        let safeStr = obj.replace(/\n/g, '\\n').replace(/'/g, "\\'");
        return `'${safeStr}'`;
    }
    if (typeof obj === 'number' || typeof obj === 'boolean') {
        return obj.toString();
    }
    if (Array.isArray(obj)) {
        return `[${obj.map(item => toSNBT(item)).join(',')}]`;
    }
    if (typeof obj === 'object' && obj !== null) {
        const pairs = [];
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                pairs.push(`${key}:${toSNBT(obj[key])}`);
            }
        }
        return `{${pairs.join(',')}}`;
    }
    return "''";
}

module.exports = {
    name: 'wikipedia',
    description: 'Search Wikipedia and show full page introduction',
    aliases: ["wiki"],
    level: 0,

    async execute(ctx) {
        const query = ctx.args.join(' ').trim();
        if (!query) {
            ctx.tellrawCommand('Usage: wikipedia <search query>');
            return;
        }

        try {
            const page = await wiki.page(query);
            const introText = await page.intro(); 
            const title = page.title || 'Unknown title';
            
            let extract = introText || 'No description available.';
            extract = extract.replace(/\r?\n|\r/g, ' ').trim(); 
            
            const url = page.fullurl || '';
            const out = [];
            out.push(...grad('Wikipedia\n', '#f4fcff', '#238bff'));
            out.push({ text: 'Title: ', color: '#62d66b' });
            out.push(...grad(`${title}\n`, '#f4fcff', '#238bff'));
            if (extract.toLowerCase().includes('may refer to') && extract.length < 100) {
                try {
                    const links = await page.links();
                    const sliceLinks = links.slice(0, 4).map(l => `• ${l}`).join('  ');
                    extract = `${extract}\n${sliceLinks}`;
                } catch (e) {
                }
            }

            out.push({ text: 'Summary: ', color: '#62d66b' });
            const truncated = extract.length > 800 ? extract.slice(0, 800) + '...' : extract;
            
            const lines = truncated.split('\n');
            for (let i = 0; i < lines.length; i++) {
                out.push({ text: lines[i], color: 'white' });
                if (i < lines.length - 1) out.push({ text: '\n', color: 'gray' });
            }
            out.push({ text: '\n', color: 'gray' });
            if (url) {
                out.push({ text: 'Link: ', color: '#62d66b' });
                out.push({
                    text: url,
                    color: '#55aaff',
                    click_event: {
                        action: 'open_url',
                        url: url
                    },
                    hover_event: {
                        action: 'show_text',
                        value: { text: 'Click to open Wikipedia page', color: 'aqua' }
                    }
                });
            }

            if (out.length && out[out.length - 1].text === '\n') {
                out.pop();
            }

            const rootObject = { text: "", extra: out };
            ctx.run(`tellraw @a ${toSNBT(rootObject)}`);

        } catch (error) {
            console.error('[Wikipedia] Error:', error);
            ctx.tellrawCommand(`Wikipedia error: ${error.message}`);
        }
    }
};
