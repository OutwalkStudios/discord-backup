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
    const members = await guild.members.fetch();

    return members.map((member) => ({
        userId: member.user.id,
        username: member.user.username,
        discriminator: member.user.discriminator,
        avatarUrl: member.user.avatarURL(),
        joinedTimestamp: member.joinedTimestamp,
        roles: member.roles.cache.map((role) => role.id),
        bot: member.user.bot
    }));
}

/* returns an array with the roles of the guild */
export async function getRoles(guild) {
    const roles = await guild.roles.fetch();

    return roles
        .filter((role) => !role.managed)
        .sort((a, b) => b.position - a.position)
        .map((role) => ({
            oldId: role.id,
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
    const emojis = await guild.emojis.fetch();
    const collectedEmojis = [];

    emojis.forEach(async (emoji) => {
        if (emojis.length >= 50) return;

        const data = { name: emoji.name };

        if (options.saveImages && options.saveImages == "base64") {
            const response = await axios.get(emoji.url, { responseType: "arraybuffer" });
            data.base64 = Buffer.from(response.data, "binary").toString("base64");
        } else {
            data.url = emoji.url;
        }

        collectedEmojis.push(data);
    });

    return collectedEmojis;
}

/* returns an array with the channels of the guild */
export async function getChannels(guild, options) {
    const channels = await guild.channels.fetch();
    const collectedChannels = { categories: [], others: [] };

    const categories = channels
        .filter((channel) => channel.type == ChannelType.GuildCategory)
        .sort((a, b) => a.position - b.position)
        .toJSON();

    for (let category of categories) {
        const categoryData = { name: category.name, permissions: fetchChannelPermissions(category), children: [] };

        const children = category.children.cache.sort((a, b) => a.position - b.position).toJSON();

        for (let child of children) {
            let channelData;
            if (child.type == ChannelType.GuildText || child.type == ChannelType.GuildNews) {
                channelData = await fetchTextChannelData(child, options);
            } else {
                channelData = fetchVoiceChannelData(child);
            }
            if (channelData) {
                channelData.oldId = child.id;
                categoryData.children.push(channelData);
            }
        }

        collectedChannels.categories.push(categoryData);
    }

    const others = channels
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
        let channelData;
        if (channel.type == ChannelType.GuildText || channel.type == ChannelType.GuildNews) {
            channelData = await fetchTextChannelData(channel, options);
        } else {
            channelData = fetchVoiceChannelData(channel);
        }
        if (channelData) {
            channelData.oldId = channel.id;
            collectedChannels.others.push(channelData);
        }
    }

    return collectedChannels;
}

export default {
    getBans,
    getMembers,
    getRoles,
    getEmojis,
    getChannels
};