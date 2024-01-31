/*
    This file is part of fernie-emojidb.

    fernie-emojidb is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    fernie-emojidb is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with fernie-emojidb. If not, see <http://www.gnu.org/licenses/>.

*/
import { promises as fs } from "fs";
import path from "path";
import JSON5 from "json5";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import cliProgress from "cli-progress";

// main "runner":
const run = async () => {
  // read local configuration file: config.json5
  const config = JSON5.parse(await fs.readFile("./config.json5", "utf8"));
  const emojiDefinitions = await getFormattedEmojiDefinitions(config);
  await resetAndFillDB(config, emojiDefinitions);
};

const getEmojiIconList = async (config) => {
  // check if submodules are initialized:
  const emojiIconList = await fs.readdir("./twemoji/assets/svg");
  if (emojiIconList.length === 0) {
    console.log(
      "No emoji icons found. Please run: git submodule update --init --recursive"
    );
    process.exit(1);
  }
  return emojiIconList;
};

const getFormattedEmojiDefinitions = async (config) => {
  const emojiIconList = await getEmojiIconList(config);
  // get definition text:
  const definitionText = config.localEmojiDefinition
    ? await fs.readFile(config.localEmojiDefinition, "utf8")
    : await (await fetch(config.emojiDefinitionURL)).text();
  const lineRegex =
    /\n(?<code>[0-9A-F]+(?<optionalpart>\s[0-9A-F]+)*)\s+;\s[\S]+[\s]+#[\s](?<emoji>\S+)[\s](?<unicodeversion>E\S+)[\s](?<description>[^\n]+)/g;
  const matchingGroups = [...definitionText.matchAll(lineRegex)];
  const formattedGroups = matchingGroups.map((match) => {
    let file_name_match = `${match.groups.code
      .toLowerCase()
      .replace(/^[0]*/g, "")
      .replace(/ [0]+/g, " ")
      .replace(/\s/g, "-")}.svg`;
    if (!emojiIconList.includes(file_name_match)) {
      // try matching without color variation indicator as a fallback:
      file_name_match = file_name_match.replace(/-fe0f/g, "");
    }
    return {
      // we drop the .svg extension here to save quite some space in the database:
      file_name: file_name_match.replace(".svg", ""),
      emoji: match.groups.emoji,
      emoji_version: match.groups.unicodeversion,
      description: match.groups.description,
      // for filtering:
      iconFound: emojiIconList.includes(file_name_match),
      // just for debug purposes:
      code: match.groups.code,
    };
  });
  // normal emojis with matching icons to be included in the database:
  const existingMatching = formattedGroups.filter((group) => group.iconFound);
  // emojis without matching icons:
  const nonExistingMatching = formattedGroups.filter(
    (group) => !group.iconFound
  );
  console.log(
    `Found ${matchingGroups.length} emoji definitions in ${
      config.localEmojiDefinition ? "local" : "remote"
    } file (${existingMatching.length} matching icons – ${
      emojiIconList.length
    } icon files total).`
  );
  if (nonExistingMatching.length > 0) {
    console.log(
      `\nIcons not found: ${nonExistingMatching.length}\n`
      //   nonExistingMatching
      //     .map((match) => `${match.code}: ${match.emoji}`)
      //     .join(", "),
    );
  }
  const nonMatchedIcons = emojiIconList.filter(
    (icon) =>
      !existingMatching.find(
        (match) => match.file_name === icon.replace(".svg", "")
      )
  );
  if (nonMatchedIcons.length > 0) {
    console.log(
      `\nExisting icons not found in Definition: ${nonMatchedIcons.length}\n`
      //   nonMatchedIcons
      //     .map(
      //       (icon) =>
      //         `${icon}:${icon
      //           .replace(".svg", "")
      //           .split("-")
      //           .map((code) => String.fromCodePoint(parseInt(code, 16)))
      //           .join("")}`
      //     )
      //     .join(", "),
      //   "\n\n"
    );
  }

  return existingMatching;
};

const resetAndFillDB = async (config, emojiDefinitions) => {
  const outputDir = path.dirname(config.output);

  // clean old output directory and recreate it:
  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });

  const db = await open({
    filename: config.output,
    driver: sqlite3.Database,
  });
  // create tables:
  await db.exec(
    `create virtual table emojis using fts4(file_name text primary key, emoji text, emoji_version text, description text, tokenize=unicode61)`
  );
  console.log("\nDatabase is prepared, now inserting.");
  const progressbar = new cliProgress.SingleBar(
    {},
    cliProgress.Presets.legacy
  );

  progressbar.start(emojiDefinitions.length, 0);

  for (let index = 0; index < emojiDefinitions.length; index++) {
    const emojiDefinition = emojiDefinitions[index];
    await db.run(
      `insert into emojis (file_name, emoji, emoji_version, description) values (?, ?, ?, ?)`,
      emojiDefinition.file_name,
      emojiDefinition.emoji,
      emojiDefinition.emoji_version,
      emojiDefinition.description
    );
    progressbar.increment();
  }
  progressbar.stop();
};
run();
