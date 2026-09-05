// idea taken from chipmunkmod songplayer
// credits to chipmunk

const fs = require('fs');
const path = require('path');
const { Midi } = require('@tonejs/midi');
const axios = require('axios');
const gradient = require('../utils/gradient');
class Instrument {
    constructor(id, name, offset) {
        this.id = id;
        this.name = name;
        this.offset = offset;
        this.sound = 'minecraft:block.note_block.' + name;
    }

    static fromId(id) {
        return Instrument.values[id];
    }

    static of(sound) {
        const inst = new Instrument(-1, null, 0);
        inst.sound = sound;
        return inst;
    }
}

Instrument.HARP = new Instrument(0, 'harp', 54);
Instrument.BASEDRUM = new Instrument(1, 'basedrum', 0);
Instrument.SNARE = new Instrument(2, 'snare', 0);
Instrument.HAT = new Instrument(3, 'hat', 0);
Instrument.BASS = new Instrument(4, 'bass', 30);
Instrument.FLUTE = new Instrument(5, 'flute', 66);
Instrument.BELL = new Instrument(6, 'bell', 78);
Instrument.GUITAR = new Instrument(7, 'guitar', 42);
Instrument.CHIME = new Instrument(8, 'chime', 78);
Instrument.XYLOPHONE = new Instrument(9, 'xylophone', 78);
Instrument.IRON_XYLOPHONE = new Instrument(10, 'iron_xylophone', 54);
Instrument.COW_BELL = new Instrument(11, 'cow_bell', 66);
Instrument.DIDGERIDOO = new Instrument(12, 'didgeridoo', 30);
Instrument.BIT = new Instrument(13, 'bit', 54);
Instrument.BANJO = new Instrument(14, 'banjo', 54);
Instrument.PLING = new Instrument(15, 'pling', 54);

Instrument.values = [
    Instrument.HARP, Instrument.BASEDRUM, Instrument.SNARE, Instrument.HAT,
    Instrument.BASS, Instrument.FLUTE, Instrument.BELL, Instrument.GUITAR,
    Instrument.CHIME, Instrument.XYLOPHONE, Instrument.IRON_XYLOPHONE,
    Instrument.COW_BELL, Instrument.DIDGERIDOO, Instrument.BIT, Instrument.BANJO, Instrument.PLING
];

