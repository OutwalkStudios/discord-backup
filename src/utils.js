import {
    ChannelType,
    GuildFeature,
    GuildDefaultMessageNotifications,
    GuildExplicitContentFilter,
    GuildVerificationLevel,
    GuildSystemChannelFlags,
    OverwriteType,
    GuildPremiumTier
} from "discord.js";
import axios from "axios";

const MAX_BITRATE_PER_TIER = {
    [GuildPremiumTier.None]: 64000,
    [GuildPremiumTier.Tier1]: 128000,
    [GuildPremiumTier.Tier2]: 256000,
    [GuildPremiumTier.Tier3]: 384000
};

/* gets the permissions for a channel */
export function fetchChannelPermissions(channel) {
    const permissions = [];

    channel.permissionOverwrites.cache
        .filter((permission) => permission.type == OverwriteType.Role)
        .forEach((permission) => {
            const role = channel.guild.roles.cache.get(permission.id);
            if (role) {
                permissions.push({
                    roleName: role.name,
                    allow: permission.allow.bitfield.toString(),
                    deny: permission.deny.bitfield.toString()
                });
            }
        });

    return permissions;
}

/* fetches the voice channel data that is necessary for the backup */
export function fetchVoiceChannelData(channel) {
    return {
        type: ChannelType.GuildVoice,
        name: channel.name,
        bitrate: channel.bitrate,
        userLimit: channel.userLimit,
        parent: channel.parent ? channel.parent.name : null,
        permissions: fetchChannelPermissions(channel)
    };
}

/* fetches the stage channel data that is necessary for the backup */
export async function fetchStageChannelData(channel, options, limiter) {
    const channelData = {
        type: ChannelType.GuildStageVoice,
        name: channel.name,
        nsfw: channel.nsfw,
        rateLimitPerUser: channel.rateLimitPerUser,
        topic: channel.topic,
        bitrate: channel.bitrate,
        userLimit: channel.userLimit,
        parent: channel.parent ? channel.parent.name : null,
        permissions: fetchChannelPermissions(channel),
        messages: []
    };

    try {
        channelData.messages = await fetchChannelMessages(channel, options, limiter);
        return channelData;
    } catch {
        return channelData;
    }
}

/* fetches the messages from a channel */
export async function fetchChannelMessages(channel, options, limiter) {
    const messages = [];

    const messageCount = isNaN(options.maxMessagesPerChannel) ? 10 : options.maxMessagesPerChannel;
    const fetchOptions = { limit: (messageCount < 100) ? messageCount : 100 };

    let lastMessageId;
    let fetchComplete = false;

    while (!fetchComplete) {
        if (lastMessageId) fetchOptions.before = lastMessageId;

        const fetched = await limiter.schedule({ id: `fetchChannelMessages::channel.messages.fetch::${channel.id}` }, () => channel.messages.fetch(fetchOptions));
        if (fetched.size == 0) break;

        lastMessageId = fetched.last().id;

        await Promise.all(fetched.map(async (message) => {
            if (!message.author || messages.length >= messageCount) {
                fetchComplete = true;
                return;
            }

            /* dont save messages that are too long */
            if (message.cleanContent.length > 2000) return;

            const files = await Promise.all(message.attachments.map(async (attachment) => {
                if (attachment.url && ["png", "jpg", "jpeg", "jpe", "jif", "jfif", "jfi"].includes(attachment.url.split(".").pop())) {
                    if (options.saveImages && options.saveImages == "base64") {
                        const response = await axios.get(attachment.url, { responseType: "arraybuffer" });
                        const buffer = Buffer.from(response.data, "binary").toString("base64");

                        return { name: attachment.name, attachment: buffer };
                    }
                }

                return { name: attachment.name, attachment: attachment.url };
            }));

            messages.push({
                oldId: message.id,
                userId: message.author.id,
                username: message.author.username,
                avatar: message.author.displayAvatarURL(),
                content: message.cleanContent,
                embeds: message.embeds,
                components: message.components,
                files: files,
                pinned: message.pinned,
                sentAt: message.createdAt.toISOString()
            });
        }));
    }

    return messages;
}

