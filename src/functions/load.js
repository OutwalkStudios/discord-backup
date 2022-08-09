import { GuildFeature } from "discord.js";
import { loadCategory, loadChannel } from "../utils";

/* restores the guild configuration */
export function loadConfig(guild, backup, rateLimitManager) {
    const promises = [];

    if (backup.name) {
        promises.push([guild, "setName", backup.name]);
    }

    if (backup.iconBase64) {
        promises.push([guild, "setIcon", Buffer.from(backup.iconBase64, "base64")]);
    } else if (backup.iconURL) {
        promises.push([guild, "setIcon", backup.iconURL]);
    }

    if (backup.splashBase64) {
        promises.push([guild, "setSplash", Buffer.from(backup.splashBase64, "base64")]);
    } else if (backup.splashURL) {
        promises.push([guild, "setSplash", backup.splashURL]);
    }

    if (backup.bannerBase64) {
        promises.push([guild, "setBanner", Buffer.from(backup.bannerBase64, "base64")]);
    } else if (backup.bannerURL) {
        promises.push([guild, "setBanner", backup.bannerURL]);
    }

    if (backup.verificationLevel) {
        promises.push([guild, "setVerificationLevel", backup.verificationLevel]);
    }

    if (backup.defaultMessageNotifications) {
        promises.push([guild, "setDefaultMessageNotifications", backup.defaultMessageNotifications]);
    }

    const changeableExplicitLevel = guild.features.includes(GuildFeature.Community);
    if (backup.explicitContentFilter && changeableExplicitLevel) {
        promises.push([guild, "setExplictContentFilter", backup.explicitContentFilter]);
    }

    return rateLimitManager.resolver(promises);
}

/* restore the guild roles */
export async function loadRoles(guild, backup, rateLimitManager) {
    const promises = [];

    for (let role of backup.roles) {
        if (role.isEveryone) {
            promises.push([guild.roles, "edit", guild.roles.everyone, {
                permissions: BigInt(role.permissions),
                mentionable: role.mentionable
            }]);
        } else {
            promises.push([guild.roles, "create", {
                name: role.name,
                color: role.color,
                hoist: role.hoist,
                permissions: BigInt(role.permissions),
                mentionable: role.mentionable
            }]);
        }
    }

    return rateLimitManager.resolver(promises);
}

/* restore the guild channels */
export function loadChannels(guild, backup, options, rateLimitManager) {
    const promises = [];

    for (let category of backup.channels.categories) {
        promises.push([async () => await new Promise(async (resolve) => {
            const createdCategory = await loadCategory(category, guild, rateLimitManager);

            for (let channel of category.children) {
                await loadChannel(channel, guild, createdCategory, options, rateLimitManager);
            }

            resolve();
        }), null]);
    }

    for (let channel of backup.channels.others) {
        promises.push([loadChannel, null, channel, guild, null, options, rateLimitManager]);
    }

    return rateLimitManager.resolver(promises);

}

/* restore the afk configuration */
export function loadAFk(guild, backup, rateLimitManager) {
    const promises = [];

    if (backup.afk) {
        promises.push([guild, "setAFKChannel", guild.channels.cache.find((channel) => channel.name == backup.afk.name && channel.type == ChannelType.GuildVoice)]);
        promises.push([guild, "setAFKTimeout", backup.afk.timeout]);
    }

    return rateLimitManager.resolver(promises);
}

/* restore guild emojis */
export function loadEmojis(guild, backup, rateLimitManager) {
    const promises = [];

    for (let emoji of backup.emojis) {
        if (emoji.url) {
            promises.push([guild.emojis, "create", { name: emoji.name, attachment: emoji.url }]);
        } else if (emoji.base64) {
            promises.push([guild.emojis, "create", { name: emoji.name, attachment: Buffer.from(emoji.base64, "base64") }]);
        }
    }

    return rateLimitManager.resolver(promises);
}

/* restore guild bans */
export function loadBans(guild, backup, rateLimitManager) {
    const promises = [];

    for (let ban of backup.bans) {
        promises.push([guild.members, "ban", ban.id, { reason: ban.reason }]);
    }

    return rateLimitManager.resolver(promises);
}

/* restore embedChannel configuraion */
export function loadEmbedChannel(guild, backup, rateLimitManager) {
    const promises = [];

    if (backup.widget.channel) {
        promises.push([guild, "setWidgetSettings", {
            enabled: backup.widget.enabled,
            channel: guild.channels.cache.find((channel) => channel.name == backup.widget.channel)
        }]);
    }

    return rateLimitManager.resolver(promises);
}

export default {
    loadConfig,
    loadRoles,
    loadChannels,
    loadAFk,
    loadEmojis,
    loadBans,
    loadEmbedChannel
};