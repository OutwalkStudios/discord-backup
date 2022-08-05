import type { Guild } from "discord.js";

export declare interface Options {
    backupId: string,
    maxMessagesPerChannel: number,
    jsonSave: boolean,
    jsonBeautify: boolean,
    doNotBackup: string[],
    saveImages: string
}

export declare function create(guild: Guild, options: Options): Promise<Object>;
export declare function load(backup: Object, guild: Guild, options: Options): Promise<void>;
export declare function remove(backupId: string): Promise<void>;
export declare function list(): string[];
export declare function setStorageFolder(path: string): void;