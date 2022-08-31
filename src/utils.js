import {
    ChannelType,
    GuildFeature,
    GuildDefaultMessageNotifications,
    GuildExplicitContentFilter,
    GuildVerificationLevel,
    GuildSystemChannelFlags,
    OverwriteType
} from "discord.js";
import axios from "axios";

const MAX_BITRATE_PER_TIER = {
    NONE: 64000,
    TIER_1: 128000,
    TIER_2: 256000,
    TIER_3: 384000
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

/* fetches the messages from a channel */
export async function fetchChannelMessages(channel, options) {
    const messages = [];

    const messageCount = isNaN(options.maxMessagesPerChannel) ? 10 : options.maxMessagesPerChannel;
    const fetchOptions = { limit: 100 };

    let lastMessageId;
    let fetchComplete = false;

    while (!fetchComplete) {
        if (lastMessageId) fetchOptions.before = lastMessageId;

        const fetched = await channel.messages.fetch(fetchOptions);
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
                        const bufferSize = Buffer.byteLength(buffer);

                        if (bufferSize > 8000000) return null;
                        return { name: attachment.name, attachment: buffer };

                    } else if (options.saveImages) {
                        const response = await axios.head(attachment.url);
                        const imageSize = response.headers["content-length"];
                        if (imageSize > 8000000) return null;
                    }
                }

                return { name: attachment.name, attachment: attachment.url };
            }));

            messages.push({
                username: message.author.username,
                avatar: message.author.displayAvatarURL(),
                content: message.cleanContent,
                embeds: message.embeds,
                files: files.filter((file) => file != null),
                pinned: message.pinned,
                sentAt: message.createdAt.toISOString()
            });
        }));
    }

    return messages;
}

/* fetches the text channel data that is necessary for the backup */
export async function fetchTextChannelData(channel, options) {
    const channelData = {
        type: channel.type,
        name: channel.name,
        nsfw: channel.nsfw,
        rateLimitPerUser: channel.type == ChannelType.GuildText ? channel.rateLimitPerUser : undefined,
        parent: channel.parent ? channel.parent.name : null,
        topic: channel.topic,
        permissions: fetchChannelPermissions(channel),
        messages: [],
        isNews: channel.type == ChannelType.GuildNews,
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
                threadData.messages = await fetchChannelMessages(thread, options);
                channelData.threads.push(threadData);
            } catch {
                channelData.threads.push(threadData);
            }
        });
    }

    try {
        channelData.messages = await fetchChannelMessages(channel, options);
        return channelData;
    } catch {
        return channelData;
    }
}

/* creates a category for the guild */
export async function loadCategory(categoryData, guild, limiter) {
    const category = await limiter.schedule(() => guild.channels.create({ name: categoryData.name, type: ChannelType.GuildCategory }));
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

    await limiter.schedule(() => category.permissionOverwrites.set(finalPermissions));
    return category;
}

