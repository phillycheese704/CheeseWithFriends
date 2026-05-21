const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

const ADMIN_LOGIN_USERNAME = "PhillyCheese#;";
const ADMIN_DISPLAY_NAME = "PhillyCheese";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "AdminAccount##;";

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}

if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify({ users: [] }, null, 2));
}

function readUsers() {
    try {
        const raw = fs.readFileSync(USERS_FILE, "utf8");
        const data = JSON.parse(raw);

        if (!Array.isArray(data.users)) {
            return [];
        }

        return data.users;
    } catch (err) {
        console.error("Failed to read users:", err);
        return [];
    }
}

function writeUsers(users) {
    fs.writeFileSync(
        USERS_FILE,
        JSON.stringify({ users }, null, 2)
    );
}

function makeToken() {
    return crypto.randomBytes(32).toString("hex");
}

function cleanUsername(username) {
    return String(username || "")
        .trim()
        .slice(0, 24);
}

function nowTime() {
    return new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
    });
}

function makeId() {
    return crypto.randomBytes(10).toString("hex");
}

function parseDurationToMs(text) {
    const raw = String(text || "").trim().toLowerCase();
    const match = raw.match(/^(\d+)\s*(s|m|h|d)$/);

    if (!match) {
        return null;
    }

    const amount = Number(match[1]);
    const unit = match[2];

    if (!Number.isFinite(amount) || amount <= 0) {
        return null;
    }

    if (unit === "s") return amount * 1000;
    if (unit === "m") return amount * 60 * 1000;
    if (unit === "h") return amount * 60 * 60 * 1000;
    if (unit === "d") return amount * 24 * 60 * 60 * 1000;

    return null;
}

function splitCommandArgs(text) {
    return String(text || "")
        .split(",")
        .map(part => part.trim())
        .filter(Boolean);
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
        readOnly: false,
        filterLevel: "strict",
        allowLinks: false
    },

    butter: {
        id: "butter",
        name: "Butter",
        icon: "🧈",
        theme: "butter",
        readOnly: false,
        filterLevel: "mild",
        allowLinks: true
    },

    blueCheese: {
        id: "blueCheese",
        name: "Blue Cheese",
        icon: "🧀",
        theme: "blue",
        readOnly: false,
        filterLevel: "none",
        allowLinks: true
    },

    updateLog: {
        id: "updateLog",
        name: "Update Log",
        icon: "📢",
        theme: "cheese",
        readOnly: true,
        filterLevel: "strict",
        allowLinks: false
    }
};

const roomMessages = {
    cheeseLounge: [],
    butter: [],
    blueCheese: [],
    updateLog: [
        {
            id: makeId(),
            username: "Update Log",
            realUsername: "Update Log",
            text: "v1.0 — CheeseWithFriends is alive 🧀",
            time: nowTime(),
            room: "updateLog",
            reactions: {}
        }
    ]
};

const filterEnabled = {
    cheeseLounge: true,
    butter: true,
    blueCheese: false,
    updateLog: true
};

/* =========================
   AUTH STATE
========================= */

const sessions = new Map();
const onlineUsers = new Map();
const bannedUsers = new Map();
const mutedUsers = new Map();

let adminAppearsOffline = false;
let visualNameOverride = "";
let chaosLevel = 0;
let scheduledEvents = [];

/* =========================
   MESSAGE FILTERS
========================= */

function normaliseForFilter(text) {
    return String(text || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[@]/g, "a")
        .replace(/[4]/g, "a")
        .replace(/[3]/g, "e")
        .replace(/[1!|]/g, "i")
        .replace(/[0]/g, "o")
        .replace(/[5$]/g, "s")
        .replace(/[7]/g, "t")
        .replace(/[9]/g, "g")
        .replace(/[^a-z0-9]/g, "");
}

const strictBlockedRoots = [
    "nigga",
    "nigger",
    "nigg",
    "niga",
    "coon",
    "chink",
    "spic",
    "paki",
    "kike",
    "faggot",
    "fag",
    "tranny",
    "shemale",
    "retard",
    "retarded",
    "kys",
    "fuck",
    "fucking",
    "shit",
    "bitch",
    "bastard",
    "asshole",
    "dickhead",
    "cunt",
    "wanker"
];

