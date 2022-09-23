import type {
    Guild,
    GuildVerificationLevel,
    GuildExplicitContentFilter,
    GuildDefaultMessageNotifications,
    Snowflake,
    TextBasedChannelTypes,
    VoiceBasedChannelTypes,
    ThreadChannelType,
    Embed,
    ThreadAutoArchiveDuration
} from "discord.js";

export declare interface CreateOptions {
    backupId?: string;
    maxMessagesPerChannel?: number;
    jsonSave?: boolean;
    jsonBeautify?: boolean;
    doNotBackup?: string[];
    backupMembers?: boolean;
    saveImages?: boolean | string;
    clearGuildBeforeRestore?: boolean;
}

export declare interface LoadOptions {
    clearGuildBeforeRestore?: boolean;
    maxMessagesPerChannel?: number;
    speed?: number;
}

export declare interface AfkData {
    name: string;
    timeout: number;
}

export declare interface WidgetData {
    enabled: boolean;
    channel?: string;

}

export declare interface ChannelPermissionsData {
    roleName: string;
    allow: string;
    deny: string;
}

export declare interface BaseChannelData {
    type: TextBasedChannelTypes | VoiceBasedChannelTypes | ThreadChannelType;
    name: string;
    parent?: string;
    permissions: ChannelPermissionsData[];
}

export declare interface MessageData {
    username: string;
    avatar?: string;
    content?: string;
    embeds?: Embed[];
    files?: Object;
    pinned?: boolean;
    sentAt: string;
}

export declare interface ThreadChannelData {
    type: ThreadChannelType;
    name: string;
    archived: boolean;
    autoArchiveDuration: ThreadAutoArchiveDuration;
    locked: boolean;
    rateLimitPerUser: number;
    messages: MessageData[];
}

export declare interface TextChannelData extends BaseChannelData {
    nsfw: boolean;
    parent?: string;
    topic?: string;
    rateLimitPerUser?: number;
    isNews: boolean;
    messages: MessageData[];
    threads: ThreadChannelData[];
}

export declare interface VoiceChannelData extends BaseChannelData {
    bitrate: number;
    userLimit: number;
}

export declare interface CategoryData {
    name: string;
    permissions: ChannelPermissionsData[];
    children: Array<TextChannelData | VoiceChannelData>;
}

export declare interface ChannelsData {
    categories: CategoryData[];
    others: Array<TextChannelData | VoiceChannelData>;
}

export declare interface RoleData {
    name: string;
    color: `#${string}`;
    hoist: boolean;
    permissions: string;
    mentionable: boolean;
    position: number;
    isEveryone: boolean;
}

export declare interface BanData {
    id: Snowflake;
    reason: string;
}

export declare interface EmojiData {
    name: string;
    url?: string;
    base64?: string;
}

export declare interface MemberData {
    userId: string;
    username: string;
    discriminator: string;
    avatarUrl: string;
    joinedTimestamp: number;
    roles: string[];
    bot: boolean;
}

export declare interface BackupData {
    name: string;
    iconURL?: string;
    iconBase64?: string;
    verificationLevel: GuildVerificationLevel;
    explicitContentFilter: GuildExplicitContentFilter;
    defaultMessageNotifications: GuildDefaultMessageNotifications | number;
    afk?: AfkData;
    widget: WidgetData;
    splashURL?: string;
    splashBase64?: string;
    bannerURL?: string;
    bannerBase64?: string;
    channels: ChannelsData;
    roles: RoleData[];
    bans: BanData[];
    emojis: EmojiData[];
    members: MemberData[];
    createdTimestamp: number;
    guildID: string;
    id: Snowflake;
}

export declare function create(guild: Guild, options?: CreateOptions): Promise<BackupData>;
export declare function load(backup: Object, guild: Guild, options?: LoadOptions): Promise<BackupData>;
export declare function remove(backupId: string): Promise<void>;
export declare function list(): string[];
export declare function setStorageFolder(pathname: string): void;