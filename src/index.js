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

/* Progress helper function */
function logProgress(task, current, total) {
    const percentage = ((current / total) * 100).toFixed(2);
    console.log(`[Progress] ${task}: ${current}/${total} (${percentage}%)`);
}

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
    const state = { status: "Starting backup..." };

    const intents = new IntentsBitField(guild.client.options.intents);
    if (!intents.has(GatewayIntentBits.Guilds))
        throw new Error("GUILDS intent is required");
    console.log(state.status);

    options = {
        backupId: null,
        maxMessagesPerChannel: 10,
        jsonSave: true,
        jsonBeautify: false,
        doNotBackup: [],
        backupMembers: false,
        saveImages: true,
        speed: 250,
        verbose: false,
        ignore2FA: false,
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

    const limiter = new Bottleneck({ minTime: options.speed, maxConcurrent: 1 });

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

    // Log
    state.status = "Saving auto moderation rules...";
    console.log(state.status);
    if (check2FA(options, guild, "auto moderation rules")) {
        const rules = await createFunctions.getAutoModerationRules(guild, limiter);
        const totalRules = rules.length;
        let savedRules = 0;

        for (const rule of rules) {
            savedRules++;
            logProgress("Auto Moderation Rules", savedRules, totalRules);
        }

        backup.autoModerationRules = rules;
    }


    // Log
    state.status = "Done.";
    console.log(state.status);

    // Log
    state.status = "Saving guild icons and members...";
    console.log(state.status);

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
        backup.members = await createFunctions.getMembers(guild, limiter);
    }

    if (!options || !(options.doNotBackup || []).includes("bans")) {
        if (check2FA(options, guild, "bans")) {
            backup.bans = await createFunctions.getBans(guild, limiter);
        }
    }

    // Log
    state.status = "Done.";
    console.log(state.status);

    // Log
    state.status = "Saving roles...";
    console.log(state.status);
    if (!options || !(options.doNotBackup || []).includes("roles")) {
        const roles = await createFunctions.getRoles(guild, limiter);
        const totalRoles = roles.length;
        let savedRoles = 0;

        for (const role of roles) {
            savedRoles++;
            logProgress("Roles", savedRoles, totalRoles);
        }

        backup.roles = roles;
    }

    // Log
    state.status = "Done.";
    console.log(state.status);

    // Log
    state.status = "Saving emojis...";
    console.log(state.status);
    if (!options || !(options.doNotBackup || []).includes("emojis")) {
        const emojis = await createFunctions.getEmojis(guild, options, limiter);
        const totalEmojis = emojis.length;
        let savedEmojis = 0;

        for (const emoji of emojis) {
            savedEmojis++;
            logProgress("Emojis", savedEmojis, totalEmojis);
        }

        backup.emojis = emojis;
    }

    // Log
    state.status = "Done.";
    console.log(state.status);

    // Log
    state.status = "Saving Channels...";
    console.log(state.status);

    if (!options || !(options.doNotBackup || []).includes("channels")) {
        const { collectedChannels, totalChannels, totalThreads } = await createFunctions.getChannels(guild, options, limiter);
        let savedChannels = 0;
        let savedThreads = 0;
    
        // Process Channels Within Categories
        for (const category of collectedChannels.categories) {
            for (const child of category.children) {
                savedChannels++;  // Increment for child channels only
                logProgress("Channels", savedChannels, totalChannels);
            }
        }
    
        // Process Non-Categorized Channels
        for (const channel of collectedChannels.others) {
            savedChannels++;  // Increment for other channels
            logProgress("Channels", savedChannels, totalChannels);
        }
    
        backup.channels = collectedChannels;
    }    

    // Log
    state.status = "Done.";
    console.log(state.status);

    if (!options || options.jsonSave == undefined || options.jsonSave) {
        const reviver = (key, value) => typeof value === "bigint" ? value.toString() : value;
        const backupJSON = options.jsonBeautify ? JSON.stringify(backup, reviver, 4) : JSON.stringify(backup, reviver);
        fs.writeFileSync(`${backups}${path.sep}${backup.id}.json`, backupJSON, "utf-8");
    }

    state.status = "Backup complete!";
    console.log(state.status);

    return backup;
}

/* loads a backup for a guild */
async function load(backup, guild, options) {
    const state = { status: "Restoring..." };
    if (!guild) throw new Error("Invalid Guild!");
    console.log(state.status);

    options = {
        clearGuildBeforeRestore: true,
        maxMessagesPerChannel: 10,
        speed: 250,
        doNotLoad: [],
        verbose: false,
        ...options,
    };

    /* get the backup data from a several possible methods it could be passed into this method */
    const isBackupFromFetch = backup.id && backup.size && backup.data;
    const backupData = typeof backup == "string" ? await getBackupData(backup) : isBackupFromFetch ? backup.data : backup;

    if (typeof options.speed != "number") {
        throw new Error("Speed option must be a string or number");
    }

    const limiter = new Bottleneck({ minTime: options.speed, maxConcurrent: 1 });

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

    // Main part of the backup restoration:
    if (!options || !(options.doNotLoad || []).includes("main")) {
        if (options.clearGuildBeforeRestore == undefined || options.clearGuildBeforeRestore) {
            await clearGuild(guild, limiter);
        }

        // Log
        state.status = "Restoring base config...";
        console.log(state.status);

        // Load base config:
        await Promise.all([
            loadFunctions.loadConfig(guild, backupData, limiter),
            loadFunctions.loadBans(guild, backupData, limiter),
        ]);

        // Log
        state.status = "Done.";
        console.log(state.status);

        // Log
        state.status = "Restoring roles...";
        console.log(state.status);

        // Load roles:
        await loadFunctions.loadRoles(guild, backupData, limiter);

        // Log
        state.status = "Done.";
        console.log(state.status);

        // Log
        state.status = "Restoring Channels...";
        console.log(state.status);

        // Load channels:
        await loadFunctions.loadChannels(guild, backupData, options, limiter);

        // Log
        state.status = "Done.";
        console.log(state.status);

        // Log
        state.status = "Restoring Config...";
        console.log(state.status);

        // Load config, which requires channels:
        await Promise.all([
            loadFunctions.loadAFk(guild, backupData, limiter),
            loadFunctions.loadEmbedChannel(guild, backupData, limiter),
            loadFunctions.loadAutoModRules(guild, backupData, limiter),
            loadFunctions.loadFinalSettings(guild, backupData, limiter),
        ]);

        // Assign roles:
        if (!options || !(options.doNotLoad || []).includes("roleAssignments")) {
            await loadFunctions.assignRolesToMembers(guild, backupData, limiter);
        }

        // Log
        state.status = "Done.";
        console.log(state.status);
    }

    // Log
    state.status = "Restoring Emojis...";
    console.log(state.status);

    // Restore Emojis:
    if (!options || !(options.doNotLoad || []).includes("emojis")) {
        await loadFunctions.loadEmojis(guild, backupData, limiter);
    }

    // Log
    state.status = "Done.";
    console.log(state.status);

    state.status = "Restoration complete!";
    console.log(state.status);

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
