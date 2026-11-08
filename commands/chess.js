const games = new WeakMap(); // key -> active game
const pending = new WeakMap(); // key -> unanswered challenge
const visuals = new WeakMap(); // key -> where the board is drawn (blocks / textdisplay), kept after a game ends until `chess clear`

const BACK_RANK = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
const PIECE_NAMES = { q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn', k: 'king' };

const MODES = ['chat', 'blocks', 'textdisplay'];
const MODE_ALIASES = { block: 'blocks', text: 'textdisplay', display: 'textdisplay', td: 'textdisplay' };
const CHALLENGE_TTL_MS = 60000;

const COLORS = {
  prefix: '#238bff',
  text: '#f4fcff',
  coord: '#55aaff',
  white: '#f4fcff',
  black: '#ffaa00',
  light: '#6b6b6b',
  dark: '#3d3d3d',
  ok: '#55ff55',
  err: '#ff5555',
  warn: '#ffff55',
  win: '#ffaa00',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isWhite = (piece) => piece === piece.toUpperCase();
const cloneBoard = (b) => b.map((row) => row.slice());
const sqName = (x, y) => String.fromCharCode(97 + x) + (8 - y);
const sideColor = (white) => (white ? COLORS.white : COLORS.black);

function newBoard() {
  return Array.from({ length: 8 }, (_, r) =>
    Array.from({ length: 8 }, (_, c) => {
      if (r === 0) return BACK_RANK[c];
      if (r === 1) return 'p';
      if (r === 6) return 'P';
      if (r === 7) return BACK_RANK[c].toUpperCase();
      return null;
    })
  );
}

function parseSquare(s) {
  return typeof s === 'string' && /^[a-h][1-8]$/i.test(s)
    ? { x: s.toLowerCase().charCodeAt(0) - 97, y: 8 - Number(s[1]) }
    : null;
}

// ---------- Output (colored tellraw components) ----------

const t = (text, color = COLORS.text) => ({ text, color });

// A message line: "Chess » <text>". Pass components for mixed colors, or a string + color.
const msg = (content, color = COLORS.text) => [
  t('Chess » ', COLORS.prefix),
  ...(Array.isArray(content) ? content : [t(content, color)]),
];
const ok = (text) => msg(text, COLORS.ok);
const err = (text) => msg(text, COLORS.err);
const warn = (text) => msg(text, COLORS.warn);

const playerTag = (name, white) => t(name, sideColor(white));

// Letters only (R N B Q K P) so every cell is the same width in Minecraft's font.
// White and black are told apart by color; empty squares are a shaded "-".
function boardLines(b) {
  const rows = b.map((row, y) => {
    const line = [t(`${8 - y} `, COLORS.coord)];
    row.forEach((p, x) => {
      const cell = p
        ? t(p.toUpperCase(), sideColor(isWhite(p)))
        : t('-', (x + y) % 2 ? COLORS.dark : COLORS.light);
      line.push(cell, t(' '));
    });
    return line;
  });
  rows.push([t('  A B C D E F G H', COLORS.coord)]);
  return rows;
}

// "Check! Alice's turn (white)." without the "Chess » " prefix.
function statusParts(g, check = false) {
  const white = g.turn === 0;
  return [
    ...(check ? [t('Check! ', COLORS.err)] : []),
    playerTag(g.players[g.turn], white),
    t(`'s turn (${white ? 'white' : 'black'}).`),
  ];
}
const turnLine = (g, check = false) => msg(statusParts(g, check));

// Joins lines (arrays of components) into one flat component list with "\n" between them.
function joinLines(lines) {
  const extra = [];
  lines.forEach((line, i) => {
    if (i) extra.push({ text: '\n' });
    extra.push(...line);
  });
  return extra;
}

// ---------- Command pacing + position lookup ----------

const COMMAND_GAP_MS = 15;
let nextSlot = 0;

async function run(ctx, command) {
  const now = Date.now();
  const start = Math.max(now, nextSlot);
  nextSlot = start + COMMAND_GAP_MS;
  if (start > now) await sleep(start - now);
  try {
    return (await ctx.run(command)) !== false;
  } catch (e) {
    return false;
  }
}

// Reads a player's position by echoing their Pos NBT back through chat (same trick as the shell command).
function getPlayerPos(ctx, name) {
  const bot = ctx.bot;
  if (!bot || typeof bot.on !== 'function') return Promise.resolve(null);
  const tag = `chesspos${Math.random().toString(36).slice(2, 8)}:`;
  const regex = new RegExp(
    `${tag}\\s*\\[\\s*(-?[\\d.eE+-]+)d?\\s*,\\s*(-?[\\d.eE+-]+)d?\\s*,\\s*(-?[\\d.eE+-]+)d?\\s*\\]`
  );
  const botName = bot.config?.username || '@a';

  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      bot.removeListener('chat_plain', onMessage);
      resolve(v);
    };
    const onMessage = (message) => {
      if (typeof message !== 'string') return;
      const m = message.replace(/\x1b\[[0-9;]*m/g, '').match(regex);
      if (!m) return;
      const pos = { x: Math.floor(Number(m[1])), y: Math.floor(Number(m[2])), z: Math.floor(Number(m[3])) };
      if (Object.values(pos).every(Number.isFinite)) finish(pos);
    };
    const timer = setTimeout(() => finish(null), 3000);
    bot.on('chat_plain', onMessage);
    run(ctx, `tellraw ${botName} ${JSON.stringify([{ text: tag }, { nbt: 'Pos', entity: name }])}`).catch(() => {});
  });
}

