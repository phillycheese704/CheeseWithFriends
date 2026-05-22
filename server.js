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

function normaliseReservedName(text) {
    return String(text || "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
}

function isPhillyCheeseShape(username) {
    return normaliseReservedName(username).includes("phillycheese");
}

function isExactAdminCredentials(username, password) {
    return username === ADMIN_LOGIN_USERNAME && password === ADMIN_PASSWORD;
}

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
    mozzarella: []
};

const filterEnabled = {
    cheeseLounge: true,
    butter: true,
    blueCheese: false,
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

        arcade: createDefaultArcadeData(),

        achievementsText: "Coming soon 🧀🏆"
    };
}


/* =========================
   CHEESE CLICKER / ARCADE
========================= */

const CHEESE_CLICKER_CLICK_UPGRADES = [
    { id: "cheddar", name: "Cheddar", icon: "🧀", perClick: 1, baseCost: 20, description: "Mild, savoury, and reliable" },
    { id: "matureCheddar", name: "Mature Cheddar", icon: "🧀", perClick: 2, baseCost: 80, description: "Rich, tangy, and sharp" },
    { id: "brie", name: "Brie", icon: "🧀", perClick: 5, baseCost: 120, description: "Oozing, creamy, and sophisticated" },
    { id: "gouda", name: "Gouda", icon: "🧀", perClick: 10, baseCost: 300, description: "Smooth and smoky" },
    { id: "swiss", name: "Swiss", icon: "🧀", perClick: 20, baseCost: 850, description: "Full of holes; full of potential" },
    { id: "blueCheese", name: "Blue Cheese", icon: "🧀", perClick: 50, baseCost: 2500, description: "Bold, mouldy, and extremely rich" },
    { id: "feta", name: "Feta", icon: "🧀", perClick: 75, baseCost: 4500, description: "Watery, crumbly, and great for salads" },
    { id: "mozzarella", name: "Mozzarella", icon: "⚪", perClick: 100, baseCost: 6000, description: "Mild, milky, and stretchy" },
    { id: "parmesan", name: "Parmesan", icon: "🧀", perClick: 125, baseCost: 7500, description: "Hard and salty" }
];

const CHEESE_CLICKER_HELPER_UPGRADES = [
    { id: "mouseHelper", name: "Mouse Helper", icon: "🐭", perSecond: 1, baseCost: 50, description: "A suspiciously helpful mouse" },
    { id: "ratHelper", name: "Rat Helper", icon: "🐀", perSecond: 5, baseCost: 180, description: "Bigger, faster, and slightly concerning" },
    { id: "hamsterHelper", name: "Hamster Helper", icon: "🐹", perSecond: 12, baseCost: 500, description: "Stores cheese in emergency cheeks" },
    { id: "cheeseChef", name: "Cheese Chef", icon: "🧑‍🍳", perSecond: 30, baseCost: 1600, description: "Crafts premium cheese nonstop" },
    { id: "mozzarellaStretcher", name: "Mozzarella Stretcher", icon: "⚪", perSecond: 80, baseCost: 4800, description: "Stretches cheese around the clock" },
    { id: "cheeseGoblin", name: "Cheese Goblin", icon: "👹", perSecond: 250, baseCost: 15000, description: "Lives entirely off stolen cheese" },
    { id: "cheeseDragon", name: "Cheese Dragon", icon: "🐉", perSecond: 1000, baseCost: 90000, description: "Sleeps on mountains of molten cheese" }
];

const CHEESEIFY_STEPS = [
    { level: 1, cost: 1000, multiplier: 1.25 },
    { level: 2, cost: 2000, multiplier: 1.5 },
    { level: 3, cost: 4000, multiplier: 1.75 },
    { level: 4, cost: 8000, multiplier: 2 },
    { level: 5, cost: 20000, multiplier: 4 }
];

function createDefaultArcadeData() {
    return {
        cheeseClicker: {
            cheese: 0,
            highestCheese: 0,
            totalCheeseMade: 0,
            totalClicks: 0,
            clickUpgrades: {},
            helperUpgrades: {},
            cheeseifyLevel: 0,
            cheeseifyMultiplier: 1,
            lastUpdatedAt: Date.now()
        }
    };
}