const instrumentMap = new Map();
instrumentMap.set(0, [Instrument.HARP, Instrument.BASS, Instrument.BELL]);
instrumentMap.set(1, [Instrument.HARP, Instrument.BASS, Instrument.BELL]);
instrumentMap.set(2, [Instrument.BIT, Instrument.DIDGERIDOO, Instrument.BELL]);
instrumentMap.set(3, [Instrument.HARP, Instrument.BASS, Instrument.BELL]);
instrumentMap.set(4, [Instrument.BIT, Instrument.DIDGERIDOO, Instrument.BELL]);
instrumentMap.set(5, [Instrument.BIT, Instrument.DIDGERIDOO, Instrument.BELL]);
instrumentMap.set(6, [Instrument.HARP, Instrument.BASS, Instrument.BELL]);
instrumentMap.set(7, [Instrument.HARP, Instrument.BASS, Instrument.BELL]);
instrumentMap.set(8, [Instrument.IRON_XYLOPHONE, Instrument.BASS, Instrument.XYLOPHONE]);
instrumentMap.set(9, [Instrument.IRON_XYLOPHONE, Instrument.BASS, Instrument.XYLOPHONE]);
instrumentMap.set(10, [Instrument.IRON_XYLOPHONE, Instrument.BASS, Instrument.XYLOPHONE]);
instrumentMap.set(11, [Instrument.IRON_XYLOPHONE, Instrument.BASS, Instrument.XYLOPHONE]);
instrumentMap.set(12, [Instrument.IRON_XYLOPHONE, Instrument.BASS, Instrument.XYLOPHONE]);
instrumentMap.set(13, [Instrument.IRON_XYLOPHONE, Instrument.BASS, Instrument.XYLOPHONE]);
instrumentMap.set(14, [Instrument.IRON_XYLOPHONE, Instrument.BASS, Instrument.XYLOPHONE]);
instrumentMap.set(15, [Instrument.IRON_XYLOPHONE, Instrument.BASS, Instrument.XYLOPHONE]);
instrumentMap.set(16, [Instrument.DIDGERIDOO, Instrument.BIT, Instrument.XYLOPHONE]);
instrumentMap.set(17, [Instrument.DIDGERIDOO, Instrument.BIT, Instrument.XYLOPHONE]);
instrumentMap.set(18, [Instrument.DIDGERIDOO, Instrument.BIT, Instrument.XYLOPHONE]);
instrumentMap.set(19, [Instrument.DIDGERIDOO, Instrument.BIT, Instrument.XYLOPHONE]);
instrumentMap.set(20, [Instrument.DIDGERIDOO, Instrument.BIT, Instrument.XYLOPHONE]);
instrumentMap.set(21, [Instrument.DIDGERIDOO, Instrument.BIT, Instrument.XYLOPHONE]);
instrumentMap.set(22, [Instrument.DIDGERIDOO, Instrument.BIT, Instrument.XYLOPHONE]);
instrumentMap.set(23, [Instrument.DIDGERIDOO, Instrument.BIT, Instrument.XYLOPHONE]);
instrumentMap.set(24, [Instrument.GUITAR, Instrument.HARP, Instrument.BASS, Instrument.BELL]);
instrumentMap.set(25, [Instrument.GUITAR, Instrument.HARP, Instrument.BASS, Instrument.BELL]);
instrumentMap.set(26, [Instrument.GUITAR, Instrument.HARP, Instrument.BASS, Instrument.BELL]);
instrumentMap.set(27, [Instrument.GUITAR, Instrument.HARP, Instrument.BASS, Instrument.BELL]);
instrumentMap.set(28, [Instrument.GUITAR, Instrument.HARP, Instrument.BASS, Instrument.BELL]);
instrumentMap.set(29, [Instrument.DIDGERIDOO, Instrument.BIT, Instrument.XYLOPHONE]);
instrumentMap.set(30, [Instrument.DIDGERIDOO, Instrument.BIT, Instrument.XYLOPHONE]);
instrumentMap.set(31, [Instrument.GUITAR, Instrument.HARP, Instrument.BASS, Instrument.BELL]);
instrumentMap.set(32, [Instrument.BASS, Instrument.HARP, Instrument.BELL]);
instrumentMap.set(33, [Instrument.BASS, Instrument.HARP, Instrument.BELL]);
instrumentMap.set(34, [Instrument.BASS, Instrument.HARP, Instrument.BELL]);
instrumentMap.set(35, [Instrument.BASS, Instrument.HARP, Instrument.BELL]);
instrumentMap.set(36, [Instrument.DIDGERIDOO, Instrument.BIT, Instrument.XYLOPHONE]);
instrumentMap.set(37, [Instrument.DIDGERIDOO, Instrument.BIT, Instrument.XYLOPHONE]);
instrumentMap.set(38, [Instrument.DIDGERIDOO, Instrument.BIT, Instrument.XYLOPHONE]);
instrumentMap.set(39, [Instrument.DIDGERIDOO, Instrument.BIT, Instrument.XYLOPHONE]);
instrumentMap.set(40, [Instrument.FLUTE, Instrument.GUITAR, Instrument.BASS, Instrument.BELL]);
instrumentMap.set(41, [Instrument.FLUTE, Instrument.GUITAR, Instrument.BASS, Instrument.BELL]);
instrumentMap.set(42, [Instrument.FLUTE, Instrument.GUITAR, Instrument.BASS, Instrument.BELL]);
instrumentMap.set(43, [Instrument.FLUTE, Instrument.GUITAR, Instrument.BASS, Instrument.BELL]);
instrumentMap.set(44, [Instrument.BIT, Instrument.DIDGERIDOO, Instrument.BELL]);
instrumentMap.set(45, [Instrument.HARP, Instrument.BASS, Instrument.BELL]);
instrumentMap.set(46, [Instrument.HARP, Instrument.BASS, Instrument.CHIME]);
instrumentMap.set(47, [Instrument.HARP, Instrument.BASS, Instrument.BELL]);
instrumentMap.set(48, [Instrument.HARP, Instrument.BASS, Instrument.BELL]);
instrumentMap.set(49, [Instrument.HARP, Instrument.BASS, Instrument.BELL]);
instrumentMap.set(50, [Instrument.HARP, Instrument.BASS, Instrument.BELL]);
instrumentMap.set(51, [Instrument.HARP, Instrument.BASS, Instrument.BELL]);
instrumentMap.set(52, [Instrument.HARP, Instrument.BASS, Instrument.BELL]);
instrumentMap.set(53, [Instrument.HARP, Instrument.BASS, Instrument.BELL]);
instrumentMap.set(54, [Instrument.HARP, Instrument.BASS, Instrument.BELL]);
instrumentMap.set(55, [Instrument.HARP, Instrument.BASS, Instrument.BELL]);
for (let i = 56; i <= 63; i++) {
    instrumentMap.set(i, [Instrument.BIT, Instrument.DIDGERIDOO, Instrument.BELL]);
}
for (let i = 64; i <= 71; i++) {
    instrumentMap.set(i, [Instrument.FLUTE, Instrument.DIDGERIDOO, Instrument.IRON_XYLOPHONE, Instrument.BELL]);
}
for (let i = 72; i <= 79; i++) {
    instrumentMap.set(i, [Instrument.FLUTE, Instrument.DIDGERIDOO, Instrument.IRON_XYLOPHONE, Instrument.BELL]);
}
for (let i = 80; i <= 87; i++) {
    instrumentMap.set(i, [Instrument.HARP, Instrument.BASS, Instrument.BELL]);
}
for (let i = 88; i <= 95; i++) {
    instrumentMap.set(i, [Instrument.HARP, Instrument.BASS, Instrument.BELL]);
}
instrumentMap.set(98, [Instrument.BIT, Instrument.DIDGERIDOO, Instrument.BELL]);
for (let i = 99; i <= 103; i++) {
    instrumentMap.set(i, [Instrument.HARP, Instrument.BASS, Instrument.BELL]);
}
for (let i = 104; i <= 108; i++) {
    instrumentMap.set(i, [Instrument.BANJO, Instrument.BASS, Instrument.BELL]);
}
instrumentMap.set(109, [Instrument.HARP, Instrument.DIDGERIDOO, Instrument.BELL]);
instrumentMap.set(110, [Instrument.HARP, Instrument.DIDGERIDOO, Instrument.BELL]);
instrumentMap.set(111, [Instrument.HARP, Instrument.DIDGERIDOO, Instrument.BELL]);
for (let i = 112; i <= 119; i++) {
    instrumentMap.set(i, [Instrument.IRON_XYLOPHONE, Instrument.BASS, Instrument.XYLOPHONE]);
}

