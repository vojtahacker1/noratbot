
const { Terminal } = require('@xterm/headless');

const sessions = new WeakMap();
const networkSettings = new WeakMap();

const WIDTH = 100;
const HEIGHT = 30;
const RENDER_INTERVAL = 400;
const COMMAND_GAP_MS = 10;
const MAX_COMMAND_LENGTH = 30000;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

let nextCommandSlot = 0;
let WasmerClass;

// ------------------------------------------------------------
// Packages
// ------------------------------------------------------------

const BASE_PACKAGES = [
    'wasmer/bash',
    'wasmer/coreutils@=1.0.27',
    'wasmer/findutils@=0.10.1',
    'wasmer/fd@=10.5.1',
    'wasmer/grep@=3.12.0',
    'wasmer/sed@=4.9.0',
    'wasmer/ripgrep@=15.2.1',
    'curl/curl@=8.4.0'
];

const PACKAGE_CATALOG = [
    ...BASE_PACKAGES,
    'python/python@=3.13.18',
    'wasmer/edgejs@0.2.0',
    'php/php-32'
];

const PACKAGE_ID_REGEX =
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:@=?[A-Za-z0-9.+-]+)?$/;

const PKG_MARKER = '\x1b]777;NORATPKG;';

// ------------------------------------------------------------
// Permissions
// ------------------------------------------------------------

function isAdmin(ctx) {
    return Number(ctx.level || 0) >= Number(ctx.levels?.ADMIN ?? 2);
}

function canControl(ctx, shell) {
    return (
        ctx.player.name === shell.owner ||
        isAdmin(ctx)
    );
}

function getNetworkSetting(bot) {
    return networkSettings.get(bot) ?? false;
}

// ------------------------------------------------------------
// Command pacing
// ------------------------------------------------------------

async function safeRun(ctx, command) {
    const now = Date.now();
    const start = Math.max(now, nextCommandSlot);

    nextCommandSlot = start + COMMAND_GAP_MS;

    if (start > now) {
        await sleep(start - now);
    }

    try {
        return (await ctx.run(command)) !== false;
    } catch (error) {
        console.error('[Shell] Command failed:', error);
        return false;
    }
}

// ------------------------------------------------------------
// Player position lookup
// ------------------------------------------------------------

async function getPlayerPos(ctx, name) {
    const bot = ctx.bot;
    const tag = `nrpos${Math.random().toString(36).slice(2, 8)}:`;

    const escapedTag = tag.replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&'
    );

    const regex = new RegExp(
        `${escapedTag}\\s*\\[\\s*` +
        `(-?[\\d.eE+-]+)d?\\s*,\\s*` +
        `(-?[\\d.eE+-]+)d?\\s*,\\s*` +
        `(-?[\\d.eE+-]+)d?\\s*\\]`
    );

    const botName = bot.config?.username || '@a';

    return new Promise(resolve => {
        let finished = false;

        const finish = value => {
            if (finished) return;

            finished = true;
            clearTimeout(timer);
            bot.removeListener('chat_plain', onMessage);

            resolve(value);
        };

        const onMessage = message => {
            if (typeof message !== 'string') return;

            const clean = message.replace(
                /\x1b\[[0-9;]*m/g,
                ''
            );

            const match = clean.match(regex);
            if (!match) return;

            const position = {
                x: Math.floor(Number(match[1])),
                y: Math.floor(Number(match[2])),
                z: Math.floor(Number(match[3]))
            };

            if (Object.values(position).every(Number.isFinite)) {
                finish(position);
            }
        };

        const timer = setTimeout(
            () => finish(null),
            3000
        );

        bot.on('chat_plain', onMessage);

        const json = JSON.stringify([
            { text: tag },
            { nbt: 'Pos', entity: name }
        ]);

        safeRun(
            ctx,
            `tellraw ${botName} ${json}`
        ).catch(() => {});
    });
}

// ------------------------------------------------------------
// ANSI colour conversion
// ------------------------------------------------------------

const ANSI_COLORS = [
    '#000000',
    '#AA0000',
    '#00AA00',
    '#AA5500',
    '#0000AA',
    '#AA00AA',
    '#00AAAA',
    '#AAAAAA',
    '#555555',
    '#FF5555',
    '#55FF55',
    '#FFFF55',
    '#5555FF',
    '#FF55FF',
    '#55FFFF',
    '#FFFFFF'
];