const mildBlockedRoots = [
    "nigga",
    "nigger",
    "nigg",
    "niga",
    "coon",
    "chink",
    "spic",
    "paki",
    "kike",
    "faggot",
    "fag",
    "tranny",
    "shemale"
];

function containsBlockedLanguage(text, roomId) {
    const room = rooms[roomId] || rooms.cheeseLounge;

    if (!filterEnabled[roomId]) {
        return false;
    }

    if (room.filterLevel === "none") {
        return false;
    }

    const normalised = normaliseForFilter(text);

    const list =
        room.filterLevel === "mild"
            ? mildBlockedRoots
            : strictBlockedRoots;

    return list.some(root => normalised.includes(root));
}

function containsLink(text) {
    return /(https?:\/\/|www\.|discord\.gg|discord\.com|tiktok\.com|youtube\.com|youtu\.be)/i.test(
        String(text || "")
    );
}

const trustedLinkPatterns = [
    /https?:\/\/(www\.)?youtube\.com/i,
    /https?:\/\/youtu\.be/i,
    /https?:\/\/(www\.)?tiktok\.com/i,
    /https?:\/\/(www\.)?discord\.com/i,
    /https?:\/\/discord\.gg/i
];

const blockedShoppingPatterns = [
    /amazon\./i,
    /ebay\./i,
    /temu\./i,
    /shein\./i,
    /etsy\./i,
    /aliexpress\./i,
    /shop/i,
    /store/i,
    /checkout/i,
    /cart/i
];

function linkAllowed(text, roomId) {
    const room = rooms[roomId] || rooms.cheeseLounge;

    if (!containsLink(text)) {
        return true;
    }

    if (!room.allowLinks) {
        return false;
    }

    if (blockedShoppingPatterns.some(pattern => pattern.test(text))) {
        return false;
    }

    return trustedLinkPatterns.some(pattern => pattern.test(text));
}

/* =========================
   CHAOS COMMANDS
========================= */

function normaliseChaosCommand(command) {
    return String(command || "")
        .toLowerCase()
        .replace("+/", "")
        .replace("\\", "")
        .replace(/\s+/g, "")
        .replace(/-/g, "")
        .replace(/_/g, "")
        .trim();
}

const chaosCommands = {
    cheeserain: "cheeserain",
    cheesestorm: "cheesestorm",
    singularicheese: "singularicheese",
    mouserun: "mouserun",
    meltui: "meltui",
    butterflood: "butterflood",
    butterbomb: "butterbomb",
    cheesequake: "cheesequake",
    cheeseportal: "cheeseportal",
    mouldtakeover: "mouldtakeover",
    clearvisuals: "clearvisuals"
};

function increaseChaos(amount) {
    chaosLevel = Math.min(100, chaosLevel + amount);
    io.emit("chaos level", chaosLevel);
}

function lowerChaos() {
    if (chaosLevel <= 0) return;

    chaosLevel = Math.max(0, chaosLevel - 2);
    io.emit("chaos level", chaosLevel);
}

setInterval(lowerChaos, 5000);

function emitChaosEvent(eventType) {
    io.emit("chaos event", {
        type: eventType
    });
}

function runChaosCommand(rawCommand) {
    const commandName = normaliseChaosCommand(rawCommand);
    const eventType = chaosCommands[commandName];

    if (!eventType) {
        return {
            success: false,
            message: `Unknown chaos command: ${rawCommand}`
        };
    }

    emitChaosEvent(eventType);

    if (eventType !== "clearvisuals") {
        increaseChaos(18);
    }

    return {
        success: true,
        message: `Chaos event started: ${eventType}`
    };
}

/* =========================
   USERS HELPERS
========================= */

function getSessionFromToken(token) {
    if (!token) return null;
    return sessions.get(token) || null;
}