const percussionMap = new Map();
percussionMap.set(35, 10 + 25 * 1);
percussionMap.set(36, 6  + 25 * 1);
percussionMap.set(37, 6  + 25 * 3);
percussionMap.set(38, 8  + 25 * 2);
percussionMap.set(39, 6  + 25 * 3);
percussionMap.set(40, 4  + 25 * 2);
percussionMap.set(41, 6  + 25 * 1);
percussionMap.set(42, 22 + 25 * 2);
percussionMap.set(43, 13 + 25 * 1);
percussionMap.set(44, 22 + 25 * 2);
percussionMap.set(45, 15 + 25 * 1);
percussionMap.set(46, 18 + 25 * 2);
percussionMap.set(47, 20 + 25 * 1);
percussionMap.set(48, 23 + 25 * 1);
percussionMap.set(49, 17 + 25 * 2);
percussionMap.set(50, 23 + 25 * 1);
percussionMap.set(51, 24 + 25 * 2);
percussionMap.set(52, 8  + 25 * 2);
percussionMap.set(53, 13 + 25 * 2);
percussionMap.set(54, 18 + 25 * 3);
percussionMap.set(55, 18 + 25 * 2);
percussionMap.set(56, 1  + 25 * 3);
percussionMap.set(57, 13 + 25 * 2);
percussionMap.set(58, 2  + 25 * 3);
percussionMap.set(59, 13 + 25 * 2);
percussionMap.set(60, 9  + 25 * 3);
percussionMap.set(61, 2  + 25 * 3);
percussionMap.set(62, 8  + 25 * 3);
percussionMap.set(63, 22 + 25 * 1);
percussionMap.set(64, 15 + 25 * 1);
percussionMap.set(65, 13 + 25 * 2);
percussionMap.set(66, 8  + 25 * 2);
percussionMap.set(67, 8  + 25 * 3);
percussionMap.set(68, 3  + 25 * 3);
percussionMap.set(69, 20 + 25 * 3);
percussionMap.set(70, 23 + 25 * 3);
percussionMap.set(71, 24 + 25 * 3);
percussionMap.set(72, 24 + 25 * 3);
percussionMap.set(73, 17 + 25 * 3);
percussionMap.set(74, 11 + 25 * 3);
percussionMap.set(75, 18 + 25 * 3);
percussionMap.set(76, 9  + 25 * 3);
percussionMap.set(77, 5  + 25 * 3);
percussionMap.set(78, 22 + 25 * 3);
percussionMap.set(79, 19 + 25 * 2);
percussionMap.set(80, 17 + 25 * 3);
percussionMap.set(81, 22 + 25 * 3);
percussionMap.set(82, 22 + 25 * 2);
percussionMap.set(83, 24 + 25 * 8);
percussionMap.set(84, 24 + 25 * 8);
percussionMap.set(85, 21 + 25 * 3);
percussionMap.set(86, 14 + 25 * 1);
percussionMap.set(87, 7  + 25 * 1);
class Note {
    constructor(instrument, pitch, volume, time) {
        this.instrument = instrument;
        this.pitch = pitch;
        this.volume = volume;
        this.time = time; 
    }
}

