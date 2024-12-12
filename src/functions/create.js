import axios from "axios";
import { ChannelType } from "discord.js";
import {
    fetchChannelPermissions,
    fetchTextChannelData,
    fetchVoiceChannelData,
    fetchStageChannelData,
    logStatus
} from "../utils";

/* Helper function to check if a channel should be excluded */
function shouldExcludeChannel(channel, doNotBackupList) {
    const channelId = channel.id;

    // If the channel is explicitly listed in the `doNotBackupList`, exclude it.
    if (doNotBackupList.includes(channelId)) {
        return true;
    }

    // If the channel is a category, exclude it if the category itself is listed or all of its children are listed.
    if (channel.type === ChannelType.GuildCategory && channel.children) {
        const childChannels = channel.children.cache.map(child => child.id);

        // Exclude the entire category if its ID is in the `doNotBackupList`.
        if (doNotBackupList.includes(channelId)) {
            return true;
        }

        // Exclude the category if all of its children are listed in the `doNotBackupList`.
        const isChildInDoNotBackup = childChannels.every(childId => doNotBackupList.includes(childId));
        if (isChildInDoNotBackup) {
            return true;
        }
    }

    return false; // By default, do not exclude any channel.
}

/* Helper function to check if a channel should be included */
function shouldIncludeChannel(channel, toBackupList) {
    const channelId = channel.id;

    // Include if the channel or category is explicitly in the `toBackup` list.
    if (toBackupList.includes(channelId)) {
        return true;
    }

    // If the channel is a category, include it if any of its children are explicitly listed.
    if (channel.type === ChannelType.GuildCategory && channel.children) {
        const childChannels = channel.children.cache.map(child => child.id);
        const isChildInToBackup = childChannels.some(childId => toBackupList.includes(childId));
        if (isChildInToBackup) {
            return true;
        }
    }

    // For individual channels, include their parent category if they are explicitly listed.
    if (channel.parent && toBackupList.includes(channelId)) {
        return true;
    }

    return false; // By default, do not include any channel.
}

/* returns an array with the banned members of the guild */
export async function getBans(guild, limiter, options) {

    const bans = await limiter.schedule({ id: "getBans::guild.bans.fetch" }, () => guild.bans.fetch());
    const totalBans = bans.size;

    const result = [];

    let savedBans = 0;
    for (const ban of bans.values()) {
        const info = `Backed up Ban: User ID: ${ban.user.id}, Reason: ${ban.reason || "No reason provided"}`;
        savedBans++;
        await logStatus("Bans", savedBans, totalBans, options, info);

        // Add the processed ban to the result array
        result.push({ id: ban.user.id, reason: ban.reason });
    }

    return result;
}

/* returns an array with the members of the guild */
export async function getMembers(guild, limiter, options) {

    const members = await limiter.schedule({ id: "getMembers::guild.members.fetch" }, () => guild.members.fetch());
    const totalMembers = members.size;

    const result = [];

    let savedMembers = 0;
    for (const member of members.values()) {
        const info = `Backed up Member: ${member.user.username}#${member.user.discriminator} (ID: ${member.user.id})`;
        savedMembers++;
        await logStatus("Members", savedMembers, totalMembers, options, info);

        result.push({
            userId: member.user.id,
            username: member.user.username,
            discriminator: member.user.discriminator,
            avatarUrl: member.user.avatarURL(),
            joinedTimestamp: member.joinedTimestamp,
            roles: member.roles.cache.map((role) => role.id),
            bot: member.user.bot
        });
    }

    return result;
}

/* returns an array with the roles of the guild */
export async function getRoles(guild, limiter, options) {

    const roles = await limiter.schedule({ id: "getRoles::guild.roles.fetch" }, () => guild.roles.fetch());

    // Filter out managed roles (roles created by bots or integrations)
    const filteredRoles = roles.filter((role) => !role.managed).sort((a, b) => b.position - a.position);
    const totalRoles = filteredRoles.size;

    const result = [];

    let savedRoles = 0;

    for (const role of filteredRoles.values()) {
        const info = `Backed up Role: ${role.name} (ID: ${role.id})`;
        savedRoles++;
        await logStatus("Roles", savedRoles, totalRoles, options, info);

        result.push({
            oldId: role.id,
            name: role.name,
            color: role.hexColor,
            icon: role.iconURL(),
            hoist: role.hoist,
            permissions: role.permissions.bitfield.toString(),
            mentionable: role.mentionable,
            position: role.position,
            isEveryone: guild.id == role.id
        });
    }

    return result;
}

