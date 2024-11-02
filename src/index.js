import { SnowflakeUtil, IntentsBitField, GatewayIntentBits, GuildMFALevel } from "discord.js";
import Bottleneck from "bottleneck";
import axios from "axios";
import createFunctions from "./functions/create";
import loadFunctions from "./functions/load";
import { clearGuild } from "./utils";
import path from "path";
import url from "url";
import fs from "fs";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

let backups = `${__dirname}/backups`;
if (!fs.existsSync(backups)) fs.mkdirSync(backups);

/* checks if user has 2fa permissions for 2fa required requests, otherwise warns them */
function check2FA(options, guild, permission) {
    /* skip further processing when 2FA is not required */
    if (guild.mfaLevel == GuildMFALevel.None) return true;
    
    /* log a warning when an action requires 2FA but 2FA has not been setup on the bot owner */
    if (!guild.client.user.mfaEnabled && !options.ignore2FA) {
        console.log(`[WARNING] - 2FA is required by this server in order to backup ${permission}`);
    }

    return guild.client.user.mfaEnabled;
}

/* checks if a backup exists and returns its data */
async function getBackupData(backupId) {
    return new Promise((resolve, reject) => {
        const files = fs.readdirSync(backups);
        const file = files
            .filter((file) => file.split(".").pop() == "json")
            .find((file) => file == `${backupId}.json`);

        if (file) {
            const backupData = JSON.parse(
                fs.readFileSync(`${backups}${path.sep}${file}`)
            );            
            resolve(backupData);
        } else {
            reject("No backup found");
        }
    });
}

/* fetches a backup and returns the information about it */
async function fetch(backupId) {
    try {
        const backupData = await getBackupData(backupId);
        const size = fs.statSync(`${backups}${path.sep}${backupId}.json`).size;

        return {
            data: backupData,
            id: backupId,
            size: Number((size / 1024).toFixed(2)),
        };
    } catch {
        throw new Error("No backup found.");
    }
}

