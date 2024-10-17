import { GuildFeature, ChannelType } from "discord.js";
import { loadCategory, loadChannel, logStatus } from "../utils";

/* Helper function to check if a channel should be excluded */
function shouldExcludeChannel(channel, doNotLoad) {
    const channelId = channel.oldId;

    if (doNotLoad && doNotLoad.length > 0) {
        const doNotLoadList = doNotLoad.flatMap(item => item.channels || []);

        // For non-categories, exclude if the channel is in the doNotLoad list
        if (!channel.children) {
            return doNotLoadList.includes(channelId);
        }

        // If this is a category, exclude it if all of its children are in the doNotLoad list
        const childChannels = channel.children.map(child => child.oldId || child.id);
        const isChildInDoNotLoad = childChannels.every(childId => doNotLoadList.includes(childId));
        return isChildInDoNotLoad; // Exclude category if all of its children are excluded
    }
    return false; // By default, do not exclude any channel
}

/* Helper function to check if a category should be excluded based on its children having the specified `parent_id`. */
function shouldExcludeCategory(category, doNotLoadList) {
    // Exclude the category if any of its child channels' parent_id matches an ID in the `doNotLoad` list
    const childExcluded = category.children.some(child => doNotLoadList.includes(child.parent_id));
    return childExcluded;
}

/* restores the guild configuration */
export async function loadConfig(guild, backup, limiter, options) {

    const tasks = [
        backup.name ? "Name" : null,
        backup.iconBase64 || backup.iconURL ? "Icon" : null,
        backup.splashBase64 || backup.splashURL ? "Splash" : null,
        backup.bannerBase64 || backup.bannerURL ? "Banner" : null,
        backup.verificationLevel ? "Verification Level" : null,
        backup.defaultMessageNotifications ? "Message Notifications" : null,
        backup.explicitContentFilter ? "Explicit Content Filter" : null
    ].filter(Boolean);

    let completedTasks = 0;
    const totalTasks = tasks.length;

    if (backup.name) {
        const info = `Restored Config: Set Name to ${backup.name}`
        await limiter.schedule({ id: "loadConfig::guild.setName" }, () => guild.setName(backup.name));
        completedTasks++;
        await logStatus("Config", completedTasks, totalTasks, options, info);
    }

    if (backup.iconBase64) {
        const info = "Restored Config: Set Icon (Base64)"
        await limiter.schedule({ id: "loadConfig::guild.setIcon" }, () => guild.setIcon(Buffer.from(backup.iconBase64, "base64")));
        completedTasks++;
        await logStatus("Config", completedTasks, totalTasks, options, info);
    } else if (backup.iconURL) {
        const info = "Restored Config: Setting Icon (URL)"
        await limiter.schedule({ id: "loadConfig::guild.setIcon" }, () => guild.setIcon(backup.iconURL));
        completedTasks++;
        await logStatus("Config", completedTasks, totalTasks, options, info);
    }

    if (backup.splashBase64) {
        const info = "Restored Config: Setting Splash (Base64)"
        await limiter.schedule({ id: "loadConfig::guild.setSplash" }, () => guild.setSplash(Buffer.from(backup.splashBase64, "base64")));
        completedTasks++;
        await logStatus("Config", completedTasks, totalTasks, options, info);
    } else if (backup.splashURL) {
        const info = "Restored Config: Setting Splash (URL)"
        await limiter.schedule({ id: "loadConfig::guild.setSplash" }, () => guild.setSplash(backup.splashURL));
        completedTasks++;
        await logStatus("Config", completedTasks, totalTasks, options, info);
    }

    if (backup.bannerBase64) {
        const info = "Restored Config: Setting Banner (Base64)"
        await limiter.schedule({ id: "loadConfig::guild.setBanner" }, () => guild.setBanner(Buffer.from(backup.bannerBase64, "base64")));
        completedTasks++;
        await logStatus("Config", completedTasks, totalTasks, options, info);
    } else if (backup.bannerURL) {
        const info = "Restored Config: Setting Banner (URL)"
        await limiter.schedule({ id: "loadConfig::guild.setBanner" }, () => guild.setBanner(backup.bannerURL));
        completedTasks++;
        await logStatus("Config", completedTasks, totalTasks, options, info);
    }

    if (backup.verificationLevel) {
        const info = `Restored Config: Setting Verification Level to ${backup.verificationLevel}`
        await limiter.schedule({ id: "loadConfig::guild.setVerificationLevel" }, () => guild.setVerificationLevel(backup.verificationLevel));
        completedTasks++;
        await logStatus("Config", completedTasks, totalTasks, options, info);
    }

    if (backup.defaultMessageNotifications) {
        const info = `Restored Config: Setting Default Message Notifications to ${backup.defaultMessageNotifications}`
        await limiter.schedule({ id: "loadConfig::guild.setDefaultMessageNotifications" }, () => guild.setDefaultMessageNotifications(backup.defaultMessageNotifications));
        completedTasks++;
        await logStatus("Config", completedTasks, totalTasks, options, info);
    }

    const changeableExplicitLevel = guild.features.includes(GuildFeature.Community);
    if (backup.explicitContentFilter && changeableExplicitLevel) {
        const info = `Restored Config: Setting Explicit Content Filter to ${backup.explicitContentFilter}`
        await limiter.schedule({ id: "loadConfig::guild.setExplicitContentFilter" }, () => guild.setExplicitContentFilter(backup.explicitContentFilter));
        completedTasks++;
        await logStatus("Config", completedTasks, totalTasks, options, info);
    }

    // Role and channel maps which will get populated later (internal use only):
    backup.roleMap = {};
    backup.channelMap = {};

}

