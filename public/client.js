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

    clearMessages();

    const loading = document.createElement("div");
    loading.className = "empty-state";
    loading.textContent = "Loading room...";
    messages.appendChild(loading);

    typingIndicator.textContent = "";
    replyingTo = null;
    replyPreview.classList.add("hidden");

    socket.emit("switch room", roomId);
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
}

function clearMessages() {
    while (messages.firstChild) {
        messages.removeChild(messages.firstChild);
    }
}

function renderRoomMessages(list) {
    clearMessages();

    if (!list || list.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = "Nobody is talking yet. Suspiciously cheesy.";
        messages.appendChild(empty);
        return;
    }

    list.forEach(addMessage);
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

function addMessage(data) {
    removeEmptyState();

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
    scrollToBottom();
}

function updateReactions(messageId, reactions) {
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

function addSystemMessage(text) {
    removeEmptyState();

    const div = document.createElement("div");
    div.className = "system-message";
    div.textContent = text;

    messages.appendChild(div);
    scrollToBottom();
}

function showChatNotice(text) {
    removeEmptyState();

    const div = document.createElement("div");
    div.className = "system-message warning-message";
    div.textContent = text;

    messages.appendChild(div);
    scrollToBottom();

    setTimeout(() => {
        div.remove();
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

function cancelReply() {
    replyingTo = null;
    replyPreview.classList.add("hidden");
}

/* =========================
   ADMIN PANEL
========================= */

function openAdminPanel() {
    adminPanel.classList.remove("hidden");
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

    box.innerHTML = "";

    latestScheduledEvents.forEach(event => {
        const div = document.createElement("div");
        div.className = "scheduled-event";

        const secondsLeft = Math.max(
            0,
            Math.ceil((event.runAt - Date.now()) / 1000)
        );

        const label = document.createElement("span");
        label.textContent = `${event.commandText} in ${secondsLeft}s`;

        const cancel = document.createElement("button");
        cancel.textContent = "×";
        cancel.onclick = () => {
            socket.emit("cancel scheduled event", event.id);
        };

        div.appendChild(label);
        div.appendChild(cancel);
        box.appendChild(div);
    });
}

setInterval(() => {
    if (latestScheduledEvents.length > 0) {
        renderScheduledEvents(latestScheduledEvents);
    }
}, 1000);

let draggingAdmin = false;
let dragOffsetX = 0;
let dragOffsetY = 0;

adminHeader.addEventListener("mousedown", event => {
    draggingAdmin = true;

    const rect = adminPanel.getBoundingClientRect();

    dragOffsetX = event.clientX - rect.left;
    dragOffsetY = event.clientY - rect.top;
});

window.addEventListener("mousemove", event => {
    if (!draggingAdmin) return;

    adminPanel.style.left = `${event.clientX - dragOffsetX}px`;
    adminPanel.style.top = `${event.clientY - dragOffsetY}px`;
    adminPanel.style.right = "auto";
});

window.addEventListener("mouseup", () => {
    draggingAdmin = false;
});

/* =========================
   EFFECTS
========================= */

function clearEffects() {
    effectLayer.innerHTML = "";
    document.body.classList.remove(
        "melt-ui",
        "butter-flood",
        "cheese-storm",
        "singularity-active"
    );
}

function cheeseRain(count = 45) {
    for (let i = 0; i < count; i++) {
        const cheese = document.createElement("div");

        cheese.className = "falling-cheese";
        cheese.textContent = "🧀";
        cheese.style.left = `${Math.random() * 100}vw`;
        cheese.style.animationDuration = `${2 + Math.random() * 3}s`;
        cheese.style.fontSize = `${24 + Math.random() * 26}px`;

        effectLayer.appendChild(cheese);

        setTimeout(() => cheese.remove(), 6000);
    }
}

function mouseRun() {
    for (let i = 0; i < 18; i++) {
        const mouse = document.createElement("div");

        mouse.className = "running-mouse";
        mouse.textContent = "🐭";
        mouse.style.top = `${20 + Math.random() * 70}vh`;
        mouse.style.animationDelay = `${Math.random() * 1.5}s`;

        effectLayer.appendChild(mouse);

        setTimeout(() => mouse.remove(), 5000);
    }
}

function butterBomb() {
    const bomb = document.createElement("div");
    bomb.className = "butter-bomb";
    bomb.textContent = "🧈";

    const splat = document.createElement("div");
    splat.className = "butter-splat";

    effectLayer.appendChild(bomb);

    setTimeout(() => {
        bomb.remove();
        effectLayer.appendChild(splat);

        setTimeout(() => splat.remove(), 5000);
    }, 900);
}

function singularicheese() {
    const hole = document.createElement("div");

    hole.className = "singularicheese";
    hole.textContent = "🧀";

    effectLayer.appendChild(hole);
    document.body.classList.add("singularity-active");

    setTimeout(() => {
        document.body.classList.remove("singularity-active");
        hole.remove();
    }, 3500);
}

function runChaosEvent(type) {
    if (type === "clearVisuals") {
        clearEffects();
    }

    if (type === "cheeseRain") {
        cheeseRain();
    }

    if (type === "cheeseStorm") {
        document.body.classList.add("cheese-storm");
        cheeseRain(120);

        setTimeout(() => {
            document.body.classList.remove("cheese-storm");
        }, 5500);
    }

    if (type === "mouseRun") {
        mouseRun();
    }

    if (type === "butterBomb") {
        butterBomb();
    }

    if (type === "singularicheese") {
        singularicheese();
    }

    if (type === "meltUI") {
        document.body.classList.add("melt-ui");

        setTimeout(() => {
            document.body.classList.remove("melt-ui");
        }, 5500);
    }

    if (type === "butterFlood") {
        document.body.classList.add("butter-flood");

        setTimeout(() => {
            document.body.classList.remove("butter-flood");
        }, 5500);
    }
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
    if (data.room !== currentRoom) return;

    addMessage(data);
});

socket.on("reaction update", data => {
    if (data.room !== currentRoom) return;

    updateReactions(data.messageId, data.reactions);
});

socket.on("system message", data => {
    if (data.room !== currentRoom) return;

    addSystemMessage(data.text);
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