function ensureArcadeData(profile) {
    if (!profile.arcade) profile.arcade = createDefaultArcadeData();
    if (!profile.arcade.cheeseClicker) profile.arcade.cheeseClicker = createDefaultArcadeData().cheeseClicker;

    const c = profile.arcade.cheeseClicker;
    if (!c.clickUpgrades) c.clickUpgrades = {};
    if (!c.helperUpgrades) c.helperUpgrades = {};
    if (!Number.isFinite(c.cheese)) c.cheese = 0;
    if (!Number.isFinite(c.highestCheese)) c.highestCheese = 0;
    if (!Number.isFinite(c.totalCheeseMade)) c.totalCheeseMade = 0;
    if (!Number.isFinite(c.totalClicks)) c.totalClicks = 0;
    if (!Number.isFinite(c.cheeseifyLevel)) c.cheeseifyLevel = 0;
    if (!Number.isFinite(c.cheeseifyMultiplier) || c.cheeseifyMultiplier < 1) c.cheeseifyMultiplier = calculateCheeseifyMultiplier(c.cheeseifyLevel);
    if (!Number.isFinite(c.lastUpdatedAt)) c.lastUpdatedAt = Date.now();
    return c;
}

function getUpgradeCost(baseCost, level) {
    return Math.floor(baseCost * Math.pow(1.18, level));
}

function calculateCheeseifyMultiplier(level) {
    let multiplier = 1;

    for (let i = 1; i <= level; i++) {
        const step = CHEESEIFY_STEPS[i - 1];
        multiplier *= step ? step.multiplier : 4;
    }

    return Number(multiplier.toFixed(4));
}

function getCheeseifyCost(level) {
    const nextLevel = level + 1;
    const step = CHEESEIFY_STEPS[nextLevel - 1];
    if (step) return step.cost;
    return Math.floor(20000 * Math.pow(2.5, nextLevel - 5));
}

function getNextCheeseifyMultiplier(level) {
    const step = CHEESEIFY_STEPS[level];
    return step ? step.multiplier : 4;
}

function calculateClickPower(clicker) {
    let power = 1;

    for (const upgrade of CHEESE_CLICKER_CLICK_UPGRADES) {
        const level = clicker.clickUpgrades[upgrade.id] || 0;
        power += level * upgrade.perClick;
    }

    return power;
}

function calculateHelperPower(clicker) {
    let power = 0;

    for (const helper of CHEESE_CLICKER_HELPER_UPGRADES) {
        const level = clicker.helperUpgrades[helper.id] || 0;
        power += level * helper.perSecond;
    }

    return power;
}

function applyClickerOfflineProgress(profile) {
    const clicker = ensureArcadeData(profile);
    const now = Date.now();
    const elapsedSeconds = Math.min(3600, Math.max(0, (now - clicker.lastUpdatedAt) / 1000));
    const perSecond = calculateHelperPower(clicker) * clicker.cheeseifyMultiplier;
    const earned = Math.floor(perSecond * elapsedSeconds);

    if (earned > 0) {
        clicker.cheese += earned;
        clicker.totalCheeseMade += earned;
        if (clicker.cheese > clicker.highestCheese) clicker.highestCheese = clicker.cheese;
    }

    clicker.lastUpdatedAt = now;
    return clicker;
}

function getPublicClickerData(username) {
    const profile = getPlayerProfile(username);
    const clicker = applyClickerOfflineProgress(profile);
    clicker.cheeseifyMultiplier = calculateCheeseifyMultiplier(clicker.cheeseifyLevel);
    savePlayerProfile(profile);

    const rawClickPower = calculateClickPower(clicker);
    const rawHelperPower = calculateHelperPower(clicker);

    return {
        cheese: Math.floor(clicker.cheese),
        highestCheese: Math.floor(clicker.highestCheese),
        totalCheeseMade: Math.floor(clicker.totalCheeseMade),
        totalClicks: clicker.totalClicks,
        clickUpgrades: clicker.clickUpgrades,
        helperUpgrades: clicker.helperUpgrades,
        rawClickPower,
        rawHelperPower,
        cheeseifyLevel: clicker.cheeseifyLevel,
        cheeseifyMultiplier: clicker.cheeseifyMultiplier,
        cheesePerClick: Math.floor(rawClickPower * clicker.cheeseifyMultiplier),
        cheesePerSecond: Math.floor(rawHelperPower * clicker.cheeseifyMultiplier),
        nextCheeseifyCost: getCheeseifyCost(clicker.cheeseifyLevel),
        nextCheeseifyMultiplier: getNextCheeseifyMultiplier(clicker.cheeseifyLevel),
        clickUpgradeDefs: CHEESE_CLICKER_CLICK_UPGRADES,
        helperUpgradeDefs: CHEESE_CLICKER_HELPER_UPGRADES
    };
}

function emitCheeseClickerData(socket, username) {
    socket.emit("cheese clicker data", getPublicClickerData(username));
}

