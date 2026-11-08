const fs = require('fs');
const path = require('path');

const MIN_SIZE = 11;
const DEFAULT_SIZE = 13;
const MAX_SIZE = 51;

function parseSize(value) {
    const n = Number.parseInt(value ?? DEFAULT_SIZE, 10);
    if (!Number.isInteger(n)) return DEFAULT_SIZE;
    // Force an odd size so the fire sits exactly in the middle.
    return Math.max(MIN_SIZE, Math.min(MAX_SIZE, n) | 1);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// ---- Tuning knobs -------------------------------------------------------
const BATCH_SIZE = 20;        // commands sent before a short pause
const BATCH_DELAY_MS = 60;    // pause between batches
const LAYER_DELAY_MS = 100;   // pause between Y layers
const RETRY_ROUNDS = 2;       // how many times to re-send failed build commands
const VERIFY_DELAY_MS = 300;  // wait before the repair / sweep pass
const POS_TIMEOUT_MS = 600;  // how long to wait for the position reply
// -------------------------------------------------------------------------

// ---- Storage ------------------------------------------------------------
// Saved to disk so the list survives restarts and command reloads.
// Shape: { "<serverId>": { nextId: 3, items: [{ id, owner, x, y, z, size, time }] } }
const DATA_FILE = path.join(process.cwd(), 'data', 'campfires.json');

function loadStore() {
    try {
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) || {};
    } catch (e) {
        return {};
    }
}

function saveStore(store) {
    try {
        fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
        fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
        return true;
    } catch (e) {
        console.error('[campfire] Failed to save campfires.json:', e);
        return false;
    }
}

function serverEntry(store, srv) {
    if (!store[srv]) store[srv] = { nextId: 1, items: [] };
    if (!Array.isArray(store[srv].items)) store[srv].items = [];
    if (!Number.isInteger(store[srv].nextId)) store[srv].nextId = 1;
    return store[srv];
}

// Keys ("server:id") of campfires currently being removed, so the same one
// isn't removed twice at once. Builds and different removals run freely in parallel.
const removing = new Set();

// Shared pacing: every command from every job (any player, build or remove)
// takes its turn on one clock, so running many jobs at once doesn't flood the
// core and drop commands. Average rate = BATCH_SIZE commands per BATCH_DELAY_MS.
// Set BATCH_DELAY_MS to 0 to disable the limit and run fully in parallel.
const COMMAND_GAP_MS = BATCH_DELAY_MS / BATCH_SIZE;
let nextSlot = 0;
async function pace() {
    if (!COMMAND_GAP_MS) return;
    const now = Date.now();
    const start = Math.max(now, nextSlot);
    nextSlot = start + COMMAND_GAP_MS;
    if (start > now) await sleep(start - now);
}
// -------------------------------------------------------------------------

// Colour themes: base = main floor, frame = border just inside the planks,
// runner = the aisles from each gate to the fire, rug = ring around the fire pit
// (matches the frame, so even the smallest size shows the theme).
const THEMES = {
    red:    { base: 'red_carpet',    frame: 'orange_carpet',     runner: 'yellow_carpet', rug: 'orange_carpet' },
    blue:   { base: 'blue_carpet',   frame: 'light_blue_carpet', runner: 'cyan_carpet',   rug: 'light_blue_carpet' },
    green:  { base: 'green_carpet',  frame: 'lime_carpet',       runner: 'yellow_carpet', rug: 'lime_carpet' },
    purple: { base: 'purple_carpet', frame: 'magenta_carpet',    runner: 'pink_carpet',   rug: 'magenta_carpet' }
};
const THEME_NAMES = Object.keys(THEMES);
const pickTheme = name => THEMES[name] ? name : THEME_NAMES[Math.floor(Math.random() * THEME_NAMES.length)];

// Stair "facing" = the side the tall back is on, so the back points AWAY from the fire.
const stair = facing => `spruce_stairs[facing=${facing},half=bottom]`;

// Each lookup gets its own tag, so several players running the command at the
// same time can't read each other's position reply.
const posRe = id => new RegExp(
    `nrpos${id}:\\s*\\[\\s*(-?[\\d.eE+-]+)d?\\s*,\\s*(-?[\\d.eE+-]+)d?\\s*,\\s*(-?[\\d.eE+-]+)d?\\s*\\]`
);

