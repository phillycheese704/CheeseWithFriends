const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcryptjs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const db = new sqlite3.Database("./users.db");

/* =========================
   DATABASE
========================= */

db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS bans (
            username_lower TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            until INTEGER,
            reason TEXT
        )
    `);
});

/* =========================
   OWNER / ADMIN
========================= */

const OWNER_USERNAME = "PhillyCheese#;";
const OWNER_PASSWORD = "AdminAccount##;";

function getDisplayName(username) {
    if (String(username || "") === OWNER_USERNAME) {
        return "PhillyCheese";
    }

    return username;
}

function isAdminUsername(username) {
    return String(username || "") === OWNER_USERNAME;
}

/* =========================
   ROOMS
========================= */

const rooms = {
    cheeseLounge: {
        id: "cheeseLounge",
        name: "Cheese Lounge",
        icon: "🧀",
        theme: "cheese",
        filter: "strict",
        readOnly: false
    },

    butter: {
        id: "butter",
        name: "Butter",
        icon: "🧈",
        theme: "butter",
        filter: "mild",
        readOnly: false
    },

    blueCheese: {
        id: "blueCheese",
        name: "Blue Cheese",
        icon: "🧀",
        theme: "blue",
        filter: "chaos",
        readOnly: false
    },

    updateLog: {
        id: "updateLog",
        name: "Update Log",
        icon: "📢",
        theme: "cheese",
        filter: "strict",
        readOnly: true
    }
};

const roomHistory = {
    cheeseLounge: [],
    butter: [],
    blueCheese: [],
    updateLog: [
        {
            id: "update-001",
            room: "updateLog",
            username: "CheeseWithFriends",
            text: "🧀 Version 0.8.2 — Fixed admin panel buttons, improved chaos meter drain, and patched visual drift.",
            time: "Update",
            replyTo: null,
            reactions: {}
        },
        {
            id: "update-002",
            room: "updateLog",
            username: "CheeseWithFriends",
            text: "Admin login is virtual. The owner appears publicly as PhillyCheese.",
            time: "Update",
            replyTo: null,
            reactions: {}
        }
    ]
};

const MAX_HISTORY = 80;

/* =========================
   LIVE STATE
========================= */

const loginTokens = new Map();
const onlineUsers = {};
const userMessageMemory = {};
const mutedUsers = new Map();

const roomFiltersEnabled = {
    cheeseLounge: true,
    butter: true,
    blueCheese: false,
    updateLog: true
};

let chaosLevel = 0;
let visualNameOverride = null;

let messageCounter = 1;
let scheduledEventCounter = 1;
const scheduledEvents = {};

function makeMessageId() {
    messageCounter++;
    return `msg-${Date.now()}-${messageCounter}`;
}

function makeToken() {
    return crypto.randomBytes(24).toString("hex");
}

function getRoomIdFromName(name) {
    const clean = String(name || "").trim().toLowerCase();

    if (rooms[clean]) return clean;

    for (const room of Object.values(rooms)) {
        if (room.name.toLowerCase() === clean) {
            return room.id;
        }
    }

    if (clean === "cheese") return "cheeseLounge";
    if (clean === "lounge") return "cheeseLounge";
    if (clean === "blue") return "blueCheese";
    if (clean === "updates") return "updateLog";

    return null;
}

function getOnlineUsers() {
    return Object.values(onlineUsers)
        .filter(user => !user.hidden)
        .map(user => ({
            username: visualNameOverride || user.displayName,
            realName: user.displayName,
            room: user.room,
            admin: isAdminUsername(user.rawUsername)
        }));
}

function broadcastOnlineUsers() {
    io.emit("online users", getOnlineUsers());
}

function getAdminSockets() {
    return [...io.sockets.sockets.values()]
        .filter(socket => isAdminUsername(socket.rawUsername));
}

function broadcastAdminState() {
    getAdminSockets().forEach(socket => {
        socket.emit("admin state", {
            chaosLevel,
            visualNameOverride,
            scheduledEvents: Object.values(scheduledEvents),
            roomFiltersEnabled
        });
    });
}

function getPublicScheduledEvents() {
    return Object.values(scheduledEvents).map(event => ({
        id: event.id,
        commandText: event.commandText,
        runAt: event.runAt
    }));
}

function broadcastScheduleState() {
    io.emit("schedule state", getPublicScheduledEvents());
}

function addChaos(amount) {
    chaosLevel = Math.min(100, chaosLevel + amount);

    io.emit("chaos level", chaosLevel);
    broadcastAdminState();
}

/*
   Chaos slowly cools down when nothing is happening.
   This fixes the meter staying high forever.
*/
setInterval(() => {
    if (chaosLevel > 0) {
        chaosLevel = Math.max(0, chaosLevel - 1);
        io.emit("chaos level", chaosLevel);
        broadcastAdminState();
    }
}, 3000);

function publicMessage(message) {
    const reactions = {};

    for (const emoji in message.reactions || {}) {
        reactions[emoji] = message.reactions[emoji].length;
    }

    return {
        id: message.id,
        room: message.room,
        username: visualNameOverride || message.username,
        realUsername: message.username,
        text: message.text,
        time: message.time,
        replyTo: message.replyTo,
        reactions
    };
}

function addToHistory(message) {
    if (!roomHistory[message.room]) {
        roomHistory[message.room] = [];
    }

    roomHistory[message.room].push(message);

    if (roomHistory[message.room].length > MAX_HISTORY) {
        roomHistory[message.room].shift();
    }
}

/* =========================
   TEXT NORMALIZATION
========================= */

function cleanUsername(username) {
    return String(username || "")
        .trim()
        .replace(/\s+/g, " ");
}

function normalizeText(text) {
    return String(text || "")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[\u200B-\u200D\uFEFF]/g, "")
        .toLowerCase();
}

function leetNormalize(text) {
    return normalizeText(text)
        .replace(/0/g, "o")
        .replace(/1/g, "i")
        .replace(/!/g, "i")
        .replace(/\|/g, "i")
        .replace(/ı/g, "i")
        .replace(/l/g, "i")
        .replace(/3/g, "e")
        .replace(/€/g, "e")
        .replace(/4/g, "a")
        .replace(/@/g, "a")
        .replace(/5/g, "s")
        .replace(/\$/g, "s")
        .replace(/7/g, "t")
        .replace(/\+/g, "t")
        .replace(/8/g, "b")
        .replace(/9/g, "g")
        .replace(/\(/g, "c")
        .replace(/\{/g, "c")
        .replace(/\[/g, "c")
        .replace(/\)/g, "o");
}

function compactText(text) {
    return leetNormalize(text)
        .replace(/[^a-z0-9]/g, "")
        .replace(/(.)\1+/g, "$1");
}

function compactTextKeepRepeats(text) {
    return leetNormalize(text).replace(/[^a-z0-9]/g, "");
}

/* =========================
   FILTER LISTS
========================= */

const SWEAR_TERMS = [
    "fuck", "fuk", "fck", "shit", "shite", "bitch", "btch",
    "asshole", "arsehole", "bastard", "dick", "dickhead",
    "cock", "piss", "crap", "damn", "slut", "whore", "hoe",
    "cunt", "twat", "wanker", "prick", "tosser", "bollocks",
    "bugger", "motherfucker"
];

const SLUR_TERMS = [
    "nigga", "nigger", "niga", "niger", "chink", "spic",
    "kike", "fag", "faggot", "tranny", "retard", "coon",
    "gook", "wetback", "beaner"
];

const UNSAFE_TERMS = [
    "porn", "nude", "nudes", "nsfw", "scam", "phishing",
    "hacksite"
];

const STRICT_BLOCKED_TERMS = [
    ...SWEAR_TERMS,
    ...SLUR_TERMS,
    ...UNSAFE_TERMS,
    "spam"
];

const MILD_BLOCKED_TERMS = [
    ...SLUR_TERMS,
    "scam",
    "phishing",
    "hacksite"
];

const HARD_BLOCKED_COMPACTS = [
    "fuck", "fuk", "fck", "shit", "shite", "bitch", "btch",
    "cunt", "niga", "niger", "chink", "spic", "kike", "fag",
    "fagot", "trany", "retard", "coon", "gook", "wetback",
    "beaner"
];

const TRUSTED_LINK_DOMAINS = [
    "youtube.com",
    "youtu.be",
    "tiktok.com",
    "discord.gg",
    "discord.com",
    "twitch.tv",
    "spotify.com"
];

const SHOPPING_LINK_DOMAINS = [
    "amazon.",
    "ebay.",
    "temu.",
    "shein.",
    "aliexpress.",
    "etsy.",
    "shopify.",
    "walmart.",
    "target.",
    "bestbuy."
];

const BLOCKED_USERNAME_TERMS = [
    "admin", "owner", "moderator", "mod", "system", "server",
    "staff", "support", "official", "null", "undefined"
];

const RESERVED_EXACT_USERNAMES = [
    "admin", "owner", "moderator", "mod", "system", "server",
    "staff", "support", "cheesewithfriends", "cheese with friends",
    "cheese lounge", "blue cheese", "butter", "update log"
];

function containsBlockedTerm(message, terms) {
    const normalized = normalizeText(message);
    const leeted = leetNormalize(message);
    const compact = compactText(message);
    const compactRepeats = compactTextKeepRepeats(message);

    for (const term of terms) {
        if (
            normalized.includes(normalizeText(term)) ||
            leeted.includes(leetNormalize(term)) ||
            compact.includes(compactText(term)) ||
            compactRepeats.includes(compactTextKeepRepeats(term))
        ) {
            return true;
        }
    }

    return false;
}

function hasLink(text) {
    return /(https?:\/\/|www\.|[a-z0-9-]+\.(com|net|org|gg|co|io|dev|app))/i.test(text);
}

function isTrustedButterLink(text) {
    const lower = text.toLowerCase();

    for (const bad of SHOPPING_LINK_DOMAINS) {
        if (lower.includes(bad)) {
            return false;
        }
    }

    for (const trusted of TRUSTED_LINK_DOMAINS) {
        if (lower.includes(trusted)) {
            return true;
        }
    }

    return !hasLink(text);
}

function checkUsername(username) {
    const cleaned = cleanUsername(username);
    const normalized = normalizeText(cleaned);
    const compact = compactText(cleaned);

    if (!cleaned) return "Enter a username.";
    if (cleaned.length < 3) return "Username must be at least 3 characters.";
    if (cleaned.length > 24) return "Username must be 24 characters or less.";

    if (
        cleaned.toLowerCase() === "phillycheese" ||
        cleaned.toLowerCase() === OWNER_USERNAME.toLowerCase()
    ) {
        return "That username is reserved for the owner.";
    }

    if (/[#;]/.test(cleaned)) {
        return "Only the owner username can use # or ;.";
    }

    if (/[\u200B-\u200D\uFEFF]/.test(username)) {
        return "Username cannot use invisible characters.";
    }

    if (!/^[a-zA-Z0-9_ -]+$/.test(cleaned)) {
        return "Username can only use letters, numbers, spaces, hyphens, and underscores.";
    }

    if (/(.)\1{4,}/i.test(cleaned)) {
        return "Username has too many repeated characters.";
    }

    if (/^\d+$/.test(cleaned)) {
        return "Username cannot be only numbers.";
    }

    if (RESERVED_EXACT_USERNAMES.includes(normalized)) {
        return "That username is reserved.";
    }

    for (const term of BLOCKED_USERNAME_TERMS) {
        if (
            normalized.includes(normalizeText(term)) ||
            compact.includes(compactText(term))
        ) {
            return "That username is not allowed.";
        }
    }

    return null;
}

function checkMessage(text, roomId, socketId, rawUsername) {
    const message = String(text || "").trim();

    if (!message) return { ok: false, message: "Message is empty." };
    if (message.length > 100) return { ok: false, message: "Messages can only be 100 characters." };
    if (/[\u200B-\u200D\uFEFF]/.test(message)) return { ok: false, message: "Message contains invisible characters." };

    const mute = mutedUsers.get(String(rawUsername || "").toLowerCase());

    if (mute) {
        if (Date.now() < mute.until) {
            return {
                ok: false,
                message: `You are muted. Reason: ${mute.reason}`
            };
        }

        mutedUsers.delete(String(rawUsername || "").toLowerCase());
    }

    const now = Date.now();

    if (!userMessageMemory[socketId]) {
        userMessageMemory[socketId] = {
            lastMessage: "",
            lastTime: 0,
            repeatCount: 0
        };
    }

    const memory = userMessageMemory[socketId];

    if (now - memory.lastTime < 650) {
        return { ok: false, message: "Slow down a little." };
    }

    if (message === memory.lastMessage) {
        memory.repeatCount++;

        if (memory.repeatCount >= 2) {
            return { ok: false, message: "Stop repeating the same message." };
        }
    } else {
        memory.repeatCount = 0;
    }

    memory.lastMessage = message;
    memory.lastTime = now;

    const room = rooms[roomId] || rooms.cheeseLounge;

    if (room.filter === "chaos" || roomFiltersEnabled[roomId] === false) {
        return { ok: true, text: message };
    }

    if (room.filter === "strict") {
        const blockedPatterns = [
            /https?:\/\//i,
            /www\./i,
            /\.com/i,
            /\.net/i,
            /\.org/i,
            /\.gg/i,
            /discord\.gg/i,
            /discord\.com\/invite/i,
            /@everyone/i,
            /@here/i,
            /(?:.)\1{14,}/i
        ];

        for (const pattern of blockedPatterns) {
            if (pattern.test(message)) {
                return { ok: false, message: "Cheese Lounge filter blocked that message." };
            }
        }

        if (
            containsBlockedTerm(message, STRICT_BLOCKED_TERMS) ||
            containsBlockedTerm(message, HARD_BLOCKED_COMPACTS)
        ) {
            return { ok: false, message: "Cheese Lounge filter blocked that message." };
        }
    }

    if (room.filter === "mild") {
        if (!isTrustedButterLink(message)) {
            return { ok: false, message: "Butter only allows trusted links." };
        }

        if (
            containsBlockedTerm(message, MILD_BLOCKED_TERMS) ||
            containsBlockedTerm(message, SLUR_TERMS)
        ) {
            return { ok: false, message: "Butter filter blocked that message." };
        }
    }

    return { ok: true, text: message };
}

/* =========================
   BANS
========================= */

function checkBan(username, callback) {
    if (isAdminUsername(username)) {
        callback(null);
        return;
    }

    const lower = String(username || "").toLowerCase();

    db.get(
        "SELECT * FROM bans WHERE username_lower = ?",
        [lower],
        (err, ban) => {
            if (err || !ban) {
                callback(null);
                return;
            }

            if (ban.type === "permanent") {
                callback({
                    banned: true,
                    reason: ban.reason || "No reason provided."
                });
                return;
            }

            if (ban.type === "temporary") {
                if (Date.now() < Number(ban.until || 0)) {
                    callback({
                        banned: true,
                        reason: ban.reason || "No reason provided."
                    });
                    return;
                }

                db.run(
                    "DELETE FROM bans WHERE username_lower = ?",
                    [lower],
                    () => callback(null)
                );

                return;
            }

            callback(null);
        }
    );
}

function setPermanentBan(username, reason, callback) {
    db.run(
        `
        INSERT OR REPLACE INTO bans (username_lower, type, until, reason)
        VALUES (?, ?, ?, ?)
        `,
        [
            String(username || "").toLowerCase(),
            "permanent",
            null,
            reason || "No reason provided."
        ],
        callback
    );
}

function setTemporaryBan(username, durationMs, reason, callback) {
    db.run(
        `
        INSERT OR REPLACE INTO bans (username_lower, type, until, reason)
        VALUES (?, ?, ?, ?)
        `,
        [
            String(username || "").toLowerCase(),
            "temporary",
            Date.now() + durationMs,
            reason || "No reason provided."
        ],
        callback
    );
}

/* =========================
   AUTH
========================= */

app.post("/signup", async (req, res) => {
    let { username, password } = req.body;

    username = cleanUsername(username);
    password = String(password || "");

    if (!username || !password) {
        return res.json({
            success: false,
            message: "Enter a username and password."
        });
    }

    const usernameIssue = checkUsername(username);

    if (usernameIssue) {
        return res.json({
            success: false,
            message: usernameIssue
        });
    }

    if (password.length < 4) {
        return res.json({
            success: false,
            message: "Password must be at least 4 characters."
        });
    }

    db.get(
        "SELECT * FROM users WHERE LOWER(username) = LOWER(?)",
        [username],
        async (err, row) => {
            if (err) {
                return res.json({
                    success: false,
                    message: "Database error."
                });
            }

            if (row) {
                return res.json({
                    success: false,
                    message: "That username is already taken."
                });
            }

            const hashedPassword = await bcrypt.hash(password, 10);

            db.run(
                "INSERT INTO users (username, password) VALUES (?, ?)",
                [username, hashedPassword],
                err => {
                    if (err) {
                        return res.json({
                            success: false,
                            message: "Could not create account."
                        });
                    }

                    return res.json({
                        success: true,
                        message: "Account created."
                    });
                }
            );
        }
    );
});

app.post("/login", (req, res) => {
    let { username, password } = req.body;

    username = cleanUsername(username);
    password = String(password || "");

    if (!username || !password) {
        return res.json({
            success: false,
            message: "Enter a username and password."
        });
    }

    if (username === OWNER_USERNAME) {
        if (password !== OWNER_PASSWORD) {
            return res.json({
                success: false,
                message: "Invalid username or password."
            });
        }

        const token = makeToken();

        loginTokens.set(token, {
            rawUsername: OWNER_USERNAME,
            displayName: getDisplayName(OWNER_USERNAME),
            admin: true
        });

        return res.json({
            success: true,
            token,
            username: getDisplayName(OWNER_USERNAME),
            admin: true
        });
    }

    if (username.toLowerCase() === OWNER_USERNAME.toLowerCase()) {
        return res.json({
            success: false,
            message: "Invalid username or password."
        });
    }

    db.get(
        "SELECT * FROM users WHERE LOWER(username) = LOWER(?)",
        [username],
        async (err, user) => {
            if (err || !user) {
                return res.json({
                    success: false,
                    message: "Invalid username or password."
                });
            }

            checkBan(user.username, async ban => {
                if (ban) {
                    return res.json({
                        success: false,
                        message: `This account is banned. Reason: ${ban.reason}`
                    });
                }

                let validPassword = false;

                if (
                    user.password.startsWith("$2a$") ||
                    user.password.startsWith("$2b$")
                ) {
                    validPassword = await bcrypt.compare(password, user.password);
                } else {
                    validPassword = password === user.password;
                }

                if (!validPassword) {
                    return res.json({
                        success: false,
                        message: "Invalid username or password."
                    });
                }

                const token = makeToken();

                loginTokens.set(token, {
                    rawUsername: user.username,
                    displayName: getDisplayName(user.username),
                    admin: false
                });

                return res.json({
                    success: true,
                    token,
                    username: getDisplayName(user.username),
                    admin: false
                });
            });
        }
    );
});

/* =========================
   ADMIN COMMANDS
========================= */

function parseAngleArgs(text) {
    const args = [];
    const regex = /<([^>]*)>/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
        args.push(match[1].trim());
    }

    return args;
}

function parseDuration(text) {
    const raw = String(text || "").trim().toLowerCase();

    if (/^\d+$/.test(raw)) {
        return Number(raw) * 60 * 1000;
    }

    const match = raw.match(/^(\d+)(s|m|h|d)$/);

    if (!match) {
        return 10 * 60 * 1000;
    }

    const number = Number(match[1]);
    const unit = match[2];

    if (unit === "s") return number * 1000;
    if (unit === "m") return number * 60 * 1000;
    if (unit === "h") return number * 60 * 60 * 1000;
    if (unit === "d") return number * 24 * 60 * 60 * 1000;

    return 10 * 60 * 1000;
}

function findUserSocketByName(name) {
    const target = String(name || "").trim().toLowerCase();

    for (const socket of io.sockets.sockets.values()) {
        if (!socket.rawUsername) continue;

        const raw = socket.rawUsername.toLowerCase();
        const display = getDisplayName(socket.rawUsername).toLowerCase();

        if (raw === target || display === target) {
            return socket;
        }
    }

    return null;
}

function adminReply(socket, text) {
    socket.emit("admin reply", text);
}

function runChaosEvent(eventName, payload = {}) {
    const key = String(eventName || "")
        .replace(/\s+/g, "")
        .toLowerCase();

    const map = {
        cheeserain: "cheeseRain",
        cheesestorm: "cheeseStorm",
        singularicheese: "singularicheese",
        mouserun: "mouseRun",
        meltui: "meltUI",
        butterflood: "butterFlood",
        butterbomb: "butterBomb",
        clearvisuals: "clearVisuals"
    };

    const eventType = map[key];

    if (!eventType) return false;

    const chaosAmounts = {
        cheeseRain: 8,
        cheeseStorm: 22,
        singularicheese: 40,
        mouseRun: 12,
        meltUI: 22,
        butterFlood: 20,
        butterBomb: 14,
        clearVisuals: 0
    };

    io.emit("chaos event", {
        type: eventType,
        payload
    });

    addChaos(chaosAmounts[eventType] || 5);

    return true;
}

function executeAdminCommand(socket, input) {
    if (!isAdminUsername(socket.rawUsername)) {
        socket.emit("admin reply", "You are not admin.");
        return;
    }

    const text = String(input || "").trim();

    if (!text) return;

    if (text.startsWith(";/")) {
        const match = text.match(/^;\/([^:]+)(?::\s*(.*))?$/);

        if (!match) {
            return adminReply(socket, "Invalid command format.");
        }

        const command = match[1].trim().toLowerCase();
        const args = parseAngleArgs(match[2] || "");

        if (command === "warning") {
            const target = findUserSocketByName(args[0]);
            const warning = args[1] || "You have received a warning.";

            if (!target) return adminReply(socket, "User not found.");

            target.emit("admin warning", warning);

            return adminReply(socket, `Warning sent to ${args[0]}.`);
        }

        if (command === "ban") {
            const target = findUserSocketByName(args[0]);
            const reason = args[1] || "No reason provided.";

            if (!target) return adminReply(socket, "User not found.");
            if (isAdminUsername(target.rawUsername)) return adminReply(socket, "You cannot ban the owner.");

            setPermanentBan(target.rawUsername, reason, () => {
                target.emit("banned", { reason });
                target.disconnect(true);

                adminReply(socket, `${args[0]} was permanently banned.`);
            });

            return;
        }

        if (command === "tempban") {
            const target = findUserSocketByName(args[0]);
            const duration = parseDuration(args[1]);
            const reason = args[2] || "No reason provided.";

            if (!target) return adminReply(socket, "User not found.");
            if (isAdminUsername(target.rawUsername)) return adminReply(socket, "You cannot ban the owner.");

            setTemporaryBan(target.rawUsername, duration, reason, () => {
                target.emit("banned", {
                    reason: `Temporary ban: ${reason}`
                });

                target.disconnect(true);

                adminReply(socket, `${args[0]} was temporarily banned.`);
            });

            return;
        }

        if (command === "mute") {
            const target = findUserSocketByName(args[0]);
            const duration = parseDuration(args[1]);
            const reason = args[2] || "No reason provided.";

            if (!target) return adminReply(socket, "User not found.");
            if (isAdminUsername(target.rawUsername)) return adminReply(socket, "You cannot mute the owner.");

            mutedUsers.set(target.rawUsername.toLowerCase(), {
                until: Date.now() + duration,
                reason
            });

            target.emit("admin warning", `You were muted. Reason: ${reason}`);

            return adminReply(socket, `${args[0]} was muted.`);
        }

        if (command === "offline") {
            const user = onlineUsers[socket.id];

            if (!user) return;

            user.hidden = !user.hidden;

            broadcastOnlineUsers();

            return adminReply(
                socket,
                user.hidden
                    ? "You now appear offline."
                    : "You now appear online."
            );
        }

        if (command === "announcement") {
            const message = args[0] || "Announcement.";

            io.emit("admin announcement", message);

            return adminReply(socket, "Announcement sent.");
        }

        return adminReply(socket, "Unknown admin command.");
    }

    if (text.startsWith("+/") && text.endsWith("\\")) {
        const inside = text.slice(2, -1).trim();
        const match = inside.match(/^([^:]+)(?::\s*(.*))?$/);

        const command = match
            ? match[1].trim().toLowerCase()
            : inside.toLowerCase();

        const commandKey = command.replace(/\s+/g, "");
        const args = parseAngleArgs(match && match[2] ? match[2] : "");

        if (commandKey === "filter") {
            const roomId = getRoomIdFromName(args[0]);
            const mode = String(args[1] || "").toLowerCase();

            if (!roomId) return adminReply(socket, "Room not found.");

            if (mode === "on") {
                roomFiltersEnabled[roomId] = true;
            } else if (mode === "off") {
                roomFiltersEnabled[roomId] = false;
            } else {
                return adminReply(socket, "Use +/Filter: <Room>, <On/Off>\\");
            }

            broadcastAdminState();

            return adminReply(socket, `${rooms[roomId].name} filter is now ${mode}.`);
        }

        if (commandKey === "setname") {
            visualNameOverride = args[0] || null;

            io.emit("visual name override", visualNameOverride);
            broadcastOnlineUsers();
            broadcastAdminState();

            return adminReply(
                socket,
                visualNameOverride
                    ? `All names now look like ${visualNameOverride}.`
                    : "Name override cleared."
            );
        }

        const ok = runChaosEvent(commandKey);

        if (ok) {
            return adminReply(socket, `${command} triggered.`);
        }

        return adminReply(socket, "Unknown fun command.");
    }

    adminReply(socket, "Unknown command format.");
}

function scheduleAdminEvent(socket, commandText, delaySeconds) {
    if (!isAdminUsername(socket.rawUsername)) return;

    const id = `event-${scheduledEventCounter++}`;
    const delay = Math.max(1, Math.min(3600, Number(delaySeconds) || 10));

    scheduledEvents[id] = {
        id,
        commandText,
        delay,
        runAt: Date.now() + delay * 1000
    };

    broadcastAdminState();
    broadcastScheduleState();

    setTimeout(() => {
        if (!scheduledEvents[id]) return;

        executeAdminCommand(socket, commandText);

        delete scheduledEvents[id];

        broadcastAdminState();
        broadcastScheduleState();
    }, delay * 1000);
}

/* =========================
   SOCKETS
========================= */

io.on("connection", socket => {
    socket.on("user joined", data => {
        const tokenData = loginTokens.get(data.token);

        if (!tokenData) {
            socket.emit("force logout", "Login expired. Please log in again.");
            return;
        }

        const rawUsername = tokenData.rawUsername;
        const room = rooms[data.room] ? data.room : "cheeseLounge";

        socket.rawUsername = rawUsername;
        socket.displayName = tokenData.displayName;
        socket.room = room;

        onlineUsers[socket.id] = {
            rawUsername,
            displayName: tokenData.displayName,
            room,
            hidden: false
        };

        socket.join(room);

        socket.emit("admin status", {
            admin: isAdminUsername(rawUsername)
        });

        socket.emit("room data", {
            room,
            roomInfo: rooms[room],
            messages: roomHistory[room].map(publicMessage),
            readOnly: rooms[room].readOnly
        });

        socket.emit("schedule state", getPublicScheduledEvents());

        if (isAdminUsername(rawUsername)) {
            socket.emit("admin state", {
                chaosLevel,
                visualNameOverride,
                scheduledEvents: Object.values(scheduledEvents),
                roomFiltersEnabled
            });
        }

        broadcastOnlineUsers();

        io.to(room).emit("system message", {
            room,
            text: `${visualNameOverride || tokenData.displayName} joined ${rooms[room].name}.`
        });
    });

    socket.on("switch room", roomId => {
        if (!socket.rawUsername) return;
        if (!rooms[roomId]) return;

        const oldRoom = socket.room || "cheeseLounge";

        socket.leave(oldRoom);

        socket.room = roomId;

        if (onlineUsers[socket.id]) {
            onlineUsers[socket.id].room = roomId;
        }

        socket.join(roomId);

        socket.emit("room data", {
            room: roomId,
            roomInfo: rooms[roomId],
            messages: roomHistory[roomId].map(publicMessage),
            readOnly: rooms[roomId].readOnly
        });

        broadcastOnlineUsers();

        io.to(roomId).emit("system message", {
            room: roomId,
            text: `${visualNameOverride || socket.displayName} entered ${rooms[roomId].name}.`
        });
    });

    socket.on("chat message", data => {
        if (!socket.rawUsername) return;

        const room =
            rooms[data.room]
                ? data.room
                : socket.room || "cheeseLounge";

        if (rooms[room].readOnly) {
            socket.emit("message rejected", "This room is read-only.");
            return;
        }

        const text = String(data.text || "").trim();

        if (
            isAdminUsername(socket.rawUsername) &&
            (text.startsWith(";/") || text.startsWith("+/"))
        ) {
            executeAdminCommand(socket, text);
            return;
        }

        const result = checkMessage(
            text,
            room,
            socket.id,
            socket.rawUsername
        );

        if (!result.ok) {
            socket.emit("message rejected", result.message);
            return;
        }

        const replyTo = data.replyTo || null;

        const message = {
            id: makeMessageId(),
            room,
            username: socket.displayName,
            text: result.text,
            time: new Date().toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit"
            }),
            replyTo,
            reactions: {}
        };

        addToHistory(message);

        io.to(room).emit("chat message", publicMessage(message));
    });

    socket.on("react message", data => {
        if (!socket.rawUsername) return;

        const room = rooms[data.room] ? data.room : socket.room;
        const messageId = data.messageId;
        const emoji = String(data.emoji || "");

        const allowed = ["🧀", "😂", "💀", "❤️", "👍", "🐭"];

        if (!allowed.includes(emoji)) return;

        const message = roomHistory[room].find(msg => msg.id === messageId);

        if (!message) return;

        if (!message.reactions[emoji]) {
            message.reactions[emoji] = [];
        }

        const reactor = socket.rawUsername;
        const index = message.reactions[emoji].indexOf(reactor);

        if (index >= 0) {
            message.reactions[emoji].splice(index, 1);
        } else {
            message.reactions[emoji].push(reactor);
        }

        io.to(room).emit("reaction update", {
            room,
            messageId,
            reactions: publicMessage(message).reactions
        });
    });

    socket.on("typing", data => {
        if (!socket.rawUsername) return;

        const current = onlineUsers[socket.id];

        if (current && current.hidden) return;

        const room =
            rooms[data.room]
                ? data.room
                : socket.room || "cheeseLounge";

        socket.to(room).emit("typing", {
            username: visualNameOverride || socket.displayName,
            room
        });
    });

    socket.on("stop typing", data => {
        if (!socket.rawUsername) return;

        const room =
            rooms[data.room]
                ? data.room
                : socket.room || "cheeseLounge";

        socket.to(room).emit("stop typing", {
            username: visualNameOverride || socket.displayName,
            room
        });
    });

    socket.on("admin command", command => {
        executeAdminCommand(socket, command);
    });

    socket.on("schedule event", data => {
        scheduleAdminEvent(socket, data.commandText, data.delaySeconds);
    });

    socket.on("cancel scheduled event", id => {
        if (!isAdminUsername(socket.rawUsername)) return;

        delete scheduledEvents[id];

        broadcastAdminState();
        broadcastScheduleState();
    });

    socket.on("disconnect", () => {
        const user = onlineUsers[socket.id];

        delete onlineUsers[socket.id];
        delete userMessageMemory[socket.id];

        broadcastOnlineUsers();

        if (user && !user.hidden) {
            io.to(user.room).emit("system message", {
                room: user.room,
                text: `${visualNameOverride || user.displayName} left.`
            });
        }
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});