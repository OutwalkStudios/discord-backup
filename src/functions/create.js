import axios from "axios";
import { ChannelType } from "discord.js";
import { 
    fetchChannelPermissions,
    fetchTextChannelData,
    fetchVoiceChannelData,
    fetchStageChannelData,
    logProgress
} from "../utils";

/* Helper function to check if a channel should be excluded */
function shouldExcludeChannel(channel, doNotBackup) {
    const channelExclusions = doNotBackup.find(item => typeof item === 'object' && item.channels);
    const channelList = channelExclusions ? channelExclusions.channels : [];
    
    return doNotBackup.includes("channels") || channelList.includes(channel.id);
}

/* returns an array with the banned members of the guild */
export async function getBans(guild, limiter) {
    // Log
    let state = { status: "Saving Bans..." };
    console.log(state.status);

    const bans = await limiter.schedule({ id: "getBans::guild.bans.fetch" }, () => guild.bans.fetch());
    const totalBans = bans.size;

    // Check if there are no bans to back up
    if (totalBans === 0) {
        console.log("No bans to back up.");
        state.status = "Done.";
        console.log(state.status);
        return [];
    }

    let savedBans = 0;
    const result = bans.map((ban) => {
        console.log(`Backing up Ban: User ID: ${ban.user.id}, Reason: ${ban.reason || "No reason provided"}`);
        savedBans++;
        logProgress("Bans", savedBans, totalBans); // Progress tracking for each ban
        return { id: ban.user.id, reason: ban.reason };
    });

    // Log
    state.status = "Done.";
    console.log(state.status);

    return result;
}

/* returns an array with the members of the guild */
export async function getMembers(guild, limiter) {
    // Log
    let state = { status: "Saving Members..." };
    console.log(state.status);

    const members = await limiter.schedule({ id: "getMembers::guild.members.fetch" }, () => guild.members.fetch());
    const totalMembers = members.size;

    // Check if there are no members to back up
    if (totalMembers === 0) {
        console.log("No members to back up.");
        state.status = "Done.";
        console.log(state.status);
        return [];
    }

    let savedMembers = 0;
    const result = members.map((member) => {
        console.log(`Backing up Member: ${member.user.username}#${member.user.discriminator} (ID: ${member.user.id})`);
        savedMembers++;
        logProgress("Members", savedMembers, totalMembers); // Progress tracking for each member
        return {
            userId: member.user.id,
            username: member.user.username,
            discriminator: member.user.discriminator,
            avatarUrl: member.user.avatarURL(),
            joinedTimestamp: member.joinedTimestamp,
            roles: member.roles.cache.map((role) => role.id),
            bot: member.user.bot
        };
    });

    // Log
    state.status = "Done.";
    console.log(state.status);

    return result;
}

/* returns an array with the roles of the guild */
export async function getRoles(guild, limiter) {
    // Log
    let state = { status: "Saving Roles..." };
    console.log(state.status);

    const roles = await limiter.schedule({ id: "getRoles::guild.roles.fetch" }, () => guild.roles.fetch());
    
    // Filter out managed roles (roles created by bots or integrations)
    const filteredRoles = roles.filter((role) => !role.managed).sort((a, b) => b.position - a.position);
    const totalRoles = filteredRoles.size;

    // Check if there are no user-created roles to back up
    if (totalRoles === 0) {
        console.log("No user-created roles to back up.");
        state.status = "Done.";
        console.log(state.status);
        return [];
    }

    let savedRoles = 0;

    const result = filteredRoles.map((role) => {
        console.log(`Backing up Role: ${role.name} (ID: ${role.id})`);
        savedRoles++;
        logProgress("Roles", savedRoles, totalRoles); // Progress tracking for each role
        return {
            oldId: role.id,
            name: role.name,
            color: role.hexColor,
            icon: role.iconURL(),
            hoist: role.hoist,
            permissions: role.permissions.bitfield.toString(),
            mentionable: role.mentionable,
            position: role.position,
            isEveryone: guild.id == role.id
        };
    });

    // Log
    state.status = "Done.";
    console.log(state.status);

    return result;
}

/* returns an array with the emojis of the guild */
export async function getEmojis(guild, options, limiter) {
    // Log
    let state = { status: "Saving Emojis..." };
    console.log(state.status);

    const emojis = await limiter.schedule({ id: "getEmojis::guild.emojis.fetch" }, () => guild.emojis.fetch());
    const totalEmojis = emojis.size;

    // Check if there are no emojis to backup
    if (totalEmojis === 0) {
        console.log("No emojis to back up.");
        state.status = "Done.";
        console.log(state.status);
        return [];
    }

    let savedEmojis = 0;
    const collectedEmojis = [];

    for (const emoji of emojis.values()) {
        console.log(`Backing up Emoji: ${emoji.name} (ID: ${emoji.id})`);
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
        logProgress("Emojis", savedEmojis, totalEmojis); // Progress tracking for each emoji
    }

    // Log
    state.status = "Done.";
    console.log(state.status);

    return collectedEmojis;
}

