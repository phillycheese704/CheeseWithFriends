



/* =========================================================
   JUST ANOTHER LIFE OF CHEESE — SOCIAL CLIENT STATE
========================================================= */

let latestSocialData = {
    friends: [],
    incoming: [],
    outgoing: [],
    unreadTotal: 0
};
let currentDmUser = null;
let currentDmThreadId = null;


function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}


const cheddarBrowser = document.getElementById("cheddarBrowser");
const cheddarSocialHub = document.getElementById("cheddarSocialHub");
const tempServerList = document.getElementById("tempServerList");
const socket = io();

let currentUser = null;
let loginToken = null;
let isAdmin = false;
let currentRoom = "cheeseLounge";
let currentRoomInfo = null;
let typingTimer = null;
let replyingTo = null;
let adminCollapsed = false;
let latestScheduledEvents = [];
let latestPlayerData = null;
let currentProfileData = null;
let latestLeaderboard = null;
let currentLeaderboardTab = 'totalCoinsEarned';
let selectedChaosAbility = "";
let currentIndexTab = "events";
let latestPoll = null;
let latestPollVotes = {};
let isOpeningCrate = false;
let latestTempServers = [];
let scrollLockCount = 0;
let activeChaosCount = 0;
let lastKnownCoins = null;
const roomTypingUsers = {};

const unreadCounts = {};

const roomMessageCache = {
    cheeseLounge: [],
    butter: [],
    blueCheese: [],
    grilledCheese: [],
    cheddar: [],
    feta: [],
    mozzarella: []
};

Object.keys(roomMessageCache).forEach(room => {
    unreadCounts[room] = 0;
});

const authScreen = document.getElementById("authScreen");
const app = document.getElementById("app");

const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const authMessage = document.getElementById("authMessage");

const messages = document.getElementById("messages");
const scrollLockBtn = document.getElementById("scrollLockBtn");
const messageInput = document.getElementById("messageInput");
const charCounter = document.getElementById("charCounter");
const typingIndicator = document.getElementById("typingIndicator");

const onlineUsers = document.getElementById("onlineUsers");
const onlineCount = document.getElementById("onlineCount");
const coinPill = document.getElementById("coinPill");
const tokenPill = document.getElementById("tokenPill");

const chatPage = document.getElementById("chatPage");
const arcadePage = document.getElementById("arcadePage");

const roomTitle = document.getElementById("roomTitle");
const roomSubtitle = document.getElementById("roomSubtitle");

const replyPreview = document.getElementById("replyPreview");
const replyPreviewText = document.getElementById("replyPreviewText");

const adminOpenBtn = document.getElementById("adminOpenBtn");
const adminPanel = document.getElementById("adminPanel");
const adminHeader = document.getElementById("adminHeader");
const adminBody = document.getElementById("adminBody");
const adminReply = document.getElementById("adminReply");

const chaosFill = document.getElementById("chaosFill");
const chaosText = document.getElementById("chaosText");
const effectLayer = document.getElementById("effectLayer");

const schedulePopup = document.getElementById("schedulePopup");
const pollBox = document.getElementById("pollBox");

const mozzarellaShop = document.getElementById("mozzarellaShop");


function togglePassword() {
    passwordInput.type =
        passwordInput.type === "password"
            ? "text"
            : "password";
}

function logout() {
    try {
        socket.disconnect();
    } catch (err) {
        console.warn(err);
    }

    location.reload();
}

async function signUp() {
    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();

    if (!username || !password) {
        setAuthMessage("Enter username and password.");
        return;
    }

    const response = await fetch("/signup", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            username,
            password
        })
    });

    const data = await response.json();

    if (!data.success) {
        setAuthMessage(data.message);
        return;
    }

    setAuthMessage("Account created. You can login now.", "success");
}

async function login() {
    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();

    if (!username || !password) {
        setAuthMessage("Enter a username and password.");
        return;
    }

    const response = await fetch("/login", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            username,
            password
        })
    });

    const data = await response.json();

    if (!data.success) {
        setAuthMessage(data.message);
        return;
    }

    currentUser = data.username;
    loginToken = data.token;
    isAdmin = data.admin;

    authScreen.classList.add("hidden");
    app.classList.remove("hidden");

    socket.emit("user joined", {
        token: loginToken,
        room: currentRoom
    });
}

/* =========================
   ROOM / CHAT
========================= */


function renderUnreadBadges() {
    document.querySelectorAll(".room-button").forEach(button => {
        const roomId = button.id ? button.id.replace("room-", "") : "";
        let badge = button.querySelector(".unread-badge");

        if (!badge) {
            badge = document.createElement("span");
            badge.className = "unread-badge hidden";
            badge.dataset.unreadFor = roomId;
            button.appendChild(badge);
        }

        const count = unreadCounts[roomId] || 0;

        if (count <= 0) {
            badge.classList.add("hidden");
            badge.textContent = "0";
            return;
        }

        badge.classList.remove("hidden");
        badge.textContent = count > 99 ? "99+" : String(count);
    });
}



function getTypingSet(room) {
    if (!roomTypingUsers[room]) {
        roomTypingUsers[room] = new Set();
    }

    return roomTypingUsers[room];
}

function updateTypingIndicatorForRoom(room) {
    if (room !== currentRoom || !typingIndicator) return;

    const names = [...getTypingSet(room)].filter(name => name && name !== currentUser);

    if (names.length === 0) {
        typingIndicator.textContent = "";
        return;
    }

    if (names.length === 1) {
        typingIndicator.textContent = `${names[0]} is typing...`;
        return;
    }

    if (names.length === 2) {
        typingIndicator.textContent = `${names[0]} and ${names[1]} are typing...`;
        return;
    }

    if (names.length === 3) {
        typingIndicator.textContent = `${names[0]}, ${names[1]} and ${names[2]} are typing...`;
        return;
    }

    typingIndicator.textContent = "Several people are typing...";
}


function goBackToCheeseLounge() {
    switchRoom("cheeseLounge");
}

function sendMessage() {
    const text = messageInput.value.trim();

    if (!text) return;

    if (text.length > 100) {
        showChatNotice("Messages can only be 100 characters.");
        return;
    }

    socket.emit("chat message", {
        room: currentRoom,
        text,
        replyTo: replyingTo
    });

    socket.emit("stop typing", {
        room: currentRoom
    });

    messageInput.value = "";
    replyingTo = null;
    replyPreview.classList.add("hidden");
    updateCounter();
}

function switchRoom(roomId) {
    if (roomId === currentRoom) return;

    currentRoom = roomId;
    unreadCounts[roomId] = 0;
    renderUnreadBadges();
    scrollLockCount = 0;
    updateScrollLockButton();

    typingIndicator.textContent = "";
    replyingTo = null;
    replyPreview.classList.add("hidden");

    if (!roomMessageCache[roomId]) {
        roomMessageCache[roomId] = [];
    }

    clearMessages();

    const loading = document.createElement("div");
    loading.className = "empty-state";
    loading.textContent = "Loading room...";
    messages.appendChild(loading);

    socket.emit("switch room", roomId);
    socket.emit("request player data");

    if (roomId === "cheddar") {
        socket.emit("request temp servers");
    }

    socket.emit("request active cheese bank", roomId);

    if (window.innerWidth <= 768) {
        document.body.classList.remove("sidebar-open");
    }
    renderSchedulePopup();
}

function updateRoomUI(roomId, roomInfo) {
    document.body.dataset.currentRoom = roomId;
    document
        .querySelectorAll(".room-button")
        .forEach(button => button.classList.remove("active"));

    const activeButton = document.getElementById(`room-${roomId}`);

    if (activeButton) {
        activeButton.classList.add("active");
    }

    const room = roomInfo || {};
    const isMozzarella = roomId === "mozzarella";
    const isCheddar = roomId === "cheddar";

    document.body.dataset.theme = roomId === "cheddar" ? "cheddar" : (room.theme || "cheese");

    roomTitle.textContent = `${room.icon || "🧀"} ${room.name || "Room"}`;

    if (roomId === "cheeseLounge") {
        roomSubtitle.textContent = "Filtered main room • 100 character messages";
        messageInput.placeholder = "Say something cheesy...";
    }

    if (roomId === "butter") {
        roomSubtitle.textContent = "Mild filter • trusted links allowed";
        messageInput.placeholder = "Smooth butter thoughts...";
    }

    if (roomId === "blueCheese") {
        roomSubtitle.textContent = "No word filters • still UI-safe";
        messageInput.placeholder = "Enter the blue zone...";
    }

    if (roomId === "grilledCheese") {
        roomSubtitle.textContent = "Chill goofy admin hangout • filtered for racism, NSFW, and gore";
        messageInput.placeholder = "Say something toasted...";
    }

    if (roomId === "cheddar") {
        roomSubtitle.textContent = "Temporary server browser • no chat";
        messageInput.placeholder = "Cheddar is a browser, not a chat.";
    }

    if (roomId === "mozzarella") {
        roomSubtitle.textContent = "No-chat crate shop • inventory • Cheese Index";
        messageInput.placeholder = "Mozzarella is no-chat.";
    }

    if (roomId === "cheddar") {
        roomSubtitle.textContent = "Robotic cheese helpers • bots • mini games";
        messageInput.placeholder = "Use the Cheddar panel.";
    }

    if (room.isTempServer) {
        roomSubtitle.textContent = `${room.owner || "Someone"}'s temporary server • melts away soon`;
        messageInput.placeholder = `Message ${room.name || "temp server"}...`;
    }

    if (mozzarellaShop) {
        mozzarellaShop.classList.toggle("hidden", !isMozzarella);
    }

    if (cheddarBrowser) {
        cheddarBrowser.classList.toggle("hidden", roomId !== "cheddar");
    }

    if (cheddarSocialHub) {
        cheddarSocialHub.classList.toggle("hidden", roomId !== "cheddar");
    }

    if (cheeseBotMenu) {
        cheeseBotMenu.classList.toggle("hidden", !isCheddar);
    }

    if (isCheddar) {
        messageBar.classList.add("hidden");
    }

    if (messages) {
        messages.classList.toggle("hidden", isMozzarella || roomId === "cheddar");
    }

    if (replyPreview) {
        if (isMozzarella || !replyingTo) {
            replyPreview.classList.add("hidden");
        } else {
            replyPreview.classList.remove("hidden");
        }
    }

    if (typingIndicator) {
        typingIndicator.classList.toggle("hidden", isMozzarella);
    }

    const isReadOnly = room.readOnly === true || room.noChat === true;

    messageInput.disabled = isReadOnly;

    const sendButton = document.querySelector(".message-bar button");

    if (sendButton) {
        sendButton.disabled = isReadOnly;
    }

    const messageBar = document.querySelector(".message-bar");

    if (messageBar) {
        messageBar.classList.toggle("hidden", isMozzarella || isCheddar);
    }

    renderSchedulePopup();
    renderShop();
    renderInventory();
}

function clearMessages() {
    while (messages.firstChild) {
        messages.removeChild(messages.firstChild);
    }
}

function cacheRoomMessages(room, list) {
    roomMessageCache[room] = [];

    list.forEach(message => {
        roomMessageCache[room].push({
            type: "message",
            data: message
        });
    });
}

function pushCachedItem(room, item) {
    if (!roomMessageCache[room]) {
        roomMessageCache[room] = [];
    }

    roomMessageCache[room].push(item);

    if (roomMessageCache[room].length > 120) {
        roomMessageCache[room].shift();
    }
}

function renderCurrentRoomFromCache() {
    clearMessages();

    const list = roomMessageCache[currentRoom] || [];

    if (list.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = getEmptyStateText(currentRoom);
        messages.appendChild(empty);
        return;
    }

    list.forEach(item => {
        if (item.type === "message") {
            renderMessageNode(item.data);
        }

        if (item.type === "system") {
            renderSystemNode(item.text);
        }
    });

    scrollToBottom();
}

function getEmptyStateText(room) {
    if (room === "butter") return "Smooth silence. Suspiciously spreadable.";
    if (room === "blueCheese") return "The mould is quiet... for now.";
    if (room === "grilledCheese") return "The toast is warm. Admins may appear.";
    if (room === "cheddar") return "Cheddar is where temporary servers will appear.";
    if (String(room).startsWith("temp-")) return "This temp server is fresh. Say something before it melts.";
    if (room === "mozzarella") return "Mozzarella is a no-chat shop.";
    return "Nobody is talking yet. Suspiciously cheesy.";
}

function renderRoomMessages(list) {
    cacheRoomMessages(currentRoom, list || []);
    renderCurrentRoomFromCache();
}

function addMessage(data) {
    const room = data.room || currentRoom;

    pushCachedItem(room, {
        type: "message",
        data
    });

    if (room !== currentRoom) {
        unreadCounts[room] = (unreadCounts[room] || 0) + 1;
        renderUnreadBadges();
        return;
    }

    removeEmptyState();
    renderMessageNode(data, true);
    safeScrollToBottom();
}


