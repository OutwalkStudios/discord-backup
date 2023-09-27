import { GuildFeature, ChannelType } from "discord.js";
import { loadCategory, loadChannel } from "../utils";

/* restores the guild configuration */
export async function loadConfig(guild, backup, limiter) {
    if (backup.name) {
        await limiter.schedule({ id: "guild.setName" }, () => guild.setName(backup.name));
    }

    if (backup.iconBase64) {
        await limiter.schedule({ id: "guild.setIcon" }, () => guild.setIcon(Buffer.from(backup.iconBase64, "base64")));
    } else if (backup.iconURL) {
        await limiter.schedule({ id: "guild.setIcon" }, () => guild.setIcon(backup.iconURL));
    }

    if (backup.splashBase64) {
        await limiter.schedule({ id: "guild.setSplash" }, () => guild.setSplash(Buffer.from(backup.splashBase64, "base64")));
    } else if (backup.splashURL) {
        await limiter.schedule({ id: "guild.setSplash" }, () => guild.setSplash(backup.splashURL));
    }

    if (backup.bannerBase64) {
        await limiter.schedule({ id: "guild.setBanner" }, () => guild.setBanner(Buffer.from(backup.bannerBase64, "base64")));
    } else if (backup.bannerURL) {
        await limiter.schedule({ id: "guild.setBanner" }, () => guild.setBanner(backup.bannerURL));
    }

    if (backup.verificationLevel) {
        await limiter.schedule({ id: "guild.setVerificationLevel" }, () => guild.setVerificationLevel(backup.verificationLevel));
    }

    if (backup.defaultMessageNotifications) {
        await limiter.schedule({ id: "guild.setDefaultMessageNotifications" }, () => guild.setDefaultMessageNotifications(backup.defaultMessageNotifications));
    }

    const changeableExplicitLevel = guild.features.includes(GuildFeature.Community);
    if (backup.explicitContentFilter && changeableExplicitLevel) {
        await limiter.schedule({ id: "guild.setExplicitContentFilter" }, () => guild.setExplicitContentFilter(backup.explicitContentFilter));
    }

    // Role and channel maps which will get populated later (internal use only):
    backup.roleMap = {};
    backup.channelMap = {};
}

/* restore the guild roles */
export async function loadRoles(guild, backup, limiter) {
    for (let role of backup.roles) {
        try {
            if (role.isEveryone) {
                await limiter.schedule({ id: "guild.roles.edit" }, () => guild.roles.edit(guild.roles.everyone, {
                    permissions: BigInt(role.permissions),
                    mentionable: role.mentionable
                }));

                backup.roleMap[role.oldId] = guild.roles.everyone;
            } else {
                const createdRole = await limiter.schedule({ id: "guild.roles.create" }, () => guild.roles.create({
                    name: role.name,
                    color: role.color,
                    hoist: role.hoist,
                    permissions: BigInt(role.permissions),
                    mentionable: role.mentionable
                }));

                backup.roleMap[role.oldId] = createdRole;
            }
        } catch (error) {
            console.error(error.message);
        }
    }
}

/* restore the guild channels */
export async function loadChannels(guild, backup, options, limiter) {
    for (let category of backup.channels.categories) {
        const createdCategory = await loadCategory(category, guild, limiter);

        for (let channel of category.children) {
            const createdChannel = await loadChannel(channel, guild, createdCategory, options, limiter);
            if (createdChannel) backup.channelMap[channel.oldId] = createdChannel;
        }
    }

    for (let channel of backup.channels.others) {
        const createdChannel = await loadChannel(channel, guild, null, options, limiter);
        if (createdChannel) backup.channelMap[channel.oldId] = createdChannel;
    }
}