/* creates a channel and returns it */
export async function loadChannel(channelData, guild, category, options, limiter) {

    const loadMessages = async (channel, messages, previousWebhook) => {
        const webhook = previousWebhook || await limiter.schedule(() => channel.createWebhook({ name: "MessagesBackup", avatar: channel.client.user.displayAvatarURL() }));
        if (!webhook) return;

        messages = messages.filter((message) => (message.content.length > 0 || message.embeds.length > 0 || message.files.length > 0)).reverse();
        messages = messages.slice(messages.length - options.maxMessagesPerChannel);

        for (let message of messages) {
            if (message.content.length > 2000) continue;
            try {
                const sent = await limiter.schedule(() => webhook.send({
                    content: message.content.length ? message.content : undefined,
                    username: message.username,
                    avatarURL: message.avatar,
                    embeds: message.embeds,
                    files: message.files,
                    allowedMentions: options.allowedMentions,
                    threadId: channel.isThread() ? channel.id : undefined
                }));

                if (message.pinned && sent) await limiter.schedule(() => sent.pin());
            } catch (error) {
                console.error(error.message);
                console.log(message);
            }
        }

        return webhook;
    };

    const createOptions = { name: channelData.name, type: null, parent: category };

    if (channelData.type == ChannelType.GuildText || channelData.type == ChannelType.GuildNews) {
        createOptions.topic = channelData.topic;
        createOptions.nsfw = channelData.nsfw;
        createOptions.rateLimitPerUser = channelData.rateLimitPerUser;
        createOptions.type = channelData.isNews && guild.features.includes(GuildFeature.News) ? ChannelType.GuildNews : ChannelType.GuildText;
    }

    else if (channelData.type == ChannelType.GuildVoice) {
        let bitrate = channelData.bitrate;
        const bitrates = Object.values(MAX_BITRATE_PER_TIER);

        while (bitrate > MAX_BITRATE_PER_TIER[guild.premiumTier]) {
            bitrate = bitrates[Object.keys(MAX_BITRATE_PER_TIER).indexOf(guild.premiumTier) - 1];
        }

        createOptions.bitrate = bitrate;
        createOptions.userLimit = channelData.userLimit;
        createOptions.type = ChannelType.GuildVoice;
    }

    const channel = await limiter.schedule(() => guild.channels.create(createOptions));
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

    await limiter.schedule(() => channel.permissionOverwrites.set(finalPermissions));

    if (channelData.type == ChannelType.GuildText) {
        let webhook;

        if (channelData.messages.length > 0) {
            webhook = await loadMessages(channel, channelData.messages);
        }

        if (channelData.threads.length > 0) {
            channelData.threads.forEach(async (threadData) => {
                const thread = await limiter.schedule(() => channel.threads.create({ name: threadData.name, autoArchiveDuration: threadData.autoArchiveDuration }));
                if (webhook) await loadMessages(thread, threadData.messages, webhook);
            });
        }
    }

    return channel;
}

/* delete all roles, channels, emojis, etc of a guild */
export async function clearGuild(guild, limiter) {
    const roles = guild.roles.cache.filter((role) => !role.managed && role.editable && role.id != guild.id);
    roles.forEach(async (role) => await limiter.schedule(() => role.delete()));

    guild.channels.cache.forEach(async (channel) => await limiter.schedule(() => channel.delete()));
    guild.emojis.cache.forEach(async (emoji) => await limiter.schedule(() => emoji.delete()));

    const webhooks = await limiter.schedule(() => guild.fetchWebhooks());
    webhooks.forEach(async (webhook) => await limiter.schedule(() => webhook.delete()));

    const bans = await limiter.schedule(() => guild.bans.fetch());
    bans.forEach(async (ban) => await limiter.schedule(() => guild.members.unban(ban.user)));

    await limiter.schedule(() => guild.setAFKChannel(null));
    await limiter.schedule(() => guild.setAFKTimeout(60 * 5));
    await limiter.schedule(() => guild.setIcon(null));
    await limiter.schedule(() => guild.setBanner(null));
    await limiter.schedule(() => guild.setSplash(null));
    await limiter.schedule(() => guild.setDefaultMessageNotifications(GuildDefaultMessageNotifications.OnlyMentions));
    await limiter.schedule(() => guild.setWidgetSettings({ enabled: false, channel: null }));

    if (!guild.features.includes(GuildFeature.Community)) {
        await limiter.schedule(() => guild.setExplicitContentFilter(GuildExplicitContentFilter.Disabled));
        await limiter.schedule(() => guild.setVerificationLevel(GuildVerificationLevel.None));
    }

    await limiter.schedule(() => guild.setSystemChannel(null));
    await limiter.schedule(() => guild.setSystemChannelFlags([
        GuildSystemChannelFlags.SuppressGuildReminderNotifications,
        GuildSystemChannelFlags.SuppressJoinNotifications,
        GuildSystemChannelFlags.SuppressPremiumSubscriptions
    ]));
}