function renderMentionedText(container, rawText, shouldNotify = false) {
    const text = String(rawText || "");
    const parts = text.split(/(@[a-zA-Z0-9_#;-]+)/g);

    parts.forEach(part => {
        if (!part) return;

        if (part.startsWith("@")) {
            const span = document.createElement("span");
            span.className = "mention";
            span.textContent = part;
            container.appendChild(span);

            const mentionedName = part.slice(1).toLowerCase();

            if (
                shouldNotify &&
                currentUser &&
                mentionedName === String(currentUser).toLowerCase()
            ) {
                showChatNotice(`🧀 You were tagged: ${part}`);
            }

            return;
        }

        container.appendChild(document.createTextNode(part));
    });
}

function renderMessageNode(data, shouldNotifyMention = false) {
    const div = document.createElement("div");
    div.className = "message";
    div.dataset.messageId = data.id;

    if (data.replyTo) {
        const reply = document.createElement("div");
        reply.className = "reply-quote";
        reply.textContent = `↪ ${data.replyTo.username}: ${data.replyTo.text}`;
        div.appendChild(reply);
    }

    const meta = document.createElement("div");
    meta.className = "message-meta";

    const name = document.createElement("strong");
    name.textContent = data.username || "Unknown";
    name.title = data.realUsername || data.username || "Unknown";
    name.onclick = () => {
        socket.emit("request profile", data.realUsername || data.username);
    };

    const time = document.createElement("span");
    time.textContent = data.time || "";

    meta.appendChild(name);
    meta.appendChild(time);

    const text = document.createElement("p");
    renderMentionedText(text, data.text || "", shouldNotifyMention);

    const actions = document.createElement("div");
    actions.className = "message-actions";

    const replyBtn = document.createElement("button");
    replyBtn.textContent = "Reply";

    replyBtn.onclick = () => {
        replyingTo = {
            id: data.id,
            username: data.username,
            text: String(data.text || "").slice(0, 45)
        };

        replyPreviewText.textContent =
            `Replying to ${data.username}: ${String(data.text || "").slice(0, 60)}`;

        replyPreview.classList.remove("hidden");
        messageInput.focus();
    };

    actions.appendChild(replyBtn);

    ["🧀", "😂", "💀", "❤️", "👍", "🐭"].forEach(emoji => {
        const btn = document.createElement("button");
        btn.textContent = emoji;

        btn.onclick = () => {
            socket.emit("react message", {
                room: currentRoom,
                messageId: data.id,
                emoji
            });
        };

        actions.appendChild(btn);
    });

    const reactions = document.createElement("div");
    reactions.className = "reactions";

    div.appendChild(meta);
    div.appendChild(text);
    div.appendChild(actions);
    div.appendChild(reactions);

    messages.appendChild(div);

    updateReactions(data.id, data.reactions || {});
}

function updateReactions(messageId, reactions) {
    for (const room in roomMessageCache) {
        roomMessageCache[room].forEach(item => {
            if (
                item.type === "message" &&
                item.data &&
                item.data.id === messageId
            ) {
                item.data.reactions = reactions;
            }
        });
    }

    const message = messages.querySelector(`[data-message-id="${messageId}"]`);

    if (!message) return;

    const reactionBox = message.querySelector(".reactions");

    if (!reactionBox) return;

    reactionBox.innerHTML = "";

    Object.keys(reactions).forEach(emoji => {
        if (reactions[emoji] <= 0) return;

        const pill = document.createElement("span");
        pill.textContent = `${emoji} ${reactions[emoji]}`;
        reactionBox.appendChild(pill);
    });
}

function addSystemMessage(text, room = currentRoom) {
    pushCachedItem(room, {
        type: "system",
        text
    });

    if (room !== currentRoom) return;

    removeEmptyState();
    renderSystemNode(text);
    safeScrollToBottom();
}

function renderSystemNode(text) {
    const div = document.createElement("div");
    div.className = "system-message";
    div.textContent = text;

    messages.appendChild(div);
}

function showChatNotice(text) {
    const notice = document.createElement("div");
    notice.className = "toast-notice";
    notice.textContent = text;

    document.body.appendChild(notice);

    setTimeout(() => {
        notice.classList.add("leaving");
    }, 2400);

    setTimeout(() => {
        notice.remove();
    }, 3000);
}

function removeEmptyState() {
    const empty = messages.querySelector(".empty-state");

    if (empty) {
        empty.remove();
    }
}

function scrollToBottom() {
    messages.scrollTop = messages.scrollHeight;
}

function safeScrollToBottom() {
    const distanceFromBottom =
        messages.scrollHeight - messages.scrollTop - messages.clientHeight;

    if (distanceFromBottom < 140) {
        messages.scrollTop = messages.scrollHeight;
        scrollLockCount = 0;
        updateScrollLockButton();
    } else {
        scrollLockCount += 1;
        updateScrollLockButton();
    }
}

function updateScrollLockButton() {
    if (!scrollLockBtn) return;

    if (scrollLockCount <= 0) {
        scrollLockBtn.classList.add("hidden");
        scrollLockBtn.textContent = "↓ new messages";
        return;
    }

    scrollLockBtn.classList.remove("hidden");
    scrollLockBtn.textContent = `↓ ${scrollLockCount} new message${scrollLockCount === 1 ? "" : "s"}`;
}

function scrollToBottomFromButton() {
    scrollToBottom();
    scrollLockCount = 0;
    updateScrollLockButton();
}

function cancelReply() {
    replyingTo = null;
    replyPreview.classList.add("hidden");
}

/* =========================
   PLAYER DATA / SHOP / INVENTORY
========================= */


function animateCoinGain(amount) {
    if (!coinPill || amount <= 0) return;

    coinPill.classList.remove("coin-pill-pop");
    void coinPill.offsetWidth;
    coinPill.classList.add("coin-pill-pop");

    const float = document.createElement("span");
    float.className = "coin-float";
    float.textContent = `+${amount.toLocaleString()} 🧀`;

    coinPill.appendChild(float);

    setTimeout(() => {
        float.remove();
        coinPill.classList.remove("coin-pill-pop");
    }, 1100);
}


function updatePlayerData(data) {
    const previousCoins = lastKnownCoins;
    latestPlayerData = data;

    if (previousCoins !== null && data.coins > previousCoins) {
        animateCoinGain(data.coins - previousCoins);
    }

    lastKnownCoins = data.coins;

    if (coinPill) {
        coinPill.textContent = `🧀 ${data.coins}`;
    }

    if (tokenPill) {
        tokenPill.textContent = `🪙 ${data.cheeseTokens || 0}`;
    }

    if (shopCoins) {
        shopCoins.textContent = `${data.coins} 🧀`;
    }

    if (miniProfileStats) {
        miniProfileStats.textContent =
            `${data.coins} coins • ${data.cheeseTokens || 0} tokens • ${data.friendCount || 0} friends • ${data.bookCompletion}% book`;
    }

    renderShop();
    renderInventory();
    renderIndexContent();
    renderDailyArcadeChallenges();
}

function rarityLabel(rarity) {
    return String(rarity || "common").toUpperCase();
}

function rarityClass(rarity) {
    return `rarity-${String(rarity || "common").toLowerCase()}`;
}

function rarityEmoji(rarity) {
    const map = {
        common: "⚪",
        uncommon: "🟢",
        rare: "🔵",
        epic: "🟣",
        legendary: "🟡"
    };

    return map[rarity] || "⚪";
}

function formatEvent(eventId) {
    if (!latestPlayerData || !latestPlayerData.chaosEvents) {
        return {
            id: eventId,
            name: eventId,
            icon: "🧀",
            rarity: "common"
        };
    }

    return latestPlayerData.chaosEvents[eventId] || {
        id: eventId,
        name: eventId,
        icon: "🧀",
        rarity: "common"
    };
}

function formatCosmetic(cosmeticId) {
    if (!latestPlayerData || !latestPlayerData.cosmetics) {
        return null;
    }

    return latestPlayerData.cosmetics[cosmeticId] || null;
}

function renderShop() {
    if (!latestPlayerData) return;
    if (!chaosCrateList || !swissCrateBox) return;

    chaosCrateList.innerHTML = "";

    Object.values(latestPlayerData.crates || {}).forEach(crate => {
        const card = document.createElement("div");
        card.className = "crate-card clean-crate-card";

        const oddsHtml = crate.odds
            .map(entry => {
                return `
                    <div class="crate-odds-row ${rarityClass(entry.rarity)}">
                        <span>${rarityEmoji(entry.rarity)} ${rarityLabel(entry.rarity)}</span>
                        <strong>${entry.chance}%</strong>
                    </div>
                `;
            })
            .join("");

        card.innerHTML = `
            <div class="crate-card-top">
                <div class="crate-icon">📦</div>
                <div>
                    <h4>${crate.name}</h4>
                    <p>Single-use chaos ability</p>
                </div>
            </div>

            <div class="crate-price">${crate.price} 🧀</div>

            <div class="crate-odds-list">
                ${oddsHtml}
            </div>

            <button onclick="buyChaosCrate('${crate.id}')">
                Open ${crate.name}
            </button>

            <button class="token-use-btn" onclick="openChaosCrateWithToken('${crate.id}')">
                Use 1 🪙 Token
            </button>
        `;

        chaosCrateList.appendChild(card);
    });

    const swiss = latestPlayerData.swissCrate;

    swissCrateBox.innerHTML = `
        <div class="crate-card clean-crate-card swiss">
            <div class="crate-card-top">
                <div class="crate-icon">✨</div>
                <div>
                    <h4>${swiss.name}</h4>
                    <p>Cosmetics only</p>
                </div>
            </div>

            <div class="crate-price">${swiss.price} 🧀</div>

            <div class="crate-odds-list">
                ${swiss.odds.map(entry => `
                    <div class="crate-odds-row ${rarityClass(entry.rarity)}">
                        <span>${rarityEmoji(entry.rarity)} ${rarityLabel(entry.rarity)}</span>
                        <strong>${entry.chance}%</strong>
                    </div>
                `).join("")}
            </div>

            <p class="crate-note">
                Pick between 2 cosmetics. Duplicates become Cheese Coins.
            </p>

            <button onclick="openSwissCrate()">
                Open Swiss Crate
            </button>

            <button class="token-use-btn" onclick="openSwissCrateWithToken()">
                Use 1 🪙 Token
            </button>
        </div>

        ${renderArcadeShopCrates()}
    `;
}

function renderArcadeShopCrates() {
    if (!latestPlayerData) return "";

    const arcade = latestPlayerData.arcadeCrate || { name: "Arcade Crate", price: 1000, tokenChance: 0.5 };
    const blue = latestPlayerData.blueStiltonCrate || { name: "Blue Stilton Crate", price: 500, odds: [] };

    return `
        <div class="crate-card clean-crate-card arcade-crate-card">
            <div class="crate-card-top">
                <div class="crate-icon">🎮</div>
                <div>
                    <h4>${arcade.name}</h4>
                    <p>Chaos ability, cosmetic, or 0.5% Cheese Token chance</p>
                </div>
            </div>
            <div class="crate-price">${arcade.price} 🧀</div>
            <p class="crate-note">No set rarity odds. Pure arcade chaos.</p>
            <button onclick="buyArcadeCrate()">Open Arcade Crate</button>
            <button class="token-use-btn" onclick="openArcadeCrateWithToken()">Use 1 🪙 Token</button>
        </div>

        <div class="crate-card clean-crate-card blue-stilton-crate-card">
            <div class="crate-card-top">
                <div class="crate-icon">🧀🔵</div>
                <div>
                    <h4>${blue.name}</h4>
                    <p>Cosmetics only. Epic-heavy crate.</p>
                </div>
            </div>
            <div class="crate-price">${blue.price} 🧀</div>
            <div class="crate-odds-list">
                ${(blue.odds || []).map(entry => `
                    <div class="crate-odds-row ${rarityClass(entry.rarity)}">
                        <span>${rarityEmoji(entry.rarity)} ${rarityLabel(entry.rarity)}</span>
                        <strong>${entry.chance}%</strong>
                    </div>
                `).join("")}
            </div>
            <button onclick="openBlueStiltonCrate()">Open Blue Stilton Crate</button>
            <button class="token-use-btn" onclick="openBlueStiltonCrateWithToken()">Use 1 🪙 Token</button>
        </div>

        <div class="crate-card clean-crate-card token-trade-card">
            <div class="crate-card-top">
                <div class="crate-icon">🪙</div>
                <div>
                    <h4>Cheese Token Exchange</h4>
                    <p>Trade 1 Cheese Token for 1250 Cheese Coins.</p>
                </div>
            </div>
            <button class="token-use-btn" onclick="tradeCheeseTokenForCoins()">Trade Token for 1250 🧀</button>
        </div>
    `;
}


function tradeCheeseTokenForCoins() {
    if (!latestPlayerData || (latestPlayerData.cheeseTokens || 0) < 1) {
        showShopReply("You need 1 Cheese Token.");
        return;
    }

    socket.emit("trade cheese token");
}

function openChaosCrateWithToken(crateId) {
    if (isOpeningCrate) return;

    if (!latestPlayerData || (latestPlayerData.cheeseTokens || 0) < 1) {
        showShopReply("You need 1 Cheese Token.");
        return;
    }

    isOpeningCrate = true;
    showCrateOpeningAnimation("Token Crate", "Spending 1 Cheese Token...", "chaos");
    socket.emit("open chaos crate with token", crateId);
}

function openSwissCrateWithToken() {
    if (isOpeningCrate) return;

    if (!latestPlayerData || (latestPlayerData.cheeseTokens || 0) < 1) {
        showShopReply("You need 1 Cheese Token.");
        return;
    }

    isOpeningCrate = true;
    showCrateOpeningAnimation("Token Swiss Crate", "Spending 1 Cheese Token...", "cosmetic");
    socket.emit("open swiss crate with token");
}

function unlockIndexWithToken(type, id) {
    if (!latestPlayerData || (latestPlayerData.cheeseTokens || 0) < 1) {
        showChatNotice("You need 1 Cheese Token.");
        return;
    }

    socket.emit("unlock index with token", {
        type,
        id
    });
}


function buyChaosCrate(crateId) {
    if (isOpeningCrate) return;

    isOpeningCrate = true;
    showCrateOpeningAnimation("Chaos Crate", "Rolling chaos ability...", "chaos");

    socket.emit("buy chaos crate", crateId);
}

function openSwissCrate() {
    if (isOpeningCrate) return;

    isOpeningCrate = true;
    showCrateOpeningAnimation("Swiss Crate", "Rolling cosmetics...", "cosmetic");

    socket.emit("open swiss crate");
}

function renderInventory() {
    if (!latestPlayerData || !inventoryList) return;

    inventoryList.innerHTML = "";

    const inventory = latestPlayerData.inventory || {};
    const entries = Object.keys(inventory);

    if (entries.length === 0) {
        inventoryList.innerHTML = `
            <div class="empty-inventory">
                <strong>No chaos abilities yet.</strong>
                <span>Open crates in Mozzarella ⚪</span>
            </div>
        `;
    } else {
        entries
            .sort((a, b) => {
                const order = {
                    common: 1,
                    uncommon: 2,
                    rare: 3,
                    epic: 4,
                    legendary: 5
                };

                const eventA = formatEvent(a);
                const eventB = formatEvent(b);

                return (order[eventB.rarity] || 0) - (order[eventA.rarity] || 0);
            })
            .forEach(eventId => {
                const event = formatEvent(eventId);
                const count = inventory[eventId];

                const item = document.createElement("button");
                item.className = `inventory-item ${rarityClass(event.rarity)}`;

                if (selectedChaosAbility === eventId) {
                    item.classList.add("selected");
                }

                item.innerHTML = `
                    <span>${event.icon}</span>
                    <strong>${event.name}</strong>
                    <small>${rarityEmoji(event.rarity)} ${rarityLabel(event.rarity)} • x${count}</small>
                `;

                item.onclick = () => {
                    selectedChaosAbility = eventId;
                    renderInventory();
                };

                inventoryList.appendChild(item);
            });
    }

    if (selectedChaosAbility) {
        const selected = formatEvent(selectedChaosAbility);
        inventorySelected.innerHTML = `
            <span>Selected ability</span>
            <strong>${selected.icon} ${selected.name}</strong>
        `;
    } else {
        inventorySelected.innerHTML = `
            <span>Selected ability</span>
            <strong>None selected</strong>
        `;
    }

    updateCooldownText();
}

function updateCooldownText() {
    if (!latestPlayerData || !chaosCooldownText) return;

    const last = latestPlayerData.lastChaosUsedAt || 0;
    const cooldown = 60 * 1000;
    const remaining = cooldown - (Date.now() - last);

    if (remaining > 0) {
        chaosCooldownText.textContent =
            `Cooldown: ${Math.ceil(remaining / 1000)}s remaining`;

        if (runSelectedChaosBtn) {
            runSelectedChaosBtn.disabled = true;
        }
    } else {
        chaosCooldownText.textContent = "Cooldown ready.";

        if (runSelectedChaosBtn) {
            runSelectedChaosBtn.disabled = false;
        }
    }
}

function runSelectedChaosAbility() {
    if (!selectedChaosAbility) {
        showShopReply("Select a chaos ability first.");
        return;
    }

    if (latestPlayerData) {
        latestPlayerData.lastChaosUsedAt = Date.now();
        updateCooldownText();
    }

    socket.emit("use chaos ability", selectedChaosAbility);
}

function showShopReply(text) {
    if (shopReply) {
        shopReply.textContent = text;
    }

    showChatNotice(text);
}

/* =========================
   FULLSCREEN CRATE OVERLAY
========================= */

function showCrateOpeningAnimation(title, subtitle, type) {
    if (!crateOverlay || !crateOverlayCard) return;

    crateOverlay.classList.remove("hidden");

    crateOverlayCard.innerHTML = `
        <div class="fullscreen-crate-opening ${type}">
            <div class="fullscreen-crate-glow"></div>

            <div class="fullscreen-crate-box">
                <div class="fullscreen-crate-emoji">📦</div>
                <div class="fullscreen-crate-sparkles">
                    <span>✨</span>
                    <span>🧀</span>
                    <span>✨</span>
                    <span>⚪</span>
                </div>
            </div>

            <h2>${title}</h2>
            <p>${subtitle}</p>

            <div class="fullscreen-roll-strip">
                <span>COMMON</span>
                <span>UNCOMMON</span>
                <span>RARE</span>
                <span>EPIC</span>
                <span>LEGENDARY</span>
                <span>COMMON</span>
                <span>UNCOMMON</span>
                <span>RARE</span>
                <span>EPIC</span>
                <span>LEGENDARY</span>
            </div>
        </div>
    `;
}

function renderCrateResult(data) {
    if (!crateOverlay || !crateOverlayCard) return;

    setTimeout(() => {
        isOpeningCrate = false;

        crateOverlay.classList.remove("hidden");

        crateOverlayCard.innerHTML = `
            <div class="fullscreen-crate-result ${rarityClass(data.reward.rarity)}">
                <div class="fullscreen-reward-burst"></div>

                <p class="fullscreen-result-small">${data.crate.name} opened!</p>

                <div class="fullscreen-big-reward">${data.reward.icon}</div>

                <h2>${data.reward.name}</h2>

                <div class="fullscreen-rarity-pill ${rarityClass(data.reward.rarity)}">
                    ${rarityEmoji(data.reward.rarity)} ${rarityLabel(data.reward.rarity)}
                </div>

                <p>Added to your chaos inventory.</p>

                <button onclick="closeCrateOverlay()">
                    Nice 🧀
                </button>
            </div>
        `;
    }, 1800);
}

function renderCosmeticChoice(choices) {
    if (!crateOverlay || !crateOverlayCard) return;

    setTimeout(() => {
        isOpeningCrate = false;

        crateOverlay.classList.remove("hidden");

        crateOverlayCard.innerHTML = `
            <div class="fullscreen-cosmetic-choice">
                <h2>✨ Choose one cosmetic</h2>
                <p>Duplicates turn into Cheese Coins.</p>

                <div class="fullscreen-cosmetic-grid"></div>
            </div>
        `;

        const grid = crateOverlayCard.querySelector(".fullscreen-cosmetic-grid");

        choices.forEach(choice => {
            const card = document.createElement("button");
            card.className = `fullscreen-cosmetic-card ${rarityClass(choice.rarity)}`;

            const icon =
                choice.type === "background"
                    ? "🎨"
                    : choice.type === "font"
                        ? "🔤"
                        : "🧩";

            card.innerHTML = `
                <div class="fullscreen-cosmetic-icon">${icon}</div>

                <h3>${choice.name}</h3>

                <strong>
                    ${rarityEmoji(choice.rarity)} ${rarityLabel(choice.rarity)}
                </strong>

                <span>${choice.type}</span>

                ${
                    choice.duplicate
                        ? `<em class="duplicate-tag">Duplicate: +${choice.duplicateCoins} 🧀</em>`
                        : `<em class="new-tag">NEW • Added to Index</em>`
                }
            `;

            card.onclick = () => {
                socket.emit("choose cosmetic", choice.id);

                crateOverlayCard.innerHTML = `
                    <div class="fullscreen-crate-result ${rarityClass(choice.rarity)}">
                        <div class="fullscreen-reward-burst"></div>

                        <p class="fullscreen-result-small">Cosmetic chosen!</p>

                        <div class="fullscreen-big-reward">${icon}</div>

                        <h2>${choice.name}</h2>

                        <div class="fullscreen-rarity-pill ${rarityClass(choice.rarity)}">
                            ${rarityEmoji(choice.rarity)} ${rarityLabel(choice.rarity)}
                        </div>

                        <p>
                            ${
                                choice.duplicate
                                    ? `Duplicate converted into ${choice.duplicateCoins} Cheese Coins.`
                                    : "Added to your Cheese Index."
                            }
                        </p>

                        <button onclick="closeCrateOverlay()">
                            Nice 🧀
                        </button>
                    </div>
                `;
            };

            grid.appendChild(card);
        });
    }, 1800);
}

function closeCrateOverlay() {
    if (!crateOverlay || !crateOverlayCard) return;

    crateOverlay.classList.add("hidden");
    crateOverlayCard.innerHTML = "";
}

/* =========================
   CHEESE INDEX
========================= */

function openIndexBook() {
    if (!latestPlayerData) {
        socket.emit("request player data");
        return;
    }

    indexModal.classList.remove("hidden");
    renderIndexContent();
}

function closeIndexBook() {
    indexModal.classList.add("hidden");
}

function switchIndexTab(tab) {
    currentIndexTab = tab;

    document
        .querySelectorAll(".index-tab")
        .forEach(button => button.classList.remove("active"));

    const buttons = [...document.querySelectorAll(".index-tab")];
    const activeButton = buttons.find(button =>
        button.textContent.toLowerCase().includes(tab)
    );

    if (activeButton) {
        activeButton.classList.add("active");
    }

    renderIndexContent();
}

function renderIndexContent() {
    if (!latestPlayerData || !indexContent) return;

    if (bookCompletionText) {
        bookCompletionText.textContent = `${latestPlayerData.bookCompletion}%`;
    }

    if (currentIndexTab === "events") {
        renderEventIndex();
    }

    if (currentIndexTab === "cosmetics") {
        renderCosmeticIndex();
    }

    if (currentIndexTab === "achievements") {
        renderAchievementIndex();
    }
}

function renderEventIndex() {
    const events = Object.values(latestPlayerData.chaosEvents || {});
    const witnessed = latestPlayerData.index.eventsWitnessed || {};
    const used = latestPlayerData.index.eventsUsed || {};

    indexContent.innerHTML = "";

    const grid = document.createElement("div");
    grid.className = "index-grid";

    events.forEach(event => {
        const discovered = witnessed[event.id] || used[event.id];

        const card = document.createElement("div");
        card.className = `index-item ${rarityClass(event.rarity)} ${discovered ? "" : "locked"}`;

        card.innerHTML = `
            <div class="index-icon">${discovered ? event.icon : "❔"}</div>
            <h4>${discovered ? event.name : "Unknown Event"}</h4>
            <strong>${rarityEmoji(event.rarity)} ${rarityLabel(event.rarity)}</strong>
            <p>${discovered ? event.description : "Discover this event to reveal it."}</p>
            <span>${used[event.id] ? "Used ✅" : discovered ? "Witnessed ✅" : "Locked 🔒"}</span>
            ${
                discovered
                    ? `<button onclick="setFavouriteEvent('${event.id}')">Set Favourite</button>`
                    : `<button onclick="unlockIndexWithToken('event', '${event.id}')">Unlock with 1 🪙</button>`
            }
        `;

        grid.appendChild(card);
    });

    indexContent.appendChild(grid);
}

function renderCosmeticIndex() {
    const cosmetics = Object.values(latestPlayerData.cosmetics || {});
    const owned = latestPlayerData.index.cosmeticsOwned || {};
    const equipped = latestPlayerData.equippedCosmetics || {};

    indexContent.innerHTML = "";

    const groups = {
        background: "🎨 Backgrounds",
        font: "🔤 Fonts",
        icon: "🧩 Icons"
    };

    Object.keys(groups).forEach(type => {
        const title = document.createElement("h3");
        title.textContent = groups[type];
        indexContent.appendChild(title);

        const grid = document.createElement("div");
        grid.className = "index-grid";

        cosmetics
            .filter(cosmetic => cosmetic.type === type)
            .forEach(cosmetic => {
                const hasItem = !!owned[cosmetic.id];
                const isEquipped = equipped[type] === cosmetic.id;

                const card = document.createElement("div");
                card.className = `index-item ${rarityClass(cosmetic.rarity)} ${hasItem ? "" : "locked"}`;

                card.innerHTML = `
                    <div class="index-icon">
                        ${hasItem ? type === "background" ? "🎨" : type === "font" ? "🔤" : "🧩" : "❔"}
                    </div>
                    <h4>${hasItem ? cosmetic.name : "Unknown Cosmetic"}</h4>
                    <strong>${rarityEmoji(cosmetic.rarity)} ${rarityLabel(cosmetic.rarity)}</strong>
                    <p>${hasItem ? cosmetic.type : "Find this in a Swiss Crate."}</p>
                    <span>${isEquipped ? "Equipped ✅" : hasItem ? "Owned ✅" : "Locked 🔒"}</span>
                    ${
                        hasItem && !isEquipped
                            ? `<button onclick="equipCosmetic('${cosmetic.id}')">Equip</button>`
                            : !hasItem
                                ? `<button onclick="unlockIndexWithToken('cosmetic', '${cosmetic.id}')">Unlock with 1 🪙</button>`
                                : ""
                    }
                `;

                grid.appendChild(card);
            });

        indexContent.appendChild(grid);
    });
}

function renderAchievementIndex() {
    indexContent.innerHTML = `
        <div class="coming-soon-achievements">
            <h2>Coming soon 🧀🏆</h2>
            <p>Achievements will live here later.</p>
        </div>
    `;
}

function setFavouriteEvent(eventId) {
    socket.emit("set favourite event", eventId);
}

function equipCosmetic(cosmeticId) {
    socket.emit("equip cosmetic", cosmeticId);
}

/* =========================
   PROFILE
========================= */

function openOwnProfile() {
    socket.emit("request profile", currentUser);
}

function openProfile(username) {
    socket.emit("request profile", username);
    socket.emit("request social data");
}

function closeProfile() {
    profileModal.classList.add("hidden");
}

function renderProfile(data, skipStore = false) {
    if (!skipStore) currentProfileData = data;
    profileModal.classList.remove("hidden");

    const favourite =
        data.favouriteEvent && data.chaosEvents[data.favouriteEvent]
            ? data.chaosEvents[data.favouriteEvent]
            : null;

    const equipped = data.equippedCosmetics || {};
    const cosmetics = data.cosmetics || {};

    const background =
        equipped.background && cosmetics[equipped.background]
            ? cosmetics[equipped.background].name
            : "None";

    const font =
        equipped.font && cosmetics[equipped.font]
            ? cosmetics[equipped.font].name
            : "None";

    const icon =
        equipped.icon && cosmetics[equipped.icon]
            ? cosmetics[equipped.icon].name
            : "None";

    profileContent.innerHTML = `
        <div class="profile-top">
            <div class="profile-avatar">
                ${
                    equipped.icon && cosmetics[equipped.icon]
                        ? "✨"
                        : "🧀"
                }
            </div>

            <div>
                <h2>${data.username}</h2>
                <p>Book Completion: ${data.bookCompletion}%</p>
            </div>
        </div>

        <div class="profile-stat-grid">
            <div><span>Current Coins</span><strong>${data.coins}</strong></div>
            <div><span>Cheese Tokens</span><strong>${data.cheeseTokens || 0}</strong></div>
            <div><span>Highest Coins</span><strong>${data.highestCoins}</strong></div>
            <div><span>Total Coins</span><strong>${data.totalCoinsEarned}</strong></div>
            <div><span>Messages Sent</span><strong>${data.messagesSent}</strong></div>
            <div><span>Chaos Used</span><strong>${data.chaosUsed}</strong></div>
            <div><span>Crates Opened</span><strong>${data.cratesOpened}</strong></div>
        </div>

        <div class="profile-section">
            <h3>Favourite Event</h3>
            <p>${favourite ? `${favourite.icon} ${favourite.name}` : "None selected yet."}</p>
        </div>

        <div class="profile-section">
            <h3>Decorations</h3>
            <p>Background: ${background}</p>
            <p>Font: ${font}</p>
            <p>Icon: ${icon}</p>
        </div>

        <div class="profile-section">
            <h3>Achievements</h3>
            <p>${data.achievementsText || "Coming soon 🧀🏆"}</p>
        </div>

        <div class="profile-section profile-social-actions">
            <h3>Social</h3>
            <div class="profile-social-buttons">
                ${renderProfileSocialActions(data.username)}
            </div>
        </div>
    `;
}

/* =========================
   POLLS
========================= */

function renderPoll() {
    if (!pollBox) return;

    if (!latestPoll) {
        pollBox.classList.add("hidden");
        pollBox.innerHTML = "";
        return;
    }

    pollBox.classList.remove("hidden");
    pollBox.innerHTML = `
        <div class="poll-header">
            <div>
                <strong>🗳️ Chaos Vote</strong>
                <p>${latestPoll.title}</p>
                <small>Started by ${latestPoll.startedBy}</small>
            </div>
            <span id="pollTimer"></span>
        </div>
        <div class="poll-options"></div>
    `;

    const optionsBox = pollBox.querySelector(".poll-options");

    latestPoll.options.forEach(option => {
        const votes = latestPollVotes[option.id] || 0;

        const button = document.createElement("button");
        button.className = `poll-option ${rarityClass(option.rarity)}`;
        button.innerHTML = `
            <span>${option.icon}</span>
            <strong>${option.name}</strong>
            <small>${votes} votes</small>
        `;

        button.onclick = () => {
            socket.emit("vote poll", option.id);
        };

        optionsBox.appendChild(button);
    });

    updatePollTimer();
}

function updatePollTimer() {
    if (!latestPoll) return;

    const timer = document.getElementById("pollTimer");

    if (!timer) return;

    const remaining = Math.max(
        0,
        Math.ceil((latestPoll.endsAt - Date.now()) / 1000)
    );

    timer.textContent = `${remaining}s`;

    if (pollBox) {
        pollBox.classList.toggle("fading", remaining <= 0);
    }
}

/* =========================
   EXTRA UI
========================= */

function openArcade() {
    arcadePage.classList.remove("hidden");
    document.body.classList.add("arcade-open");
    updateCheeseClickerCard();
    renderCheeseClicker();
    renderDailyArcadeChallenges();
}


function closeArcade() {
    arcadePage.classList.add("hidden");
    document.body.classList.remove("arcade-open");
    closeCheeseClicker();
}

function changeTabName() {
    const input = document.getElementById("tabNameInput");
    const value = input.value.trim();

    if (!value) return;

    document.title = value;
}

function updateCounter() {
    const length = messageInput.value.length;
    charCounter.textContent = `${length}/100`;

    if (length >= 90) {
        charCounter.classList.add("danger");
    } else {
        charCounter.classList.remove("danger");
    }
}

/* =========================
   SCHEDULE POPUP
========================= */

function renderSchedulePopup() {
    if (!schedulePopup) return;

    if (latestScheduledEvents.length === 0) {
        schedulePopup.classList.add("hidden");
        schedulePopup.innerHTML = "";
        return;
    }

    schedulePopup.classList.remove("hidden");
    schedulePopup.innerHTML = "";

    const title = document.createElement("strong");
    title.textContent = "🧀 Upcoming Chaos";
    schedulePopup.appendChild(title);

    latestScheduledEvents.slice(0, 3).forEach(event => {
        const row = document.createElement("div");
        row.className = "schedule-row";

        const secondsLeft = Math.max(
            0,
            Math.ceil((event.runAt - Date.now()) / 1000)
        );

        const scheduledBy = event.scheduledBy || "Unknown";

        const main = document.createElement("span");
        main.className = "schedule-main-line";
        main.textContent = `${cleanCommandName(event.commandText)} in ${secondsLeft}s`;

        const by = document.createElement("small");
        by.className = "schedule-by-line";
        by.textContent = `by ${scheduledBy}`;

        row.appendChild(main);
        row.appendChild(by);

        schedulePopup.appendChild(row);
    });
}

function cleanCommandName(command) {
    return String(command || "")
        .replaceAll("+/", "")
        .replaceAll(";/", "")
        .replaceAll("\\", "")
        .trim();
}

/* =========================
   ADMIN PANEL
========================= */

function openAdminPanel() {
    socket.emit("request admin status", {
        token: loginToken
    });

    adminPanel.classList.remove("hidden");
    adminPanel.classList.remove("collapsed");
    adminBody.classList.remove("hidden");
    adminCollapsed = false;
}

function closeAdminPanel() {
    adminPanel.classList.add("hidden");
}

function collapseAdminPanel() {
    adminCollapsed = !adminCollapsed;

    if (adminCollapsed) {
        adminBody.classList.add("hidden");
        adminPanel.classList.add("collapsed");
    } else {
        adminBody.classList.remove("hidden");
        adminPanel.classList.remove("collapsed");
    }
}

function sendAdminCommand() {
    const input = document.getElementById("adminCommandInput");
    const command = input.value.trim();

    if (!command) return;

    socket.emit("admin command", {
        command,
        token: loginToken
    });

    input.value = "";
}

function scheduleAdminEvent() {
    const commandText = document.getElementById("scheduleCommand").value;
    const delaySeconds = Number(document.getElementById("scheduleDelay").value);

    socket.emit("schedule event", {
        commandText,
        delaySeconds,
        token: loginToken
    });
}

function buildAdminCommand() {
    const command = adminCommandSelect.value;
    const player = adminPlayerSelect.value || "<Player>";
    const amount = adminAmountInput.value.trim();
    const text = adminTextInput.value.trim();
    const events = adminEventsInput.value.trim();

    const commandInput = document.getElementById("adminCommandInput");
    if (!commandInput) return;

    if (command === "warning") commandInput.value = `;/Warning: ${player}, ${text || "Reason"}`;
    if (command === "ban") commandInput.value = `;/Ban: ${player}, ${text || "Reason"}`;
    if (command === "tempban") commandInput.value = `;/TempBan: ${player}, ${amount || "10m"}, ${text || "Reason"}`;
    if (command === "mute") commandInput.value = `;/Mute: ${player}, ${amount || "10m"}, ${text || "Reason"}`;
    if (command === "unmute") commandInput.value = `;/Unmute: ${player}`;
    if (command === "givecoins") commandInput.value = `;/GiveCoins: ${player}, ${amount || "100"}`;
    if (command === "setcoins") commandInput.value = `;/SetCoins: ${player}, ${amount || "0"}`;
    if (command === "givetokens") commandInput.value = `;/GiveTokens: ${player}, ${amount || "1"}`;
    if (command === "settokens") commandInput.value = `;/SetTokens: ${player}, ${amount || "0"}`;
    if (command === "givecrate") commandInput.value = `+/GiveCrate: ${player}, ${amount || "chaos"}, 1\\`;
    if (command === "give") commandInput.value = `+/Give: ${player}, ${amount || "CheeseRain"}, 1\\`;
    if (command === "admin") commandInput.value = `;/Admin: ${player}, ${amount || "10m"}`;
    if (command === "cheeserng") commandInput.value = "+/CheeseRNG\\";
    if (command === "cheesebank") commandInput.value = "+/CheeseBank\\";
    if (command === "clearchat") commandInput.value = ";/ClearChat:";
    if (command === "shutdown") commandInput.value = `;/Shutdown: ${amount || "10m"}, ${text || "Maintenance"}`;
    if (command === "cancelshutdown") commandInput.value = ";/CancelShutdown";
    if (command === "offline") commandInput.value = ";/Offline";
    if (command === "online") commandInput.value = ";/Online";
    if (command === "announcement") commandInput.value = `;/Announcement: ${text || "Announcement"}`;
    if (command === "startpoll") commandInput.value = `;/StartPoll: ${amount || "30"}, ${text || "Which chaos should happen?"}, ${events || "Cheese Rain|Cheesenado|Cheese Moon"}`;
    if (command === "addserverlifetime") commandInput.value = `;/AddServerLifetime: ${text || "<TempServer>"}, ${amount || "30m"}`;
    if (command === "removeserver") commandInput.value = `;/RemoveServer: ${text || "<TempServer>"}`;
    if (command === "setseason") commandInput.value = `;/SetSeason: ${text || "halloween"}, ${amount || "10m"}`;
}

function renderScheduledEvents(events) {
    latestScheduledEvents = events || [];

    const box = document.getElementById("scheduledEvents");

    if (!box) return;

    box.innerHTML = "";

    latestScheduledEvents.forEach(event => {
        const div = document.createElement("div");
        div.className = "scheduled-event";

        const secondsLeft = Math.max(
            0,
            Math.ceil((event.runAt - Date.now()) / 1000)
        );

        const label = document.createElement("span");
        label.textContent =
            `${cleanCommandName(event.commandText)} in ${secondsLeft}s`;

        const by = document.createElement("small");
        by.textContent = `by ${event.scheduledBy || "Unknown"}`;

        const cancel = document.createElement("button");
        cancel.textContent = "×";
        cancel.onclick = () => {
            socket.emit("cancel scheduled event", event.id);
        };

        div.appendChild(label);
        div.appendChild(by);
        div.appendChild(cancel);
        box.appendChild(div);
    });

    renderSchedulePopup();
}

/* =========================
   ADMIN DRAGGING
========================= */

let draggingAdmin = false;
let dragOffsetX = 0;
let dragOffsetY = 0;

adminHeader.addEventListener("pointerdown", event => {
    if (event.target.closest("button")) return;

    draggingAdmin = true;

    const rect = adminPanel.getBoundingClientRect();

    dragOffsetX = event.clientX - rect.left;
    dragOffsetY = event.clientY - rect.top;

    try {
        adminHeader.setPointerCapture(event.pointerId);
    } catch (err) {
        console.warn(err);
    }
});

adminHeader.addEventListener("pointermove", event => {
    if (!draggingAdmin) return;

    event.preventDefault();

    adminPanel.style.left = `${event.clientX - dragOffsetX}px`;
    adminPanel.style.top = `${event.clientY - dragOffsetY}px`;
    adminPanel.style.right = "auto";
});

adminHeader.addEventListener("pointerup", event => {
    draggingAdmin = false;

    try {
        adminHeader.releasePointerCapture(event.pointerId);
    } catch (err) {
        console.warn(err);
    }
});

adminHeader.addEventListener("pointercancel", () => {
    draggingAdmin = false;
});

/* =========================
   CHAOS EFFECTS
========================= */

function hardResetVisuals() {
    document.body.classList.remove(
        "singularity-background",
        "singularity-spit"
    );

    document
        .querySelectorAll(".singularity-hidden-original")
        .forEach(element => {
            element.classList.remove("singularity-hidden-original");
        });
}

function clearEffects() {
    effectLayer.innerHTML = "";
    hardResetVisuals();
}

function makeImpactText(text) {
    const impact = document.createElement("div");
    impact.className = "chaos-impact-text";
    impact.textContent = text;
    effectLayer.appendChild(impact);

    setTimeout(() => impact.remove(), 1800);
}

function cheeseRain(count = 70) {
    /* stacked chaos: no global clear */
    makeImpactText("CHEESE RAIN");

    for (let i = 0; i < count; i++) {
        const cheese = document.createElement("div");

        cheese.className = "falling-cheese";
        cheese.textContent = Math.random() > 0.15 ? "🧀" : "🫕";
        cheese.style.left = `${Math.random() * 100}vw`;
        cheese.style.animationDuration = `${1.9 + Math.random() * 3.2}s`;
        cheese.style.fontSize = `${22 + Math.random() * 34}px`;
        cheese.style.animationDelay = `${Math.random() * 1.1}s`;
        cheese.style.setProperty("--sway", `${-80 + Math.random() * 160}px`);

        effectLayer.appendChild(cheese);

        setTimeout(() => cheese.remove(), 6800);
    }
}

function cheeseStorm() {
    /* stacked chaos: no global clear */
    makeImpactText("CHEESE STORM");

    const clouds = document.createElement("div");
    clouds.className = "storm-clouds";
    effectLayer.appendChild(clouds);

    cheeseRain(140);

    for (let i = 0; i < 6; i++) {
        const lightning = document.createElement("div");
        lightning.className = "cheese-lightning";
        lightning.style.left = `${10 + Math.random() * 80}vw`;
        lightning.style.animationDelay = `${Math.random() * 4.5}s`;
        effectLayer.appendChild(lightning);
    }

    setTimeout(() => {
        effectLayer.innerHTML = "";
        hardResetVisuals();
    }, 6800);
}

function mouseRun() {
    /* stacked chaos: no global clear */
    makeImpactText("MOUSE RUN");

    for (let i = 0; i < 34; i++) {
        const mouse = document.createElement("div");

        mouse.className =
            Math.random() > 0.5
                ? "running-mouse"
                : "running-mouse reverse";

        mouse.textContent = Math.random() > 0.15 ? "🐭" : "🐁";
        mouse.style.top = `${12 + Math.random() * 78}vh`;
        mouse.style.animationDelay = `${Math.random() * 2.2}s`;
        mouse.style.fontSize = `${22 + Math.random() * 24}px`;
        mouse.style.setProperty("--mouse-speed", `${2.4 + Math.random() * 2.2}s`);

        effectLayer.appendChild(mouse);

        setTimeout(() => mouse.remove(), 6500);
    }
}


function lactoseBomb() {
    /* stacked chaos: no global clear */
    makeImpactText("LACTOSE BOMB");

    const flash = document.createElement("div");
    flash.className = "lactose-bomb-flash";
    effectLayer.appendChild(flash);

    const blast = document.createElement("div");
    blast.className = "lactose-bomb-blast";
    blast.textContent = "🥛💥";
    effectLayer.appendChild(blast);

    for (let i = 0; i < 70; i++) {
        const drop = document.createElement("div");
        drop.className = "lactose-drop";
        drop.textContent = Math.random() > 0.45 ? "🥛" : "💥";
        drop.style.left = "50vw";
        drop.style.top = "45vh";
        drop.style.setProperty("--lx", `${-420 + Math.random() * 840}px`);
        drop.style.setProperty("--ly", `${-260 + Math.random() * 520}px`);
        drop.style.animationDelay = `${Math.random() * 0.4}s`;
        effectLayer.appendChild(drop);
    }

    setTimeout(() => {
        effectLayer.innerHTML = "";
        hardResetVisuals();
    }, 5200);
}


function butterBomb() {
    /* stacked chaos: no global clear */
    makeImpactText("BUTTER BOMB");

    const x = 12 + Math.random() * 74;

    const pulse = document.createElement("div");
    pulse.className = "butter-screen-pulse";
    effectLayer.appendChild(pulse);

    const bomb = document.createElement("div");
    bomb.className = "butter-bomb";
    bomb.textContent = "🧈";
    bomb.style.left = `${x}vw`;

    effectLayer.appendChild(bomb);

    setTimeout(() => {
        bomb.remove();

        const splat = document.createElement("div");
        splat.className = "butter-splat";
        splat.style.left = `${x - 6}vw`;
        effectLayer.appendChild(splat);
    }, 930);

    setTimeout(() => {
        effectLayer.innerHTML = "";
        hardResetVisuals();
    }, 5700);
}

function butterFlood() {
    /* stacked chaos: no global clear */
    makeImpactText("BUTTER FLOOD");

    const wave = document.createElement("div");
    wave.className = "butter-wave";
    effectLayer.appendChild(wave);

    for (let i = 0; i < 34; i++) {
        const bubble = document.createElement("div");
        bubble.className = "butter-bubble";
        bubble.textContent = Math.random() > 0.5 ? "🧈" : "○";
        bubble.style.left = `${Math.random() * 100}vw`;
        bubble.style.animationDelay = `${Math.random() * 3}s`;
        bubble.style.fontSize = `${18 + Math.random() * 28}px`;

        effectLayer.appendChild(bubble);

        setTimeout(() => bubble.remove(), 6600);
    }

    setTimeout(() => {
        effectLayer.innerHTML = "";
        hardResetVisuals();
    }, 6600);
}

function meltUI() {
    /* stacked chaos: no global clear */
    makeImpactText("MELT UI");

    const heat = document.createElement("div");
    heat.className = "heat-warp";
    effectLayer.appendChild(heat);

    for (let i = 0; i < 48; i++) {
        const drip = document.createElement("div");
        drip.className = "melt-drip";
        drip.style.left = `${Math.random() * 100}vw`;
        drip.style.top = `${Math.random() * 48}vh`;
        drip.style.height = `${42 + Math.random() * 130}px`;
        drip.style.animationDelay = `${Math.random() * 2.4}s`;

        effectLayer.appendChild(drip);

        setTimeout(() => drip.remove(), 6600);
    }

    setTimeout(() => {
        effectLayer.innerHTML = "";
        hardResetVisuals();
    }, 6600);
}

function cheeseQuake() {
    /* stacked chaos: no global clear */
    makeImpactText("CHEESEQUAKE");

    const quakeOverlay = document.createElement("div");
    quakeOverlay.className = "quake-overlay";
    effectLayer.appendChild(quakeOverlay);

    for (let i = 0; i < 90; i++) {
        const crumb = document.createElement("div");
        crumb.className = "quake-crumb";
        crumb.textContent = Math.random() > 0.35 ? "🧀" : "•";
        crumb.style.left = `${Math.random() * 100}vw`;
        crumb.style.top = `${Math.random() * 100}vh`;
        crumb.style.animationDelay = `${Math.random() * 2}s`;
        crumb.style.fontSize = `${10 + Math.random() * 24}px`;
        crumb.style.setProperty("--crumb-x", `${-80 + Math.random() * 160}px`);
        effectLayer.appendChild(crumb);
    }

    setTimeout(() => {
        effectLayer.innerHTML = "";
        hardResetVisuals();
    }, 5400);
}

function cheesePortal() {
    /* stacked chaos: no global clear */
    makeImpactText("CHEESE PORTAL");

    const portal = document.createElement("div");
    portal.className = "cheese-portal";
    portal.innerHTML = `
        <div class="portal-ring portal-ring-one"></div>
        <div class="portal-ring portal-ring-two"></div>
        <div class="portal-core">🧀</div>
    `;
    effectLayer.appendChild(portal);

    const flash = document.createElement("div");
    flash.className = "portal-flash";
    effectLayer.appendChild(flash);

    setTimeout(() => {
        effectLayer.innerHTML = "";
        hardResetVisuals();
    }, 5700);
}

function mouldTakeover() {
    /* stacked chaos: no global clear */
    makeImpactText("MOULD TAKEOVER");

    const mould = document.createElement("div");
    mould.className = "mould-overlay";
    effectLayer.appendChild(mould);

    for (let i = 0; i < 38; i++) {
        const patch = document.createElement("div");
        patch.className = "mould-patch";
        patch.style.left = `${Math.random() * 100}vw`;
        patch.style.top = `${Math.random() * 100}vh`;
        patch.style.width = `${50 + Math.random() * 190}px`;
        patch.style.height = `${50 + Math.random() * 190}px`;
        patch.style.animationDelay = `${Math.random() * 2.4}s`;
        effectLayer.appendChild(patch);
    }

    setTimeout(() => {
        effectLayer.innerHTML = "";
        hardResetVisuals();
    }, 6700);
}

function cheeseMoon() {
    /* stacked chaos: no global clear */
    makeImpactText("THE CHEESE MOON RISES");

    const moon = document.createElement("div");
    moon.className = "cheese-moon";
    moon.textContent = "🧀";
    effectLayer.appendChild(moon);

    const glow = document.createElement("div");
    glow.className = "cheese-moon-glow";
    effectLayer.appendChild(glow);

    for (let i = 0; i < 55; i++) {
        const dust = document.createElement("div");
        dust.className = "moon-dust";
        dust.textContent = "✨";
        dust.style.left = `${Math.random() * 100}vw`;
        dust.style.top = `${Math.random() * 100}vh`;
        dust.style.animationDelay = `${Math.random() * 4}s`;
        effectLayer.appendChild(dust);
    }

    setTimeout(() => {
        effectLayer.innerHTML = "";
        hardResetVisuals();
    }, 8000);
}

function giantMouseTrap() {
    /* stacked chaos: no global clear */
    makeImpactText("SNAP");

    const trap = document.createElement("div");
    trap.className = "giant-mouse-trap";
    trap.innerHTML = `
        <div class="trap-board">🪤</div>
        <div class="trap-text">GIANT MOUSE TRAP</div>
    `;

    effectLayer.appendChild(trap);

    setTimeout(() => {
        effectLayer.innerHTML = "";
        hardResetVisuals();
    }, 4200);
}

function cheeseMeteor() {
    /* stacked chaos: no global clear */
    makeImpactText("CHEESE METEOR");

    const meteor = document.createElement("div");
    meteor.className = "cheese-meteor";
    meteor.textContent = "🧀";
    effectLayer.appendChild(meteor);

    setTimeout(() => {
        const impact = document.createElement("div");
        impact.className = "meteor-impact";
        effectLayer.appendChild(impact);

        for (let i = 0; i < 90; i++) {
            const crumb = document.createElement("div");
            crumb.className = "meteor-crumb";
            crumb.textContent = Math.random() > 0.3 ? "🧀" : "🔥";
            crumb.style.left = "50vw";
            crumb.style.top = "58vh";
            crumb.style.setProperty("--mx", `${-400 + Math.random() * 800}px`);
            crumb.style.setProperty("--my", `${-260 + Math.random() * 420}px`);
            effectLayer.appendChild(crumb);
        }
    }, 1200);

    setTimeout(() => {
        effectLayer.innerHTML = "";
        hardResetVisuals();
    }, 6200);
}

function cheesenado() {
    /* stacked chaos: no global clear */
    makeImpactText("CHEESENADO");

    const tornado = document.createElement("div");
    tornado.className = "cheesenado";
    tornado.innerHTML = `
        <div>🧀</div>
        <div>🌪️</div>
        <div>🧀</div>
    `;
    effectLayer.appendChild(tornado);

    for (let i = 0; i < 70; i++) {
        const bit = document.createElement("div");
        bit.className = "cheesenado-bit";
        bit.textContent = Math.random() > 0.25 ? "🧀" : "🐭";
        bit.style.setProperty("--angle", `${Math.random() * 360}deg`);
        bit.style.setProperty("--distance", `${80 + Math.random() * 320}px`);
        bit.style.animationDelay = `${Math.random() * 3.5}s`;
        effectLayer.appendChild(bit);
    }

    setTimeout(() => {
        effectLayer.innerHTML = "";
        hardResetVisuals();
    }, 7000);
}

function singularicheese() {
    /* stacked chaos: no global clear */
    makeImpactText("SINGULARICHEESE");

    const targets = [
        ...document.querySelectorAll(
            ".message, .system-message, .room-button, .online-user, .chat-header h2, .chat-header p, .sidebar-title, .server-card, .schedule-popup, .message-bar, .chat-header-pill, .sidebar-arcade-card, .shop-panel"
        )
    ].filter(element => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    });

    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;

    const hole = document.createElement("div");
    hole.className = "singularicheese-super";
    hole.innerHTML = `
        <div class="singularity-core">🧀</div>
        <div class="singularity-ring ring-one"></div>
        <div class="singularity-ring ring-two"></div>
        <div class="singularity-ring ring-three"></div>
        <div class="singularity-label">SINGULARICHEESE</div>
    `;

    const vortex = document.createElement("div");
    vortex.className = "singularity-vortex";

    const flash = document.createElement("div");
    flash.className = "singularity-flash";

    effectLayer.appendChild(vortex);
    effectLayer.appendChild(flash);
    effectLayer.appendChild(hole);

    document.body.classList.add("singularity-background");

    targets.forEach((element, index) => {
        const rect = element.getBoundingClientRect();

        const clone = element.cloneNode(true);
        clone.className = "singularity-clone";

        clone.style.left = `${rect.left}px`;
        clone.style.top = `${rect.top}px`;
        clone.style.width = `${rect.width}px`;
        clone.style.height = `${rect.height}px`;

        const startX = rect.left + rect.width / 2;
        const startY = rect.top + rect.height / 2;

        const pullX = centerX - startX;
        const pullY = centerY - startY;

        const blastX = (Math.random() - 0.5) * window.innerWidth * 1.4;
        const blastY = (Math.random() - 0.5) * window.innerHeight * 1.1;

        clone.style.setProperty("--pull-x", `${pullX}px`);
        clone.style.setProperty("--pull-y", `${pullY}px`);
        clone.style.setProperty("--blast-x", `${blastX}px`);
        clone.style.setProperty("--blast-y", `${blastY}px`);
        clone.style.setProperty("--spin", `${360 + Math.random() * 900}deg`);
        clone.style.animationDelay = `${index * 0.014}s`;

        effectLayer.appendChild(clone);
        element.classList.add("singularity-hidden-original");
    });

    setTimeout(() => {
        document.body.classList.add("singularity-spit");
    }, 2200);

    setTimeout(() => {
        targets.forEach(element => {
            element.classList.remove("singularity-hidden-original");
        });

        effectLayer.innerHTML = "";
        document.body.classList.remove("singularity-background", "singularity-spit");
        hardResetVisuals();
    }, 4900);
}

function runChaosEvent(type) {
    const cleanType = String(type || "")
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/-/g, "")
        .replace(/_/g, "");

    if (cleanType === "clearvisuals") /* stacked chaos: no global clear */
    if (cleanType === "cheeserain") cheeseRain();
    if (cleanType === "cheesestorm") cheeseStorm();
    if (cleanType === "mouserun") mouseRun();
    if (cleanType === "lactosebomb") lactoseBomb();
    if (cleanType === "butterbomb") butterBomb();
    if (cleanType === "singularicheese") singularicheese();
    if (cleanType === "meltui") meltUI();
    if (cleanType === "butterflood") butterFlood();
    if (cleanType === "cheesequake") cheeseQuake();
    if (cleanType === "cheeseportal") cheesePortal();
    if (cleanType === "mouldtakeover") mouldTakeover();
    if (cleanType === "cheesemoon") cheeseMoon();
    if (cleanType === "giantmousetrap") giantMouseTrap();
    if (cleanType === "cheesemeteor") cheeseMeteor();
    if (cleanType === "cheesenado") cheesenado();
}

/* =========================
   INPUT EVENTS
========================= */

messageInput.addEventListener("input", () => {
    updateCounter();

    if (currentRoomInfo && currentRoomInfo.readOnly) return;

    socket.emit("typing", {
        room: currentRoom
    });

    clearTimeout(typingTimer);

    typingTimer = setTimeout(() => {
        socket.emit("stop typing", {
            room: currentRoom
        });
    }, 900);
});

messageInput.addEventListener("keydown", event => {
    if (event.key === "Enter") {
        sendMessage();
    }
});

setInterval(() => {
    updateCooldownText();
    updatePollTimer();

    if (latestScheduledEvents.length > 0) {
        renderScheduledEvents(latestScheduledEvents);
    } else {
        renderSchedulePopup();
    }
}, 1000);

/* =========================
   SOCKET EVENTS
========================= */

socket.on("admin status", data => {
    isAdmin = data.admin;

    if (isAdmin) {
        adminOpenBtn.classList.remove("hidden");
    }
});

socket.on("room data", data => {
    currentRoom = data.room || currentRoom;
    currentRoomInfo = data.roomInfo;

    updateRoomUI(data.room, data.roomInfo);
    unreadCounts[data.room] = 0;
    renderUnreadBadges();
    renderRoomMessages(data.messages);
});

socket.on("chat message", data => {
    addMessage(data);
});

socket.on("reaction update", data => {
    if (data.room !== currentRoom) return;

    updateReactions(data.messageId, data.reactions);
});

socket.on("system message", data => {
    addSystemMessage(data.text, data.room || currentRoom);
});

socket.on("online users", users => {
    onlineUsers.innerHTML = "";

    onlineCount.textContent = `${users.length} online`;

    if (adminPlayerSelect) {
        adminPlayerSelect.innerHTML = `<option value="">Select online player...</option>`;
    }

    users.forEach(user => {
        const div = document.createElement("div");
        div.className = "online-user";

        const dot = document.createElement("span");
        dot.className = "status-dot";

        const name = document.createElement("span");
        name.textContent = user.username || "Unknown";
        name.title = user.realName || user.username || "Unknown";
        name.onclick = () => {
            socket.emit("request profile", user.realName || user.username);
        };

        const room = document.createElement("small");

        room.textContent =
            user.room === "blueCheese"
                ? "Blue Cheese"
                : user.room === "butter"
                    ? "Butter"
                    : user.room === "grilledCheese"
                        ? "Grilled Cheese"
                        : user.room === "cheddar"
                            ? "Cheddar"
                            : user.room === "mozzarella"
                                ? "Mozzarella"
                                : String(user.room || "").startsWith("temp-")
                                    ? "Temp Server"
                                    : "Cheese Lounge";

        div.appendChild(dot);
        div.appendChild(name);
        div.appendChild(room);

        onlineUsers.appendChild(div);

        if (adminPlayerSelect) {
            const option = document.createElement("option");
            option.value = user.realName || user.username;
            option.textContent = user.username;
            adminPlayerSelect.appendChild(option);
        }
    });
});

socket.on("message rejected", message => {
    showChatNotice(message);
});

socket.on("coin notice", message => {
    showChatNotice(message);

    const match = String(message || "").match(/\+?([0-9][0-9,]*)\s*Cheese Coins|\+?([0-9][0-9,]*)\s*🧀/i);
    const amount = Number(String((match && (match[1] || match[2])) || "").replace(/,/g, ""));

    if (amount > 0) {
        animateCoinGain(amount);
    }
});

socket.on("shop reply", message => {
    isOpeningCrate = false;
    showShopReply(message);

    if (crateOverlay && !crateOverlay.classList.contains("hidden")) {
        crateOverlay.classList.add("hidden");
        crateOverlayCard.innerHTML = "";
    }
});

socket.on("crate opened", data => {
    renderCrateResult(data);
});

socket.on("arcade crate opened", data => {
    isOpeningCrate = false;
    renderArcadeCrateReward(data);
});

socket.on("arcade challenge reward", data => {
    renderArcadeChallengeReward(data.reward, "Daily Challenge Complete");
    markArcadeChallengeClaimed(data.challengeId);
});

socket.on("daily arcade bonus reward", data => {
    renderArcadeChallengeReward(data.reward, "3/3 Daily Bonus — Arcade Crate");
    markArcadeBonusClaimed();
});

socket.on("cosmetic choice", data => {
    renderCosmeticChoice(data.choices || []);
});

socket.on("player data", data => {
    updatePlayerData(data);
});

socket.on("profile data", data => {
    socket.emit("request social data");
    renderProfile(data);
});

socket.on("typing", data => {
    const set = getTypingSet(data.room);
    set.add(data.username);
    updateTypingIndicatorForRoom(data.room);
});

socket.on("stop typing", data => {
    const set = getTypingSet(data.room);
    set.delete(data.username);
    updateTypingIndicatorForRoom(data.room);
});

socket.on("admin warning", message => {
    showChatNotice(`⚠️ Admin warning: ${message}`);
});

socket.on("admin announcement", message => {
    showChatNotice(`📢 ${message}`);
});

socket.on("admin reply", message => {
    adminReply.textContent = message;
});

socket.on("schedule state", events => {
    renderScheduledEvents(events || []);
});

socket.on("chaos level", level => {
    chaosFill.style.width = `${level}%`;
    chaosText.textContent = `${level}% chaotic`;
});

socket.on("poll started", data => {
    latestPoll = data;
    latestPollVotes = {};
    renderPoll();
});

socket.on("poll update", data => {
    latestPollVotes = data.votes || {};
    renderPoll();
});

socket.on("poll ended", data => {
    const winner = data.winner;
    showChatNotice(`🗳️ ${winner.name} won the poll!`);
    latestPoll = null;
    latestPollVotes = {};
    renderPoll();
});

socket.on("poll reply", message => {
    showChatNotice(message);
});

socket.on("visual name override", name => {
    if (name) {
        showChatNotice(`Everyone is now ${name}.`);
    } else {
        showChatNotice("Names returned to normal.");
    }
});

socket.on("banned", data => {
    alert(`You were banned. Reason: ${data.reason}`);
    location.reload();
});

socket.on("force logout", message => {
    alert(message);
    location.reload();
});

updateCounter();

/* =========================
   CHEESE CLICKER
========================= */

const CHEESE_CLICKER_SAVE_KEY = "cheeseClickerSaveV1";
let currentClickerTab = "cheese";
let goldenCheeseTimer = null;

const cheeseClickerCheeseUpgrades = [
    { id: "cheddar", name: "Cheddar", power: 1, cost: 20, description: "Mild, savoury, and reliable" },
    { id: "matureCheddar", name: "Mature Cheddar", power: 2, cost: 80, description: "Rich, tangy, and sharp" },
    { id: "brie", name: "Brie", power: 5, cost: 120, description: "Oozing, creamy, and sophisticated" },
    { id: "gouda", name: "Gouda", power: 10, cost: 300, description: "Smooth and smoky" },
    { id: "swiss", name: "Swiss", power: 20, cost: 850, description: "Full of holes; full of potential" },
    { id: "blueCheese", name: "Blue Cheese", power: 50, cost: 2500, description: "Bold, mouldy, and extremely rich" },
    { id: "cheddar", name: "Cheddar", power: 75, cost: 4500, description: "Watery, crumbly, and great for salads" },
    { id: "mozzarella", name: "Mozzarella", power: 100, cost: 6000, description: "Mild, milky, and stretchy" },
    { id: "parmesan", name: "Parmesan", power: 125, cost: 7500, description: "Hard and salty" }
    ,{ id: "pepperJack", name: "Pepper Jack", power: 180, cost: 12000, description: "Spicy clicks with a tiny kick" }
    ,{ id: "stilton", name: "Blue Stilton", power: 260, cost: 22000, description: "Rich, powerful, and suspiciously blue" }
    ,{ id: "fonduePot", name: "Fondue Pot", power: 420, cost: 50000, description: "Every click is melted chaos" }
    ,{ id: "goldenCheddar", name: "Golden Cheddar", power: 900, cost: 150000, description: "Premium cheese pressure" }

];

const cheeseClickerHelpers = [
    { id: "mouseHelper", name: "Mouse Helper", cps: 1, cost: 50, description: "A suspiciously helpful mouse" },
    { id: "ratHelper", name: "Rat Helper", cps: 5, cost: 180, description: "Bigger, faster, and slightly concerning" },
    { id: "hamsterHelper", name: "Hamster Helper", cps: 12, cost: 500, description: "Stores cheese in emergency cheeks" },
    { id: "cheeseChef", name: "Cheese Chef", cps: 35, cost: 1600, description: "Crafts premium cheese nonstop" },
    { id: "mozzarellaStretcher", name: "Mozzarella Stretcher", cps: 90, cost: 5000, description: "Stretches cheese around the clock" },
    { id: "cheeseGoblin", name: "Cheese Goblin", cps: 250, cost: 18000, description: "Lives entirely off stolen cheese" },
    { id: "cheeseDragon", name: "Cheese Dragon", cps: 1000, cost: 100000, description: "Sleeps on mountains of molten cheese" }
    ,{ id: "cheeseBotWorker", name: "CheeseBot Worker", cps: 2200, cost: 250000, description: "Calculates cheese at robot speed" }
    ,{ id: "ratUnion", name: "Rat Union", cps: 6000, cost: 750000, description: "Collective bargaining, collective cheese" }
    ,{ id: "fondueReactor", name: "Fondue Reactor", cps: 15000, cost: 2500000, description: "A dangerously warm income source" }
    ,{ id: "chaosEngine", name: "Chaos Engine", cps: 50000, cost: 10000000, description: "Probably safe. Probably." }

];

const cheeseifyMultipliers = [1.25, 1.5, 1.75, 2, 4];
const cheeseifyCosts = [1000, 2000, 4000, 8000, 20000];

function defaultCheeseClickerSave() {
    return { cheese: 0, highScore: 0, clicks: 0, cheeseifyLevel: 0, cheeseUpgrades: {}, helpers: {} };
}

function loadCheeseClickerSave() {
    try {
        return Object.assign(defaultCheeseClickerSave(), JSON.parse(localStorage.getItem(CHEESE_CLICKER_SAVE_KEY)) || {});
    } catch (err) {
        return defaultCheeseClickerSave();
    }
}

function saveCheeseClickerSave(save) {
    localStorage.setItem(CHEESE_CLICKER_SAVE_KEY, JSON.stringify(save));
}

function getCheeseifyMultiplier(save = loadCheeseClickerSave()) {
    let multiplier = 1;
    for (let i = 0; i < save.cheeseifyLevel; i++) multiplier *= cheeseifyMultipliers[i] || 4;
    return multiplier;
}

function getCheeseifyCost(save = loadCheeseClickerSave()) {
    const level = save.cheeseifyLevel;
    if (level < cheeseifyCosts.length) return cheeseifyCosts[level];
    return Math.floor(cheeseifyCosts[cheeseifyCosts.length - 1] * Math.pow(2.5, level - cheeseifyCosts.length + 1));
}

function getCheeseifyNextMultiplier(save = loadCheeseClickerSave()) {
    return cheeseifyMultipliers[save.cheeseifyLevel] || 4;
}

function getClickPower(save = loadCheeseClickerSave()) {
    let power = 1;
    cheeseClickerCheeseUpgrades.forEach(upgrade => power += (save.cheeseUpgrades[upgrade.id] || 0) * upgrade.power);
    return power;
}

function getPerClick(save = loadCheeseClickerSave()) {
    return Math.floor(getClickPower(save) * getCheeseifyMultiplier(save));
}

function getPerSecond(save = loadCheeseClickerSave()) {
    let cps = 0;
    cheeseClickerHelpers.forEach(helper => cps += (save.helpers[helper.id] || 0) * helper.cps);
    return Math.floor(cps * getCheeseifyMultiplier(save));
}

function formatCheese(number) {
    return Math.floor(number || 0).toLocaleString();
}

function updateCheeseClickerCard() {
    const save = loadCheeseClickerSave();
    const highScore = document.getElementById("cheeseClickerHighScore");
    if (highScore) highScore.textContent = `${formatCheese(save.highScore)} 🧀`;
}

function openCheeseClicker() {
    const game = document.getElementById("cheeseClickerGame");
    if (!game) return;
    game.classList.remove("hidden");
    renderCheeseClicker();
    scheduleGoldenCheese();
}

function closeCheeseClicker() {
    const game = document.getElementById("cheeseClickerGame");
    if (game) game.classList.add("hidden");
    if (goldenCheeseTimer) clearTimeout(goldenCheeseTimer);
    goldenCheeseTimer = null;
}

function switchClickerTab(tab) {
    currentClickerTab = tab;
    document.querySelectorAll(".clicker-tab").forEach(button => button.classList.remove("active"));
    const index = tab === "cheese" ? 0 : tab === "helpers" ? 1 : 2;
    const tabButton = document.querySelectorAll(".clicker-tab")[index];
    if (tabButton) tabButton.classList.add("active");
    renderCheeseClicker();
}

function renderCheeseClicker() {
    const save = loadCheeseClickerSave();
    const total = document.getElementById("clickerCheeseTotal");
    const perClick = document.getElementById("clickerPerClick");
    const perSecond = document.getElementById("clickerPerSecond");
    const multiplier = document.getElementById("clickerMultiplier");
    const list = document.getElementById("clickerUpgradeList");

    if (total) total.textContent = `${formatCheese(save.cheese)} 🧀`;
    if (perClick) perClick.textContent = `${formatCheese(getPerClick(save))} 🧀`;
    if (perSecond) perSecond.textContent = `${formatCheese(getPerSecond(save))} 🧀`;
    if (multiplier) multiplier.textContent = `x${getCheeseifyMultiplier(save).toFixed(2).replace(/\.00$/, "")}`;
    updateCheeseClickerCard();
    if (!list) return;

    if (currentClickerTab === "cheese") {
        list.innerHTML = cheeseClickerCheeseUpgrades.map(upgrade => {
            const owned = save.cheeseUpgrades[upgrade.id] || 0;
            return `<button class="clicker-upgrade-card" onclick="buyCheeseUpgrade('${upgrade.id}')"><strong>${upgrade.name}</strong><span>+${upgrade.power} 🧀 per click • owned ${owned}</span><small>${upgrade.description}</small><b>Cost: ${formatCheese(upgrade.cost)} 🧀</b></button>`;
        }).join("");
    }

    if (currentClickerTab === "helpers") {
        list.innerHTML = cheeseClickerHelpers.map(helper => {
            const owned = save.helpers[helper.id] || 0;
            return `<button class="clicker-upgrade-card" onclick="buyHelperUpgrade('${helper.id}')"><strong>${helper.name}</strong><span>+${helper.cps} 🧀 per second • owned ${owned}</span><small>${helper.description}</small><b>Cost: ${formatCheese(helper.cost)} 🧀</b></button>`;
        }).join("");
    }

    if (currentClickerTab === "cheeseify") {
        const cost = getCheeseifyCost(save);
        const next = getCheeseifyNextMultiplier(save);
        list.innerHTML = `<div class="cheeseify-card"><h2>🧀 CHEESEIFY 🧀</h2><p>Reset your cheese, cheese upgrades, and helpers to multiply future gains.</p><div class="cheeseify-stats"><span>Level: ${save.cheeseifyLevel}</span><span>Current multiplier: x${getCheeseifyMultiplier(save).toFixed(2).replace(/\.00$/, "")}</span><span>Next Cheeseify: x${next}</span><span>Cost: ${formatCheese(cost)} 🧀</span></div><button onclick="cheeseifyNow()" ${save.cheese < cost ? "disabled" : ""}>🧀 CHEESEIFY 🧀</button></div>`;
    }
}

function clickBigCheese() {
    const save = loadCheeseClickerSave();
    const gain = getPerClick(save);
    save.cheese += gain;
    save.clicks += 1;
    if (save.cheese > save.highScore) save.highScore = save.cheese;
    saveCheeseClickerSave(save);
    spawnClickerFloat(`+${formatCheese(gain)} 🧀`);
    recordArcadeChallengeProgress("clickerClicks", 1);
    const button = document.getElementById("cheeseClickButton");
    if (button) {
        button.classList.remove("clicked");
        void button.offsetWidth;
        button.classList.add("clicked");
    }
    renderCheeseClicker();
}

function spawnClickerFloat(text) {
    const layer = document.getElementById("clickerFloatLayer");
    if (!layer) return;
    const item = document.createElement("div");
    item.className = "clicker-floating-number";
    item.textContent = text;
    item.style.left = `${40 + Math.random() * 20}%`;
    item.style.setProperty("--float-x", `${Math.floor(Math.random() * 100 - 50)}px`);
    layer.appendChild(item);
    setTimeout(() => item.remove(), 900);
}

function buyCheeseUpgrade(id) {
    const upgrade = cheeseClickerCheeseUpgrades.find(item => item.id === id);
    const save = loadCheeseClickerSave();
    if (!upgrade || save.cheese < upgrade.cost) return;
    save.cheese -= upgrade.cost;
    save.cheeseUpgrades[id] = (save.cheeseUpgrades[id] || 0) + 1;
    saveCheeseClickerSave(save);
    recordArcadeChallengeProgress("clickerUpgrades", 1);
    renderCheeseClicker();
}

function buyHelperUpgrade(id) {
    const helper = cheeseClickerHelpers.find(item => item.id === id);
    const save = loadCheeseClickerSave();
    if (!helper || save.cheese < helper.cost) return;
    save.cheese -= helper.cost;
    save.helpers[id] = (save.helpers[id] || 0) + 1;
    saveCheeseClickerSave(save);
    recordArcadeChallengeProgress("clickerUpgrades", 1);
    renderCheeseClicker();
}

function cheeseifyNow() {
    const save = loadCheeseClickerSave();
    const cost = getCheeseifyCost(save);
    if (save.cheese < cost) return;
    save.cheese = 0;
    save.cheeseifyLevel += 1;
    save.cheeseUpgrades = {};
    save.helpers = {};
    saveCheeseClickerSave(save);
    spawnClickerFloat("🧀 CHEESEIFIED 🧀");
    renderCheeseClicker();
}

function scheduleGoldenCheese() {
    if (goldenCheeseTimer) clearTimeout(goldenCheeseTimer);
    goldenCheeseTimer = setTimeout(() => {
        spawnGoldenCheese();
        scheduleGoldenCheese();
    }, 30000 + Math.random() * 60000);
}

function spawnGoldenCheese() {
    const layer = document.getElementById("goldenCheeseLayer");
    if (!layer || document.getElementById("cheeseClickerGame")?.classList.contains("hidden")) return;
    const golden = document.createElement("button");
    golden.className = "golden-cheese-mouse";
    golden.innerHTML = "🐭💨 <span>🧀</span>";
    golden.onclick = () => {
        const save = loadCheeseClickerSave();
        const reward = 100 + Math.floor(Math.random() * 901);
        save.cheese += reward;
        if (save.cheese > save.highScore) save.highScore = save.cheese;
        saveCheeseClickerSave(save);
        spawnClickerFloat(`+${reward} 🧀`);
        golden.remove();
        renderCheeseClicker();
    };
    layer.appendChild(golden);
    setTimeout(() => {
        if (golden.parentNode) golden.remove();
    }, 8000);
}

function resetCheeseClickerHighScore() {
    const save = loadCheeseClickerSave();
    save.highScore = 0;
    saveCheeseClickerSave(save);
    updateCheeseClickerCard();
    renderCheeseClicker();
}

function resetCheeseClickerSave() {
    localStorage.removeItem(CHEESE_CLICKER_SAVE_KEY);
    updateCheeseClickerCard();
    renderCheeseClicker();
}

setInterval(() => {
    const game = document.getElementById("cheeseClickerGame");
    const isClosed = !game || game.classList.contains("hidden");

    const save = loadCheeseClickerSave();
    const gain = getPerSecond(save);

    if (gain <= 0) return;

    save.cheese += gain;

    if (save.cheese > save.highScore) save.highScore = save.cheese;

    saveCheeseClickerSave(save);

    if (!isClosed) {
        renderCheeseClicker();
    } else {
        updateCheeseClickerCard();
    }
}, 1000);



/* =========================================================
   UPGRADED CHAOS VISUALS
========================================================= */

function ensureChaosStage() {
    let layer = document.getElementById("effectLayer");

    if (!layer) {
        layer = document.createElement("div");
        layer.id = "effectLayer";
        document.body.appendChild(layer);
    }

    layer.classList.add("effect-layer", "chaos-layer");
    return layer;
}

function chaosBanner(title, subtitle = "") {
    const layer = ensureChaosStage();
    const banner = document.createElement("div");
    banner.className = "chaos-banner";
    banner.innerHTML = `
        <strong>${title}</strong>
        ${subtitle ? `<span>${subtitle}</span>` : ""}
    `;
    layer.appendChild(banner);

    setTimeout(() => banner.classList.add("leaving"), 2300);
    setTimeout(() => banner.remove(), 3000);
}

function chaosBurst(emoji, count = 40, options = {}) {
    const layer = ensureChaosStage();

    for (let i = 0; i < count; i++) {
        const item = document.createElement("div");
        item.className = "chaos-particle";
        item.textContent = Array.isArray(emoji)
            ? emoji[Math.floor(Math.random() * emoji.length)]
            : emoji;

        const size = options.size || (22 + Math.random() * 34);
        item.style.fontSize = `${size}px`;
        item.style.left = `${Math.random() * 100}vw`;
        item.style.top = `${options.fromTop ? -12 : Math.random() * 100}vh`;
        item.style.setProperty("--dx", `${Math.random() * 260 - 130}px`);
        item.style.setProperty("--dy", `${options.fromTop ? 115 + Math.random() * 30 : Math.random() * 280 - 140}vh`);
        item.style.setProperty("--rot", `${Math.random() * 900 - 450}deg`);
        item.style.animationDuration = `${options.duration || (2.4 + Math.random() * 1.4)}s`;

        layer.appendChild(item);
        setTimeout(() => item.remove(), 4500);
    }
}

function chaosFlash(className, ms = 2200) {
    document.body.classList.add(className);
    setTimeout(() => document.body.classList.remove(className), ms);
}

function upgradedCheeseRain() {
    chaosBanner("🧀 CHEESE RAIN", "The forecast is 100% dairy.");
    chaosBurst(["🧀", "✨"], 90, { fromTop: true, duration: 3.2 });
    chaosFlash("chaos-golden-glow", 2500);
}

function upgradedCheeseStorm() {
    chaosBanner("🧀⛈️ CHEESE STORM", "A storm of curds rolls in.");
    chaosBurst(["🧀", "⚡", "🌩️"], 130, { fromTop: true, duration: 2.6 });
    chaosFlash("chaos-storm-mode", 3000);
    upgradedCheeseQuake();
}

function upgradedSingularicheese() {
    chaosBanner("🧀🌀 SINGULARICHEESE", "Reality is being grated.");
    const layer = ensureChaosStage();
    const singularity = document.createElement("div");
    singularity.className = "chaos-singularity";
    singularity.innerHTML = "🧀";
    layer.appendChild(singularity);

    chaosBurst(["🧀", "✨", "🌀"], 90, { duration: 2.8 });
    chaosFlash("chaos-space-warp", 3500);

    setTimeout(() => singularity.remove(), 3600);
}

function upgradedMouseRun() {
    chaosBanner("🐭 MOUSE RUN", "The mice have breached containment.");
    const layer = ensureChaosStage();

    for (let i = 0; i < 9; i++) {
        const mouse = document.createElement("div");
        mouse.className = "chaos-mouse";
        mouse.textContent = i % 3 === 0 ? "🐭💨" : "🐭";
        mouse.style.bottom = `${20 + i * 8 + Math.random() * 55}px`;
        mouse.style.animationDelay = `${i * 0.12}s`;
        mouse.style.animationDuration = `${2.2 + Math.random() * 1.1}s`;
        layer.appendChild(mouse);
        setTimeout(() => mouse.remove(), 4500);
    }
}

function upgradedMeltUI() {
    chaosBanner("🫕 MELT UI", "Everything is getting dangerously gooey.");
    chaosFlash("chaos-melt-ui", 3800);
    chaosBurst(["🫕", "🧀"], 45, { duration: 3.5 });
}

function upgradedButterFlood() {
    chaosBanner("🧈🌊 BUTTER FLOOD", "Smooth disaster incoming.");
    const layer = ensureChaosStage();
    const flood = document.createElement("div");
    flood.className = "chaos-butter-flood";
    flood.innerHTML = "🧈 🧈 🧈 🧈 🧈";
    layer.appendChild(flood);
    chaosFlash("chaos-butter-glow", 3200);
    setTimeout(() => flood.remove(), 3600);
}

function upgradedButterBomb() {
    chaosBanner("🧈💥 BUTTER BOMB", "You have been spread.");
    chaosBurst(["🧈", "💥", "✨"], 80, { duration: 2.2 });
    chaosFlash("chaos-butter-bomb", 2600);
    upgradedCheeseQuake();
}

function upgradedCheeseQuake() {
    chaosBanner("🧀🌎 CHEESEQUAKE", "Magnitude: extra sharp.");
    chaosFlash("chaos-quake", 1600);
}

function upgradedCheesePortal() {
    chaosBanner("🧀🌌 CHEESE PORTAL", "A dairy gateway opens.");
    const layer = ensureChaosStage();
    const portal = document.createElement("div");
    portal.className = "chaos-portal";
    portal.innerHTML = "🧀";
    layer.appendChild(portal);
    chaosBurst(["✨", "🧀"], 55, { duration: 2.4 });
    setTimeout(() => portal.remove(), 3400);
}

function upgradedMouldTakeover() {
    chaosBanner("☣️ MOULD TAKEOVER", "The blue cheese is spreading.");
    chaosFlash("chaos-mould", 3600);
    chaosBurst(["☣️", "🧀"], 55, { duration: 3 });
}

function upgradedCheeseMoon() {
    chaosBanner("🧀🌕 CHEESE MOON", "The moon is made of snacks.");
    const layer = ensureChaosStage();
    const moon = document.createElement("div");
    moon.className = "chaos-cheese-moon";
    moon.textContent = "🧀";
    layer.appendChild(moon);
    setTimeout(() => moon.remove(), 4600);
}

function upgradedGiantMouseTrap() {
    chaosBanner("🪤 GIANT MOUSE TRAP", "Something snapped.");
    chaosBurst(["🪤", "🐭", "💥"], 70, { duration: 2.1 });
    chaosFlash("chaos-trap", 2300);
}

function upgradedCheeseMeteor() {
    chaosBanner("🧀☄️ CHEESE METEOR", "Look up. Regret it.");
    const layer = ensureChaosStage();
    const meteor = document.createElement("div");
    meteor.className = "chaos-meteor";
    meteor.textContent = "🧀☄️";
    layer.appendChild(meteor);
    setTimeout(() => meteor.remove(), 2600);
    setTimeout(upgradedCheeseQuake, 1800);
}

function upgradedCheesenado() {
    chaosBanner("🧀🌪️ CHEESENADO", "Dairy rotation detected.");
    const layer = ensureChaosStage();
    const nado = document.createElement("div");
    nado.className = "chaos-nado";
    nado.innerHTML = "🧀<br>🧀<br>🧀<br>🧀";
    layer.appendChild(nado);
    chaosBurst(["🧀", "🌪️"], 60, { duration: 2.8 });
    setTimeout(() => nado.remove(), 3600);
}

const upgradedChaosEffects = {
    cheeserain: upgradedCheeseRain,
    cheesestorm: upgradedCheeseStorm,
    singularicheese: upgradedSingularicheese,
    mouserun: upgradedMouseRun,
    meltui: upgradedMeltUI,
    butterflood: upgradedButterFlood,
    butterbomb: upgradedButterBomb,
    cheesequake: upgradedCheeseQuake,
    cheeseportal: upgradedCheesePortal,
    mouldtakeover: upgradedMouldTakeover,
    cheesemoon: upgradedCheeseMoon,
    giantmousetrap: upgradedGiantMouseTrap,
    cheesemeteor: upgradedCheeseMeteor,
    cheesenado: upgradedCheesenado
};

function runUpgradedChaosEffect(data) {
    const rawChaosType = data && data.type ? data.type : data;
    const chaosName = data && data.name ? data.name : "Chaos Event";
    const normalizedChaosType = String(rawChaosType || "")
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/-/g, "")
        .replace(/_/g, "");

    showChatNotice(`🌪️ ${chaosName}`);

    if (normalizedChaosType === "lactosebomb") {
        lactoseBomb();
        return;
    }

    const event = data.event || data;
    const id = String(event.id || event.command || event.name || "").toLowerCase().replace(/[^a-z]/g, "");
    const fn = upgradedChaosEffects[id];

    if (fn) {
        fn();
    } else {
        if (typeof runChaosEvent === "function") {
            runChaosEvent(rawChaosType);
        }
    }
}





