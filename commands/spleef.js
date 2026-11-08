// Spleef, ported from the original HermitBot SpleefPlugin (Game.java / SpleefPlugin.java).
//
// The JS core can only write commands (no entity/position readback), so everything the Java
// tick() did in Java -- fall detection, elimination, winner check -- runs IN THE WORLD as a
// repeating set of commands (tags + a scoreboard counter). JS only drives the countdown and
// re-sends that loop.
//
//   spleef create <x> <y> <z> [floors 1-5]   build the arena (x,y,z = lowest corner of the bottom floor)
//   spleef join | leave | players
//   spleef start                              10s countdown, then play
//   spleef modifier set <effect|attribute> <value> | remove <name> | list | clear | apply
//   spleef end                                stop everything and clean up

const ARENA_SIZE = 25;
const MIN_FLOORS = 1, MAX_FLOORS = 5, FLOOR_GAP = 4;
const COUNTDOWN = 10;
const LOOP_MS = 1000;
const MAX_GAME_MS = 15 * 60 * 1000;   // safety net: the in-world loop is torn down eventually

const TAG = 'hermit_spleef';
const OUT = 'hermit_spleef_out';
const DEAD = 'hermit_spleef_dead';   // eliminated this round; restored to creative when the game finishes
const OBJ = 'hermit_spleef';

const EFFECTS = new Set(['speed', 'slowness', 'haste', 'mining_fatigue', 'strength', 'jump_boost', 'nausea', 'regeneration',
    'resistance', 'fire_resistance', 'water_breathing', 'invisibility', 'blindness', 'night_vision', 'hunger', 'weakness',
    'poison', 'wither', 'health_boost', 'absorption', 'saturation', 'glowing', 'levitation', 'luck', 'unluck',
    'slow_falling', 'conduit_power', 'dolphins_grace', 'darkness']);
const ATTRIBUTES = new Set(['scale', 'jump_strength', 'movement_speed', 'gravity', 'safe_fall_distance', 'fall_damage_multiplier',
    'step_height', 'block_interaction_range', 'entity_interaction_range', 'attack_speed', 'attack_damage', 'attack_knockback',
    'knockback_resistance', 'max_health', 'armor', 'luck', 'block_break_speed', 'mining_efficiency', 'sneaking_speed',
    'movement_efficiency', 'water_movement_efficiency']);

const SHOVEL = 'golden_shovel[enchantments={efficiency:255},unbreakable={},can_break={"blocks":["snow_block"]}]';

function newState() {
    return {
        origin: null, players: new Set(), phase: 'idle',   // idle | countdown | running
        timers: [], loop: null,
        effects: new Map(), attributes: new Map()
    };
}

const stripNs = s => String(s).toLowerCase().replace(/^minecraft:/, '');
const sel = () => `@a[tag=${TAG}]`;

function geometry(o) {
    const topY = o.y + (o.floors - 1) * FLOOR_GAP;
    return {
        topY,
        cx: o.x + ARENA_SIZE / 2, cz: o.z + ARENA_SIZE / 2,
        // anyone with feet below the bottom floor has fallen (hitbox-intersect selector, so leave 2 blocks of slack)
        fallenSel: `y=-1000,dy=${1000 + o.y - 2}`
    };
}

function arenaCommands(o) {
    const { topY } = geometry(o);
    const cmds = [`fill ${o.x - 1} ${o.y} ${o.z - 1} ${o.x + ARENA_SIZE} ${topY + 3} ${o.z + ARENA_SIZE} air`];
    for (let f = 0; f < o.floors; f++) {
        const fy = o.y + f * FLOOR_GAP;
        cmds.push(`fill ${o.x} ${fy} ${o.z} ${o.x + ARENA_SIZE - 1} ${fy} ${o.z + ARENA_SIZE - 1} snow_block`);
    }
    return cmds;
}

function clearArenaCommand(o) {
    const { topY } = geometry(o);
    return `fill ${o.x - 1} ${o.y} ${o.z - 1} ${o.x + ARENA_SIZE} ${topY + 3} ${o.z + ARENA_SIZE} air`;
}

