const MAX_LENGTH = 20;
const DEFAULT_LENGTH = 8;
const LIFT = 4;           // course floats this far above the player, so a missed jump is a real fall
const MAX_SIDE = 5;       // max sideways drift from the start line
const FILL_LIMIT = 32768; // vanilla /fill block cap

// One course per player, remembered so `clear` knows where it is and how big it was.
const courses = new Map();

function integer(value, fallback, min, max) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
}

function seedValue(value) {
    if (!value) return (Math.random() * 0x100000000) >>> 0;
    let hash = 2166136261;
    for (const char of String(value)) {
        hash ^= char.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function random(seed) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

function usage(say) {
    say('Usage: parkour <generate|clear|help> [length] [seed]');
}

// Platform spacing is centre-to-centre in blocks. Reach: 4 flat/down, 3 up,
// minus 1 for a sideways step. Every jump this produces is makeable.
function planCourse(length, rng) {
    // path[0] is the far edge of the 3x3 start pad.
    const path = [{ x: 1, y: 0, z: 0, dx: 0, dy: 0 }];
    for (let i = 1; i <= length; i += 1) {
        const prev = path[i - 1];
        const rise = rng();
        const side = rng();
        const hop = rng();

        const dy = rise < 0.3 ? 1 : (rise < 0.5 && prev.y > 0) ? -1 : 0;
        let dz = side < 0.3 ? -1 : side < 0.6 ? 1 : 0;
        if (Math.abs(prev.z + dz) > MAX_SIDE) dz = -dz;

        // First jump has almost no run-up, so keep it short.
        const base = (dy === 1 || i === 1) ? 3 : 4;
        const reach = base - (dz !== 0 ? 1 : 0);
        const dx = Math.min(reach, hop < 0.45 ? 2 : hop < 0.85 ? 3 : 4);

        path.push({ x: prev.x + dx, y: prev.y + dy, z: prev.z + dz, dx, dy });
    }
    return path;
}

function courseBox(path) {
    const zs = path.map(p => p.z);
    return {
        x1: -2,
        x2: Math.max(...path.map(p => p.x)) + 2,
        z1: Math.min(0, ...zs) - 2,
        z2: Math.max(0, ...zs) + 2,
        y1: 0,
        y2: LIFT + Math.max(...path.map(p => p.y)) + 4
    };
}

// /fill air over the box, split along X so no single fill exceeds the block cap.
function airFills(box) {
    const area = (box.y2 - box.y1 + 1) * (box.z2 - box.z1 + 1);
    const step = Math.max(1, Math.floor(FILL_LIMIT / area));
    const out = [];
    for (let x = box.x1; x <= box.x2; x += step) {
        const x2 = Math.min(x + step - 1, box.x2);
        out.push(`fill ~${x} ~${box.y1} ~${box.z1} ~${x2} ~${box.y2} ~${box.z2} air`);
    }
    return out;
}

function runAll(ctx, commands) {
    let completed = 0;
    for (const command of commands) {
        if (ctx.run(command) === false) break;
        completed += 1;
    }
    return completed;
}

module.exports = {
    name: 'parkour',
    description: 'Generate or clear a bounded parkour course at your position',
    aliases: ['pk'],
    level: 0,

    async execute(ctx) {
        const args = ctx.args || [];
        const say = ctx.tellrawCommand.bind(ctx);
        const action = String(args[0] || 'help').toLowerCase();

        if (action !== 'generate' && action !== 'clear') return usage(say);

        const target = ctx.player?.name || '@s';
        const tag = `parkour_${String(ctx.player?.name || 'console').replace(/[^\w.+-]/g, '_')}`;
        const anchor = `@e[type=marker,tag=${tag},limit=1]`;
        // Everything is placed relative to an invisible marker, so the course stays put
        // even if the player moves mid-build, and `clear` can find it later.
        const atAnchor = command => `execute at ${anchor} run ${command}`;
        const record = courses.get(tag);

        if (action === 'clear') {
            if (!record) return say('No parkour recorded to clear (it may predate a restart).');
            const fills = airFills(record.box).map(atAnchor);
            const done = runAll(ctx, fills);
            if (done === fills.length) {
                ctx.run(`kill @e[type=marker,tag=${tag}]`);
                courses.delete(tag);
            }
            return say(`Parkour cleared: ${done}/${fills.length} commands.`);
        }

        const length = integer(args[1], DEFAULT_LENGTH, 1, MAX_LENGTH);
        const seed = seedValue(args[2]);
        const path = planCourse(length, random(seed));
        const box = courseBox(path);
        const commands = [];

        if (record) {
            // Regenerate in place: wipe the old course first.
            commands.push(...airFills(record.box).map(atAnchor));
        } else {
            ctx.run(`kill @e[type=marker,tag=${tag}]`); // stray marker from an old session
            commands.push(`execute as ${target} at @s align xyz run summon marker ~ ~ ~ {Tags:["${tag}"]}`);
        }
        courses.set(tag, { box });

        // Carve a clean volume. No floor: the gaps are real drops.
        commands.push(...airFills(box).map(atAnchor));

        // 3x3 start pad.
        commands.push(atAnchor(`fill ~-1 ~${LIFT - 1} ~-1 ~1 ~${LIFT - 1} ~1 smooth_stone`));

        // Platforms. Last one is the finish.
        for (let i = 1; i <= length; i += 1) {
            const p = path[i];
            const block = i === length ? 'emerald_block' : i % 5 === 0 ? 'gold_block' : 'smooth_stone';
            commands.push(atAnchor(`setblock ~${p.x} ~${LIFT - 1 + p.y} ~${p.z} ${block}`));
        }

        // Headhitters: a ceiling 3 above the platform surface, only over a platform that is
        // both entered and left by a short (2-block) flat-or-down hop, so it stays makeable.
        for (let i = 1; i < length; i += 1) {
            const p = path[i];
            const n = path[i + 1];
            if (p.dx === 2 && p.dy <= 0 && n.dx === 2 && n.dy <= 0) {
                commands.push(atAnchor(`setblock ~${p.x} ~${LIFT + 2 + p.y} ~${p.z} stone`));
            }
        }

        // Put the player on the start pad.
        commands.push(`execute as ${target} at ${anchor} run tp @s ~0.5 ~${LIFT} ~0.5`);

        const completed = runAll(ctx, commands);
        say(`Parkour generated: ${completed}/${commands.length} commands (length ${length}, seed ${seed}). Reach the emerald block.`);
    }
};