socket.on("server shutdown", data => {
    const reason = data && data.reason ? data.reason : "Scheduled maintenance.";
    const minutes = data && data.endsAt
        ? Math.max(1, Math.ceil((data.endsAt - Date.now()) / 60000))
        : "?";

    alert(`🧀 Server shutdown active for about ${minutes} minute(s).\n\n${reason}`);
    location.reload();
});

socket.on("server shutdown ended", () => {
    showChatNotice("🧀 Server shutdown ended.");
});





socket.on("cheese rng animation", data => {
    const overlay = document.createElement("div");
    overlay.className = "cheese-rng-overlay";
    overlay.innerHTML = `
        <div class="cheese-rng-card">
            <div class="cheese-rng-title">🎲 CHEESE RNG 🎲</div>
            <div class="cheese-rng-name">...</div>
            <div class="cheese-rng-reward"></div>
        </div>
    `;
    document.body.appendChild(overlay);

    const nameBox = overlay.querySelector(".cheese-rng-name");
    const rewardBox = overlay.querySelector(".cheese-rng-reward");
    const users = data.users && data.users.length ? data.users : ["Nobody"];

    let i = 0;
    let delay = 45;
    let count = 0;

    function spin() {
        nameBox.textContent = users[i % users.length];
        i++;
        count++;
        delay += 4;

        if (count < 36) {
            setTimeout(spin, delay);
        } else {
            nameBox.textContent = data.winner;
            rewardBox.textContent = data.reward?.text || data.reward || "";
            overlay.classList.add("winner");

            setTimeout(() => overlay.remove(), 5200);
        }
    }

    spin();
});