/* returns an array with the channels of the guild */
export async function getChannels(guild, options, limiter) {
    // Log
    let state = { status: "Saving Channels..." };
    console.log(state.status);

    const channels = await limiter.schedule({ id: "getChannels::guild.channels.fetch" }, () => guild.channels.fetch());
    const collectedChannels = { categories: [], others: [] };
    let totalChannels = 0;  // Keep track of channels only
    let savedChannels = 0;  // For progress tracking

    const doNotBackup = options.doNotBackup || [];

    const categories = channels
        .filter((channel) => channel.type == ChannelType.GuildCategory)
        .sort((a, b) => a.position - b.position)
        .toJSON();

    // Calculate the total number of channels to be processed
    totalChannels = channels.filter(
        (channel) => channel.type !== ChannelType.GuildCategory && !shouldExcludeChannel(channel, doNotBackup)
    ).size;

    // Check if there are no channels to back up
    if (totalChannels === 0) {
        console.log("No channels to back up.");
        state.status = "Done.";
        console.log(state.status);
        return { categories: [], others: [] };
    }

    // Process categories and their children
    for (let category of categories) {
        if (shouldExcludeChannel(category, doNotBackup)) continue; // Skip excluded categories

        const categoryData = { name: category.name, permissions: fetchChannelPermissions(category), children: [] };

        const children = category.children.cache
            .filter((child) => !shouldExcludeChannel(child, doNotBackup)) // Skip excluded channels
            .sort((a, b) => a.position - b.position)
            .toJSON();

        for (let child of children) {
            let channelData;

            // Log the channel being backed up
            console.log(`Backing up Channel: ${child.name} (Category: ${category.name})`);

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
                savedChannels++;  // Increment saved channels
                logProgress("Channels", savedChannels, totalChannels);  // Progress logging for each channel
            }
        }

        collectedChannels.categories.push(categoryData);
    }

    // Process non-categorized channels
    const others = channels
        .filter((channel) => {
            return (
                !channel.parent &&
                channel.type != ChannelType.GuildCategory &&
                channel.type != ChannelType.AnnouncementThread &&
                channel.type != ChannelType.PrivateThread &&
                channel.type != ChannelType.PublicThread &&
                !shouldExcludeChannel(channel, doNotBackup)
            );
        })
        .sort((a, b) => a.position - b.position)
        .toJSON();

    for (let channel of others) {
        let channelData;

        // Log the channel being backed up
        console.log(`Backing up Channel: ${channel.name}`);

        // Handle text-based channels (which may have threads)
        if (channel.type === ChannelType.GuildText || channel.type == ChannelType.GuildAnnouncement) {
            channelData = await fetchTextChannelData(channel, options, limiter);
        } else if (channel.type == ChannelType.GuildVoice) {
            channelData = fetchVoiceChannelData(channel);
        }
        if (channelData) {
            channelData.oldId = channel.id;
            collectedChannels.others.push(channelData);
            savedChannels++;  // Increment saved channels
            logProgress("Channels", savedChannels, totalChannels);  // Progress logging for each channel
        }
    }

    // Log
    state.status = "Done.";
    console.log(state.status);

    return collectedChannels;
}

/* returns an array with the guild's automoderation rules */
export async function getAutoModerationRules(guild, limiter) {
    // Log
    let state = { status: "Saving auto moderation rules..." };
    console.log(state.status);

    const rules = await limiter.schedule({ id: "getAutoModerationRules::guild.autoModerationRules.fetch" }, () => guild.autoModerationRules.fetch({ cache: false }));
    const totalRules = rules.size;

    // Check if there are no automoderation rules to backup
    if (totalRules === 0) {
        console.log("No automoderation rules to back up.");
        state.status = "Done.";
        console.log(state.status);
        return [];
    }

    let savedRules = 0;
    const collectedRules = [];

    rules.forEach((rule) => {
        console.log(`Backing up AutoModeration Rule: ${rule.name} (ID: ${rule.id})`);
        const actions = [];

        rule.actions.forEach((action) => {
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
        });

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
        logProgress("Auto Moderation Rules", savedRules, totalRules); // Progress tracking for each rule
    });

    // Log
    state.status = "Done.";
    console.log(state.status);

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