function xterm256Color(index) {
    if (index < 16) {
        return ANSI_COLORS[index];
    }

    if (index >= 232) {
        const value = 8 + (index - 232) * 10;

        return '#' + [value, value, value]
            .map(v => v.toString(16).padStart(2, '0'))
            .join('');
    }

    const n = index - 16;

    const r = Math.floor(n / 36);
    const g = Math.floor((n % 36) / 6);
    const b = n % 6;

    const values = [r, g, b].map(v =>
        v === 0 ? 0 : 55 + v * 40
    );

    return '#' + values
        .map(v => v.toString(16).padStart(2, '0'))
        .join('');
}

function rgbColor(value) {
    return '#' + (value & 0xFFFFFF)
        .toString(16)
        .padStart(6, '0');
}

function getCellColor(cell, foreground = true) {
    if (!cell) return null;

    const isDefault = foreground
        ? cell.isFgDefault?.()
        : cell.isBgDefault?.();

    if (isDefault) return null;

    const isRGB = foreground
        ? cell.isFgRGB?.()
        : cell.isBgRGB?.();

    const color = foreground
        ? cell.getFgColor()
        : cell.getBgColor();

    if (isRGB) {
        return rgbColor(color);
    }

    return xterm256Color(color);
}

// ------------------------------------------------------------
// Terminal formatting
// ------------------------------------------------------------

function getCellStyle(cell) {
    let foreground = getCellColor(cell, true);
    const background = getCellColor(cell, false);

    if (cell.isInverse?.()) {
        foreground = background || '#FFFFFF';
    }

    return {
        color: foreground || '#FFFFFF',
        bold: !!cell.isBold?.(),
        italic: !!cell.isItalic?.(),
        underlined: !!cell.isUnderline?.(),
        strikethrough: !!cell.isStrikethrough?.()
    };
}

function styleKey(style) {
    return JSON.stringify(style);
}

// ------------------------------------------------------------
// Terminal buffer -> Minecraft components
// ------------------------------------------------------------

function terminalToComponents(terminal) {
    const buffer = terminal.buffer.active;
    const components = [];

    for (let row = 0; row < HEIGHT; row++) {
        const line = buffer.getLine(row);

        if (!line) {
            components.push({ text: '\n' });
            continue;
        }

        let current = null;

        const length = Math.min(
            WIDTH,
            line.getTrimmedLength?.() ?? WIDTH
        );

        for (let col = 0; col < length; col++) {
            const cell = line.getCell(col);

            if (!cell) continue;

            if (cell.getWidth() === 0) continue;

            const character = cell.getChars() || ' ';
            const style = getCellStyle(cell);
            const key = styleKey(style);

            if (!current || current.key !== key) {
                const component = {
                    text: '',
                    color: style.color
                };

                if (style.bold) component.bold = true;
                if (style.italic) component.italic = true;

                if (style.underlined) {
                    component.underlined = true;
                }

                if (style.strikethrough) {
                    component.strikethrough = true;
                }

                current = { key, component };
                components.push(component);
            }

            current.component.text += character;
        }

        const nextLine = buffer.getLine(row + 1);

        if (row < HEIGHT - 1 && !nextLine?.isWrapped) {
            components.push({ text: '\n' });
        }
    }

    return components;
}

function terminalToPlainText(terminal) {
    const buffer = terminal.buffer.active;
    const lines = [];

    for (let row = 0; row < HEIGHT; row++) {
        const line = buffer.getLine(row);

        lines.push(
            line?.translateToString(true) || ''
        );
    }

    return {
        text: '',
        extra: [{ text: lines.join('\n') }]
    };
}

// ------------------------------------------------------------
// Minecraft component serialization
// ------------------------------------------------------------

function serializeMinecraftText(components) {
    const component = {
        text: '',
        extra: components
    };

    return `{text:${JSON.stringify(component)}}`;
}

// ------------------------------------------------------------
// Wasmer initialization
// ------------------------------------------------------------

async function loadWasmer() {
    if (!WasmerClass) {
        const module = await import('@wasmer/sdk/node');
        WasmerClass = module.Wasmer;
    }

    return new WasmerClass();
}


