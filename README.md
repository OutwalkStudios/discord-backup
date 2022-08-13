# @outwalk/discord-backup

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/OutwalkStudios/discord-backup/blob/master/LICENSE)
[![Follow Us](https://img.shields.io/badge/follow-on%20twitter-4AA1EC.svg)](https://twitter.com/OutwalkStudios)

Discord Backup is a module for backing up and restoring discord servers.

This package is heavily inspired by [discord-backup](https://github.com/Androz2091/discord-backup) which has become unmaintained. This package has been updated to support discord.js v14 and aims to maintain API compatibility with discord-backup.


---

## Installation

You can install @outwalk/discord-backup using npm:

```
npm install @outwalk/discord-backup
```

---

### Create

Create a backup for the specified server.

```js
import backup from "@outwalk/discord-backup";

const backupData = await backup.create(guild, options);
```

### Load

Allows you to load a backup on a Discord server!

```js
import backup from "@outwalk/discord-backup";

await backup.load(backupId, guild);
await backup.remove(backupId);
```

### Fetch

Fetches information from a backup

```js
import backup from "@outwalk/discord-backup";

const backupInfo = await backup.fetch(backupId);
```

### Remove

**Warn**: once the backup is removed, it is impossible to recover it!

```js
import backup from "@outwalk/discord-backup";

backup.remove(backupID);
```

### List

**Note**: `backup.list()` simply returns an array of IDs, you must fetch the ID to get complete information.

```js
import backup from "@outwalk/discord-backup";

const backups = backup.list();
```

### SetStorageFolder

Updates the storage folder to another

```js
import backup from "@outwalk/discord-backup";
import path from "path";

backup.setStorageFolder(path.join(process.cwd(), "backups"));
```
---

## Advanced usage

### Create [advanced]

You can use more options for backup creation:

```js
import backup from "@outwalk/discord-backup";

await backup.create(guild, {
    maxMessagesPerChannel: 10,
    jsonSave: false,
    jsonBeautify: true,
    doNotBackup: [ "roles",  "channels", "emojis", "bans" ],
    saveImages: "base64"
});
```

**maxMessagesPerChannel**: Maximum of messages to save in each channel. "0" won't save any messages.  
**jsonSave**: Whether to save the backup into a json file. You will have to save the backup data in your own db to load it later.  
**jsonBeautify**: Whether you want your json backup pretty formatted.
**doNotBackup**: Things you don't want to backup. Available items are: `roles`, `channels`, `emojis`, `bans`.  
**saveImages**: How to save images like guild icon and emojis. Set to "url" by default, restoration may not work if the old server is deleted. So, `url` is recommended if you want to clone a server (or if you need very light backups), and `base64` if you want to backup a server. Save images as base64 creates heavier backups.

### Load [advanced]

As you can see, you're able to load a backup from your own data instead of from an ID:

```js
import backup from "@outwalk/discord-backup";

await backup.load(backupData, guild, {
    clearGuildBeforeRestore: true
});
```

**clearGuildBeforeRestore**: Whether to clear the guild (roles, channels, etc... will be deleted) before the backup restoration (recommended).  
**maxMessagesPerChannel**: Maximum of messages to restore in each channel. "0" won't restore any messages.
**mode**: What speed to run at, options are `slow`, `auto`, `fast`

---

## Reporting Issues

If you are having trouble getting something to work or run into any problems, you can create a new [issue](https://github.com/OutwalkStudios/discord-backup/issues).

---

## License

@outwalk/discord-backup is licensed under the terms of the [**MIT**](https://github.com/OutwalkStudios/discord-backup/blob/master/LICENSE) license.