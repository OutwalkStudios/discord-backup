import type { Guild } from "discord.js";

declare module "@outwalk/discord-backup" {

    interface Options {
        backupId: string,
        maxMessagesPerChannel: number,
        jsonSave: boolean,
        jsonBeautify: boolean,
        doNotBackup: string[],
        saveImages: string
    };

    async function create(guild: Guild, options: Options): Object;
    async function load(backup: Object, guild: Guild, options: Options): Promise<void>;
    async function remove(backupId: string): void;
    function list(): string[];
    function setStorageFolder(path: string): void;

    export default { create, load, remove, list, setStorageFolder };
}