socket.on("cheese bank spawned", data => {
    if (!data || !data.id) return;

    document.querySelectorAll(`.huge-cheese-bank[data-bank-id="${data.id}"]`).forEach(card => card.remove());

    if (data.room !== currentRoom) {
        showChatNotice(`💰 A bank has been built in ${data.roomName}! Go there to rob it 🧀💰`);
        return;
    }

    removeEmptyState();

    const bank = document.createElement("button");
    bank.className = "huge-cheese-bank";
    bank.dataset.bankId = data.id;
    bank.innerHTML = `
        <span>🏦</span>
        <strong>ROB THE CHEESE BANK</strong>
        <small>First click gets ${data.reward || 50} 🧀</small>
    `;

    bank.onclick = () => {
        socket.emit("claim cheese bank", data);
        bank.remove();
    };

    messages.appendChild(bank);
    safeScrollToBottom();

    setTimeout(() => {
        if (bank.parentNode) bank.remove();
    }, Math.max(1000, (data.expiresAt || Date.now() + 45000) - Date.now()));
});



socket.on("whisper", data => {
    showChatNotice(`🧀 Whisper from ${data.from}: ${data.text}`);
});

socket.on("system notice", text => {
    showChatNotice(text);
});



/* =========================
   ADMIN PANEL OVERHAUL HELPERS
========================= */

