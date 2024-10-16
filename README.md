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

Fetches information from a backup.
The backup info provides a `data`, `id`, and `size` property.

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
    backupId: "mybackup",
    maxMessagesPerChannel: 10,
    jsonSave: false,
    jsonBeautify: true,
    doNotBackup: ["roles", "channels", "emojis", "bans"],
    backupMembers: false,
    saveImages: "base64",
    speed: 250,
    ignore2FA: false,
    onStatusChange: (status) => {
        console.log(`Saving ${status.step}... (${status.progress}) (${status.percentage})`);
    }
});
```

**backupId**: Specify an Id to be used for the backup, if not provided a random one will be generated.</br>
**maxMessagesPerChannel**: Maximum of messages to save in each channel. "0" won't save any messages.</br>
**jsonSave**: Whether to save the backup into a json file. You will have to save the backup data in your own db to load it later.  
**jsonBeautify**: Whether you want your json backup pretty formatted.</br>
**doNotBackup**: Items you want to exclude from the backup. Available options are `bans`, `roles`, `emojis`, and `channels`. You can specify all channels or a subset:
  - **Exclude specific channels**:
    ```js
    doNotBackup: [{ channels: ["channel_id_1", "channel_id_2"] }]
    ```
  - **Exclude all channels**:
    ```js
    doNotBackup: ["channels"]
    ```
**toBackup**: Items you want to include in the backup. Available options are `bans`, `roles`, `emojis`, and `channels`. You can specify all channels or a subset:
  - **Include specific channels**:
    ```js
    toBackup: [
        {
            channels: ["channel_id_3", "channel_id_4"]
        }
    ]
    ```
  - **Include all channels**:
    ```js
    toBackup: ["channels"]
    ```
**backupMembers**: Wether or not to save information on the members of the server.</br>
**saveImages**: How to save images like guild icon and emojis. Set to "url" by default, restoration may not work if the old server is deleted. So, `url` is recommended if you want to clone a server (or if you need very light backups), and `base64` if you want to backup a server. Save images as base64 creates heavier backups.</br>
**speed**: What speed to run at, default is 250 (measured in ms)</br>
**verbose**: Derermines if the output should be verbose or not.</br>
**ignore2FA**: Disables attempting to grab items that require 2FA</br>
**onStatusChange**: A callback function to handle the status updates during the backup process.</br>
The status object contains three properties:</br>
- **step**: The current step (e.g., "Channels").
- **progress**: Progress for that step (e.g., "1/100").
- **percentage**: Percentage completion (e.g., "1%").
- **info**: A detailed description or update of what is happening in the current step (e.g., "Backed up Channel: ⚡︱weather-api (Category: ☁︱weather)"). This can provide real-time context about which item or action is being processed in the backup.

You can use the onStatusChange callback to display status messages in Discord, for example:
```js
onStatusChange: async (status) => {
  // Create an embed for the status update
  const statusEmbed = new EmbedBuilder()
    .setColor("#0099ff")
    .setTitle(`Backup Progress: ${status.step}`)
    .setDescription(`Status update for backup in progress.`)
    .addFields(
      { name: "Step", value: status.step, inline: true },
      { name: "Progress", value: status.progress, inline: true },
      { name: "Percentage", value: status.percentage, inline: true },
      { name: "Info", value: status.info || "N/A" }
    )
    .setTimestamp()
    .setFooter({ text: "Backup Status", iconURL: guild.iconURL() });

  // Send the embed to the channel
  await interaction.channel.send({ embeds: [statusEmbed] });
  console.log(
    `[Backing up] Step: ${status.step} | Progress: ${
      status.progress
    } | Percentage: ${status.percentage} | Info: ${
      status.info || "N/A"
    }`
  );
},
```
This allows you to send real-time updates as the backup progresses.

#### Requires 2FA
- Auto Moderation Rules
- Bans

### Load [advanced]

As you can see, you're able to load a backup from your own data instead of from an ID:

```js
import backup from "@outwalk/discord-backup";

await backup.load(backupData, guild, {
    clearGuildBeforeRestore: true,
    maxMessagesPerChannel: 10,
    speed: 250,
    doNotLoad: ["roleAssignments", "emojis"],
    onStatusChange: (status) => {
        console.log(
          `[Restoring] Step: ${status.step} | Progress: ${
            status.progress
          } | Percentage: ${status.percentage} | Info: ${status.info || "N/A"}`
        );
});
```

**clearGuildBeforeRestore**: Whether to clear the guild (roles, channels, etc... will be deleted) before the backup restoration (recommended).</br>
**maxMessagesPerChannel**: Maximum of messages to restore in each channel. "0" won't restore any messages.</br>
**speed**: What speed to run at, default is 250 (measured in ms)</br>
**verbose**: Determines if the output should be verbose or not.</br>
**doNotLoad**: Things you dont want to restore. Available items are: `main`, `roleAssignments`, `emojis`, `roles`, & `channels`. `main` will prevent loading the main backup, `roleAssignments` will prevent reassigning roles to members, `emojis` will prevent restoring emojis, `roles` will prevent restoring roles and `channels` will prevent restoring channels.</br>
**onStatusChange**: A callback function to handle the status updates during the restoration process. Similar to backup, it provides the `step`, `progress`, `percentage`, and `info`.</br>

---

## Reporting Issues

If you are having trouble getting something to work or run into any problems, you can create a new [issue](https://github.com/OutwalkStudios/discord-backup/issues).

---

## License

@outwalk/discord-backup is licensed under the terms of the [**MIT**](https://github.com/OutwalkStudios/discord-backup/blob/master/LICENSE) license.