import path from "path";
import fs from "fs";

let backups = `${__dirname}/backups`;
if (!fs.existsSync(backups)) fs.mkdirSync(backups);

/* checks if a backup exists and returns its data */
async function getBackupData(backupId) {
    return new Promise((resolve, reject) => {
        const files = fs.readdirSync(backups);
        const file = files.filter((file) => path.extname(file) == ".json").find((file) => file == `${backupId}.json`);

        if (file) {
            const backupData = require(`${backups}${path.sep}${file}`);
            resolve(backupData);
        } else {
            reject("No backup found");
        }
    });
}

/* fetches a backup and returns the information about it */
export function fetch(backupId) {
    return new Promise(async (resolve, reject) => {
        try {
            const backupData = await getBackupData();
            const size = fs.statSync(`${backups}${path.sep}${backupId}.json`).size;

            const backupInfo = {
                data: backupData,
                id: backupId,
                size: Number((size / 1024).toFixed(2))
            };

            resolve(backupInfo);
        } catch (error) {
            reject("No backup found");
        }
    });
}

/* creates a new backup and saves it to the storage */
export async function create(guild, options) {

}

/* loads a backup for a guild */
export async function load(backup, guild, options) {

}

/* removes a backup */
export async function remove(backupId) {

}

/* returns the list of all backups */
export async function list() {

}

/* change the storage path */
export async function setStorageFolder(path) {

}

export default { create, fetch, list, load, remove };