class Song {
    constructor(name) {
        this.name = name;
        this.notes = [];
        this.position = 0;
        this.looping = false;
        this.paused = true;
        this.startTime = 0;
        this.length = 0;
        this.time = 0;
        this.loopPosition = 0;
        this.loopCount = 0;
        this.currentLoop = 0;
    }

    add(note) {
        this.notes.push(note);
    }

    sort() {
        this.notes.sort((a, b) => a.time - b.time);
    }

    play() {
        if (this.paused) {
            this.paused = false;
            this.startTime = Date.now() - this.time;
        }
    }

    pause() {
        if (!this.paused) {
            this.paused = true;
            this.advanceTime();
        }
    }

    setTime(t) {
        this.time = t;
        this.startTime = Date.now() - this.time;
        this.position = 0;
        while (this.position < this.notes.length && this.notes[this.position].time < t) {
            this.position++;
        }
    }

    advanceTime() {
        this.time = Date.now() - this.startTime;
    }

    reachedNextNote() {
        if (this.position < this.notes.length) {
            return this.notes[this.position].time <= this.time;
        } else {
            if (this.time > this.length && this.shouldLoop()) {
                this.loop();
                if (this.position < this.notes.length) {
                    return this.notes[this.position].time <= this.time;
                }
            }
            return false;
        }
    }

    getNextNote() {
        if (this.position >= this.notes.length) {
            if (this.shouldLoop()) {
                this.loop();
            } else {
                return null;
            }
        }
        return this.notes[this.position++];
    }

    finished() {
        return this.time > this.length && !this.shouldLoop();
    }

    loop() {
        this.position = 0;
        this.startTime += this.length - this.loopPosition;
        this.time -= this.length - this.loopPosition;
        while (this.position < this.notes.length && this.notes[this.position].time < this.loopPosition) {
            this.position++;
        }
        this.currentLoop++;
    }

    shouldLoop() {
        if (this.looping) {
            if (this.loopCount === 0) return true;
            return this.currentLoop < this.loopCount;
        }
        return false;
    }

    size() {
        return this.notes.length;
    }

    get(i) {
        return this.notes[i];
    }
}

const nbsInstrumentIndex = [
    Instrument.HARP, Instrument.BASS, Instrument.BASEDRUM, Instrument.SNARE,
    Instrument.HAT, Instrument.GUITAR, Instrument.FLUTE, Instrument.BELL,
    Instrument.CHIME, Instrument.XYLOPHONE, Instrument.IRON_XYLOPHONE,
    Instrument.COW_BELL, Instrument.DIDGERIDOO, Instrument.BIT,
    Instrument.BANJO, Instrument.PLING
];