/* creates a new backup and saves it to the storage */
async function create(guild, options = {}) {

    const intents = new IntentsBitField(guild.client.options.intents);
    if (!intents.has(GatewayIntentBits.Guilds))
        throw new Error("GUILDS intent is required");

    // Ensure `toBackup` and `doNotBackup` are not used together
    if (options.toBackup && options.doNotBackup) {
        throw new Error("You cannot use both 'toBackup' and 'doNotBackup' options at the same time.");
    }

    options = {
        backupId: null,
        maxMessagesPerChannel: 10,
        jsonSave: true,
        jsonBeautify: false,
        doNotBackup: [] || null,
        toBackup: []  || null,
        backupMembers: false,
        saveImages: true,
        speed: 250,
        concurrency: 45,
        verbose: false,
        ignore2FA: false,
        onStatusChange: null,
        ...options,
    };

    const backup = {
        name: guild.name,
        verificationLevel: guild.verificationLevel,
        explicitContentFilter: guild.explicitContentFilter,
        systemChannel: guild.systemChannel
            ? { name: guild.systemChannel.name, flags: guild.systemChannelFlags }
            : null,
        premiumProgressBarEnabled: guild.premiumProgressBarEnabled,
        defaultMessageNotifications: guild.defaultMessageNotifications,
        afk: guild.afkChannel
            ? { name: guild.afkChannel.name, timeout: guild.afkTimeout }
            : null,
        widget: {
            enabled: guild.widgetEnabled,
            channel: guild.widgetChannel ? guild.widgetChannel.name : null,
        },
        autoModerationRules: [],
        channels: { categories: [], others: [] },
        roles: [],
        bans: [],
        emojis: [],
        members: [],
        createdTimestamp: Date.now(),
        messagesPerChannel: options.maxMessagesPerChannel,
        guildID: guild.id,
        id: options.backupId ?? SnowflakeUtil.generate(Date.now()),
    };

    const limiter = new Bottleneck({
        reservoir: 50, // Maximum number of requests
        reservoirRefreshAmount: 50, // Reset reservoir back to 50
        reservoirRefreshInterval: 1000, // Refresh every second (1000ms)
        maxConcurrent: options.concurrency, // Allow up to `concurrency` tasks at the same time
        minTime: options.speed // Control minimum delay between requests
    });

    /* if verbose is enabled, log all tasks at executing and done stages */
    if (options.verbose) {
        limiter.on("executing", (jobInfo) => {
            console.log(`Executing ${jobInfo.options.id}.`);
        });

        limiter.on("done", (jobInfo) => {
            console.log(`Completed ${jobInfo.options.id}.`);
        });
    }

    limiter.on("error", async (error) => {
        /* ignore errors where the request entity is too large */
        if (error.message == "Request entity too large") return;

        console.error(`ERROR: ${error.message}`);
    });

    limiter.on("failed", (error, jobInfo) => {
        /* ignore errors where the request entity is too large */
        if (error.message == "Request entity too large") return;

        console.error(`Job Failed: ${error.message}\nID: ${jobInfo.options.id}`);
    });

    if (check2FA(options, guild, "auto moderation rules")) {
    /* Check if there's already a rule with trigger type 5 */
    const existingRules = await guild.autoModerationRules.fetch();
    const ruleType5 = existingRules.find(rule => rule.triggerType === 5);

    if (!ruleType5) {
        /* Only create the rule if it doesn't already exist */
        backup.autoModerationRules = await createFunctions.getAutoModerationRules(guild, limiter, options);
    } else {
        console.log("Auto Moderation rule with trigger type 5 already exists, skipping creation");
    }
}

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

    // Default behavior if neither toBackup nor doNotBackup is specified
    if ((!options.toBackup || options.toBackup.length === 0) && (!options.doNotBackup || options.doNotBackup.length === 0)) {
        // Backup everything by default
        if (check2FA(options, guild, "bans")) {
            backup.bans = await createFunctions.getBans(guild, limiter, options);
        }
        backup.roles = await createFunctions.getRoles(guild, limiter, options);
        backup.emojis = await createFunctions.getEmojis(guild, limiter, options);
        backup.channels = await createFunctions.getChannels(guild, limiter, options);
        if (options.backupMembers) {
            backup.members = await createFunctions.getMembers(guild, limiter, options);
        }
    } else if (options.doNotBackup.length > 0) {
        // Use doNotBackup to exclude backup of specific items.
        if (!options.doNotBackup.includes("bans")) {
            if (check2FA(options, guild, "bans")) {
                backup.bans = await createFunctions.getBans(guild, limiter, options);
            }
        }

        if (!options.doNotBackup.includes("roles")) {
            backup.roles = await createFunctions.getRoles(guild, limiter, options);
        }

        if (!options.doNotBackup.includes("emojis")) {
            backup.emojis = await createFunctions.getEmojis(guild, limiter, options);
        }

        if (!options.doNotBackup.includes("channels")) {
            backup.channels = await createFunctions.doNotBackupgetChannels(guild, limiter, options);
        }

        if (options.backupMembers) {
            backup.members = await createFunctions.getMembers(guild, limiter, options);
        }
    } else if (options.toBackup.length > 0) {
        // Use toBackup to backup specific items.
        const toBackupList = options.toBackup;

        if (toBackupList.includes("bans")) {
            if (check2FA(options, guild, "bans")) {
                backup.bans = await createFunctions.getBans(guild, limiter, options);
            }
        }

        if (toBackupList.includes("roles")) {
            backup.roles = await createFunctions.getRoles(guild, limiter, options);
        }

        if (toBackupList.includes("emojis")) {
            backup.emojis = await createFunctions.getEmojis(guild, limiter, options);
        }

        if (toBackupList.includes("channels")) {
            backup.channels = await createFunctions.getChannels(guild, limiter, options);
        }

        if (toBackupList.length > 0 && !toBackupList.includes("channels")) {
            backup.channels = await createFunctions.toBackupgetChannels(guild, limiter, options);
        }

        if (options && options.backupMembers) {
            backup.members = await createFunctions.getMembers(guild, limiter, options);
        }
    }

    if (!options || options.jsonSave == undefined || options.jsonSave) {
        const reviver = (key, value) => typeof value === "bigint" ? value.toString() : value;
        const backupJSON = options.jsonBeautify ? JSON.stringify(backup, reviver, 4) : JSON.stringify(backup, reviver);
        fs.writeFileSync(`${backups}${path.sep}${backup.id}.json`, backupJSON, "utf-8");
    }

    return backup;
}