/* fetches the text channel data that is necessary for the backup */
export async function fetchTextChannelData(channel, options, limiter) {
    const channelData = {
        type: channel.type,
        name: channel.name,
        nsfw: channel.nsfw,
        rateLimitPerUser: channel.type == ChannelType.GuildText ? channel.rateLimitPerUser : undefined,
        parent: channel.parent ? channel.parent.name : null,
        topic: channel.topic,
        permissions: fetchChannelPermissions(channel),
        messages: [],
        isNews: channel.type == ChannelType.GuildAnnouncement,
        threads: []
    };

    if (channel.threads.cache.size > 0) {
        channel.threads.cache.forEach(async (thread) => {
            const threadData = {
                type: thread.type,
                name: thread.name,
                archived: thread.archived,
                autoArchiveDuration: thread.autoArchiveDuration,
                locked: thread.locked,
                rateLimitPerUser: thread.rateLimitPerUser,
                messages: []
            };

            try {
                threadData.messages = await fetchChannelMessages(thread, options, limiter);
                channelData.threads.push(threadData);
            } catch {
                channelData.threads.push(threadData);
            }
        });
    }

    try {
        channelData.messages = await fetchChannelMessages(channel, options, limiter);
        return channelData;
    } catch {
        return channelData;
    }
}

/* creates a category for the guild */
export async function loadCategory(categoryData, guild, limiter) {
    const category = await limiter.schedule({ id: `loadCategory::guild.channels.create::${categoryData.name}` }, () => guild.channels.create({ name: categoryData.name, type: ChannelType.GuildCategory }));
    const finalPermissions = [];

    categoryData.permissions.forEach((permission) => {
        const role = guild.roles.cache.find((role) => role.name == permission.roleName);
        if (role) {
            finalPermissions.push({
                id: role.id,
                allow: BigInt(permission.allow),
                deny: BigInt(permission.deny)
            });
        }
    });

    await limiter.schedule({ id: `loadCategory::category.permissionOverwrites.set::${category.name}` }, () => category.permissionOverwrites.set(finalPermissions));
    return category;
}