/* restore the guild roles */
export async function loadRoles(guild, backup, limiter, options) {

    const totalRoles = backup.roles.length;
    let savedRoles = 0;

    for (let role of backup.roles) {
        let info = '';
        try {
            if (role.isEveryone) {
                info = "Restored Role: @everyone";
                await limiter.schedule({ id: `loadRoles::guild.roles.edit::everyone` }, () => guild.roles.edit(guild.roles.everyone, {
                    permissions: BigInt(role.permissions),
                    mentionable: role.mentionable
                }));
                backup.roleMap[role.oldId] = guild.roles.everyone;
            } else {
                info = `Restored Role: ${role.name} (ID: ${role.oldId})`
                const createdRole = await limiter.schedule({ id: `loadRoles::guild.roles.create::${role.name}` }, () => guild.roles.create({
                    name: role.name,
                    color: role.color,
                    icon: role.icon,
                    hoist: role.hoist,
                    permissions: BigInt(role.permissions),
                    mentionable: role.mentionable,
                    position: role.position
                }));
                backup.roleMap[role.oldId] = createdRole;
            }
            savedRoles++;
            await logStatus("Roles", savedRoles, totalRoles, options, info);
        } catch (error) {
            console.error(error.message);
        }
    }

}

/* restore the guild channels */
export async function doNotLoadloadChannels(guild, backup, limiter, options) {
    const doNotLoad = options.doNotLoad || [];
    const doNotLoadList = doNotLoad.flatMap(item => item.channels || []);

    // Calculate the total number of channels to restore based on the doNotLoad list
    let totalChannels = 0;
    for (let category of backup.channels.categories) {
        const nonExcludedChildren = category.children.filter(child => !shouldExcludeChannel(child, doNotLoad));
        if (!shouldExcludeCategory(category, doNotLoadList) && nonExcludedChildren.length > 0) {
            totalChannels += nonExcludedChildren.length;
        }
    }

    // Include non-categorized channels in the total
    totalChannels += backup.channels.others.filter(channel => !shouldExcludeChannel(channel, doNotLoad)).length;

    // Ensure totalChannels is at least 1 to avoid division by zero
    if (totalChannels === 0) {
        totalChannels = 1;
    }

    let savedChannels = 0;

    // Restore categories and their child channels
    for (let category of backup.channels.categories) {
        console.log(`[DEBUG] Processing Category: ${category.name} (${category.oldId || category.id})`);

        const nonExcludedChildren = category.children.filter(child => !shouldExcludeChannel(child, doNotLoad));

        // Skip creating the category if all of its children are excluded
        if (shouldExcludeCategory(category, doNotLoadList) || nonExcludedChildren.length === 0) {
            console.log(`[DEBUG] Skipping Category: ${category.name} as all its children are excluded or it matches an excluded parent_id.`);
            continue;
        }

        console.log(`[DEBUG] Creating Category: ${category.name}`);
        const createdCategory = await loadCategory(category, guild, limiter);
        console.log(`[DEBUG] Created Category: ${createdCategory.name} (${createdCategory.id})`);

        for (let channel of nonExcludedChildren) {
            try {
                const info = `Restored Channel: ${channel.name} (Category: ${category.name})`;
                const createdChannel = await loadChannel(channel, guild, createdCategory, options, limiter);
                if (createdChannel) {
                    backup.channelMap[channel.oldId || channel.id] = createdChannel;
                    savedChannels++;
                    await logStatus("Channels", savedChannels, totalChannels, options, info);
                    console.log(`[DEBUG] Restored Channel: ${createdChannel.name} (${createdChannel.id})`);
                }
            } catch (error) {
                console.error(`[ERROR] Error restoring channel ${channel.name}: ${error.message}`);
            }
        }
    }

    // Restore non-categorized channels
    for (let channel of backup.channels.others) {
        if (shouldExcludeChannel(channel, doNotLoad)) {
            console.log(`[DEBUG] Skipping Non-Categorized Channel: ${channel.name} (${channel.oldId || channel.id})`);
            continue;
        }

        try {
            const info = `Restored Non-Categorized Channel: ${channel.name}`;
            const createdChannel = await loadChannel(channel, guild, null, options, limiter);
            if (createdChannel) {
                backup.channelMap[channel.oldId || channel.id] = createdChannel;
                savedChannels++;
                await logStatus("Channels", savedChannels, totalChannels, options, info);
                console.log(`[DEBUG] Restored Non-Categorized Channel: ${createdChannel.name} (${createdChannel.id})`);
            }
        } catch (error) {
            console.error(`[ERROR] Error restoring non-categorized channel ${channel.name}: ${error.message}`);
        }
    }

    console.log(`[loadChannels] Channels restored: ${savedChannels}/${totalChannels}`);

    // Ensure progress doesn't exceed the total number of channels
    if (savedChannels > totalChannels) {
        console.warn(`Saved channels (${savedChannels}) exceeded total channels (${totalChannels}). Resetting progress.`);
        savedChannels = totalChannels;
        await logStatus("Channels", savedChannels, totalChannels, options);
    }
}