/* returns an array with the emojis of the guild */
export async function getEmojis(guild, limiter, options) {

    const emojis = await limiter.schedule({ id: "getEmojis::guild.emojis.fetch" }, () => guild.emojis.fetch());
    const totalEmojis = emojis.size;

    let savedEmojis = 0;
    const collectedEmojis = [];

    for (const emoji of emojis.values()) {
        const info = `Backed up Emoji: ${emoji.name} (ID: ${emoji.id})`;
        if (emojis.length >= 50) break;

        const data = { name: emoji.name };

        if (options.saveImages && options.saveImages == "base64") {
            const response = await axios.get(emoji.imageURL(), { responseType: "arraybuffer" });
            data.base64 = Buffer.from(response.data, "binary").toString("base64");
        } else {
            data.url = emoji.imageURL();
        }

        collectedEmojis.push(data);
        savedEmojis++;
        await logStatus("Emojis", savedEmojis, totalEmojis, options, info);
    }

    return collectedEmojis;
}


/* returns an array with the channels of the guild */
export async function getChannels(guild, limiter, options) {
    const channels = await limiter.schedule({ id: "getChannels::guild.channels.fetch" }, () => guild.channels.fetch());
    const collectedChannels = { categories: [], others: [] };
    let totalChannels = 0;
    let savedChannels = 0;

    const categories = channels
        .filter((channel) => channel.type == ChannelType.GuildCategory)
        .sort((a, b) => a.position - b.position)
        .toJSON();

    // Calculate the total number of channels to be processed
    totalChannels = channels.filter(
        (channel) => channel.type !== ChannelType.GuildCategory
    ).size;

    for (let category of categories) {
        const categoryData = { name: category.name, permissions: fetchChannelPermissions(category), children: [] };

        const children = category.children.cache.sort((a, b) => a.position - b.position).toJSON();

        for (let child of children) {
            let channelData;
            const info = `Backed up Channel: ${child.name} (Category: ${category.name})`;

            if (child.type == ChannelType.GuildText || child.type == ChannelType.GuildAnnouncement) {
                channelData = await fetchTextChannelData(child, options, limiter);
            } else if (child.type == ChannelType.GuildVoice) {
                channelData = fetchVoiceChannelData(child);
            } else if (child.type == ChannelType.GuildStageVoice) {
                channelData = await fetchStageChannelData(child, options, limiter);
            } else {
                console.warn(`Unsupported channel type: ${child.type}`);
            }

            if (channelData) {
                channelData.oldId = child.id;
                categoryData.children.push(channelData);
                savedChannels++;
                await logStatus("Channels", savedChannels, totalChannels, options, info);
            }
        }

        collectedChannels.categories.push(categoryData);
    }

    const others = channels
        .filter((channel) => {
            return (
                !channel.parent &&
                channel.type != ChannelType.GuildCategory &&
                channel.type != ChannelType.AnnouncementThread &&
                channel.type != ChannelType.PrivateThread &&
                channel.type != ChannelType.PublicThread
            );
        })
        .sort((a, b) => a.position - b.position)
        .toJSON();

    for (let channel of others) {
        let channelData;
        const info = `Backed up Channel: ${channel.name}`;

        if (channel.type == ChannelType.GuildText || channel.type == ChannelType.GuildAnnouncement) {
            channelData = await fetchTextChannelData(channel, options, limiter);
        } else {
            channelData = fetchVoiceChannelData(channel);
        }
        if (channelData) {
            channelData.oldId = channel.id;
            collectedChannels.others.push(channelData);
            savedChannels++;
            await logStatus("Channels", savedChannels, totalChannels, options, info);
        }
    }

    return collectedChannels;
}

