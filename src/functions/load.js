import { GuildFeature } from "discord.js";
import { loadCategory, loadChannel } from "../utils";

/* restores the guild configuration */
export async function loadConfig(guild, backup, limiter) {

    if (backup.name) {
        await limiter.schedule(() => guild.setName(backup.name));
    }

    if (backup.iconBase64) {
        await limiter.schedule(() => guild.setIcon(Buffer.from(backup.iconBase64, "base64")));
    } else if (backup.iconURL) {
        await limiter.schedule(() => guild.setIcon(backup.iconURL));
    }

    if (backup.splashBase64) {
        await limiter.schedule(() => guild.setSplash(Buffer.from(backup.splashBase64, "base64")));
    } else if (backup.splashURL) {
        await limiter.schedule(() => guild.setSplash(backup.splashURL));
    }

    if (backup.bannerBase64) {
        await limiter.schedule(() => guild.setBanner(Buffer.from(backup.bannerBase64, "base64")));
    } else if (backup.bannerURL) {
        await limiter.schedule(() => guild.setBanner(backup.bannerURL));
    }

    if (backup.verificationLevel) {
        await limiter.schedule(() => guild.setVerificationLevel(backup.verificationLevel));
    }

    if (backup.defaultMessageNotifications) {
        await limiter.schedule(() => guild.setDefaultMessageNotifications(backup.defaultMessageNotifications))
    }

    const changeableExplicitLevel = guild.features.includes(GuildFeature.Community);
    if (backup.explicitContentFilter && changeableExplicitLevel) {
        await limiter.schedule(() => guild.setExplicitContentFilter(backup.explicitContentFilter));
    }
}

/* restore the guild roles */
export async function loadRoles(guild, backup, limiter) {
    for (let role of backup.roles) {
        if (role.isEveryone) {
            await limiter.schedule(() => guild.roles.edit(guild.roles.everyone, {
                permissions: BigInt(role.permissions),
                mentionable: role.mentionable
            }));
        } else {
            await limiter.schedule(() => guild.roles.create({
                name: role.name,
                color: role.color,
                hoist: role.hoist,
                permissions: BigInt(role.permissions),
                mentionable: role.mentionable
            }));
        }
    }
}

/* restore the guild channels */
export async function loadChannels(guild, backup, options, limiter) {
    for (let category of backup.channels.categories) {
        const createdCategory = await loadCategory(category, guild, limiter);

        for (let channel of category.children) {
            await loadChannel(channel, guild, createdCategory, options, limiter);
        }
    }

    for (let channel of backup.channels.others) {
        await loadChannel(channel, guild, null, options, limiter);
    }
}

/* restore the afk configuration */
export async function loadAFk(guild, backup, limiter) {
    if (backup.afk) {
        await limiter.schedule(() => guild.setAFKChannel(guild.channels.cache.find((channel) => channel.name == backup.afk.name && channel.type == ChannelType.GuildVoice)));
        await limiter.schedule(() => guild.setAFKTimeout(backup.afk.timeout));
    }
}

/* restore guild emojis */
export async function loadEmojis(guild, backup, limiter) {
    for (let emoji of backup.emojis) {
        if (emoji.url) {
            await limiter.schedule(() => guild.emojis.create({ name: emoji.name, attachment: emoji.url }));
        } else if (emoji.base64) {
            await limiter.schedule(() => guild.emojis.create({ name: emoji.name, attachment: Buffer.from(emoji.base64, "base64") }))
        }
    }
}

/* restore guild bans */
export async function loadBans(guild, backup, limiter) {
    for (let ban of backup.bans) {
        await limiter.schedule(() => guild.members.ban(ban.id, { reason: ban.reason }));
    }
}

/* restore embedChannel configuraion */
export async function loadEmbedChannel(guild, backup, limiter) {
    if (backup.widget.channel) {
        await limiter.schedule(() => guild.setWidgetSettings({
            enabled: backup.widget.enabled,
            channel: guild.channels.cache.find((channel) => channel.name == backup.widget.channel)
        }));
    }
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