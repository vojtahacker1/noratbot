const gradient = require('../utils/gradient');

function grad(text, start, end) {
    return gradient.gradient(text, start, end);
}
function toSNBT(obj) {
    if (typeof obj === 'string') {
        let safeStr = obj.replace(/\n/g, '\\n'); 
        safeStr = safeStr.replace(/'/g, "\\'");
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
    name: 'players',
    description: 'List online players with clickable UUIDs (paginated)',
    aliases: ["list"],
    level: 0,

    async execute(ctx) {
        let target = ctx.bot;
        const args = ctx.args || [];
        let page = 1;
        let serverId = null;

        for (const arg of args) {
            const num = parseInt(arg);
            if (!isNaN(num) && num > 0) {
                page = num;
            } else {
                serverId = arg.toLowerCase();
            }
        }

        if (serverId) {
            const found = ctx.bots?.get(serverId);
            if (found) {
                target = found;
            } else {
                ctx.tellrawCommand(`Server "${serverId}" not found.`);
                return;
            }
        }

        const api = target.playersAPI;
        if (!api) {
            ctx.tellrawCommand('Players API not loaded.');
            return;
        }

        const online = api.getOnline();
        if (!online || !online.length) {
            ctx.tellrawCommand('No players online.');
            return;
        }

        const perPage = 8;
        const totalPages = Math.ceil(online.length / perPage);
        if (page < 1) page = 1;
        if (page > totalPages) page = totalPages;

        const start = (page - 1) * perPage;
        const end = Math.min(start + start + perPage, online.length);
        const pagePlayers = online.slice(start, end);

        const srv = target.id || 'current';
        const components = [];
        const header = grad(`noratbot - Online players on ${srv} (page ${page}/${totalPages})`, '#f4fcff', '#238bff');
        components.push(...header);
        components.push({ text: "\n", color: "#aaaaaa" });
        for (const p of pagePlayers) {
            const name = (p.username || '').replace(/\u00A7[0-9a-fk-or]/g, '');
            const uuid = p.uuid;
            if (!uuid) continue;
            const nameGrad = grad(name, '#d9ffd2', '#62d66b');
                        for (const letterComponent of nameGrad) {
                letterComponent.click_event = {
                    action: 'copy_to_clipboard',
                    value: `${name}`
                };
                letterComponent.hover_event = {
                    action: 'show_text',
                    value: { text: `Click to copy ${name}`, color: 'green' }
                };
            }
            
            components.push(...nameGrad);
            components.push({ text: ' - ', color: '#aaaaaa' });
            components.push({
                text: uuid,
                color: '#55aaff',
                click_event: { 
                    action: 'copy_to_clipboard', 
                    value: uuid 
                },
                hover_event: { 
                    action: 'show_text', 
                    value: { text: 'Click to copy UUID', color: 'green' } 
                }
            });
            components.push({ text: "\n", color: "#aaaaaa" });
        }
        if (totalPages > 1) {
            if (page > 1) {
                const prevCmd = `nr:players ${page - 1}${serverId ? ' ' + serverId : ''}`;
                components.push({
                    text: '◀ ',
                    color: '#55aaff',
                    click_event: { 
                        action: 'suggest_command', 
                        command: prevCmd
                    },
                    hover_event: { 
                        action: 'show_text', 
                        value: { text: 'Previous page', color: 'green' }
                    }
                });
            }

            components.push({
                text: `Page ${page}/${totalPages}`,
                color: '#ffffff'
            });

            if (page < totalPages) {
                const nextCmd = `nr:players ${page + 1}${serverId ? ' ' + serverId : ''}`;
                components.push({
                    text: ' ▶',
                    color: '#55aaff',
                    click_event: { 
                        action: 'suggest_command', 
                        command: nextCmd
                    },
                    hover_event: { 
                        action: 'show_text', 
                        value: { text: 'Next page', color: 'green' }
                    }
                });
            }
        }
        const rootObject = {
            text: "",
            extra: components
        };

        const commandText = `tellraw @a ${toSNBT(rootObject)}`;
        ctx.run(commandText);
    }
};