// ---------- Blocks mode (a 24x24 board built from blocks) ----------

const SQ = 3; // each chess square is 3x3 blocks
const PIECE_MAX_H = 6;
const FLOOR_BLOCKS = { light: 'birch_planks', dark: 'dark_oak_planks' };
const PIECE_BLOCKS = { white: 'white_concrete', black: 'black_concrete' };
// Piece = a 1x1 column. Height tells the type; a colored cap on top makes it readable at a glance.
const PIECE_HEIGHT = { p: 1, n: 2, b: 3, r: 4, q: 5, k: 6 };
const PIECE_CAPS = { n: 'lapis_block', b: 'emerald_block', r: 'redstone_block', q: 'diamond_block', k: 'gold_block' };
const BLOCKS_LEGEND = 'Blocks: P=1 N=2 B=3 R=4 Q=5 K=6 high. Caps: N lapis, B emerald, R redstone, Q diamond, K gold. White/black concrete = side.';

async function drawSquare(ctx, o, x, y, piece, clear = true) {
  const cx = o.x + x * SQ + 1;
  const cz = o.z + y * SQ + 1;
  if (clear) await run(ctx, `fill ${cx} ${o.y + 1} ${cz} ${cx} ${o.y + PIECE_MAX_H} ${cz} air`);
  if (!piece) return;
  const lower = piece.toLowerCase();
  const h = PIECE_HEIGHT[lower];
  await run(ctx, `fill ${cx} ${o.y + 1} ${cz} ${cx} ${o.y + h} ${cz} ${isWhite(piece) ? PIECE_BLOCKS.white : PIECE_BLOCKS.black}`);
  if (PIECE_CAPS[lower]) await run(ctx, `setblock ${cx} ${o.y + h} ${cz} ${PIECE_CAPS[lower]}`);
}

async function drawBoardBlocks(ctx, o, b) {
  const size = SQ * 8;
  await run(ctx, `fill ${o.x} ${o.y} ${o.z} ${o.x + size - 1} ${o.y + PIECE_MAX_H} ${o.z + size - 1} air`);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const X = o.x + x * SQ;
      const Z = o.z + y * SQ;
      const floor = (x + y) % 2 ? FLOOR_BLOCKS.dark : FLOOR_BLOCKS.light;
      await run(ctx, `fill ${X} ${o.y} ${Z} ${X + SQ - 1} ${o.y} ${Z + SQ - 1} ${floor}`);
    }
  }
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) await drawSquare(ctx, o, x, y, b[y][x], false);
}