function parseNbsData(buffer, fileName) {
    try {
        let offset = 0;

        function readByte() { return buffer.readUInt8(offset++); }
        function readShort() { const v = buffer.readUInt16LE(offset); offset += 2; return v; }
        function readInt() { const v = buffer.readInt32LE(offset); offset += 4; return v; }
        function readString() {
            const len = readInt();
            if (len <= 0) return '';
            const str = buffer.toString('utf8', offset, offset + len);
            offset += len;
            return str;
        }

        let songLength = readShort();
        let format = 0;
        let vanillaInstrumentCount = 0;

        if (songLength === 0) {
            format = readByte();
        }
        if (format >= 1) {
            vanillaInstrumentCount = readByte();
        }
        if (format >= 3) {
            songLength = readShort();
        }

        const layerCount = readShort();
        const songName = readString();
        const songAuthor = readString();
        const songOriginalAuthor = readString();
        const songDescription = readString();
        const tempo = readShort();
        readByte();
        readByte();
        readByte(); 
        readInt();
        readInt();
        readInt();
        readInt(); 
        readInt();
        readString(); 

        let loop = 0;
        let maxLoopCount = 0;
        let loopStartTick = 0;
        if (format >= 4) {
            loop = readByte();
            maxLoopCount = readByte();
            loopStartTick = readShort();
        }

        const nbsNotes = [];
        let tick = -1;

        while (true) {
            const tickJumps = readShort();
            if (tickJumps === 0) break;
            tick += tickJumps;

            let layer = -1;
            while (true) {
                const layerJumps = readShort();
                if (layerJumps === 0) break;
                layer += layerJumps;

                const instrument = readByte();
                const key = readByte();
                let velocity = 100;
                let panning = 100;
                let notePitch = 0;

                if (format >= 4) {
                    velocity = readByte();
                    panning = readByte();
                    notePitch = readShort();
                }

                nbsNotes.push({
                    tick, layer, instrument, key, velocity, panning, pitch: notePitch
                });
            }
        }

        const nbsLayers = [];
        if (offset < buffer.length) {
            for (let i = 0; i < layerCount; i++) {
                const layerName = readString();
                let lock = 0;
                if (format >= 4) lock = readByte();
                const volume = readByte();
                let stereo = 100;
                if (format >= 2) stereo = readByte();
                nbsLayers.push({ name: layerName, lock, volume, stereo });
            }
        }

        const customInstruments = [];
        if (offset < buffer.length) {
            const customCount = readByte();
            for (let i = 0; i < customCount; i++) {
                const cname = readString();
                const cfile = readString();
                const cpitch = readByte();
                const ckey = readByte() !== 0;
                customInstruments.push({ name: cname, file: cfile, pitch: cpitch, key: ckey });
            }
        }

        const name = songName.trim().length > 0 ? songName : fileName;
        const song = new Song(name);

        if (loop > 0) {
            song.looping = true;
            song.loopPosition = getMilliTime(loopStartTick, tempo);
            song.loopCount = maxLoopCount;
        }

        for (const note of nbsNotes) {
            let instrument;
            let key = note.key;

            if (note.instrument < nbsInstrumentIndex.length) {
                instrument = nbsInstrumentIndex[note.instrument];
            } else {
                const index = note.instrument - nbsInstrumentIndex.length;
                if (index >= customInstruments.length) continue;
                const ci = customInstruments[index];
                instrument = Instrument.of(ci.name);
                key += ci.pitch;
            }

            let layerVolume = 100;
            if (nbsLayers.length > note.layer) {
                layerVolume = nbsLayers[note.layer].volume;
            }

            const pitch = key - 33;
            const time = getMilliTime(note.tick, tempo);
            const volume = note.velocity * layerVolume / 10000;

            song.add(new Note(instrument, pitch, volume, time));
        }

        if (song.notes.length === 0) return null;

        song.sort();
        song.length = song.get(song.size() - 1).time + 50;

        return song;
    } catch (e) {
        console.error(`[Music] NBS parse error: ${e.message}`);
        return null;
    }
}

function getMilliTime(tick, tempo) {
    return 1000 * tick * 100 / tempo;
}

function parseNbsFile(filePath) {
    return new Promise((resolve) => {
        const fileName = path.basename(filePath, '.nbs');
        fs.readFile(filePath, (err, data) => {
            if (err) {
                console.error(`[Music] Failed to read NBS file: ${err.message}`);
                resolve(null);
                return;
            }
            resolve(parseNbsData(data, fileName));
        });
    });
}

function getMidiInstrumentNote(midiInstrument, midiPitch, velocity, time) {
    const instrumentList = instrumentMap.get(midiInstrument);
    if (!instrumentList) return null;

    let instrument = null;
    for (const candidate of instrumentList) {
        if (midiPitch >= candidate.offset && midiPitch <= candidate.offset + 24) {
            instrument = candidate;
            break;
        }
    }

    if (!instrument) return null;

    const pitch = midiPitch - instrument.offset;
    return new Note(instrument, pitch, velocity, time);
}