/* Helper function to fetch channels and exclude them based on doNotBackup */
export async function doNotBackupgetChannels(guild, limiter, options) {
    const channels = await limiter.schedule({ id: "getChannels::guild.channels.fetch" }, () => guild.channels.fetch());
    const collectedChannels = { categories: [], others: [] };
    let savedChannels = 0;

    const doNotBackup = options.doNotBackup || [];
    const doNotBackupList = doNotBackup.flatMap(item => item.channels || []);

    const categories = channels
        .filter((channel) => channel.type === ChannelType.GuildCategory)
        .sort((a, b) => a.position - b.position)
        .toJSON();

    // Calculate the total number of channels to be backed up before the backup starts
    let totalChannels = 0;

    // Process categories and their children first
    for (let category of categories) {
        if (shouldExcludeChannel(category, doNotBackupList)) {
            continue;
        }

        const nonExcludedChildren = category.children.cache
            .filter((child) => !shouldExcludeChannel(child, doNotBackupList))
            .sort((a, b) => a.position - b.position)
            .toJSON();

        // Only count the category if it has non-excluded children
        if (nonExcludedChildren.length > 0) {
            totalChannels += nonExcludedChildren.length;
        }
    }

    // Process non-categorized channels
    const others = channels
        .filter((channel) => {
            const exclude = shouldExcludeChannel(channel, doNotBackupList);
            return (
                !channel.parent &&
                channel.type !== ChannelType.GuildCategory &&
                !exclude
            );
        })
        .sort((a, b) => a.position - b.position)
        .toJSON();

    totalChannels += others.length;

    // Backup logic for categories
    for (let category of categories) {
        if (shouldExcludeChannel(category, doNotBackupList)) continue;

        const nonExcludedChildren = category.children.cache
            .filter((child) => !shouldExcludeChannel(child, doNotBackupList))
            .sort((a, b) => a.position - b.position)
            .toJSON();

        if (nonExcludedChildren.length === 0) continue;

        const categoryData = {
            name: category.name,
            permissions: fetchChannelPermissions(category),
            children: []
        };

        for (let child of nonExcludedChildren) {
            let channelData;
            const info = `Backed up Channel: ${child.name} (Category: ${category.name})`;

            if (child.type === ChannelType.GuildText || child.type === ChannelType.GuildAnnouncement) {
                channelData = await fetchTextChannelData(child, options, limiter);
            } else if (child.type === ChannelType.GuildVoice) {
                channelData = fetchVoiceChannelData(child);
            } else if (child.type === ChannelType.GuildStageVoice) {
                channelData = await fetchStageChannelData(child, options, limiter);
            } else {
                console.warn(`[DEBUG] Unsupported channel type: ${child.type} for channel ${child.name}.`);
            }

            if (channelData) {
                channelData.oldId = child.id;
                categoryData.children.push(channelData);
                savedChannels++;  // Increment only when a channel is backed up
                await logStatus("Channels", savedChannels, totalChannels, options, info);
            }
        }

        // Add category to the list if it has any non-excluded children.
        if (categoryData.children.length > 0) {
            collectedChannels.categories.push(categoryData);
        }
    }

    // Backup logic for non-categorized channels
    for (let channel of others) {
        let channelData;
        const info = `Backed up Channel: ${channel.name}`;

        if (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement) {
            channelData = await fetchTextChannelData(channel, options, limiter);
        } else if (channel.type === ChannelType.GuildVoice) {
            channelData = fetchVoiceChannelData(channel);
        }

        if (channelData) {
            channelData.oldId = channel.id;
            collectedChannels.others.push(channelData);
            savedChannels++;  // Increment only when a channel is backed up
            await logStatus("Channels", savedChannels, totalChannels, options, info);
        }
    }

    return collectedChannels;
}