function floorPos(p) {
    if (!p) return null;
    const x = Number(p.x), y = Number(p.y), z = Number(p.z);
    if (![x, y, z].every(Number.isFinite)) return null;
    return { x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) };
}

// Gets the player's block position once. Tries bot data first, then asks the
// server via a tellraw nbt component and reads the reply from chat.
async function getPlayerPos(ctx, name) {
    const bot = ctx.bot;

    // 1. Position already tracked by the bot (mineflayer-style or custom).
    try {
        const p = floorPos(
            bot.players?.[name]?.entity?.position ||
            bot.players?.get?.(name)?.entity?.position ||
            bot.playersAPI?.getPosition?.(name)
        );
        if (p) return p;
    } catch (e) { /* fall through */ }

    // 2. Ask the server: print the player's Pos NBT to the bot and parse it.
    const botName = bot.config?.username || '@a';
    const tag = `nrpos${Math.random().toString(36).slice(2, 8)}:`;
    const re = posRe(tag.slice(5, -1));
    return await new Promise(resolve => {
        let done = false;
        const finish = val => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            bot.removeListener('chat_plain', onMsg);
            resolve(val);
        };
        const onMsg = msg => {
            if (typeof msg !== 'string') return;
            const clean = msg.replace(/\x1b\[[0-9;]*m/g, '');
            if (!clean.includes(tag)) return;
            const m = clean.match(re);
            if (m) finish(floorPos({ x: m[1], y: m[2], z: m[3] }));
        };
        const timer = setTimeout(() => finish(null), POS_TIMEOUT_MS);
        bot.on('chat_plain', onMsg);

        const json = JSON.stringify([
            { text: tag },
            { nbt: 'Pos', entity: name }
        ]);
        Promise.resolve(ctx.run(`tellraw ${botName} ${json}`)).then(res => {
            // Some cores return the command output directly.
            if (typeof res === 'string') onMsg(res);
        }).catch(() => {});
    });
}

