import { SnowflakeUtil, IntentsBitField, GatewayIntentBits } from "discord.js";
import Bottleneck from "bottleneck";
import axios from "axios";
import createFunctions from "./functions/create";
import loadFunctions from "./functions/load";
import { clearGuild } from "./utils";
import path from "path";
import fs from "fs";

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
        ...options
    };

    const backup = {
        name: guild.name,
        verificationLevel: guild.verificationLevel,
        explicitContentFilter: guild.explicitContentFilter,
        defaultMessageNotifications: guild.defaultMessageNotifications,
        afk: guild.afkChannel ? { name: guild.afkChannel.name, timeout: guild.afkTimeout } : null,
        widget: {
            enabled: guild.widgetEnabled,
            channel: guild.widgetChannel ? guild.widgetChannel.name : null
        },
        channels: { categories: [], others: [] },
        roles: [],
        bans: [],
        emojis: [],
        members: [],
        createdTimestamp: Date.now(),
        guildID: guild.id,
        id: options.backupId ?? SnowflakeUtil.generate(Date.now())
    };

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

    options = { clearGuildBeforeRestore: true, maxMessagesPerChannel: 10, speed: 250, ...options };

    const backupData = typeof backup == "string" ? await getBackupData(backup) : backup;

    if (typeof options.speed != "number") {
        throw new Error("Speed option must be a string or number");
    }

    const limiter = new Bottleneck({ minTime: speed, maxConcurrent: 1 });

    limiter.on("error", async (error) => {
        console.error(`ERROR: ${error.message}`);
        await limiter.stop();
    });

    limiter.on("failed", (error, jobInfo) => {
        console.error(`FAILED: ${error.message}\nTASK: ${JSON.stringify(jobInfo)}`);
    });

    if (options.clearGuildBeforeRestore == undefined || options.clearGuildBeforeRestore) {
        await clearGuild(guild, limiter);
    }

    await Promise.all([
        loadFunctions.loadConfig(guild, backupData, limiter),
        loadFunctions.loadRoles(guild, backupData, limiter),
        loadFunctions.loadChannels(guild, backupData, options, limiter),
        loadFunctions.loadAFk(guild, backupData, limiter),
        loadFunctions.loadEmojis(guild, backupData, limiter),
        loadFunctions.loadBans(guild, backupData, limiter),
        loadFunctions.loadEmbedChannel(guild, backupData, limiter)
    ]);

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