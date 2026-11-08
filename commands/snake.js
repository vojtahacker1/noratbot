// Snake, ported from the original HermitBot SnakePlugin (Game.java) to the JS command core.
//
// The JS core can only *write* commands (no data-get readback), so unlike the Java version this
// can't read your position or hotbar. Instead:
//   * the board is anchored to an invisible marker summoned at your feet (all setblocks are
//     relative to it), or to absolute coords if you pass them;
//   * you steer with chat:  snake north|east|south|west  (or n/e/s/w).
//
// Layout matches the Java plugin: 16x16 board sitting 16 blocks below you, black_concrete frame,
// shroomlight apple, lime head / green body, you are teleported above it looking down.

const SIZE = 16;
const TICK_MS = 450;
const START_LENGTH = 3;
const DROP = 16;                 // board is this far below the player (same as Java)
const CLEANUP_DELAY_MS = 6000;   // how long the finished board stays up

const BOARD = 'black_concrete';
const APPLE = 'shroomlight';
const HEAD = 'lime_terracotta';
const BODY = 'green_terracotta';

const DIRS = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
const DIR_ALIASES = { n: 'north', e: 'east', s: 'south', w: 'west', up: 'north', down: 'south', left: 'west', right: 'east' };

const games = new WeakMap(); // bot -> game

const isCoord = v => /^-?\d+$/.test(String(v)) && Math.abs(Number(v)) <= 30000000;
const safeTag = name => 'snake_' + String(name || 'console').replace(/[^\w.+-]/g, '_');

function makeGame(ctx, absolute) {
    const owner = ctx.player?.name || 'console';
    const tag = safeTag(owner);
    const anchor = `@e[type=marker,tag=${tag},limit=1]`;

    // cell (cx, cz) on the board -> command string placing `block` there (dy: layer, 0 = play layer)
    const set = (cx, cz, block, dy = 0, mode = '') => absolute
        ? `setblock ${absolute.x + cx} ${absolute.y + dy} ${absolute.z + cz} ${block}${mode}`
        : `execute at ${anchor} run setblock ~${cx - SIZE / 2} ~${-DROP + dy} ~${cz - SIZE / 2} ${block}${mode}`;

    const fillCmd = (x1, y1, z1, x2, y2, z2, block, mode = '') => absolute
        ? `fill ${absolute.x + x1} ${absolute.y + y1} ${absolute.z + z1} ${absolute.x + x2} ${absolute.y + y2} ${absolute.z + z2} ${block}${mode}`
        : `execute at ${anchor} run fill ~${x1 - SIZE / 2} ~${-DROP + y1} ~${z1 - SIZE / 2} ~${x2 - SIZE / 2} ~${-DROP + y2} ~${z2 - SIZE / 2} ${block}${mode}`;

    return {
        owner, tag, anchor, absolute, set, fillCmd,
        timer: null, cleanupTimer: null,
        over: false,
        length: START_LENGTH,
        body: [{ x: SIZE / 2, z: SIZE / 2 }],   // head is the LAST element
        apple: null,
        dir: 'east',        // direction actually moved last tick
        pending: 'east',    // direction requested by the player
        started: false
    };
}

function randomApple(game) {
    const free = [];
    for (let x = 0; x < SIZE; x++) for (let z = 0; z < SIZE; z++) {
        if (!game.body.some(b => b.x === x && b.z === z)) free.push({ x, z });
    }
    return free.length ? free[Math.floor(Math.random() * free.length)] : null;
}

// Pure game step. Returns { cmds, over, won } — no I/O, so it is easy to test.
function step(game) {
    const cmds = [];
    if (!game.started) {
        game.started = true;
        game.apple = randomApple(game);
        const h = game.body[game.body.length - 1];
        cmds.push(game.set(game.apple.x, game.apple.z, APPLE), game.set(h.x, h.z, HEAD));
        return { cmds, over: false };
    }

    game.dir = game.pending;
    const [dx, dz] = DIRS[game.dir];
    const head = game.body[game.body.length - 1];
    const next = { x: head.x + dx, z: head.z + dz };

    // The tail cell is vacated this tick unless we are growing, so moving into it is legal.
    const willGrow = game.apple && next.x === game.apple.x && next.z === game.apple.z;
    const tailMoves = !willGrow && game.body.length >= game.length;
    const solid = tailMoves ? game.body.slice(1) : game.body;

    if (next.x < 0 || next.z < 0 || next.x >= SIZE || next.z >= SIZE || solid.some(b => b.x === next.x && b.z === next.z)) {
        return { cmds, over: true };
    }

    cmds.push(game.set(head.x, head.z, BODY));
    game.body.push(next);
    cmds.push(game.set(next.x, next.z, HEAD));

    if (willGrow) {
        game.length++;
        game.apple = randomApple(game);
        if (!game.apple) return { cmds, over: true, won: true };
        cmds.push(game.set(game.apple.x, game.apple.z, APPLE));
    }

    while (game.body.length > game.length) {
        const t = game.body.shift();
        cmds.push(game.set(t.x, t.z, 'air'));
    }
    return { cmds, over: false };
}