function switchAdminTab(tab) {
    document.querySelectorAll(".admin-tab").forEach(button => {
        button.classList.toggle("active", button.dataset.adminTab === tab);
    });

    document.querySelectorAll(".admin-tab-panel").forEach(panel => {
        panel.classList.toggle("active", panel.id === `adminTab-${tab}`);
    });

    if (adminPanel) {
        adminPanel.classList.toggle("chaos-mode", tab === "chaos");
    }
}

function setAdminCommand(command) {
    const commandInput = document.getElementById("adminCommandInput");
    if (commandInput) commandInput.value = command;
}

function quickAdmin(command) {
    if (adminCommandSelect) adminCommandSelect.value = command;
    buildAdminCommand();
}


/* =========================
   CHEDDAR TEMP SERVERS
========================= */


function isCurrentTempOwner(server) {
    return server && currentUser && String(server.owner || "").toLowerCase() === String(currentUser).toLowerCase();
}

function setTempServerTopic(serverId) {
    const topic = prompt("Set temp server topic, max 80 chars:");

    if (topic === null) return;

    socket.emit("set temp server topic", {
        token: loginToken,
        serverId,
        topic
    });
}

function kickFromTempServer(serverId) {
    const targetUsername = prompt("Who should be removed from this temp server?");

    if (!targetUsername) return;

    socket.emit("kick from temp server", {
        token: loginToken,
        serverId,
        targetUsername
    });
}