function getMidiPercussionNote(midiPitch, velocity, time) {
    const noteId = percussionMap.get(midiPitch);
    if (noteId === undefined) return null;

    const pitch = noteId % 25;
    const instrument = Instrument.fromId(Math.floor(noteId / 25));
    return new Note(instrument, pitch, velocity, time);
}

function parseMidiData(buffer, fileName) {
    try {
        const midi = new Midi(buffer);
        const song = new Song(fileName.replace(/\.mid$/i, ''));

        for (const track of midi.tracks) {
            for (const note of track.notes) {
                const midiPitch = note.midi;
                const velocity = note.velocity > 1 ? note.velocity / 127 : note.velocity;
                const time = Math.round(note.time * 1000); // milliseconds

                let n = null;

                if (track.instrument.percussion) {
                    n = getMidiPercussionNote(midiPitch, velocity, time);
                } else {
                    const midiInstrument = track.instrument.number;
                    n = getMidiInstrumentNote(midiInstrument, midiPitch, velocity, time);
                }

                if (n) {
                    song.add(n);
                    if (time > song.length) song.length = time;
                }
            }
        }

        if (song.notes.length === 0) return null;
        song.sort();
        song.length = song.get(song.size() - 1).time + 50;

        return song;
    } catch (e) {
        console.error(`[Music] MIDI parse error: ${e.message}`);
        return null;
    }
}

function parseMidiFile(filePath) {
    return new Promise((resolve) => {
        const fileName = path.basename(filePath, '.mid');
        fs.readFile(filePath, (err, data) => {
            if (err) {
                console.error(`[Music] Failed to read MIDI file: ${err.message}`);
                resolve(null);
                return;
            }
            resolve(parseMidiData(data, fileName));
        });
    });
}


function convertToRawUrl(url) {
    const githubBlob = /^https?:\/\/github\.com\/([^\/]+)\/([^\/]+)\/blob\/(.+)$/;
    const match = url.match(githubBlob);
    if (match) {
        return `https://raw.githubusercontent.com/${match[1]}/${match[2]}/${match[3]}`;
    }
    return url;
}

