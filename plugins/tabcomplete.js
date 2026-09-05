module.exports = function inject(bot) {
    bot.tabComplete = (txt) => {
        const client = bot._client;
        return new Promise((resolve, reject) => {
            if (!client || typeof client.write !== 'function') {
                reject(new Error('Client not ready'));
                return;
            }

            const onResp = (pkt) => {
                client.removeListener('tab_complete', onResp);
                const raw = pkt.matches || [];
                const names = raw.map(m => {
                    if (typeof m === 'string') return m;
                    if (m && typeof m === 'object') return m.match ?? m.text ?? String(m);
                    return String(m);
                }).filter(Boolean);
                resolve(names);
            };

            client.once('tab_complete', onResp);
            client.write('tab_complete', {
                text: txt,
                assumeCommand: false,
                sendBlockInSight: false
            });

            setTimeout(() => {
                client.removeListener('tab_complete', onResp);
                reject(new Error('tabComplete timeout'));
            }, 5000);
        });
    };
};