async function createSandboxResources(networkEnabled, extraPackages = []) {
    const wasmer = await loadWasmer();

    let sandbox;

    const bootstrap = `
umask 077
ulimit -c 0 2>/dev/null || true

mkdir -p /workspace/home
chmod 700 /workspace/home 2>/dev/null || true

export HOME=/workspace/home
cd /workspace

pkg() {
    printf '\\033]777;NORATPKG;%s\\007' "$*"
}

wget() {
    if ! command -v curl >/dev/null 2>&1; then
        echo "wget: curl is not installed."
        return 127
    fi

    if [[ "\${1:-}" == "-O" ]]; then
        if [[ -z "\${2:-}" || -z "\${3:-}" ]]; then
            echo "Usage: wget -O <file> <url>"
            return 2
        fi

        command curl -fL --progress-bar "$3" -o "$2"
    else
        if [[ -z "\${1:-}" ]]; then
            echo "Usage: wget <url>"
            return 2
        fi

        command curl -fLO "$1"
    fi
}

ping() {
    local host="\${1:-}"
    local port="\${2:-443}"
    local count="\${3:-4}"
    local i

    if [[ -z "$host" ]]; then
        echo "Usage: ping <host> [port] [count]"
        echo "TCP connectivity test; this is not ICMP ping."
        return 1
    fi

    if [[ ! "$port" =~ ^[0-9]+$ ]] ||
       (( port < 1 || port > 65535 )); then
        echo "Invalid port."
        return 1
    fi

    if [[ ! "$count" =~ ^[0-9]+$ ]] ||
       (( count < 1 || count > 20 )); then
        echo "Count must be between 1 and 20."
        return 1
    fi

    if ! command -v curl >/dev/null 2>&1; then
        echo "ping: curl is required."
        return 127
    fi

    echo "TCP connectivity test to $host:$port"
    echo "Not ICMP ping."

    for ((i=1; i<=count; i++)); do
        if command curl \
            -sS \
            --connect-only \
            --connect-timeout 3 \
            --max-time 5 \
            "https://\${host}:\${port}/" \
            >/dev/null 2>&1; then
            echo "[$i/$count] Connected"
        else
            echo "[$i/$count] Connection failed"
        fi

        if (( i < count )); then
            sleep 1
        fi
    done
}

printf '\\n\\033[32mNoratBot Linux shell initialized.\\033[0m\\n'
`;

    try {
        const options = {
            packages: [
                ...BASE_PACKAGES,
                ...extraPackages
            ],
            files: {
                '.norat-bashrc': bootstrap
            }
        };

        if (networkEnabled) {
            options.network = {
                mode: 'host'
            };
        }

        sandbox = await wasmer.sandboxes.create(options);

        const process = await sandbox
            .command('bash', [
                '--noprofile',
                '--rcfile',
                '/workspace/.norat-bashrc',
                '-i'
            ])
            .spawn({
                terminal: {
                    columns: WIDTH,
                    rows: HEIGHT
                }
            });

        if (
            !process.stdin ||
            !process.stdout ||
            !process.stderr
        ) {
            throw new Error('Wasmer did not provide all terminal streams.');
        }

        return {
            wasmer,
            sandbox,
            process
        };
    } catch (error) {
        try {
            await sandbox?.close();
        } catch {}

        try {
            await wasmer.close();
        } catch {}

        throw error;
    }
}

// ------------------------------------------------------------
// Shell
// ------------------------------------------------------------

class Shell {
    constructor(ctx, networkEnabled) {
        this.ctx = ctx;
        this.owner = ctx.player.name;

        this.networkEnabled = networkEnabled;

        this.displayTag =
            'NoratBotShell_' +
            Math.random().toString(36).slice(2, 10);

        this.displayReady = false;
        this.closed = false;
        this.dirty = false;
        this.rendering = false;
        this.restarting = false;

        this.generation = 0;

        this.wasmer = null;
        this.sandbox = null;
        this.process = null;

        this.extraPackages = [];
        this.installedPackages = new Set(BASE_PACKAGES);
        this.pendingRemoval = new Set();

        this.pkgBusy = false;
        this.controlBuffer = '';

        this.terminal = new Terminal({
            cols: WIDTH,
            rows: HEIGHT,
            scrollback: 0,
            allowProposedApi: true,
            convertEol: true,
            cursorBlink: false
        });

        this.renderTimer = setInterval(
            () => this.render(),
            RENDER_INTERVAL
        );
    }

    async initialize() {
        await this.startProcess();
        return this;
    }

    // --------------------------------------------------------
    // Start/restart process
    // --------------------------------------------------------