function createTempServer() {
    const nameInput = document.getElementById("tempServerNameInput");
    const iconInput = document.getElementById("tempServerIconInput");
    const filterInput = document.getElementById("tempServerFilterInput");
    const descInput = document.getElementById("tempServerDescInput");

    const name = nameInput ? nameInput.value.trim() : "";
    const icon = iconInput ? iconInput.value.trim() : "🧀";
    const filterLevel = filterInput ? filterInput.value : "cheese";
    const description = descInput ? descInput.value.trim() : "";
    const privateInput = document.getElementById("tempServerPrivateInput");
    const codeInput = document.getElementById("tempServerCodeInput");
    const isPrivate = privateInput ? privateInput.checked : false;
    const accessCode = codeInput ? codeInput.value.trim() : "";

    if (!name) {
        showChatNotice("Temp server needs a name.");
        return;
    }

    socket.emit("create temp server", { name, icon, filterLevel, description, private: isPrivate, accessCode });

    if (nameInput) nameInput.value = "";
    if (iconInput) iconInput.value = "";
    if (descInput) descInput.value = "";
    if (codeInput) codeInput.value = "";
    if (privateInput) privateInput.checked = false;
}

function joinTempServer(serverId) {
    if (!serverId) return;

    const temp = latestTempServers.find(item => item.id === serverId);
    let accessCode = "";

    if (temp && temp.private && !isCurrentTempOwner(temp)) {
        accessCode = prompt("Private server code:") || "";
    }

    socket.emit("switch room", {
        roomId: serverId,
        accessCode
    });
}

function formatTimeLeft(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    if (minutes >= 60) {
        const hours = Math.floor(minutes / 60);
        return `${hours}h ${minutes % 60}m`;
    }

    return `${minutes}m ${seconds}s`;
}

function renderTempServers(servers) {
    if (!tempServerList) return;

    if (!servers || servers.length === 0) {
        tempServerList.innerHTML = `<div class="empty-state">No temporary servers yet. suspiciously quiet...</div>`;
        return;
    }

    tempServerList.innerHTML = "";

    servers.forEach(server => {
        const safeName = escapeHtml(server.name);
        const safeOwner = escapeHtml(server.owner || "unknown");
        const safeIcon = escapeHtml(server.icon || "🧀");
        const safeDescription = escapeHtml(server.description || "No description. mysterious cheese energy.");
        const safeTopic = escapeHtml(server.topic || "");
        const safeFilter = escapeHtml(server.filterLevel || "cheese");
        const safeAccessCode = escapeHtml(server.accessCode || "");
        const card = document.createElement("div");
        card.className = `temp-server-card filter-${safeFilter}`;

        card.innerHTML = `
            <div class="temp-server-top">
                <span>${safeIcon}</span>
                <div>
                    <h3>${safeName}</h3>
                    <small>by ${safeOwner}</small>
                </div>
            </div>
            <p>${server.private ? "🔒 Private" : safeDescription}</p>
            ${server.private && isCurrentTempOwner(server) ? `<div class="temp-topic">🔑 Code: ${safeAccessCode}</div>` : ""}
            ${server.topic ? `<div class="temp-topic">📌 ${safeTopic}</div>` : ""}
            <div class="temp-server-meta">
                <strong>Filter: ${safeFilter}</strong>
                <strong data-expires="${server.expiresAt}">${formatTimeLeft(server.expiresAt - Date.now())}</strong>
            </div>
            <button onclick="joinTempServer(\`${server.id}\`)">Join</button>
        `;

        tempServerList.appendChild(card);
    });
}

socket.on("temp servers", servers => {
    latestTempServers = servers || [];
    renderTempServers(latestTempServers);
});

setInterval(() => {
    document.querySelectorAll("[data-expires]").forEach(element => {
        const expires = Number(element.dataset.expires || 0);
        element.textContent = formatTimeLeft(expires - Date.now());
    });
}, 1000);

socket.on("chaos event", data => {
    activeChaosCount += 1;
    updateActiveChaosCounter();
    runUpgradedChaosEffect(data);
    setTimeout(() => {
        activeChaosCount = Math.max(0, activeChaosCount - 1);
        updateActiveChaosCounter();
    }, 6500);
});

function updateActiveChaosCounter() {
    let badge = document.getElementById("activeChaosCounter");
    const chaosText = document.getElementById("chaosText");

    if (!chaosText) return;

    if (!badge) {
        badge = document.createElement("span");
        badge.id = "activeChaosCounter";
        badge.className = "active-chaos-counter";
        chaosText.parentElement.appendChild(badge);
    }

    badge.textContent = activeChaosCount > 0 ? `🌪️ x${activeChaosCount}` : "";
}