/* restore the automod rules */
export async function loadAutoModRules(guild, backup, limiter) {
    if (backup.autoModerationRules.length === 0) return;

    const roles = await limiter.schedule({ id: "guild.roles.fetch" }, () => guild.roles.fetch());
    const channels = await limiter.schedule({ id: "guild.channels.fetch" }, () => guild.channels.fetch());

    for (const autoModRule of backup.autoModerationRules) {
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

        await limiter.schedule({ id: "guild.autoModerationRules.create" }, () => guild.autoModerationRules.create(data));
    }
}

/* restore the afk configuration */
export async function loadAFk(guild, backup, limiter) {
    if (backup.afk) {
        try {
            await limiter.schedule({ id: "guild.setAFKChannel" }, () => guild.setAFKChannel(guild.channels.cache.find((channel) => channel.name == backup.afk.name && channel.type == ChannelType.GuildVoice)));
            await limiter.schedule({ id: "guild.setAFKTimeout" }, () => guild.setAFKTimeout(backup.afk.timeout));
        } catch (error) {
            console.error(error.message);
        }

    }
}

/* restore guild emojis */
export async function loadEmojis(guild, backup, limiter) {
    for (let emoji of backup.emojis) {
        try {
            if (emoji.url) {
                await limiter.schedule({ id: "guild.emojis.create" }, () => guild.emojis.create({ name: emoji.name, attachment: emoji.url }));
            } else if (emoji.base64) {
                await limiter.schedule({ id: "guild.emojis.create" }, () => guild.emojis.create({ name: emoji.name, attachment: Buffer.from(emoji.base64, "base64") }));
            }
        } catch (error) {
            console.error(error.message);
        }
    }
}

/* restore guild bans */
export async function loadBans(guild, backup, limiter) {
    for (let ban of backup.bans) {
        try {
            await limiter.schedule({ id: "guild.members.ban" }, () => guild.members.ban(ban.id, { reason: ban.reason }));
        } catch (error) {
            console.error(error.message);
        }
    }
}

/* restore embedChannel configuraion */
export async function loadEmbedChannel(guild, backup, limiter) {
    if (backup.widget.channel) {
        try {
            await limiter.schedule({ id: "guild.setWidgetSettings" }, () => guild.setWidgetSettings({
                enabled: backup.widget.enabled,
                channel: guild.channels.cache.find((channel) => channel.name == backup.widget.channel)
            }));
        } catch (error) {
            console.error(error.message);
        }
    }
}

/* restore the guild settings (final part, which requires everything else already restored) */
export async function loadFinalSettings(guild, backup, limiter) {
    // System Channel:
    if (backup.systemChannel) {
        const channels = await limiter.schedule({ id: "guild.channels.fetch" }, () => guild.channels.fetch());
        const filteredFirstChannel = channels.filter(channel => channel.name === backup.systemChannel.name).first();

        await limiter.schedule({ id: "guild.setSystemChannel" }, () => guild.setSystemChannel(filteredFirstChannel));
        await limiter.schedule({ id: "guild.setSystemChannelFlags" }, () => guild.setSystemChannelFlags(backup.systemChannel.flags));
    }

    // Boost Progress Bar:
    if (backup.premiumProgressBarEnabled) {
        await limiter.schedule({ id: "guild.setPremiumProgressBarEnabled" }, () => guild.setPremiumProgressBarEnabled(backup.premiumProgressBarEnabled));
    }
}

/* restore role assignments to members */
export async function assignRolesToMembers(guild, backup, limiter) {
    const members = await limiter.schedule({ id: "guild.members.fetch" }, () => guild.members.fetch());

    for (let backupMember of backup.members) {
        if (!backupMember.bot) { // Ignore bots
            const member = members.get(backupMember.userId);
            if (member) { // Backed up member exists in our new guild
                const roles = backupMember.roles.map((oldRoleId) => {
                    const newRole = backup.roleMap[oldRoleId];
                    return newRole ? newRole.id : null;
                });

                await limiter.schedule({ id: "member.edit" }, () => member.edit({ roles: roles }));
            }
        }
    }
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