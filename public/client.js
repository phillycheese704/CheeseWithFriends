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

const roomMessageCache = {
    cheeseLounge: [],
    butter: [],
    blueCheese: [],
    updateLog: []
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

    if (roomId === "updateLog") {
        roomSubtitle.textContent = "Read-only patch notes";
        messageInput.placeholder = "This room is read-only.";
    }

    const isReadOnly = room.readOnly === true;

    messageInput.disabled = isReadOnly;

    const sendButton = document.querySelector(".message-bar button");

    if (sendButton) {
        sendButton.disabled = isReadOnly;
    }

    renderSchedulePopup();
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
    if (room === "updateLog") return "Patch notes live here.";
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

function openArcade() {
    chatPage.classList.add("hidden");
    arcadePage.classList.remove("hidden");
}

function closeArcade() {
    arcadePage.classList.add("hidden");
    chatPage.classList.remove("hidden");
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

function renderSchedulePopup() {
    if (!schedulePopup) return;

    if (currentRoom !== "cheeseLounge" || latestScheduledEvents.length === 0) {
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

        row.textContent = `${cleanCommandName(event.commandText)} in ${secondsLeft}s`;
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
        label.textContent = `${cleanCommandName(event.commandText)} in ${secondsLeft}s`;

        const cancel = document.createElement("button");
        cancel.textContent = "×";
        cancel.onclick = () => {
            socket.emit("cancel scheduled event", event.id);
        };

        div.appendChild(label);
        div.appendChild(cancel);
        box.appendChild(div);
    });

    renderSchedulePopup();
}

setInterval(() => {
    if (latestScheduledEvents.length > 0) {
        renderScheduledEvents(latestScheduledEvents);
    } else {
        renderSchedulePopup();
    }
}, 1000);

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

        setTimeout(() => cheese.remove(), 6500);
    }

    setTimeout(() => hardResetVisuals(), 6500);
}

function cheeseStorm() {
    clearEffects();
    makeImpactText("CHEESE STORM");

    const clouds = document.createElement("div");
    clouds.className = "storm-clouds";
    effectLayer.appendChild(clouds);

    for (let i = 0; i < 160; i++) {
        const cheese = document.createElement("div");

        cheese.className = "falling-cheese storm-fall";
        cheese.textContent = "🧀";
        cheese.style.left = `${Math.random() * 100}vw`;
        cheese.style.animationDuration = `${1.4 + Math.random() * 2.4}s`;
        cheese.style.fontSize = `${22 + Math.random() * 36}px`;
        cheese.style.animationDelay = `${Math.random() * 1.2}s`;
        cheese.style.setProperty("--sway", `${-140 + Math.random() * 280}px`);

        effectLayer.appendChild(cheese);

        setTimeout(() => cheese.remove(), 6500);
    }

    for (let i = 0; i < 5; i++) {
        const lightning = document.createElement("div");
        lightning.className = "cheese-lightning";
        lightning.style.left = `${10 + Math.random() * 80}vw`;
        lightning.style.animationDelay = `${Math.random() * 3.8}s`;
        effectLayer.appendChild(lightning);
    }

    setTimeout(() => {
        hardResetVisuals();
        effectLayer.innerHTML = "";
    }, 6500);
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

        setTimeout(() => mouse.remove(), 6200);
    }

    setTimeout(() => hardResetVisuals(), 6200);
}

function butterBomb() {
    clearEffects();
    makeImpactText("BUTTER BOMB");

    const x = 12 + Math.random() * 74;

    const pulse = document.createElement("div");
    pulse.className = "butter-screen-pulse";
    effectLayer.appendChild(pulse);

    const shadow = document.createElement("div");
    shadow.className = "butter-shadow";
    shadow.style.left = `${x}vw`;

    const bomb = document.createElement("div");
    bomb.className = "butter-bomb";
    bomb.textContent = "🧈";
    bomb.style.left = `${x}vw`;

    effectLayer.appendChild(shadow);
    effectLayer.appendChild(bomb);

    setTimeout(() => {
        bomb.remove();

        const splat = document.createElement("div");
        splat.className = "butter-splat";
        splat.style.left = `${x - 6}vw`;
        effectLayer.appendChild(splat);

        for (let i = 0; i < 18; i++) {
            const drop = document.createElement("div");
            drop.className = "butter-drop";
            drop.style.left = `${x}vw`;
            drop.style.top = "56vh";
            drop.style.setProperty("--drop-x", `${-160 + Math.random() * 320}px`);
            drop.style.setProperty("--drop-y", `${-100 + Math.random() * 190}px`);
            effectLayer.appendChild(drop);

            setTimeout(() => drop.remove(), 2200);
        }
    }, 930);

    setTimeout(() => {
        hardResetVisuals();
        effectLayer.innerHTML = "";
    }, 5600);
}

