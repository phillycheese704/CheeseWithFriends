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
const PLAYER_DATA_FILE = path.join(DATA_DIR, "player-data.json");

const ADMIN_LOGIN_USERNAME = "PhillyCheese#;";
const ADMIN_DISPLAY_NAME = "PhillyCheese";
const ADMIN_PASSWORD = "AdminAccount##;";

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}

if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify({ users: [] }, null, 2));
}

if (!fs.existsSync(PLAYER_DATA_FILE)) {
    fs.writeFileSync(PLAYER_DATA_FILE, JSON.stringify({ players: {} }, null, 2));
}

/* =========================
   BASIC HELPERS
========================= */

function makeToken() {
    return crypto.randomBytes(32).toString("hex");
}

function makeId() {
    return crypto.randomBytes(10).toString("hex");
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

function parseDurationToMs(text) {
    const raw = String(text || "").trim().toLowerCase();
    const match = raw.match(/^(\d+)\s*(s|m|h|d)$/);

    if (!match) return null;

    const amount = Number(match[1]);
    const unit = match[2];

    if (!Number.isFinite(amount) || amount <= 0) return null;

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

function safeNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

/* =========================
   FILE DATA
========================= */

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
    fs.writeFileSync(USERS_FILE, JSON.stringify({ users }, null, 2));
}

function readPlayerDataFile() {
    try {
        const raw = fs.readFileSync(PLAYER_DATA_FILE, "utf8");
        const data = JSON.parse(raw);

        if (!data.players) {
            data.players = {};
        }

        return data;
    } catch (err) {
        console.error("Failed to read player data:", err);
        return { players: {} };
    }
}

function writePlayerDataFile(data) {
    fs.writeFileSync(PLAYER_DATA_FILE, JSON.stringify(data, null, 2));
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
        noChat: false,
        filterLevel: "strict",
        allowLinks: false
    },

    butter: {
        id: "butter",
        name: "Butter",
        icon: "🧈",
        theme: "butter",
        readOnly: false,
        noChat: false,
        filterLevel: "mild",
        allowLinks: true
    },

    blueCheese: {
        id: "blueCheese",
        name: "Blue Cheese",
        icon: "🧀",
        theme: "blue",
        readOnly: false,
        noChat: false,
        filterLevel: "none",
        allowLinks: true
    },

    grilledCheese: {
        id: "grilledCheese",
        name: "Grilled Cheese",
        icon: "🔥",
        theme: "grilled",
        readOnly: false,
        noChat: false,
        filterLevel: "grilled",
        allowLinks: true
    },

    cheddar: {
        id: "cheddar",
        name: "Cheddar",
        icon: "🟨",
        theme: "cheese",
        readOnly: true,
        noChat: true,
        filterLevel: "strict",
        allowLinks: false
    },

    feta: {
        id: "feta",
        name: "Cheese Bots",
        icon: "🤖🧀",
        theme: "cheeseBots",
        readOnly: false,
        noChat: false,
        filterLevel: "strict",
        allowLinks: false,
        isBotRoom: true
    },

    mozzarella: {
        id: "mozzarella",
        name: "Mozzarella",
        icon: "⚪",
        theme: "cheese",
        readOnly: true,
        noChat: true,
        filterLevel: "strict",
        allowLinks: false
    }
};

const roomMessages = {
    cheeseLounge: [],
    butter: [],
    blueCheese: [],
    grilledCheese: [],
    cheddar: [],
    feta: [],
    mozzarella: []
};

const filterEnabled = {
    cheeseLounge: true,
    butter: true,
    blueCheese: false,
    grilledCheese: true,
    cheddar: true,
    mozzarella: true
};

/* =========================
   AUTH / LIVE STATE
========================= */

const sessions = new Map();
const onlineUsers = new Map();
const bannedUsers = new Map();
const mutedUsers = new Map();

let adminAppearsOffline = false;
let visualNameOverride = "";
let chaosLevel = 0;
let scheduledEvents = [];
let activePoll = null;
let scheduledShutdownTimeout = null;
let scheduledShutdown = null;
let activeCheeseBank = null;
let tempServers = [];
const adminLog = [];
let currentSeason = null;
let seasonEndsAt = null;
let seasonTimeout = null;
const recentChaosEvents = [];


function isProtectedOwnerTarget(username) {
    const raw = String(username || "").trim().toLowerCase();
    const normalized = raw.replace(/[^a-z0-9]/g, "");
    return normalized === "phillycheese" || raw === ADMIN_DISPLAY_NAME.toLowerCase();
}



function parseDurationToMsLoose(text) {
    const raw = String(text || "").trim().toLowerCase();
    const match = raw.match(/^(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours)$/);
    if (!match) return null;

    const amount = Number(match[1]);
    const unit = match[2];

    if (!Number.isFinite(amount) || amount <= 0) return null;

    if (unit.startsWith("s")) return amount * 1000;
    if (unit.startsWith("m")) return amount * 60 * 1000;
    if (unit.startsWith("h")) return amount * 60 * 60 * 1000;

    return null;
}

function shutdownRemainingMs() {
    if (!scheduledShutdown) return 0;
    return Math.max(0, scheduledShutdown.endsAt - Date.now());
}

function isServerShutdownActive() {
    const remaining = shutdownRemainingMs();

    if (remaining <= 0) {
        scheduledShutdown = null;
        return false;
    }

    return true;
}

function startScheduledShutdown(durationText, reason) {
    const ms = parseDurationToMsLoose(durationText);
    if (!ms) {
        return {
            success: false,
            message: "Use a duration like 10m, 1h, or 30s."
        };
    }

    scheduledShutdown = {
        startedAt: Date.now(),
        endsAt: Date.now() + ms,
        reason: reason || "Scheduled maintenance."
    };

    io.emit("server shutdown", {
        active: true,
        durationMs: ms,
        endsAt: scheduledShutdown.endsAt,
        reason: scheduledShutdown.reason
    });

    setTimeout(() => {
        if (!scheduledShutdown) return;

        const remaining = shutdownRemainingMs();
        if (remaining <= 0) {
            scheduledShutdown = null;
            io.emit("server shutdown ended");
        }
    }, ms + 500);

    return {
        success: true,
        message: `Server shutdown scheduled for ${durationText}.`
    };
}



const tempAdmins = new Map();