/* restore the guild channels */
export async function toLoadloadChannels(guild, backup, limiter, options) {
    const toLoad = options.toLoad || [];
    const specifiedChannels = toLoad.flatMap(item => item.channels || []);
    
    console.log("[loadChannels] Starting to load channels...");
    console.log("[loadChannels] Options provided:", options);
    console.log("[loadChannels] Specified channels to load:", specifiedChannels);

    let savedChannels = 0;

    // Helper function to check if a channel should be loaded
    function shouldLoadChannel(channelId) {
        const result = toLoad.includes("channels") || specifiedChannels.includes(channelId);
        console.log(`[loadChannels] shouldLoadChannel(${channelId}) -> ${result}`);
        return result;
    }

    // Helper function to check if a category should be loaded based on its children having the specified `parent_id` or if the category itself is specified.
    function shouldLoadCategory(categoryName) {
        const result = backup.channels.categories.some(category => 
            category.name === categoryName &&
            (category.children.some(child => specifiedChannels.includes(child.parent_id)) || specifiedChannels.includes(category.name))
        );
        console.log(`[loadChannels] shouldLoadCategory(${categoryName}) -> ${result}`);
        return result;
    }

    // Calculate total restorable channels
    const totalChannels = backup.channels.categories.reduce((count, category) => {
        const relevantChildren = category.children.filter(child => shouldLoadChannel(child.oldId) || specifiedChannels.includes(child.parent_id));
        if (shouldLoadCategory(category.name) || relevantChildren.length > 0) {
            return count + relevantChildren.length;
        }
        return count;
    }, 0) + backup.channels.others.filter(channel => shouldLoadChannel(channel.oldId)).length;

    console.log("[loadChannels] Total channels to restore:", totalChannels);

    // Restore categories and their child channels
    for (let category of backup.channels.categories) {
        console.log(`[loadChannels] Processing category: ${category.name}`);

        // Check if the category should be loaded based on its children or if it itself is specified.
        const relevantChildren = category.children.filter(child => shouldLoadChannel(child.oldId) || specifiedChannels.includes(child.parent_id));
        console.log(`[loadChannels] Relevant children for category ${category.name}:`, relevantChildren.map(c => c.name));

        if (!shouldLoadCategory(category.name) && relevantChildren.length === 0) {
            console.log(`[loadChannels] Skipping category ${category.name} as it has no relevant children and is not specified for restore.`);
            continue;
        }

        console.log(`[loadChannels] Creating category: ${category.name}`);
        const createdCategory = await loadCategory(category, guild, limiter);

        for (let channel of category.children) {
            try {
                // Check if this channel should be loaded based on the `parent_id` or if it's directly specified.
                if (!shouldLoadChannel(channel.oldId) && !relevantChildren.includes(channel)) {
                    console.log(`[loadChannels] Skipping child channel ${channel.name} under category ${category.name}`);
                    continue;
                }

                const info = `Restored Channel: ${channel.name} (Category: ${category.name})`;
                console.log(`[loadChannels] Restoring channel: ${channel.name} in category: ${category.name}`);
                const createdChannel = await loadChannel(channel, guild, createdCategory, options, limiter);
                if (createdChannel) {
                    backup.channelMap[channel.oldId] = createdChannel;
                    savedChannels++;
                    await logStatus("Channels", savedChannels, totalChannels, options, info);
                }
            } catch (error) {
                console.error(`Error restoring channel ${channel.name} under category ${category.name}: ${error.message}`);
            }
        }
    }

    // Restore non-categorized channels (channels without a parent)
    for (let channel of backup.channels.others) {
        try {
            console.log(`[loadChannels] Processing non-categorized channel: ${channel.name} (ID: ${channel.oldId})`);

            // Check if this channel should be loaded based on `shouldLoadChannel`.
            if (!shouldLoadChannel(channel.oldId)) {
                console.log(`[loadChannels] Skipping non-categorized channel: ${channel.name}`);
                continue;
            }

            const info = `Restored Channel: ${channel.name}`;
            console.log(`[loadChannels] Restoring non-categorized channel: ${channel.name}`);
            const createdChannel = await loadChannel(channel, guild, null, options, limiter);
            if (createdChannel) {
                backup.channelMap[channel.oldId] = createdChannel;
                savedChannels++;
                await logStatus("Channels", savedChannels, totalChannels, options, info);
            }
        } catch (error) {
            console.error(`Error restoring non-categorized channel ${channel.name}: ${error.message}`);
        }
    }

    console.log(`[loadChannels] Channels restored: ${savedChannels}/${totalChannels}`);

    // Ensure progress doesn't exceed the total number of channels
    if (savedChannels > totalChannels) {
        console.warn(`Saved channels (${savedChannels}) exceeded total channels (${totalChannels}). Resetting progress.`);
        savedChannels = totalChannels;
        await logStatus("Channels", savedChannels, totalChannels, options);
    }
}