// Builds the final-state map of offsets (each block placed exactly once) and
// groups it by Y layer. Used for both building and removing, so removal always
// matches what a build of the same size placed.
//
// Layout (r = half-width):
//   y=-1  stone-brick edge, spruce deck, stone fire plate
//   y= 0  themed carpet (frame + runners + rug), fence with a gate on each side,
//         aisles through the seating rings, fire pit, four themed corner nooks
//   y= 1+ lanterns, corner posts, pergola beams at y=4 with hanging lanterns/leaves
// Later put() calls win, so details are layered on top of the base.
function buildLayers(size, themeName) {
    const t = THEMES[themeName] || THEMES.red;
    const r = (size - 1) >> 1;      // half-width of the whole patio
    const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];

    const plan = new Map();
    const put = (x, y, z, block) => plan.set(`${x},${y},${z}`, { x, y, z, block });
    const fill = (x1, y1, z1, x2, y2, z2, block) => {
        for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++)
            for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++)
                for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++)
                    put(x, y, z, block);
    };

    const rings = [];
    for (let d = 3; d <= r - 2; d += 3) rings.push(d);

    // ---- Floor (y=-1): stone-brick edge, spruce deck, stone fire plate
    fill(-r, -1, -r, r, -1, r, 'stone_bricks');
    fill(-(r - 1), -1, -(r - 1), r - 1, -1, r - 1, 'spruce_planks');
    fill(-1, -1, -1, 1, -1, 1, 'stone_bricks');

    // ---- Carpet (y=0): inset by one so a ring of spruce deck shows around it
    const c = r - 2;
    fill(-c, 0, -c, c, 0, c, t.base);
    // frame: the outermost ring of carpet
    fill(-c, 0, -c, c, 0, -c, t.frame);
    fill(-c, 0, c, c, 0, c, t.frame);
    fill(-c, 0, -c, -c, 0, c, t.frame);
    fill(c, 0, -c, c, 0, c, t.frame);
    // runners: each gate to the fire (run out to the deck so they meet the gates)
    fill(0, 0, -(r - 1), 0, 0, -3, t.runner);
    fill(0, 0, 3, 0, 0, r - 1, t.runner);
    fill(-(r - 1), 0, 0, -3, 0, 0, t.runner);
    fill(3, 0, 0, r - 1, 0, 0, t.runner);

    // ---- Fence on all four sides, with a gate in the middle of each
    fill(-r, 0, r, r, 0, r, 'spruce_fence');
    fill(-r, 0, -r, r, 0, -r, 'spruce_fence');
    fill(-r, 0, -r, -r, 0, r, 'spruce_fence');
    fill(r, 0, -r, r, 0, r, 'spruce_fence');
    put(0, 0, r,  'spruce_fence_gate[facing=south,open=false]');
    put(0, 0, -r, 'spruce_fence_gate[facing=north,open=false]');
    put(r, 0, 0,  'spruce_fence_gate[facing=east,open=false]');
    put(-r, 0, 0, 'spruce_fence_gate[facing=west,open=false]');

    // ---- Corner posts + pergola beams
    for (const [sx, sz] of corners) {
        fill(sx * r, 0, sz * r, sx * r, 4, sz * r, 'spruce_log[axis=y]');
        put(sx * r, 5, sz * r, 'lantern[hanging=false]');
    }
    fill(-(r - 1), 4, r,  r - 1, 4, r,  'spruce_log[axis=x]');
    fill(-(r - 1), 4, -r, r - 1, 4, -r, 'spruce_log[axis=x]');
    fill(-r, 4, -(r - 1), -r, 4, r - 1, 'spruce_log[axis=z]');
    fill(r,  4, -(r - 1), r,  4, r - 1, 'spruce_log[axis=z]');

    // Lanterns on the fence (every 4th, not on the gate), hanging lanterns under the
    // beams offset by 2 (plus one over each gate), and leaves dangling in between.
    for (let i = 4; i <= r - 2; i += 4) {
        for (const s of [i, -i]) {
            put(s, 1, r,  'lantern[hanging=false]');
            put(s, 1, -r, 'lantern[hanging=false]');
            put(-r, 1, s, 'lantern[hanging=false]');
            put(r,  1, s, 'lantern[hanging=false]');
            put(s, 3, r,  'flowering_azalea_leaves[persistent=true]');
            put(s, 3, -r, 'flowering_azalea_leaves[persistent=true]');
            put(-r, 3, s, 'flowering_azalea_leaves[persistent=true]');
            put(r,  3, s, 'flowering_azalea_leaves[persistent=true]');
        }
    }
    for (let i = 2; i <= r - 2; i += 4) {
        for (const s of [i, -i]) {
            put(s, 3, r,  'lantern[hanging=true]');
            put(s, 3, -r, 'lantern[hanging=true]');
            put(-r, 3, s, 'lantern[hanging=true]');
            put(r,  3, s, 'lantern[hanging=true]');
        }
    }
    for (const [x, z] of [[0, r], [0, -r], [r, 0], [-r, 0]]) put(x, 3, z, 'lantern[hanging=true]');

    // ---- Fire pit: themed rug ring, stone-brick slab ring with mossy corners, lit campfire
    fill(-2, 0, -2, 2, 0, 2, t.rug);
    fill(-1, 0, -1, 1, 0, 1, 'stone_brick_slab[type=bottom]');
    for (const [sx, sz] of corners) put(sx, 0, sz, 'mossy_stone_bricks');
    put(0, 0, 0, 'campfire[lit=true,facing=north]');

    // ---- Seating rings (stairs face the fire), with aisles left open on both axes
    const stairAt = (x, z, facing) => {
        put(x, 0, z, stair(facing));
    };
    for (const d of rings) {
        const a = d - 1;
        for (let k = -a; k <= a; k++) {
            if (k === 0) continue;                 // aisle
            stairAt(k, d, 'south');
            stairAt(k, -d, 'north');
            stairAt(-d, k, 'west');
            stairAt(d, k, 'east');
        }
        for (const [sx, sz] of corners) {
            put(sx * d, 0, sz * d, 'spruce_log[axis=y]');
            put(sx * d, 1, sz * d, 'lantern[hanging=false]');
        }
    }

    // ---- Corner nooks (3 cells each: the corner, plus one step inward along each wall)
    // [-1,-1] firewood, [1,-1] garden, [-1,1] hay & pumpkins, [1,1] lounge table
    const nook = (sx, sz) => {
        const ax = sx * (r - 1), az = sz * (r - 1);
        const ix = -sx, iz = -sz;                  // inward direction
        const A = [ax, az], B = [ax + ix, az], C = [ax, az + iz];
        if (sx < 0 && sz < 0) {          // firewood stack
            put(A[0], 0, A[1], 'spruce_log[axis=x]');
            put(A[0], 1, A[1], 'spruce_log[axis=x]');
            put(B[0], 0, B[1], 'spruce_log[axis=x]');
            put(C[0], 0, C[1], 'barrel[facing=up]');
            put(A[0], 2, A[1], 'lantern[hanging=false]');
        } else if (sx > 0 && sz < 0) {   // garden
            put(A[0], 0, A[1], 'oak_leaves[persistent=true]');
            put(A[0], 1, A[1], 'flowering_azalea_leaves[persistent=true]');
            put(B[0], 0, B[1], 'potted_azalea_bush');
            put(C[0], 0, C[1], 'potted_red_tulip');
        } else if (sx < 0 && sz > 0) {   // hay & pumpkins
            put(A[0], 0, A[1], 'hay_block[axis=x]');
            put(A[0], 1, A[1], 'hay_block[axis=x]');
            put(A[0], 2, A[1], 'lantern[hanging=false]');
            put(B[0], 0, B[1], 'hay_block[axis=z]');
            put(C[0], 0, C[1], 'pumpkin');
        } else {                         // lounge: table + two seats facing it
            put(A[0], 0, A[1], 'spruce_fence');
            put(A[0], 1, A[1], 'spruce_slab[type=top]');
            put(A[0], 2, A[1], 'lantern[hanging=false]');
            put(B[0], 0, B[1], stair(ix > 0 ? 'east' : 'west'));
            put(C[0], 0, C[1], stair(iz > 0 ? 'south' : 'north'));
        }
    };
    for (const [sx, sz] of corners) nook(sx, sz);

    // Group by Y so supports are always placed before what stands on them.
    const layers = new Map();
    for (const e of plan.values()) {
        if (!layers.has(e.y)) layers.set(e.y, []);
        layers.get(e.y).push(e);
    }
    const layerYs = [...layers.keys()].sort((a, b) => a - b);

    return { layers, layerYs, rings: rings.length };
}

