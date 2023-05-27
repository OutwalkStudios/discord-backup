import { SnowflakeUtil, IntentsBitField, GatewayIntentBits } from "discord.js";
import Bottleneck from "bottleneck";
import axios from "axios";
import createFunctions from "./functions/create";
import loadFunctions from "./functions/load";
import { clearGuild } from "./utils";
import path from "path";
import fs from "fs";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let backups = `${__dirname}/backups`;
if (!fs.existsSync(backups)) fs.mkdirSync(backups);

/* checks if a backup exists and returns its data */
async function getBackupData(backupId) {
    return new Promise((resolve, reject) => {
        const files = fs.readdirSync(backups);
        const file = files.filter((file) => file.split(".").pop() == "json").find((file) => file == `${backupId}.json`);

        if (file) {
            const backupData = JSON.parse(fs.readFileSync(`${backups}${path.sep}${file}`));
            resolve(backupData);
        } else {
            reject("No backup found");
        }
    });
}

/* fetches a backup and returns the information about it */
function fetch(backupId) {
    return new Promise(async (resolve, reject) => {
        try {
            const backupData = await getBackupData(backupId);
            const size = fs.statSync(`${backups}${path.sep}${backupId}.json`).size;

            const backupInfo = {
                data: backupData,
                id: backupId,
                size: Number((size / 1024).toFixed(2))
            };

            resolve(backupInfo);
        } catch (error) {
            reject("No backup found");
        }
    });
}

/* creates a new backup and saves it to the storage */
async function create(guild, options = {}) {
    const intents = new IntentsBitField(guild.client.options.intents);
    if (!intents.has(GatewayIntentBits.Guilds)) throw new Error("GUILDS intent is required");

    options = {
        backupId: null,
        maxMessagesPerChannel: 10,
        jsonSave: true,
        jsonBeautify: false,
        doNotBackup: [],
        backupMembers: false,
        saveImages: true,
        speed: 250,
        ...options
    };

    const backup = {
        name: guild.name,
        verificationLevel: guild.verificationLevel,
        explicitContentFilter: guild.explicitContentFilter,
        systemChannel: guild.systemChannel ? { name: guild.systemChannel.name, flags: guild.systemChannelFlags } : null,
        premiumProgressBarEnabled: guild.premiumProgressBarEnabled, 
        defaultMessageNotifications: guild.defaultMessageNotifications,
        afk: guild.afkChannel ? { name: guild.afkChannel.name, timeout: guild.afkTimeout } : null,
        widget: {
            enabled: guild.widgetEnabled,
            channel: guild.widgetChannel ? guild.widgetChannel.name : null
        },
        autoModerationRules: [],
        channels: { categories: [], others: [] },
        roles: [],
        bans: [],
        emojis: [],
        members: [],
        createdTimestamp: Date.now(),
        guildID: guild.id,
        id: options.backupId ?? SnowflakeUtil.generate(Date.now())
    };

    const autoModRules = await guild.autoModerationRules.fetch({ cache: false });
    autoModRules.each((autoModRule) => {
        let actions = [];
        autoModRule.actions.forEach((action) => {
            let copyAction = JSON.parse(JSON.stringify(action));
            if (copyAction.metadata.channelId) {
                const channel = guild.channels.cache.get(copyAction.metadata.channelId);
                if (channel) {
                    copyAction.metadata.channelName = channel.name;
                    actions.push(copyAction);
                }
            } else {
                actions.push(copyAction);
            }
        });

        backup.autoModerationRules.push({
            name: autoModRule.name,
            eventType: autoModRule.eventType,
            triggerType: autoModRule.triggerType,
            triggerMetadata: autoModRule.triggerMetadata,
            actions: actions,
            enabled: autoModRule.enabled,
            exemptRoles: autoModRule.exemptRoles.map((role) => {
                return { id: role.id, name: role.name };
            }),
            exemptChannels: autoModRule.exemptChannels.map((channel) => {
                return { id: channel.id, name: channel.name };
            }),
        });
    });

    if (guild.iconURL()) {
        if (options && options.saveImages && options.saveImages == "base64") {
            const response = await axios.get(guild.iconURL({ dynamic: true }), { responseType: "arraybuffer" });
            backup.iconBase64 = Buffer.from(response.data, "binary").toString("base64");
        }

        backup.iconURL = guild.iconURL({ dynamic: true });
    }

    if (guild.splashURL()) {
        if (options && options.saveImages && options.saveImages == "base64") {
            const response = await axios.get(guild.splashURL(), { responseType: "arraybuffer" });
            backup.splashBase64 = Buffer.from(response.data, "binary").toString("base64");
        }

        backup.splashURL = guild.splashURL();
    }

    if (guild.bannerURL()) {
        if (options && options.saveImages && options.saveImages == "base64") {
            const response = await axios.get(guild.bannerURL(), { responseType: "arraybuffer" });
            backup.bannerBase64 = Buffer.from(response.data, "binary").toString("base64");
        }

        backup.bannerURL = guild.bannerURL();
    }

    if (options && options.backupMembers) {
        backup.members = await createFunctions.getMembers(guild);
    }

    if (!options || !(options.doNotBackup || []).includes("bans")) {
        backup.bans = await createFunctions.getBans(guild);
    }

    if (!options || !(options.doNotBackup || []).includes("roles")) {
        backup.roles = await createFunctions.getRoles(guild);
    }

    if (!options || !(options.doNotBackup || []).includes("emojis")) {
        backup.emojis = await createFunctions.getEmojis(guild, options);
    }

    if (!options || !(options.doNotBackup || []).includes("channels")) {
        backup.channels = await createFunctions.getChannels(guild, options);
    }

    if (!options || options.jsonSave == undefined || options.jsonSave) {
        const reviver = (key, value) => typeof value == "bigint" ? value.toString() : value;
        const backupJSON = options.jsonBeautify ? JSON.stringify(backup, reviver, 4) : JSON.stringify(backup, reviver);
        fs.writeFileSync(`${backups}${path.sep}${backup.id}.json`, backupJSON, "utf-8");
    }

    return backup;
}