/* creates a channel and returns it */
export async function loadChannel(channelData, guild, category, options, limiter) {

    const loadMessages = async (channel, messages, previousWebhook) => {
        const webhook = previousWebhook || await limiter.schedule({ id: `loadMessages::channel.createWebhook::${channel.name}` }, () => channel.createWebhook({ name: "MessagesBackup", avatar: channel.client.user.displayAvatarURL() }));
        if (!webhook) return;

        messages = messages.filter((message) => (message.content.length > 0 || message.embeds.length > 0 || message.files.length > 0)).reverse();

        // Limit the amount of messages to send
        if (options.maxMessagesPerChannel && options.maxMessagesPerChannel < messages.length) {
            messages = messages.slice(messages.length - options.maxMessagesPerChannel);
        }

        for (let message of messages) {
            if (message.content.length > 2000) continue;
            try {
                let sent;
                // Check if the message was sent by the client user
                if (message?.userId == channel.client.user.id) {
                    sent = await limiter.schedule({ id: `loadMessages::channel.send::${channel.name}` }, () => channel.send({
                        content: message.content.length ? message.content : undefined,
                        embeds: message.embeds,
                        components: message.components,
                        files: message.files,
                        allowedMentions: options.allowedMentions
                    }));
                    // Else, send the message as a webhook
                } else {
                    sent = await limiter.schedule({ id: `loadMessages::webhook.send::${channel.name}` }, () => webhook.send({
                        content: message.content.length ? message.content : undefined,
                        username: message.username,
                        avatarURL: message.avatar,
                        embeds: message.embeds,
                        components: message?.components, //Send message components with backwards compatibility
                        files: message.files,
                        allowedMentions: options.allowedMentions,
                        threadId: channel.isThread() ? channel.id : undefined
                    }));

                }

                if (message.pinned && sent) await limiter.schedule({ id: `loadMessages::sent.pin::${channel.name}` }, () => sent.pin());
            } catch (error) {
                /* ignore errors where it request entity is too large */
                if (error.message == "Request entity too large") return;
                console.error(error);
            }
        }

        return webhook;
    };

    const createOptions = { name: channelData.name, type: null, parent: category };

    if (channelData.type == ChannelType.GuildText || channelData.type == ChannelType.GuildAnnouncement) {
        createOptions.topic = channelData.topic;
        createOptions.nsfw = channelData.nsfw;
        createOptions.rateLimitPerUser = channelData.rateLimitPerUser;
        createOptions.type = channelData.isNews && guild.features.includes(GuildFeature.News) ? ChannelType.GuildAnnouncement : ChannelType.GuildText;
    }

    else if (channelData.type == ChannelType.GuildVoice) {
        let bitrate = channelData.bitrate;
        const bitrates = Object.values(MAX_BITRATE_PER_TIER);

        while (bitrate > MAX_BITRATE_PER_TIER[guild.premiumTier]) {
            bitrate = bitrates[guild.premiumTier];
        }

        createOptions.bitrate = bitrate;
        createOptions.userLimit = channelData.userLimit;
        createOptions.type = channelData.type;
    }

    else if (channelData.type == ChannelType.GuildStageVoice) {
        let bitrate = channelData.bitrate;
        const bitrates = Object.values(MAX_BITRATE_PER_TIER);

        while (bitrate > MAX_BITRATE_PER_TIER[guild.premiumTier]) {
            bitrate = bitrates[guild.premiumTier];
        }

        createOptions.topic = channelData.topic;
        createOptions.nsfw = channelData.nsfw;
        createOptions.rateLimitPerUser = channelData.rateLimitPerUser;
        createOptions.bitrate = bitrate;
        createOptions.userLimit = channelData.userLimit;
        createOptions.type = channelData.type;

        /* Stage channels require the server to have Community features. */
        if (!guild.features.includes(GuildFeature.Community)) return null;
    }

    const channel = await limiter.schedule({ id: `loadChannel::guild.channels.create::${channelData.name}` }, () => guild.channels.create(createOptions));
    const finalPermissions = [];

    channelData.permissions.forEach((permission) => {
        const role = guild.roles.cache.find((role) => role.name == permission.roleName);
        if (role) {
            finalPermissions.push({
                id: role.id,
                allow: BigInt(permission.allow),
                deny: BigInt(permission.deny)
            });
        }
    });

    await limiter.schedule({ id: `loadChannel::channel.permissionOverwrites.set::${channel.name}` }, () => channel.permissionOverwrites.set(finalPermissions));

    if (channelData.type == ChannelType.GuildText) {
        let webhook;

        if (channelData.messages.length > 0) {
            webhook = await loadMessages(channel, channelData.messages);
        }

        if (channelData.threads.length > 0) {
            channelData.threads.forEach(async (threadData) => {
                const thread = await limiter.schedule({ id: `loadChannel::channel.threads.create::${threadData.name}` }, () => channel.threads.create({ name: threadData.name, autoArchiveDuration: threadData.autoArchiveDuration }));
                if (webhook) await loadMessages(thread, threadData.messages, webhook);
            });
        }
    }

    else if (channelData.type == ChannelType.GuildStageVoice) {
        if (channelData.messages.length > 0) {
            await loadMessages(channel, channelData.messages);
        }
    }

    return channel;
}

