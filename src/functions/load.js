import { GuildFeature, ChannelType } from "discord.js";
import { loadCategory, loadChannel, logProgress } from "../utils";

/* restores the guild configuration */
export async function loadConfig(guild, backup, limiter) {
    // Log
    let state = { status: "Restoring Config..." };
    console.log(state.status);

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

    if (backup.name) {
        console.log(`Restoring Config: Setting Name to ${backup.name}`);
        await limiter.schedule({ id: "loadConfig::guild.setName" }, () => guild.setName(backup.name));
        logProgress("Setting Name", ++completedTasks, tasks.length);
    }

    if (backup.iconBase64) {
        console.log("Restoring Config: Setting Icon (Base64)");
        await limiter.schedule({ id: "loadConfig::guild.setIcon" }, () => guild.setIcon(Buffer.from(backup.iconBase64, "base64")));
        logProgress("Setting Icon (Base64)", ++completedTasks, tasks.length);
    } else if (backup.iconURL) {
        console.log("Restoring Config: Setting Icon (URL)");
        await limiter.schedule({ id: "loadConfig::guild.setIcon" }, () => guild.setIcon(backup.iconURL));
        logProgress("Setting Icon (URL)", ++completedTasks, tasks.length);
    }

    if (backup.splashBase64) {
        console.log("Restoring Config: Setting Splash (Base64)");
        await limiter.schedule({ id: "loadConfig::guild.setSplash" }, () => guild.setSplash(Buffer.from(backup.splashBase64, "base64")));
        logProgress("Setting Splash (Base64)", ++completedTasks, tasks.length);
    } else if (backup.splashURL) {
        console.log("Restoring Config: Setting Splash (URL)");
        await limiter.schedule({ id: "loadConfig::guild.setSplash" }, () => guild.setSplash(backup.splashURL));
        logProgress("Setting Splash (URL)", ++completedTasks, tasks.length);
    }

    if (backup.bannerBase64) {
        console.log("Restoring Config: Setting Banner (Base64)");
        await limiter.schedule({ id: "loadConfig::guild.setBanner" }, () => guild.setBanner(Buffer.from(backup.bannerBase64, "base64")));
        logProgress("Setting Banner (Base64)", ++completedTasks, tasks.length);
    } else if (backup.bannerURL) {
        console.log("Restoring Config: Setting Banner (URL)");
        await limiter.schedule({ id: "loadConfig::guild.setBanner" }, () => guild.setBanner(backup.bannerURL));
        logProgress("Setting Banner (URL)", ++completedTasks, tasks.length);
    }

    if (backup.verificationLevel) {
        console.log(`Restoring Config: Setting Verification Level to ${backup.verificationLevel}`);
        await limiter.schedule({ id: "loadConfig::guild.setVerificationLevel" }, () => guild.setVerificationLevel(backup.verificationLevel));
        logProgress("Setting Verification Level", ++completedTasks, tasks.length);
    }

    if (backup.defaultMessageNotifications) {
        console.log(`Restoring Config: Setting Default Message Notifications to ${backup.defaultMessageNotifications}`);
        await limiter.schedule({ id: "loadConfig::guild.setDefaultMessageNotifications" }, () => guild.setDefaultMessageNotifications(backup.defaultMessageNotifications));
        logProgress("Setting Default Message Notifications", ++completedTasks, tasks.length);
    }

    const changeableExplicitLevel = guild.features.includes(GuildFeature.Community);
    if (backup.explicitContentFilter && changeableExplicitLevel) {
        console.log(`Restoring Config: Setting Explicit Content Filter to ${backup.explicitContentFilter}`);
        await limiter.schedule({ id: "loadConfig::guild.setExplicitContentFilter" }, () => guild.setExplicitContentFilter(backup.explicitContentFilter));
        logProgress("Setting Explicit Content Filter", ++completedTasks, tasks.length);
    }

    // Role and channel maps which will get populated later (internal use only):
    backup.roleMap = {};
    backup.channelMap = {};

    // Log
    state.status = "Done.";
    console.log(state.status);
}

