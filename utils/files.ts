import { existsSync, mkdirSync, writeFileSync } from "fs";

export const saveFile = async (folder: string, fileName: string, data: any) => {
  // cascade check if the folder exists, if not create it for each level
  const folders = folder.split("/");
  let currentFolder = "";
  for (const folder of folders) {
    currentFolder += `${folder}/`;
    if (!existsSync(currentFolder)) {
      mkdirSync(currentFolder);
    }
  }

  await writeFileSync(`${folder}/${fileName}`, JSON.stringify(data));
};