function getPlayerProfile(username) {
    const data = readPlayerDataFile();
    const key = getPlayerKey(username);

    if (!data.players[key]) {
        data.players[key] = createDefaultPlayerProfile(username);
        writePlayerDataFile(data);
    }

    ensureArcadeData(data.players[key]);
    return data.players[key];
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
        coins: profile.coins,
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
        bookCompletion: getBookCompletionPercent(profile),
        achievementsText: "Coming soon 🧀🏆",
        chaosEvents: CHAOS_EVENTS,
        cosmetics: COSMETICS,
        crates: CHAOS_CRATES,
        swissCrate: SWISS_CRATE,
        duplicateCoins: DUPLICATE_COSMETIC_COINS,
        arcade: {
            cheeseClicker: getPublicClickerData(username)
        }
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

function containsBlockedLanguage(text, roomId) {
    const room = rooms[roomId] || rooms.cheeseLounge;

    if (!filterEnabled[roomId]) return false;
    if (room.filterLevel === "none") return false;

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

    io.emit("chaos event", {
        type: cleanType,
        usedBy,
        eventName: event ? event.name : cleanType,
        icon: event ? event.icon : "🧀"
    });

    if (cleanType !== "clearvisuals") {
        increaseChaos(18);
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

    if (isPhillyCheeseShape(username)) {
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
    const username = cleanUsername(req.body.username);
    const password = String(req.body.password || "");

    if (!username || !password) {
        return res.json({
            success: false,
            message: "Enter a username and password."
        });
    }

    const isAdminLogin = isExactAdminCredentials(username, password);

    if (isPhillyCheeseShape(username) && !isAdminLogin) {
        return res.json({
            success: false,
            message: "You dare impersonate me?!"
        });
    }

    if (isAdminLogin) {
        const token = makeToken();

        sessions.set(token, {
            username: ADMIN_DISPLAY_NAME,
            realUsername: ADMIN_LOGIN_USERNAME,
            admin: true
        });

        getPlayerProfile(ADMIN_DISPLAY_NAME);

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

    getPlayerProfile(user.username);

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
        if (handleSpecialChaosCommand(socket, raw)) {
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

    if (commandName === "clearchat") {
        const room = getRoomOfSocket(socket.id);

        roomMessages[room] = [];

        io.to(room).emit("room data", {
            room,
            roomInfo: rooms[room],
            messages: roomMessages[room]
        });

        sendSystemMessage(`🧹 Chat cleared by ${session.username}.`, room);
        socket.emit("admin reply", `Cleared ${rooms[room].name}.`);
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


function runCheeseRng(socket) {
    const online = [...onlineUsers.entries()]
        .map(([socketId, user]) => ({ socketId, user }))
        .filter(entry => entry.user && entry.user.username);

    if (online.length === 0) {
        socket.emit("admin reply", "No players online for Cheese RNG.");
        return true;
    }

    const chosen = online[Math.floor(Math.random() * online.length)];
    const username = chosen.user.username;
    const targetSocket = io.sockets.sockets.get(chosen.socketId);
    const crateChance = Math.random() < 0.20;

    sendGlobalSystemMessage("🎲 CHEESE RNG has been activated...");
    sendGlobalSystemMessage(`👀 The cheese gods picked ${username}!`);

    if (crateChance) {
        const crateIds = Object.keys(CHAOS_CRATES);
        const crateId = crateIds[Math.floor(Math.random() * crateIds.length)];
        const result = rollChaosCrate(crateId);

        if (result && result.event) {
            addInventoryItem(username, result.event.id, 1);
            markEventWitnessed(username, result.event.id);
            sendGlobalSystemMessage(`🎁 ${username} won a ${result.crate.name} and pulled ${result.event.icon} ${result.event.name}!`);
        } else {
            const fallbackCoins = 100;
            addCoins(username, fallbackCoins);
            sendGlobalSystemMessage(`🎁 ${username} won ${fallbackCoins} Cheese Coins!`);
        }
    } else {
        const coins = Math.floor(Math.random() * 100) + 1;
        addCoins(username, coins);
        sendGlobalSystemMessage(`🧀 ${username} won ${coins} Cheese Coins!`);
    }

    if (targetSocket) {
        emitPlayerData(targetSocket, username);
    }

    socket.emit("admin reply", "Cheese RNG complete.");
    return true;
}

function handleSpecialChaosCommand(socket, command) {
    const raw = String(command || "").trim();

    if (/^\+\/CheeseRng\?$/i.test(raw) || /^\+\/CheeseRNG\?$/i.test(raw)) {
        return runCheeseRng(socket);
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
            sendSystemMessage(`${session.username} joined ${rooms[room].name}.`, room);
        }
    });

    socket.on("switch room", roomId => {
        if (!session) return;
        if (!rooms[roomId]) return;

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

        emitPlayerData(socket, session.username);
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


    socket.on("cheese clicker request", () => {
        if (!session) return;
        emitCheeseClickerData(socket, session.username);
    });

    socket.on("cheese clicker click", () => {
        if (!session) return;
        const profile = getPlayerProfile(session.username);
        const clicker = applyClickerOfflineProgress(profile);
        clicker.cheeseifyMultiplier = calculateCheeseifyMultiplier(clicker.cheeseifyLevel);
        const gained = Math.max(1, Math.floor(calculateClickPower(clicker) * clicker.cheeseifyMultiplier));

        clicker.cheese += gained;
        clicker.totalCheeseMade += gained;
        clicker.totalClicks += 1;
        if (clicker.cheese > clicker.highestCheese) clicker.highestCheese = clicker.cheese;
        clicker.lastUpdatedAt = Date.now();

        savePlayerProfile(profile);
        socket.emit("cheese clicker clicked", { gained });
        emitCheeseClickerData(socket, session.username);
    });

    socket.on("cheese clicker buy upgrade", data => {
        if (!session) return;
        const type = data && data.type;
        const id = data && data.id;
        const profile = getPlayerProfile(session.username);
        const clicker = applyClickerOfflineProgress(profile);
        const list = type === "helper" ? CHEESE_CLICKER_HELPER_UPGRADES : CHEESE_CLICKER_CLICK_UPGRADES;
        const upgrade = list.find(item => item.id === id);

        if (!upgrade) {
            socket.emit("shop reply", "That Cheese Clicker upgrade does not exist.");
            return;
        }

        const bucket = type === "helper" ? clicker.helperUpgrades : clicker.clickUpgrades;
        const level = bucket[id] || 0;
        const cost = getUpgradeCost(upgrade.baseCost, level);

        if (clicker.cheese < cost) {
            socket.emit("shop reply", "Not enough cheese for that upgrade.");
            emitCheeseClickerData(socket, session.username);
            return;
        }

        clicker.cheese -= cost;
        bucket[id] = level + 1;
        clicker.lastUpdatedAt = Date.now();
        savePlayerProfile(profile);
        emitCheeseClickerData(socket, session.username);
    });

    socket.on("cheese clicker cheeseify", () => {
        if (!session) return;
        const profile = getPlayerProfile(session.username);
        const clicker = applyClickerOfflineProgress(profile);
        const cost = getCheeseifyCost(clicker.cheeseifyLevel);

        if (clicker.cheese < cost) {
            socket.emit("shop reply", "Not enough cheese to CHEESEIFY.");
            emitCheeseClickerData(socket, session.username);
            return;
        }

        clicker.cheese = 0;
        clicker.clickUpgrades = {};
        clicker.helperUpgrades = {};
        clicker.cheeseifyLevel += 1;
        clicker.cheeseifyMultiplier = calculateCheeseifyMultiplier(clicker.cheeseifyLevel);
        clicker.lastUpdatedAt = Date.now();

        savePlayerProfile(profile);
        socket.emit("cheese clicker cheeseified", {
            level: clicker.cheeseifyLevel,
            multiplier: clicker.cheeseifyMultiplier
        });
        emitCheeseClickerData(socket, session.username);
    });

    socket.on("cheese clicker golden collect", () => {
        if (!session) return;
        const profile = getPlayerProfile(session.username);
        const clicker = applyClickerOfflineProgress(profile);
        const reward = Math.floor(Math.random() * 901) + 100;

        clicker.cheese += reward;
        clicker.totalCheeseMade += reward;
        if (clicker.cheese > clicker.highestCheese) clicker.highestCheese = clicker.cheese;
        clicker.lastUpdatedAt = Date.now();

        savePlayerProfile(profile);
        socket.emit("cheese clicker golden reward", { reward });
        emitCheeseClickerData(socket, session.username);
    });

    socket.on("vote poll", eventId => {
        if (!session) return;

        voteInPoll(socket, eventId);
    });

    socket.on("admin command", command => {
        if (!session || !session.admin) {
            socket.emit("admin reply", "You are not an admin.");
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
            Number(data.delaySeconds || 10),
            session.username
        );
    });

    socket.on("cancel scheduled event", id => {
        if (!session || !session.admin) return;

        scheduledEvents = scheduledEvents.filter(event => event.id !== id);
        emitScheduleState();

        socket.emit("admin reply", "Scheduled event cancelled.");
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

server.listen(PORT, () => {
    console.log(`CheeseWithFriends running on port ${PORT} 🧀`);
});