function toggleMobileSidebar() {
    document.body.classList.toggle("sidebar-open");
}

document.addEventListener("click", event => {
    if (window.innerWidth > 768) return;

    const sidebar = document.querySelector(".rooms-sidebar");
    const toggle = document.getElementById("sidebarToggle");

    if (!document.body.classList.contains("sidebar-open")) return;
    if (sidebar && sidebar.contains(event.target)) return;
    if (toggle && toggle.contains(event.target)) return;

    document.body.classList.remove("sidebar-open");
});



/* =========================
   WAVE 2: ACHIEVEMENTS / SEASONS / ADMIN LOG
========================= */

let currentSeasonState = null;

socket.on("season changed", data => {
    currentSeasonState = data || { season: null, endsAt: null };
    document.body.dataset.season = currentSeasonState.season || "";

    if (currentSeasonState.season) {
        showChatNotice(`🎉 ${currentSeasonState.season} season is active!`);
    } else {
        showChatNotice("Season cleared.");
    }

    updateSeasonCountdown();
});

function updateSeasonCountdown() {
    const chaosText = document.getElementById("chaosText");
    if (!chaosText) return;

    let seasonBadge = document.getElementById("seasonCountdown");

    if (!currentSeasonState || !currentSeasonState.season) {
        if (seasonBadge) seasonBadge.remove();
        return;
    }

    if (!seasonBadge) {
        seasonBadge = document.createElement("span");
        seasonBadge.id = "seasonCountdown";
        seasonBadge.className = "season-countdown";
        chaosText.parentElement.appendChild(seasonBadge);
    }

    const seconds = Math.max(0, Math.ceil((currentSeasonState.endsAt - Date.now()) / 1000));
    seasonBadge.textContent = `🎨 ${currentSeasonState.season}: ${seconds}s`;
}

setInterval(updateSeasonCountdown, 1000);

socket.on("achievement unlocked", achievements => {
    (achievements || []).forEach(achievement => {
        showChatNotice(`${achievement.icon || "🏆"} Achievement unlocked: ${achievement.name} +${achievement.coins} 🧀`);
    });
});

function requestAdminLog() {
    socket.emit("request admin log", {
        token: loginToken
    });
}

socket.on("admin log data", entries => {
    const table = document.getElementById("adminLogTable");
    if (!table) return;

    table.innerHTML = (entries || []).slice().reverse().map(entry => {
        const actionClass =
            /ban|mute/i.test(entry.action) ? "danger" :
            /coin|token/i.test(entry.action) ? "success" :
            /chaos/i.test(entry.action) ? "chaos" :
            /season/i.test(entry.action) ? "season" :
            "";

        return `
            <div class="admin-log-row ${actionClass}">
                <span>${new Date(entry.timestamp).toLocaleTimeString()}</span>
                <strong>${entry.admin}</strong>
                <span>${entry.action}</span>
                <span>${entry.target || "-"}</span>
                <small>${entry.details || ""}</small>
            </div>
        `;
    }).join("");
});



function renderAchievementsIndex() {
    const box = document.getElementById("indexContent");
    if (!box || !latestPlayerData) return;

    const achievements = latestPlayerData.achievements || {};
    const entries = Object.keys(achievements);

    if (!entries.length) {
        box.innerHTML = `<div class="empty-state">No achievements yet. Go do something cheesy.</div>`;
        return;
    }

    box.innerHTML = entries.map(id => `
        <div class="index-item">
            <strong>🏆 ${id.replaceAll("_", " ")}</strong>
            <small>Unlocked ${new Date(achievements[id].unlockedAt).toLocaleString()}</small>
        </div>
    `).join("");
}



/* ==================

MERGED WAVE 1: FRIENDS, GIFTS, LEADERBOARD
========================= */



function giftCoinsTo(username) {
    const amount = Number(prompt(`Gift how many coins to ${username}? 1-500`));

    if (!Number.isFinite(amount)) return;

    socket.emit("gift coins", {
        targetUsername: username,
        amount
    });
}

socket.on("friend request", data => {
    
    socket.emit("request social data");
const wrapper = document.createElement("div");
    wrapper.className = "friend-request-toast";
    wrapper.innerHTML = `
        <strong>🧀 Friend request from ${data.from}</strong>
        <div>
            <button>Accept</button>
            <button>Decline</button>
        </div>
    `;

    const [accept, decline] = wrapper.querySelectorAll("button");

    accept.onclick = () => {
        socket.emit("accept friend request", { username: data.from });
        wrapper.remove();
    };

    decline.onclick = () => {
        socket.emit("decline friend request", { username: data.from });
        wrapper.remove();
    };

    document.body.appendChild(wrapper);
    setTimeout(() => wrapper.remove(), 15000);
});



function openLeaderboard() {
    const modal = document.getElementById("leaderboardModal");

    if (modal) {
        modal.classList.remove("hidden");
    }

    socket.emit("request leaderboard");
}

function closeLeaderboard() {
    const modal = document.getElementById("leaderboardModal");

    if (modal) {
        modal.classList.add("hidden");
    }
}

function switchLeaderboardTab(tab) {
    currentLeaderboardTab = tab;
    renderLeaderboard();
}

socket.on("leaderboard data", data => {
    latestLeaderboard = data;
    renderLeaderboard();
});

function renderLeaderboard() {
    const box = document.getElementById("leaderboardContent");

    if (!box || !latestLeaderboard) return;

    const category = latestLeaderboard[currentLeaderboardTab];

    if (!category) {
        box.innerHTML = "<p>No leaderboard data yet.</p>";
        return;
    }

    box.innerHTML = `
        <h3>${category.label}</h3>
        <div class="leaderboard-table">
            ${category.rows.map(row => `
                <div class="leaderboard-row ${row.isCurrentUser ? "current-user" : ""}">
                    <span>#${row.rank}</span>
                    <strong>${row.username}</strong>
                    <span>${Number(row.value || 0).toLocaleString()}</span>
                </div>
            `).join("")}
        </div>
    `;
}

/* =========================
   WAVE 3: PRIVATE TEMP SERVERS / FETA BOTS / CHAOS STACKING
========================= */





socket.on("chaos combo", data => {
    showChatNotice(`🌪️ ${data.text}`);
});



function submitTriviaAnswer() {
    const input = document.getElementById("triviaAnswerInput");

    if (!input) return;

    const answer = input.value.trim();

    if (!answer) {
        showChatNotice("Type a trivia answer first.");
        return;
    }

    socket.emit("answer trivia", {
        answer
    });

    input.value = "";
}


socket.on("tutorial nudge", data => {
    showChatNotice(data && data.text ? data.text : "Visit Cheddar for a quick tutorial 🤖");
});


/* =========================================================
   JUST ANOTHER LIFE OF CHEESE — SOCIAL CLIENT
========================================================= */

function switchCheddarTab(tab) {
    document.querySelectorAll(".cheddar-social-tab").forEach(button => {
        button.classList.toggle("active", button.dataset.cheddarTab === tab);
    });

    const tempServers = document.getElementById("cheddarBrowser");
    const dmPanel = document.getElementById("cheddarDmPanel");
    const friendsPanel = document.getElementById("cheddarFriendsPanel");

    if (tempServers) tempServers.classList.toggle("hidden", tab !== "servers");
    if (dmPanel) dmPanel.classList.toggle("hidden", tab !== "dms");
    if (friendsPanel) friendsPanel.classList.toggle("hidden", tab !== "friends");

    if (tab === "dms" || tab === "friends") {
        socket.emit("request social data");
    }
}

socket.on("social data", data => {
    latestSocialData = data || latestSocialData;
    renderSocialHub();

    if (currentProfileData && profileModal && !profileModal.classList.contains("hidden")) {
        renderProfile(currentProfileData, true);
    }
});



function renderSocialHub() {
    const badge = document.getElementById("dmUnreadBadge");
    const unread = Number(latestSocialData.unreadTotal || 0);

    if (badge) {
        badge.textContent = unread;
        badge.classList.toggle("hidden", unread <= 0);
    }

    renderDmList();
    renderFriendsList();
}

function renderDmList() {
    const box = document.getElementById("dmList");
    if (!box) return;

    const friends = latestSocialData.friends || [];

    if (!friends.length) {
        box.innerHTML = `<div class="empty-state">Add friends to start DMs 🧀</div>`;
        return;
    }

    box.innerHTML = friends
        .slice()
        .sort((a, b) => Number(b.lastMessageAt || 0) - Number(a.lastMessageAt || 0))
        .map(friend => `
            <button class="dm-row" onclick="openDmWith('${friend.username}')">
                <span class="dm-avatar">${friend.online ? "🟢" : "⚪"}</span>
                <strong>${escapeHtml(friend.username)}</strong>
                <small>${escapeHtml(friend.lastMessagePreview || "No messages yet")}</small>
                ${friend.unread ? `<span class="mini-badge">${friend.unread}</span>` : ""}
            </button>
        `).join("");
}

function renderFriendsList() {
    const requestBox = document.getElementById("friendRequestsList");
    const friendsBox = document.getElementById("friendsList");

    if (requestBox) {
        const incoming = latestSocialData.incoming || [];
        const outgoing = latestSocialData.outgoing || [];

        requestBox.innerHTML = `
            ${incoming.length ? `<h4>Incoming requests</h4>` : ""}
            ${incoming.map(name => `
                <div class="friend-row">
                    <strong>${escapeHtml(name)}</strong>
                    <span>
                        <button onclick="acceptFriendRequest('${name}')">Accept</button>
                        <button onclick="declineFriendRequest('${name}')">Decline</button>
                    </span>
                </div>
            `).join("")}
            ${outgoing.length ? `<h4>Sent requests</h4>` : ""}
            ${outgoing.map(name => `
                <div class="friend-row">
                    <strong>${escapeHtml(name)}</strong>
                    <button onclick="recallFriendRequest('${name}')">Recall</button>
                </div>
            `).join("")}
        `;
    }

    if (friendsBox) {
        const friends = latestSocialData.friends || [];

        friendsBox.innerHTML = friends.length ? friends.map(friend => `
            <div class="friend-row">
                <strong>${friend.online ? "🟢" : "⚪"} ${escapeHtml(friend.username)}</strong>
                <span>
                    <button onclick="openDmWith('${friend.username}')">DM</button>
                    <button onclick="openProfile('${friend.username}')">Profile</button>
                    <button onclick="removeFriend('${friend.username}')">Remove</button>
                </span>
            </div>
        `).join("") : `<div class="empty-state">No friends yet.</div>`;
    }
}

function sendFriendRequest(username) {
    socket.emit("send friend request", { targetUsername: username });
    setTimeout(() => socket.emit("request social data"), 300);
}

function acceptFriendRequest(username) {
    socket.emit("accept friend request", { username });
    setTimeout(() => socket.emit("request social data"), 300);
}

function declineFriendRequest(username) {
    socket.emit("decline friend request", { username });
    setTimeout(() => socket.emit("request social data"), 300);
}

function recallFriendRequest(username) {
    socket.emit("recall friend request", { username });
    setTimeout(() => socket.emit("request social data"), 300);
}

function removeFriend(username) {
    if (!confirm(`Remove ${username} from friends?`)) return;
    socket.emit("remove friend", { username });
    setTimeout(() => socket.emit("request social data"), 300);
}

function openDmWith(username) {
    currentDmUser = username;
    socket.emit("open dm", { username });
    switchRoom("cheddar");
    switchCheddarTab("dms");
}

socket.on("dm thread", thread => {
    currentDmUser = thread.withUser;
    currentDmThreadId = thread.threadId;

    const panel = document.getElementById("dmThreadPanel");
    const title = document.getElementById("dmThreadTitle");

    if (panel) panel.classList.remove("hidden");
    if (title) title.textContent = `💬 ${thread.withUser}`;

    renderDmMessages(thread.messages || []);
    socket.emit("request social data");
});

socket.on("dm message", data => {
    if (data.withUser === currentDmUser) {
        const box = document.getElementById("dmMessages");
        if (box) {
            box.insertAdjacentHTML("beforeend", renderDmMessage(data.message));
            box.scrollTop = box.scrollHeight;
        }
    } else {
        showChatNotice(`💬 New DM from ${data.withUser}`);
    }

    socket.emit("request social data");
});

function renderDmMessages(messages) {
    const box = document.getElementById("dmMessages");
    if (!box) return;

    box.innerHTML = messages.map(renderDmMessage).join("");
    box.scrollTop = box.scrollHeight;
}

function renderDmMessage(message) {
    const mine = currentUser && message.from && message.from.toLowerCase() === currentUser.toLowerCase();

    return `
        <div class="dm-message ${mine ? "mine" : "theirs"} ${message.mutedNotice ? "muted-notice" : ""}">
            <strong>${escapeHtml(message.from)}</strong>
            <p>${escapeHtml(message.text)}</p>
            <small>${new Date(message.createdAt).toLocaleTimeString()}</small>
        </div>
    `;
}

function sendCurrentDm() {
    const input = document.getElementById("dmMessageInput");
    if (!input || !currentDmUser) return;

    const text = input.value.trim();
    if (!text) return;

    socket.emit("send dm", {
        to: currentDmUser,
        text
    });

    input.value = "";
}

function sendMutedDmNotice() {
    if (!currentDmUser) return;
    socket.emit("send muted dm notice", { to: currentDmUser });
}

function closeDmThread() {
    currentDmUser = null;
    currentDmThreadId = null;

    const panel = document.getElementById("dmThreadPanel");
    if (panel) panel.classList.add("hidden");
}

socket.on("admin dm history", thread => {
    const lines = (thread.messages || []).map(message => {
        return `[${new Date(message.createdAt).toLocaleString()}] ${message.from}: ${message.text}`;
    }).join("\n");

    const output = `DM History: ${thread.playerOne} ↔ ${thread.playerTwo}\n\n${lines || "No messages."}`;

    const existing = document.getElementById("adminDmHistoryModal");
    if (existing) existing.remove();

    const modal = document.createElement("section");
    modal.id = "adminDmHistoryModal";
    modal.className = "modal admin-dm-history-modal";
    modal.innerHTML = `
        <div class="modal-card">
            <button class="modal-close" onclick="document.getElementById('adminDmHistoryModal')?.remove()">×</button>
            <h2>💬 DM History: ${escapeHtml(thread.playerOne)} ↔ ${escapeHtml(thread.playerTwo)}</h2>
            <pre class="admin-dm-history-output"></pre>
        </div>
    `;

    document.body.appendChild(modal);
    modal.querySelector("pre").textContent = output;
});


if (localStorage.getItem("cheeseConsoleMode") === "1" || /Xbox|PlayStation|TV|Steam Deck/i.test(navigator.userAgent)) {
    document.body.classList.add("console-mode");
}



function renderProfileSocialActions(username) {
    if (!username || username.toLowerCase() === currentUser.toLowerCase()) return "";

    const social = latestSocialData || {};
    const friends = social.friends || [];
    const incoming = social.incoming || [];
    const outgoing = social.outgoing || [];
    const lower = username.toLowerCase();

    if (friends.some(friend => friend.username && friend.username.toLowerCase() === lower || String(friend).toLowerCase() === lower)) {
        return `<button onclick="openDmWith('${username}')">DM 💬</button><button onclick="removeFriend('${username}')">Remove Friend</button>`;
    }

    if (incoming.some(name => String(name).toLowerCase() === lower)) {
        return `<button onclick="acceptFriendRequest('${username}')">Accept Friend Request</button><button onclick="declineFriendRequest('${username}')">Decline</button>`;
    }

    if (outgoing.some(name => String(name).toLowerCase() === lower)) {
        return `<button onclick="recallFriendRequest('${username}')">Recall Request</button>`;
    }

    return `<button onclick="sendFriendRequest('${username}')">Add Friend</button>`;
}


/* =========================================================
   JUST ANOTHER LIFE OF CHEESE — ADMIN PANEL DRAG/COLLAPSE
========================================================= */




(function setupSilentConsoleSupport() {
    const isConsoleish = /Xbox|PlayStation|TV|Steam Deck/i.test(navigator.userAgent);

    if (isConsoleish) {
        document.body.classList.add("console-friendly");
    }
})();


(function setupAdminPanelLifeOfCheese() {
    const panel = document.getElementById("adminPanel");
    if (!panel) return;

    const savedCollapsed = localStorage.getItem("cheeseAdminCollapsed");
    if (savedCollapsed === "1") {
        panel.classList.add("collapsed");
    }

    const savedPosition = localStorage.getItem("cheeseAdminPosition");
    if (savedPosition) {
        try {
            const pos = JSON.parse(savedPosition);
            if (Number.isFinite(pos.left) && Number.isFinite(pos.top) && window.innerWidth > 900) {
                panel.style.left = `${Math.max(0, Math.min(window.innerWidth - 80, pos.left))}px`;
                panel.style.top = `${Math.max(0, Math.min(window.innerHeight - 60, pos.top))}px`;
                panel.style.right = "auto";
                panel.style.bottom = "auto";
            }
        } catch {}
    }

    const header = panel.querySelector(".admin-panel-header") || panel.querySelector("h2") || panel.firstElementChild;
    if (!header) return;
    header.classList.add("admin-drag-handle");

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    header.addEventListener("pointerdown", event => {
        if (window.innerWidth <= 900) return;
        if (event.target.closest("button, input, select, textarea")) return;

        dragging = true;
        startX = event.clientX;
        startY = event.clientY;

        const rect = panel.getBoundingClientRect();
        startLeft = rect.left;
        startTop = rect.top;

        if (header.setPointerCapture) {
            header.setPointerCapture(event.pointerId);
        }
    });

    header.addEventListener("pointermove", event => {
        if (!dragging) return;

        const left = Math.max(0, Math.min(window.innerWidth - 80, startLeft + event.clientX - startX));
        const top = Math.max(0, Math.min(window.innerHeight - 60, startTop + event.clientY - startY));

        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
        panel.style.right = "auto";
        panel.style.bottom = "auto";
    });

    header.addEventListener("pointerup", () => {
        if (!dragging) return;
        dragging = false;

        const rect = panel.getBoundingClientRect();
        localStorage.setItem("cheeseAdminPosition", JSON.stringify({
            left: rect.left,
            top: rect.top
        }));
    });
})();