// Command helpers -----------------------------------------------------------

const safeRun = async (ctx, cmd) => {
    try {
        return (await ctx.run(cmd)) !== false;
    } catch (e) {
        return false;
    }
};

// Sends commands in paced batches; returns the ones that reported failure.
const sendPaced = async (ctx, cmds) => {
    const failed = [];
    for (const cmd of cmds) {
        await pace();
        if (!(await safeRun(ctx, cmd))) failed.push(cmd);
    }
    return failed;
};

const absSetblock = (origin, e, block, mode) =>
    `setblock ${origin.x + e.x} ${origin.y + e.y} ${origin.z + e.z} ${block}${mode ? ' ' + mode : ''}`;

// Clears the whole site (patio + 1 block margin so the gates open onto air, and
// headroom above the pergola) before anything is placed, so trees, leaves, tall
// grass and terrain can't get in the way. Split into slabs so no single /fill
// gets near the vanilla block limit.
const CLEAR_MARGIN = 1;
const CLEAR_TOP = 6;               // pergola lanterns reach y=5; clear one above
const CLEAR_SLAB_BLOCKS = 8000;
function clearCommands(origin, size) {
    const half = ((size - 1) >> 1) + CLEAR_MARGIN;
    const zs = half * 2 + 1, ys = CLEAR_TOP + 1;            // y = 0..CLEAR_TOP
    const step = Math.max(1, Math.floor(CLEAR_SLAB_BLOCKS / (zs * ys)));
    const cmds = [];
    for (let x = -half; x <= half; x += step) {
        const x2 = Math.min(x + step - 1, half);
        cmds.push(`fill ${origin.x + x} ${origin.y} ${origin.z - half} ${origin.x + x2} ${origin.y + CLEAR_TOP} ${origin.z + half} air replace`);
    }
    return cmds;
}