function butterFlood() {
    clearEffects();
    makeImpactText("BUTTER FLOOD");

    const wave = document.createElement("div");
    wave.className = "butter-wave";
    effectLayer.appendChild(wave);

    for (let i = 0; i < 28; i++) {
        const bubble = document.createElement("div");
        bubble.className = "butter-bubble";
        bubble.textContent = Math.random() > 0.5 ? "🧈" : "○";
        bubble.style.left = `${Math.random() * 100}vw`;
        bubble.style.animationDelay = `${Math.random() * 3}s`;
        bubble.style.fontSize = `${18 + Math.random() * 28}px`;

        effectLayer.appendChild(bubble);

        setTimeout(() => bubble.remove(), 6500);
    }

    setTimeout(() => {
        hardResetVisuals();
        effectLayer.innerHTML = "";
    }, 6500);
}

function meltUI() {
    clearEffects();
    makeImpactText("MELT UI");

    for (let i = 0; i < 42; i++) {
        const drip = document.createElement("div");
        drip.className = "melt-drip";
        drip.style.left = `${Math.random() * 100}vw`;
        drip.style.top = `${Math.random() * 50}vh`;
        drip.style.height = `${42 + Math.random() * 120}px`;
        drip.style.animationDelay = `${Math.random() * 2.2}s`;

        effectLayer.appendChild(drip);

        setTimeout(() => drip.remove(), 6500);
    }

    const heat = document.createElement("div");
    heat.className = "heat-warp";
    effectLayer.appendChild(heat);

    setTimeout(() => {
        hardResetVisuals();
        effectLayer.innerHTML = "";
    }, 6500);
}

function cheeseQuake() {
    clearEffects();
    makeImpactText("CHEESEQUAKE");

    const quakeOverlay = document.createElement("div");
    quakeOverlay.className = "quake-overlay";
    effectLayer.appendChild(quakeOverlay);

    for (let i = 0; i < 14; i++) {
        const crack = document.createElement("div");
        crack.className = "quake-crack";
        crack.style.left = `${Math.random() * 100}vw`;
        crack.style.top = `${Math.random() * 100}vh`;
        crack.style.height = `${80 + Math.random() * 220}px`;
        crack.style.transform = `rotate(${-35 + Math.random() * 70}deg)`;
        crack.style.animationDelay = `${Math.random() * 1.2}s`;
        effectLayer.appendChild(crack);
    }

    for (let i = 0; i < 80; i++) {
        const crumb = document.createElement("div");
        crumb.className = "quake-crumb";
        crumb.textContent = Math.random() > 0.35 ? "🧀" : "•";
        crumb.style.left = `${Math.random() * 100}vw`;
        crumb.style.top = `${Math.random() * 100}vh`;
        crumb.style.animationDelay = `${Math.random() * 2}s`;
        crumb.style.fontSize = `${10 + Math.random() * 24}px`;
        effectLayer.appendChild(crumb);
    }

    setTimeout(() => {
        hardResetVisuals();
        effectLayer.innerHTML = "";
    }, 5200);
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

    for (let i = 0; i < 70; i++) {
        const bit = document.createElement("div");
        bit.className = "portal-cheese-bit";
        bit.textContent = Math.random() > 0.35 ? "🧀" : "✨";
        bit.style.setProperty("--angle", `${Math.random() * 360}deg`);
        bit.style.setProperty("--distance", `${120 + Math.random() * 520}px`);
        bit.style.animationDelay = `${Math.random() * 3.2}s`;
        bit.style.fontSize = `${18 + Math.random() * 28}px`;
        effectLayer.appendChild(bit);
    }

    const flash = document.createElement("div");
    flash.className = "portal-flash";
    effectLayer.appendChild(flash);

    setTimeout(() => {
        hardResetVisuals();
        effectLayer.innerHTML = "";
    }, 5600);
}