/* returns an array with the channels of the guild */
export async function toBackupgetChannels(guild, limiter, options) {
    const channels = await limiter.schedule({ id: "getChannels::guild.channels.fetch" }, () => guild.channels.fetch());
    const collectedChannels = { categories: [], others: [] };
    let totalChannels = 0;
    let savedChannels = 0;

    const toBackup = options.toBackup || [];
    const toBackupList = toBackup.flatMap(item => item.channels || []);

    const categories = channels
        .filter((channel) => channel.type === ChannelType.GuildCategory)
        .sort((a, b) => a.position - b.position)
        .toJSON();

    // Calculate total channels before backup starts
    for (let category of categories) {
        const includeCategory = shouldIncludeChannel(category, toBackupList);

        if (!includeCategory) {
            continue;
        }

        // Count only child channels that are explicitly listed or if the entire category is included.
        const includedChildren = category.children.cache
            .filter((child) => shouldIncludeChannel(child, toBackupList) || toBackupList.includes(category.id))
            .toJSON();

        totalChannels += includedChildren.length;
    }

    // Calculate the number of non-categorized channels to be backed up
    const nonCategorizedChannels = channels
        .filter((channel) => {
            const include = shouldIncludeChannel(channel, toBackupList);
            return (
                !channel.parent &&
                channel.type !== ChannelType.GuildCategory &&
                include
            );
        })
        .toJSON();

    totalChannels += nonCategorizedChannels.length;

    // Process categories and their children
    for (let category of categories) {
        const includeCategory = shouldIncludeChannel(category, toBackupList);

        if (!includeCategory) {
            continue;
        }

        // Include only specified child channels or include all if the category itself is listed.
        const includedChildren = category.children.cache
            .filter((child) => shouldIncludeChannel(child, toBackupList) || toBackupList.includes(category.id))
            .sort((a, b) => a.position - b.position)
            .toJSON();

        const categoryData = {
            name: category.name,
            permissions: fetchChannelPermissions(category),
            children: []
        };

        for (let child of includedChildren) {
            let channelData;
            const info = `Backed up Channel: ${child.name} (Category: ${category.name})`;

            if (child.type === ChannelType.GuildText || child.type === ChannelType.GuildAnnouncement) {
                channelData = await fetchTextChannelData(child, options, limiter);
            } else if (child.type === ChannelType.GuildVoice) {
                channelData = fetchVoiceChannelData(child);
            } else if (child.type === ChannelType.GuildStageVoice) {
                channelData = await fetchStageChannelData(child, options, limiter);
            } else {
                console.warn(`[DEBUG] Unsupported channel type: ${child.type} for channel ${child.name}.`);
            }

            if (channelData) {
                channelData.oldId = child.id;
                categoryData.children.push(channelData);
                savedChannels++;
                await logStatus("Channels", savedChannels, totalChannels, options, info);
            }
        }

        // Only add the category if there are included children.
        if (categoryData.children.length > 0) {
            collectedChannels.categories.push(categoryData);
        }
    }

    // Process non-categorized channels
    for (let channel of nonCategorizedChannels) {
        let channelData;
        const info = `Backed up Channel: ${channel.name}`;

        if (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement) {
            channelData = await fetchTextChannelData(channel, options, limiter);
        } else if (channel.type === ChannelType.GuildVoice) {
            channelData = fetchVoiceChannelData(channel);
        }

        if (channelData) {
            channelData.oldId = channel.id;
            collectedChannels.others.push(channelData);
            savedChannels++;
            await logStatus("Channels", savedChannels, totalChannels, options, info);
        }
    }

    return collectedChannels;
}

/* returns an array with the guild's automoderation rules */
export async function getAutoModerationRules(guild, limiter, options) {

    const rules = await limiter.schedule({ id: "getAutoModerationRules::guild.autoModerationRules.fetch" }, () => guild.autoModerationRules.fetch({ cache: false }));
    const totalRules = rules.size;

    let savedRules = 0;
    const collectedRules = [];

    for (const rule of rules.values()) {
        const info = `Backed up AutoModeration Rule: ${rule.name} (ID: ${rule.id})`;
        const actions = [];

        for (const action of rule.actions) {
            const copyAction = JSON.parse(JSON.stringify(action));

            if (copyAction.metadata.channelId) {
                const channel = guild.channels.cache.get(copyAction.metadata.channelId);

                if (channel) {
                    copyAction.metadata.channelName = channel.name;
                    actions.push(copyAction);
                }

            } else {
                actions.push(copyAction);
            }
        }

        /* filter out deleted roles and channels due to a potential bug with discord.js */
        const exemptRoles = rule.exemptRoles.filter((role) => role != undefined);
        const exemptChannels = rule.exemptChannels.filter((channel) => channel != undefined);

        collectedRules.push({
            name: rule.name,
            eventType: rule.eventType,
            triggerType: rule.triggerType,
            triggerMetadata: rule.triggerMetadata,
            actions: actions,
            enabled: rule.enabled,
            exemptRoles: exemptRoles.map((role) => ({ id: role.id, name: role.name })),
            exemptChannels: exemptChannels.map((channel) => ({ id: channel.id, name: channel.name }))
        });

        savedRules++;
        await logStatus("Auto Moderation Rules", savedRules, totalRules, options, info);
    }

    /* make sure we only backup trigger types that are not restricted to certain conditions */
    return collectedRules.filter((rule) => rule.triggerType != 5);
}

export default {
    getBans,
    getMembers,
    getRoles,
    getEmojis,
    getChannels,
    doNotBackupgetChannels,
    toBackupgetChannels,
    getAutoModerationRules,
};