// Builds one campfire at `origin` in the given theme. Returns { total, stillFailed, rings }.
async function buildAt(ctx, origin, size, theme) {
    const { layers, layerYs, rings } = buildLayers(size, theme);

    let total = 0;
    let stillFailed = 0;

    // Clear the site first (retry any dropped fills), then let the core catch up.
    let clearFailed = await sendPaced(ctx, clearCommands(origin, size));
    for (let round = 0; round < RETRY_ROUNDS && clearFailed.length; round++) {
        await sleep(BATCH_DELAY_MS * 3);
        clearFailed = await sendPaced(ctx, clearFailed);
    }
    stillFailed += clearFailed.length;
    await sleep(LAYER_DELAY_MS * 3);

    // Bottom to top: floor lands before carpet / stairs / lanterns need it.
    for (const y of layerYs) {
        const cmds = layers.get(y).map(e => absSetblock(origin, e, e.block));
        total += cmds.length;

        let failed = await sendPaced(ctx, cmds);
        for (let round = 0; round < RETRY_ROUNDS && failed.length; round++) {
            await sleep(BATCH_DELAY_MS * 3);
            failed = await sendPaced(ctx, failed);
        }
        stillFailed += failed.length;

        await sleep(LAYER_DELAY_MS);
    }

    // Repair pass: "keep" only fills positions that are still air.
    await sleep(VERIFY_DELAY_MS);
    for (const y of layerYs) {
        await sendPaced(ctx, layers.get(y).map(e => absSetblock(origin, e, e.block, 'keep')));
        await sleep(BATCH_DELAY_MS * 2);
    }

    return { total, stillFailed, rings };
}

// Removes one campfire: every planned position is set to air, top layer first
// (lanterns / posts before the carpet and floor they stand on).
async function removeAt(ctx, origin, size) {
    const { layers, layerYs } = buildLayers(size, 'red');
    const topDown = [...layerYs].reverse();

    let total = 0;
    for (const y of topDown) {
        const cmds = layers.get(y).map(e => absSetblock(origin, e, 'air', 'replace'));
        total += cmds.length;
        await sendPaced(ctx, cmds);
        await sleep(LAYER_DELAY_MS);
    }

    // One sweep to catch anything the core dropped. Re-sending air onto air is harmless.
    await sleep(VERIFY_DELAY_MS);
    for (const y of topDown) {
        await sendPaced(ctx, layers.get(y).map(e => absSetblock(origin, e, 'air', 'replace')));
        await sleep(BATCH_DELAY_MS * 2);
    }

    return total;
}

// Removes the blocks, then drops the record. The load/modify/save below has no
// awaits in it, so parallel removals can't overwrite each other's changes.
async function removeItem(ctx, srv, item) {
    await removeAt(ctx, { x: item.x, y: item.y, z: item.z }, item.size);
    const store = loadStore();
    const entry = serverEntry(store, srv);
    entry.items = entry.items.filter(i => i.id !== item.id);
    saveStore(store);
}

const USAGE = `Usage: campfire [size] [${THEME_NAMES.join('|')}] | list | tp <id> | remove <id> | clear`;