async function fetchMusicUrl(url) {
    try {
        const rawUrl = convertToRawUrl(url);
        const fileName = path.basename(rawUrl.split('?')[0]) || 'unknown';

        const response = await axios.get(rawUrl, { 
            responseType: 'arraybuffer',
            timeout: 30000,
            maxContentLength: 50 * 1024 * 1024,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        const data = Buffer.from(response.data, 'binary');
        const firstBytes = data.slice(0, 20).toString('utf8').trim();
        if (firstBytes.startsWith('<!DOCTYPE') || firstBytes.startsWith('<html') || firstBytes.startsWith('<!doctype')) {
            return null;
        }

        return { data, fileName };
    } catch (e) {
        console.error(`[Music] Failed to download: ${e.message}`);
        return null;
    }
}

module.exports = function musicPlugin(bot) {
    const musicDir = path.join(process.cwd(), 'music');
    let currentSong = null;
    let isPlaying = false;
    let isPaused = false;
    let playTimer = null;
    let queue = [];
    let loop = false;
    let volume = 1.0;
    let pitch = 0;
    let displayMode = 'actionbar';
    let bossbarId = 'noratbot_music';
    let bossbarActive = false;
    let displayInterval = null;
    let ticksUntilPausedActionbar = 20;

    function log(msg) {
        console.log(`[${bot.id}] [Music] ${msg}`);
    }

    function listTracks() {
        if (!fs.existsSync(musicDir)) {
            fs.mkdirSync(musicDir, { recursive: true });
            return [];
        }
        return fs.readdirSync(musicDir)
            .filter(f => f.endsWith('.mid') || f.endsWith('.nbs'))
            .map(f => path.basename(f, path.extname(f)));
    }

    function calculatePitch(notePitch) {
        return Math.max(0, Math.min(2, 0.5 * Math.pow(2, (notePitch + (pitch / 10)) / 12)));
    }

    function playSound(note) {
        const floatingPitch = calculatePitch(note.pitch);
        const vol = Math.min(Math.max(note.volume * volume, 0.0), 2.0);
        const command = `execute as @a[tag=!nomusic] at @s run playsound ${note.instrument.sound} record @s ~ ~ ~ ${vol.toFixed(4)} ${floatingPitch.toFixed(5)}`;

        if (bot.core && typeof bot.core.run === 'function') {
            bot.core.run(command);
        }
    }
    function handlePlaying() {
        if (!currentSong) return;
        currentSong.advanceTime();
        while (currentSong.reachedNextNote()) {
            const note = currentSong.getNextNote();
            if (!note) break;
            try {
                playSound(note);
            } catch (e) {
                console.error(e);
            }
        }
    }

    function formatTime(millis) {
        const seconds = Math.floor(millis / 1000);
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    function generateActionbar() {
        if (!currentSong) return '♫ noratbot music';

        const name = currentSong.name || 'Unknown';
        const current = currentSong.time;
        const total = currentSong.length;
        const status = currentSong.paused ? '⏸' : '▶';
        const progress = total > 0 ? Math.round((current / total) * 100) : 0;
        const loopText = currentSong.looping ? ' 🔁' : '';
        const volText = volume !== 1.0 ? ` Volume: ${volume.toFixed(1)}` : '';
        const pitchText = pitch !== 0 ? ` Pitch: ${pitch}` : '';

        const base = `♫ ${name} ${status} ${formatTime(current)} / ${formatTime(total)} (${progress}%)${volText}${pitchText}${loopText}`;
        try {
            return gradient.gradient(base, '#f4fcff', '#238bff');
        } catch (e) {
            return base;
        }
    }

    function sendActionBar() {
        if (!currentSong || !isPlaying) return;
        if (currentSong.paused && ticksUntilPausedActionbar-- < 0) return;
        else ticksUntilPausedActionbar = 20;

        const grad = generateActionbar();
        let json;
        if (Array.isArray(grad)) {
            json = JSON.stringify({ text: '', extra: grad });
        } else {
            json = JSON.stringify({ text: String(grad) });
        }
        const cmd = `title @a[tag=!nomusic] actionbar ${json}`;
        if (bot.core && typeof bot.core.run === 'function') {
            bot.core.run(cmd);
        }
    }

    function createBossBar() {
        if (!currentSong) return;
        const name = currentSong.name || 'Music';
        const total = currentSong.length;
        const current = currentSong.time;
        const progress = total > 0 ? Math.min((current / total) * 100, 100) : 0;
        const displayText = `♫ ${name} ${currentSong.paused ? '⏸' : '▶'} ${formatTime(current)} / ${formatTime(total)} (${Math.round(progress)}%)`;
        if (bot.core && typeof bot.core.run === 'function') {
            bot.core.run(`bossbar add ${bossbarId} {"text":"${displayText}"}`);
            bot.core.run(`bossbar set ${bossbarId} color blue`);
            bot.core.run(`bossbar set ${bossbarId} value ${Math.round(progress)}`);
            bot.core.run(`bossbar set ${bossbarId} players @a[tag=!nomusic]`);
            bossbarActive = true;
        }
    }

    function updateBossBar() {
        if (!bossbarActive) {
            createBossBar();
            return;
        }
        if (!currentSong) {
            removeBossBar();
            return;
        }
        const name = currentSong.name || 'Music';
        const total = currentSong.length;
        const current = currentSong.time;
        const progress = total > 0 ? Math.min((current / total) * 100, 100) : 0;
        const displayText = `♫ ${name} ${currentSong.paused ? '⏸' : '▶'} ${formatTime(current)} / ${formatTime(total)} (${Math.round(progress)}%)`;
        if (bot.core && typeof bot.core.run === 'function') {
            bot.core.run(`bossbar set ${bossbarId} name {"text":"${displayText}"}`);
            bot.core.run(`bossbar set ${bossbarId} value ${Math.round(progress)}`);
            bot.core.run(`bossbar set ${bossbarId} players @a[tag=!nomusic]`);
        }
    }

    function removeBossBar() {
        if (bossbarActive) {
            if (bot.core && typeof bot.core.run === 'function') {
                bot.core.run(`bossbar remove ${bossbarId}`);
            }
            bossbarActive = false;
        }
    }

    function updateProgress() {
        if (displayMode === 'bossbar') {
            updateBossBar();
        } else {
            sendActionBar();
        }
    }

    function startDisplayUpdates() {
        if (displayInterval) clearInterval(displayInterval);
        if (displayMode === 'bossbar') {
            createBossBar();
            displayInterval = setInterval(updateBossBar, 500);
        } else {
            displayInterval = setInterval(sendActionBar, 500);
        }
    }

    async function playTrack(nameOrUrl) {
        let song = null;

        if (nameOrUrl.startsWith('http://') || nameOrUrl.startsWith('https://')) {
            const rawUrl = convertToRawUrl(nameOrUrl);
            if (rawUrl !== nameOrUrl) {
            }
            const result = await fetchMusicUrl(nameOrUrl);
            if (!result) {
                return false;
            }
            const lowerUrl = nameOrUrl.toLowerCase();
            if (lowerUrl.endsWith('.nbs')) {
                song = parseNbsData(result.data, result.fileName);
            } else {
                song = parseMidiData(result.data, result.fileName);
            }
        } else {
            let filePath = path.join(musicDir, nameOrUrl + '.mid');
            if (fs.existsSync(filePath)) {
                song = await parseMidiFile(filePath);
            } else {
                filePath = path.join(musicDir, nameOrUrl + '.nbs');
                if (fs.existsSync(filePath)) {
                    song = await parseNbsFile(filePath);
                } else {
                    return false;
                }
            }
        }

        if (!song) {
            return false;
        }

        if (isPlaying) stopTrack();

        currentSong = song;
        isPlaying = true;
        isPaused = false;
        ticksUntilPausedActionbar = 20;

        currentSong.play();

        startPlayTimer();
        startDisplayUpdates();

        return true;
    }

    function startPlayTimer() {
        if (playTimer) clearInterval(playTimer);
        playTimer = setInterval(() => {
            if (!currentSong || !isPlaying) return;

            if (currentSong.paused) {
                updateProgress();
                return;
            }

            handlePlaying();

            if (currentSong.finished()) {
                if (queue.length > 0) {
                    const next = queue.shift();
                    playTrack(next);
                } else {
                    stopTrack();
                }
            }
        }, 50);
    }

    function stopTrack() {
        if (playTimer) {
            clearInterval(playTimer);
            playTimer = null;
        }
        if (displayInterval) {
            clearInterval(displayInterval);
            displayInterval = null;
        }
        isPlaying = false;
        isPaused = false;
        currentSong = null;
        removeBossBar();
    }

    function pauseTrack() {
        if (!isPlaying || !currentSong || currentSong.paused) return;
        currentSong.pause();
        isPaused = true;
        updateProgress();
    }

    function resumeTrack() {
        if (!isPlaying || !currentSong || !currentSong.paused) return;
        currentSong.play();
        isPaused = false;
        ticksUntilPausedActionbar = 20;
    }

    function addToQueue(name) {
        const isUrl = name.startsWith('http://') || name.startsWith('https://');
        if (!isUrl && !listTracks().includes(name)) return false;
        queue.push(name);
        return true;
    }

    function skipTrack() {
        if (queue.length > 0) {
            const next = queue.shift();
            playTrack(next);
            return true;
        }
        return false;
    }

    function setVolume(v) {
        volume = Math.min(Math.max(v, 0.0), 2.0);
    }

    function setPitchShift(p) {
        pitch = Math.min(Math.max(p, -120), 120);
    }

    function setLoop(l) {
        loop = l;
        if (currentSong) currentSong.looping = l;
    }

    function setDisplay(mode) {
        if (mode === 'bossbar' || mode === 'actionbar') {
            displayMode = mode;
            if (isPlaying) {
                if (displayInterval) {
                    clearInterval(displayInterval);
                    displayInterval = null;
                }
                removeBossBar();
                startDisplayUpdates();
            }
        }
    }

    bot.music = {
        list: listTracks,
        play: playTrack,
        stop: stopTrack,
        pause: pauseTrack,
        resume: resumeTrack,
        isPlaying: () => isPlaying,
        isPaused: () => isPaused,
        current: () => currentSong ? currentSong.name : null,
        queue: {
            add: addToQueue,
            skip: skipTrack,
            list: () => queue.slice(),
            clear: () => { queue = []; }
        },
        settings: {
            setVolume,
            setPitchShift,
            setLoop,
            setDisplay,
            getVolume: () => volume,
            getPitchShift: () => pitch,
            getLoop: () => loop,
            getDisplay: () => displayMode
        }
    };

    if (!fs.existsSync(musicDir)) {
        fs.mkdirSync(musicDir, { recursive: true });
    }
};