function applyModifierCommands(st, target) {
    const cmds = [];
    for (const [name, level] of st.effects) cmds.push(`effect give ${target} minecraft:${name} infinite ${level} true`);
    // `attribute` only accepts a single entity, so go through execute as
    for (const [name, value] of st.attributes) cmds.push(`execute as ${target} run attribute @s minecraft:${name} base set ${value}`);
    return cmds;
}

function removeModifierCommands(st, target) {
    const cmds = [];
    for (const name of st.effects.keys()) cmds.push(`effect clear ${target} minecraft:${name}`);
    for (const name of st.attributes.keys()) cmds.push(`execute as ${target} run attribute @s minecraft:${name} base reset`);
    return cmds;
}

// The repeating in-world loop: eliminate fallen players, announce a winner exactly once.
function loopCommands(st) {
    const o = st.origin, g = geometry(o);
    const out = `@a[tag=${OUT}]`;
    const cmds = [
        `tag @a[tag=${TAG},${g.fallenSel}] add ${OUT}`,
        `execute as ${out} run tellraw @a [{"selector":"@s","color":"yellow"},{"text":" fell!","color":"gray"}]`,
        `gamemode spectator ${out}`,
        `tp ${out} ${g.cx} ${g.topY + 6} ${g.cz}`,
        ...removeModifierCommands(st, out),
        `tag ${out} add ${DEAD}`,
        `tag ${out} remove ${TAG}`,
        `tag ${out} remove ${OUT}`,
        `execute store result score #alive ${OBJ} if entity ${sel()}`,
        `execute if score #running ${OBJ} matches 1 if score #alive ${OBJ} matches 1 run tellraw @a [{"selector":"${sel()}","color":"gold"},{"text":" wins spleef!","color":"yellow"}]`,
        `execute if score #running ${OBJ} matches 1 if score #alive ${OBJ} matches 0 run tellraw @a {"text":"Spleef over - nobody left standing!","color":"gray"}`,
        `execute if score #running ${OBJ} matches 1 if score #alive ${OBJ} matches ..1 run scoreboard players set #finish ${OBJ} 1`,
        `execute if score #running ${OBJ} matches 1 if score #alive ${OBJ} matches ..1 run scoreboard players set #running ${OBJ} 0`,
        // winner cleanup, runs once
        `execute if score #finish ${OBJ} matches 1 run gamemode creative @a[tag=${DEAD}]`,
        `execute if score #finish ${OBJ} matches 1 run tag @a[tag=${DEAD}] remove ${DEAD}`,
        `execute if score #finish ${OBJ} matches 1 run gamemode creative ${sel()}`,
        `execute if score #finish ${OBJ} matches 1 run effect clear ${sel()}`,
        `execute if score #finish ${OBJ} matches 1 run clear ${sel()} golden_shovel`,
        ...[...st.attributes.keys()].map(n => `execute if score #finish ${OBJ} matches 1 as ${sel()} run attribute @s minecraft:${n} base reset`),
        `execute if score #finish ${OBJ} matches 1 run tag ${sel()} remove ${TAG}`,
        `scoreboard players set #finish ${OBJ} 0`
    ];
    return cmds;
}

function stopTimers(st) {
    for (const t of st.timers) clearTimeout(t);
    st.timers = [];
    if (st.loop) { clearInterval(st.loop); st.loop = null; }
}

function run(ctx, cmds) {
    for (const c of cmds) if (ctx.run(c) === false) return false;
    return true;
}

function ring(o, i, n) {
    const g = geometry(o);
    const r = Math.min(10, ARENA_SIZE / 2 - 3);
    const a = (i / n) * 2 * Math.PI;
    const x = g.cx + r * Math.sin(a), z = g.cz + r * Math.cos(a);
    const yaw = -Math.atan2(g.cx - x, g.cz - z) * 180 / Math.PI;
    return { x: x.toFixed(2), y: g.topY + 1, z: z.toFixed(2), yaw: yaw.toFixed(1) };
}