// Only redraws squares that changed (covers captures, en passant, castling and promotion).
async function updateBlocks(ctx, o, b, prev) {
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (b[y][x] !== prev[y][x]) await drawSquare(ctx, o, x, y, b[y][x]);
    }
  }
}

// ---------- Text display mode (one floating text_display entity) ----------

function displayComponent(g, footer) {
  const lines = [
    [t('Chess  ', COLORS.prefix), playerTag(g.players[0], true), t(' vs '), playerTag(g.players[1], false)],
    [t(' ')],
    ...boardLines(g.b),
    [t(' ')],
    footer,
  ];
  return { text: '', extra: joinLines(lines) };
}

async function spawnDisplay(ctx, v, g, footer) {
  const { x, y, z } = v.pos;
  return run(
    ctx,
    `summon minecraft:text_display ${x + 0.5} ${y + 2.5} ${z + 0.5} ` +
      `{Tags:["${v.tag}"],text:${JSON.stringify(displayComponent(g, footer))},` +
      `background:0xDD101018,alignment:"left",line_width:400,see_through:0b,shadow:1b,billboard:"center",` +
      `transformation:{left_rotation:[0f,0f,0f,1f],right_rotation:[0f,0f,0f,1f],scale:[1.5f,1.5f,1.5f],translation:[0f,0f,0f]}}`
  );
}

async function updateDisplay(ctx, v, g, footer) {
  return run(
    ctx,
    `data merge entity @e[type=minecraft:text_display,tag=${v.tag},limit=1] {text:${JSON.stringify(displayComponent(g, footer))}}`
  );
}

async function clearVisual(ctx, key) {
  const v = visuals.get(key);
  if (!v) return false;
  visuals.delete(key);
  if (v.mode === 'blocks') {
    const o = v.origin;
    const size = SQ * 8;
    await run(ctx, `fill ${o.x} ${o.y} ${o.z} ${o.x + size - 1} ${o.y + PIECE_MAX_H} ${o.z + size - 1} air`);
  } else {
    await run(ctx, `kill @e[type=minecraft:text_display,tag=${v.tag}]`);
  }
  return true;
}

// ---------- Move geometry ----------

function pathClear(b, fx, fy, tx, ty) {
  const sx = Math.sign(tx - fx);
  const sy = Math.sign(ty - fy);
  for (let x = fx + sx, y = fy + sy; x !== tx || y !== ty; x += sx, y += sy) {
    if (b[y][x]) return false;
  }
  return true;
}

// Does the piece on (fx,fy) attack square (tx,ty)? Ignores whose piece is on the target.
function attacks(b, fx, fy, tx, ty) {
  const piece = b[fy][fx];
  if (!piece) return false;
  const dx = tx - fx;
  const dy = ty - fy;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (!dx && !dy) return false;
  switch (piece.toLowerCase()) {
    case 'p': return ax === 1 && dy === (isWhite(piece) ? -1 : 1);
    case 'n': return (ax === 1 && ay === 2) || (ax === 2 && ay === 1);
    case 'k': return Math.max(ax, ay) === 1;
    case 'r': return (dx === 0 || dy === 0) && pathClear(b, fx, fy, tx, ty);
    case 'b': return ax === ay && pathClear(b, fx, fy, tx, ty);
    case 'q': return (dx === 0 || dy === 0 || ax === ay) && pathClear(b, fx, fy, tx, ty);
  }
  return false;
}

function isAttacked(b, x, y, byWhite) {
  for (let fy = 0; fy < 8; fy++) {
    for (let fx = 0; fx < 8; fx++) {
      const p = b[fy][fx];
      if (p && isWhite(p) === byWhite && attacks(b, fx, fy, x, y)) return true;
    }
  }
  return false;
}

