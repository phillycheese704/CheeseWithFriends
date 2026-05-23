const cheddarBrowser = document.getElementById("cheddarBrowser");
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
let selectedChaosAbility = "";
let currentIndexTab = "events";
let latestPoll = null;
let latestPollVotes = {};
let isOpeningCrate = false;

const roomMessageCache = {
    cheeseLounge: [],
    butter: [],
    blueCheese: [],
    grilledCheese: [],
    cheddar: [],
    mozzarella: []
};

const authScreen = document.getElementById("authScreen");
const app = document.getElementById("app");

const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const authMessage = document.getElementById("authMessage");

const messages = document.getElementById("messages");
const messageInput = document.getElementById("messageInput");
const charCounter = document.getElementById("charCounter");
const typingIndicator = document.getElementById("typingIndicator");

const onlineUsers = document.getElementById("onlineUsers");
const onlineCount = document.getElementById("onlineCount");
const coinPill = document.getElementById("coinPill");

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
const shopCoins = document.getElementById("shopCoins");
const chaosCrateList = document.getElementById("chaosCrateList");
const swissCrateBox = document.getElementById("swissCrateBox");
const inventorySelected = document.getElementById("inventorySelected");
const runSelectedChaosBtn = document.getElementById("runSelectedChaosBtn");
const chaosCooldownText = document.getElementById("chaosCooldownText");
const inventoryList = document.getElementById("inventoryList");
const shopReply = document.getElementById("shopReply");

const crateOverlay = document.getElementById("crateOverlay");
const crateOverlayCard = document.getElementById("crateOverlayCard");

const miniProfileStats = document.getElementById("miniProfileStats");
const profileModal = document.getElementById("profileModal");
const profileContent = document.getElementById("profileContent");

const indexModal = document.getElementById("indexModal");
const bookCompletionText = document.getElementById("bookCompletionText");
const indexContent = document.getElementById("indexContent");

const adminCommandSelect = document.getElementById("adminCommandSelect");
const adminPlayerSelect = document.getElementById("adminPlayerSelect");
const adminAmountInput = document.getElementById("adminAmountInput");
const adminTextInput = document.getElementById("adminTextInput");
const adminEventsInput = document.getElementById("adminEventsInput");

/* =========================
   AUTH
========================= */

function setAuthMessage(text, type = "error") {
    authMessage.textContent = text;
    authMessage.className = type;
}

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

    typingIndicator.textContent = "";
    replyingTo = null;
    replyPreview.classList.add("hidden");

    clearMessages();

    const loading = document.createElement("div");
    loading.className = "empty-state";
    loading.textContent = "Loading room...";
    messages.appendChild(loading);

    socket.emit("switch room", roomId);
    socket.emit("request player data");
    renderSchedulePopup();
}

function updateRoomUI(roomId, roomInfo) {
    document
        .querySelectorAll(".room-button")
        .forEach(button => button.classList.remove("active"));

    const activeButton = document.getElementById(`room-${roomId}`);

    if (activeButton) {
        activeButton.classList.add("active");
    }

    const room = roomInfo || {};
    const isMozzarella = roomId === "mozzarella";

    document.body.dataset.theme = room.theme || "cheese";

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

    if (roomId === "mozzarella") {
        roomSubtitle.textContent = "No-chat crate shop • inventory • Cheese Index";
        messageInput.placeholder = "Mozzarella is no-chat.";
    }

    if (mozzarellaShop) {
        mozzarellaShop.classList.toggle("hidden", !isMozzarella);
    if (cheddarBrowser) {
        cheddarBrowser.classList.toggle("hidden", roomId !== "cheddar");
    }
    }

    if (messages) {
        messages.classList.toggle("hidden", isMozzarella);
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
        messageBar.classList.toggle("hidden", isMozzarella);
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

    if (room !== currentRoom) return;

    removeEmptyState();
    renderMessageNode(data);
    safeScrollToBottom();
}

function renderMessageNode(data) {
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
    text.textContent = data.text || "";

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
    }
}

function cancelReply() {
    replyingTo = null;
    replyPreview.classList.add("hidden");
}

/* =========================
   PLAYER DATA / SHOP / INVENTORY
========================= */