/* loads a backup for a guild */
async function load(backup, guild, options) {
    if (!guild) throw new Error("Invalid Guild!");

    options = { clearGuildBeforeRestore: true, maxMessagesPerChannel: 10, speed: 250, doNotLoad: [], ...options };

    const backupData = typeof backup == "string" ? await getBackupData(backup) : backup;

    if (typeof options.speed != "number") {
        throw new Error("Speed option must be a string or number");
    }

    const limiter = new Bottleneck({ minTime: options.speed, maxConcurrent: 1 });

    limiter.on("error", async (error) => {
        /* ignore errors where it request entity is too large */
        if(error.message == "Request entity too large") return;

        console.error(`ERROR: ${error.message}`);
    });

    limiter.on("failed", (error, jobInfo) => {
        /* ignore errors where it request entity is too large */
        if (error.message == "Request entity too large") return;
        
        console.error(`FAILED: ${error.message}\nTASK: ${JSON.stringify(jobInfo)}`);
    });

    // Main part of the backup restoration:
    if (!options || !(options.doNotLoad || []).includes("main")) {
        if (options.clearGuildBeforeRestore == undefined || options.clearGuildBeforeRestore) {
            console.log("Stage: Clear Guild");
            await clearGuild(guild, limiter);
        }

        // Load base config:
        console.log("Stage: Load base config");
        await Promise.all([
            loadFunctions.loadConfig(guild, backupData.data, limiter),
            loadFunctions.loadBans(guild, backupData.data, limiter)
        ]);

        // Load roles:
        console.log("Stage: Load roles");
        await loadFunctions.loadRoles(guild, backupData.data, limiter);

        // Load channels:
        console.log("Stage: Load channels");
        await loadFunctions.loadChannels(guild, backupData.data, options, limiter);

        // Load config, which requires channels:
        console.log("Stage: Load final config");
        await Promise.all([
            loadFunctions.loadAFk(guild, backupData.data, limiter),
            loadFunctions.loadEmbedChannel(guild, backupData.data, limiter),
            loadFunctions.loadAutoModRules(guild, backupData.data, limiter),
            loadFunctions.loadFinalSettings(guild, backupData.data, limiter)
        ]);

        // Assign roles:
        if (!options || !(options.doNotLoad || []).includes("roleAssignments")) {
            console.log("Stage: Assign Roles");
            await loadFunctions.assignRolesToMembers(guild, backupData.data, limiter);
        }
    }

    // Restore Emojis:
    if (!options || !(options.doNotLoad || []).includes("emojis")) {
        console.log("Stage: Restore Emojis");
        await loadFunctions.loadEmojis(guild, backupData.data, limiter);
    }

    console.log("Operation complete.");

    return backupData;
}

/* removes a backup */
async function remove(backupId) {
    try {
        fs.unlinkSync(`${backups}${path.sep}${backupId}.json`);
    } catch {
        throw new Error("Backup not found");
    }
}

/* returns the list of all backups */
function list() {
    const files = fs.readdirSync(backups);
    return files.map((file) => file.split(".")[0]);
}

/* change the storage path */
function setStorageFolder(pathname) {
    if (pathname.endsWith(path.sep)) pathname = pathname.substr(0, pathname.length - 1);

    backups = pathname;
    if (!fs.existsSync(backups)) fs.mkdirSync(backups);
}

export default { create, fetch, list, load, remove, setStorageFolder };