function inCheck(b, white) {
  const kingChar = white ? 'K' : 'k';
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (b[y][x] === kingChar) return isAttacked(b, x, y, !white);
    }
  }
  return false; // no king on board (should not happen)
}

function castleMove(g, from, to, white) {
  const row = white ? 7 : 0;
  if (from.x !== 4 || from.y !== row || to.y !== row) return null;
  const kingside = to.x === 6;
  if (!g.castle[white ? (kingside ? 'K' : 'Q') : kingside ? 'k' : 'q']) return null;
  const rookX = kingside ? 7 : 0;
  if (g.b[row][rookX] !== (white ? 'R' : 'r')) return null;
  const between = kingside ? [5, 6] : [1, 2, 3];
  if (between.some((x) => g.b[row][x])) return null;
  // The king may not castle out of, through, or into check.
  for (const x of [4, kingside ? 5 : 3, to.x]) {
    if (isAttacked(g.b, x, row, !white)) return null;
  }
  return { type: 'castle', rookFrom: rookX, rookTo: kingside ? 5 : 3 };
}

// Pseudo-legal move (ignores leaving own king in check). Returns a descriptor or null.
function getMove(g, from, to) {
  const b = g.b;
  const piece = b[from.y][from.x];
  if (!piece) return null;
  if (from.x === to.x && from.y === to.y) return null;
  const white = isWhite(piece);
  const target = b[to.y][to.x];
  if (target && isWhite(target) === white) return null;

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const lower = piece.toLowerCase();

  if (lower === 'p') {
    const step = white ? -1 : 1;
    const startRow = white ? 6 : 1;
    if (dx === 0 && !target) {
      if (dy === step) return { type: 'normal' };
      if (dy === 2 * step && from.y === startRow && !b[from.y + step][from.x]) return { type: 'double' };
      return null;
    }
    if (ax === 1 && dy === step) {
      if (target) return { type: 'normal' };
      if (g.ep && g.ep.x === to.x && g.ep.y === to.y) return { type: 'ep' };
    }
    return null;
  }

  if (lower === 'k') {
    if (Math.max(ax, ay) === 1) return { type: 'normal' };
    if (ay === 0 && ax === 2) return castleMove(g, from, to, white);
    return null;
  }

  return attacks(b, from.x, from.y, to.x, to.y) ? { type: 'normal' } : null;
}

function applyMove(b, from, to, m, promo = 'q') {
  const nb = cloneBoard(b);
  let piece = nb[from.y][from.x];
  if (m.type === 'ep') nb[from.y][to.x] = null; // captured pawn sits beside the mover
  if (m.type === 'castle') {
    nb[from.y][m.rookTo] = nb[from.y][m.rookFrom];
    nb[from.y][m.rookFrom] = null;
  }
  if (piece.toLowerCase() === 'p' && (to.y === 0 || to.y === 7)) {
    piece = isWhite(piece) ? promo.toUpperCase() : promo.toLowerCase();
  }
  nb[to.y][to.x] = piece;
  nb[from.y][from.x] = null;
  return nb;
}

function hasLegalMove(g, white) {
  for (let fy = 0; fy < 8; fy++) {
    for (let fx = 0; fx < 8; fx++) {
      const p = g.b[fy][fx];
      if (!p || isWhite(p) !== white) continue;
      for (let ty = 0; ty < 8; ty++) {
        for (let tx = 0; tx < 8; tx++) {
          const from = { x: fx, y: fy };
          const to = { x: tx, y: ty };
          const m = getMove(g, from, to);
          if (m && !inCheck(applyMove(g.b, from, to, m), white)) return true;
        }
      }
    }
  }
  return false;
}

function insufficientMaterial(b) {
  const pieces = [];
  for (const row of b) for (const p of row) if (p && p.toLowerCase() !== 'k') pieces.push(p.toLowerCase());
  if (pieces.length === 0) return true;
  return pieces.length === 1 && (pieces[0] === 'b' || pieces[0] === 'n');
}

// ---------- Input handling ----------