function cleanup(ctx, st) {
    stopTimers(st);
    const cmds = [];
    if (st.players.size || st.phase !== 'idle') {
        cmds.push(`gamemode creative ${sel()}`, `effect clear ${sel()}`, `clear ${sel()} golden_shovel`);
        for (const name of st.attributes.keys()) cmds.push(`execute as ${sel()} run attribute @s minecraft:${name} base reset`);
        cmds.push(`gamemode creative @a[tag=${DEAD}]`);
        for (const name of st.players) cmds.push(`gamemode creative ${name}`, `tag ${name} remove ${TAG}`);
        cmds.push(`tag @a[tag=${DEAD}] remove ${DEAD}`, `tag @a[tag=${OUT}] remove ${OUT}`);
    }
    cmds.push(`scoreboard players set #running ${OBJ} 0`);
    if (st.origin) cmds.push(clearArenaCommand(st.origin));
    run(ctx, cmds);
}

function startSequence(ctx, st, say) {
    st.phase = 'countdown';
    const names = [...st.players];
    run(ctx, [
        ...names.map(n => `tag ${n} add ${TAG}`),
        `gamemode adventure ${sel()}`,
        `effect give ${sel()} minecraft:resistance infinite 255 true`
    ]);
    say(`Spleef starting in ${COUNTDOWN} seconds - players: ${names.join(', ')}.`);

    for (let i = 0; i < COUNTDOWN; i++) {
        const left = COUNTDOWN - i;
        st.timers.push(setTimeout(() => {
            const cmds = [];
            names.forEach((n, j) => {
                const p = ring(st.origin, j, names.length);
                cmds.push(`tp ${n} ${p.x} ${p.y} ${p.z} ${p.yaw} 0`);
            });
            cmds.push(`xp set ${sel()} ${left} levels`);
            cmds.push(`execute as ${sel()} at @s run playsound minecraft:block.note_block.bell ui @s ~ ~ ~ 1 0.5`);
            run(ctx, cmds);
        }, i * 1000));
    }

    st.timers.push(setTimeout(() => {
        const o = st.origin;
        run(ctx, [
            ...arenaCommands(o),
            `scoreboard objectives add ${OBJ} dummy`,
            `scoreboard players set #running ${OBJ} 0`,
            `scoreboard players set #finish ${OBJ} 0`,
            `clear ${sel()}`,
            `item replace entity ${sel()} weapon.mainhand with ${SHOVEL}`,
            `xp set ${sel()} 0 levels`,
            `effect give ${sel()} minecraft:saturation infinite 255 true`,
            `gamemode adventure ${sel()}`,
            ...applyModifierCommands(st, sel()),
            `execute as ${sel()} at @s run playsound minecraft:block.note_block.bell ui @s ~ ~ ~ 1 0.7`,
            `scoreboard players set #running ${OBJ} 1`
        ]);
        st.phase = 'running';
        say('Spleef has begun!');
        st.loop = setInterval(() => run(ctx, loopCommands(st)), LOOP_MS);
        st.timers.push(setTimeout(() => {
            if (st.phase === 'running') { cleanup(ctx, st); st.phase = 'idle'; st.origin = null; st.players.clear(); }
        }, MAX_GAME_MS));
    }, COUNTDOWN * 1000));
}

function modifierCommand(ctx, st, say, args) {
    const sub = String(args[0] || 'list').toLowerCase();
    if (sub === 'list') {
        const e = [...st.effects].map(([k, v]) => `${k}=${v}`), a = [...st.attributes].map(([k, v]) => `${k}=${v}`);
        return say(`Modifiers - effects: ${e.join(', ') || 'none'} | attributes: ${a.join(', ') || 'none'}`);
    }
    if (sub === 'clear') { st.effects.clear(); st.attributes.clear(); return say('Cleared modifiers.'); }
    if (sub === 'apply') {
        if (st.phase !== 'running') return say('Modifiers are applied automatically when the game starts.');
        run(ctx, applyModifierCommands(st, sel()));
        return say('Modifiers reapplied.');
    }
    const name = stripNs(args[1] || '');
    if (!name) return say('Usage: spleef modifier set <name> <value> | remove <name> | list | clear | apply');
    if (sub === 'remove') {
        const had = st.effects.delete(name) || st.attributes.delete(name);
        if (had && st.phase === 'running') {
            run(ctx, removeModifierCommands({
                effects: EFFECTS.has(name) ? new Map([[name, 0]]) : new Map(),
                attributes: ATTRIBUTES.has(name) ? new Map([[name, 0]]) : new Map()
            }, sel()));
        }
        return say(had ? `Removed ${name}.` : `${name} is not set.`);
    }
    if (sub === 'set') {
        const value = Number(args[2]);
        if (!Number.isFinite(value)) return say('Usage: spleef modifier set <name> <value>');
        if (EFFECTS.has(name)) {
            if (!Number.isInteger(value) || value < 0 || value > 255) return say('Effect level must be a whole number 0-255.');
            st.effects.set(name, value);
            return say(`Effect ${name} set to ${value}.`);
        }
        if (ATTRIBUTES.has(name)) { st.attributes.set(name, value); return say(`Attribute ${name} set to ${value}.`); }
        return say(`${name} is not a known effect or attribute.`);
    }
    return say('Usage: spleef modifier set <name> <value> | remove <name> | list | clear | apply');
}