module.exports = {
    _buildLayers: buildLayers,
    _clearCommands: clearCommands,
    name: 'campfire',
    description: 'Build a campfire lounge (campfire [size] [red|blue|green|purple]); manage with list, tp <id>, remove <id>, clear',
    aliases: ['camp'],
    level: 0,

    async execute(ctx) {
        const args = ctx.args || [];
        const sub = String(args[0] ?? '').toLowerCase();
        const say = text => ctx.tellrawCommand(text);

        const srv = ctx.bot?.id ?? 'default';
        const who = ctx.player?.name || ctx.player?.username || 'unknown';
        const isTrusted = (ctx.level ?? 0) >= (ctx.levels?.TRUSTED ?? 1);

        // ---- list -------------------------------------------------------
        if (sub === 'list') {
            const { items } = serverEntry(loadStore(), srv);
            if (!items.length) return say('No campfires.');
            const lines = items.map(i =>
                `ID ${i.id}: ${i.size}x${i.size}${i.theme ? ' ' + i.theme : ''} at ${i.x} ${i.y} ${i.z} (by ${i.owner})`
            );
            return say('Campfires:\n' + lines.join('\n'));
        }

        // ---- tp <id> ----------------------------------------------------
        if (sub === 'tp' || sub === 'goto') {
            const id = parseInt(args[1], 10);
            if (isNaN(id)) return say('Usage: campfire tp <id>');
            const item = serverEntry(loadStore(), srv).items.find(i => i.id === id);
            if (!item) return say(`No campfire with ID ${id}.`);
            if (who === 'unknown') return say('Could not identify player.');
            // origin is the player's feet when it was built; the fire pit is at that spot, so land beside the rug
            ctx.run(`tp ${who} ${item.x + 0.5} ${item.y + 0.5} ${item.z + 3.5}`);
            return say(`Teleported to campfire ID ${id}.`);
        }

        // ---- remove <id> ------------------------------------------------
        if (sub === 'remove' || sub === 'rm' || sub === 'delete') {
            if (args.length < 2) return say('Usage: campfire remove <id>');
            const id = parseInt(args[1], 10);
            if (isNaN(id)) return say('ID must be a number.');

            const item = serverEntry(loadStore(), srv).items.find(i => i.id === id);
            if (!item) return say(`No campfire with ID ${id}.`);

            const isOwner = String(item.owner).toLowerCase() === String(who).toLowerCase();
            if (!isOwner && !isTrusted) return say('You can only remove your own campfires.');

            const key = `${srv}:${id}`;
            if (removing.has(key)) return say(`Campfire ID ${id} is already being removed.`);
            removing.add(key);
            try {
                say(`Removing campfire ID ${id}...`);
                await removeItem(ctx, srv, item);
                say(`Removed campfire ID ${id}.`);
            } finally {
                removing.delete(key);
            }
            return;
        }

        // ---- clear (removes every campfire in parallel) ------------------
        if (sub === 'clear') {
            if (!isTrusted) return say('Authenticate to use this command');
            const items = serverEntry(loadStore(), srv).items
                .filter(i => !removing.has(`${srv}:${i.id}`));
            if (!items.length) return say('No campfires to clear.');

            const plural = items.length === 1 ? '' : 's';
            items.forEach(i => removing.add(`${srv}:${i.id}`));
            say(`Clearing ${items.length} campfire${plural}...`);
            await Promise.all(items.map(item =>
                removeItem(ctx, srv, item).finally(() => removing.delete(`${srv}:${item.id}`))
            ));
            say(`Cleared ${items.length} campfire${plural}.`);
            return;
        }

        // ---- build ------------------------------------------------------
        // "campfire", "campfire 21", "campfire blue", "campfire build 21 purple" (any order)
        const tokens = (sub === 'build' || sub === 'add' ? args.slice(1) : args).map(a => String(a).toLowerCase());
        let sizeArg, themeArg;
        for (const tok of tokens) {
            if (/^\d+$/.test(tok) && sizeArg === undefined) sizeArg = tok;
            else if ((THEMES[tok] || tok === 'random') && themeArg === undefined) themeArg = tok;
            else return say(USAGE);
        }

        const size = parseSize(sizeArg);
        const theme = pickTheme(themeArg);

        // Read the player's position ONCE; everything is built from it.
        const origin = who !== 'unknown' ? await getPlayerPos(ctx, who) : null;
        if (!origin) return say('Could not read your position, build cancelled.');

        say(`Clearing the site and building a ${size}x${size} ${theme} campfire lounge...`);
        const { total, stillFailed, rings } = await buildAt(ctx, origin, size, theme);

        // Store the position so it can be listed / removed later.
        const store = loadStore();
        const entry = serverEntry(store, srv);
        const id = entry.nextId++;
        entry.items.push({
            id,
            owner: who,
            x: origin.x,
            y: origin.y,
            z: origin.z,
            size,
            theme,
            time: Date.now()
        });
        saveStore(store);

        say(
            `Built ${size}x${size} ${theme} campfire lounge (ID: ${id}) with ${rings} seating ring${rings === 1 ? '' : 's'}, gates on every side and a pergola ` +
            `(${total} blocks${stillFailed ? `, ${stillFailed} reported errors` : ''}). ` +
            `Try a larger size (up to ${MAX_SIZE}) for more rings, or pick a theme: ${THEME_NAMES.join(', ')}.`
        );
    }
};