/* restore the automod rules */
export async function loadAutoModRules(guild, backup, limiter, options) {

    if (backup.autoModerationRules.length === 0) return;

    const roles = await limiter.schedule({ id: "loadAutoModRules::guild.roles.fetch" }, () => guild.roles.fetch());
    const channels = await limiter.schedule({ id: "loadAutoModRules::guild.channels.fetch" }, () => guild.channels.fetch());

    const totalRules = backup.autoModerationRules.length;
    let savedRules = 0;

    for (const autoModRule of backup.autoModerationRules) {
        const info = `Restored AutoMod Rule: ${autoModRule.name} (ID: ${autoModRule.id})`

        let actions = [];
        for (const action of autoModRule.actions) {
            let copyAction = JSON.parse(JSON.stringify(action));
            if (action.metadata.channelName) {
                const filteredFirstChannel = channels.filter(channel => channel.name === action.metadata.channelName && backup.channelMap[action.metadata.channelId] === channel).first();
                if (filteredFirstChannel) {
                    copyAction.metadata.channel = filteredFirstChannel.id;
                    copyAction.metadata.channelName = null;
                    actions.push(copyAction);
                }
            } else {
                copyAction.metadata.channel = null;
                copyAction.metadata.channelName = null;
                actions.push(copyAction);
            }
        }

        const data = {
            name: autoModRule.name,
            eventType: autoModRule.eventType,
            triggerType: autoModRule.triggerType,
            triggerMetadata: autoModRule.triggerMetadata,
            actions: actions,
            enabled: autoModRule.enabled,
            exemptRoles: autoModRule.exemptRoles?.map((exemptRole) => {
                const filteredFirstRole = roles.filter(role => role.name === exemptRole.name && backup.roleMap[exemptRole.id] === role).first();
                if (filteredFirstRole) return filteredFirstRole.id;
            }),
            exemptChannels: autoModRule.exemptChannels?.map((exemptChannel) => {
                const filteredFirstChannel = channels.filter(channel => channel.name === exemptChannel.name && backup.channelMap[exemptChannel.id] === channel).first();
                if (filteredFirstChannel) return filteredFirstChannel.id;
            }),
        };

        await limiter.schedule({ id: "loadAutoModRules::guild.autoModerationRules.create" }, () => guild.autoModerationRules.create(data));
        savedRules++;
        await logStatus("AutoMod Rules", savedRules, totalRules, options, info);
    }

}

