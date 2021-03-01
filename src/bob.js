/// <reference path="./types.d.ts" />

process.title = "bingo-bot";

import fs from "fs";
import path from "path";
import url from "url";

// change current working dir to repo root
process.chdir(path.dirname(path.dirname(url.fileURLToPath(import.meta.url))));

import "./discord/Client.js";
import "./discord/Guild.js";
import "./discord/GuildMember.js";
import "./discord/Message.js";
import "./discord/User.js";

import { assert, log, logError } from "./misc.js";
import Race from "./Race.js";

import Discord from "discord.js";
import semverMajor from "semver/functions/major.js";

log("started");

const DISCORD_AUTH = "./discord_auth.json";
const TOKEN_HERE = "discord auth token here";

if (semverMajor(process.version) < 14) {
    logError("upgrade your node.js https://nodejs.org/en/");
    process.exit(1);
}

/** @returns {never} */
function discordAuthRequired() {
    logError("enter your bot's discord auth token in 'discord_auth.json'");
    process.exit(1);
}

if (!fs.existsSync(DISCORD_AUTH)) {
    fs.writeFileSync(DISCORD_AUTH, `${JSON.stringify({ token: TOKEN_HERE }, null, 2)}\n`);
    discordAuthRequired();
}

/** @type {string} */
const discordAuthToken = JSON.parse(fs.readFileSync(DISCORD_AUTH)).token;
if (discordAuthToken === TOKEN_HERE || discordAuthToken.length === 0) {
    discordAuthRequired();
}

const client = new Discord.Client({
    disableMentions: "everyone",
    messageEditHistoryMaxSize: 0,
    ws: { intents: [ "DIRECT_MESSAGES", "GUILD_MEMBERS", "GUILD_MESSAGES", "GUILDS" ] }
});

await client.login(discordAuthToken);
log("connected to discord");

Object.assign(client, {
    application: await client.fetchApplication(),
    srGuilds: Object.create(null),
    modules: Object.create(null),
    commands: Object.create(null),
    config: {},
    databases: []
});

client.owner = client.application.owner;
if (client.owner instanceof Discord.Team) {
    client.owner = client.owner.owner.user;
}

client.owner.createDM();

for (let file of fs.readdirSync("./src/guild_configs")) {
    assert(file.toLowerCase().endsWith(".js"), `'src/guild_configs/${file}' is not a JavaScript file`);

    /** @type {GuildInput} */
    let guildInput = (await import(`./guild_configs/${file}`));
    if (Object.keys(guildInput).length === 1 && guildInput.default) {
        guildInput = guildInput.default;
    }

    assert(guildInput.id, `couldn't load 'src/guild_configs/${file}'`);

    const guild = await client.guilds.fetch(guildInput.id);
    await guild.init(guildInput);
}

const { Events } = Discord.Constants;

client.on(Events.MESSAGE_CREATE, function onMessage(message) {
    if (!message.author.bot && (!message.guild || message.content.startsWith(message.guild.commandPrefix))) {
        client.useCommand(message, message.member ?? message.author);
    }
});

client.on(Events.GUILD_MEMBER_REMOVE, function onMemberRemove(member) {
    if (member.team) {
        /** @type {{ race: Race; }} */
        const { race } = member.team;
        race.channel.send(race.removeEntrant(member));
    }
});

process.on("unhandledRejection", async function onUnhandledRejection(error) {
    logError(`unhandled promise rejection: ${error.stack ?? error}`);

    try {
        await client.user.setStatus("invisible");
    } catch {}

    process.exit(1);
});

process.on("exit", function onExit() {
    for (let database of client.databases) {
        database.close();
    }

    log("exited");
});

process.on("uncaughtException", async function onUncaughtException(error) {
    logError(error?.stack ?? error);

    try {
        await client.user.setStatus("invisible");
    } catch {}

    process.exit(1);
});

process.on("SIGINT", async function onKeyboardInterrupt() {
    await client.user.setStatus("invisible");

    process.exit();
});

log("ready");