/* loads a backup for a guild */
async function load(backup, guild, options) {
    if (!guild) throw new Error("Invalid Guild!");

    // Ensure `toLoad` and `doNotLoad` are not used together
    if (options.toLoad && options.doNotLoad) {
        throw new Error("You cannot use both 'toLoad' and 'doNotLoad' options at the same time.");
    }

    options = {
        clearGuildBeforeRestore: true,
        maxMessagesPerChannel: 10,
        speed: 250,
        concurrency: 45,
        doNotLoad: [] || null,
        toLoad: [] || null,
        verbose: false,
        onStatusChange: null,
        ...options,
    };

    /* get the backup data from a several possible methods it could be passed into this method */
    const isBackupFromFetch = backup.id && backup.size && backup.data;
    const backupData = typeof backup == "string" ? await getBackupData(backup) : isBackupFromFetch ? backup.data : backup;

    if (typeof options.speed != "number") {
        throw new Error("Speed option must be a string or number");
    }

    const limiter = new Bottleneck({
        reservoir: 50, // Maximum number of requests
        reservoirRefreshAmount: 50, // Reset reservoir back to 50
        reservoirRefreshInterval: 1000, // Refresh every second (1000ms)
        maxConcurrent: options.concurrency, // Allow up to `concurrency` tasks at the same time
        minTime: options.speed // Control minimum delay between requests
    });

    /* if verbose is enabled, log all tasks at executing and done stages */
    if (options.verbose) {
        limiter.on("executing", (jobInfo) => {
            console.log(`Executing ${jobInfo.options.id}.`);
        });

        limiter.on("done", (jobInfo) => {
            console.log(`Completed ${jobInfo.options.id}.`);
        });
    }

    limiter.on("error", async (error) => {
        /* ignore errors where the request entity is too large */
        if (error.message == "Request entity too large") return;

        console.error(`ERROR: ${error.message}`);
    });

    limiter.on("failed", (error, jobInfo) => {
        /* ignore errors where the request entity is too large */
        if (error.message == "Request entity too large") return;

        console.error(`Job Failed: ${error.message}\nID: ${jobInfo.options.id}`);
    });

    // Default behavior if neither toLoad nor doNotLoad is specified
    if ((!options.toLoad || options.toLoad.length === 0) && (!options.doNotLoad || options.doNotLoad.length === 0)) {
        // Load everything by default
        if (options.clearGuildBeforeRestore == undefined || options.clearGuildBeforeRestore) {
            await clearGuild(guild, limiter);
        }

        await Promise.all([
            loadFunctions.loadConfig(guild, backupData, limiter, options),
            loadFunctions.loadBans(guild, backupData, limiter, options),
        ]);

        await loadFunctions.loadRoles(guild, backupData, limiter, options);
        await loadFunctions.doNotLoadloadChannels(guild, backupData, limiter, options);

        await Promise.all([
            loadFunctions.loadAFk(guild, backupData, limiter, options),
            loadFunctions.loadEmbedChannel(guild, backupData, limiter, options),
            loadFunctions.loadAutoModRules(guild, backupData, limiter, options),
            loadFunctions.loadFinalSettings(guild, backupData, limiter, options),
        ]);

        await loadFunctions.assignRolesToMembers(guild, backupData, limiter, options);
        await loadFunctions.loadEmojis(guild, backupData, limiter, options);

    } else if (options.doNotLoad.length > 0) {
        // Use doNotLoad to exclude load of specific items.
        if (!options || !(options.doNotLoad || []).includes("main")) {
            if (options.clearGuildBeforeRestore == undefined || options.clearGuildBeforeRestore) {
                await clearGuild(guild, limiter);
            }

            await Promise.all([
                loadFunctions.loadConfig(guild, backupData, limiter, options),
                loadFunctions.loadBans(guild, backupData, limiter, options),
            ]);
        }

        if (!options || !(options.doNotLoad || []).includes("roles")) {
            await loadFunctions.loadRoles(guild, backupData, limiter, options);
        }

        if (!options || !(options.doNotLoad || []).includes("channels")) {
            await loadFunctions.doNotLoadloadChannels(guild, backupData, limiter, options);
        }

        if (!options || !(options.doNotLoad || []).includes("main")) {
            await Promise.all([
                loadFunctions.loadAFk(guild, backupData, limiter, options),
                loadFunctions.loadEmbedChannel(guild, backupData, limiter, options),
                loadFunctions.loadAutoModRules(guild, backupData, limiter, options),
                loadFunctions.loadFinalSettings(guild, backupData, limiter, options),
            ]);
        }

        if (!options || !(options.doNotLoad || []).includes("roleAssignments")) {
            await loadFunctions.assignRolesToMembers(guild, backupData, limiter, options);
        }

        if (!options || !(options.doNotLoad || []).includes("emojis")) {
            await loadFunctions.loadEmojis(guild, backupData, limiter, options);
        }

    } else if (options.toLoad.length > 0) {
        // Use toLoad to load specific items.
        const toLoadList = options.toLoad;

        if (toLoadList.includes("main")) {
            if (options.clearGuildBeforeRestore == undefined || options.clearGuildBeforeRestore) {
                await clearGuild(guild, limiter);
            }

            await Promise.all([
                loadFunctions.loadConfig(guild, backupData, limiter, options),
                loadFunctions.loadBans(guild, backupData, limiter, options),
            ]);
        }

        if (toLoadList.includes("roles")) {
            await loadFunctions.loadRoles(guild, backupData, limiter, options);
        }

        if (toLoadList && toLoadList.length > 0) {
            await loadFunctions.toLoadloadChannels(guild, backupData, limiter, options);
        }

        if (toLoadList.includes("main")) {
            await Promise.all([
                loadFunctions.loadAFk(guild, backupData, limiter, options),
                loadFunctions.loadEmbedChannel(guild, backupData, limiter, options),
                loadFunctions.loadAutoModRules(guild, backupData, limiter, options),
                loadFunctions.loadFinalSettings(guild, backupData, limiter, options),
            ]);
        }

        if (toLoadList.includes("roleAssignments")) {
            await loadFunctions.assignRolesToMembers(guild, backupData, limiter, options);
        }

        if (toLoadList.includes("emojis")) {
            await loadFunctions.loadEmojis(guild, backupData, limiter, options);
        }
    }

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