(function setupViewDmQuickCommand() {
    const bind = () => {
        const select = document.getElementById("adminCommandSelect");
        const input = document.getElementById("adminCommandInput");
        const playerSelect = document.getElementById("adminPlayerSelect");

        if (!select || !input) return;

        if (select.dataset.viewdmBound === "1") return;
        select.dataset.viewdmBound = "1";

        select.addEventListener("change", () => {
            if (select.value !== "viewdm") return;
            const player = playerSelect && playerSelect.value ? playerSelect.value : "<PlayerOne>";
            input.value = `;/ViewDM: ${player}, <OtherPlayer>`;
        });
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", bind);
    } else {
        bind();
    }

    setTimeout(bind, 700);
})();



/* =========================================================
   CHEESE & CHAOS V1 — ARCADE CHALLENGES + TTCB
========================================================= */

const ARCADE_CHALLENGE_KEY = "cheeseArcadeChallengesV1";
const TTCB_BUDGET = 600;

const TTCB_UNITS = [
    { id: "cheeseSoldier", icon: "🧀⚔️", name: "Cheese Soldier", className: "Basic", hp: 100, speed: 1, damage: 10, attackSpeed: 1, knockback: 1, cost: 100 },
    { id: "mouse", icon: "🐭", name: "Mouse", className: "Swarm", hp: 50, speed: 2.5, damage: 5, attackSpeed: 2, knockback: 0.5, cost: 50 },
    { id: "ratDefender", icon: "🐁🛡️", name: "Rat Defender", className: "Mini Tank", hp: 200, speed: 0.75, damage: 35, attackSpeed: 1, knockback: 3, cost: 250 },
    { id: "butterBomber", icon: "🧈💣", name: "Butter Bomber", className: "Explosive", hp: 50, speed: 1.5, damage: 50, attackSpeed: 0, knockback: 0.9, cost: 175, special: "Explodes on death or near enemies" },
    { id: "cheddarChucker", icon: "🧀🤾‍♀️", name: "Cheddar Chucker", className: "Ranged", hp: 75, speed: 1.1, damage: 15, attackSpeed: 1.5, knockback: 1, cost: 125 }
];

let ttcbArmy = {};
let ttcbLastEnemy = {};

function getArcadeDateKey() {
    return new Date().toISOString().slice(0, 10);
}

function seededDailyChallenges() {
    const today = getArcadeDateKey();
    const dayNumber = Number(today.replace(/-/g, "")) || Date.now();
    const pool = [
        { id: `${today}:clicks100`, type: "clickerClicks", title: "Click 100 cheese", goal: 100, icon: "🧀", reward: "Coins / cosmetic / crate chance" },
        { id: `${today}:upgrades1`, type: "clickerUpgrades", title: "Buy 1 Cheese Clicker upgrade", goal: 1, icon: "⬆️", reward: "Coins / cosmetic / crate chance" },
        { id: `${today}:ttcb1`, type: "ttcbBattles", title: "Play 1 TTCB sandbox battle", goal: 1, icon: "⚔️", reward: "Coins / cosmetic / crate chance" },
        { id: `${today}:clicks250`, type: "clickerClicks", title: "Click 250 cheese", goal: 250, icon: "🧀", reward: "Coins / cosmetic / crate chance" },
        { id: `${today}:ttcb3units`, type: "ttcbUnitsPlaced", title: "Place 3 TTCB units", goal: 3, icon: "📍", reward: "Coins / cosmetic / crate chance" }
    ];

    return [
        pool[dayNumber % pool.length],
        pool[(dayNumber + 2) % pool.length],
        pool[(dayNumber + 4) % pool.length]
    ].filter((item, index, arr) => arr.findIndex(other => other.id === item.id) === index).slice(0, 3);
}

function loadArcadeChallengeState() {
    try {
        const state = JSON.parse(localStorage.getItem(ARCADE_CHALLENGE_KEY)) || {};
        const today = getArcadeDateKey();

        if (state.date !== today) {
            return { date: today, progress: {}, claimed: {}, bonusClaimed: false };
        }

        return Object.assign({ date: today, progress: {}, claimed: {}, bonusClaimed: false }, state);
    } catch {
        return { date: getArcadeDateKey(), progress: {}, claimed: {}, bonusClaimed: false };
    }
}

function saveArcadeChallengeState(state) {
    localStorage.setItem(ARCADE_CHALLENGE_KEY, JSON.stringify(state));
}

function recordArcadeChallengeProgress(type, amount = 1) {
    const state = loadArcadeChallengeState();
    let changed = false;

    seededDailyChallenges().forEach(challenge => {
        if (challenge.type !== type || state.claimed[challenge.id]) return;
        state.progress[challenge.id] = Math.min(challenge.goal, (state.progress[challenge.id] || 0) + amount);
        changed = true;
    });

    if (changed) {
        saveArcadeChallengeState(state);
        renderDailyArcadeChallenges();
    }
}

function renderDailyArcadeChallenges() {
    const box = document.getElementById("dailyArcadeChallenges");
    const timer = document.getElementById("dailyChallengeTimer");
    const bonus = document.getElementById("dailyArcadeBonusBtn");

    if (!box) return;

    const state = loadArcadeChallengeState();
    const challenges = seededDailyChallenges();
    const completed = challenges.filter(challenge => (state.progress[challenge.id] || 0) >= challenge.goal);
    const claimed = challenges.filter(challenge => state.claimed[challenge.id]);

    box.innerHTML = challenges.map(challenge => {
        const progress = Math.min(challenge.goal, state.progress[challenge.id] || 0);
        const done = progress >= challenge.goal;
        const isClaimed = !!state.claimed[challenge.id];

        return `
            <div class="daily-challenge-card ${done ? "complete" : ""} ${isClaimed ? "claimed" : ""}">
                <div class="daily-challenge-icon">${challenge.icon}</div>
                <div>
                    <strong>${escapeHtml(challenge.title)}</strong>
                    <span>${progress}/${challenge.goal} • ${challenge.reward}</span>
                    <div class="daily-progress"><i style="width:${Math.round((progress / challenge.goal) * 100)}%"></i></div>
                </div>
                <button ${!done || isClaimed ? "disabled" : ""} onclick="claimArcadeChallenge('${challenge.id}')">
                    ${isClaimed ? "Claimed" : done ? "Claim" : "Locked"}
                </button>
            </div>
        `;
    }).join("");

    if (bonus) {
        bonus.disabled = claimed.length < 3 || state.bonusClaimed;
        bonus.textContent = state.bonusClaimed ? "3/3 Bonus Claimed ✅" : `Claim 3/3 Bonus 📦 (${claimed.length}/3)`;
    }

    if (timer) {
        timer.textContent = "3 daily challenges";
    }
}

function claimArcadeChallenge(challengeId) {
    const state = loadArcadeChallengeState();
    const challenge = seededDailyChallenges().find(item => item.id === challengeId);

    if (!challenge) return;

    if ((state.progress[challengeId] || 0) < challenge.goal) {
        showChatNotice("Challenge not complete yet.");
        return;
    }

    if (state.claimed[challengeId]) {
        showChatNotice("Already claimed.");
        return;
    }

    socket.emit("claim arcade challenge reward", { challengeId });
}

function markArcadeChallengeClaimed(challengeId) {
    const state = loadArcadeChallengeState();
    state.claimed[challengeId] = true;
    saveArcadeChallengeState(state);
    renderDailyArcadeChallenges();
}

function claimDailyArcadeBonus() {
    const state = loadArcadeChallengeState();
    const challenges = seededDailyChallenges();

    if (challenges.some(challenge => !state.claimed[challenge.id])) {
        showChatNotice("Claim all 3 daily challenges first.");
        return;
    }

    if (state.bonusClaimed) {
        showChatNotice("Daily bonus already claimed.");
        return;
    }

    socket.emit("claim daily arcade bonus");
}

function markArcadeBonusClaimed() {
    const state = loadArcadeChallengeState();
    state.bonusClaimed = true;
    saveArcadeChallengeState(state);
    renderDailyArcadeChallenges();
}

function renderArcadeChallengeReward(reward, title = "Arcade Reward") {
    isOpeningCrate = false;
    const message = reward && reward.message ? reward.message : "Arcade reward claimed.";
    showCrateOpeningAnimation(title, message, "arcade");
    setTimeout(() => {
        if (crateOverlayCard) {
            crateOverlayCard.innerHTML = `
                <div class="crate-result arcade-reward-result">
                    <div class="crate-result-icon">${reward.icon || "🎮"}</div>
                    <h2>${escapeHtml(reward.name || "Arcade Reward")}</h2>
                    <p>${escapeHtml(message)}</p>
                    ${reward.rarity ? `<span class="${rarityClass(reward.rarity)}">${rarityEmoji(reward.rarity)} ${rarityLabel(reward.rarity)}</span>` : ""}
                    <button onclick="closeCrateOverlay()">Nice 🧀</button>
                </div>
            `;
        }
    }, 450);
}

function renderArcadeCrateReward(data) {
    const reward = data && data.reward ? data.reward : {};
    renderArcadeChallengeReward(reward, data && data.crate ? data.crate.name : "Arcade Crate");
}


function openArcadeCrateWithToken() {
    if (isOpeningCrate) return;

    if (!latestPlayerData || (latestPlayerData.cheeseTokens || 0) < 1) {
        showShopReply("You need 1 Cheese Token.");
        return;
    }

    isOpeningCrate = true;
    showCrateOpeningAnimation("Token Arcade Crate", "Spending 1 Cheese Token...", "arcade");
    socket.emit("open arcade crate with token");
}

function openBlueStiltonCrateWithToken() {
    if (isOpeningCrate) return;

    if (!latestPlayerData || (latestPlayerData.cheeseTokens || 0) < 1) {
        showShopReply("You need 1 Cheese Token.");
        return;
    }

    isOpeningCrate = true;
    showCrateOpeningAnimation("Token Blue Stilton Crate", "Spending 1 Cheese Token...", "cosmetic");
    socket.emit("open blue stilton crate with token");
}

function buyArcadeCrate() {
    if (isOpeningCrate) return;
    isOpeningCrate = true;
    showCrateOpeningAnimation("Arcade Crate", "Rolling chaos, cosmetics, and a tiny token chance...", "arcade");
    socket.emit("buy arcade crate");
}

function openBlueStiltonCrate() {
    if (isOpeningCrate) return;
    isOpeningCrate = true;
    showCrateOpeningAnimation("Blue Stilton Crate", "Rolling epic-heavy cosmetics...", "cosmetic");
    socket.emit("open blue stilton crate");
}

function openTTCB() {
    const game = document.getElementById("ttcbGame");
    if (!game) return;
    game.classList.remove("hidden");
    renderTTCB();
}

function closeTTCB() {
    const game = document.getElementById("ttcbGame");
    if (game) game.classList.add("hidden");
}

function getTTCBSpent() {
    return Object.entries(ttcbArmy).reduce((sum, [id, count]) => {
        const unit = TTCB_UNITS.find(item => item.id === id);
        return sum + (unit ? unit.cost * count : 0);
    }, 0);
}

function addTTCBUnit(id) {
    const unit = TTCB_UNITS.find(item => item.id === id);
    if (!unit) return;

    if (getTTCBSpent() + unit.cost > TTCB_BUDGET) {
        showChatNotice("Not enough sandbox budget.");
        return;
    }

    ttcbArmy[id] = (ttcbArmy[id] || 0) + 1;
    recordArcadeChallengeProgress("ttcbUnitsPlaced", 1);
    renderTTCB();
}

function removeTTCBUnit(id) {
    if (!ttcbArmy[id]) return;
    ttcbArmy[id] -= 1;
    if (ttcbArmy[id] <= 0) delete ttcbArmy[id];
    renderTTCB();
}

function clearTTCBArmy() {
    ttcbArmy = {};
    renderTTCB();
}

function unitPower(unit) {
    const attack = unit.attackSpeed ? unit.damage * unit.attackSpeed : unit.damage * 1.35;
    const stability = unit.hp * 0.18 + unit.knockback * 18;
    const speed = unit.speed * 12;
    return attack + stability + speed + unit.cost * 0.08;
}

function buildRandomEnemyArmy() {
    const army = {};
    let budget = TTCB_BUDGET;
    let guard = 0;

    while (budget >= 50 && guard < 30) {
        const affordable = TTCB_UNITS.filter(unit => unit.cost <= budget);
        const unit = affordable[Math.floor(Math.random() * affordable.length)];
        army[unit.id] = (army[unit.id] || 0) + 1;
        budget -= unit.cost;
        guard++;
    }

    return army;
}

function armyScore(army) {
    return Object.entries(army).reduce((sum, [id, count]) => {
        const unit = TTCB_UNITS.find(item => item.id === id);
        return sum + (unit ? unitPower(unit) * count : 0);
    }, 0);
}

function renderTTCBUnits(containerId, army, enemy = false) {
    const box = document.getElementById(containerId);
    if (!box) return;

    const pieces = [];

    Object.entries(army).forEach(([id, count]) => {
        const unit = TTCB_UNITS.find(item => item.id === id);
        if (!unit) return;
        for (let i = 0; i < count; i++) {
            pieces.push(`<span class="ttcb-battle-unit ${enemy ? "enemy" : "player"}" title="${unit.name}">${unit.icon}</span>`);
        }
    });

    box.innerHTML = pieces.length ? pieces.join("") : `<em>No units placed</em>`;
}

function renderTTCB() {
    const shop = document.getElementById("ttcbUnitShop");
    const budget = document.getElementById("ttcbBudget");
    const remaining = TTCB_BUDGET - getTTCBSpent();

    if (budget) budget.textContent = remaining;

    if (shop) {
        shop.innerHTML = TTCB_UNITS.map(unit => {
            const owned = ttcbArmy[unit.id] || 0;
            return `
                <div class="ttcb-unit-card">
                    <div class="ttcb-unit-icon">${unit.icon}</div>
                    <div>
                        <strong>${unit.name}</strong>
                        <span>${unit.className} • ${unit.cost} 🪙</span>
                        <small>HP ${unit.hp} • SPD ${unit.speed} • DMG ${unit.damage} • KB ${unit.knockback}</small>
                    </div>
                    <div class="ttcb-unit-actions">
                        <button onclick="addTTCBUnit('${unit.id}')">+</button>
                        <b>${owned}</b>
                        <button onclick="removeTTCBUnit('${unit.id}')">−</button>
                    </div>
                </div>
            `;
        }).join("");
    }

    renderTTCBUnits("ttcbPlayerUnits", ttcbArmy);
    renderTTCBUnits("ttcbEnemyUnits", ttcbLastEnemy, true);
}

function startTTCBBattle() {
    if (Object.keys(ttcbArmy).length === 0) {
        showChatNotice("Place at least one unit first.");
        return;
    }

    ttcbLastEnemy = buildRandomEnemyArmy();
    renderTTCB();

    const intro = document.getElementById("ttcbIntroCard");
    const log = document.getElementById("ttcbBattleLog");
    const playerScore = armyScore(ttcbArmy) * (0.85 + Math.random() * 0.35);
    const enemyScore = armyScore(ttcbLastEnemy) * (0.85 + Math.random() * 0.35);
    const won = playerScore >= enemyScore;
    const subtitles = [
        "Probably balanced.",
        "Everything is fine until it isn't.",
        "The mice seem confident.",
        "Physics are optional.",
        "Cheddar trajectories calculated poorly."
    ];

    if (intro) {
        intro.classList.remove("hidden");
        intro.innerHTML = `<h2>⚔️ Blue Cheese Team VS Red Mould Team</h2><p>${subtitles[Math.floor(Math.random() * subtitles.length)]}</p>`;
        setTimeout(() => intro.classList.add("hidden"), 1400);
    }

    const battlefield = document.getElementById("ttcbBattlefield");
    if (battlefield) {
        battlefield.classList.remove("ttcb-shake", "ttcb-slowmo");
        void battlefield.offsetWidth;
        battlefield.classList.add("ttcb-shake");
        setTimeout(() => battlefield.classList.add("ttcb-slowmo"), 900);
    }

    const events = [
        "🧀 Cheese Soldiers marched normally. Suspicious.",
        "🐭 A Mouse achieved forbidden velocity.",
        "🧈 Butter Bomber made everyone reconsider strategy.",
        "🐁 Rat Defender refused to move.",
        "🤾‍♀️ Cheddar Chucker threw cheese with confidence."
    ];

    if (log) {
        setTimeout(() => {
            log.innerHTML = `
                <strong>${won ? "Victory!" : "Defeat!"}</strong>
                <p>${won ? "Sandbox win recorded. Rewards: 0 🧀" : "Sandbox loss recorded. Rewards: 0 🧀"}</p>
                <ul>${events.sort(() => Math.random() - 0.5).slice(0, 3).map(event => `<li>${event}</li>`).join("")}</ul>
                <small>Campaign and Daily Battle rewards are coming soon.</small>
            `;
        }, 1200);
    }

    recordArcadeChallengeProgress("ttcbBattles", 1);
    showChatNotice("TTCB sandbox battle complete. Sandbox gives 0 rewards.");
}