function updatePlayerData(data) {
    latestPlayerData = data;

    if (coinPill) {
        coinPill.textContent = `🧀 ${data.coins}`;
    }

    if (shopCoins) {
        shopCoins.textContent = `${data.coins} 🧀`;
    }

    if (miniProfileStats) {
        miniProfileStats.textContent =
            `${data.coins} coins • ${data.bookCompletion}% book`;
    }

    renderShop();
    renderInventory();
    renderIndexContent();
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
        </div>
    `;
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
                    : ""
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

function closeProfile() {
    profileModal.classList.add("hidden");
}

function renderProfile(data) {
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
}

/* =========================
   EXTRA UI
========================= */

function openArcade() {
    arcadePage.classList.remove("hidden");
    document.body.classList.add("arcade-open");
    updateCheeseClickerCard();
    renderCheeseClicker();
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

        row.textContent =
            `${cleanCommandName(event.commandText)} in ${secondsLeft}s by ${scheduledBy}`;

        schedulePopup.appendChild(row);
    });
}

function cleanCommandName(command) {
    return String(command || "")
        .replace("+/", "")
        .replace("\\", "")
        .replace(";/", "")
        .trim();
}

/* =========================
   ADMIN PANEL
========================= */

function openAdminPanel() {
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

    socket.emit("admin command", command);

    input.value = "";
}

function scheduleAdminEvent() {
    const commandText = document.getElementById("scheduleCommand").value;
    const delaySeconds = Number(document.getElementById("scheduleDelay").value);

    socket.emit("schedule event", {
        commandText,
        delaySeconds
    });
}

function buildAdminCommand() {
    const command = adminCommandSelect.value;
    const player = adminPlayerSelect.value;
    const amount = adminAmountInput.value.trim();
    const text = adminTextInput.value.trim();
    const events = adminEventsInput.value.trim();

    const commandInput = document.getElementById("adminCommandInput");

    if (!commandInput) return;

    if (command === "warning") {
        commandInput.value = `;/Warning: ${player}, ${text}`;
    }

    if (command === "ban") {
        commandInput.value = `;/Ban: ${player}, ${text}`;
    }

    if (command === "tempban") {
        commandInput.value = `;/TempBan: ${player}, ${amount || "10m"}, ${text}`;
    }

    if (command === "mute") {
        commandInput.value = `;/Mute: ${player}, ${amount || "10m"}, ${text}`;
    }

    if (command === "givecoins") {
        commandInput.value = `;/GiveCoins: ${player}, ${amount}`;
    }

    if (command === "setcoins") {
        commandInput.value = `;/SetCoins: ${player}, ${amount}`;
    }

    if (command === "clearchat") {
        commandInput.value = ";/ClearChat:";
    }

    if (command === "offline") {
        commandInput.value = ";/Offline";
    }

    if (command === "online") {
        commandInput.value = ";/Online";
    }

    if (command === "announcement") {
        commandInput.value = `;/Announcement: ${text}`;
    }

    if (command === "startpoll") {
        commandInput.value = `;/StartPoll: ${amount || "30"}, ${text || "Which chaos should happen?"}, ${events}`;
    }
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
    clearEffects();
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
    clearEffects();
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
    clearEffects();
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

function butterBomb() {
    clearEffects();
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
    clearEffects();
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
    clearEffects();
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
    clearEffects();
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
    clearEffects();
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
    clearEffects();
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
    clearEffects();
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
    clearEffects();
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
    clearEffects();
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
    clearEffects();
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
    clearEffects();
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

    if (cleanType === "clearvisuals") clearEffects();
    if (cleanType === "cheeserain") cheeseRain();
    if (cleanType === "cheesestorm") cheeseStorm();
    if (cleanType === "mouserun") mouseRun();
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
    currentRoom = data.room;
    currentRoomInfo = data.roomInfo;

    updateRoomUI(data.room, data.roomInfo);
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
                    : user.room === "mozzarella"
                        ? "Mozzarella"
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

socket.on("cosmetic choice", data => {
    renderCosmeticChoice(data.choices || []);
});

socket.on("player data", data => {
    updatePlayerData(data);
});

socket.on("profile data", data => {
    renderProfile(data);
});

socket.on("typing", data => {
    if (data.room !== currentRoom) return;

    typingIndicator.textContent = `${data.username} is typing...`;
});

socket.on("stop typing", data => {
    if (data.room !== currentRoom) return;

    typingIndicator.textContent = "";
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

socket.on("chaos event", data => {
    runChaosEvent(data.type);
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
    { id: "feta", name: "Feta", power: 75, cost: 4500, description: "Watery, crumbly, and great for salads" },
    { id: "mozzarella", name: "Mozzarella", power: 100, cost: 6000, description: "Mild, milky, and stretchy" },
    { id: "parmesan", name: "Parmesan", power: 125, cost: 7500, description: "Hard and salty" }
];

const cheeseClickerHelpers = [
    { id: "mouseHelper", name: "Mouse Helper", cps: 1, cost: 50, description: "A suspiciously helpful mouse" },
    { id: "ratHelper", name: "Rat Helper", cps: 5, cost: 180, description: "Bigger, faster, and slightly concerning" },
    { id: "hamsterHelper", name: "Hamster Helper", cps: 12, cost: 500, description: "Stores cheese in emergency cheeks" },
    { id: "cheeseChef", name: "Cheese Chef", cps: 35, cost: 1600, description: "Crafts premium cheese nonstop" },
    { id: "mozzarellaStretcher", name: "Mozzarella Stretcher", cps: 90, cost: 5000, description: "Stretches cheese around the clock" },
    { id: "cheeseGoblin", name: "Cheese Goblin", cps: 250, cost: 18000, description: "Lives entirely off stolen cheese" },
    { id: "cheeseDragon", name: "Cheese Dragon", cps: 1000, cost: 100000, description: "Sleeps on mountains of molten cheese" }
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
    renderCheeseClicker();
}

function buyHelperUpgrade(id) {
    const helper = cheeseClickerHelpers.find(item => item.id === id);
    const save = loadCheeseClickerSave();
    if (!helper || save.cheese < helper.cost) return;
    save.cheese -= helper.cost;
    save.helpers[id] = (save.helpers[id] || 0) + 1;
    saveCheeseClickerSave(save);
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
    const save = loadCheeseClickerSave();
    const gain = getPerSecond(save);
    if (gain <= 0) return;
    save.cheese += gain;
    if (save.cheese > save.highScore) save.highScore = save.cheese;
    saveCheeseClickerSave(save);
    renderCheeseClicker();
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
    const event = data.event || data;
    const id = String(event.id || event.command || event.name || "").toLowerCase().replace(/[^a-z]/g, "");
    const fn = upgradedChaosEffects[id];

    if (fn) {
        fn();
    } else {
        chaosBanner(`${event.icon || "🧀"} ${event.name || "CHAOS EVENT"}`, data.by ? `Activated by ${data.by}` : "");
        chaosBurst(["🧀", "✨"], 55, { duration: 2.5 });
    }
}


socket.on("chaos event", runUpgradedChaosEffect);


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


/* Cohesion update quick command builder override */
const originalBuildAdminCommand = typeof buildAdminCommand === "function" ? buildAdminCommand : null;
function buildAdminCommand() {
    const command = adminCommandSelect.value;
    const player = adminPlayerSelect.value || "<Player>";
    const amount = adminAmountInput.value.trim();
    const text = adminTextInput.value.trim();
    const events = adminEventsInput.value.trim();

    let output = "";

    if (originalBuildAdminCommand && !["givetokens","settokens","unmute","cheeserng","cheesebank"].includes(command)) {
        originalBuildAdminCommand();
        return;
    }

    if (command === "givetokens") output = `;/GiveTokens: ${player}, ${amount || "1"}`;
    if (command === "settokens") output = `;/SetTokens: ${player}, ${amount || "1"}`;
    if (command === "unmute") output = `;/Unmute: ${player}`;
    if (command === "cheeserng") output = "+/CheeseRNG\\";
    if (command === "cheesebank") output = "+/CheeseBank\\";

    if (output) adminCommandInput.value = output;
}



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
    const notice = document.createElement("button");
    notice.className = "cheese-bank-card";
    notice.innerHTML = `💰 A bank has been built in ${data.roomName}!<br><strong>ROB IT 🧀💰</strong>`;

    notice.onclick = () => {
        socket.emit("claim cheese bank", data);
        notice.remove();
    };

    document.body.appendChild(notice);

    setTimeout(() => {
        if (notice.parentElement) notice.remove();
    }, 45000);
});



socket.on("whisper", data => {
    showChatNotice(`🧀 Whisper from ${data.from}: ${data.text}`);
});

socket.on("system notice", text => {
    showChatNotice(text);
});