    async startProcess() {
        const resources = await createSandboxResources(
            this.networkEnabled,
            this.extraPackages
        );

        this.wasmer = resources.wasmer;
        this.sandbox = resources.sandbox;
        this.process = resources.process;

        this.installedPackages = new Set([
            ...BASE_PACKAGES,
            ...this.extraPackages
        ]);

        this.pendingRemoval.clear();

        const generation = ++this.generation;

        this.readOutput(
            this.process.stdout,
            generation
        );

        this.readOutput(
            this.process.stderr,
            generation
        );

        this.dirty = true;
    }

    async stopProcess() {
        this.generation++;

        const process = this.process;
        const sandbox = this.sandbox;
        const wasmer = this.wasmer;

        this.process = null;
        this.sandbox = null;
        this.wasmer = null;

        try {
            await process?.kill();
        } catch {}

        try {
            await sandbox?.close();
        } catch {}

        try {
            await wasmer?.close();
        } catch {}
    }

    async restartNetwork(enabled) {
        if (
            this.closed ||
            this.restarting ||
            this.pkgBusy
        ) {
            return false;
        }

        this.restarting = true;

        try {
            this.terminal.write(
                `\r\n[Restarting sandbox: network ${enabled ? 'enabled' : 'disabled'}]\r\n`,
                () => {
                    this.dirty = true;
                }
            );

            await this.stopProcess();

            this.networkEnabled = enabled;

            await this.startProcess();

            return true;
        } catch (error) {
            console.error('[Shell] Restart failed:', error);

            await this.stopProcess();

            return false;
        } finally {
            this.restarting = false;
            this.dirty = true;
        }
    }

    // --------------------------------------------------------
    // Package manager
    // --------------------------------------------------------

    async handlePkgRequest(payload, generation) {
        if (
            this.closed ||
            generation !== this.generation
        ) {
            return;
        }

        if (this.pkgBusy) {
            this.terminal.write(
                '\r\nPackage manager is busy. Try again shortly.\r\n',
                () => { this.dirty = true; }
            );
            return;
        }

        const [action, ...args] = payload.trim().split(/\s+/);

        const output = message => {
            this.terminal.write(
                `\r\n${message}\r\n`,
                () => { this.dirty = true; }
            );
        };

        if (!action || action === 'help') {
            output(
                'pkg search <name> | install <owner/package> | list | remove <package>'
            );
            return;
        }

        if (action === 'search') {
            const query = args.join(' ').toLowerCase();

            if (!query) {
                output('Usage: pkg search <name>');
                return;
            }

            const results = PACKAGE_CATALOG.filter(pkg =>
                pkg.toLowerCase().includes(query)
            );

            output(
                results.length
                    ? 'Available packages:\n' + results.join('\n')
                    : 'No matches in the built-in catalogue.'
            );

            return;
        }

        if (action === 'list') {
            const packages = [...this.installedPackages];

            if (!packages.length) {
                output('No packages installed.');
                return;
            }

            const lines = packages.map(pkg =>
                this.pendingRemoval.has(pkg)
                    ? `${pkg} (removal pending restart)`
                    : pkg
            );

            output('Installed packages:\n' + lines.join('\n'));
            return;
        }

        if (action === 'install') {
            const packageId = args[0];

            if (
                !packageId ||
                !PACKAGE_ID_REGEX.test(packageId)
            ) {
                output('Usage: pkg install owner/package[@version]');
                return;
            }

            if (
                this.installedPackages.has(packageId) &&
                !this.pendingRemoval.has(packageId)
            ) {
                output(`${packageId} is already installed.`);
                return;
            }

            if (this.pendingRemoval.has(packageId)) {
                this.pendingRemoval.delete(packageId);

                if (!this.extraPackages.includes(packageId)) {
                    this.extraPackages.push(packageId);
                }

                output(`Cancelled pending removal of ${packageId}.`);
                return;
            }

            if (!this.sandbox?.installPackage) {
                output('This Wasmer SDK does not expose installPackage().');
                return;
            }

            this.pkgBusy = true;
            output(`Installing ${packageId}...`);

            try {
                await this.sandbox.installPackage(packageId);

                if (
                    this.closed ||
                    generation !== this.generation
                ) {
                    return;
                }

                if (!this.extraPackages.includes(packageId)) {
                    this.extraPackages.push(packageId);
                }

                this.installedPackages.add(packageId);

                output(`Successfully installed ${packageId}.`);
            } catch (error) {
                output(
                    `Installation failed: ${String(error.message || error).slice(0, 250)}`
                );
            } finally {
                this.pkgBusy = false;
            }

            return;
        }

        if (action === 'remove') {
            const packageId = args[0];

            if (
                !packageId ||
                !this.installedPackages.has(packageId)
            ) {
                output('Package is not installed.');
                return;
            }

            if (BASE_PACKAGES.includes(packageId)) {
                output('Built-in packages cannot be removed.');
                return;
            }

            this.extraPackages = this.extraPackages.filter(
                pkg => pkg !== packageId
            );

            this.pendingRemoval.add(packageId);

            output(
                `${packageId} marked for removal. ` +
                'It will be removed when the sandbox next restarts.'
            );

            return;
        }

        output('Unknown pkg command. Use: pkg help');
    }