const ACTIONS = ['challenge', 'accept', 'decline', 'move', 'board', 'resign', 'clear'];
const ALIASES = {
  challange: 'challenge',
  chalenge: 'challenge',
  challenege: 'challenge',
  play: 'challenge',
  acept: 'accept',
  deny: 'decline',
  reject: 'decline',
  cancel: 'decline',
  mv: 'move',
  show: 'board',
  resgin: 'resign',
  quit: 'resign',
};
const SHARED_KEY = {};

const toAction = (s) => {
  const w = s.toLowerCase();
  return ACTIONS.includes(w) ? w : ALIASES[w] || null;
};

const toMode = (s) => {
  const w = s.toLowerCase();
  return MODES.includes(w) ? w : MODE_ALIASES[w] || null;
};

function flattenTokens(v, out = [], depth = 0) {
  if (v == null || depth > 3) return out;
  if (typeof v === 'string') out.push(...v.split(/\s+/).filter(Boolean));
  else if (typeof v === 'number') out.push(String(v));
  else if (Array.isArray(v)) v.forEach((x) => flattenTokens(x, out, depth + 1));
  else if (typeof v === 'object') Object.values(v).forEach((x) => flattenTokens(x, out, depth + 1));
  return out;
}

// Finds the action word wherever the framework put the arguments, and returns everything after it.
function parseInput(ctx) {
  const fields = ['args', 'arguments', 'argv', 'params', 'parameters', 'rawArgs', 'input', 'text', 'message', 'content', 'raw'];
  const candidates = fields.map((f) => ctx[f]).filter((v) => v != null);
  const isCommandWord = (s) => /^\S*chess$/i.test(s); // "chess", "nr:chess", "!chess"

  let leftovers = [];
  for (const c of candidates) {
    const tokens = flattenTokens(c);
    const i = tokens.findIndex((s) => toAction(s));
    if (i !== -1) return { action: toAction(tokens[i]), rest: tokens.slice(i + 1) };
    if (!leftovers.length) leftovers = tokens.filter((s) => !isCommandWord(s));
  }
  // Nothing recognised: a bare "chess" shows the board, anything else gets the usage message.
  return leftovers.length ? { action: null, rest: leftovers } : { action: 'board', rest: [] };
}

function playerName(ctx) {
  const cand = [ctx.player, ctx.sender, ctx.user, ctx.username, ctx.author];
  for (const c of cand) {
    if (typeof c === 'string' && c) return c;
    if (c && typeof c === 'object') {
      const n = c.name ?? c.username ?? c.displayName;
      if (typeof n === 'string' && n) return n;
    }
  }
  return 'Console';
}

// ---------- Command ----------

const USAGE =
  'Usage: chess challenge <opponent> [chat|blocks|textdisplay] [x y z] | chess accept | chess decline | chess move <from> <to> | chess board | chess resign | chess clear';