function mouldTakeover() {
    clearEffects();
    makeImpactText("MOULD TAKEOVER");

    const mould = document.createElement("div");
    mould.className = "mould-overlay";
    effectLayer.appendChild(mould);

    for (let i = 0; i < 34; i++) {
        const patch = document.createElement("div");
        patch.className = "mould-patch";
        patch.style.left = `${Math.random() * 100}vw`;
        patch.style.top = `${Math.random() * 100}vh`;
        patch.style.width = `${50 + Math.random() * 190}px`;
        patch.style.height = `${50 + Math.random() * 190}px`;
        patch.style.animationDelay = `${Math.random() * 2.4}s`;
        effectLayer.appendChild(patch);
    }

    for (let i = 0; i < 90; i++) {
        const spore = document.createElement("div");
        spore.className = "mould-spore";
        spore.textContent = Math.random() > 0.5 ? "•" : "✦";
        spore.style.left = `${Math.random() * 100}vw`;
        spore.style.top = `${Math.random() * 100}vh`;
        spore.style.animationDelay = `${Math.random() * 2.8}s`;
        effectLayer.appendChild(spore);
    }

    setTimeout(() => {
        hardResetVisuals();
        effectLayer.innerHTML = "";
    }, 6500);
}

function singularicheese() {
    clearEffects();

    const targets = [
        ...document.querySelectorAll(
            ".message, .system-message, .room-button, .online-user, .chat-header h2, .chat-header p, .sidebar-title, .server-card, .schedule-popup, .message-bar, .chat-header-pill"
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
        clone.classList.add("singularity-clone");

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

    for (let i = 0; i < 90; i++) {
        const particle = document.createElement("div");
        particle.className = "singularity-particle";
        particle.textContent = Math.random() > 0.42 ? "🧀" : "✨";

        const angle = Math.random() * Math.PI * 2;
        const distance = 180 + Math.random() * 620;

        particle.style.left = `${centerX + Math.cos(angle) * distance}px`;
        particle.style.top = `${centerY + Math.sin(angle) * distance}px`;
        particle.style.setProperty("--particle-x", `${Math.cos(angle) * -distance}px`);
        particle.style.setProperty("--particle-y", `${Math.sin(angle) * -distance}px`);
        particle.style.animationDelay = `${Math.random() * 0.85}s`;

        effectLayer.appendChild(particle);
    }

    setTimeout(() => {
        document.body.classList.add("singularity-spit");
    }, 2200);

    setTimeout(() => {
        targets.forEach(element => {
            element.classList.remove("singularity-hidden-original");
        });

        hardResetVisuals();
        effectLayer.innerHTML = "";
        document.body.classList.remove("singularity-background", "singularity-spit");
    }, 4700);
}

function runChaosEvent(type) {
    if (type === "clearVisuals") {
        clearEffects();
        return;
    }

    if (type === "cheeseRain") cheeseRain();
    if (type === "cheeseStorm") cheeseStorm();
    if (type === "mouseRun") mouseRun();
    if (type === "butterBomb") butterBomb();
    if (type === "singularicheese") singularicheese();
    if (type === "meltUI") meltUI();
    if (type === "butterFlood") butterFlood();
    if (type === "cheeseQuake") cheeseQuake();
    if (type === "cheesePortal") cheesePortal();
    if (type === "mouldTakeover") mouldTakeover();
}

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

    users.forEach(user => {
        const div = document.createElement("div");
        div.className = "online-user";

        const dot = document.createElement("span");
        dot.className = "status-dot";

        const name = document.createElement("span");
        name.textContent = user.username || "Unknown";
        name.title = user.realName || user.username || "Unknown";

        const room = document.createElement("small");

        room.textContent =
            user.room === "blueCheese"
                ? "Blue Cheese"
                : user.room === "butter"
                    ? "Butter"
                    : user.room === "updateLog"
                        ? "Update Log"
                        : "Cheese Lounge";

        div.appendChild(dot);
        div.appendChild(name);
        div.appendChild(room);

        onlineUsers.appendChild(div);
    });
});

socket.on("message rejected", message => {
    showChatNotice(message);
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

socket.on("admin state", data => {
    renderScheduledEvents(data.scheduledEvents || []);
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