    // --------------------------------------------------------
    // Guest output / package command interception
    // --------------------------------------------------------

    writeGuestOutput(data, generation) {
        if (
            this.closed ||
            generation !== this.generation
        ) {
            return;
        }

        let source = this.controlBuffer + data;
        this.controlBuffer = '';

        let visible = '';

        while (source.length) {
            const index = source.indexOf(PKG_MARKER);

            if (index === -1) {
                let keep = Math.min(
                    PKG_MARKER.length - 1,
                    source.length
                );

                while (
                    keep > 0 &&
                    !PKG_MARKER.startsWith(source.slice(-keep))
                ) {
                    keep--;
                }

                visible += source.slice(0, source.length - keep);

                if (keep) {
                    this.controlBuffer = source.slice(-keep);
                }

                break;
            }

            visible += source.slice(0, index);

            const end = source.indexOf(
                '\x07',
                index + PKG_MARKER.length
            );

            if (end === -1) {
                this.controlBuffer = source.slice(index);
                break;
            }

            const payload = source.slice(
                index + PKG_MARKER.length,
                end
            );

            void this.handlePkgRequest(payload, generation);

            source = source.slice(end + 1);
        }

        if (visible) {
            this.terminal.write(visible, () => {
                if (generation === this.generation) {
                    this.dirty = true;
                }
            });
        }
    }

    // --------------------------------------------------------
    // Output handling
    // --------------------------------------------------------

    async readOutput(stream, generation) {
        if (!stream) return;

        const decoder = new TextDecoder();

        try {
            for await (const chunk of stream) {
                if (
                    this.closed ||
                    generation !== this.generation
                ) {
                    break;
                }

                const data = typeof chunk === 'string'
                    ? chunk
                    : decoder.decode(chunk, { stream: true });

                if (!data) continue;

                this.writeGuestOutput(data, generation);
            }

            const remaining = decoder.decode();

            if (
                remaining &&
                !this.closed &&
                generation === this.generation
            ) {
                this.writeGuestOutput(remaining, generation);
            }
        } catch (error) {
            if (
                !this.closed &&
                generation === this.generation
            ) {
                console.error('[Shell] Stream error:', error);
            }
        }
    }

    // --------------------------------------------------------
    // Input
    // --------------------------------------------------------

    async send(data) {
        if (
            this.closed ||
            this.restarting ||
            !this.process?.stdin
        ) {
            return false;
        }

        try {
            await this.process.stdin.write(data);
            return true;
        } catch (error) {
            console.error('[Shell] Input error:', error);
            return false;
        }
    }

    async interrupt() {
        return this.send('\x03');
    }

    // --------------------------------------------------------
    // Display spawning
    // --------------------------------------------------------

    async spawnDisplay() {
        const position = await getPlayerPos(
            this.ctx,
            this.owner
        );

        if (!position) {
            console.error('[Shell] Could not find player position.');
            return false;
        }

        const x = position.x + 0.5;
        const y = position.y + 2;
        const z = position.z + 0.5;

        const initialComponent = {
            text: '',
            extra: [
                {
                    text: 'NoratBot Linux Shell\n',
                    color: 'green',
                    bold: true
                },
                {
                    text: 'Waiting for terminal output...',
                    color: 'white'
                }
            ]
        };

        const command =
            `summon minecraft:text_display ${x} ${y} ${z} ` +
            `{Tags:["${this.displayTag}"],` +
            `text:${JSON.stringify(initialComponent)},` +
            `background:0xDD101018,` +
            `alignment:"left",` +
            `line_width:1000,` +
            `see_through:0b,` +
            `shadow:1b,` +
            `billboard:"fixed"}`;

        const success = await safeRun(
            this.ctx,
            command
        );

        if (!success) return false;

        await sleep(500);

        if (this.closed) return false;

        this.displayReady = true;
        this.dirty = true;

        return true;
    }