module.exports = {
  name: 'chess',
  description:
    'Chess: chess challenge <name> [chat|blocks|textdisplay], chess accept|decline, chess move <from> <to> [q|r|b|n], chess board|resign|clear',
  level: 0,

  async execute(ctx) {
    const { action, rest } = parseInput(ctx);

    // Each line is an array of colored components. Console output is plain text; chat output is one tellraw.
    const say = async (...lines) => {
      // each argument is either one line (array of components) or a group of lines (array of lines)
      const flat = lines.flatMap((l) => (Array.isArray(l[0]) ? l : [l]));
      if (!flat.length) return;
      if (ctx.source === 'console' || typeof ctx.run !== 'function') {
        for (const line of flat) console.log(line.map((c) => c.text).join(''));
        return;
      }
      return ctx.run(`tellraw @a ${JSON.stringify({ text: '', extra: joinLines(flat) })}`);
    };

    const key = ctx.bot || ctx.client || ctx.server || SHARED_KEY; // must be the same object on every call
    const p = playerName(ctx);
    const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();

    if (!action) {
      console.log('[chess] could not find an action in ctx. keys:', Object.keys(ctx), 'args:', JSON.stringify(ctx.args));
      return say(warn(USAGE));
    }
    let g = games.get(key);

    // A challenge that nobody answered in time is dropped the next time anyone asks about it.
    const livePending = () => {
      const pc = pending.get(key);
      if (pc && Date.now() > pc.expires) {
        clearTimeout(pc.timer);
        pending.delete(key);
        return null;
      }
      return pc || null;
    };
    const dropPending = (pc) => {
      clearTimeout(pc.timer);
      pending.delete(key);
    };

    // Shows an update in whichever mode the game uses. chat: lines + board in chat.
    // blocks / textdisplay: the board is updated in the world and chat only gets the text lines.
    const present = async (game, { prev, head = [], tail = [], footer, board = true }) => {
      if (game.mode === 'chat') return say(...head, ...(board ? [boardLines(game.b)] : []), ...tail);
      const v = visuals.get(key);
      if (v?.mode === 'blocks' && prev) await updateBlocks(ctx, v.origin, game.b, prev);
      if (v?.mode === 'textdisplay') await updateDisplay(ctx, v, game, footer || statusParts(game));
      return say(...head, ...tail);
    };

    if (action === 'challenge') {
      const [opponent, ...opts] = rest;
      if (!opponent) return say(warn(USAGE));
      if (sameName(opponent, p)) return say(err('You cannot challenge yourself.'));
      if (g) return say(err('A chess game is already active.'));

      let mode = 'chat';
      const nums = [];
      for (const o of opts) {
        if (toMode(o)) mode = toMode(o);
        else if (/^-?\d+$/.test(o)) nums.push(Number(o));
        else return say(warn(`Unknown option "${o}". Modes: chat, blocks, textdisplay.`));
      }
      if (nums.length && nums.length !== 3) return say(warn('Coordinates need three numbers: x y z.'));
      if (mode !== 'chat' && typeof ctx.run !== 'function') return say(err(`${mode} mode needs in-game command access.`));
      const coords = nums.length === 3 ? { x: nums[0], y: nums[1], z: nums[2] } : null;

      const cur = livePending();
      if (cur && !sameName(cur.from, p)) {
        return say(err(`${cur.from} already has a pending challenge to ${cur.to}. Wait for it to be answered or expire.`));
      }
      if (cur) dropPending(cur); // the challenger is replacing their own pending challenge

      const pc = { from: p, to: opponent, mode, coords, expires: Date.now() + CHALLENGE_TTL_MS };
      pc.timer = setTimeout(() => {
        if (pending.get(key) !== pc) return;
        pending.delete(key);
        Promise.resolve(say(warn(`Chess challenge from ${p} to ${opponent} expired.`))).catch(() => {});
      }, CHALLENGE_TTL_MS);
      pc.timer.unref?.();
      pending.set(key, pc);

      return say(
        msg([
          playerTag(p, true),
          t(' challenged '),
          playerTag(opponent, false),
          t(` to chess (${mode} mode).`),
        ]),
        msg([
          playerTag(opponent, false),
          t(': type '),
          t('chess accept', COLORS.ok),
          t(' to play or '),
          t('chess decline', COLORS.err),
          t(` (expires in ${CHALLENGE_TTL_MS / 1000}s).`),
        ])
      );
    }

    if (action === 'accept') {
      const pc = livePending();
      if (!pc) return say(err('No pending challenge.'));
      if (sameName(p, pc.from)) return say(err(`Waiting for ${pc.to} to accept.`));
      if (!sameName(p, pc.to)) return say(err(`That challenge is for ${pc.to}.`));

      // blocks / textdisplay need to know where to draw: explicit coordinates, else where the challenger stands.
      let v = null;
      if (pc.mode !== 'chat') {
        const pos = pc.coords || (await getPlayerPos(ctx, pc.from));
        if (!pos) {
          return say(
            err(`Could not read ${pc.from}'s position. Challenge again with coordinates: chess challenge ${pc.to} ${pc.mode} <x y z>`)
          );
        }
        if (pending.get(key) !== pc || games.get(key)) return; // changed while we were looking up the position
        v =
          pc.mode === 'blocks'
            ? { mode: 'blocks', origin: pc.coords ? pos : { x: pos.x - SQ * 4, y: pos.y - 1, z: pos.z - SQ * 4 } }
            : { mode: 'textdisplay', tag: `chess_${Math.random().toString(36).slice(2, 8)}`, pos };
      }

      dropPending(pc);
      await clearVisual(ctx, key); // remove the board of the previous game, if one was left standing
      g = {
        players: [pc.from, p],
        turn: 0,
        b: newBoard(),
        castle: { K: true, Q: true, k: true, q: true },
        ep: null,
        mode: pc.mode,
      };
      games.set(key, g);

      const intro = msg([
        t('Challenge accepted! '),
        playerTag(g.players[0], true),
        t(' (white) vs '),
        playerTag(g.players[1], false),
        t(` (black). Mode: ${g.mode}.`),
      ]);
      const hint = msg('Use chess move <from> <to>. Example: chess move e2 e4', COLORS.coord);

      if (g.mode === 'chat') return say(intro, boardLines(g.b), hint);

      await say(intro);
      visuals.set(key, v);
      if (g.mode === 'blocks') {
        await drawBoardBlocks(ctx, v.origin, g.b);
        return say(
          msg(`${BLOCKS_LEGEND} White starts at the south edge; A-H run west to east.`, COLORS.coord),
          turnLine(g),
          hint
        );
      }
      await spawnDisplay(ctx, v, g, statusParts(g));
      return say(turnLine(g), hint);
    }

    if (action === 'decline') {
      const pc = livePending();
      if (!pc) return say(err('No pending challenge.'));
      const isFrom = sameName(p, pc.from);
      if (!isFrom && !sameName(p, pc.to)) return say(err('That challenge is not yours.'));
      dropPending(pc);
      return say(
        msg([
          playerTag(p, isFrom),
          t(isFrom ? ' cancelled the challenge to ' : ' declined the challenge from '),
          playerTag(isFrom ? pc.to : pc.from, !isFrom),
          t('.'),
        ])
      );
    }

    if (action === 'clear') {
      if (g) return say(err('A game is in progress. Use chess resign first.'));
      return say((await clearVisual(ctx, key)) ? ok('Board removed.') : warn('Nothing to clear.'));
    }

    if (!g) {
      const pc = livePending();
      if (pc) return say(warn(`${pc.to} has not accepted ${pc.from}'s challenge yet (chess accept).`));
      return say(err('No game. Start with chess challenge <opponent>.'));
    }

    if (action === 'board') {
      if (g.mode === 'chat') return say(boardLines(g.b), turnLine(g));
      // In blocks / textdisplay mode this redraws the board, which also repairs it if something broke it.
      const v = visuals.get(key);
      if (v?.mode === 'blocks') await drawBoardBlocks(ctx, v.origin, g.b);
      else if (v) {
        await run(ctx, `kill @e[type=minecraft:text_display,tag=${v.tag}]`);
        await spawnDisplay(ctx, v, g, statusParts(g));
      }
      return say(turnLine(g));
    }

    if (action === 'resign') {
      const idx = g.players.findIndex((n) => sameName(n, p));
      if (idx === -1) return say(err('You are not in this game.'));
      games.delete(key);
      const parts = [
        playerTag(p, idx === 0),
        t(' resigned. '),
        playerTag(g.players[1 - idx], idx !== 0),
        t(' wins!', COLORS.win),
      ];
      return present(g, { tail: [msg(parts)], footer: parts, board: false });
    }

    if (action !== 'move') {
      return say(warn(USAGE));
    }

    // Accept: "e2 e4", "e2e4", "e7 e8 q", "e7e8q", "e7 e8=q"
    const m = rest.join('').replace(/[-=]/g, '').match(/^([a-h][1-8])([a-h][1-8])([qrbn])?$/i);
    if (!m) return say(warn('Usage: chess move <from> <to> [q|r|b|n]  (example: chess move e2 e4)'));
    const from = parseSquare(m[1]);
    const to = parseSquare(m[2]);
    const promo = m[3] ? m[3].toLowerCase() : null;

    if (!sameName(g.players[g.turn], p)) {
      return say(err(`It is ${g.players[g.turn]}'s turn.`));
    }

    const white = g.turn === 0;
    const piece = g.b[from.y][from.x];
    if (!piece) return say(err('No piece on that square.'));
    if (isWhite(piece) !== white) return say(err('That is not your piece.'));
    if (from.x === to.x && from.y === to.y) return say(err('You must move the piece to a different square.'));

    const target = g.b[to.y][to.x];
    if (target && isWhite(target) === white) return say(err('You cannot capture your own piece.'));

    const move = getMove(g, from, to);
    if (!move) return say(err('Illegal move for that piece.'));

    const isPromotion = piece.toLowerCase() === 'p' && (to.y === 0 || to.y === 7);
    if (isPromotion && !promo) {
      return say(warn(`Promotion! Choose a piece: chess move ${m[1]} ${m[2]} <q|r|b|n> (queen, rook, bishop, knight).`));
    }
    if (!isPromotion && promo) return say(err('Only pawns reaching the last rank can promote.'));

    const nb = applyMove(g.b, from, to, move, promo || 'q');
    if (inCheck(nb, white)) {
      return say(
        err(
          inCheck(g.b, white)
            ? 'Your king is in check. That move does not get you out of check.'
            : 'Illegal move: it would leave your king in check.'
        )
      );
    }

    // Commit the move
    const prev = g.b;
    g.b = nb;
    const lose = (k) => { g.castle[k] = false; };
    if (piece === 'K') { lose('K'); lose('Q'); }
    if (piece === 'k') { lose('k'); lose('q'); }
    for (const s of [from, to]) {
      if (s.x === 0 && s.y === 7) lose('Q');
      if (s.x === 7 && s.y === 7) lose('K');
      if (s.x === 0 && s.y === 0) lose('q');
      if (s.x === 7 && s.y === 0) lose('k');
    }
    g.ep = move.type === 'double' ? { x: from.x, y: (from.y + to.y) / 2 } : null;
    g.turn = 1 - g.turn;

    const notes = [];
    if (move.type === 'castle') notes.push(move.rookTo === 5 ? 'castled kingside' : 'castled queenside');
    if (move.type === 'ep') notes.push('captured en passant');
    else if (target) notes.push(`captured a ${PIECE_NAMES[target.toLowerCase()]}`);
    if (isPromotion) notes.push(`promoted to a ${PIECE_NAMES[promo]}`);
    const summary = msg([
      playerTag(p, white),
      t(' played '),
      t(`${sqName(from.x, from.y)}-${sqName(to.x, to.y)}`, COLORS.coord),
      ...(notes.length ? [t(` (${notes.join(', ')})`, COLORS.warn)] : []),
      t('.'),
    ]);

    const nextWhite = g.turn === 0;
    const check = inCheck(g.b, nextWhite);
    const canMove = hasLegalMove(g, nextWhite);

    // Ends the game and shows the final position with a result line.
    const finish = (parts) => {
      games.delete(key);
      return present(g, { prev, head: [summary], tail: [msg(parts)], footer: parts });
    };

    if (!canMove && check) return finish([t('Checkmate! ', COLORS.err), playerTag(p, white), t(' wins.', COLORS.win)]);
    if (!canMove) return finish([t('Stalemate! The game is a draw.', COLORS.warn)]);
    if (insufficientMaterial(g.b)) return finish([t('Draw by insufficient material.', COLORS.warn)]);

    const parts = statusParts(g, check);
    return present(g, { prev, head: [summary], tail: [msg(parts)], footer: parts });
  },
};