function getOnlineUserByName(name) {
    const target = String(name || "").trim().toLowerCase();

    for (const [socketId, user] of onlineUsers.entries()) {
        const display = String(user.username || "").toLowerCase();
        const real = String(user.realUsername || "").toLowerCase();

        if (display === target || real === target) {
            return {
                socketId,
                user
            };
        }
    }

    return null;
}

function emitOnlineUsers() {
    const users = [];

    for (const user of onlineUsers.values()) {
        if (user.isAdmin && adminAppearsOffline) {
            continue;
        }

        users.push({
            username: visualNameOverride || user.username,
            realName: user.username,
            room: user.room
        });
    }

    io.emit("online users", users);
}

function addMessageToRoom(roomId, message) {
    if (!roomMessages[roomId]) {
        roomMessages[roomId] = [];
    }

    roomMessages[roomId].push(message);

    if (roomMessages[roomId].length > 120) {
        roomMessages[roomId].shift();
    }
}

function sendSystemMessage(text, room = "cheeseLounge") {
    io.emit("system message", {
        text,
        room
    });
}

/* =========================
   EXPRESS AUTH
========================= */

app.post("/signup", async (req, res) => {
    const username = cleanUsername(req.body.username);
    const password = String(req.body.password || "");

    if (!username || !password) {
        return res.json({
            success: false,
            message: "Enter a username and password."
        });
    }

    if (username.toLowerCase() === ADMIN_LOGIN_USERNAME.toLowerCase()) {
        return res.json({
            success: false,
            message: "That username is reserved."
        });
    }

    if (password.length < 3) {
        return res.json({
            success: false,
            message: "Password is too short."
        });
    }

    const users = readUsers();

    const exists = users.some(
        user => user.username.toLowerCase() === username.toLowerCase()
    );

    if (exists) {
        return res.json({
            success: false,
            message: "That username already exists."
        });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    users.push({
        username,
        passwordHash,
        createdAt: Date.now()
    });

    writeUsers(users);

    res.json({
        success: true,
        message: "Account created."
    });
});

app.post("/login", async (req, res) => {
    const username = cleanUsername(req.body.username);
    const password = String(req.body.password || "");

    if (!username || !password) {
        return res.json({
            success: false,
            message: "Enter a username and password."
        });
    }

    const isAdminLogin =
        username === ADMIN_LOGIN_USERNAME &&
        password === ADMIN_PASSWORD;

    if (isAdminLogin) {
        const token = makeToken();

        sessions.set(token, {
            username: ADMIN_DISPLAY_NAME,
            realUsername: ADMIN_LOGIN_USERNAME,
            admin: true
        });

        return res.json({
            success: true,
            username: ADMIN_DISPLAY_NAME,
            token,
            admin: true
        });
    }

    const bannedUntil = bannedUsers.get(username.toLowerCase());

    if (bannedUntil === Infinity || bannedUntil > Date.now()) {
        return res.json({
            success: false,
            message: "This account is banned."
        });
    }

    const users = readUsers();

    const user = users.find(
        entry => entry.username.toLowerCase() === username.toLowerCase()
    );

    if (!user) {
        return res.json({
            success: false,
            message: "Account not found."
        });
    }

    const passwordOk = await bcrypt.compare(password, user.passwordHash);

    if (!passwordOk) {
        return res.json({
            success: false,
            message: "Wrong password."
        });
    }

    const token = makeToken();

    sessions.set(token, {
        username: user.username,
        realUsername: user.username,
        admin: false
    });

    res.json({
        success: true,
        username: user.username,
        token,
        admin: false
    });
});

/* =========================
   ADMIN COMMANDS
========================= */

function handleAdminTextCommand(socket, session, command) {
    const raw = String(command || "").trim();

    if (!raw) {
        socket.emit("admin reply", "Empty command.");
        return;
    }

    if (raw.startsWith("+/")) {
        const result = runChaosCommand(raw);
        socket.emit("admin reply", result.message);
        return;
    }

    if (!raw.startsWith(";/")) {
        socket.emit("admin reply", "Commands must start with ;/ or +/");
        return;
    }

    const withoutPrefix = raw.slice(2);
    const colonIndex = withoutPrefix.indexOf(":");

    const commandName =
        colonIndex === -1
            ? withoutPrefix.trim().toLowerCase()
            : withoutPrefix.slice(0, colonIndex).trim().toLowerCase();

    const commandBody =
        colonIndex === -1
            ? ""
            : withoutPrefix.slice(colonIndex + 1).trim();

    if (commandName === "warning") {
        const args = splitCommandArgs(commandBody);
        const playerName = args[0];
        const warningText = args.slice(1).join(", ");

        if (!playerName || !warningText) {
            socket.emit("admin reply", "Usage: ;/Warning: <Player>, <Text>");
            return;
        }

        const target = getOnlineUserByName(playerName);

        if (!target) {
            socket.emit("admin reply", "Player not online.");
            return;
        }

        io.to(target.socketId).emit("admin warning", warningText);
        socket.emit("admin reply", `Warning sent to ${target.user.username}.`);
        return;
    }

    if (commandName === "ban") {
        const args = splitCommandArgs(commandBody);
        const playerName = args[0];
        const reason = args.slice(1).join(", ") || "No reason given.";

        if (!playerName) {
            socket.emit("admin reply", "Usage: ;/Ban: <Player>, <Reason>");
            return;
        }

        const key = playerName.toLowerCase();
        bannedUsers.set(key, Infinity);

        const target = getOnlineUserByName(playerName);

        if (target) {
            io.to(target.socketId).emit("banned", {
                reason
            });

            io.sockets.sockets.get(target.socketId)?.disconnect(true);
        }

        socket.emit("admin reply", `${playerName} was permanently banned.`);
        return;
    }

    if (commandName === "tempban") {
        const args = splitCommandArgs(commandBody);
        const playerName = args[0];
        const duration = args[1];
        const reason = args.slice(2).join(", ") || "No reason given.";
        const ms = parseDurationToMs(duration);

        if (!playerName || !ms) {
            socket.emit("admin reply", "Usage: ;/TempBan: <Player>, <10m>, <Reason>");
            return;
        }

        bannedUsers.set(playerName.toLowerCase(), Date.now() + ms);

        const target = getOnlineUserByName(playerName);

        if (target) {
            io.to(target.socketId).emit("banned", {
                reason
            });

            io.sockets.sockets.get(target.socketId)?.disconnect(true);
        }

        socket.emit("admin reply", `${playerName} was temp banned for ${duration}.`);
        return;
    }

    if (commandName === "mute") {
        const args = splitCommandArgs(commandBody);
        const playerName = args[0];
        const duration = args[1];
        const reason = args.slice(2).join(", ") || "No reason given.";
        const ms = parseDurationToMs(duration);

        if (!playerName || !ms) {
            socket.emit("admin reply", "Usage: ;/Mute: <Player>, <10m>, <Reason>");
            return;
        }

        mutedUsers.set(playerName.toLowerCase(), Date.now() + ms);

        const target = getOnlineUserByName(playerName);

        if (target) {
            io.to(target.socketId).emit(
                "message rejected",
                `You were muted for ${duration}. Reason: ${reason}`
            );
        }

        socket.emit("admin reply", `${playerName} was muted for ${duration}.`);
        return;
    }

    if (commandName === "offline") {
        adminAppearsOffline = true;
        emitOnlineUsers();
        socket.emit("admin reply", "You now appear offline.");
        return;
    }

    if (commandName === "online") {
        adminAppearsOffline = false;
        emitOnlineUsers();
        socket.emit("admin reply", "You now appear online.");
        return;
    }

    if (commandName === "announcement") {
        if (!commandBody) {
            socket.emit("admin reply", "Usage: ;/Announcement: <Message>");
            return;
        }

        io.emit("admin announcement", commandBody);
        sendSystemMessage(`📢 ${commandBody}`, "cheeseLounge");
        socket.emit("admin reply", "Announcement sent.");
        return;
    }

    socket.emit("admin reply", `Unknown command: ${commandName}`);
}

function handleSpecialChaosCommand(socket, command) {
    const raw = String(command || "").trim();

    const filterMatch = raw.match(/^\+\/Filter:\s*([^,]+),\s*(On|Off)\\?$/i);

    if (filterMatch) {
        const roomName = filterMatch[1].trim().toLowerCase();
        const setting = filterMatch[2].trim().toLowerCase();

        const roomId =
            roomName.includes("butter")
                ? "butter"
                : roomName.includes("blue")
                    ? "blueCheese"
                    : "cheeseLounge";

        filterEnabled[roomId] = setting === "on";

        socket.emit(
            "admin reply",
            `${rooms[roomId].name} filter is now ${setting}.`
        );

        return true;
    }

    const nameMatch = raw.match(/^\+\/SetName:\s*(.+?)\\?$/i);

    if (nameMatch) {
        visualNameOverride = nameMatch[1].trim();

        io.emit("visual name override", visualNameOverride);
        emitOnlineUsers();

        socket.emit("admin reply", `All names visually set to ${visualNameOverride}.`);
        return true;
    }

    const clearNameMatch = raw.match(/^\+\/ClearName\\?$/i);

    if (clearNameMatch) {
        visualNameOverride = "";

        io.emit("visual name override", "");
        emitOnlineUsers();

        socket.emit("admin reply", "Visual names cleared.");
        return true;
    }

    return false;
}

/* =========================
   SCHEDULED EVENTS
========================= */

function emitScheduleState() {
    io.emit("schedule state", scheduledEvents);
}

function scheduleEvent(socket, commandText, delaySeconds) {
    const delay = Math.max(1, Math.min(Number(delaySeconds) || 10, 3600));
    const id = makeId();

    const event = {
        id,
        commandText,
        delaySeconds: delay,
        runAt: Date.now() + delay * 1000
    };

    scheduledEvents.push(event);
    emitScheduleState();

    setTimeout(() => {
        const stillExists = scheduledEvents.some(item => item.id === id);

        if (!stillExists) {
            return;
        }

        scheduledEvents = scheduledEvents.filter(item => item.id !== id);
        emitScheduleState();

        const commandName = normaliseChaosCommand(commandText);
        const eventType = chaosCommands[commandName];

        if (eventType) {
            emitChaosEvent(eventType);

            if (eventType !== "clearvisuals") {
                increaseChaos(18);
            }

            sendSystemMessage(
                `🧀 Scheduled chaos started: ${eventType}`,
                "cheeseLounge"
            );
        }
    }, delay * 1000);

    socket.emit("admin reply", `Scheduled ${commandText} in ${delay}s.`);
}

/* =========================
   SOCKET.IO
========================= */

io.on("connection", socket => {
    let session = null;

    socket.on("user joined", data => {
        session = getSessionFromToken(data.token);

        if (!session) {
            socket.emit("force logout", "Session expired. Please log in again.");
            return;
        }

        const room = rooms[data.room] ? data.room : "cheeseLounge";

        socket.join(room);

        onlineUsers.set(socket.id, {
            username: session.username,
            realUsername: session.realUsername,
            isAdmin: session.admin,
            room
        });

        socket.emit("admin status", {
            admin: session.admin
        });

        socket.emit("room data", {
            room,
            roomInfo: rooms[room],
            messages: roomMessages[room] || []
        });

        socket.emit("chaos level", chaosLevel);
        socket.emit("schedule state", scheduledEvents);

        emitOnlineUsers();

        sendSystemMessage(`${session.username} joined ${rooms[room].name}.`, room);
    });

    socket.on("switch room", roomId => {
        if (!session) return;

        if (!rooms[roomId]) {
            return;
        }

        const currentOnline = onlineUsers.get(socket.id);

        if (currentOnline) {
            socket.leave(currentOnline.room);
            currentOnline.room = roomId;
            onlineUsers.set(socket.id, currentOnline);
        }

        socket.join(roomId);

        socket.emit("room data", {
            room: roomId,
            roomInfo: rooms[roomId],
            messages: roomMessages[roomId] || []
        });

        emitOnlineUsers();
    });

    socket.on("chat message", data => {
        if (!session) return;

        const roomId = rooms[data.room] ? data.room : "cheeseLounge";
        const room = rooms[roomId];
        const text = String(data.text || "").trim();

        if (!text) return;

        if (text.length > 100) {
            socket.emit("message rejected", "Messages can only be 100 characters.");
            return;
        }

        if (room.readOnly && !session.admin) {
            socket.emit("message rejected", "This room is read-only.");
            return;
        }

        const muteUntil = mutedUsers.get(session.username.toLowerCase());

        if (muteUntil && muteUntil > Date.now()) {
            socket.emit("message rejected", "You are muted right now.");
            return;
        }

        if (containsBlockedLanguage(text, roomId)) {
            socket.emit("message rejected", "That message was blocked by the filter.");
            return;
        }

        if (!linkAllowed(text, roomId)) {
            socket.emit("message rejected", "That link is not allowed in this room.");
            return;
        }

        const replyTo =
            data.replyTo && data.replyTo.id
                ? {
                    id: data.replyTo.id,
                    username: String(data.replyTo.username || "").slice(0, 24),
                    text: String(data.replyTo.text || "").slice(0, 60)
                }
                : null;

        const message = {
            id: makeId(),
            username: visualNameOverride || session.username,
            realUsername: session.username,
            text,
            time: nowTime(),
            room: roomId,
            replyTo,
            reactions: {}
        };

        addMessageToRoom(roomId, message);

        io.to(roomId).emit("chat message", message);
    });

    socket.on("react message", data => {
        if (!session) return;

        const roomId = rooms[data.room] ? data.room : "cheeseLounge";
        const messageId = data.messageId;
        const emoji = String(data.emoji || "").slice(0, 4);

        if (!emoji) return;

        const message = (roomMessages[roomId] || []).find(
            item => item.id === messageId
        );

        if (!message) return;

        if (!message.reactions) {
            message.reactions = {};
        }

        message.reactions[emoji] = (message.reactions[emoji] || 0) + 1;

        io.to(roomId).emit("reaction update", {
            room: roomId,
            messageId,
            reactions: message.reactions
        });
    });

    socket.on("typing", data => {
        if (!session) return;

        const roomId = rooms[data.room] ? data.room : "cheeseLounge";

        socket.to(roomId).emit("typing", {
            room: roomId,
            username: session.username
        });
    });

    socket.on("stop typing", data => {
        if (!session) return;

        const roomId = rooms[data.room] ? data.room : "cheeseLounge";

        socket.to(roomId).emit("stop typing", {
            room: roomId
        });
    });

    socket.on("admin command", command => {
        if (!session || !session.admin) {
            socket.emit("admin reply", "You are not an admin.");
            return;
        }

        if (handleSpecialChaosCommand(socket, command)) {
            return;
        }

        handleAdminTextCommand(socket, session, command);
    });

    socket.on("schedule event", data => {
        if (!session || !session.admin) {
            socket.emit("admin reply", "You are not an admin.");
            return;
        }

        scheduleEvent(
            socket,
            String(data.commandText || ""),
            Number(data.delaySeconds || 10)
        );
    });

    socket.on("cancel scheduled event", id => {
        if (!session || !session.admin) {
            return;
        }

        scheduledEvents = scheduledEvents.filter(event => event.id !== id);
        emitScheduleState();

        socket.emit("admin reply", "Scheduled event cancelled.");
    });

    socket.on("disconnect", () => {
        const online = onlineUsers.get(socket.id);

        if (online) {
            sendSystemMessage(
                `${online.username} left ${rooms[online.room]?.name || "the room"}.`,
                online.room
            );
        }

        onlineUsers.delete(socket.id);
        emitOnlineUsers();
    });
});

server.listen(PORT, () => {
    console.log(`CheeseWithFriends running on port ${PORT} 🧀`);
});