    // --------------------------------------------------------
    // Rendering
    // --------------------------------------------------------

    async render() {
        if (
            this.closed ||
            !this.displayReady ||
            !this.dirty ||
            this.rendering ||
            this.restarting
        ) {
            return;
        }

        this.rendering = true;
        this.dirty = false;

        try {
            let snbt = serializeMinecraftText(
                terminalToComponents(this.terminal)
            );

            let command =
                `data merge entity ` +
                `@e[type=minecraft:text_display,tag=${this.displayTag},limit=1] ` +
                snbt;

            if (command.length > MAX_COMMAND_LENGTH) {
                snbt = serializeMinecraftText([
                    terminalToPlainText(this.terminal)
                ]);

                command =
                    `data merge entity ` +
                    `@e[type=minecraft:text_display,tag=${this.displayTag},limit=1] ` +
                    snbt;
            }

            const success = await safeRun(
                this.ctx,
                command
            );

            if (!success) {
                this.dirty = true;
            }
        } catch (error) {
            console.error('[Shell] Render error:', error);
            this.dirty = true;
        } finally {
            this.rendering = false;
        }
    }

    // --------------------------------------------------------
    // Respawn
    // --------------------------------------------------------

    async respawn() {
        if (this.closed) return false;

        this.displayReady = false;

        await safeRun(
            this.ctx,
            `kill @e[type=minecraft:text_display,tag=${this.displayTag}]`
        );

        await sleep(250);

        return this.spawnDisplay();
    }

    // --------------------------------------------------------
    // Cleanup
    // --------------------------------------------------------

    async kill() {
        if (this.closed) return;

        this.closed = true;
        this.displayReady = false;

        clearInterval(this.renderTimer);

        await this.stopProcess();

        this.terminal.dispose();

        await safeRun(
            this.ctx,
            `kill @e[type=minecraft:text_display,tag=${this.displayTag}]`
        );
    }
}

// ------------------------------------------------------------
// Start shell
// ------------------------------------------------------------

async function startShell(ctx, networkEnabled) {
    const shell = new Shell(ctx, networkEnabled);

    try {
        await shell.initialize();
        return shell;
    } catch (error) {
        await shell.kill().catch(() => {});
        throw error;
    }
}

// ------------------------------------------------------------
// Plugin commands
// ------------------------------------------------------------