/* restore the guild roles */
export async function loadRoles(guild, backup, limiter) {
    // Log
    let state = { status: "Restoring Roles..." };
    console.log(state.status);

    const totalRoles = backup.roles.length;
    let savedRoles = 0;

    for (let role of backup.roles) {
        try {
            if (role.isEveryone) {
                console.log("Restoring Role: @everyone");
                await limiter.schedule({ id: `loadRoles::guild.roles.edit::everyone` }, () => guild.roles.edit(guild.roles.everyone, {
                    permissions: BigInt(role.permissions),
                    mentionable: role.mentionable
                }));
                backup.roleMap[role.oldId] = guild.roles.everyone;
            } else {
                console.log(`Restoring Role: ${role.name} (ID: ${role.oldId})`);
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
            logProgress("Roles", savedRoles, totalRoles); // Progress tracking for roles
        } catch (error) {
            console.error(error.message);
        }
    }

    // Log
    state.status = "Done.";
    console.log(state.status);
}

/* restore the guild channels */
export async function loadChannels(guild, backup, options, limiter) {
    // Log
    let state = { status: "Restoring Channels..." };
    console.log(state.status);

    const totalChannels = backup.channels.categories.reduce((acc, category) => acc + category.children.length, 0) + backup.channels.others.length;
    let savedChannels = 0;

    // Restoring categories and their child channels
    for (let category of backup.channels.categories) {
        const createdCategory = await loadCategory(category, guild, limiter);

        for (let channel of category.children) {
            try {
                console.log(`Restoring Channel: ${channel.name} (Category: ${category.name})`);  // Log before restoring the channel
                const createdChannel = await loadChannel(channel, guild, createdCategory, options, limiter);
                if (createdChannel) {
                    backup.channelMap[channel.oldId] = createdChannel;
                    savedChannels++;
                    logProgress("Channels", savedChannels, totalChannels); // Progress tracking for each channel
                }
            } catch (error) {
                console.error(`Error restoring channel ${channel.name}: ${error.message}`);
            }
        }
    }


    // Restoring non-categorized channels
    for (let channel of backup.channels.others) {
        try {
            console.log(`Restoring Channel: ${channel.name}`);  // Log before restoring the channel
            const createdChannel = await loadChannel(channel, guild, null, options, limiter);
            if (createdChannel) {
                backup.channelMap[channel.oldId] = createdChannel;
                savedChannels++;
                logProgress("Channels", savedChannels, totalChannels); // Progress tracking for each channel
            }
        } catch (error) {
            console.error(`Error restoring channel ${channel.name}: ${error.message}`);
        }
    }

    // Ensure progress doesn't exceed the total number of channels
    if (savedChannels > totalChannels) {
        console.warn(`Saved channels (${savedChannels}) exceeded total channels (${totalChannels}). Resetting progress.`);
        savedChannels = totalChannels;
        logProgress("Channels", savedChannels, totalChannels);
    }

    // Log
    state.status = "Done.";
    console.log(state.status);
}

/* restore the automod rules */
export async function loadAutoModRules(guild, backup, limiter) {
    // Log
    let state = { status: "Restoring AutoMod Rules..." };
    console.log(state.status);

    if (backup.autoModerationRules.length === 0) return;

    const roles = await limiter.schedule({ id: "loadAutoModRules::guild.roles.fetch" }, () => guild.roles.fetch());
    const channels = await limiter.schedule({ id: "loadAutoModRules::guild.channels.fetch" }, () => guild.channels.fetch());

    const totalRules = backup.autoModerationRules.length;
    let savedRules = 0;

    for (const autoModRule of backup.autoModerationRules) {
        console.log(`Restoring AutoMod Rule: ${autoModRule.name} (ID: ${autoModRule.id})`);

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
        logProgress("AutoMod Rules", savedRules, totalRules); // Progress tracking for rules
    }

    // Log
    state.status = "Done.";
    console.log(state.status);
}

/* restore the afk configuration */
export async function loadAFk(guild, backup, limiter) {
    // Log
    let state = { status: "Restoring AFK Config..." };
    console.log(state.status);

    const totalAFKTasks = backup.afk ? 2 : 0; // 2 tasks: set AFK channel and timeout
    let completedAFKTasks = 0;

    if (backup.afk) {
        try {
            await limiter.schedule({ id: "loadAFK::guild.setAFKChannel" }, () => guild.setAFKChannel(guild.channels.cache.find((channel) => channel.name == backup.afk.name && channel.type == ChannelType.GuildVoice)));
            completedAFKTasks++;
            logProgress("AFK Settings", completedAFKTasks, totalAFKTasks);

            await limiter.schedule({ id: "loadAFK::guild.setAFKTimeout" }, () => guild.setAFKTimeout(backup.afk.timeout));
            completedAFKTasks++;
            logProgress("AFK Settings", completedAFKTasks, totalAFKTasks);
        } catch (error) {
            console.error(error.message);
        }
    }

    // Log
    state.status = "Done.";
    console.log(state.status);
}

/* restore guild emojis */
export async function loadEmojis(guild, backup, limiter) {
    // Log
    let state = { status: "Restoring Emojis..." };
    console.log(state.status);

    const totalEmojis = backup.emojis.length;
    let savedEmojis = 0;

    for (let emoji of backup.emojis) {
        try {
            console.log(`Restoring Emoji: ${emoji.name}`);
            if (emoji.url) {
                await limiter.schedule({ id: `loadEmojis::guild.emojis.create::${emoji.name}` }, () => guild.emojis.create({ name: emoji.name, attachment: emoji.url }));
            } else if (emoji.base64) {
                await limiter.schedule({ id: `loadEmojis::guild.emojis.create::${emoji.name}` }, () => guild.emojis.create({ name: emoji.name, attachment: Buffer.from(emoji.base64, "base64") }));
            }
            savedEmojis++;
            logProgress("Emojis", savedEmojis, totalEmojis); // Progress tracking for emojis
        } catch (error) {
            console.error(error.message);
        }
    }

    // Log
    state.status = "Done.";
    console.log(state.status);
}

/* restore guild bans */
export async function loadBans(guild, backup, limiter) {
    // Log
    let state = { status: "Restoring Bans..." };
    console.log(state.status);

    const totalBans = backup.bans.length;
    let savedBans = 0;

    for (let ban of backup.bans) {
        try {
            console.log(`Restoring Ban: User ID: ${ban.id}`);
            await limiter.schedule({ id: `loadBans::guild.members.ban::${ban.id}` }, () => guild.members.ban(ban.id, { reason: ban.reason }));
            savedBans++;
            logProgress("Bans", savedBans, totalBans); // Progress tracking for bans
        } catch (error) {
            console.error(error.message);
        }
    }

    // Log
    state.status = "Done.";
    console.log(state.status);
}

/* restore embedChannel configuration */
export async function loadEmbedChannel(guild, backup, limiter) {
    // Log
    let state = { status: "Restoring embedChannel Config..." };
    console.log(state.status);

    const totalEmbedTasks = backup.widget.channel ? 1 : 0;
    let completedEmbedTasks = 0;

    if (backup.widget.channel) {
        try {
            console.log(`Restoring Embed Channel: ${backup.widget.channel}`);
            await limiter.schedule({ id: "loadEmbedChannel::guild.setWidgetSettings" }, () => guild.setWidgetSettings({
                enabled: backup.widget.enabled,
                channel: guild.channels.cache.find((channel) => channel.name == backup.widget.channel)
            }));
            completedEmbedTasks++;
            logProgress("Embed Channel", completedEmbedTasks, totalEmbedTasks);
        } catch (error) {
            console.error(error.message);
        }
    }
    
    // Log
    state.status = "Done.";
    console.log(state.status);
}

/* restore the guild settings (final part, which requires everything else already restored) */
export async function loadFinalSettings(guild, backup, limiter) {
    // Log
    let state = { status: "Restoring Server Settings..." };
    console.log(state.status);

    const totalFinalTasks = backup.systemChannel ? 2 : 0; // 2 tasks for system channel and boost bar
    let completedFinalTasks = 0;

    // System Channel:
    if (backup.systemChannel) {
        console.log(`Restoring System Channel: ${backup.systemChannel.name}`);
        const channels = await limiter.schedule({ id: "loadFinalSettings::guild.channels.fetch" }, () => guild.channels.fetch());
        const filteredFirstChannel = channels.filter(channel => channel.name === backup.systemChannel.name).first();

        await limiter.schedule({ id: "loadFinalSettings::guild.setSystemChannel" }, () => guild.setSystemChannel(filteredFirstChannel));
        completedFinalTasks++;
        logProgress("Final Settings", completedFinalTasks, totalFinalTasks);

        await limiter.schedule({ id: "loadFinalSettings::guild.setSystemChannelFlags" }, () => guild.setSystemChannelFlags(backup.systemChannel.flags));
        completedFinalTasks++;
        logProgress("Final Settings", completedFinalTasks, totalFinalTasks);
    }

    // Boost Progress Bar:
    if (backup.premiumProgressBarEnabled) {
        console.log("Restoring Premium Progress Bar");
        await limiter.schedule({ id: "loadFinalSettings::guild.setPremiumProgressBarEnabled" }, () => guild.setPremiumProgressBarEnabled(backup.premiumProgressBarEnabled));
    }
    
    // Log
    state.status = "Done.";
    console.log(state.status);
}

/* restore role assignments to members */
export async function assignRolesToMembers(guild, backup, limiter) {
    // Log
    let state = { status: "Restoring Roles..." };
    console.log(state.status);

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
                    console.log(`Restoring Roles for Member: ${member.user.tag} (ID: ${member.user.id})`);
                    await limiter.schedule({ id: `assignRolesToMembers::member.edit::${member.id}` }, () => member.edit({ roles: roles }));
                }
            }
        }
        processedMembers++;
        logProgress("Assigning Roles", processedMembers, totalMembers); // Progress tracking for members
    }
    
    // Log
    state.status = "Done.";
    console.log(state.status);
}

export default {
    loadConfig,
    loadRoles,
    loadChannels,
    loadAutoModRules,
    loadAFk,
    loadEmojis,
    loadBans,
    loadEmbedChannel,
    loadFinalSettings,
    assignRolesToMembers
};
