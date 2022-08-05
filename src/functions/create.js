import { ChannelType } from "discord.js";
import axios from "axios";
import { fetchChannelPermissions, fetchTextChannelData, fetchVoiceChannelData } from "../utils";

/* returns an array with the banned members of the guild */
export async function getBans(guild) {
    const bans = await guild.bans.fetch();
    return bans.map((ban) => ({ id: ban.user.id, reason: ban.reason }));
}

/* returns an array with the members of the guild */
export async function getMembers(guild) {
    return guild.members.cache.map((member) => ({
        userId: member.user.id,
        username: member.user.username,
        discriminator: member.user.discriminator,
        avatarUrl: member.user.avatarUrl(),
        joinedTimestamp: member.joinedTimestamp,
        roles: member.roles.cache.map((role) => role.id),
        bot: member.user.bot
    }));
}

/* returns an array with the roles of the guild */
export async function getRoles(guild) {
    return guild.roles.cache
        .filter((role) => !role.managed)
        .sort((a, b) => b.position - a.position)
        .map((role) => ({
            name: role.name,
            color: role.hexColor,
            hoist: role.hoist,
            permissions: role.permissions.bitfield.toString(),
            mentionable: role.mentionable,
            position: role.position,
            isEveryone: guild.id == role.id
        }));
}

/* returns an array with the emojis of the guild */
export async function getEmojis(guild, options) {
    const emojis = [];

    for (let emoji of guild.emojis.cache) {
        const data = { name: emoji.name };

        if (options.saveImages && options.saveImages == "base64") {
            const response = await axios.get(emoji.url, { responseType: "arraybuffer" });
            data.base64 = Buffer.from(response.data, "binary").toString("base64");
        } else {
            data.url = emoji.url;
        }

        emojis.push(data);
    }

    return emojis;
}

/* returns an array with the channels of the guild */
export async function getChannels(guild, options) {
    const channels = { categories: [], others: [] };

    const categories = guild.channels.cache
        .filter((channel) => channel.type == ChannelType.GuildCategory)
        .sort((a, b) => a.position - b.position)
        .toJSON();

    for (let category of categories) {
        const categoryData = { name: category.name, permissions: fetchChannelPermissions(category), children: [] };

        const children = category.children.sory((a, b) => a.position - b.position).toJSON();

        for (let child of children) {
            if (child.type == ChannelType.GuildText || child.type == ChannelType.GuildNews) {
                const channelData = await fetchTextChannelData(child, options);
                categoryData.children.push(channelData);
            } else {
                const channelData = fetchVoiceChannelData(child);
                categoryData.children.push(channelData);
            }
        }

        channels.categories.push(categoryData);
    }

    const others = guild.channels.cache
        .filter((channel) => {
            return (
                !channel.parent &&
                channel.type != ChannelType.GuildCategory &&
                channel.type != ChannelType.GuildNewsThread &&
                channel.type != ChannelType.GuildPrivateThread &&
                channel.type != ChannelType.GuildPublicThread
            );
        })
        .sort((a, b) => a.position - b.position)
        .toJSON();

    for (let channel of others) {
        if (channel.type == ChannelType.GuildText || channel.type == ChannelType.GuildNews) {
            const channelData = await fetchTextChannelData(channel, options);
            channels.others.push(channelData);
        } else {
            const channelData = fetchVoiceChannelData(channel);
            channels.others.push(channelData);
        }
    }

    return channels;
}

export default {
    getBans,
    getMembers,
    getRoles,
    getEmojis,
    getChannels
};