const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});
const { MongoClient } = require('mongodb');

const PORT = process.env.PORT || 3000;

// ── MONGODB ──
if (!process.env.MONGODB_URI) {
    console.error("❌ FATAL: MONGODB_URI environment variable is not set. Please add it in your Render dashboard.");
    process.exit(1);
}
const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);
let usersCollection;

async function connectDB() {
    try {
        await client.connect();
        console.log("✅ Connected to MongoDB Secure Uplink!");
        const database = client.db('baylerbayOps');
        usersCollection = database.collection('users');
        await usersCollection.createIndex({ callsignLower: 1 }, { unique: true });
    } catch (err) {
        console.error("❌ MongoDB connection error:", err);
    }
}
connectDB();

// ── SERVER-SIDE MAP ──
const worldWidth = 10000; const worldHeight = 2500;
let serverMap = [];

function mulberry32(a) { return function() { var t = a += 0x6D2B79F5; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

function buildServerMap() {
    // ── MUST mirror client buildMap() exactly — same seed, same RNG call order ──
    // If the RNG sequence differs (e.g. skipping covers/powerups), platform
    // positions diverge and NPCs appear to walk through client-side blocks.
    serverMap = [
        { x: -50,       y: 0,              w: 50,        h: worldHeight, type: "wall"  },
        { x: worldWidth, y: 0,             w: 50,        h: worldHeight, type: "wall"  },
        { x: 0,          y: -50,           w: worldWidth, h: 50,         type: "wall"  },
        { x: 0,          y: worldHeight-50, w: worldWidth, h: 50,        type: "floor" }
    ];

    const rand = mulberry32(12345);

    function checkOvlp(nx, ny, nw, nh) {
        const PAD = 40;
        for (const obj of serverMap) {
            if (obj.type === 'wall' || obj.type === 'floor') continue;
            if (nx < obj.x+obj.w+PAD && nx+nw+PAD > obj.x && ny < obj.y+obj.h+PAD && ny+nh+PAD > obj.y) return true;
        }
        return false;
    }

    // Consume powerup RNG the same way the client does (so downstream calls stay in sync)
    function consumePowerup() {
        if (rand() > 0.45) return;   // same gate as client spawnPowerup
        rand();                       // type rr draw
    }

    // ── TIER 0 platforms (ground level) ──
    let cx = 200;
    while (cx < worldWidth - 400) {
        const pw = 130 + rand() * 270, py = worldHeight - 130 - rand() * 520;
        if (!checkOvlp(cx, py, pw, 28)) {
            serverMap.push({ x: cx, y: py, w: pw, h: 28, type: "plat" });
            // cover check — same RNG calls as client
            if (rand() > 0.45) {
                const cw = 38 + rand() * 28, ch = 50 + rand() * 40;
                if (!checkOvlp(cx + pw/2 - cw/2, py - ch, cw, ch)) {
                    serverMap.push({ x: cx + pw/2 - cw/2, y: py - ch, w: cw, h: ch, type: "cover" });
                }
            }
            consumePowerup(); rand(); // powerup x-pos rand consumed by client
        }
        cx += pw + 40 + rand() * 140;
    }

    // ── TIER 1 platforms (mid level, some moving) ──
    cx = 350;
    while (cx < worldWidth - 600) {
        const pw = 110 + rand() * 200, py = worldHeight - 650 - rand() * 380;
        if (!checkOvlp(cx, py, pw, 24)) {
            const isMoving = rand() > 0.68;
            const plat = { x: cx, y: py, w: pw, h: 24, type: "plat" };
            if (isMoving) {
                plat.moving = true;
                plat.moveBase  = cx;
                plat.moveRange = 110 + rand() * 220;
                plat.moveSpeed = 0.00045 + rand() * 0.00065;
                plat.movePhase = rand() * Math.PI * 2;
            }
            serverMap.push(plat);
            // cover
            if (rand() > 0.5) {
                const cw = 32 + rand() * 24, ch = 28 + rand() * 28;
                if (!checkOvlp(cx + pw/2 - cw/2, py - ch, cw, ch)) {
                    serverMap.push({ x: cx + pw/2 - cw/2, y: py - ch, w: cw, h: ch, type: "cover" });
                }
            }
            consumePowerup(); rand();
        }
        cx += pw + 80 + rand() * 240;
    }

    // ── TIER 2 platforms (upper, some moving + Y-move) ──
    cx = 500;
    while (cx < worldWidth - 800) {
        const pw = 90 + rand() * 170, py = worldHeight - 1100 - rand() * 480;
        if (!checkOvlp(cx, py, pw, 22)) {
            const isMoving = rand() > 0.45;
            const plat = { x: cx, y: py, w: pw, h: 22, type: "plat" };
            if (isMoving) {
                plat.moving    = true;
                plat.moveBase  = cx;
                plat.moveRange = 90 + rand() * 200;
                plat.moveSpeed = 0.0006 + rand() * 0.001;
                plat.movePhase = rand() * Math.PI * 2;
                plat.moveY     = rand() > 0.55;
                if (plat.moveY) {
                    plat.moveBaseY   = py;
                    plat.moveRangeY  = 60 + rand() * 100;
                    plat.moveSpeedY  = 0.0004 + rand() * 0.0006;
                    plat.movePhaseY  = rand() * Math.PI * 2;
                }
            }
            serverMap.push(plat);
            consumePowerup(); rand();
        }
        cx += pw + 120 + rand() * 320;
    }

    // ── TIER 3 platforms (sky level) ──
    cx = 700;
    while (cx < worldWidth - 1000) {
        const pw = 120 + rand() * 280, py = 120 + rand() * 420;
        if (!checkOvlp(cx, py, pw, 20)) {
            const isMoving = rand() > 0.6;
            const plat = { x: cx, y: py, w: pw, h: 20, type: "plat" };
            if (isMoving) {
                plat.moving    = true;
                plat.moveBase  = cx;
                plat.moveRange = 80 + rand() * 180;
                plat.moveSpeed = 0.0003 + rand() * 0.0005;
                plat.movePhase = rand() * Math.PI * 2;
            }
            serverMap.push(plat);
            // cover — client calls rand() twice for position even inside checkOverlap
            if (rand() > 0.5) {
                const cw = 30 + rand() * 25, ch = 20 + rand() * 24;
                const coverX = cx + pw * rand() - 15;
                if (!checkOvlp(coverX, py - ch, cw, ch)) {
                    serverMap.push({ x: coverX, y: py - ch, w: cw, h: ch, type: "cover" });
                }
            }
            consumePowerup(); rand();
        }
        cx += pw + 220 + rand() * 500;
    }

    // ── Tower structures ──
    let tx = 600;
    while (tx < worldWidth - 500) {
        const tH = 200 + rand() * 600, tY = worldHeight - 700 - rand() * 600, tW = 20 + rand() * 15;
        if (!checkOvlp(tx, tY, tW, tH)) {
            serverMap.push({ x: tx, y: tY, w: tW, h: tH, type: "cover" });
            for (let gy = tY + 40; gy < tY + tH - 40; gy += 100 + rand() * 80) {
                const bx = tx - 80 - rand() * 40, bw = 70 + rand() * 30;
                if (!checkOvlp(bx, gy, bw, 16)) {
                    serverMap.push({ x: bx, y: gy, w: bw, h: 16, type: "plat" });
                }
            }
        }
        tx += 500 + rand() * 900;
    }

    // ── Cluster platforms ──
    let fx = 1000;
    while (fx < worldWidth - 1200) {
        const baseY = 400 + rand() * 800;
        let clusterX = fx;
        const count = 3 + Math.floor(rand() * 3);
        for (let ci = 0; ci < count; ci++) {
            const pw = 80 + rand() * 120, py = baseY + (rand() - 0.5) * 200;
            if (!checkOvlp(clusterX, py, pw, 20)) {
                serverMap.push({ x: clusterX, y: py, w: pw, h: 20, type: "plat" });
                consumePowerup(); rand();
            }
            clusterX += pw + 30 + rand() * 60;
        }
        fx += 1200 + rand() * 1500;
    }
}
buildServerMap();

// ── SERVER-SIDE BOTS (PUBLIC ONLY — FIXED) ──
class ServerNPC {
    constructor(id, name, color) {
        this.id = id; this.name = name; this.color = color;
        this.width = 40; this.height = 40;
        this.health = 100; this.maxHealth = 100; this.aimAngle = 0;
        this.target = null; this.decisionTimer = 0;
        this.moveDir = Math.random() > 0.5 ? 1 : -1;
        this.lastShotTime = 0; this.onGround = false;
        this.respawn();
    }

    respawn() {
        this.x = Math.random() * 8000 + 1000;
        this.y = Math.random() * 500 + 200;
        this.dx = 0; this.dy = 0;
        this.health = 100;
        this.target = null;
        this.decisionTimer = 0;
    }

    update(dt, publicPlayers) {
        if (this.health <= 0) return;
        const now = Date.now();
        this.decisionTimer -= dt;

        // ── FIX: Emergency respawn if fallen off world ──
        if (this.y > worldHeight + 200) {
            this.respawn();
            return;
        }

        // ── FIX: Clamp X to world boundaries ──
        if (this.x <= 5) { this.x = 5; this.moveDir = 1; }
        if (this.x >= worldWidth - 50) { this.x = worldWidth - 50; this.moveDir = -1; }

        // Targeting
        let closest = null; let minDist = 1200;
        for (let id in publicPlayers) {
            let p = publicPlayers[id]; if (p.health <= 0) continue;
            let d = Math.hypot(p.x - this.x, p.y - this.y);
            if (d < minDist) { minDist = d; closest = p; }
        }
        for (let i = 0; i < globalNPCs.length; i++) {
            let ob = globalNPCs[i]; if (ob.id === this.id || ob.health <= 0) continue;
            let d = Math.hypot(ob.x - this.x, ob.y - this.y);
            if (d < minDist) { minDist = d; closest = ob; }
        }
        this.target = closest;

        // Decision making
        if (this.decisionTimer <= 0) {
            this.decisionTimer = 800 + Math.random() * 1600;
            if (this.target) {
                this.moveDir = this.target.x > this.x ? 1 : -1;
            } else if (Math.random() > 0.6) {
                this.moveDir *= -1;
            }
        }

        // Reverse direction at boundaries
        if (this.x <= 30 && this.moveDir < 0) this.moveDir = 1;
        if (this.x >= worldWidth - 70 && this.moveDir > 0) this.moveDir = -1;

        // STEP 1: Move X, resolve X collisions (revert on wall hit)
        const prevX = this.x;
        this.x += this.moveDir * 4;
        for (const obj of serverMap) {
            if (this.x < obj.x + obj.w && this.x + this.width > obj.x &&
                this.y < obj.y + obj.h && this.y + this.height > obj.y) {
                this.x = prevX;
                this.moveDir *= -1;
                break;
            }
        }

        // STEP 2: Apply gravity, jump if on ground and target is above
        this.dy += 0.35;
        if (this.onGround && this.target && this.target.y < this.y - 80) {
            this.dy = -10;
            this.onGround = false;
        }
        if (this.y > worldHeight - 100) this.dy = -8;

        // STEP 3: Move Y, resolve Y collisions separately
        this.y += this.dy;
        this.onGround = false;
        for (const obj of serverMap) {
            if (this.x < obj.x + obj.w && this.x + this.width > obj.x &&
                this.y < obj.y + obj.h && this.y + this.height > obj.y) {
                if (this.dy > 0) {          // falling → land on top of platform
                    this.y = obj.y - this.height;
                    this.onGround = true;
                } else if (this.dy < 0) {   // jumping → hit ceiling
                    this.y = obj.y + obj.h;
                }
                this.dy = 0;
            }
        }

        // Combat
        if (this.target && this.health > 0) {
            let tx = this.target.x + 20, ty = this.target.y + 20;
            let desiredAngle = Math.atan2(ty - (this.y + 20), tx - (this.x + 20));
            this.aimAngle += (desiredAngle - this.aimAngle) * 0.2;

            if (now - this.lastShotTime > 350 + Math.random() * 250) {
                this.lastShotTime = now;
                io.to('GLOBAL_PUBLIC').emit('networkBullet', {
                    x: this.x + 20, y: this.y + 20,
                    vx: Math.cos(this.aimAngle) * 14, vy: Math.sin(this.aimAngle) * 14,
                    radius: 4, color: '#ffffff', ownerId: this.id
                });
                // Bot vs Bot damage
                if (this.target.id && this.target.id.startsWith('npc_') && Math.random() > 0.7) {
                    this.target.health -= 15;
                    if (this.target.health <= 0) {
                        io.to('GLOBAL_PUBLIC').emit('botDied', {
                            botId: this.target.id, botName: this.target.name,
                            killerId: this.id, killerName: this.name,
                            x: this.target.x, y: this.target.y
                        });
                        const deadBot = this.target;
                        setTimeout(() => { deadBot.respawn(); }, 3000);
                    }
                }
            }
        }
    }
}

const botNames = ["Alpha_Unit", "Ghost_Z", "Rogue_01", "Shadow_Byte", "Viper", "Keralite_Pro", "Bot_Nizal", "Cyber_Rex"];
const botColors = ["#ff4757", "#2ecc71", "#3498db", "#f1c40f", "#a29bfe", "#fd79a8"];
let globalNPCs = [];
for (let i = 0; i < 6; i++) {
    globalNPCs.push(new ServerNPC("npc_" + i, botNames[i], botColors[i % botColors.length]));
}

// NPC game loop (30fps)
setInterval(() => {
    let publicPlayers = {};
    for (let id in players) { if (players[id].room === 'GLOBAL_PUBLIC') publicPlayers[id] = players[id]; }
    let safeSyncPayload = [];
    globalNPCs.forEach(npc => {
        npc.update(33, publicPlayers);
        if (npc.health > 0) {
            safeSyncPayload.push({
                id: npc.id, name: npc.name, color: npc.color,
                x: npc.x, y: npc.y, health: npc.health, aimAngle: npc.aimAngle
            });
        }
    });
    io.to('GLOBAL_PUBLIC').emit('npcSync', safeSyncPayload);
}, 33);

// ── GAME STATE ──
let players = {};
let roomData = {}; // private room metadata
let publicScores = {}; // Tracks public leaderboard
// ── ROOM HELPERS ──
function initRoomData(roomName, hostId, config) {
    roomData[roomName] = {
        host: hostId,
        password: config.password || '',
        state: 'waiting', // 'waiting' | 'playing' | 'ended'
        mode: config.mode || 'kills',       // 'kills' | 'time'
        killGoal: config.killGoal || 10,
        duration: config.duration || 180,   // seconds
        teamsEnabled: config.teamsEnabled || false,
        teams: { red: [], blue: [] },
        readyPlayers: new Set(),
        timeLeft: 0,
        killCounts: {},     // socketId -> kill count this match
        timerInterval: null,
        leaderboard: []     // [{ name, kills, team }]
    };
}

function cleanupRoom(roomName) {
    if (roomName === 'GLOBAL_PUBLIC') return;
    let hasPlayers = false;
    for (let id in players) { if (players[id].room === roomName) { hasPlayers = true; break; } }
    if (!hasPlayers) {
        const rd = roomData[roomName];
        if (rd && rd.timerInterval) clearInterval(rd.timerInterval);
        delete roomData[roomName];
    }
}

function getPlayersInRoom(roomName) {
    let result = {};
    for (let id in players) { if (players[id].room === roomName) result[id] = players[id]; }
    return result;
}

function buildLobbyState(roomName) {
    const rd = roomData[roomName];
    if (!rd) return null;
    const roomPlayers = getPlayersInRoom(roomName);
    return {
        host: rd.host,
        state: rd.state,
        mode: rd.mode,
        killGoal: rd.killGoal,
        duration: rd.duration,
        teamsEnabled: rd.teamsEnabled,
        teams: rd.teams,
        readyPlayers: [...rd.readyPlayers],
        players: Object.fromEntries(
            Object.entries(roomPlayers).map(([id, p]) => [id, { name: p.name, color: p.color, team: p.team }])
        ),
        timeLeft: rd.timeLeft,
        leaderboard: rd.leaderboard
    };
}

function buildRoomLeaderboard(roomName) {
    const rd = roomData[roomName]; if (!rd) return [];
    const list = [];
    for (let id in players) {
        if (players[id].room !== roomName) continue;
        list.push({
            id, name: players[id].name, color: players[id].color,
            team: players[id].team, kills: rd.killCounts[id] || 0
        });
    }
    list.sort((a, b) => b.kills - a.kills);
    return list;
}

function checkWinCondition(roomName) {
    const rd = roomData[roomName];
    if (!rd || rd.state !== 'playing') return;

    if (rd.mode === 'kills') {
        if (rd.teamsEnabled) {
            let redKills = 0, blueKills = 0;
            for (let id in players) {
                if (players[id].room !== roomName) continue;
                const k = rd.killCounts[id] || 0;
                if (players[id].team === 'red') redKills += k;
                else blueKills += k;
            }
            if (redKills >= rd.killGoal || blueKills >= rd.killGoal) {
                endMatch(roomName, redKills >= rd.killGoal ? 'red' : 'blue');
            }
        } else {
            for (let id in rd.killCounts) {
                if (rd.killCounts[id] >= rd.killGoal) {
                    endMatch(roomName, null, id);
                    break;
                }
            }
        }
    }
}

function endMatch(roomName, winTeam, winnerId) {
    const rd = roomData[roomName];
    if (!rd || rd.state === 'ended') return;
    rd.state = 'ended';
    if (rd.timerInterval) { clearInterval(rd.timerInterval); rd.timerInterval = null; }

    const finalScores = buildRoomLeaderboard(roomName);
    const winner = winnerId ? players[winnerId] : null;

    io.to(roomName).emit('matchEnd', {
        winTeam: winTeam || null,
        winnerId: winnerId || null,
        winnerName: winner ? winner.name : null,
        finalScores,
        mode: rd.mode
    });
}

function startMatch(roomName) {
    const rd = roomData[roomName];
    if (!rd || rd.state !== 'waiting') return false;
    rd.state = 'playing';
    // Reset kill counts for all current players
    rd.killCounts = {};
    rd.leaderboard = [];
    for (let id in players) {
        if (players[id].room !== roomName) continue;
        rd.killCounts[id] = 0;
        rd.leaderboard.push({ name: players[id].name, color: players[id].color, team: players[id].team, kills: 0 });
    }

    if (rd.mode === 'time') {
        rd.timeLeft = rd.duration;
        rd.timerInterval = setInterval(() => {
            rd.timeLeft = Math.max(0, rd.timeLeft - 1);
            io.to(roomName).emit('matchTimerUpdate', { timeLeft: rd.timeLeft });
            if (rd.timeLeft <= 0) {
                // Time up — find winner
                const scores = buildRoomLeaderboard(roomName);
                if (rd.teamsEnabled) {
                    let redKills = 0, blueKills = 0;
                    scores.forEach(s => { if (s.team === 'red') redKills += s.kills; else blueKills += s.kills; });
                    endMatch(roomName, redKills >= blueKills ? 'red' : 'blue');
                } else {
                    const top = scores[0];
                    const topId = Object.keys(players).find(id => players[id].room === roomName && players[id].name === top?.name);
                    endMatch(roomName, null, topId);
                }
            }
        }, 1000);
    }

    io.to(roomName).emit('matchStart', buildLobbyState(roomName));
    return true;
}

// ── HEALTH CHECK ──
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: Date.now() });
});

