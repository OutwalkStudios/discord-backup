import axios from "axios";
import { ChannelType } from "discord.js";
import { 
    fetchChannelPermissions,
    fetchTextChannelData,
    fetchVoiceChannelData,
    fetchStageChannelData,
    logStatus
} from "../utils";

/* Helper function to check if a channel should be excluded or included */
function shouldExcludeChannel(channel, doNotBackup, toBackup) {
    if (toBackup && toBackup.length > 0) {
        const toBackupList = toBackup.flatMap(item => item.channels || []);

        // If this is a category, check if any of its children are in the toBackup list
        if (channel.type === ChannelType.GuildCategory) {
            const childChannels = channel.children.cache.map(child => child.id);
            const isChildInBackup = childChannels.some(childId => toBackupList.includes(childId));
            return !isChildInBackup;
        }
        // For non-categories, exclude if the channel is not in the toBackup list
        return !toBackupList.includes(channel.id);
    } else if (doNotBackup && doNotBackup.length > 0) {
        const doNotBackupList = doNotBackup.flatMap(item => item.channels || []);
        return doNotBackupList.includes(channel.id);
    }
    return false; // By default, do not exclude any channel
}

/* returns an array with the banned members of the guild */
export async function getBans(guild, limiter, options) {

    const bans = await limiter.schedule({ id: "getBans::guild.bans.fetch" }, () => guild.bans.fetch());
    const totalBans = bans.size;

    const result = [];

    let savedBans = 0;
    for (const ban of bans.values()) {
        const info = `Backed up Ban: User ID: ${ban.user.id}, Reason: ${ban.reason || "No reason provided"}`
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
        const info = `Backed up Member: ${member.user.username}#${member.user.discriminator} (ID: ${member.user.id})`
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
        const info = `Backed up Role: ${role.name} (ID: ${role.id})`
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
        const info = `Backed up Emoji: ${emoji.name} (ID: ${emoji.id})`
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

    const doNotBackup = options.doNotBackup || [];
    const toBackup = options.toBackup || [];

    const categories = channels
        .filter((channel) => channel.type == ChannelType.GuildCategory)
        .sort((a, b) => a.position - b.position)
        .toJSON();

    // Calculate the total number of channels to be processed
    totalChannels = channels.filter(
        (channel) => {
            const exclude = shouldExcludeChannel(channel, doNotBackup, toBackup);
            return channel.type !== ChannelType.GuildCategory && !exclude;
        }
    ).size;

    // Process categories and their children
    for (let category of categories) {
        if (shouldExcludeChannel(category, doNotBackup, toBackup)) continue; // Skip excluded categories

        const categoryData = { name: category.name, permissions: fetchChannelPermissions(category), children: [] };

        const children = category.children.cache
            .filter((child) => !shouldExcludeChannel(child, doNotBackup, toBackup)) // Skip excluded channels
            .sort((a, b) => a.position - b.position)
            .toJSON();

        for (let child of children) {
            let channelData;

            const info = `Backed up Channel: ${child.name} (Category: ${category.name})`

            // Handle text-based channels (which may have threads)
            if (child.type === ChannelType.GuildText || child.type == ChannelType.GuildAnnouncement) {
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

    // Process non-categorized channels
    const others = channels
        .filter((channel) => {
            const exclude = shouldExcludeChannel(channel, doNotBackup, toBackup);
            return (
                !channel.parent &&
                channel.type != ChannelType.GuildCategory &&
                channel.type != ChannelType.AnnouncementThread &&
                channel.type != ChannelType.PrivateThread &&
                channel.type != ChannelType.PublicThread &&
                !exclude
            );
        })
        .sort((a, b) => a.position - b.position)
        .toJSON();

    for (let channel of others) {
        let channelData;

        // Log the channel being backed up
        const info = `Backed up Channel: ${channel.name}`

        // Handle text-based channels (which may have threads)
        if (channel.type === ChannelType.GuildText || channel.type == ChannelType.GuildAnnouncement) {
            channelData = await fetchTextChannelData(channel, options, limiter);
        } else if (channel.type == ChannelType.GuildVoice) {
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
        const info = `Backed up AutoModeration Rule: ${rule.name} (ID: ${rule.id})`
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

    return collectedRules;
}

export default {
    getBans,
    getMembers,
    getRoles,
    getEmojis,
    getChannels,
    getAutoModerationRules,
};
