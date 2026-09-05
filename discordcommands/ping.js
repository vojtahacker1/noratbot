module.exports = {
    name: 'ping',
    description: 'Test command',
    roleRequired: 'Ping pong!',
    async execute(message, args, client, bot) {
        return 'Pong!';
    }
};