function normaliseProtectedName(name) {
    return String(name || "")
        .toLowerCase()
        .replace(/[^a-z0-9#;]/g, "");
}

function isOwnerName(name) {
    const clean = normaliseProtectedName(name);
    return (
        clean === normaliseProtectedName(ADMIN_DISPLAY_NAME) ||
        clean === normaliseProtectedName(ADMIN_LOGIN_USERNAME)
    );
}

function isOwnerSession(session) {
    return !!(
        session &&
        session.admin === true &&
        session.limitedAdmin !== true &&
        session.username === ADMIN_DISPLAY_NAME &&
        session.realUsername === ADMIN_LOGIN_USERNAME
    );
}

function clearExpiredTempAdmins() {
    const now = Date.now();
    for (const [key, expiresAt] of tempAdmins.entries()) {
        if (expiresAt <= now) tempAdmins.delete(key);
    }
}

function getTempAdminExpiry(username) {
    clearExpiredTempAdmins();
    return tempAdmins.get(getPlayerKey(username)) || 0;
}

function isLimitedAdminSession(session) {
    if (!session || session.limitedAdmin !== true) return false;
    const expiresAt = session.adminUntil || getTempAdminExpiry(session.username);
    if (!expiresAt || expiresAt <= Date.now()) {
        session.admin = false;
        session.limitedAdmin = false;
        session.adminUntil = 0;
        return false;
    }
    return true;
}

function hasFullAdmin(session) {
    return isOwnerSession(session);
}


function canUseAdminPanel(session) {
    return !!session && (hasFullAdmin(session) || isLimitedAdminSession(session) || session.isAdmin || session.isTempAdmin);
}


function canRunEvents(session) {
    return session && session.scheduledSystem ? true : hasFullAdmin(session) || isLimitedAdminSession(session);
}

function canRunAnnouncements(session) {
    return hasFullAdmin(session) || isLimitedAdminSession(session);
}

function canGiveInventory(session) {
    return hasFullAdmin(session);
}

function isAdminSessionActive(session) {
    return hasFullAdmin(session) || isLimitedAdminSession(session);
}

function denyLimitedAdmin(socket) {
    socket.emit(
        "admin reply",
        "Limited admins can only run chaos events and announcements."
    );
}

/* =========================
   PLAYER DATA / COINS / PROFILE
========================= */

function getPlayerKey(username) {
    return String(username || "")
        .trim()
        .toLowerCase();
}

function createDefaultPlayerProfile(username) {
    return {
        username,
        coins: 0,
        cheeseTokens: 0,
        highestCoins: 0,
        totalCoinsEarned: 0,
        messagesSent: 0,
        chaosUsed: 0,
        cratesOpened: 0,
        favouriteEvent: "",
        lastCoinMessageAt: 0,
        lastChaosUsedAt: 0,

        inventory: {},

        index: {
            eventsWitnessed: {},
            eventsUsed: {},
            cosmeticsOwned: {}
        },

        equippedCosmetics: {
            background: "",
            font: "",
            icon: ""
        },

        achievementsText: "Coming soon 🧀🏆"
    };
}

function getPlayerProfile(username) {
    const data = readPlayerDataFile();
    const key = getPlayerKey(username);

    if (!data.players[key]) {
        data.players[key] = createDefaultPlayerProfile(username);
        writePlayerDataFile(data);
    }

    if (typeof data.players[key].cheeseTokens !== "number") {
        data.players[key].cheeseTokens = 0;
        writePlayerDataFile(data);
    }

    return migrateWave2Profile(data.players[key]);
}

function savePlayerProfile(profile) {
    const data = readPlayerDataFile();
    const key = getPlayerKey(profile.username);

    data.players[key] = profile;
    writePlayerDataFile(data);
}

function addCoins(username, amount) {
    const profile = getPlayerProfile(username);
    const safeAmount = Math.max(0, safeNumber(amount));

    profile.coins += safeAmount;
    profile.totalCoinsEarned += safeAmount;

    if (profile.coins > profile.highestCoins) {
        profile.highestCoins = profile.coins;
    }

    savePlayerProfile(profile);
    return profile;
}

function removeCoins(username, amount) {
    if (isPhillyCheese(username)) {
        return { ok: true, profile: getPlayerProfile(username) };
    }
    const profile = getPlayerProfile(username);
    const safeAmount = Math.max(0, safeNumber(amount));

    if (profile.coins < safeAmount) {
        return {
            success: false,
            profile
        };
    }

    profile.coins -= safeAmount;
    savePlayerProfile(profile);

    return {
        success: true,
        profile
    };
}

function setCoins(username, amount) {
    const profile = getPlayerProfile(username);
    const safeAmount = Math.max(0, safeNumber(amount));

    profile.coins = safeAmount;

    if (profile.coins > profile.highestCoins) {
        profile.highestCoins = profile.coins;
    }

    savePlayerProfile(profile);
    return profile;
}



function spendTokens(username, amount = 1) {
    if (isPhillyCheese(username)) {
        return { ok: true, profile: getPlayerProfile(username) };
    }
    const profile = getPlayerProfile(username);
    const safeAmount = Math.max(1, safeNumber(amount, 1));

    if (safeNumber(profile.cheeseTokens, 0) < safeAmount) {
        return {
            ok: false,
            message: "Not enough Cheese Tokens."
        };
    }

    profile.cheeseTokens = safeNumber(profile.cheeseTokens, 0) - safeAmount;
    savePlayerProfile(profile);

    return {
        ok: true,
        profile
    };
}

function unlockAnyIndexEntryWithToken(username, entryType, entryId) {
    const profile = getPlayerProfile(username);
    const type = String(entryType || "").trim().toLowerCase();
    const id = String(entryId || "").trim();

    if (!id) {
        return {
            ok: false,
            message: "Choose something to unlock."
        };
    }

    if (type === "event") {
        if (!CHAOS_EVENTS[id]) {
            return {
                ok: false,
                message: "That event does not exist."
            };
        }

        if (profile.index.eventsWitnessed[id] || profile.index.eventsUsed[id]) {
            return {
                ok: false,
                message: "That event is already unlocked."
            };
        }

        const spent = spendTokens(username, 1);

        if (!spent.ok) return spent;

        const updated = getPlayerProfile(username);
        updated.index.eventsWitnessed[id] = true;
        savePlayerProfile(updated);

        return {
            ok: true,
            message: `${CHAOS_EVENTS[id].name} unlocked in the Cheese Index.`
        };
    }

    if (type === "cosmetic") {
        if (!COSMETICS[id]) {
            return {
                ok: false,
                message: "That cosmetic does not exist."
            };
        }

        if (profile.index.cosmeticsOwned[id]) {
            return {
                ok: false,
                message: "That cosmetic is already unlocked."
            };
        }

        const spent = spendTokens(username, 1);

        if (!spent.ok) return spent;

        const updated = getPlayerProfile(username);
        updated.index.cosmeticsOwned[id] = true;
        savePlayerProfile(updated);

        return {
            ok: true,
            message: `${COSMETICS[id].name} unlocked in the Cheese Index.`
        };
    }

    return {
        ok: false,
        message: "Unknown index type."
    };
}


function addTokens(username, amount) {
    const profile = getPlayerProfile(username);
    const safeAmount = Math.max(0, safeNumber(amount));

    profile.cheeseTokens = safeNumber(profile.cheeseTokens, 0) + safeAmount;

    savePlayerProfile(profile);
    return profile;
}

function setTokens(username, amount) {
    const profile = getPlayerProfile(username);
    const safeAmount = Math.max(0, safeNumber(amount));

    profile.cheeseTokens = safeAmount;

    savePlayerProfile(profile);
    return profile;
}

function addInventoryItem(username, eventId, amount = 1) {
    const profile = getPlayerProfile(username);
    const safeAmount = Math.max(1, safeNumber(amount, 1));

    profile.inventory[eventId] = (profile.inventory[eventId] || 0) + safeAmount;

    savePlayerProfile(profile);
    return profile;
}

function removeInventoryItem(username, eventId) {
    const profile = getPlayerProfile(username);

    if (!profile.inventory[eventId] || profile.inventory[eventId] <= 0) {
        return {
            success: false,
            profile
        };
    }

    profile.inventory[eventId] -= 1;

    if (profile.inventory[eventId] <= 0) {
        delete profile.inventory[eventId];
    }

    savePlayerProfile(profile);

    return {
        success: true,
        profile
    };
}

function markEventWitnessed(username, eventId) {
    const profile = getPlayerProfile(username);

    profile.index.eventsWitnessed[eventId] = true;

    savePlayerProfile(profile);
    return profile;
}

function markEventUsed(username, eventId) {
    const profile = getPlayerProfile(username);

    profile.index.eventsUsed[eventId] = true;
    profile.index.eventsWitnessed[eventId] = true;
    profile.chaosUsed += 1;

    savePlayerProfile(profile);
    return profile;
}

function markCosmeticOwned(username, cosmeticId) {
    const profile = getPlayerProfile(username);

    profile.index.cosmeticsOwned[cosmeticId] = true;

    savePlayerProfile(profile);
    return profile;
}

/* =========================
   CHAOS EVENTS / CRATES / COSMETICS
========================= */

const CHAOS_EVENTS = {
    cheeserain: {
        id: "cheeserain",
        name: "Cheese Rain",
        icon: "🧀🌧️",
        rarity: "common",
        description: "Cheese falls from the sky."
    },

    mouserun: {
        id: "mouserun",
        name: "Mouse Run",
        icon: "🐭",
        rarity: "common",
        description: "Mice sprint across the screen."
    },

    butterbomb: {
        id: "butterbomb",
        name: "Butter Bomb",
        icon: "🧈💥",
        rarity: "common",
        description: "A giant butter bomb splats on the screen."
    },

    butterflood: {
        id: "butterflood",
        name: "Butter Flood",
        icon: "🧈🌊",
        rarity: "uncommon",
        description: "A wave of butter floods the page."
    },

    cheesequake: {
        id: "cheesequake",
        name: "Cheesequake",
        icon: "🧀🌎",
        rarity: "uncommon",
        description: "The cheese world shakes."
    },

    mouldtakeover: {
        id: "mouldtakeover",
        name: "Mould Takeover",
        icon: "☣️🧀",
        rarity: "rare",
        description: "Mould spreads across the screen."
    },

    cheesestorm: {
        id: "cheesestorm",
        name: "Cheese Storm",
        icon: "🧀⛈️",
        rarity: "rare",
        description: "A violent storm of cheese."
    },

    cheeseportal: {
        id: "cheeseportal",
        name: "Cheese Portal",
        icon: "🧀🌌",
        rarity: "epic",
        description: "A glowing cheese portal opens."
    },

    cheesemoon: {
        id: "cheesemoon",
        name: "Cheese Moon",
        icon: "🧀🌕",
        rarity: "epic",
        description: "A huge aesthetic cheese moon rises."
    },

    giantmousetrap: {
        id: "giantmousetrap",
        name: "Giant Mouse Trap",
        icon: "🪤",
        rarity: "epic",
        description: "A huge mousetrap covers the screen."
    },

    singularicheese: {
        id: "singularicheese",
        name: "Singularicheese",
        icon: "🧀🌀",
        rarity: "legendary",
        description: "A cheese singularity consumes the UI."
    },

    cheesemeteor: {
        id: "cheesemeteor",
        name: "Cheese Meteor",
        icon: "🧀☄️",
        rarity: "legendary",
        description: "A flaming cheese meteor crashes down."
    },

    cheesenado: {
        id: "cheesenado",
        name: "Cheesenado",
        icon: "🧀🌪️",
        rarity: "legendary",
        description: "A tornado of cheese sweeps across the page."
    }
};

const CHAOS_CRATES = {
    dairy: {
        id: "dairy",
        name: "Dairy Crate",
        price: 50,
        odds: [
            {
                rarity: "common",
                chance: 80,
                pool: ["cheeserain", "mouserun", "butterbomb"]
            },
            {
                rarity: "uncommon",
                chance: 15,
                pool: ["butterflood", "cheesequake"]
            },
            {
                rarity: "rare",
                chance: 5,
                pool: ["mouldtakeover", "cheesestorm"]
            }
        ]
    },

    mozzarella: {
        id: "mozzarella",
        name: "Mozzarella Crate",
        price: 100,
        odds: [
            {
                rarity: "common",
                chance: 50,
                pool: ["cheeserain", "mouserun", "butterbomb"]
            },
            {
                rarity: "uncommon",
                chance: 30,
                pool: ["butterflood", "cheesequake"]
            },
            {
                rarity: "rare",
                chance: 15,
                pool: ["mouldtakeover", "cheesestorm"]
            },
            {
                rarity: "epic",
                chance: 5,
                pool: ["cheeseportal", "cheesemoon", "giantmousetrap"]
            }
        ]
    },

    cheese: {
        id: "cheese",
        name: "Cheese Crate",
        price: 500,
        odds: [
            {
                rarity: "common",
                chance: 35,
                pool: ["cheeserain", "mouserun", "butterbomb"]
            },
            {
                rarity: "uncommon",
                chance: 30,
                pool: ["butterflood", "cheesequake"]
            },
            {
                rarity: "rare",
                chance: 20,
                pool: ["mouldtakeover", "cheesestorm"]
            },
            {
                rarity: "epic",
                chance: 10,
                pool: ["cheeseportal", "cheesemoon", "giantmousetrap"]
            },
            {
                rarity: "legendary",
                chance: 5,
                pool: ["singularicheese", "cheesemeteor", "cheesenado"]
            }
        ]
    },

    chaos: {
        id: "chaos",
        name: "Chaos Crate",
        price: 850,
        odds: [
            {
                rarity: "common",
                chance: 25,
                pool: ["cheeserain", "mouserun", "butterbomb"]
            },
            {
                rarity: "uncommon",
                chance: 20,
                pool: ["butterflood", "cheesequake"]
            },
            {
                rarity: "rare",
                chance: 15,
                pool: ["mouldtakeover", "cheesestorm"]
            },
            {
                rarity: "epic",
                chance: 30,
                pool: ["cheeseportal", "cheesemoon", "giantmousetrap"]
            },
            {
                rarity: "legendary",
                chance: 10,
                pool: ["singularicheese", "cheesemeteor", "cheesenado"]
            }
        ]
    }
};

const COSMETICS = {
    classicCheeseBackground: {
        id: "classicCheeseBackground",
        name: "Classic Cheese Background",
        type: "background",
        rarity: "common"
    },

    butterBackground: {
        id: "butterBackground",
        name: "Butter Background",
        type: "background",
        rarity: "common"
    },

    cheeseFont: {
        id: "cheeseFont",
        name: "Cheese Font",
        type: "font",
        rarity: "common"
    },

    mouseIcon: {
        id: "mouseIcon",
        name: "Mouse Icon",
        type: "icon",
        rarity: "common"
    },

    mozzarellaBackground: {
        id: "mozzarellaBackground",
        name: "Mozzarella Background",
        type: "background",
        rarity: "uncommon"
    },

    retroFont: {
        id: "retroFont",
        name: "Retro Arcade Font",
        type: "font",
        rarity: "uncommon"
    },

    cheeseIcon: {
        id: "cheeseIcon",
        name: "Cheese Icon",
        type: "icon",
        rarity: "uncommon"
    },

    cheeseMoonBackground: {
        id: "cheeseMoonBackground",
        name: "Cheese Moon Background",
        type: "background",
        rarity: "rare"
    },

    portalBackground: {
        id: "portalBackground",
        name: "Cheese Portal Background",
        type: "background",
        rarity: "rare"
    },

    glitchFont: {
        id: "glitchFont",
        name: "Glitch Font",
        type: "font",
        rarity: "rare"
    },

    meteorIcon: {
        id: "meteorIcon",
        name: "Meteor Icon",
        type: "icon",
        rarity: "rare"
    },

    singularicheeseBackground: {
        id: "singularicheeseBackground",
        name: "Singularicheese Background",
        type: "background",
        rarity: "epic"
    },

    royalFont: {
        id: "royalFont",
        name: "Royal Cheese Font",
        type: "font",
        rarity: "epic"
    },

    cheesenadoIcon: {
        id: "cheesenadoIcon",
        name: "Cheesenado Icon",
        type: "icon",
        rarity: "epic"
    },

    legendaryCheeseMoonBackground: {
        id: "legendaryCheeseMoonBackground",
        name: "Legendary Cheese Moon Background",
        type: "background",
        rarity: "legendary"
    },

    goldenCheeseFont: {
        id: "goldenCheeseFont",
        name: "Golden Cheese Font",
        type: "font",
        rarity: "legendary"
    },

    singularityIcon: {
        id: "singularityIcon",
        name: "Singularity Icon",
        type: "icon",
        rarity: "legendary"
    }
};

const SWISS_CRATE = {
    id: "swiss",
    name: "Swiss Crate",
    price: 100,
    odds: [
        {
            rarity: "common",
            chance: 50
        },
        {
            rarity: "uncommon",
            chance: 25
        },
        {
            rarity: "rare",
            chance: 15
        },
        {
            rarity: "epic",
            chance: 8
        },
        {
            rarity: "legendary",
            chance: 2
        }
    ]
};

const DUPLICATE_COSMETIC_COINS = {
    common: 5,
    uncommon: 10,
    rare: 20,
    epic: 50,
    legendary: 100
};

function rollRarity(odds) {
    const total = odds.reduce((sum, entry) => sum + entry.chance, 0);
    let roll = Math.random() * total;

    for (const entry of odds) {
        roll -= entry.chance;

        if (roll <= 0) {
            return entry;
        }
    }

    return odds[0];
}

function pickRandom(list) {
    return list[Math.floor(Math.random() * list.length)];
}

function rollChaosCrate(crateId) {
    const crate = CHAOS_CRATES[crateId];

    if (!crate) return null;

    const rarityEntry = rollRarity(crate.odds);
    const eventId = pickRandom(rarityEntry.pool);

    return {
        crate,
        event: CHAOS_EVENTS[eventId]
    };
}

function rollCosmetic() {
    const rarityEntry = rollRarity(SWISS_CRATE.odds);

    const pool = Object.values(COSMETICS).filter(
        cosmetic => cosmetic.rarity === rarityEntry.rarity
    );

    return pickRandom(pool);
}

function rollCosmeticChoice(username) {
    const first = rollCosmetic();
    let second = rollCosmetic();

    let guard = 0;

    while (second.id === first.id && guard < 20) {
        second = rollCosmetic();
        guard++;
    }

    const profile = getPlayerProfile(username);

    return [first, second].map(item => {
        const duplicate = !!profile.index.cosmeticsOwned[item.id];

        return {
            ...item,
            duplicate,
            duplicateCoins: duplicate ? DUPLICATE_COSMETIC_COINS[item.rarity] : 0
        };
    });
}

function getBookCompletionPercent(profile) {
    const eventCount = Object.keys(CHAOS_EVENTS).length;
    const cosmeticCount = Object.keys(COSMETICS).length;

    const witnessedEvents = Object.keys(profile.index.eventsWitnessed || {}).length;
    const ownedCosmetics = Object.keys(profile.index.cosmeticsOwned || {}).length;

    const total = eventCount + cosmeticCount;
    const owned = witnessedEvents + ownedCosmetics;

    if (total <= 0) return 0;

    return Math.round((owned / total) * 100);
}

function getPublicPlayerData(username) {
    const profile = getPlayerProfile(username);

    return {
        username: profile.username,
        coins: isPhillyCheese(profile.username) ? 999999 : profile.coins,
        cheeseTokens: isPhillyCheese(profile.username) ? 999999 : safeNumber(profile.cheeseTokens, 0),
        highestCoins: profile.highestCoins,
        totalCoinsEarned: profile.totalCoinsEarned,
        messagesSent: profile.messagesSent,
        chaosUsed: profile.chaosUsed,
        cratesOpened: profile.cratesOpened,
        favouriteEvent: profile.favouriteEvent,
        lastChaosUsedAt: profile.lastChaosUsedAt,
        inventory: profile.inventory,
        index: profile.index,
        equippedCosmetics: profile.equippedCosmetics,
        friendCount: Array.isArray(profile.friends) ? profile.friends.length : 0,
        achievementCount: profile.achievements ? Object.keys(profile.achievements).length : 0,
        achievements: profile.achievements || {},
        bookCompletion: getBookCompletionPercent(profile),
        achievementsText: "Coming soon 🧀🏆",
        chaosEvents: CHAOS_EVENTS,
        cosmetics: COSMETICS,
        crates: CHAOS_CRATES,
        swissCrate: SWISS_CRATE,
        duplicateCoins: DUPLICATE_COSMETIC_COINS
    };
}

function emitPlayerData(socket, username) {
    socket.emit("player data", getPublicPlayerData(username));
}

function awardChatCoins(username, isReply) {
    const profile = getPlayerProfile(username);
    const now = Date.now();

    profile.messagesSent += 1;

    let earned = 0;

    if (now - profile.lastCoinMessageAt >= 8000) {
        earned += 1;
        profile.lastCoinMessageAt = now;
    }

    if (isReply) {
        earned += 1;
    }

    if (earned > 0) {
        profile.coins += earned;
        profile.totalCoinsEarned += earned;

        if (profile.coins > profile.highestCoins) {
            profile.highestCoins = profile.coins;
        }
    }

    savePlayerProfile(profile);

    return {
        profile,
        earned
    };
}

function awardLegendaryWitnessCoins(eventId) {
    const event = CHAOS_EVENTS[eventId];

    if (!event || event.rarity !== "legendary") return;

    const awarded = new Set();

    for (const online of onlineUsers.values()) {
        const key = getPlayerKey(online.username);

        if (awarded.has(key)) continue;

        awarded.add(key);

        addCoins(online.username, 5);
        markEventWitnessed(online.username, eventId);
    }
}

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

const grilledBlockedRoots = [
    ...mildBlockedRoots,
    "porn",
    "sex",
    "sexual",
    "blowjob",
    "massacre",
    "murder",
    "gore",
    "gorey"
];

function containsBlockedLanguage(text, roomId) {
    const room = rooms[roomId] || rooms.cheeseLounge;

    if (!filterEnabled[roomId]) return false;
    if (room.filterLevel === "none") return false;

    const normalised = normaliseForFilter(text);

    const list =
        room.filterLevel === "mild"
            ? mildBlockedRoots
            : room.filterLevel === "grilled"
                ? grilledBlockedRoots
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

    if (!containsLink(text)) return true;

    if (!room.allowLinks) return false;

    if (blockedShoppingPatterns.some(pattern => pattern.test(text))) {
        return false;
    }

    return trustedLinkPatterns.some(pattern => pattern.test(text));
}

/* =========================
   USERS / ONLINE HELPERS
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

function getRoomOfSocket(socketId) {
    const online = onlineUsers.get(socketId);
    return online ? online.room : "cheeseLounge";
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

function sendGlobalSystemMessage(text) {
    Object.keys(rooms).forEach(roomId => {
        sendSystemMessage(text, roomId);
    });
}

function emitAllPlayerDataForOnlineUsers() {
    for (const [socketId, online] of onlineUsers.entries()) {
        const targetSocket = io.sockets.sockets.get(socketId);

        if (targetSocket) {
            emitPlayerData(targetSocket, online.username);
        }
    }
}

/* =========================
   CHAOS COMMANDS / EVENTS
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
    cheesemoon: "cheesemoon",
    giantmousetrap: "giantmousetrap",
    cheesemeteor: "cheesemeteor",
    cheesenado: "cheesenado",
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

function emitChaosEvent(eventType, usedBy = "The cheese gods") {
    const cleanType = normaliseChaosCommand(eventType);
    const event = CHAOS_EVENTS[cleanType];

    registerChaosCombo(cleanType);

    io.emit("chaos event", {        type: cleanType,
        usedBy,
        eventName: event ? event.name : cleanType,
        icon: event ? event.icon : "🧀"
    });

    if (cleanType !== "clearvisuals") {
        increaseChaos(getChaosIncreaseForEvent(cleanType));
    }

    if (event) {
        sendGlobalSystemMessage(`${usedBy} used ${event.name} ${event.icon}`);

        awardLegendaryWitnessCoins(cleanType);
        emitAllPlayerDataForOnlineUsers();
    }
}

function runChaosCommand(rawCommand, usedBy = "Admin") {
    const commandName = normaliseChaosCommand(rawCommand);
    const eventType = chaosCommands[commandName];

    if (!eventType) {
        return {
            success: false,
            message: `Unknown chaos command: ${rawCommand}`
        };
    }

    emitChaosEvent(eventType, usedBy);

    return {
        success: true,
        message: `Chaos event started: ${eventType}`
    };
}






function isPhillyCheese(username) {
    return String(username || "").trim().toLowerCase() === String(ADMIN_DISPLAY_NAME || "").trim().toLowerCase();
}



function getSessionBySocketId(socketId) {
    for (const session of sessions.values()) {
        if (session && session.socketId === socketId) {
            return session;
        }
    }

    return null;
}


/* =========================
   CLAUDE FEATURE WAVE HELPERS
========================= */

function safeTodayKey() {
    return new Date().toISOString().slice(0, 10);
}

function minutesAgo(timestamp) {
    if (!timestamp) return "unknown";
    const mins = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
    if (mins < 1) return "just now";
    if (mins === 1) return "1 min ago";
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.floor(mins / 60);
    if (hours === 1) return "1 hour ago";
    return `${hours} hours ago`;
}

function getSocketByUsername(username) {
    const target = String(username || "").trim().toLowerCase();
    for (const socket of io.sockets.sockets.values()) {
        const session = getSessionBySocketId(socket.id);
        if (session && String(session.username || "").toLowerCase() === target) {
            return socket;
        }
    }
    return null;
}

function emitPlayerDataByName(username) {
    const socket = getSocketByUsername(username);
    if (socket) {
        emitPlayerData(socket, username);
    }
}

function addAdminLog(admin, action, target = "", details = "") {
    const entry = {
        timestamp: Date.now(),
        admin: admin || "System",
        action,
        target,
        details
    };

    adminLog.push(entry);

    while (adminLog.length > 500) {
        adminLog.shift();
    }

    try {
        const line = `${new Date(entry.timestamp).toISOString()} | ${entry.admin} | ${entry.action} | ${entry.target} | ${entry.details}\n`;
        require("fs").appendFileSync("admin-log.txt", line);
    } catch (error) {
        console.error("Could not write admin log:", error);
    }

    for (const sess of sessions.values()) {
        if (!hasFullAdmin(sess)) continue;

        const targetSocket = getSocketByUsername(sess.username);

        if (targetSocket) {
            targetSocket.emit("admin log updated", adminLog.slice(-100));
        }
    }
}


function setSeason(name, durationText, adminName = "System") {
    const season = String(name || "").trim().toLowerCase();
    const allowed = ["halloween", "christmas", "summer", "spring", "none"];

    if (!allowed.includes(season)) {
        return { ok: false, message: "Season must be halloween, christmas, summer, spring, or none." };
    }

    if (seasonTimeout) {
        clearTimeout(seasonTimeout);
        seasonTimeout = null;
    }

    if (season === "none") {
        currentSeason = null;
        seasonEndsAt = null;
        io.emit("season changed", { season: null, endsAt: null });
        addAdminLog(adminName, "season", "none", "Season cleared");
        return { ok: true, message: "Season cleared." };
    }

    const ms = parseDurationToMs(String(durationText || "10m").trim());

    if (!ms || ms < 60 * 1000 || ms > 60 * 60 * 1000) {
        return { ok: false, message: "Season duration must be between 1m and 60m." };
    }

    currentSeason = season;
    seasonEndsAt = Date.now() + ms;

    io.emit("season changed", {
        season: currentSeason,
        endsAt: seasonEndsAt
    });

    addAdminLog(adminName, "season", season, `Ends in ${durationText}`);

    seasonTimeout = setTimeout(() => {
        currentSeason = null;
        seasonEndsAt = null;
        seasonTimeout = null;
        io.emit("season changed", { season: null, endsAt: null });
    }, ms);

    return { ok: true, message: `${season} season set for ${durationText}.` };
}


const ACHIEVEMENTS = {
    first_message: { name: "First Squeak", coins: 25, icon: "💬" },
    messages_10: { name: "Talkative Cheese", coins: 50, icon: "🗣️" },
    messages_100: { name: "Cheese Chatterbox", coins: 150, icon: "📣" },
    messages_500: { name: "Lounge Legend", coins: 500, icon: "🏆" },
    messages_1000: { name: "Mythic Yapper", coins: 1000, icon: "🌟" },
    crates_1: { name: "Crate Curious", coins: 50, icon: "📦" },
    crates_10: { name: "Crate Collector", coins: 200, icon: "📦" },
    crates_50: { name: "Crate Goblin", coins: 800, icon: "📦" },
    chaos_first: { name: "Chaos Starter", coins: 75, icon: "🌪️" },
    chaos_10: { name: "Chaos Enjoyer", coins: 300, icon: "🌀" },
    poll_winner: { name: "Democracy Cheese", coins: 100, icon: "🗳️" },
    survived_singularicheese: { name: "Singularity Survivor", coins: 250, icon: "🕳️" },
    night_owl: { name: "Night Owl", coins: 150, icon: "🦉" },
    cheese_hoarder: { name: "Cheese Hoarder", coins: 500, icon: "🧀" },
    token_collector: { name: "Token Collector", coins: 500, icon: "🪙" },
    early_bird: { name: "???", realName: "Early Bird", coins: 150, icon: "🌅", secret: true },
    lucky: { name: "???", realName: "Lucky First Pull", coins: 1000, icon: "🍀", secret: true }
};

function unlockAchievement(profile, id, unlocked = []) {
    if (!ACHIEVEMENTS[id]) return;
    if (!profile.achievements) profile.achievements = {};
    if (profile.achievements[id]) return;

    profile.achievements[id] = {
        unlockedAt: Date.now(),
        seen: false
    };

    const achievement = ACHIEVEMENTS[id];
    profile.coins = safeNumber(profile.coins, 0) + safeNumber(achievement.coins, 0);
    profile.totalCoinsEarned = safeNumber(profile.totalCoinsEarned, 0) + safeNumber(achievement.coins, 0);

    unlocked.push({
        id,
        name: achievement.secret ? achievement.realName : achievement.name,
        icon: achievement.icon,
        coins: achievement.coins
    });
}

function checkAchievements(username, context = {}) {
    const profile = getPlayerProfile(username);
    if (!profile.achievements) profile.achievements = {};

    const unlocked = [];
    const messages = safeNumber(profile.messagesSent, 0);
    const crates = safeNumber(profile.cratesOpened, 0);
    const chaos = safeNumber(profile.chaosUsed, 0);
    const hour = new Date().getHours();

    if (messages >= 1) unlockAchievement(profile, "first_message", unlocked);
    if (messages >= 10) unlockAchievement(profile, "messages_10", unlocked);
    if (messages >= 100) unlockAchievement(profile, "messages_100", unlocked);
    if (messages >= 500) unlockAchievement(profile, "messages_500", unlocked);
    if (messages >= 1000) unlockAchievement(profile, "messages_1000", unlocked);
    if (crates >= 1) unlockAchievement(profile, "crates_1", unlocked);
    if (crates >= 10) unlockAchievement(profile, "crates_10", unlocked);
    if (crates >= 50) unlockAchievement(profile, "crates_50", unlocked);
    if (chaos >= 1) unlockAchievement(profile, "chaos_first", unlocked);
    if (chaos >= 10) unlockAchievement(profile, "chaos_10", unlocked);
    if (hour >= 2 && hour < 4) unlockAchievement(profile, "night_owl", unlocked);
    if (hour < 6) unlockAchievement(profile, "early_bird", unlocked);
    if (safeNumber(profile.coins, 0) >= 10000) unlockAchievement(profile, "cheese_hoarder", unlocked);
    if (safeNumber(profile.cheeseTokens, 0) >= 5) unlockAchievement(profile, "token_collector", unlocked);
    if (context.pollWinner) unlockAchievement(profile, "poll_winner", unlocked);
    if (context.survivedSingularity) unlockAchievement(profile, "survived_singularicheese", unlocked);
    if (context.legendaryFirstCrate) unlockAchievement(profile, "lucky", unlocked);

    savePlayerProfile(profile);

    if (unlocked.length) {
        const socket = getSocketByUsername(username);
        if (socket) {
            socket.emit("achievement unlocked", unlocked);
            emitPlayerData(socket, username);
        }
    }

    return unlocked;
}


function migrateWave2Profile(profile) {
    if (!profile) return profile;

    if (!profile.achievements) profile.achievements = {};
    if (!Array.isArray(profile.friends)) profile.friends = [];
    if (!Array.isArray(profile.friendRequests)) profile.friendRequests = [];
    if (typeof profile.lastSeenAt !== "number") profile.lastSeenAt = Date.now();
    if (typeof profile.totalCoinsEarned !== "number") profile.totalCoinsEarned = safeNumber(profile.highestCoins || profile.coins || 0);
    if (typeof profile.messagesSent !== "number") profile.messagesSent = 0;
    if (typeof profile.chaosUsed !== "number") profile.chaosUsed = 0;
    if (typeof profile.dailyGiftedCoins !== "number") profile.dailyGiftedCoins = 0;
    if (!profile.lastGiftResetDate) profile.lastGiftResetDate = safeTodayKey();
    if (typeof profile.cheeseTokens !== "number") profile.cheeseTokens = 0;

    return profile;
}



function getLeaderboard(currentUsername) {
    const data = readPlayerDataFile();
    const players = Object.values(data.players || {})
        .map(migrateWave2Profile)
        .filter(profile => !isPhillyCheese(profile.username));

    const categories = {
        totalCoinsEarned: "Total Earned",
        chaosUsed: "Chaos Used",
        cratesOpened: "Crates Opened",
        messagesSent: "Messages",
        coins: "Current Coins"
    };

    const result = {};

    Object.keys(categories).forEach(key => {
        result[key] = {
            label: categories[key],
            rows: players
                .slice()
                .sort((a, b) => safeNumber(b[key], 0) - safeNumber(a[key], 0))
                .slice(0, 10)
                .map((profile, index) => ({
                    rank: index + 1,
                    username: profile.username,
                    value: safeNumber(profile[key], 0),
                    isCurrentUser: String(profile.username).toLowerCase() === String(currentUsername).toLowerCase()
                }))
        };
    });

    return result;
}

const triviaQuestions = [
    { q: "Which cheese is traditionally used on pizza?", a: "Mozzarella", options: ["Brie", "Mozzarella", "Cheese Bots", "Blue Cheese"] },
    { q: "Which cheese is famous for holes?", a: "Swiss", options: ["Swiss", "Cheddar", "Parmesan", "Gouda"] },
    { q: "Which cheese is salty and crumbly?", a: "Cheese Bots", options: ["Cheese Bots", "Brie", "Mozzarella", "Gouda"] },
    { q: "Which cheese is often aged and grated over pasta?", a: "Parmesan", options: ["Parmesan", "Brie", "Swiss", "Cheese Bots"] }
];
let activeTrivia = null;
let triviaCooldownUntil = 0;

function sendFetaBotMessage(botName, text) {
    const message = {
        id: makeId(),
        username: botName,
        text,
        room: "feta",
        createdAt: Date.now(),
        bot: true
    };

    roomMessages.feta.push(message);
    if (roomMessages.feta.length > 120) roomMessages.feta.shift();

    io.to("feta").emit("chat message", message);
}

function getSessionFromSocketOrPayload(socket, payload) {
    const token =
        typeof payload === "object" && payload !== null
            ? payload.token
            : null;

    if (token && sessions.has(token)) {
        return sessions.get(token);
    }

    return null;
}

function normalizeAdminCommandPayload(payload) {
    if (typeof payload === "string") {
        return payload;
    }

    if (payload && typeof payload.command === "string") {
        return payload.command;
    }

    return "";
}



function stripHtmlForServer(value, maxLength = 100) {
    return String(value || "")
        .replace(/[<>]/g, "")
        .trim()
        .slice(0, maxLength);
}


function getRoomInfoById(roomId) {
    if (rooms[roomId]) return rooms[roomId];

    const temp = tempServers.find(item => item.id === roomId);

    if (!temp) return null;

    const themeMap = {
        cheese: "cheese",
        butter: "butter",
        blue: "blue",
        grilled: "grilled"
    };

    const filterMap = {
        cheese: "strict",
        butter: "mild",
        blue: "none",
        grilled: "grilled"
    };

    return {
        id: temp.id,
        name: temp.name,
        icon: temp.icon || "🧀",
        theme: themeMap[temp.filterLevel] || "cheese",
        readOnly: false,
        noChat: false,
        filterLevel: filterMap[temp.filterLevel] || "strict",
        allowLinks: temp.filterLevel === "blue" || temp.filterLevel === "grilled",
        isTempServer: true,
        owner: temp.owner,
        expiresAt: temp.expiresAt
    };
}

function getRoomMessagesById(roomId) {
    if (roomMessages[roomId]) return roomMessages[roomId];

    const temp = tempServers.find(item => item.id === roomId);

    if (!temp) return null;

    if (!temp.messages) temp.messages = [];

    return temp.messages;
}

function isRoomAvailable(roomId) {
    return !!getRoomInfoById(roomId);
}


function getTempServerPublicData(viewerUsername = "", viewerIsAdmin = false) {
    return tempServers.map(item => {
        const isOwner =
            String(item.owner || "").toLowerCase() === String(viewerUsername || "").toLowerCase();

        return {
            id: item.id,
            name: item.name,
            icon: item.icon,
            description: item.private ? "" : item.description,
            filterLevel: item.filterLevel,
            owner: item.owner,
            expiresAt: item.expiresAt,
            pinnedMessage: item.pinnedMessage || null,
            topic: item.topic || "",
            private: !!item.private,
            accessCode: isOwner || viewerIsAdmin ? item.accessCode || "" : ""
        };
    });
}

function emitTempServers() {
    for (const connectedSocket of io.sockets.sockets.values()) {
        const sessionForSocket = getSessionBySocketId(connectedSocket.id);
        const viewerUsername = sessionForSocket ? sessionForSocket.username : "";
        const viewerIsAdmin = sessionForSocket ? hasFullAdmin(sessionForSocket) : false;

        connectedSocket.emit(
            "temp servers",
            getTempServerPublicData(viewerUsername, viewerIsAdmin)
        );
    }
}

function createTempServer(session, data) {
    const name = stripHtmlForServer(data && data.name, 28);
    const icon = stripHtmlForServer(data && data.icon || "🧀", 4) || "🧀";
    const description = stripHtmlForServer(data && data.description, 100);
    const isPrivate = !!(data && data.private);
    const providedCode = String(data && data.accessCode || "").trim().slice(0, 6);
    const accessCode = isPrivate ? (providedCode || Math.random().toString(36).slice(2, 8).toUpperCase()).slice(0, 6) : "";
    const filterLevel = String(data && data.filterLevel || "cheese").trim().slice(0, 20);
    const allowedFilters = ["cheese", "butter", "blue", "grilled"];

    if (!name) {
        return { ok: false, message: "Temp server needs a name." };
    }

    if (tempServers.some(item => item.name.toLowerCase() === name.toLowerCase())) {
        return { ok: false, message: "A temp server with that name already exists." };
    }

    const tempServer = {
        id: `temp-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name,
        icon,
        description,
        filterLevel: allowedFilters.includes(filterLevel) ? filterLevel : "cheese",
        owner: session.username,
        ownerKey: session.username.toLowerCase(),
        expiresAt: Date.now() + 60 * 60 * 1000,
        messages: [],
        muted: {},
        private: isPrivate,
        accessCode
    };

    tempServers.push(tempServer);
    emitTempServers();

    return { ok: true, server: tempServer, message: `${icon} ${name} was created for 1 hour.` };
}

function findTempServerByIdOrName(value) {
    const raw = String(value || "").trim().toLowerCase();

    return tempServers.find(item =>
        item.id.toLowerCase() === raw ||
        item.name.toLowerCase() === raw
    );
}

function addTempServerLifetime(name, durationText) {
    const temp = findTempServerByIdOrName(name);

    if (!temp) {
        return { ok: false, message: "Temp server not found." };
    }

    const durationMs = parseDurationToMs(String(durationText || "30m").trim());

    if (!durationMs) {
        return { ok: false, message: "Use a duration like 10m, 1h, or 30s." };
    }

    temp.expiresAt += durationMs;
    emitTempServers();

    return { ok: true, message: `${temp.name} lifetime extended.` };
}

function removeTempServer(name) {
    const temp = findTempServerByIdOrName(name);

    if (!temp) {
        return { ok: false, message: "Temp server not found." };
    }

    tempServers = tempServers.filter(item => item.id !== temp.id);
    emitTempServers();
    io.emit("system notice", `🧀 ${temp.name} has melted away...`);

    return { ok: true, message: `${temp.name} removed.` };
}


function isSafeScheduledCommand(commandText) {
    const raw = String(commandText || "").trim();
    const lower = raw.toLowerCase();

    if (lower.startsWith("+/")) return true;

    return (
        lower.startsWith(";/announcement") ||
        lower.startsWith(";/startpoll") ||
        lower.startsWith(";/setseason")
    );
}


function executeScheduledCommand(commandText, scheduledBy = "Scheduler") {
    const fakeSocket = {
        emit(event, payload) {
            if (event === "admin reply") {
                io.emit("system notice", `⏰ Scheduled event: ${payload}`);
            }
        }
    };

    const fakeSession = {
        username: scheduledBy,
        isAdmin: false,
        isTempAdmin: false,
        scheduledSystem: true
    };

    if (!isSafeScheduledCommand(commandText)) {
        io.emit("system notice", "⚠️ Scheduled command blocked: unsafe admin command.");
        return false;
    }

    try {
        if (handleSpecialChaosCommand(fakeSocket, commandText, fakeSession)) {
            return true;
        }

        handleAdminTextCommand(fakeSocket, fakeSession, commandText);
        return true;
    } catch (error) {
        console.error("Scheduled command failed:", error);
        io.emit("system notice", `⚠️ Scheduled command failed: ${String(error.message || error)}`);
        return false;
    }
}


function spawnCheeseBank(socket) {
    const bankRoomIds = ["cheeseLounge", "butter", "blueCheese", "grilledCheese"].filter(roomId => rooms[roomId]);
    const roomId = pickRandom(bankRoomIds);
    const roomName = rooms[roomId]?.name || roomId;

    const bank = {
        id: makeId(),
        room: roomId,
        roomName,
        reward: 50,
        expiresAt: Date.now() + 45000,
        claimed: false
    };

    activeCheeseBank = bank;

    io.emit("cheese bank spawned", bank);
    sendGlobalSystemMessage(`💰 A bank has been built in ${roomName}, ROB IT 🧀💰`);

    if (socket) {
        socket.emit("admin reply", `Cheese Bank spawned in ${roomName}.`);
    }

    setTimeout(() => {
        if (activeCheeseBank && activeCheeseBank.id === bank.id && !activeCheeseBank.claimed) {
            activeCheeseBank = null;
            io.emit("cheese bank ended", bank.id);
        }
    }, 45000);
}

function findOnlineSocketByUsername(username) {
    const key = getPlayerKey(username);
    for (const [socketId, online] of onlineUsers.entries()) {
        if (getPlayerKey(online.username) === key || getPlayerKey(online.realUsername) === key) {
            return io.sockets.sockets.get(socketId) || null;
        }
    }
    return null;
}

function emitPlayerDataByUsername(username) {
    const targetSocket = findOnlineSocketByUsername(username);
    if (targetSocket) emitPlayerData(targetSocket, username);
}

function resolveChaosEventId(raw) {
    const wanted = normaliseChaosCommand(raw);
    if (CHAOS_EVENTS[wanted]) return wanted;
    return Object.keys(CHAOS_EVENTS).find(eventId => normaliseChaosCommand(CHAOS_EVENTS[eventId].name) === wanted) || null;
}

function resolveCrateId(raw) {
    const wanted = normaliseChaosCommand(raw);
    if (CHAOS_CRATES[wanted]) return wanted;
    return Object.keys(CHAOS_CRATES).find(crateId => normaliseChaosCommand(CHAOS_CRATES[crateId].name) === wanted) || null;
}

function giveChaosEventToPlayer(playerName, eventId, amount = 1) {
    const event = CHAOS_EVENTS[eventId];
    const count = Math.max(1, Math.min(25, safeNumber(amount, 1)));
    if (!event) return { success: false, message: "That chaos ability does not exist." };

    const profile = getPlayerProfile(playerName);
    profile.inventory[eventId] = (profile.inventory[eventId] || 0) + count;
    profile.index.eventsWitnessed[eventId] = true;
    savePlayerProfile(profile);
    emitPlayerDataByUsername(playerName);
    return { success: true, message: `${playerName} received ${count}x ${event.name} ${event.icon}.` };
}

function giveRolledCrateToPlayer(playerName, crateId, amount = 1) {
    const crate = CHAOS_CRATES[crateId];
    const count = Math.max(1, Math.min(10, safeNumber(amount, 1)));
    if (!crate) return { success: false, message: "That crate does not exist." };

    const rewards = [];
    const profile = getPlayerProfile(playerName);
    for (let i = 0; i < count; i++) {
        const result = rollChaosCrate(crateId);
        if (result && result.event) {
            profile.inventory[result.event.id] = (profile.inventory[result.event.id] || 0) + 1;
            profile.index.eventsWitnessed[result.event.id] = true;
            profile.cratesOpened += 1;
            rewards.push(`${result.event.icon} ${result.event.name}`);
        }
    }
    savePlayerProfile(profile);
    checkAchievements(playerName);
    emitPlayerDataByUsername(playerName);
    return { success: true, message: `${playerName} received ${count}x ${crate.name}. Rewards: ${rewards.join(", ") || "none"}.` };
}

function runCheeseRng(socket, session) {
    const candidates = [...onlineUsers.values()].filter(user => !user.isAdmin || !adminAppearsOffline);

    if (candidates.length === 0) {
        socket.emit("admin reply", "No online players to pick from.");
        return;
    }

    const chosen = pickRandom(candidates);
    const playerName = chosen.username;
    const playerNames = candidates.map(user => user.username);

    const roll = Math.random() * 100;
    let reward = {
        type: "coins",
        text: ""
    };

    if (roll < 1) {
        addTokens(playerName, 1);
        reward = {
            type: "token",
            text: "🪙 JACKPOT — 1 Cheese Token"
        };
        socket.emit("admin reply", `Cheese RNG gave ${playerName} 1 Cheese Token.`);
    } else if (roll < 25) {
        const crateIds = Object.keys(CHAOS_CRATES);
        const crateId = pickRandom(crateIds);
        const result = giveRolledCrateToPlayer(playerName, crateId, 1);

        reward = {
            type: "crate",
            text: `📦 ${CHAOS_CRATES[crateId].name}`
        };
        socket.emit("admin reply", result.message);
    } else {
        const amount = Math.floor(Math.random() * 751) + 50;
        addCoins(playerName, amount);
        reward = {
            type: "coins",
            text: `🧀 ${amount} Cheese Coins`
        };
        socket.emit("admin reply", `Cheese RNG gave ${playerName} ${amount} Cheese Coins.`);
    }

    emitPlayerDataByUsername(playerName);

    io.emit("cheese rng animation", {
        users: playerNames,
        winner: playerName,
        reward
    });

    sendGlobalSystemMessage(`🎲 Cheese RNG picked ${playerName}! Reward: ${reward.text}`);
}

/* =========================
   POLLS
========================= */

function parsePollEvents(rawEvents) {
    return String(rawEvents || "")
        .split("|")
        .map(event => normaliseChaosCommand(event))
        .filter(eventId => CHAOS_EVENTS[eventId]);
}

function startChaosPoll(startedBy, durationSeconds, title, eventIds) {
    if (activePoll) {
        return {
            success: false,
            message: "A poll is already running."
        };
    }

    const duration = Math.max(5, Math.min(safeNumber(durationSeconds, 30), 300));
    const options = eventIds
        .filter(eventId => CHAOS_EVENTS[eventId])
        .slice(0, 6);

    if (options.length < 2) {
        return {
            success: false,
            message: "A poll needs at least 2 valid chaos events."
        };
    }

    activePoll = {
        id: makeId(),
        startedBy,
        title: title || "Which chaos event should happen?",
        options,
        votes: {},
        voters: {},
        endsAt: Date.now() + duration * 1000
    };

    io.emit("poll started", {
        id: activePoll.id,
        title: activePoll.title,
        startedBy: activePoll.startedBy,
        options: activePoll.options.map(eventId => CHAOS_EVENTS[eventId]),
        endsAt: activePoll.endsAt
    });

    sendGlobalSystemMessage(`🗳️ ${startedBy} started a chaos poll: ${activePoll.title}`);

    setTimeout(() => {
        finishChaosPoll(activePoll && activePoll.id);
    }, duration * 1000);

    return {
        success: true,
        message: `Poll started for ${duration}s.`
    };
}

function finishChaosPoll(pollId) {
    if (!activePoll || activePoll.id !== pollId) return;

    let winner = activePoll.options[0];
    let winnerVotes = -1;

    activePoll.options.forEach(eventId => {
        const votes = activePoll.votes[eventId] || 0;

        if (votes > winnerVotes) {
            winner = eventId;
            winnerVotes = votes;
        }
    });

    const event = CHAOS_EVENTS[winner];

    io.emit("poll ended", {
        id: activePoll.id,
        winner: event,
        votes: activePoll.votes
    });

    sendGlobalSystemMessage(`🗳️ ${event.name} won the chaos poll with ${winnerVotes} votes!`);

    emitChaosEvent(winner, "The voters");

    activePoll = null;
}

function voteInPoll(socket, eventId) {
    if (!activePoll) {
        socket.emit("poll reply", "No poll is currently running.");
        return;
    }

    if (!activePoll.options.includes(eventId)) {
        socket.emit("poll reply", "That is not a poll option.");
        return;
    }

    activePoll.voters[socket.id] = eventId;

    activePoll.votes = {};

    Object.values(activePoll.voters).forEach(vote => {
        activePoll.votes[vote] = (activePoll.votes[vote] || 0) + 1;
    });

    io.emit("poll update", {
        id: activePoll.id,
        votes: activePoll.votes
    });
}

/* =========================
   RANDOM CHAOS
========================= */

function getRandomChaosEventId(includeLegendary = false) {
    const pool = Object.values(CHAOS_EVENTS)
        .filter(event => includeLegendary || event.rarity !== "legendary")
        .map(event => event.id);

    return pickRandom(pool);
}

function maybeStartRandomChaos() {
    if (onlineUsers.size === 0) return;
    if (activePoll) return;

    const shouldDoRandomChaos = Math.random() < 0.18;

    if (!shouldDoRandomChaos) return;

    const shouldStartPoll = Math.random() < 0.2642;

    if (shouldStartPoll) {
        const options = [
            getRandomChaosEventId(false),
            getRandomChaosEventId(false),
            getRandomChaosEventId(true)
        ];

        const uniqueOptions = [...new Set(options)];

        while (uniqueOptions.length < 3) {
            uniqueOptions.push(getRandomChaosEventId(true));
        }

        startChaosPoll(
            "The cheese gods",
            30,
            "Which chaos should happen?",
            [...new Set(uniqueOptions)].slice(0, 3)
        );

        return;
    }

    const eventId = getRandomChaosEventId(true);
    emitChaosEvent(eventId, "The cheese gods");
}

setInterval(maybeStartRandomChaos, 180000);

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

    if (isOwnerName(username)) {
        return res.json({
            success: false,
            message: "You dare impersonate me?!"
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

    getPlayerProfile(username);

    res.json({
        success: true,
        message: "Account created."
    });
});

app.post("/login", async (req, res) => {

    if (isServerShutdownActive()) {
        const username = cleanUsername(req.body.username);
        const password = String(req.body.password || "");

        const isOwnerLogin =
            username === ADMIN_LOGIN_USERNAME &&
            password === ADMIN_PASSWORD;

        if (!isOwnerLogin) {
            return res.json({
                success: false,
                message: `Server is temporarily offline. Try again in ${Math.ceil(shutdownRemainingMs() / 60000)} minute(s).`
            });
        }
    }

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
            admin: true,
            limitedAdmin: false,
            adminUntil: 0
        });

        getPlayerProfile(ADMIN_DISPLAY_NAME);

        return res.json({
            success: true,
            username: ADMIN_DISPLAY_NAME,
            token,
            admin: true,
            limitedAdmin: false
        });
    }

    if (isOwnerName(username)) {
        return res.json({
            success: false,
            message: "You dare impersonate me?!"
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
    const tempAdminUntil = getTempAdminExpiry(user.username);
    const hasTempAdmin = tempAdminUntil > Date.now();

    sessions.set(token, {
        username: user.username,
        realUsername: user.username,
        admin: hasTempAdmin,
        limitedAdmin: hasTempAdmin,
        adminUntil: hasTempAdmin ? tempAdminUntil : 0
    });

    getPlayerProfile(user.username);

    res.json({
        success: true,
        username: user.username,
        token,
        admin: hasTempAdmin,
        limitedAdmin: hasTempAdmin,
        adminUntil: hasTempAdmin ? tempAdminUntil : 0
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
        if (!canRunEvents(session) && !canGiveInventory(session)) {
            socket.emit("admin reply", "You are not an admin.");
            return;
        }

        if (handleSpecialChaosCommand(socket, raw, session)) {
            return;
        }

        if (!canRunEvents(session)) {
            denyLimitedAdmin(socket);
            return;
        }

        const result = runChaosCommand(raw, session.username);
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

    if (!hasFullAdmin(session)) {
        const safeLimitedCommand =
            (commandName === "announcement" && canRunAnnouncements(session)) ||
            (commandName === "startpoll" && canRunEvents(session)) ||
            (commandName === "setseason" && canRunEvents(session));

        if (!safeLimitedCommand) {
            denyLimitedAdmin(socket);
            return;
        }
    }

    if (commandName === "admin") {
        const args = splitCommandArgs(commandBody);
        const playerName = args[0];
        const duration = args[1] || "10m";
        const ms = parseDurationToMs(duration);

        if (!playerName || !ms) {
            socket.emit("admin reply", "Usage: ;/Admin: <Player>, <10m>");
            return;
        }

        if (isOwnerName(playerName)) {
            socket.emit("admin reply", "The owner is already protected admin.");
            return;
        }

        const expiresAt = Date.now() + ms;
        tempAdmins.set(getPlayerKey(playerName), expiresAt);

        for (const storedSession of sessions.values()) {
            if (getPlayerKey(storedSession.username) === getPlayerKey(playerName)) {
                storedSession.admin = true;
                storedSession.limitedAdmin = true;
                storedSession.adminUntil = expiresAt;
            }
        }

        for (const [socketId, online] of onlineUsers.entries()) {
            if (getPlayerKey(online.username) === getPlayerKey(playerName)) {
                online.isAdmin = true;
                const targetSocket = io.sockets.sockets.get(socketId);
                if (targetSocket) {
                    targetSocket.emit("admin status", { admin: true, limitedAdmin: true, adminUntil: expiresAt });
                    targetSocket.emit("admin reply", `You were given limited admin for ${duration}.`);
                }
            }
        }

        emitOnlineUsers();
        socket.emit("admin reply", `${playerName} now has limited admin for ${duration}.`);
        return;
    }

    if (commandName === "warning") {
        const args = splitCommandArgs(commandBody);
        const playerName = args[0];
        const warningText = args.slice(1).join(", ");

        if (!playerName || !warningText) {
            socket.emit("admin reply", "Usage: ;/Warning: <Player>, <Text>");
            return;
        }

        if (isOwnerName(playerName)) {
            socket.emit("admin reply", "You cannot warn the owner.");
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

        if (isOwnerName(playerName)) {
            socket.emit("admin reply", "You cannot ban the owner.");
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

        if (isOwnerName(playerName)) {
            socket.emit("admin reply", "You cannot temp ban the owner.");
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

        if (isOwnerName(playerName)) {
            socket.emit("admin reply", "You cannot mute the owner.");
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

    if (commandName === "unmute") {
        const args = splitCommandArgs(commandBody);
        const playerName = args[0];

        if (!playerName) {
            socket.emit("admin reply", "Usage: ;/Unmute: <Player>");
            return;
        }

        mutedUsers.delete(playerName.toLowerCase());

        const target = getOnlineUserByName(playerName);

        if (target) {
            io.to(target.socketId).emit("message rejected", "You were unmuted.");
        }

        socket.emit("admin reply", `${playerName} was unmuted.`);
        return;
    }

    if (commandName === "setseason") {
        const args = splitCommandArgs(commandBody);
        const season = args[0];
        const duration = args[1] || "10m";
        const result = setSeason(season, duration, session.username);
        socket.emit("admin reply", result.message);
        return;
    }

    if (commandName === "addserverlifetime") {
        const args = splitCommandArgs(commandBody);
        const tempServerName = args[0];
        const duration = args[1] || "30m";

        if (!tempServerName) {
            socket.emit("admin reply", "Usage: ;/AddServerLifetime: <TempServer>, <Duration>");
            return;
        }

        const result = addTempServerLifetime(tempServerName, duration);
        socket.emit("admin reply", result.message);
        return;
    }

    if (commandName === "removeserver") {
        const args = splitCommandArgs(commandBody);
        const tempServerName = args[0];

        if (!tempServerName) {
            socket.emit("admin reply", "Usage: ;/RemoveServer: <TempServer>");
            return;
        }

        const result = removeTempServer(tempServerName);
        socket.emit("admin reply", result.message);
        return;
    }


    if (commandName === "cancelshutdown" || commandName === "cancel shutdown") {
        if (scheduledShutdownTimeout) {
            clearTimeout(scheduledShutdownTimeout);
            scheduledShutdownTimeout = null;
        }

        if (typeof shutdownUntil !== "undefined") {
            shutdownUntil = 0;
        }

        if (typeof offlineUntil !== "undefined") {
            offlineUntil = 0;
        }

        io.emit("system notice", "✅ Scheduled server shutdown cancelled.");
        socket.emit("admin reply", "Scheduled shutdown cancelled.");
        addAdminLog(session.username, "cancel shutdown", "", "Cancelled scheduled server shutdown");
        return;
    }

    if (commandName === "shutdown") {
        const args = splitCommandArgs(commandBody);
        const duration = args[0];
        const reason = args.slice(1).join(", ") || "Scheduled maintenance.";

        if (!duration) {
            socket.emit("admin reply", "Usage: ;/Shutdown: <10m>, <Reason>");
            return;
        }

        const result = startScheduledShutdown(duration, reason);
        socket.emit("admin reply", result.message);
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

    if (commandName === "givecoins") {
        const args = splitCommandArgs(commandBody);
        const playerName = args[0];
        const amount = Number(args[1]);

        if (!playerName || !Number.isFinite(amount)) {
            socket.emit("admin reply", "Usage: ;/GiveCoins: <Player>, <Amount>");
            return;
        }

        addCoins(playerName, amount);
        socket.emit("admin reply", `${amount} Cheese Coins given to ${playerName}.`);
        return;
    }

    if (commandName === "setcoins") {
        const args = splitCommandArgs(commandBody);
        const playerName = args[0];
        const amount = Number(args[1]);

        if (!playerName || !Number.isFinite(amount)) {
            socket.emit("admin reply", "Usage: ;/SetCoins: <Player>, <Amount>");
            return;
        }

        setCoins(playerName, amount);
        socket.emit("admin reply", `${playerName}'s Cheese Coins set to ${amount}.`);
        return;
    }

    if (commandName === "givetokens") {
        const args = splitCommandArgs(commandBody);
        const playerName = args[0];
        const amount = Number(args[1]);

        if (!playerName || !Number.isFinite(amount)) {
            socket.emit("admin reply", "Usage: ;/GiveTokens: <Player>, <Amount>");
            return;
        }

        addTokens(playerName, amount);
        emitPlayerDataByUsername(playerName);
        socket.emit("admin reply", `${amount} Cheese Tokens given to ${playerName}.`);
        return;
    }

    if (commandName === "settokens") {
        const args = splitCommandArgs(commandBody);
        const playerName = args[0];
        const amount = Number(args[1]);

        if (!playerName || !Number.isFinite(amount)) {
            socket.emit("admin reply", "Usage: ;/SetTokens: <Player>, <Amount>");
            return;
        }

        setTokens(playerName, amount);
        emitPlayerDataByUsername(playerName);
        socket.emit("admin reply", `${playerName}'s Cheese Tokens set to ${amount}.`);
        return;
    }

    if (commandName === "clearchat") {
        const room = getRoomOfSocket(socket.id);

        roomMessages[room] = [];

        io.to(room).emit("room data", {
            room,
            socketId: socket.id,
            roomInfo: rooms[room],
            messages: roomMessages[room]
        });

        sendSystemMessage(`🧹 Chat cleared by ${session.username}.`, room);
        socket.emit("admin reply", `Cleared ${(getRoomInfoById(room)?.name || room)}.`);
        return;
    }

    if (commandName === "startpoll") {
        const args = splitCommandArgs(commandBody);
        const time = Number(args[0]);
        const title = args[1];
        const eventsRaw = args.slice(2).join(",");

        if (!Number.isFinite(time) || !title || !eventsRaw) {
            socket.emit(
                "admin reply",
                "Usage: ;/StartPoll: <time>, <polltitle>, <event1|event2|event3>"
            );
            return;
        }

        const eventIds = parsePollEvents(eventsRaw);
        const result = startChaosPoll(session.username, time, title, eventIds);

        socket.emit("admin reply", result.message);
        return;
    }

    if (commandName === "announcement") {
        if (!commandBody) {
            socket.emit("admin reply", "Usage: ;/Announcement: <Message>");
            return;
        }

        io.emit("admin announcement", commandBody);
        sendGlobalSystemMessage(`📢 ${commandBody}`);
        socket.emit("admin reply", "Announcement sent.");
        return;
    }

    socket.emit("admin reply", `Unknown command: ${commandName}`);
}



function registerChaosCombo(type) {
    const now = Date.now();
    recentChaosEvents.push({ type, at: now });

    while (recentChaosEvents.length && now - recentChaosEvents[0].at > 60000) {
        recentChaosEvents.shift();
    }

    const in20 = recentChaosEvents.filter(item => now - item.at <= 20000).length;
    const in30 = recentChaosEvents.filter(item => now - item.at <= 30000).length;
    const in60 = recentChaosEvents.length;

    if (in60 >= 5) {
        io.emit("chaos combo", { text: "CHAOS OVERLOAD", count: in60 });
        return;
    }

    if (in30 >= 3) {
        io.emit("chaos combo", { text: "CHAOS CHAIN", count: in30 });
        return;
    }

    if (in20 >= 2) {
        io.emit("chaos combo", { text: "COMBO x2", count: in20 });
    }
}

function normalizeChaosEventType(value) {
    const clean = String(value || "")
        .toLowerCase()
        .replace("+/", "")
        .replace(";/", "")
        .replace(/\\/g, "")
        .replace(/[^a-z0-9]/g, "");

    const aliases = {
        cheeserain: "cheeseRain",
        cheesestorm: "cheeseStorm",
        singularicheese: "singularicheese",
        mouserun: "mouseRun",
        meltui: "meltUI",
        butterflood: "butterFlood",
        butterbomb: "butterBomb",
        lactosebomb: "lactoseBomb",
        cheesequake: "cheeseQuake",
        cheeseportal: "cheesePortal",
        mouldtakeover: "mouldTakeover",
        moldtakeover: "mouldTakeover",
        cheesemoon: "cheeseMoon",
        giantmousetrap: "giantMouseTrap",
        cheesemeteor: "cheeseMeteor",
        cheesenado: "cheesenado",
        clearvisuals: "clearVisuals"
    };

    return aliases[clean] || clean;
}


function getChaosIncreaseForEvent(eventId) {
    const normalized = normalizeChaosEventType(eventId);

    if (normalized === "clearVisuals") return 0;

    const event =
        CHAOS_EVENTS[normalized] ||
        Object.values(CHAOS_EVENTS).find(item => normalizeChaosEventType(item.id || item.name) === normalized);

    const rarity = event && event.rarity ? event.rarity : "common";

    const scale = {
        common: 10,
        uncommon: 15,
        rare: 22,
        epic: 30,
        legendary: 45
    };

    return scale[rarity] || 10;
}


function prettyChaosEventName(type) {
    const names = {
        cheeseRain: "Cheese Rain",
        cheeseStorm: "Cheese Storm",
        singularicheese: "Singularicheese",
        mouseRun: "Mouse Run",
        meltUI: "Melt UI",
        butterFlood: "Butter Flood",
        butterBomb: "Butter Bomb",
        lactoseBomb: "Lactose Bomb",
        cheeseQuake: "Cheesequake",
        cheesePortal: "Cheese Portal",
        mouldTakeover: "Mould Takeover",
        cheeseMoon: "Cheese Moon",
        giantMouseTrap: "Giant Mouse Trap",
        cheeseMeteor: "Cheese Meteor",
        cheesenado: "Cheesenado",
        clearVisuals: "Clear Visuals"
    };

    return names[type] || "Chaos Event";
}


function handleSpecialChaosCommand(socket, command, session) {
    const raw = String(command || "").trim();


    
    const setSeasonMatch = raw.match(/^\+\/SetSeason:\s*([^,]+),\s*([^\\]+)\\?$/i);

    if (setSeasonMatch) {
        if (!hasFullAdmin(session)) {
            denyLimitedAdmin(socket);
            return true;
        }

        const result = setSeason(setSeasonMatch[1], setSeasonMatch[2], session.username);
        socket.emit("admin reply", result.message);
        return true;
    }

const cheeseRngMatch = raw.match(/^\+\/CheeseRNG\\?$/i);

    if (cheeseRngMatch) {
        if (!canRunEvents(session)) {
            denyLimitedAdmin(socket);
            return true;
        }

        runCheeseRng(socket, session);
        return true;
    }

    const cheeseBankMatch = raw.match(/^\+\/CheeseBank\\?$/i);

    if (cheeseBankMatch) {
        if (!canRunEvents(session)) {
            denyLimitedAdmin(socket);
            return true;
        }

        spawnCheeseBank(socket);
        return true;
    }

    const giveCrateMatch = raw.match(/^\+\/GiveCrate:\s*([^,]+),\s*([^,]+)(?:,\s*([0-9]+))?\\?$/i);

    if (giveCrateMatch) {
        if (!canGiveInventory(session)) {
            denyLimitedAdmin(socket);
            return true;
        }

        const playerName = giveCrateMatch[1].trim();
        const crateId = resolveCrateId(giveCrateMatch[2].trim());
        const amount = safeNumber(giveCrateMatch[3], 1);

        if (!crateId) {
            socket.emit("admin reply", "That crate does not exist.");
            return true;
        }

        const result = giveRolledCrateToPlayer(playerName, crateId, amount);
        socket.emit("admin reply", result.message);
        return true;
    }

    const giveAbilityMatch = raw.match(/^\+\/Give:\s*([^,]+),\s*([^,]+)(?:,\s*([0-9]+))?\\?$/i);

    if (giveAbilityMatch) {
        if (!canGiveInventory(session)) {
            denyLimitedAdmin(socket);
            return true;
        }

        const playerName = giveAbilityMatch[1].trim();
        const eventId = resolveChaosEventId(giveAbilityMatch[2].trim());
        const amount = safeNumber(giveAbilityMatch[3], 1);

        if (!eventId) {
            socket.emit("admin reply", "That chaos ability does not exist.");
            return true;
        }

        const result = giveChaosEventToPlayer(playerName, eventId, amount);
        socket.emit("admin reply", result.message);
        return true;
    }

    const filterMatch = raw.match(/^\+\/Filter:\s*([^,]+),\s*(On|Off)\\?$/i);

    if (filterMatch) {
        const roomName = filterMatch[1].trim().toLowerCase();
        const setting = filterMatch[2].trim().toLowerCase();

        const roomId =
            roomName.includes("butter")
                ? "butter"
                : roomName.includes("blue")
                    ? "blueCheese"
                    : roomName.includes("mozzarella")
                        ? "mozzarella"
                        : "cheeseLounge";

        filterEnabled[roomId] = setting === "on";

        socket.emit(
            "admin reply",
            `${(getRoomInfoById(roomId)?.name || roomId)} filter is now ${setting}.`
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

function scheduleEvent(socket, commandText, delaySeconds, scheduledBy) {
    const delay = Math.max(1, Math.min(Number(delaySeconds) || 10, 3600));
    const id = makeId();

    const event = {
        id,
        commandText,
        delaySeconds: delay,
        scheduledBy,
        runAt: Date.now() + delay * 1000
    };

    scheduledEvents.push(event);
    emitScheduleState();

    setTimeout(() => {
        const stillExists = scheduledEvents.some(item => item.id === id);

        if (!stillExists) return;

        scheduledEvents = scheduledEvents.filter(item => item.id !== id);
        emitScheduleState();

        const commandName = normaliseChaosCommand(commandText);
        const eventType = chaosCommands[commandName];

        if (eventType) {
            emitChaosEvent(eventType, scheduledBy || "The scheduler");
            sendGlobalSystemMessage(
                `🧀 Scheduled chaos started: ${CHAOS_EVENTS[eventType]?.name || eventType}`
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

        const room = isRoomAvailable(data.room) ? data.room : "cheeseLounge";

        session.socketId = socket.id;
        session.room = room;
        socket.join(room);

        onlineUsers.set(socket.id, {
            username: session.username,
            realUsername: session.realUsername,
            isAdmin: isAdminSessionActive(session),
            room
        });

        socket.emit("admin status", {
            admin: isAdminSessionActive(session),
            limitedAdmin: isLimitedAdminSession(session),
            adminUntil: session.adminUntil || 0
        });

        socket.emit("room data", {
            room,
            roomInfo: getRoomInfoById(room),
            messages: getRoomMessagesById(room) || []
        });

        socket.emit("chaos level", chaosLevel);
        socket.emit("schedule state", scheduledEvents);

        if (activePoll) {
            socket.emit("poll started", {
                id: activePoll.id,
                title: activePoll.title,
                startedBy: activePoll.startedBy,
                options: activePoll.options.map(eventId => CHAOS_EVENTS[eventId]),
                endsAt: activePoll.endsAt
            });

            socket.emit("poll update", {
                id: activePoll.id,
                votes: activePoll.votes
            });
        }

        emitPlayerData(socket, session.username);
        emitOnlineUsers();

        if (!rooms[room].noChat) {
            sendSystemMessage(`${session.username} joined ${(getRoomInfoById(room)?.name || room)}.`, room);
        }
    });

    socket.on("switch room", roomId => {
        if (!session) return;

        const requestedRoomId = typeof roomId === "object" && roomId !== null ? roomId.roomId : roomId;
        const accessCode = typeof roomId === "object" && roomId !== null ? String(roomId.accessCode || "").trim() : "";
        roomId = requestedRoomId;

        if (!isRoomAvailable(roomId)) {
            socket.emit("message rejected", "That room does not exist anymore.");
            socket.emit("temp servers", getTempServerPublicData(session.username, hasFullAdmin(session)));
        socket.emit("season changed", { season: currentSeason, endsAt: seasonEndsAt });
            return;
        }

        const tempTarget = tempServers.find(item => item.id === roomId);

        if (tempTarget && tempTarget.private && !hasFullAdmin(session) && String(tempTarget.owner || "").toLowerCase() !== String(session.username || "").toLowerCase()) {
            if (String(tempTarget.accessCode || "").toLowerCase() !== accessCode.toLowerCase()) {
                socket.emit("message rejected", "Wrong private server code.");
                return;
            }
        }

        socket.leave(session.room);
        session.room = roomId;
        socket.join(roomId);

        const roomInfo = getRoomInfoById(roomId);
        const messages = getRoomMessagesById(roomId) || [];

        socket.emit("room data", {
            room: roomId,
            roomInfo,
            messages
        });

        emitOnlineUsers();

        if (activeCheeseBank && activeCheeseBank.room === roomId && !activeCheeseBank.claimed) {
            socket.emit("cheese bank spawned", activeCheeseBank);
        }
    });

    socket.on("chat message", data => {
        if (!session) return;

        const roomId = isRoomAvailable(data.room) ? data.room : "cheeseLounge";
        const room = rooms[roomId];
        const text = String(data.text || "").trim();

        if (!text) return;

        const diceMatch = text.match(/^\/d([0-9]{1,3})$/i);

        if (diceMatch) {
            const sides = Math.max(2, Math.min(100, Number(diceMatch[1])));
            const result = Math.floor(Math.random() * sides) + 1;
            sendSystemMessage(`🎲 ${session.username} rolled d${sides}: ${result}`, session.room);
            return;
        }

        if (text.toLowerCase().startsWith("/w ")) {
            const whisperMatch = text.match(/^\/w\s+([^\s]+)\s+"(.+)"$/i);

            if (!whisperMatch) {
                socket.emit("message rejected", 'Whisper format: /w Player "message"');
                return;
            }

            const targetName = whisperMatch[1];
            const whisperText = whisperMatch[2].slice(0, 200);
            const target = getOnlineUserByName(targetName);

            if (!target) {
                socket.emit("message rejected", `${targetName} is not online.`);
                return;
            }

            io.to(target.socketId).emit("whisper", {
                from: session.username,
                text: whisperText
            });

            socket.emit("message rejected", `Whisper sent to ${target.user.username}.`);
            return;
        }

        if (text.length > 100) {
            socket.emit("message rejected", "Messages can only be 100 characters.");
            return;
        }

        if (room.readOnly || room.noChat) {
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

        const coinResult = awardChatCoins(session.username, !!replyTo);

        const message = {
            id: makeId(),
            username: visualNameOverride || session.username,
            realUsername: session.username,
            text,
            time: nowTime(),
            room: roomId,
            replyTo,
            reactions: {},
            coinsEarned: coinResult.earned
        };

        addMessageToRoom(roomId, message);

        io.to(roomId).emit("chat message", message);

        emitPlayerData(socket, session.username);

        if (coinResult.earned > 0) {
            socket.emit("coin notice", `+${coinResult.earned} 🧀`);
        }
    });

    socket.on("react message", data => {
        if (!session) return;

        const roomId = isRoomAvailable(data.room) ? data.room : "cheeseLounge";
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

        const roomId = isRoomAvailable(data.room) ? data.room : "cheeseLounge";

        socket.to(roomId).emit("typing", {
            room: roomId,
            username: session.username
        });
    });

    socket.on("stop typing", data => {
        if (!session) return;

        const roomId = isRoomAvailable(data.room) ? data.room : "cheeseLounge";

        socket.to(roomId).emit("stop typing", {
            room: roomId
        });
    });

    socket.on("request player data", () => {
        if (!session) return;

        emitPlayerData(socket, session.username);
    });

    socket.on("request profile", username => {
        if (!session) return;

        const profileName = cleanUsername(username || session.username);

        socket.emit("profile data", getPublicPlayerData(profileName));
    });

    socket.on("buy chaos crate", crateId => {
        if (!session) return;

        const result = rollChaosCrate(crateId);

        if (!result) {
            socket.emit("shop reply", "That crate does not exist.");
            return;
        }

        const payment = removeCoins(session.username, result.crate.price);

        if (!payment.success) {
            socket.emit(
                "shop reply",
                `You need ${result.crate.price} Cheese Coins for a ${result.crate.name}.`
            );

            emitPlayerData(socket, session.username);
            return;
        }

        let profile = addInventoryItem(session.username, result.event.id, 1);
        markEventWitnessed(session.username, result.event.id);
        profile.cratesOpened += 1;
        savePlayerProfile(profile);

        socket.emit("crate opened", {
            crate: result.crate,
            reward: result.event
        });

        if (
            result.event.rarity === "epic" ||
            result.event.rarity === "legendary"
        ) {
            sendGlobalSystemMessage(
                `${session.username} unboxed ${result.event.name} ${result.event.icon} from a ${result.crate.name}!`
            );
        }

        emitPlayerData(socket, session.username);
    });

    socket.on("open swiss crate", () => {
        if (!session) return;

        const payment = removeCoins(session.username, SWISS_CRATE.price);

        if (!payment.success) {
            socket.emit(
                "shop reply",
                `You need ${SWISS_CRATE.price} Cheese Coins for a Swiss Crate.`
            );

            emitPlayerData(socket, session.username);
            return;
        }

        const profile = getPlayerProfile(session.username);

        profile.cratesOpened += 1;
        savePlayerProfile(profile);

        const choices = rollCosmeticChoice(session.username);

        socket.emit("cosmetic choice", {
            choices
        });

        emitPlayerData(socket, session.username);
    });

    socket.on("choose cosmetic", cosmeticId => {
        if (!session) return;

        const cosmetic = COSMETICS[cosmeticId];

        if (!cosmetic) {
            socket.emit("shop reply", "That cosmetic does not exist.");
            return;
        }

        const profile = getPlayerProfile(session.username);
        const duplicate = !!profile.index.cosmeticsOwned[cosmetic.id];

        if (duplicate) {
            const coins = DUPLICATE_COSMETIC_COINS[cosmetic.rarity] || 0;
            addCoins(session.username, coins);

            socket.emit(
                "shop reply",
                `Duplicate ${cosmetic.name}! Converted into ${coins} Cheese Coins.`
            );
        } else {
            markCosmeticOwned(session.username, cosmetic.id);

            socket.emit(
                "shop reply",
                `${cosmetic.name} added to your Cheese Index!`
            );
        }

        emitPlayerData(socket, session.username);
    });

    socket.on("equip cosmetic", cosmeticId => {
        if (!session) return;

        const cosmetic = COSMETICS[cosmeticId];

        if (!cosmetic) {
            socket.emit("shop reply", "That cosmetic does not exist.");
            return;
        }

        const profile = getPlayerProfile(session.username);

        if (!profile.index.cosmeticsOwned[cosmeticId]) {
            socket.emit("shop reply", "You do not own that cosmetic.");
            return;
        }

        profile.equippedCosmetics[cosmetic.type] = cosmeticId;

        savePlayerProfile(profile);

        socket.emit("shop reply", `${cosmetic.name} equipped.`);
        emitPlayerData(socket, session.username);
    });

    socket.on("set favourite event", eventId => {
        if (!session) return;

        const event = CHAOS_EVENTS[eventId];

        if (!event) {
            socket.emit("shop reply", "That event does not exist.");
            return;
        }

        const profile = getPlayerProfile(session.username);

        if (
            !profile.index.eventsWitnessed[eventId] &&
            !profile.index.eventsUsed[eventId]
        ) {
            socket.emit("shop reply", "You need to discover that event first.");
            return;
        }

        profile.favouriteEvent = eventId;

        savePlayerProfile(profile);

        socket.emit("shop reply", `${event.name} is now your favourite event.`);
        emitPlayerData(socket, session.username);
    });

    socket.on("use chaos ability", eventId => {
        if (!session) return;

        const event = CHAOS_EVENTS[eventId];

        if (!event) {
            socket.emit("shop reply", "That chaos ability does not exist.");
            return;
        }

        const profile = getPlayerProfile(session.username);
        const now = Date.now();
        const cooldown = 60 * 1000;
        const remaining = cooldown - (now - profile.lastChaosUsedAt);

        if (remaining > 0) {
            socket.emit(
                "shop reply",
                `Chaos ability cooling down. Wait ${Math.ceil(remaining / 1000)}s.`
            );

            emitPlayerData(socket, session.username);
            return;
        }

        const removed = removeInventoryItem(session.username, eventId);

        if (!removed.success) {
            socket.emit("shop reply", "You do not have that chaos ability.");
            emitPlayerData(socket, session.username);
            return;
        }

        const updatedProfile = getPlayerProfile(session.username);

        updatedProfile.lastChaosUsedAt = now;
        updatedProfile.chaosUsed += 1;
        updatedProfile.index.eventsUsed[eventId] = true;
        updatedProfile.index.eventsWitnessed[eventId] = true;

        savePlayerProfile(updatedProfile);

        emitChaosEvent(eventId, session.username);

        emitPlayerData(socket, session.username);
    });

    socket.on("vote poll", eventId => {
        if (!session) return;

        voteInPoll(socket, eventId);
    });


    socket.on("request admin status", payload => {
        const adminSession = getSessionFromSocketOrPayload(socket, payload);

        socket.emit("admin status", {
            admin: !!adminSession && canUseAdminPanel(adminSession)
        });
    });

    socket.on("admin command", payload => {
        const adminSession = getSessionFromSocketOrPayload(socket, payload);
        const command = normalizeAdminCommandPayload(payload).trim();

        if (!adminSession || !canUseAdminPanel(adminSession)) {
            socket.emit("admin reply", "You are not an admin.");
            return;
        }

        if (!command) {
            socket.emit("admin reply", "Enter a command first.");
            return;
        }

        addAdminLog(adminSession.username, "command", "", command);
        handleAdminTextCommand(socket, adminSession, command);
    });

    socket.on("schedule event", data => {
        const adminSession = getSessionFromSocketOrPayload(socket, data);

        if (!adminSession || !canRunEvents(adminSession)) {
            socket.emit("admin reply", "You are not an admin.");
            return;
        }

        const commandText = String(data && data.commandText || "").trim();
        const delaySeconds = Math.max(1, Math.min(3600, safeNumber(data && data.delaySeconds, 10)));

        if (!commandText) {
            socket.emit("admin reply", "Choose a command to schedule.");
            return;
        }

        const event = {
            id: makeId(),
            commandText,
            runAt: Date.now() + delaySeconds * 1000,
            scheduledBy: adminSession.username,
            timeout: null
        };

        event.timeout = setTimeout(() => {
            scheduledEvents = scheduledEvents.filter(item => item.id !== event.id);
            executeScheduledCommand(commandText, adminSession.username);
            emitScheduleState();
        }, delaySeconds * 1000);

        scheduledEvents.push(event);
        emitScheduleState();

        socket.emit("admin reply", `${commandText} scheduled in ${delaySeconds}s.`);
    });

    socket.on("cancel scheduled event", id => {
        if (!session || !hasFullAdmin(session)) return;

        scheduledEvents = scheduledEvents.filter(event => event.id !== id);
        emitScheduleState();

        socket.emit("admin reply", "Scheduled event cancelled.");
    });


    socket.on("claim cheese bank", data => {
        if (!session) return;

        if (!activeCheeseBank || activeCheeseBank.claimed) {
            socket.emit("message rejected", "That Cheese Bank is already gone.");
            return;
        }

        if (String(data && data.id) !== String(activeCheeseBank.id)) {
            socket.emit("message rejected", "That Cheese Bank is already gone.");
            return;
        }

        activeCheeseBank.claimed = true;

        const reward = activeCheeseBank.reward || 50;
        addCoins(session.username, reward);
        emitPlayerData(socket, session.username);

        io.emit("cheese bank ended", activeCheeseBank.id);
        io.emit("system notice", `💰 ${session.username} robbed the Cheese Bank and got ${reward} Cheese Coins!`);

        activeCheeseBank = null;
    });


    socket.on("create temp server", data => {
        if (!session) return;

        const result = createTempServer(session, data);

        if (!result.ok) {
            socket.emit("message rejected", result.message);
            return;
        }

        socket.emit("system notice", result.message);
        io.emit("system notice", `🟨 ${session.username} created temp server ${result.server.icon} ${result.server.name}.`);
    });

    socket.on("request temp servers", () => {
        if (!session) return;
        socket.emit("temp servers", getTempServerPublicData(session.username, hasFullAdmin(session)));
    });


    socket.on("trade cheese token", () => {
        if (!session) return;

        const spent = spendTokens(session.username, 1);

        if (!spent.ok) {
            socket.emit("shop reply", spent.message);
            return;
        }

        addCoins(session.username, 1250);
        emitPlayerData(socket, session.username);
        socket.emit("shop reply", "Traded 1 Cheese Token for 1250 Cheese Coins.");
    });

    socket.on("open chaos crate with token", crateId => {
        if (!session) return;

        const crate = CHAOS_CRATES[crateId];

        if (!crate) {
            socket.emit("shop reply", "That crate does not exist.");
            return;
        }

        const spent = spendTokens(session.username, 1);

        if (!spent.ok) {
            socket.emit("shop reply", spent.message);
            return;
        }

        const result = rollChaosCrate(crateId);
        const profile = getPlayerProfile(session.username);

        profile.inventory[result.event.id] = safeNumber(profile.inventory[result.event.id], 0) + 1;
        profile.index.eventsWitnessed[result.event.id] = true;
        profile.cratesOpened = safeNumber(profile.cratesOpened, 0) + 1;

        savePlayerProfile(profile);
        checkAchievements(session.username);

        socket.emit("crate opened", {
            crate,
            reward: result.event,
            result
        });

        emitPlayerData(socket, session.username);
    });

    socket.on("open swiss crate with token", () => {
        if (!session) return;

        const spent = spendTokens(session.username, 1);

        if (!spent.ok) {
            socket.emit("shop reply", spent.message);
            return;
        }

        const choices = rollCosmeticChoice(session.username);

        socket.emit("cosmetic choice", {
            choices
        });

        emitPlayerData(socket, session.username);
    });

    socket.on("unlock index with token", data => {
        if (!session) return;

        const result = unlockAnyIndexEntryWithToken(session.username, data && data.type, data && data.id);

        if (!result.ok) {
            socket.emit("shop reply", result.message);
            return;
        }

        emitPlayerData(socket, session.username);
        socket.emit("shop reply", result.message);
    });


    socket.on("request active cheese bank", roomId => {
        if (!session) return;

        if (activeCheeseBank && !activeCheeseBank.claimed && activeCheeseBank.room === roomId) {
            socket.emit("cheese bank spawned", activeCheeseBank);
        }
    });


    socket.on("kick from temp server", data => {
        const adminSession = getSessionFromSocketOrPayload(socket, data) || session;
        if (!adminSession) return;

        const serverId = data && data.serverId;
        const targetUsername = String(data && data.targetUsername || "").trim();
        const temp = tempServers.find(item => item.id === serverId);

        if (!temp) {
            socket.emit("message rejected", "Temp server not found.");
            return;
        }

        if (String(temp.owner || "").toLowerCase() !== String(adminSession.username || "").toLowerCase()) {
            socket.emit("message rejected", "Only the temp server owner can do that.");
            return;
        }

        const target = getOnlineUserByName(targetUsername);

        if (!target) {
            socket.emit("message rejected", "That player is not online.");
            return;
        }

        const targetSocket = io.sockets.sockets.get(target.socketId);

        if (targetSocket) {
            targetSocket.leave(temp.id);
            targetSocket.join("cheeseLounge");

            const targetSession = getSessionBySocketId(target.socketId);

            if (targetSession) {
                targetSession.room = "cheeseLounge";
            }

            targetSocket.emit("room data", {
                room: "cheeseLounge",
                roomInfo: getRoomInfoById("cheeseLounge"),
                messages: getRoomMessagesById("cheeseLounge") || []
            });

            targetSocket.emit("message rejected", `You were removed from ${temp.name}.`);
        }

        emitOnlineUsers();
        socket.emit("message rejected", `${targetUsername} was removed from ${temp.name}.`);
    });

    socket.on("set temp server topic", data => {
        const adminSession = getSessionFromSocketOrPayload(socket, data) || session;
        if (!adminSession) return;

        const serverId = data && data.serverId;
        const topic = String(data && data.topic || "").trim().slice(0, 80);
        const temp = tempServers.find(item => item.id === serverId);

        if (!temp) {
            socket.emit("message rejected", "Temp server not found.");
            return;
        }

        if (String(temp.owner || "").toLowerCase() !== String(adminSession.username || "").toLowerCase()) {
            socket.emit("message rejected", "Only the temp server owner can do that.");
            return;
        }

        temp.topic = topic;
        emitTempServers();
        io.to(temp.id).emit("system message", {
            room: temp.id,
            text: topic ? `📌 Topic: ${topic}` : "📌 Topic cleared."
        });
    });



    socket.on("send friend request", data => {
        if (!session) return;

        const targetUsername = String(data && data.targetUsername || "").trim();

        if (!targetUsername || targetUsername.toLowerCase() === session.username.toLowerCase()) {
            socket.emit("message rejected", "Choose another player.");
            return;
        }

        const sender = getPlayerProfile(session.username);
        const target = getPlayerProfile(targetUsername);

        if (sender.friends.includes(target.username)) {
            socket.emit("message rejected", "You are already friends.");
            return;
        }

        if (!target.friendRequests.includes(sender.username)) {
            target.friendRequests.push(sender.username);
            savePlayerProfile(target);
        }

        const targetSocket = getSocketByUsername(target.username);

        if (targetSocket) {
            targetSocket.emit("friend request", {
                from: sender.username
            });
        }

        socket.emit("message rejected", `Friend request sent to ${target.username}.`);
    });

    socket.on("accept friend", data => {
        if (!session) return;

        const fromUsername = String(data && data.from || "").trim();
        const me = getPlayerProfile(session.username);
        const other = getPlayerProfile(fromUsername);

        const hasRequest = me.friendRequests
            .map(name => String(name).toLowerCase())
            .includes(String(other.username).toLowerCase());

        if (!hasRequest) {
            socket.emit("message rejected", "No friend request from that player.");
            return;
        }


        if (!me.friends.includes(other.username)) me.friends.push(other.username);
        if (!other.friends.includes(me.username)) other.friends.push(me.username);

        me.friendRequests = me.friendRequests.filter(name => name.toLowerCase() !== other.username.toLowerCase());

        savePlayerProfile(me);
        savePlayerProfile(other);

        emitPlayerData(socket, me.username);
        emitPlayerDataByName(other.username);

        const otherSocket = getSocketByUsername(other.username);

        if (otherSocket) {
            otherSocket.emit("message rejected", `${me.username} accepted your friend request.`);
        }

        socket.emit("message rejected", `You are now friends with ${other.username}.`);
        emitOnlineUsers();
    });

    socket.on("decline friend", data => {
        if (!session) return;

        const fromUsername = String(data && data.from || "").trim();
        const me = getPlayerProfile(session.username);

        me.friendRequests = me.friendRequests.filter(name => name.toLowerCase() !== fromUsername.toLowerCase());
        savePlayerProfile(me);

        emitPlayerData(socket, me.username);
        socket.emit("message rejected", "Friend request declined.");
    });

    socket.on("gift coins", data => {
        if (!session) return;

        const targetUsername = String(data && data.targetUsername || "").trim();
        const amount = Math.floor(Number(data && data.amount));

        if (!targetUsername || targetUsername.toLowerCase() === session.username.toLowerCase()) {
            socket.emit("message rejected", "You cannot gift yourself.");
            return;
        }

        if (!Number.isFinite(amount) || amount < 1 || amount > 500) {
            socket.emit("message rejected", "Gift amount must be 1–500 coins.");
            return;
        }

        const targetSocket = getSocketByUsername(targetUsername);

        if (!targetSocket) {
            socket.emit("message rejected", "That player must be online to receive a gift.");
            return;
        }

        const sender = getPlayerProfile(session.username);
        const target = getPlayerProfile(targetUsername);

        if (sender.lastGiftResetDate !== safeTodayKey()) {
            sender.dailyGiftedCoins = 0;
            sender.lastGiftResetDate = safeTodayKey();
        }

        if (!isPhillyCheese(session.username) && safeNumber(sender.dailyGiftedCoins, 0) + amount > 500) {
            socket.emit("message rejected", "Daily gift cap reached.");
            return;
        }

        if (!isPhillyCheese(session.username) && safeNumber(sender.coins, 0) < amount) {
            socket.emit("message rejected", "Not enough coins.");
            return;
        }

        if (!isPhillyCheese(session.username)) {
            sender.coins -= amount;
            sender.dailyGiftedCoins = safeNumber(sender.dailyGiftedCoins, 0) + amount;
            savePlayerProfile(sender);
        }

        addCoins(target.username, amount);

        emitPlayerData(socket, session.username);
        emitPlayerDataByName(target.username);

        socket.emit("message rejected", `Gifted ${amount} Cheese Coins to ${target.username}.`);
        targetSocket.emit("message rejected", `${session.username} gifted you ${amount} Cheese Coins 🎁`);
    });

    socket.on("request leaderboard", () => {
        if (!session) return;

        socket.emit("leaderboard data", getLeaderboard(session.username));
    });


    socket.on("request admin log", data => {
        const adminSession = getSessionFromSocketOrPayload(socket, data) || session;
        if (!adminSession || !hasFullAdmin(adminSession)) {
            socket.emit("admin reply", "Full admin only.");
            return;
        }

        socket.emit("admin log data", adminLog.slice(-100));
    });

    socket.on("request tutorial", data => {
        if (!session) return;
        if (session.room !== "feta") {
            socket.emit("message rejected", "That bot only works in Cheese Bots.");
            return;
        }
        const topic = String(data && data.topic || "basics").slice(0, 30);
        const lines = [
            `Welcome to CheeseWithFriends tutorial: ${topic}.`,
            "Use rooms on the left, earn cheese coins, and watch for chaos.",
            "Mozzarella is the shop. Cheddar is for temp servers. Cheese Bots is for robotic cheese helpers."
        ];
        lines.forEach((line, index) => setTimeout(() => sendFetaBotMessage("Tutorial Bot", line), 1200 * index));
    });

    socket.on("roll dice", data => {
        if (!session) return;
        if (session.room !== "feta") {
            socket.emit("message rejected", "That bot only works in Cheese Bots.");
            return;
        }
        const sides = Math.max(2, Math.min(100, Math.floor(Number(data && data.sides) || 6)));
        const result = Math.floor(Math.random() * sides) + 1;
        sendFetaBotMessage("Roller Bot", `${session.username} rolled d${sides}: ${result}`);
    });

    socket.on("ask trivia", () => {
        if (!session) return;
        if (session.room !== "feta") {
            socket.emit("message rejected", "That bot only works in Cheese Bots.");
            return;
        }
        if (Date.now() < triviaCooldownUntil) {
            socket.emit("message rejected", "Trivia is cooling down.");
            return;
        }
        triviaCooldownUntil = Date.now() + 30000;
        activeTrivia = triviaQuestions[Math.floor(Math.random() * triviaQuestions.length)];
        sendFetaBotMessage("Trivia Bot", `${activeTrivia.q} Options: ${activeTrivia.options.join(" / ")}`);
    });

    socket.on("answer trivia", data => {
        if (!session) return;

        if (session.room !== "feta") {
            socket.emit("message rejected", "That bot only works in Cheese Bots.");
            return;
        }

        if (!activeTrivia) return;
        const answer = String(data && data.answer || "").trim().toLowerCase();
        if (answer === activeTrivia.a.toLowerCase()) {
            addCoins(session.username, 25);
            emitPlayerData(socket, session.username);
            sendFetaBotMessage("Trivia Bot", `${session.username} got it right! +25 🧀`);
            activeTrivia = null;
        }
    });

    socket.on("coin flip", data => {
        if (!session) return;
        if (session.room !== "feta") {
            socket.emit("message rejected", "That bot only works in Cheese Bots.");
            return;
        }
        const wager = Math.max(0, Math.min(500, Math.floor(Number(data && data.wager) || 0)));
        const win = Math.random() >= 0.5;
        if (wager > 0) {
            const profile = getPlayerProfile(session.username);
            if (!isPhillyCheese(session.username) && profile.coins < wager) {
                socket.emit("message rejected", "Not enough coins.");
                return;
            }
            if (!isPhillyCheese(session.username)) {
                profile.coins -= wager;
                savePlayerProfile(profile);
            }
            if (win) addCoins(session.username, wager * 2);
            emitPlayerData(socket, session.username);
        }
        sendFetaBotMessage("Coin Flip Bot", `${session.username} flipped ${win ? "HEADS" : "TAILS"}${wager ? win ? ` and won ${wager} 🧀` : ` and lost ${wager} 🧀` : ""}`);
    });

    socket.on("disconnect", () => {
        const online = onlineUsers.get(socket.id);

        if (online && rooms[online.room] && !rooms[online.room].noChat) {
            sendSystemMessage(
                `${online.username} left ${rooms[online.room]?.name || "the room"}.`,
                online.room
            );
        }

        onlineUsers.delete(socket.id);
        emitOnlineUsers();
    });
});


setInterval(() => {
    const now = Date.now();
    let changed = false;

    for (let i = tempServers.length - 1; i >= 0; i--) {
        if (tempServers[i].expiresAt <= now) {
            io.emit("system notice", `🧀 ${tempServers[i].name} has melted away...`);
            tempServers.splice(i, 1);
            changed = true;
        }
    }

    if (changed) {
        emitTempServers();
    }
}, 15000);

server.listen(PORT, () => {
    console.log(`CheeseWithFriends running on port ${PORT} 🧀`);
});