module.exports = {
    name: 'spleef',
    description: 'Spleef: create <x y z> [floors], join, start, modifier, end',
    level: 0,

    // exported for tests
    _loopCommands: loopCommands, _geometry: geometry, _newState: newState,

    async execute(ctx) {
        const [action = 'help', ...args] = (ctx.args || []).map((a, i) => i === 0 ? String(a).toLowerCase() : a);
        const say = ctx.tellrawCommand.bind(ctx);
        const st = ctx.bot.spleef instanceof Object && ctx.bot.spleef.effects ? ctx.bot.spleef : (ctx.bot.spleef = newState());
        const player = ctx.player?.name;
        const usage = () => say('spleef create <x> <y> <z> [floors 1-5] | join | leave | players | start | modifier ... | end');

        if (action === 'help') return usage();

        if (action === 'create') {
            if (st.origin) return say('A spleef arena already exists; use spleef end first.');
            const [x, y, z] = args.slice(0, 3).map(Number);
            if (![x, y, z].every(Number.isInteger)) return say('Usage: spleef create <x> <y> <z> [floors 1-5]');
            const floors = args[3] === undefined ? 1 : Number(args[3]);
            if (!Number.isInteger(floors) || floors < MIN_FLOORS || floors > MAX_FLOORS) return say(`Floors must be ${MIN_FLOORS}-${MAX_FLOORS}.`);
            st.origin = { x, y, z, floors };
            st.players.clear();
            st.phase = 'idle';
            if (!run(ctx, [...arenaCommands(st.origin), `scoreboard objectives add ${OBJ} dummy`])) {
                st.origin = null;
                return say('Arena setup stopped: command core is not ready.');
            }
            return say(`Spleef arena created at ${x} ${y} ${z} (${ARENA_SIZE}x${ARENA_SIZE}, ${floors} floor(s)). Join with spleef join.`);
        }

        if (action === 'modifier' || action === 'modifiers') return modifierCommand(ctx, st, say, args);

        if (!st.origin) return say('No arena. Create one with spleef create <x> <y> <z>.');

        if (action === 'join') {
            if (!player) return say('Could not identify player.');
            if (st.phase !== 'idle') return say('The game has already started.');
            if (st.players.has(player)) return say(`${player} is already in.`);
            st.players.add(player);
            const g = geometry(st.origin);
            run(ctx, [`tp ${player} ${g.cx} ${g.topY + 1} ${g.cz}`]);
            return say(`${player} joined spleef (${st.players.size} player(s)).`);
        }
        if (action === 'leave') {
            if (st.phase !== 'idle') return say("Can't leave once the game has started.");
            return say(st.players.delete(player) ? `${player} left spleef.` : `${player} isn't in the game.`);
        }
        if (action === 'players') return say(`Spleef players: ${[...st.players].join(', ') || '(none)'}`);

        if (action === 'start') {
            if (st.phase !== 'idle') return say('A game is already in progress.');
            if (st.players.size < 2) return say('At least two players must join before start.');
            return startSequence(ctx, st, say);
        }

        if (action === 'end') {
            cleanup(ctx, st);
            st.origin = null; st.players.clear(); st.phase = 'idle';
            return say('Spleef ended and arena cleared.');
        }
        usage();
    }
};