/* delete all roles, channels, emojis, etc of a guild */
export async function clearGuild(guild, limiter) {
    const roles = guild.roles.cache.filter((role) => !role.managed && role.editable && role.id != guild.id);
    roles.forEach(async (role) => await limiter.schedule({ id: `clearGuild::role.delete::${role.id}` }, () => role.delete().catch((error) => console.error(`Error occurred while deleting roles: ${error.message}`))));

    guild.channels.cache.forEach(async (channel) => {
        if (channel?.deletable) {
            await limiter.schedule({ id: `clearGuild::channel.delete::${channel.id}` }, () => channel.delete().catch((error) => console.error(`Error occurred while deleting channels: ${error.message}`)));
        }
    });

    guild.emojis.cache.forEach(async (emoji) => await limiter.schedule({ id: `clearGuild::emoji.delete::${emoji.id}` }, () => emoji.delete().catch((error) => console.error(`Error occurred while deleting emojis: ${error.message}`))));

    const webhooks = await limiter.schedule({ id: "clearGuild::guild.fetchWebhooks" }, () => guild.fetchWebhooks());
    webhooks.forEach(async (webhook) => await limiter.schedule({ id: `clearGuild::webhook.delete::${webhook.id}` }, () => webhook.delete().catch((error) => console.error(`Error occurred while deleting webhooks: ${error.message}`))));

    const bans = await limiter.schedule({ id: "clearGuild::guild.bans.fetch" }, () => guild.bans.fetch());
    bans.forEach(async (ban) => await limiter.schedule({ id: `clearGuild::guild.members.unban::${ban.user.id}` }, () => guild.members.unban(ban.user).catch((error) => console.error(`Error occurred while deleting bans: ${error.message}`))));

    await limiter.schedule({ id: "clearGuild::guild.setAFKChannel" }, () => guild.setAFKChannel(null));
    await limiter.schedule({ id: "clearGuild::guild.setAFKTimeout" }, () => guild.setAFKTimeout(60 * 5));
    await limiter.schedule({ id: "clearGuild::guild.setIcon" }, () => guild.setIcon(null));
    await limiter.schedule({ id: "clearGuild::guild.setBanner" }, () => guild.setBanner(null));
    await limiter.schedule({ id: "clearGuild::guild.setSplash" }, () => guild.setSplash(null));
    await limiter.schedule({ id: "clearGuild::guild.setDefaultMessageNotifications" }, () => guild.setDefaultMessageNotifications(GuildDefaultMessageNotifications.OnlyMentions));
    await limiter.schedule({ id: "clearGuild::guild.setWidgetSettings" }, () => guild.setWidgetSettings({ enabled: false, channel: null }));

    if (!guild.features.includes(GuildFeature.Community)) {
        await limiter.schedule({ id: "clearGuild::guild.setExplicitContentFilter" }, () => guild.setExplicitContentFilter(GuildExplicitContentFilter.Disabled));
        await limiter.schedule({ id: "clearGuild::guild.setVerificationLevel" }, () => guild.setVerificationLevel(GuildVerificationLevel.None));
    }

    await limiter.schedule({ id: "clearGuild::guild.setSystemChannel" }, () => guild.setSystemChannel(null));
    await limiter.schedule({ id: "clearGuild::guild.setSystemChannelFlags" }, () => guild.setSystemChannelFlags([
        GuildSystemChannelFlags.SuppressGuildReminderNotifications,
        GuildSystemChannelFlags.SuppressJoinNotifications,
        GuildSystemChannelFlags.SuppressPremiumSubscriptions
    ]));

    await limiter.schedule({ id: "clearGuild::guild.setPremiumProgressBarEnabled" }, () => guild.setPremiumProgressBarEnabled(false));

    const rules = await limiter.schedule({ id: "clearGuild::guild.autoModerationRules.fetch" }, () => guild.autoModerationRules.fetch());
    rules.forEach(async (rule) => await limiter.schedule({ id: `clearGuild::rule.delete::${rule.id}` }, () => rule.delete().catch((error) => console.error(`Error occurred while deleting automod rules: ${error.message}`))));
}