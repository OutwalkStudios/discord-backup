import type { Guild } from "discord.js";

export declare interface CreateOptions {
    backupId?: string,
    maxMessagesPerChannel?: number,
    jsonSave?: boolean,
    jsonBeautify?: boolean,
    doNotBackup?: string[],
    backupMembers?: boolean,
    saveImages?: boolean | string,
    clearGuildBeforeRestore: boolean
    speed?: number
}

export declare function create(guild: Guild, options?: Options): Promise<Object>;
export declare function load(backup: Object, guild: Guild, options?: Options): Promise<void>;
export declare function remove(backupId: string): Promise<void>;
export declare function list(): string[];
export declare function setStorageFolder(pathname: string): void;