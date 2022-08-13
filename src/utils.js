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
                let attach = attachment.url;

                if (attachment.url && ["png", "jpg", "jpeg", "jpe", "jif", "jfif", "jfi"].includes(attachment.url)) {
                    if (options.saveImages && options.saveImages == "base64") {
                        const response = await axios.get(attachment.url, { responseType: "arraybuffer" });
                        const buffer = Buffer.from(response.data, "binary").toString("base64");
                        if (Buffer.byteLength(buffer) <= 8000000) attach = buffer;
                    }
                }

                return { name: attachment.name, attachment: attach };
            }));

            messages.push({
                username: message.author.username,
                avatar: message.author.displayAvatarURL(),
                content: message.cleanContent,
                embeds: message.embeds,
                files: files,
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
export async function loadCategory(categoryData, guild, rateLimitManager) {
    const category = await rateLimitManager.resolver(guild.channels, "create", { name: categoryData.name, type: ChannelType.GuildCategory });
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

    await rateLimitManager.resolver(category.permissionOverwrites, "set", finalPermissions);
    return category;
}

/* creates a channel and returns it */
export async function loadChannel(channelData, guild, category, options, rateLimitManager) {

    const loadMessages = async (channel, messages, previousWebhook) => {
        const webhook = previousWebhook || await rateLimitManager.resolver(channel, "createWebhook", { name: "MessagesBackup", avatar: channel.client.user.displayAvatarURL() });
        if (!webhook) return;

        messages = messages.filter((message) => (message.content.length > 0 || message.embeds.length > 0 || message.files.length > 0)).reverse();
        messages = messages.slice(messages.length - options.maxMessagesPerChannel);

        for (let message of messages) {
            if (message.content.length > 2000) continue;
            try {
                const sent = await rateLimitManager.resolver(webhook, "send", {
                    content: message.content.length ? message.content : undefined,
                    username: message.username,
                    avatarURL: message.avatar,
                    embeds: message.embeds,
                    files: message.files,
                    allowedMentions: options.allowedMentions,
                    threadId: channel.isThread() ? channel.id : undefined
                });

                if (message.pinned && sent) await rateLimitManager.resolver(sent, "pin");
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

    const channel = await rateLimitManager.resolver(guild.channels, "create", createOptions);
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

    await rateLimitManager.resolver(channel.permissionOverwrites, "set", finalPermissions);

    if (channelData.type == ChannelType.GuildText) {
        let webhook;

        if (channelData.messages.length > 0) {
            webhook = await loadMessages(channel, channelData.messages);
        }

        if (channelData.threads.length > 0) {
            channelData.threads.forEach(async (threadData) => {
                await rateLimitManager.resolver(channel.threads, "create", { name: threadData.name, autoArchiveDuration: threadData.autoArchiveDuration });
                if (webhook) await loadMessages(thread, threadData.messages, webhook);
            });
        }
    }

    return channel;
}

/* delete all roles, channels, emojis, etc of a guild */
export async function clearGuild(guild, rateLimitManager) {
    const roles = guild.roles.cache.filter((role) => !role.managed && role.editable && role.id != guild.id);
    roles.forEach((role) => rateLimitManager.resolver(role, "delete"));

    guild.channels.cache.forEach((channel) => rateLimitManager.resolver(channel, "delete"));
    guild.emojis.cache.forEach((emoji) => rateLimitManager.resolver(emoji, "delete"));

    const webhooks = await rateLimitManager.resolver(guild, "fetchWebhooks");
    webhooks.forEach((webhook) => rateLimitManager.resolver(webhook, "delete"));

    const bans = await rateLimitManager.resolver(guild.bans, "fetch")
    bans.forEach((ban) => rateLimitManager.resolver(guild.members, "unban", ban.user));

    rateLimitManager.resolver(guild, "setAFKChannel", null);
    rateLimitManager.resolver(guild, "setAFKTimeout", 60 * 5);
    rateLimitManager.resolver(guild, "setIcon", null);
    rateLimitManager.resolver(guild, "setBanner", null);
    rateLimitManager.resolver(guild, "setSplash", null);
    rateLimitManager.resolver(guild, "setDefaultMessageNotifications", GuildDefaultMessageNotifications.OnlyMentions);
    rateLimitManager.resolver(guild, "setWidgetSettings", { enabled: false, channel: null });

    if (!guild.features.includes(GuildFeature.Community)) {
        rateLimitManager.resolver(guild, "setExplicitContentFilter", GuildExplicitContentFilter.Disabled);
        rateLimitManager.resolver(guild, "setVerificationLevel", GuildVerificationLevel.None);
    }

    rateLimitManager.resolver(guild, "setSystemChannel", null);
    rateLimitManager.resolver(guild, "setSystemChannelFlags", [
        GuildSystemChannelFlags.SuppressGuildReminderNotifications,
        GuildSystemChannelFlags.SuppressJoinNotifications,
        GuildSystemChannelFlags.SuppressPremiumSubscriptions
    ]);
}