module.exports = {
    name: 'shell',
    description: 'Isolated NoratBot Linux shell',
    level: 0,

    async execute(ctx) {
        const [action, ...args] = ctx.args || [];

        let shell = sessions.get(ctx.bot);

        // ----------------------------------------------------
        // NETWORK - ADMIN ONLY
        // ----------------------------------------------------

        if (action === 'network') {
            if (!isAdmin(ctx)) {
                return ctx.tellrawCommand(
                    'Permission denied. Admins only.'
                );
            }

            if (!args[0]) {
                return ctx.tellrawCommand(
                    `Shell network: ${getNetworkSetting(ctx.bot) ? 'ENABLED' : 'DISABLED'}`
                );
            }

            const value = args[0].toLowerCase();

            if (value !== 'true' && value !== 'false') {
                return ctx.tellrawCommand(
                    'Usage: shell network true/false'
                );
            }

            const enabled = value === 'true';
            const previous = getNetworkSetting(ctx.bot);

            if (enabled === previous) {
                return ctx.tellrawCommand(
                    `Network is already ${enabled ? 'enabled' : 'disabled'}.`
                );
            }

            if (
                enabled &&
                shell &&
                shell.owner !== ctx.player.name
            ) {
                return ctx.tellrawCommand(
                    'Stop the current shell and start a new one as an admin before enabling networking.'
                );
            }

            if (shell?.pkgBusy) {
                return ctx.tellrawCommand(
                    'Wait for the package installation to finish first.'
                );
            }

            networkSettings.set(ctx.bot, enabled);

            if (shell && !shell.closed) {
                const success = await shell.restartNetwork(enabled);

                if (!success) {
                    networkSettings.set(ctx.bot, previous);
                    sessions.delete(ctx.bot);

                    await shell.kill().catch(() => {});

                    return ctx.tellrawCommand(
                        'Network setting changed, but the sandbox restart failed. Start a new shell.'
                    );
                }
            }

            return ctx.tellrawCommand(
                `Shell network ${enabled ? 'ENABLED' : 'DISABLED'}.`
            );
        }

        // ----------------------------------------------------
        // START
        // ----------------------------------------------------

        if (action === 'start') {
            if (args[0] !== 'textdisplay') {
                return ctx.tellrawCommand(
                    'Usage: shell start textdisplay'
                );
            }

            if (shell && !shell.closed) {
                return ctx.tellrawCommand(
                    'A shell is already running!'
                );
            }

            const networkEnabled = getNetworkSetting(ctx.bot);

            if (networkEnabled && !isAdmin(ctx)) {
                return ctx.tellrawCommand(
                    'Networking is enabled. Only an admin can start this shell.'
                );
            }

            ctx.tellrawCommand(
                'Starting isolated Linux shell...'
            );

            try {
                shell = await startShell(
                    ctx,
                    networkEnabled
                );

                sessions.set(ctx.bot, shell);

                const success = await shell.spawnDisplay();

                if (!success) {
                    await shell.kill();
                    sessions.delete(ctx.bot);

                    return ctx.tellrawCommand(
                        'Could not spawn terminal display.'
                    );
                }

                ctx.tellrawCommand(
                    `Shell started. Network: ${networkEnabled ? 'ON' : 'OFF'}.`
                );
            } catch (error) {
                console.error('[Shell]', error);

                if (shell) {
                    await shell.kill().catch(() => {});
                    sessions.delete(ctx.bot);
                }

                ctx.tellrawCommand(
                    `Shell error: ${String(error.message).slice(0, 150)}`
                );
            }

            return;
        }

        // ----------------------------------------------------
        // CHECK SESSION
        // ----------------------------------------------------

        if (!shell || shell.closed) {
            return ctx.tellrawCommand(
                'No shell running. Use shell start textdisplay.'
            );
        }

        if (!canControl(ctx, shell)) {
            return ctx.tellrawCommand(
                'This shell belongs to another player.'
            );
        }

        // ----------------------------------------------------
        // KILL
        // ----------------------------------------------------

        if (action === 'kill') {
            await shell.kill();
            sessions.delete(ctx.bot);

            return ctx.tellrawCommand(
                'Shell stopped.'
            );
        }

        // ----------------------------------------------------
        // RUN
        // ----------------------------------------------------

        if (action === 'run') {
            const command = args.join(' ');

            if (!command) {
                return ctx.tellrawCommand(
                    'Usage: shell run <command>'
                );
            }

            const success = await shell.send(command + '\n');

            return ctx.tellrawCommand(
                success ? 'Command sent.' : 'Could not send command.'
            );
        }

        // ----------------------------------------------------
        // KEYS
        // ----------------------------------------------------

        if (action === 'keys') {
            const keys = {
                enter: '\n',
                escape: '\x1b',
                backspace: '\x7f',
                tab: '\t',
                up: '\x1b[A',
                down: '\x1b[B',
                left: '\x1b[D',
                right: '\x1b[C',
                delete: '\x1b[3~',
                space: ' '
            };

            for (
                const key of args.join(' ')
                    .toLowerCase()
                    .split(/\s+/)
            ) {
                if (keys[key] !== undefined) {
                    await shell.send(keys[key]);
                } else if (key.length === 1) {
                    await shell.send(key);
                } else if (key) {
                    ctx.tellrawCommand(`Unknown key: ${key}`);
                }
            }

            return ctx.tellrawCommand('Keys sent.');
        }

        // ----------------------------------------------------
        // INTERRUPT
        // ----------------------------------------------------

        if (action === 'int') {
            await shell.interrupt();

            return ctx.tellrawCommand(
                'Ctrl+C sent.'
            );
        }

        // ----------------------------------------------------
        // RESPAWN
        // ----------------------------------------------------

        if (action === 'respawn') {
            const success = await shell.respawn();

            return ctx.tellrawCommand(
                success
                    ? 'Display respawned.'
                    : 'Respawn failed.'
            );
        }

        // ----------------------------------------------------
        // HELP
        // ----------------------------------------------------

        return ctx.tellrawCommand(
            'Commands: start textdisplay, run <command>, keys <keys>, int, respawn, kill, network [true/false] (admin)'
        );
    }
};