// ── SOCKET HANDLERS ──
io.on('connection', (socket) => {

    // LOGIN
    socket.on('login', async (data, callback) => {
        const { name, pin } = data;
        if (!name || !pin) return callback({ success: false, message: "Callsign and PIN required." });
        const callsignLower = name.toLowerCase();
        try {
            if (!usersCollection) return callback({ success: false, message: "Database booting up..." });
            const user = await usersCollection.findOne({ callsignLower });
            if (user) {
                if (user.pin === pin) { socket.playerName = user.callsign; callback({ success: true }); }
                else { callback({ success: false, message: "ACCESS DENIED: Incorrect PIN." }); }
            } else {
                await usersCollection.insertOne({ callsign: name, callsignLower, pin });
                socket.playerName = name; callback({ success: true });
            }
        } catch (err) { callback({ success: false, message: "Database error." }); }
    });

    // PUBLIC MATCH (join GLOBAL_PUBLIC)
    socket.on('joinGame', (data, callback) => {
        const roomName = 'GLOBAL_PUBLIC';
        _handleNameConflict(socket, roomName);
        _leaveCurrentRoom(socket);
        socket.join(roomName);
        players[socket.id] = {
            id: socket.id, room: roomName, name: socket.playerName,
            x: Math.random() * 8000 + 1000, y: Math.random() * 500 + 200,
            aimAngle: 0, color: data.color || "#e74c3c", health: 100, weapon: 'rifle', team: null
        };
        const playersInRoom = getPlayersInRoom(roomName);
        socket.broadcast.to(roomName).emit('newPlayer', { id: socket.id, player: players[socket.id] });
        
        // Send current leaderboard to the new player immediately
        const topPlayers = Object.values(publicScores).sort((a, b) => b.totalKills - a.totalKills).slice(0, 10);
        socket.emit('leaderboardUpdate', topPlayers);
        
        callback({ success: true, currentPlayers: playersInRoom });
    });

    // CREATE PRIVATE ROOM
    socket.on('createRoom', (data, callback) => {
        if (!socket.playerName) return callback({ success: false, message: "Not authenticated." });
        const roomCode = Math.random().toString(36).substring(2, 7).toUpperCase();
        initRoomData(roomCode, socket.id, {
            password: data.password || '',
            mode: data.mode || 'kills',
            killGoal: parseInt(data.killGoal) || 10,
            duration: parseInt(data.duration) || 180,
            teamsEnabled: data.teamsEnabled || false
        });
        _doJoinRoom(socket, roomCode, data.color, callback);
    });

    // JOIN PRIVATE ROOM
    socket.on('joinRoomRequest', (data, callback) => {
        if (!socket.playerName) return callback({ success: false, message: "Not authenticated." });
        const roomCode = (data.room || '').trim().toUpperCase();
        const rd = roomData[roomCode];
        if (!rd) return callback({ success: false, message: "Room not found. Check the code." });
        if (rd.password && rd.password !== (data.password || '')) return callback({ success: false, message: "Wrong room password." });
        if (rd.state === 'playing') return callback({ success: false, message: "Match already in progress." });
        if (rd.state === 'ended') return callback({ success: false, message: "Match has ended." });
        _doJoinRoom(socket, roomCode, data.color, callback);
    });

    // RESPAWN IN ROOM (called from death screen while match is live)
    socket.on('respawnInRoom', (data, callback) => {
        const roomCode = data.room;
        const rd = roomData[roomCode];
        if (!rd || rd.state !== 'playing') return callback && callback({ success: false });
        _leaveCurrentRoom(socket);
        socket.join(roomCode);
        players[socket.id] = {
            id: socket.id, room: roomCode, name: socket.playerName,
            x: Math.random() * 8000 + 1000, y: Math.random() * 500 + 200,
            aimAngle: 0, color: data.color || "#e74c3c", health: 100, weapon: 'rifle',
            team: data.team || null
        };
        const playersInRoom = getPlayersInRoom(roomCode);
        socket.broadcast.to(roomCode).emit('newPlayer', { id: socket.id, player: players[socket.id] });
        if (callback) callback({ success: true, currentPlayers: playersInRoom });
    });

    function _doJoinRoom(socket, roomCode, color, callback) {
        _handleNameConflict(socket, roomCode);
        _leaveCurrentRoom(socket);
        socket.join(roomCode);

        const rd = roomData[roomCode];
        let team = null;
        if (rd && rd.teamsEnabled) {
            const redCount = rd.teams.red.length;
            const blueCount = rd.teams.blue.length;
            team = redCount <= blueCount ? 'red' : 'blue';
            if (team === 'red') rd.teams.red.push(socket.id);
            else rd.teams.blue.push(socket.id);
        }

        players[socket.id] = {
            id: socket.id, room: roomCode, name: socket.playerName,
            x: Math.random() * 8000 + 1000, y: Math.random() * 500 + 200,
            aimAngle: 0, color: color || "#e74c3c", health: 100, weapon: 'rifle', team
        };

        if (rd) {
            rd.killCounts[socket.id] = 0;
            if (!rd.leaderboard.find(l => l.name === socket.playerName)) {
                rd.leaderboard.push({ name: socket.playerName, color: color || "#e74c3c", team, kills: 0 });
            }
        }

        const playersInRoom = getPlayersInRoom(roomCode);
        socket.broadcast.to(roomCode).emit('newPlayer', { id: socket.id, player: players[socket.id] });
        io.to(roomCode).emit('lobbyUpdate', buildLobbyState(roomCode));

        callback({
            success: true,
            currentPlayers: playersInRoom,
            roomCode,
            isHost: rd ? rd.host === socket.id : false,
            lobbyState: rd ? buildLobbyState(roomCode) : null
        });
    }

    function _handleNameConflict(socket, roomName) {
        for (let id in players) {
            if (id === socket.id) continue;
            if (players[id].room === roomName && players[id].name?.toLowerCase() === socket.playerName?.toLowerCase()) {
                io.to(id).emit('kicked', { reason: "Your callsign was logged in from another device." });
                io.sockets.sockets.get(id)?.leave(roomName);
                const rd = roomData[roomName];
                if (rd) {
                    rd.teams.red = rd.teams.red.filter(x => x !== id);
                    rd.teams.blue = rd.teams.blue.filter(x => x !== id);
                    rd.readyPlayers.delete(id);
                }
                delete players[id];
                socket.broadcast.to(roomName).emit('playerDisconnected', id);
            }
        }
    }

    function _leaveCurrentRoom(socket) {
        if (!players[socket.id]) return;
        const oldRoom = players[socket.id].room;
        socket.leave(oldRoom);
        socket.broadcast.to(oldRoom).emit('playerDisconnected', socket.id);
        const rd = roomData[oldRoom];
        if (rd) {
            rd.teams.red = rd.teams.red.filter(x => x !== socket.id);
            rd.teams.blue = rd.teams.blue.filter(x => x !== socket.id);
            rd.readyPlayers.delete(socket.id);
        }
        delete players[socket.id];
        cleanupRoom(oldRoom);
    }

    // PLAYER MOVEMENT
    socket.on('playerMovement', (data) => {
        let p = players[socket.id]; if (!p) return;
        p.x = data.x; p.y = data.y; p.aimAngle = data.aimAngle;
        p.color = data.color; p.health = data.health; p.weapon = data.weapon;
        socket.broadcast.to(p.room).emit('playerMoved', { id: socket.id, player: p });
    });

    // SHOOT
    socket.on('shoot', (data) => {
        let p = players[socket.id]; if (!p) return;
        socket.broadcast.to(p.room).emit('networkBullet', {
            x: data.x, y: data.y, vx: data.vx, vy: data.vy,
            radius: data.radius, ownerId: data.ownerId
        });
    });

    // BOMB EXPLODE — relay to room so others see explosion + take damage
    socket.on('bombExplode', (data) => {
        let p = players[socket.id]; if (!p) return;
        socket.broadcast.to(p.room).emit('networkBombExplode', {
            x: data.x, y: data.y,
            radius: data.radius,
            damage: data.damage,
            ownerId: data.ownerId
        });
    });

    // BOT DAMAGE (public only)
    socket.on('damageBot', (data) => {
        let p = players[socket.id];
        if (!p || p.room !== 'GLOBAL_PUBLIC') return;
        let bot = globalNPCs.find(b => b.id === data.botId);
        if (bot && bot.health > 0) {
            bot.health -= data.damage;
            if (bot.health <= 0) {
                io.to('GLOBAL_PUBLIC').emit('botDied', {
                    botId: bot.id, botName: bot.name,
                    killerId: socket.id, killerName: p.name,
                    x: bot.x, y: bot.y
                });
                setTimeout(() => { bot.respawn(); }, 3000);
            }
        }
    });

    // UPDATE SCORE (public leaderboard, legacy)
// UPDATE SCORE (public leaderboard)
    socket.on('updateScore', (data) => {
        if (!data.name) return;
        
        // Initialize player in the scores object if they don't exist
        if (!publicScores[data.name]) {
            publicScores[data.name] = { name: data.name, totalKills: 0, bestStreak: 0 };
        }

        const prev = socket._lastKills ?? 0;
        const curr = data.kills ?? 0;

        // Detect new life: kills went backwards = died and respawned with reset counter
        if (curr < prev) {
            // Lock in best single-life streak from the life that just ended
            if (prev > publicScores[data.name].bestStreak) {
                publicScores[data.name].bestStreak = prev;
            }
            socket._lastKills = 0;
        }

        // Add only the NEW kills since last update (delta), never overwrite total
        const delta = Math.max(0, curr - (socket._lastKills ?? 0));
        socket._lastKills = curr;
        publicScores[data.name].totalKills += delta;

        // Also update bestStreak if current life is already higher
        if (curr > publicScores[data.name].bestStreak) {
            publicScores[data.name].bestStreak = curr;
        }

        // Sort the top 10 players by total kills
        const topPlayers = Object.values(publicScores)
            .sort((a, b) => b.totalKills - a.totalKills)
            .slice(0, 10);

        // Broadcast the updated leaderboard to everyone in the public lobby
        io.to('GLOBAL_PUBLIC').emit('leaderboardUpdate', topPlayers);
    });

    // ── ROOM MATCH EVENTS ──

    // Toggle ready status
    socket.on('setReady', (isReady) => {
        const p = players[socket.id]; if (!p) return;
        const rd = roomData[p.room]; if (!rd) return;
        if (isReady) rd.readyPlayers.add(socket.id);
        else rd.readyPlayers.delete(socket.id);
        io.to(p.room).emit('lobbyUpdate', buildLobbyState(p.room));
    });

    // Host starts match
    socket.on('startMatch', (callback) => {
        const p = players[socket.id]; if (!p) return;
        const rd = roomData[p.room];
        if (!rd) return callback && callback({ success: false, message: "No room data." });
        if (rd.host !== socket.id) return callback && callback({ success: false, message: "Only the host can start." });

        const roomPlayerIds = Object.keys(getPlayersInRoom(p.room));
        const nonHostIds = roomPlayerIds.filter(id => id !== socket.id);
        const allReady = nonHostIds.every(id => rd.readyPlayers.has(id));
        if (!allReady) return callback && callback({ success: false, message: "Waiting for all players to ready up." });

        const ok = startMatch(p.room);
        if (callback) callback({ success: ok, message: ok ? undefined : "Could not start match." });
    });

    // Kick a player (host only)
    socket.on('kickPlayer', (targetId) => {
        const p = players[socket.id]; if (!p) return;
        const rd = roomData[p.room];
        if (!rd || rd.host !== socket.id) return;
        if (!players[targetId] || players[targetId].room !== p.room) return;
        io.to(targetId).emit('kicked', { reason: "You were removed from the room by the host." });
        const targetSock = io.sockets.sockets.get(targetId);
        if (targetSock) targetSock.leave(p.room);
        rd.teams.red = rd.teams.red.filter(x => x !== targetId);
        rd.teams.blue = rd.teams.blue.filter(x => x !== targetId);
        rd.readyPlayers.delete(targetId);
        delete players[targetId];
        socket.broadcast.to(p.room).emit('playerDisconnected', targetId);
        io.to(p.room).emit('lobbyUpdate', buildLobbyState(p.room));
    });

    // Report a kill in a room match
    socket.on('reportKill', (data) => {
        const p = players[socket.id]; if (!p) return;
        const rd = roomData[p.room]; if (!rd || rd.state !== 'playing') return;
        rd.killCounts[socket.id] = (rd.killCounts[socket.id] || 0) + 1;
        // Update leaderboard entry
        const lb = rd.leaderboard.find(l => l.name === p.name);
        if (lb) lb.kills = rd.killCounts[socket.id];
        rd.leaderboard.sort((a, b) => b.kills - a.kills);
        io.to(p.room).emit('roomLeaderboardUpdate', buildRoomLeaderboard(p.room));
        checkWinCondition(p.room);
    });

    // DISCONNECT
    socket.on('disconnect', () => {
        const p = players[socket.id]; if (!p) return;
        const oldRoom = p.room;
        const rd = roomData[oldRoom];
        socket.broadcast.to(oldRoom).emit('playerDisconnected', socket.id);
        if (rd) {
            rd.teams.red = rd.teams.red.filter(x => x !== socket.id);
            rd.teams.blue = rd.teams.blue.filter(x => x !== socket.id);
            rd.readyPlayers.delete(socket.id);
            // Transfer host if needed
            if (rd.host === socket.id && rd.state === 'waiting') {
                const remaining = Object.keys(players).filter(id => id !== socket.id && players[id].room === oldRoom);
                if (remaining.length > 0) {
                    rd.host = remaining[0];
                    io.to(oldRoom).emit('hostChanged', { newHostId: rd.host, newHostName: players[remaining[0]]?.name });
                }
            }
            io.to(oldRoom).emit('lobbyUpdate', buildLobbyState(oldRoom));
        }
        delete players[socket.id];
        cleanupRoom(oldRoom);
    });
});

http.listen(PORT, '0.0.0.0', () => { console.log(`🚀 BaylerBay Ops server on port ${PORT}`); });