function send(ctx, cmds) {
    for (const c of cmds) if (ctx.run(c) === false) return false;
    return true;
}

function teardown(ctx, game, bot) {
    clearInterval(game.timer);
    clearTimeout(game.cleanupTimer);
    // one big fill instead of tracking every block (the old version leaked body blocks)
    ctx.run(game.fillCmd(-1, -1, -1, SIZE, 0, SIZE, 'air', ' destroy'));
    if (!game.absolute) ctx.run(`kill @e[type=marker,tag=${game.tag}]`);
    if (games.get(bot) === game) games.delete(bot);
}

module.exports = {
    name: 'snake',
    description: 'Play snake: snake start [x y z] | north/east/south/west | stop',
    aliases: ['sn'],
    level: 0,

    // exported for tests
    _step: step, _makeGame: makeGame, SIZE,

    async execute(ctx) {
        const say = ctx.tellrawCommand.bind(ctx);
        const bot = ctx.bot;
        const me = ctx.player?.name || 'console';
        const [rawAction = 'start', ...rest] = ctx.args || [];
        const action = String(rawAction).toLowerCase();
        const game = games.get(bot);

        if (action === 'help') {
            return say('snake start [x y z] - begin (board 16 blocks below you, or at coords) | snake north|east|south|west (or n/e/s/w) to steer | snake stop');
        }

        if (action === 'stop') {
            if (!game) return say('No snake game is running.');
            if (game.owner !== me && ctx.level < ctx.levels.TRUSTED) return say(`Only ${game.owner} can stop this game.`);
            const len = game.length;
            teardown(ctx, game, bot);
            return say(`Snake stopped at length ${len}.`);
        }

        const dirName = DIR_ALIASES[action] || (DIRS[action] ? action : null);
        if (dirName) {
            if (!game || game.over) return say('No snake game is running. Start one with snake start.');
            if (game.owner !== me) return say(`${game.owner} is playing snake right now.`);
            // Compare against the direction last *moved*, so two quick turns can't U-turn into yourself.
            const [ox, oz] = DIRS[game.dir], [nx, nz] = DIRS[dirName];
            if (ox + nx === 0 && oz + nz === 0) return say("Can't reverse into yourself.");
            game.pending = dirName;
            return;
        }

        if (action !== 'start') return say('Use snake start, snake north|east|south|west, or snake stop.');

        if (game && !game.over) return say(`${game.owner} is already playing snake. Use snake stop to end it.`);
        if (game) teardown(ctx, game, bot);

        let absolute = null;
        if (rest.length) {
            if (rest.length !== 3 || !rest.every(isCoord)) return say('Usage: snake start [x y z]  (coords = lowest corner of the board)');
            absolute = { x: Number(rest[0]), y: Number(rest[1]), z: Number(rest[2]) };
        } else if (me === 'console') {
            return say('From console you must give coordinates: snake start <x> <y> <z>');
        }

        const g = makeGame(ctx, absolute);
        const setup = [];
        if (!absolute) {
            setup.push(`kill @e[type=marker,tag=${g.tag}]`);
            setup.push(`execute as ${me} at @s align xyz run summon marker ~ ~ ~ {Tags:["${g.tag}"]}`);
        }
        // Black frame two layers thick, then carve the play layer back out (same as Java buildBoard)
        setup.push(g.fillCmd(-1, -1, -1, SIZE, 0, SIZE, BOARD));
        setup.push(g.fillCmd(0, 0, 0, SIZE - 1, 0, SIZE - 1, 'air'));
        if (!absolute) {
            setup.push(`execute as ${me} at ${g.anchor} run tp @s ~0.5 ~ ~0.5 180 90`);
        }
        if (!send(ctx, setup)) return say('Could not start snake: command core is not ready.');

        games.set(bot, g);
        say(`Snake started for ${me}! Steer with snake north|east|south|west (n/e/s/w). Eat the shroomlight.`);

        g.timer = setInterval(() => {
            try {
                const r = step(g);
                if (!send(ctx, r.cmds)) { teardown(ctx, g, bot); return; }
                if (r.over) {
                    g.over = true;
                    clearInterval(g.timer);
                    say(r.won ? `Board full - you win! Length ${g.length}.` : `Game over! Your snake was ${g.length} blocks long.`);
                    g.cleanupTimer = setTimeout(() => teardown(ctx, g, bot), CLEANUP_DELAY_MS);
                }
            } catch (e) {
                console.error('[snake] tick failed:', e);
                teardown(ctx, g, bot);
            }
        }, TICK_MS);
    }
};