/* restore the afk configuration */
export async function loadAFk(guild, backup, limiter, options) {

    const totalAFKTasks = backup.afk ? 2 : 0; // 2 tasks: set AFK channel and timeout
    let completedAFKTasks = 0;

    if (backup.afk) {
        try {
            await limiter.schedule({ id: "loadAFK::guild.setAFKChannel" }, () => guild.setAFKChannel(guild.channels.cache.find((channel) => channel.name == backup.afk.name && channel.type == ChannelType.GuildVoice)));
            completedAFKTasks++;
            const infoChannel = `Set AFK Channel to: ${backup.afk.name}`;
            await logStatus("AFK Settings", completedAFKTasks, totalAFKTasks, options, infoChannel);

            await limiter.schedule({ id: "loadAFK::guild.setAFKTimeout" }, () => guild.setAFKTimeout(backup.afk.timeout));
            completedAFKTasks++;
            const infoTimeout = `Set AFK Timeout to: ${backup.afk.timeout} seconds`;
            await logStatus("AFK Settings", completedAFKTasks, totalAFKTasks, options, infoTimeout);
        } catch (error) {
            console.error(error.message);
        }
    }

}

/* restore guild emojis */
export async function loadEmojis(guild, backup, limiter, options) {

    const totalEmojis = backup.emojis.length;
    let savedEmojis = 0;

    for (let emoji of backup.emojis) {
        try {
            const info = `Restored Emoji: ${emoji.name}`
            if (emoji.url) {
                await limiter.schedule({ id: `loadEmojis::guild.emojis.create::${emoji.name}` }, () => guild.emojis.create({ name: emoji.name, attachment: emoji.url }));
            } else if (emoji.base64) {
                await limiter.schedule({ id: `loadEmojis::guild.emojis.create::${emoji.name}` }, () => guild.emojis.create({ name: emoji.name, attachment: Buffer.from(emoji.base64, "base64") }));
            }
            savedEmojis++;
            await logStatus("Emojis", savedEmojis, totalEmojis, options, info);
        } catch (error) {
            console.error(error.message);
        }
    }

}

/* restore guild bans */
export async function loadBans(guild, backup, limiter, options) {

    const totalBans = backup.bans.length;
    let savedBans = 0;

    for (let ban of backup.bans) {
        try {
            const info = `Restored Ban: User ID: ${ban.id}`
            await limiter.schedule({ id: `loadBans::guild.members.ban::${ban.id}` }, () => guild.members.ban(ban.id, { reason: ban.reason }));
            savedBans++;
            await logStatus("Bans", savedBans, totalBans, options, info);
        } catch (error) {
            console.error(error.message);
        }
    }

}

