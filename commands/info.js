const os = require('os');
const path = require('path');
const gradient = require('../utils/gradient');

function grad(text, start, end) {
    return gradient.gradient(text, start, end);
}

function toSNBT(obj) {
    if (typeof obj === 'string') {
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
    name: 'info',
    description: 'Show bot system info (RAM, CPU, ping, uptime)',
    level: 0,

    async execute(ctx) {
        const bot = ctx.bot;

        const memUsage = process.memoryUsage();
        const rss = memUsage.rss; 
        const heapTotal = memUsage.heapTotal;
        const heapUsed = memUsage.heapUsed;
        const external = memUsage.external;
        const memTotal = os.totalmem(); 
        const cpus = os.cpus();
        const cpuModel = cpus.length ? cpus[0].model : 'Unknown';
        const cpuCount = cpus.length;
        const loadAvg = os.loadavg();
        let ping = 'N/A';
        if (bot.client) {
            if (typeof bot.client.latency === 'number' && bot.client.latency > 0) {
                ping = bot.client.latency.toFixed(0) + 'ms';
            } else if (bot.client.ping !== undefined && typeof bot.client.ping === 'number' && bot.client.ping > 0) {
                ping = bot.client.ping.toFixed(0) + 'ms';
            } else {
            }
        }
        const uptimeSec = process.uptime();
        const uptime = formatUptime(uptimeSec);
        let version = bot.config.version
        const botsCount = ctx.bots ? ctx.bots.size : 1;
        const serverName = bot.id || 'unknown';
        const host = bot.config?.host || '?';
        const port = bot.config?.port || '?';
        const extra = [];
        extra.push(...grad('noratbot System Info', '#f4fcff', '#238bff'));
        extra.push({ text: '\n', color: 'gray' });

        const addLine = (label, value, labelColor = '#aaaaaa', valueColor = '#ffffff') => {
            extra.push({ text: label + ': ', color: labelColor });
            extra.push({ text: value, color: valueColor });
            extra.push({ text: '\n', color: 'gray' });
        };

        addLine('Server', `${serverName} (${host}:${port})`);
        addLine('Bots online', String(botsCount));
        addLine('Version', version);
        addLine('Uptime', uptime);
        addLine('Ping', ping);
        addLine('Memory (RSS)', `${(rss / 1024 / 1024).toFixed(2)} MB`);
        addLine('Heap Total', `${(heapTotal / 1024 / 1024).toFixed(2)} MB`);
        addLine('Heap Used', `${(heapUsed / 1024 / 1024).toFixed(2)} MB`);
        addLine('External', `${(external / 1024 / 1024).toFixed(2)} MB`);
        addLine('System RAM', `${(memTotal / 1024 / 1024 / 1024).toFixed(2)} GB total`);
        addLine('CPU', `${cpuCount} cores, ${cpuModel}`);
        addLine('Load (1/5/15 min)', loadAvg.map(v => v.toFixed(2)).join(', '));
        const rootObject = { text: '', extra };
        const cmd = `tellraw @a ${toSNBT(rootObject)}`;
        ctx.run(cmd);
    }
};

function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const parts = [];
    if (days) parts.push(days + 'd');
    if (hours) parts.push(hours + 'h');
    if (minutes) parts.push(minutes + 'm');
    if (secs || !parts.length) parts.push(secs + 's');
    return parts.join(' ');
}