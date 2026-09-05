const crypto = require('crypto');
const axios = require('axios');
const { decompress } = require('@mongodb-js/zstd');
const sha3 = require('js-sha3');
const fs = require('fs');
const path = require('path');
const nacl = require('tweetnacl');

module.exports = function attestationPlugin(bot) {
    const MANIFEST_URLS = [];

    const KEY_CACHE = new Map();
    const KEY_TO_NAME = new Map();
    const chatMessageCache = new Map();
    const pendingAttestations = new Map();
    const processedSigs = new Set();

    function createHash(input) {
        const hash = sha3.sha3_224(input);
        return Buffer.from(hash, 'hex').slice(0, 16);
    }

    function readString(buffer, offset) {
        let idx = offset;
        const bytes = [];
        while (idx < buffer.length) {
            const b = buffer.readUInt8(idx++);
            if ((b & 0x80) === 0x80) {
                bytes.push(b & 0x7F);
                return { value: Buffer.from(bytes).toString('ascii'), offset: idx };
            }
            bytes.push(b);
            if (bytes.length > 255) throw new Error('String too long');
        }
        throw new Error('String terminator not found');
    }
    function computeOfflineUUID(username) {
    if (!username) return null;
    const clean = String(username).replace(/§[0-9a-fk-or]/gi, '').trim();
    if (!clean) return null;
    const hash = crypto.createHash('md5')
        .update(Buffer.from(`OfflinePlayer:${clean}`, 'utf8'))
        .digest();
    hash[6] = (hash[6] & 0x0f) | 0x30;
    hash[8] = (hash[8] & 0x3f) | 0x80;
    const hex = hash.toString('hex');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
}
function extractPlainText(component) {
    if (typeof component === 'string') return component;
    if (!component || typeof component !== 'object') return '';
    if (component.text) return String(component.text);
    if (Array.isArray(component.extra)) {
        return component.extra.map(extractPlainText).join('');
    }
    if (component.selector) return component.selector;
    if (component.keybind) return component.keybind;
    if (component.score) return String(component.score.value || '');
    return '';
}
    function readUUID(buffer, offset) {
        if (offset + 16 > buffer.length) throw new Error('Not enough bytes for UUID');
        const uuid = buffer.slice(offset, offset + 16);
        const hex = uuid.toString('hex');
        const formatted = `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
        return { value: formatted, offset: offset + 16 };
    }
    

    function extractChipmunkContents(component) {
        if (!component || typeof component !== 'object') return null;
        if (component.translate && (component.translate === '[%s] %s › %s' || component.translate === '%s %s › %s')) {
            if (Array.isArray(component.with) && component.with.length >= 3) {
                const contents = component.with[2];
                if (typeof contents === 'string') return contents;
                if (contents && typeof contents === 'object') {
                    return extractPlainText(contents);
                }
            }
        }
        if (Array.isArray(component.extra)) {
            for (const child of component.extra) {
                const res = extractChipmunkContents(child);
                if (res) return res;
            }
        }
        return null;
    }

    function tryParseJson(str) {
        if (typeof str !== 'string') return null;
        try { return JSON.parse(str); } catch (e) { return null; }
    }

    function cacheChatMessage(text) {
        if (!text || typeof text !== 'string') return;
        const trimmed = text.trim();
        if (!trimmed || trimmed === '$$') return;
        const hash = createHash(Buffer.from(trimmed, 'utf8'));
        const hexHash = hash.toString('hex');
        if (chatMessageCache.has(hexHash)) return;
        chatMessageCache.set(hexHash, trimmed);
        resolvePendingAttestations();
        setTimeout(() => chatMessageCache.delete(hexHash), 30000);
    }

    function parseChatPlain(text) {
        if (typeof text !== 'string') return null;
        const chipMatch = text.match(/›\s*(.+)$/);
        if (chipMatch) return chipMatch[1].trim();
        const normalMatch = text.match(/:\s*(.+)$/);
        if (normalMatch) return normalMatch[1].trim();
        return text.trim();
    }

    bot.on('player_chat', (data) => {
        let text = data.plainMessage ?? data.unsignedChatContent ?? data.message;
        if (typeof text === 'object' && text) text = extractPlainText(text);
        if (typeof text === 'string') cacheChatMessage(text);
    });

    bot.on('system_chat', (data) => {
        if (!data || data.isActionBar) return;
        const content = data.content;
        if (typeof content === 'string') {
            const parsed = tryParseJson(content);
            if (parsed) {
                const chipmunk = extractChipmunkContents(parsed);
                if (chipmunk) cacheChatMessage(chipmunk);
                const plain = extractPlainText(parsed);
                if (plain && plain !== chipmunk) cacheChatMessage(plain);
            } else {
                cacheChatMessage(content);
            }
        } else if (content && typeof content === 'object') {
            const chipmunk = extractChipmunkContents(content);
            if (chipmunk) cacheChatMessage(chipmunk);
            const plain = extractPlainText(content);
            if (plain && plain !== chipmunk) cacheChatMessage(plain);
        }
    });

    bot.on('disguised_chat', (data) => {
        let msg = data.message ?? data.content;
        if (typeof msg === 'string') {
            const parsed = tryParseJson(msg);
            if (parsed) {
                const chipmunk = extractChipmunkContents(parsed);
                if (chipmunk) cacheChatMessage(chipmunk);
                const plain = extractPlainText(parsed);
                if (plain && plain !== chipmunk) cacheChatMessage(plain);
            } else {
                cacheChatMessage(msg);
            }
        } else if (msg && typeof msg === 'object') {
            const chipmunk = extractChipmunkContents(msg);
            if (chipmunk) cacheChatMessage(chipmunk);
            const plain = extractPlainText(msg);
            if (plain && plain !== chipmunk) cacheChatMessage(plain);
        }
    });

    bot.on('chat_plain', (text) => {
        if (typeof text !== 'string') return;
        const parsed = parseChatPlain(text);
        if (parsed) cacheChatMessage(parsed);
    });

    cacheChatMessage('$$');

    async function loadManifests() {
           try {
            const localPath = path.join(__dirname, '..', 'local-manifest.json');
            if (fs.existsSync(localPath)) {
                const data = JSON.parse(fs.readFileSync(localPath, 'utf8'));
                if (data && data.key_to_claims) {
for (const [base64Key, usernames] of Object.entries(data.key_to_claims)) {
    const pubKeyBuffer = Buffer.from(base64Key, 'base64');
    const hash = createHash(pubKeyBuffer);
    const hex = hash.toString('hex');
    KEY_CACHE.set(hex, pubKeyBuffer);
    if (Array.isArray(usernames) && usernames.length) {
        for (const username of usernames) {
            KEY_TO_NAME.set(username, hex);
        }
    }
}
                }
            }
        } catch (e) {
            console.error(`[${bot.id}] [Attestation] Failed to load local manifest:`, e.message);
        } 
        for (const url of MANIFEST_URLS) {
            try {
                const resp = await axios.get(url, { timeout: 10000 });
                const data = resp.data;
                if (data && data.key_to_claims) {
                    for (const [base64Key, usernames] of Object.entries(data.key_to_claims)) {
                        const pubKeyBuffer = Buffer.from(base64Key, 'base64');
                        const hash = createHash(pubKeyBuffer);
                        const hex = hash.toString('hex');
                        KEY_CACHE.set(hex, pubKeyBuffer);
                        if (Array.isArray(usernames) && usernames.length) {
                            KEY_TO_NAME.set(hex, usernames[0]);
                        }
                    }
                }
            } catch (e) {
                console.error(`[${bot.id}] [Attestation] Failed to load manifest ${url}:`, e.message);
            }
        }
    }

    async function decompressZstd(compressed) {
        return decompress(compressed);
    }

    async function parsePayload(buffer, contentHash) {
        let offset = 0;
        const header = buffer.readUInt8(offset++);
        const isCompressed = header !== 0;
        let msgBuffer;

        if (isCompressed) {
            const compressedLen = header;
            if (offset + compressedLen > buffer.length - 64 - 16 - 2 - 8) {
                throw new Error('Invalid compressed length');
            }
            const compressedData = buffer.slice(offset, offset + compressedLen);
            offset += compressedLen;
            try {
                msgBuffer = await decompressZstd(compressedData);
            } catch (e) {
                throw new Error(`Zstd decompression failed: ${e.message}`);
            }
        } else {
            const hexHash = contentHash.toString('hex');
            const cached = chatMessageCache.get(hexHash);
            if (!cached) {
                throw new Error(`Deferred:${hexHash}`);
            }
            msgBuffer = Buffer.from(cached, 'utf8');
        }

        const signature = buffer.slice(offset, offset + 64);
        offset += 64;
        const keyHash = buffer.slice(offset, offset + 16);
        offset += 16;
        const nonce = buffer.slice(offset, offset + 2);
        offset += 2;
        const exp = buffer.readBigUInt64BE(offset);

        return { msg: msgBuffer, signature, keyHash, nonce, exp, isCompressed };
    }

    function verifySignature(msgBuffer, nonce, exp, signature, publicKeyRaw) {
        const expBuffer = Buffer.alloc(8);
        expBuffer.writeBigUInt64BE(exp, 0);
        const dataToVerify = Buffer.concat([nonce, expBuffer, msgBuffer]);

        try {
            return nacl.sign.detached.verify(
                new Uint8Array(dataToVerify),
                new Uint8Array(signature),
                new Uint8Array(publicKeyRaw)
            );
        } catch (e) {
            console.error(`[${bot.id}] [Attestation] Verify error:`, e.message);
            return false;
        }
    }

    function sendRegister() {
        if (!bot.client || !bot.client.write) return;
        const payload = Buffer.from('extras:register\0extras:unregister\0extras:message\0', 'utf8');
        bot.client.write('custom_payload', {
            channel: 'minecraft:register',
            data: payload
        });
    }

    function sendExtrasRegister() {
        if (!bot.client || !bot.client.write) return;
        const channelName = 'chat-attestation/v1:stream';
        const bytes = Buffer.from(channelName, 'ascii');
        bytes[bytes.length - 1] |= 0x80;
        const maxLength = 1115;
        const fullBuffer = Buffer.alloc(bytes.length + 2);
        bytes.copy(fullBuffer);
        fullBuffer.writeInt16BE(maxLength, bytes.length);
        bot.client.write('custom_payload', {
            channel: 'extras:register',
            data: fullBuffer
        });
    }

    function registerChannels() {
        if (!bot.client) return;
        bot.client.on('custom_payload', (packet) => {
            if (packet.channel === 'extras:message') {
                onExtrasMessage(packet.data);
            }
        });
    }

async function processAttestation(actualPayload, contentHash, senderUUID) {
    try {
        const payload = await parsePayload(actualPayload, contentHash);
        if (payload.msg.length === 0) return;

        const now = Date.now();
        if (Number(payload.exp) < now) return;

        const keyHex = payload.keyHash.toString('hex');
        const publicKey = KEY_CACHE.get(keyHex);
        if (!publicKey) return;

        const isValid = verifySignature(
            payload.msg,
            payload.nonce,
            payload.exp,
            payload.signature,
            publicKey
        );
        if (!isValid) return;

let playerName = null;
for (const [name, storedKeyHex] of KEY_TO_NAME) {
    if (storedKeyHex === keyHex) {
        playerName = name;
        break;
    }
}
if (!playerName) return;
const expectedUUID = computeOfflineUUID(playerName);
if (!expectedUUID || expectedUUID !== senderUUID) {
    return;
}
        const messageText = payload.msg.toString('utf8');

        const authList = bot.globalConfig?.bot?.authList || { admin: [], trusted: [] };
        const adminList = authList.admin || [];
        const trustedList = authList.trusted || [];

        let level = 0;
        let role = 'Public';

        if (adminList.includes(playerName)) {
            level = 2;
            role = 'Admin';
        } else if (trustedList.includes(playerName)) {
            level = 1;
            role = 'Trusted';
        } else {
            return;
        }

        if (bot.commands && typeof bot.commands.setPlayerLevel === 'function') {
bot.commands.setPlayerLevel(senderUUID, level);
        }

        if (!(bot.lastAttestedUUID instanceof Set)) {
            bot.lastAttestedUUID = new Set();
        }
        bot.lastAttestedUUID.add(senderUUID);

        bot.emit('attested_auth', {
            player: playerName,
            uuid: senderUUID,
            level: level,
            role: role,
            text: messageText
        });

        bot.emit('attested_message', {
            text: messageText,
            player: playerName,
            uuid: senderUUID,
            keyHash: payload.keyHash,
            exp: payload.exp,
            raw: payload
        });

    } catch (error) {
        if (error.message && error.message.startsWith('Deferred:')) {
            const hexHash = error.message.slice('Deferred:'.length);
            if (!pendingAttestations.has(hexHash)) {
                pendingAttestations.set(hexHash, {
                    actualPayload,
                    contentHash,
                    senderUUID,
                    ts: Date.now()
                });
            }
            return;
        }
        console.error(`[${bot.id}] [Attestation] Error processing attestation:`, error.message);
    }
}
    async function onExtrasMessage(data) {
        const buffer = data;
        if (!Buffer.isBuffer(buffer) || buffer.length < 2) return;

        try {
            const { value: innerChannel, offset: afterString } = readString(buffer, 0);
            if (innerChannel !== 'chat-attestation/v1:stream') return;

            const { value: senderUUID, offset: afterUUID } = readUUID(buffer, afterString);

            const payloadBuffer = buffer.slice(afterUUID);
            if (payloadBuffer.length < 16 + 1 + 64 + 16 + 2 + 8) return;

            const contentHash = payloadBuffer.slice(0, 16);
            const actualPayload = payloadBuffer.slice(16);
            const hexHash = contentHash.toString('hex');

            const sigKey = hexHash + actualPayload.slice(-10).toString('hex') + senderUUID;
            if (processedSigs.has(sigKey)) return;
            processedSigs.add(sigKey);
            setTimeout(() => processedSigs.delete(sigKey), 15000);

            await processAttestation(actualPayload, contentHash, senderUUID);

        } catch (error) {
            console.error(`[${bot.id}] [Attestation] Error processing extras:message:`, error.message);
        }
    }

    function resolvePendingAttestations() {
        for (const [hexHash, pending] of pendingAttestations) {
            if (Date.now() - pending.ts > 10000) {
                pendingAttestations.delete(hexHash);
                continue;
            }
            if (chatMessageCache.has(hexHash)) {
                pendingAttestations.delete(hexHash);
                processAttestation(pending.actualPayload, pending.contentHash, pending.senderUUID);
            }
        }
    }

    const pendingInterval = setInterval(resolvePendingAttestations, 500);

    async function init() {
        await loadManifests();
        registerChannels();
        setTimeout(() => {
            sendRegister();
            setTimeout(sendExtrasRegister, 300);
        }, 1000);
    }

    if (bot.client && bot.client.state === 'connected') {
        init();
    } else {
        bot.once('login', init);
    }

    bot.once('end', () => clearInterval(pendingInterval));

    bot.attestation = {
        reloadManifests: loadManifests,
        getPublicKey: (hash) => KEY_CACHE.get(hash.toString('hex'))
    };

        
        
        };