/* restore embedChannel configuration */
export async function loadEmbedChannel(guild, backup, limiter, options) {

    const totalEmbedTasks = backup.widget.channel ? 1 : 0;
    let completedEmbedTasks = 0;

    if (backup.widget.channel) {
        try {
            const info = `Restored Embed Channel: ${backup.widget.channel}`
            await limiter.schedule({ id: "loadEmbedChannel::guild.setWidgetSettings" }, () => guild.setWidgetSettings({
                enabled: backup.widget.enabled,
                channel: guild.channels.cache.find((channel) => channel.name == backup.widget.channel)
            }));
            completedEmbedTasks++;
            await logStatus("Embed Channel", completedEmbedTasks, totalEmbedTasks, options, info);
        } catch (error) {
            console.error(error.message);
        }
    }
    
}

/* restore the guild settings (final part, which requires everything else already restored) */
export async function loadFinalSettings(guild, backup, limiter, options) {

    const totalFinalTasks = backup.systemChannel ? 2 : 0; // 2 tasks for system channel and boost bar
    let completedFinalTasks = 0;

    // System Channel:
    if (backup.systemChannel) {
        const channels = await limiter.schedule({ id: "loadFinalSettings::guild.channels.fetch" }, () => guild.channels.fetch());
        const filteredFirstChannel = channels.filter(channel => channel.name === backup.systemChannel.name).first();

        await limiter.schedule({ id: "loadFinalSettings::guild.setSystemChannel" }, () => guild.setSystemChannel(filteredFirstChannel));
        completedFinalTasks++;
        const infoSystemChannel = `Restored System Channel: ${backup.systemChannel.name}`;
        await logStatus("Final Settings", completedFinalTasks, totalFinalTasks, options, infoSystemChannel);

        await limiter.schedule({ id: "loadFinalSettings::guild.setSystemChannelFlags" }, () => guild.setSystemChannelFlags(backup.systemChannel.flags));
        completedFinalTasks++;
        const infoSystemChannelFlags = `Restored System Channel Flags for: ${backup.systemChannel.name}`;
        await logStatus("Final Settings", completedFinalTasks, totalFinalTasks, options, infoSystemChannelFlags);
    }

    // Boost Progress Bar:
    if (backup.premiumProgressBarEnabled) {
        const infoBoostBar = "Restored Premium Progress Bar";
        await limiter.schedule({ id: "loadFinalSettings::guild.setPremiumProgressBarEnabled" }, () => guild.setPremiumProgressBarEnabled(backup.premiumProgressBarEnabled));
        completedFinalTasks++
        await logStatus("Final Settings", completedFinalTasks, totalFinalTasks, options, infoBoostBar);
    }

}

/* restore role assignments to members */
export async function assignRolesToMembers(guild, backup, limiter, options) {

    const members = await limiter.schedule({ id: "assignRolesToMembers::guild.members.fetch" }, () => guild.members.fetch());
    const totalMembers = backup.members.length;
    let processedMembers = 0;

    for (let backupMember of backup.members) {
        if (!backupMember.bot) { // Ignore bots
            const member = members.get(backupMember.userId);
            if (member) { // Backed up member exists in our new guild
                const roles = backupMember.roles.map((oldRoleId) => {
                    const newRole = backup.roleMap[oldRoleId];
                    return newRole ? newRole.id : null;
                }).filter(roleId => !member.roles.cache.has(roleId)); // Exclude roles the member already has

                if (roles.length > 0) {
                    const info = `Restored Roles for Member: ${member.user.tag} (ID: ${member.user.id})`;
                    await limiter.schedule({ id: `assignRolesToMembers::member.edit::${member.id}` }, () => member.edit({ roles: roles }));

                    // Log the status update with the info
                    await logStatus("Assigning Roles", processedMembers + 1, totalMembers, options, info);
                }
            }
        }
        processedMembers++;
    }
    
}

export default {
    loadConfig,
    loadRoles,
    toLoadloadChannels,
    doNotLoadloadChannels,
    loadAutoModRules,
    loadAFk,
    loadEmojis,
    loadBans,
    loadEmbedChannel,
    loadFinalSettings,
    assignRolesToMembers
};
